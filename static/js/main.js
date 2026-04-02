let currentPhase = 0;
let trialCount = 0;
const MAX_TRIALS = 5; 
const MEM_TRIALS = 3;

let results = {
    reactionTimes: [],
    memoryScores: [],
    stroopScore: 0,
    assessment_id: null
};

const phases = ['reaction', 'memory', 'stroop', 'voice', 'report'];
const container = document.getElementById('game-container');
const nextBtn = document.getElementById('next-btn');
const controlDiv = document.getElementById('controls');

function nextPhase() {
    currentPhase++;
    document.getElementById('progress-fill').style.width = (currentPhase / (phases.length - 1)) * 100 + "%";
    controlDiv.classList.add('hidden'); // Lock button
    
    const phaseName = phases[currentPhase-1];
    if (phaseName === 'reaction') startReactionTest();
    else if (phaseName === 'memory') startMemoryTest();
    else if (phaseName === 'stroop') startStroopTest();
    else if (phaseName === 'voice') startVoiceRecording();
    else if (phaseName === 'report') showFinalReport();
}

function showNextButton(text) {
    nextBtn.innerText = text;
    controlDiv.classList.remove('hidden');
}

// --- REACTION (5 Trials) ---
function startReactionTest() {
    if (trialCount < MAX_TRIALS) {
        container.innerHTML = `<h3>Reaction Test (${trialCount + 1}/${MAX_TRIALS})</h3><p>Wait for <b>GREEN</b></p>
                               <div id="click-zone" class="reaction-box">Wait...</div>`;
        const zone = document.getElementById('click-zone');
        setTimeout(() => {
            zone.classList.add('active');
            zone.innerText = "CLICK!";
            const startTime = Date.now();
            zone.onclick = () => {
                results.reactionTimes.push(Date.now() - startTime);
                trialCount++;
                startReactionTest();
            };
        }, Math.random() * 2000 + 1500);
    } else {
        container.innerHTML = `<h3>Reaction Test Complete</h3><p>Click below to continue.</p>`;
        trialCount = 0;
        showNextButton("Continue to Memory Task →");
    }
}

// --- MEMORY (3 Trials) ---
function startMemoryTest() {
    if (trialCount < MEM_TRIALS) {
        const sequence = Array.from({length: 6 + trialCount}, () => Math.floor(Math.random() * 10)).join('');
        container.innerHTML = `<h3>Memory Test (${trialCount + 1}/${MEM_TRIALS})</h3><h1 class="mem-text">${sequence}</h1>`;
        setTimeout(() => {
            container.innerHTML = `<h3>Recall Sequence:</h3><input type="number" id="mem-input" class="modern-input">
                                   <button onclick="checkMemory('${sequence}')" class="btn-primary">Submit</button>`;
        }, 3000);
    } else {
        container.innerHTML = `<h3>Memory Phase Complete</h3>`;
        trialCount = 0;
        showNextButton("Continue to Stroop Task →");
    }
}

function checkMemory(correct) {
    const input = document.getElementById('mem-input').value;
    let matches = 0;
    for(let i=0; i<correct.length; i++) { if(input[i] === correct[i]) matches++; }
    results.memoryScores.push((matches / correct.length) * 100);
    trialCount++;
    startMemoryTest();
}

// --- STROOP (5 Trials) ---
function startStroopTest() {
    if (trialCount < MAX_TRIALS) {
        const colors = [{n:'Red', h:'#ff4d4d'}, {n:'Green', h:'#2ecc71'}, {n:'Blue', h:'#3498db'}, {n:'Yellow', h:'#f1c40f'}];
        const target = colors[Math.floor(Math.random() * colors.length)];
        const text = colors[Math.floor(Math.random() * colors.length)].n;
        container.innerHTML = `<h3>Stroop Test (${trialCount+1}/${MAX_TRIALS})</h3><p>Select the <b>COLOR</b> of the word:</p>
                               <div class="stroop-word" style="color: ${target.h}">${text}</div>
                               <div class="btn-grid">${colors.map(c => `<button class="stroop-btn" onclick="handleStroop('${c.n}', '${target.n}')">${c.n}</button>`).join('')}</div>`;
    } else {
        container.innerHTML = `<h3>Cognitive Tasks Finished</h3>`;
        trialCount = 0;
        showNextButton("Continue to Voice Analysis →");
    }
}

