import google.generativeai as genai
import os
import sqlite3
import time
from flask import Flask, render_template, request, jsonify, session
from dotenv import load_dotenv
import wave # for sound to use wav file ratheer mp3
import numpy as np #for rms

# to load api keys
load_dotenv()

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
    filename=f"rec_{int(time.time())}.wav"
    filepath=os.path.join(app.config['UPLOAD_FOLDER'],filename)
    audio_file.save(filepath)
    #calculate the duration
    with wave.open(filepath,'rb') as wf:
        frames=wf.getnframes() #total number of frames
        rate=wf.getframerate()#frame peersecond
        duration=frames/float(rate)
    
    #calculate rms(root mean square)
    with wave.open(filepath,'rb') as wf:
        raw_data=wf.readframes(wf.getnframes())#read all frames as bytes
        audio_samples=np.frombuffer(raw_data, dtype=np.int16)#conver bytes into list of numbers
    
    rms=np.sqrt(np.mean(audio_samples**2))
    normalized_rms=rms/32768.0 #raw rms can be huge so by 32768 to get a decimal between 0 and 1
    
    
    conn=sqlite3.connect('adhd_app.db')
    cursor=conn.cursor()
    query1="INSERT INTO speech_analysis (assessment_id, duration, rms ,gemini_report) VALUES (?,?,?,?)"
    cursor.execute(query1,(assessment_id,duration,normalized_rms,"Processing..."))
    
    conn.commit()#update later not insert cuase it's easier and maintain data integrity
    conn.close() # we are not inserting at the end since if the server crashes so we are not left with nothing so we do save the data we get step by step
    
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
        cursor=conn.cursor()
        query2="UPDATE speech_analysis SET gemini_report = ? WHERE assessment_id = ?"
        cursor.execute(query2,(analysis_text,assessment_id))
    
        conn.commit()
        conn.close()
    
        #Cleanup: Delete from Gemini's Cloud
        audio_data_file.delete()
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

    except Exception as e:
        print(f"Databse Eroor: {e}")
        return jsonify({"error":"Could not save final score"}), 500 