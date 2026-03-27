import google.generativeai as genai
import os
import sqlite3
import speech_recognition as sr
from pydub import AudioSegment # to tansalte the file sent by browser
from pydub.silence import detect_silence
import time
from flask import Flask, render_template, request, jsonify, session
from dotenv import load_dotenv
import wave # for sound to use wav file ratheer mp3
import numpy as np #for rms

# to load api keys
load_dotenv()
# Temporary test to see if pydub can find ffmpeg
try:
    # This creates a 1-second silent "test" sound
    test_sound = AudioSegment.silent(duration=1000)
    print("Pydub and FFmpeg are shaking hands successfully!")
except Exception as e:
    print(f"Bridge Error: {e}")

GEMINI_API_KEY=os.environ.get("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)
model=genai.GenerativeModel('gemini-2.5-flash')

app=Flask(__name__)

app.secret_key="super_secret_key_for_adhd_app"
#TEMPORAL VOICE RECORDING FOLDER
UPLOAD_FOLDER= 'static/uploads'
app.config['UPLOAD_FOLDER']=UPLOAD_FOLDER
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

#THE DATABASE INITIALIZER
def init_db():
    conn= sqlite3.connect('adhd_app.db')
    cursor=conn.cursor()
    #PARENT TABLE
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cognitive_results(
            assessment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER,
            variability REAL,
            memory_score REAL,
            stroop_score REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)
    """)
    
    #CHILD TABLE
    cursor.execute("""
       CREATE TABLE IF NOT EXISTS speech_analysis(
            audio_id INTEGER PRIMARY KEY AUTOINCREMENT,
            assessment_id INTEGER,
            duration REAL,
            rms REAL,
            gemini_report TEXT,
            FOREIGN KEY (assessment_id) REFERENCES cognitive_results(assessment_id))
    """)
    conn.commit()
    conn.close()

init_db()#calling the function so the file is created before any uuser visits
#---------------------------
def schema_update():
    #Schema update 
    conn=sqlite3.connect('adhd_app.db')
    cursor=conn.cursor()
    
    try:
        cursor.execute("ALTER TABlE speech_analysis ADD COLUMN wpm REAL")
        cursor.execute("ALTER TABLE speech_analysis ADD COLUMN transcript TEXT")
        cursor.execute("ALTER TABLE speech_analysis ADD COLUMN silence_ratio REAL")
        print("Database Updated successfully!")
    except sqlite3.OperationalError:
        print("Columns might already exist.")
    
        conn.commit()
        conn.close()
schema_update()
# --- HELPER FUNCTIONS (Place these above your routes) ---

def get_filler_count(input_string):
    # This function doesn't care what the variable was named outside
    # It just takes whatever string you give it and calls it 'input_string'
    fillers = ["um", "uh", "err", "ah", "like"]
    words = input_string.lower().split()
    
    count = 0
    for word in words:
        clean_word = word.strip(".,!?")
        if clean_word in fillers:
            count += 1
    return count

#telling the browser what to show if someone visits our site
@app.route('/')
def index():
    return render_template('index.html')

#------------
#when user click record audio
@app.route('/analyze_audio',methods=['POST'])
def analyze_audio():
    conn = sqlite3.connect('adhd_app.db')
    cursor=conn.cursor()
    cursor.execute("INSERT INTO cognitive_results (person_id) VALUES (?)",(1,)) #WE NEED TO INTIALLY ATLEAST INSERT ONE ROW THAT ISN'T ID
    assessment_id=cursor.lastrowid
    session['current_assessment_id']=assessment_id #Because session is stored in the user's browser (as an encrypted cookie), it acts like a bridge.
    conn.commit()
    conn.close()

    #handling the audio file

    #get file through request
    audio_file=request.files['audio_data']
    raw_filename = f"raw_{int(time.time())}.webm"
    raw_filepath = os.path.join(app.config['UPLOAD_FOLDER'], raw_filename)
    audio_file.save(raw_filepath)
    filename = f"rec_{int(time.time())}.wav"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    try:
        #translating into .wav 
        audio_segment=AudioSegment.from_file(raw_filepath,format="webm")
        if audio_segment.rms==0:
            print("!!! Warning: RMS is 0.Attempting alternate decode... ")
            audio_segment=AudioSegment.from_file(raw_filepath)

        audio_segment.export(filepath,format="wav")#exporting to hard drive, first path and then format
    #now changing the rms and duration calculation since pydub had built in feature for that so math is not necessary, can use it but necessary to open wave file
    #calculate the duration
    #with wave.open(filepath,'rb') as wf:
    #    frames=wf.getnframes() #total number of frames
    #    rate=wf.getframerate()#frame peersecond
    #    duration=frames/float(rate)
    
    #calculate rms(root mean square)
    #with wave.open(filepath,'rb') as wf:
    #    raw_data=wf.readframes(wf.getnframes())#read all frames as bytes
    #    audio_samples=np.frombuffer(raw_data, dtype=np.int16)#conver bytes into list of numbers
    
    #rms=np.sqrt(np.mean(audio_samples**2))
    #normalized_rms=rms/32768.0 #raw rms can be huge so by 32768 to get a decimal between 0 and 1
    #------------------------------

        #calculting the duration
        duration=audio_segment.duration_seconds
        #calculating the rms
        rms=audio_segment.rms
        normalized_rms=rms/32768.0
        #printing the data to terminal;l
        print(f"--- AUDIO DEBUG ---")
        print(f"File: {filename}")
        print(f"Duration: {duration:.2f} seconds")
        print(f"Volume (RMS): {rms}")
        print(f"Normalized Vol: {normalized_rms:.4f}")
        print(f"-------------------")
        #to calculate word per minute
        r=sr.Recognizer()
        try:
            with sr.AudioFile(filepath) as source:
                audio_data = r.record(source)
                text=r.recognize_google(audio_data)
                filler_count = get_filler_count(text)
                words=text.split()
                word_count=len(words)
        except sr.UnknownValueError:
            #This happens if the audio is silent or just noise
            text="[No speech detected]"
            word_count=0
            filler_count=0
        except sr.RequestError:
            #if the internet is down for google api
            text="[Transcription service unavailable]"
            word_count=0
            filler_count=0
        
        wpm=(word_count/duration)*60 if duration > 0 else 0
        print(f"Transcript:{text}")
        print(f"Word Count:{word_count}")
        print(f"Calculated WPM: {wpm}")
        print(f"Fillers found: {filler_count}")
        #to calculate silence ratio
        silences=detect_silence(audio_segment,min_silence_len=500,silence_thresh=-40)
        total_silence_ms =0
        for start,end in silences:
            total_silence_ms+=(end-start)
        total_duration_ms=len(audio_segment)#auto give in ms , no conversion nedded like duration but can use duration if want
        silence_ratio=total_silence_ms/total_duration_ms if total_duration_ms>0 else 0
        conn=sqlite3.connect('adhd_app.db')
        cursor=conn.cursor()
        query1="INSERT INTO speech_analysis (assessment_id, duration, rms ,wpm, transcript, silence_ratio, filler_count, gemini_report) VALUES (?,?,?,?,?,?,?,?)"
        cursor.execute(query1,(assessment_id,duration,normalized_rms,wpm,text,silence_ratio,filler_count,"Processing..."))        
        conn.commit()#update later not insert cuase it's easier and maintain data integrity
        conn.close() # we are not inserting at the end since if the server crashes so we are not left with nothing so we do save the data we get step by step
    except Exception as e:
        print(f"Pydub Conveersion Error:{e}")
        return jsonify({"error":"Audi conversion failed"}), 500
    # getting the clinical report from gemini
    try:
        #upload the file to google's servers
        audio_data_file=genai.upload_file(path=filepath)#filepath is the path to the .wav file
    
        prompt="""
           You are a clinical assistant. Analyze this audio for ADHD markers:
           1. Tangentiality: Did they stay on topic?
           2. Pacing: Is the speech cluttered or has long pauses?
           3. Fillers: Excessive 'ums' or 'ahs'?
           Provide a 2-sentence clinical observation.
        """
    
        # Geneate the response
        result=model.generate_content([prompt,audio_data_file])
        analysis_text=result.text
    
        #Updating the database
        conn=sqlite3.connect('adhd_app.db')
        try:
           cursor=conn.cursor()
           query2="UPDATE speech_analysis SET gemini_report = ? WHERE assessment_id = ?"
           cursor.execute(query2,(analysis_text,assessment_id))
    
           conn.commit()
        finally:
           conn.close()
    
        #Cleanup: Delete from Gemini's Cloud
        audio_data_file.delete()
        return jsonify({"status": "success", "assessment_id": assessment_id})
    except Exception as e:
        print(f"Gemini Error: {e}")
        return jsonify({"error": "AI Analysis failed"}), 500

#-----------------------

#Final report
@app.route('/final_report', methods=['POST'])
def final_report():
    assessment_id=session.get('current_assessment_id')
    if not assessment_id:
        return jsonify({"error":"No active session found. Please start over."}), 400
    
    #recieve puzzle data from frontend
    data=request.json
    rt_list=data.get('reactionTimes',[])
    memory_score=data.get('memoryScore',0)
    stroop_score=data.get('stroopScore',0)

    if len(rt_list) >1:
        rt_array=np.array(rt_list)
        variability=np.std(rt_array,ddof=1)#byfeault uses poulation std , but for small data sample std is better which stastistics library uses,so ddof=1
    else:
        variability=0.0
    
    #UDATING THE COGNITIVE RESULTS
    try:
        conn=sqlite3.connect('adhd_app.db')
        cursor=conn.cursor()

        query3="UPDATE cognitive_results SET variability = ?,memory_score = ?,stroop_score = ? WHERE assessment_id = ?"
        cursor.execute(query3,(variability,memory_score,stroop_score,assessment_id))
        conn.commit()
        conn.close()

        #to clear the session
        session.pop('current_assessment_id',None)
        return jsonify({"status": "success", "message": "Final report generated"})

    except Exception as e:
        print(f"Databse Eroor: {e}")
        return jsonify({"error":"Could not save final score"}), 500 
    
if __name__ == '__main__':
    app.run(debug=True)