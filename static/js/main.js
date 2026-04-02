//for headmovement
// --- PIECE 1: THE AI BRAIN SETUP ---
// --- FIX PIECE 1: THE AI BRAIN SETUP ---
let faceLandmarker;
let video;

// --- FINAL FIX FOR SETUP ---
async function setupFaceAI() {
    while (!window.tasksVision) {
        console.log("❌ Waiting for MediaPipe...");
        await new Promise(r => setTimeout(r, 300));
    }

    console.log("✅ MediaPipe loaded!");

    const mpTasks = window.tasksVision;

    const filesetResolver = await mpTasks.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );

    faceLandmarker = await mpTasks.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1
    });

    console.log("🧠 AI Brain is Loaded!");
}

//-------------
let currentPhase = 0;
let trialCount = 0;
const MAX_TRIALS = 5; 
const MEM_TRIALS = 3;
let results = { reactionTimes: [], memoryScores: [], stroopScore: 0, assessment_id: null };

const phases = ['reaction', 'memory', 'stroop', 'voice', 'report'];
const container = document.getElementById('game-container');
const nextBtn = document.getElementById('next-btn');
const controlDiv = document.getElementById('controls');

function nextPhase() {
    currentPhase++;
    document.getElementById('progress-fill').style.width = (currentPhase / (phases.length - 1)) * 100 + "%";
    controlDiv.classList.add('hidden');
    const phaseName = phases[currentPhase-1];
    if (phaseName === 'reaction') startReactionTest();
    else if (phaseName === 'memory') startMemoryTest();
    else if (phaseName === 'stroop') startStroopTest();
    else if (phaseName === 'voice') startVoiceRecording();
    else if (phaseName === 'report') showFinalReport();
}

function showNextButton(text) { nextBtn.innerText = text; controlDiv.classList.remove('hidden'); }

// --- REACTION (With Penalty) ---
function startReactionTest() {
    // --- PIECE 2: START THE WEBCAM ---
    video = document.getElementById("webcam");

    navigator.mediaDevices.getUserMedia({ video: true }).then(async (stream) => {
        video.srcObject = stream;

        await setupFaceAI();   // ✅ WAIT for AI
        predictWebcam();       // ✅ THEN start detection
    });

    // (rest of your reaction code stays SAME)

    if (trialCount < MAX_TRIALS) {
        container.innerHTML = `<h3>Reaction Test (${trialCount + 1}/${MAX_TRIALS})</h3><p>Wait for <b>GREEN</b></p><div id="click-zone" class="reaction-box">Wait...</div>`;
        const zone = document.getElementById('click-zone');
        let isGreen = false;
        let timer = setTimeout(() => {
            isGreen = true;
            zone.classList.add('active'); zone.innerText = "CLICK!";
            zone.startTime = Date.now();
        }, Math.random() * 2000 + 1500);

        zone.onclick = () => {
            if (!isGreen) {
                clearTimeout(timer);
                zone.classList.add('penalty'); zone.innerText = "TOO EARLY! (+500ms)";
                results.reactionTimes.push(1500); // Heavy penalty for the average/SD
                setTimeout(() => { trialCount++; startReactionTest(); }, 1000);
            } else {
                results.reactionTimes.push(Date.now() - zone.startTime);
                trialCount++; startReactionTest();
            }
        };
    } else {
        container.innerHTML = `<h3>Reaction Captured</h3>`; trialCount = 0; showNextButton("Continue to Memory Task →");
    }
}

// --- MEMORY ---
function startMemoryTest() {
    if (trialCount < MEM_TRIALS) {
        const sequence = Array.from({length: 6 + trialCount}, () => Math.floor(Math.random() * 10)).join('');
        container.innerHTML = `<h3>Memory (${trialCount + 1}/${MEM_TRIALS})</h3><h1 class="mem-text">${sequence}</h1>`;
        setTimeout(() => {
            container.innerHTML = `<h3>Recall:</h3><input type="number" id="mem-input" class="modern-input"><button onclick="checkMemory('${sequence}')" class="btn-primary">Submit</button>`;
        }, 3000);
    } else { container.innerHTML = `<h3>Memory Captured</h3>`; trialCount = 0; showNextButton("Continue to Stroop →"); }
}
function checkMemory(correct) {
    const input = document.getElementById('mem-input').value;
    let matches = 0;
    for(let i=0; i<correct.length; i++) { if(input[i] === correct[i]) matches++; }
    results.memoryScores.push((matches / correct.length) * 100);
    trialCount++; startMemoryTest();
}