function handleStroop(chosen, correct) {
    if(chosen === correct) results.stroopScore += (100 / MAX_TRIALS);
    trialCount++;
    startStroopTest();
}

// --- VOICE ---
let mediaRecorder;
let audioChunks = [];

async function startVoiceRecording() {
    container.innerHTML = `<h3>Voice Analysis</h3><p>Describe your routine for 10 seconds.</p>
                           <button id="rec-btn" class="btn-primary">Start Recording</button><p id="status-log"></p>`;
    const recBtn = document.getElementById('rec-btn');
    const log = document.getElementById('status-log');

    recBtn.onclick = async () => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                log.innerText = "Processing Speech...";
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log(`Console: Blob Size: ${(audioBlob.size / 1024).toFixed(2)} KB`);
                const formData = new FormData();
                formData.append('audio_data', audioBlob);
                const response = await fetch('/analyze_audio', { method: 'POST', body: formData });
                const data = await response.json();
                results.assessment_id = data.assessment_id;
                showNextButton("Generate Final Results ⚡");
            };
            mediaRecorder.start();
            recBtn.innerText = "Stop Recording";
        } else {
            mediaRecorder.stop();
            recBtn.innerText = "Analyzing...";
        }
    };
}

// --- REPORT ---
async function showFinalReport() {
    container.innerHTML = `<h3>Finalizing Report...</h3>`;
    const avgMemory = results.memoryScores.reduce((a,b)=>a+b, 0) / MEM_TRIALS;

    await fetch('/final_report', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...results, memoryScore: avgMemory})
    });

    const resp = await fetch(`/get_results/${results.assessment_id}`);
    const res = await resp.json();
    const d = res.data;

    controlDiv.innerHTML = ""; // Clear button div

    container.innerHTML = `
        <div style="height: 250px; display: flex; justify-content: center; margin-bottom: 20px;"><canvas id="resultsChart"></canvas></div>
        
        <div class="report-section">
            <h4 class="section-title">Speech Analysis</h4>
            <div class="report-grid">
                <div class="card"><h5>WPM</h5><p>${d.wpm.toFixed(0)}</p><span>Norm: 130-160</span></div>
                <div class="card"><h5>Fillers</h5><p>${d.filler_count}</p><span>Norm: < 3</span></div>
                <div class="card"><h5>Silence</h5><p>${(d.silence_ratio*100).toFixed(1)}%</p><span>Norm: < 20%</span></div>
            </div>
            <div class="ai-box" style="margin-top: 10px; padding: 12px;"><b>Voice Insight:</b> ${d.gemini_report}</div>
        </div>

        <div class="report-section">
            <h4 class="section-title">Cognitive Metrics</h4>
            <div class="report-grid">
                <div class="card"><h5>Memory</h5><p>${d.memory_score.toFixed(0)}%</p></div>
                <div class="card"><h5>Inhibition</h5><p>${d.stroop_score.toFixed(0)}%</p></div>
                <div class="card"><h5>Variability</h5><p>${d.variability.toFixed(0)}ms</p></div>
            </div>
        </div>

        <div class="ai-box"><h4>Full Clinical Summary</h4><p>${d.final_clinical_summary}</p></div>
        <button onclick="window.location.href='/start_new_test'" class="btn-reset-large">Restart Assessment</button>
    `;

    new Chart(document.getElementById('resultsChart').getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['Memory', 'Focus', 'Stability', 'Fluidity', 'Pacing'],
            datasets: [{
                data: [d.memory_score, d.stroop_score, Math.max(100-(d.variability/5),0), (1-d.silence_ratio)*100, Math.min((d.wpm/150)*100, 100)],
                backgroundColor: 'rgba(99, 102, 241, 0.2)', borderColor: '#6366f1', borderWidth: 2
            }]
        },
        options: { scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.1)' } } }, plugins: { legend: { display: false } } }
    });
}