let currentPhase = 0;
let results = {
    reactionTimes: [],
    memoryScore: 0,
    stroopScore: 0
};

const phases = ['reaction', 'memory', 'stroop', 'voice', 'report'];
const container = document.getElementById('game-container');
const nextBtn = document.getElementById('next-btn');

function updateProgress() {
    const percent = (currentPhase / (phases.length - 1)) * 100;
    document.getElementById('progress-fill').style.width = percent + "%";
}

function nextPhase() {
    currentPhase++;
    updateProgress();
    document.getElementById('controls').classList.add('hidden');
    
    switch(phases[currentPhase-1]) {
        case 'reaction': startReactionTest(); break;
        case 'memory': startMemoryTest(); break;
        case 'stroop': startStroopTest(); break;
        case 'voice': startVoiceRecording(); break;
        case 'report': showFinalReport(); break;
    }
}

// --- 1. REACTION TEST ---
function startReactionTest() {
    container.innerHTML = `<h3>Reaction Test</h3><p>Click the box as soon as it turns GREEN</p>
                           <div id="click-zone">Wait for it...</div>`;
    const zone = document.getElementById('click-zone');
    const delay = Math.random() * 3000 + 2000;
    
    setTimeout(() => {
        zone.style.background = "#22c55e";
        zone.innerText = "CLICK NOW!";
        const startTime = Date.now();
        zone.onclick = () => {
            const rt = Date.now() - startTime;
            results.reactionTimes.push(rt);
            zone.innerHTML = `Reaction: ${rt}ms`;
            zone.style.background = "#6366f1";
            document.getElementById('controls').classList.remove('hidden');
            zone.onclick = null;
        };
    }, delay);
}

// --- 2. MEMORY TEST (Simple Digit Span) ---
function startMemoryTest() {
    const sequence = Array.from({length: 5}, () => Math.floor(Math.random() * 10));
    container.innerHTML = `<h3>Memory Test</h3><p>Memorize this sequence:</p><h2 id="seq-display"></h2>`;
    
    let i = 0;
    const interval = setInterval(() => {
        document.getElementById('seq-display').innerText = sequence[i];
        if(i++ >= sequence.length) {
            clearInterval(interval);
            container.innerHTML = `<h3>Enter the sequence:</h3><input type="text" id="mem-input">
                                   <button onclick="checkMemory('${sequence.join('')}')" class="btn-primary">Submit</button>`;
        }
    }, 1000);
}

function checkMemory(correct) {
    const input = document.getElementById('mem-input').value;
    results.memoryScore = (input === correct) ? 100 : 0;
    container.innerHTML = `<h3>Score Saved!</h3>`;
    document.getElementById('controls').classList.remove('hidden');
}

// --- 3. STROOP TEST ---
function startStroopTest() {
    const colors = ['Red', 'Green', 'Blue', 'Yellow'];
    const targetColor = colors[Math.floor(Math.random() * colors.length)];
    const textDisplay = colors[Math.floor(Math.random() * colors.length)];
    
    container.innerHTML = `<h3>Stroop Test</h3><p>Identify the COLOR of the word, ignore the text:</p>
                           <div class="stroop-word" style="color: ${targetColor.toLowerCase()}">${textDisplay}</div>
                           <div class="btn-grid" id="stroop-btns"></div>`;
    
    colors.forEach(c => {
        const btn = document.createElement('button');
        btn.innerText = c;
        btn.className = 'stroop-btn';
        btn.onclick = () => {
            results.stroopScore = (c === targetColor) ? 100 : 0;
            container.innerHTML = `<h3>Selection Recorded</h3>`;
            document.getElementById('controls').classList.remove('hidden');
        };
        document.getElementById('stroop-btns').appendChild(btn);
    });
}

// --- 4. VOICE RECORDING ---
let mediaRecorder;
let audioChunks = [];

async function startVoiceRecording() {
    container.innerHTML = `<h3>Voice Analysis</h3><p>Talk about your day for 5-10 seconds.</p>
                           <button id="rec-btn" class="btn-primary">Start Recording</button>
                           <p id="status-log" style="font-size: 0.8rem; color: #94a3b8;"></p>`;
    
    const recBtn = document.getElementById('rec-btn');
    const log = document.getElementById('status-log');

    recBtn.onclick = async () => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            console.log("Console: Recording Started");
            log.innerText = "Recording...";
            
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                log.innerText = "Uploading & Analyzing...";
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('audio_data', audioBlob);

                try {
                    const response = await fetch('/analyze_audio', { method: 'POST', body: formData });
                    const data = await response.json();
                    console.log("Console: Audio Upload Success", data);
                    document.getElementById('controls').classList.remove('hidden');
                    log.innerText = "Analysis Complete!";
                } catch (err) {
                    console.error("Console Error:", err);
                    log.innerText = "Error uploading audio.";
                }
            };
            mediaRecorder.start();
            recBtn.innerText = "Stop Recording";
        } else {
            mediaRecorder.stop();
            recBtn.innerText = "Processing...";
        }
    };
}

// --- 5. FINAL REPORT ---
async function showFinalReport() {
    container.innerHTML = `<h3>Final Analysis</h3><canvas id="resultsChart"></canvas><div id="gemini-report">Loading AI Insights...</div>`;
    
    // Submit scores to backend
    await fetch('/final_report', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(results)
    });

    // Simple Chart.js implementation
    const ctx = document.getElementById('resultsChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Memory', 'Stroop', 'Reaction (ms)'],
            datasets: [{
                label: 'Cognitive Score',
                data: [results.memoryScore, results.stroopScore, results.reactionTimes[0] || 0],
                backgroundColor: ['#6366f1', '#a855f7', '#ec4899']
            }]
        }
    });
}