// --- STROOP ---
function startStroopTest() {
    if (trialCount < MAX_TRIALS) {
        const colors = [{n:'Red', h:'#ff4d4d'}, {n:'Green', h:'#2ecc71'}, {n:'Blue', h:'#3498db'}, {n:'Yellow', h:'#f1c40f'}];
        const target = colors[Math.floor(Math.random() * colors.length)];
        const text = colors[Math.floor(Math.random() * colors.length)].n;
        container.innerHTML = `<h3>Stroop (${trialCount+1}/${MAX_TRIALS})</h3><p>Tap word <b>COLOR</b>:</p><div class="stroop-word" style="color: ${target.h}">${text}</div><div class="btn-grid">${colors.map(c => `<button class="stroop-btn" onclick="handleStroop('${c.n}', '${target.n}')">${c.n}</button>`).join('')}</div>`;
    } else { container.innerHTML = `<h3>Puzzles Finished</h3>`; trialCount = 0; showNextButton("Continue to Voice →"); }
}
function handleStroop(chosen, correct) { if(chosen === correct) results.stroopScore += (100 / MAX_TRIALS); trialCount++; startStroopTest(); }

// --- VOICE (With Lock) ---
function startVoiceRecording() {
    container.innerHTML = `<h3>Voice Analysis</h3><p>Describe your routine for 10 seconds.</p><button id="rec-btn" class="btn-primary">Start Recording</button><p id="status-log"></p>`;
    const recBtn = document.getElementById('rec-btn');
    const log = document.getElementById('status-log');
    
    recBtn.onclick = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        let audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        
        mediaRecorder.onstop = async () => {
            recBtn.disabled = true; // Lock the button
            recBtn.innerText = "Processing...";
            log.innerText = "Uploading audio to AI...";
            
            const formData = new FormData();
            formData.append('audio_data', new Blob(audioChunks, { type: 'audio/webm' }));
            const resp = await fetch('/analyze_audio', { method: 'POST', body: formData });
            const data = await resp.json();
            results.assessment_id = data.assessment_id;
            showNextButton("Generate Report ⚡");
        };
        
        mediaRecorder.start();
        recBtn.innerText = "Stop Recording";
        recBtn.onclick = () => { if(mediaRecorder.state === "recording") mediaRecorder.stop(); };
    };
}

// --- REPORT ---
async function showFinalReport() {
    container.innerHTML = `<h3>Compiling Full Report...</h3>`;
    const avgMemory = results.memoryScores.reduce((a,b)=>a+b, 0) / MEM_TRIALS;
    await fetch('/final_report', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...results, memoryScore: avgMemory}) });
    const resp = await fetch(`/get_results/${results.assessment_id}`);
    const res = await resp.json(); const d = res.data;
    controlDiv.innerHTML = "";

    container.innerHTML = `
        <div class="chart-wrapper"><canvas id="resultsChart"></canvas></div>
        <div class="report-section"><h4 class="section-title">Speech Analysis</h4>
            <div class="report-grid">
                <div class="card"><h5>WPM</h5><p>${d.wpm.toFixed(0)}</p><span>Norm: 130-160</span></div>
                <div class="card"><h5>Fillers</h5><p>${d.filler_count}</p><span>Norm: < 3</span></div>
                <div class="card"><h5>Silence</h5><p>${(d.silence_ratio*100).toFixed(1)}%</p><span>Norm: < 20%</span></div>
            </div>
            <div class="ai-box"><b>Voice Insight:</b><div class="insight-content">${d.gemini_report}</div></div>
        </div>
        <div class="report-section"><h4 class="section-title">Cognitive Metrics</h4>
            <div class="report-grid">
                <div class="card"><h5>Memory</h5><p>${d.memory_score.toFixed(0)}%</p></div>
                <div class="card"><h5>Inhibition</h5><p>${d.stroop_score.toFixed(0)}%</p></div>
                <div class="card"><h5>Variability</h5><p>${d.variability.toFixed(0)}ms</p></div>
            </div>
        </div>
        <div class="ai-box"><h4>Screening Summary</h4><p style="white-space: pre-line;">${d.final_clinical_summary}</p></div>
        <button onclick="window.location.href='/start_new_test'" class="btn-reset-large">Restart Assessment</button>
    `;

    new Chart(document.getElementById('resultsChart').getContext('2d'), {
        type: 'radar', data: { labels: ['Memory', 'Focus', 'Stability', 'Fluidity', 'Pacing'], 
        datasets: [{ data: [d.memory_score, d.stroop_score, Math.max(100-(d.variability/5),0), (1-d.silence_ratio)*100, Math.min((d.wpm/150)*100, 100)], backgroundColor: 'rgba(99, 102, 241, 0.2)', borderColor: '#6366f1', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.1)' } } }, plugins: { legend: { display: false } } }
    });
}

// --- PIECE 3: THE WATCHER LOOP ---
// --- FIX PIECE 3: THE WATCHER LOOP ---
async function predictWebcam() {
    // Check if the brain is actually loaded yet
    if (!faceLandmarker) {
        window.requestAnimationFrame(predictWebcam);
        return; 
    }

    let startTimeMs = performance.now();
    
    // We only try to detect if the video is actually playing
    if (video && video.readyState >= 2) {
        const detections = faceLandmarker.detectForVideo(video, startTimeMs);

        if (detections.faceLandmarks && detections.faceLandmarks.length > 0) {
            const nose = detections.faceLandmarks[0][4]; 
            console.log("Nose X Coordinate:", nose.x.toFixed(2));
        }
    }

    window.requestAnimationFrame(predictWebcam);
}