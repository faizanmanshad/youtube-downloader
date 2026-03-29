const fetchBtn = document.getElementById('fetchBtn');
const clearBtn = document.getElementById('clearBtn');
const videoUrlInput = document.getElementById('videoUrl');
const fetchLoading = document.getElementById('fetchLoading');
const previewSection = document.getElementById('previewSection');
const playerContainer = document.getElementById('playerContainer');
const videoTitle = document.getElementById('videoTitle');
const channelName = document.getElementById('channelName');
const videoDuration = document.getElementById('videoDuration');
const videoSizeDisplay = document.getElementById('videoSize');
const qualitySelect = document.getElementById('qualitySelect');
const errorMessage = document.getElementById('errorMessage');
const downloadBtn = document.getElementById('downloadBtn');
const progressSection = document.getElementById('progressSection');
const restrictionNote = document.getElementById('restrictionNote');

let globalFormats = []; 
let currentTitle = ""; 
let globalDuration = 0; 

function performCleanSlate() {
    console.log("Initiating Clean Slate Protocol...");
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (e) {
        console.warn("Could not clear storage:", e);
    }
    try {
        const cookies = document.cookie.split("; ");
        for (let c = 0; c < cookies.length; c++) {
            const d = window.location.hostname.split(".");
            while (d.length > 0) {
                const cookieBase = encodeURIComponent(cookies[c].split(";")[0].split("=")[0]) + '=; expires=Thu, 01-Jan-1970 00:00:01 GMT; domain=' + d.join('.') + ' ;path=';
                const p = location.pathname.split('/');
                document.cookie = cookieBase + '/';
                while (p.length > 0) {
                    document.cookie = cookieBase + p.join('/');
                    p.pop();
                }
                d.shift();
            }
        }
    } catch (e) {
        console.warn("Could not clear cookies:", e);
    }
    console.log("Clean Slate Complete.");
}

window.addEventListener('DOMContentLoaded', performCleanSlate);

function formatDuration(seconds) {
    if (!seconds) return "0 sec";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins > 0 ? mins + ' min ' : ''}${secs} sec`;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return "Unknown";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

qualitySelect.addEventListener('change', () => {
    const selected = globalFormats.find(f => f.format_id === qualitySelect.value);
    if (selected) {
        let sizeBytes = selected.size;
        
        if (!sizeBytes || sizeBytes === 0) {
            const typicalBitrates = {
                144: 100,
                360: 400,
                480: 1000,
                720: 2500,
                1080: 4500
            };
            const kbps = typicalBitrates[selected.targetRes] || 1000;
            sizeBytes = (kbps * 1024 / 8) * globalDuration; 
        }

        videoSizeDisplay.innerText = `Estimated Size: ${formatSize(sizeBytes)}`;
    } else {
        videoSizeDisplay.innerText = "";
    }
});

fetchBtn.addEventListener('click', async function(e) {
    e.preventDefault(); 
    performCleanSlate();

    const url = videoUrlInput.value.trim();
    const vId = extractVideoID(url);
    
    if (!vId) return alert("Invalid YouTube URL!");

    fetchLoading.classList.remove('hidden');
    previewSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    restrictionNote.classList.add('hidden');
    errorMessage.style.display = 'none';

    try {
        const timestamp = Date.now();
        const response = await fetch(`http://localhost:5000/api/info?url=${encodeURIComponent(url)}&t=${timestamp}`, {
            cache: 'no-store' 
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errText}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        playerContainer.innerHTML = `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${vId}" frameborder="0" allowfullscreen></iframe>`;

        videoTitle.innerText = data.title;
        currentTitle = data.title;
        channelName.innerText = `By: ${data.channel}`;
        videoDuration.innerText = `Duration: ${formatDuration(data.duration)}`;
        
        globalDuration = data.duration || 0; 

        globalFormats = data.formats; 
        qualitySelect.innerHTML = '<option value="">Select Quality</option>';
        
        const targets = [144, 360, 480, 720, 1080]; 
        
        targets.forEach(res => {
            const found = data.formats.find(f => {
                // THE FIX: Check both height (landscape) AND width (portrait/shorts)
                // We also check 'format_note' which usually says "1080p" etc.
                const h = parseInt(f.resolution ? f.resolution.split('x')[1] : f.height) || 0;
                const w = parseInt(f.resolution ? f.resolution.split('x')[0] : f.width) || 0;
                const note = String(f.format_note || "").toLowerCase();
                
                return h === res || w === res || note.includes(String(res)); 
            });

            if (found) {
                found.targetRes = res; 
                const option = document.createElement('option');
                option.value = found.format_id;
                option.text = `${res}p`; 
                qualitySelect.appendChild(option);
            }
        });

        previewSection.classList.remove('hidden');
        restrictionNote.classList.remove('hidden'); 
    } catch (err) {
        errorMessage.innerText = "Fetch Error: " + err.message;
        errorMessage.style.display = 'block';
    } finally {
        fetchLoading.classList.add('hidden');
    }
});

downloadBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    e.stopPropagation(); 

    const url = videoUrlInput.value.trim();
    const formatId = qualitySelect.value;
    
    if (!formatId) return alert("Please select a quality first!");

    progressSection.classList.remove('hidden');
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    progressSection.innerHTML = `
        <div class="progress-header">
            <span id="progressPercentage">0%</span>
            <span id="downloadSpeed">Starting...</span>
        </div>
        <div class="progress-bar-bg" style="background: #000; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 10px;">
            <div class="progress-bar-fill" style="background: linear-gradient(90deg, #ff0000, #ff6666); height: 100%; width: 0%; transition: width 0.4s ease;"></div>
        </div>
        <p id="statusText" style="color: #ffcc00; font-weight: bold; text-align: center;">🚀 Processing on server...</p>
    `;
    
    const progressBarFill = document.querySelector('.progress-bar-fill');
    const statusText = document.getElementById('statusText');
    const progressPercentage = document.getElementById('progressPercentage');
    const downloadSpeed = document.getElementById('downloadSpeed');

    try {
        const timestamp = Date.now();
        const startRes = await fetch(`http://localhost:5000/api/start-download?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(formatId)}&title=${encodeURIComponent(currentTitle)}&t=${timestamp}`, {
            cache: 'no-store'
        });
        
        if (!startRes.ok) throw new Error("Backend Error");

        const startData = await startRes.json();
        
        const evtSource = new EventSource(`http://localhost:5000/api/progress?jobId=${startData.jobId}&t=${Date.now()}`);

        evtSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            if (data.status === 'error') {
                evtSource.close();
                statusText.innerText = `❌ Server Error`;
                statusText.style.color = "red";
                return;
            }

            progressBarFill.style.width = `${data.progress}%`;
            progressPercentage.innerText = `${data.progress}%`;
            downloadSpeed.innerText = data.speed;
            statusText.innerText = "⚙️ Downloading and Merging...";

            if (data.status === 'completed') {
                evtSource.close();
                
                progressBarFill.style.width = `100%`;
                progressPercentage.innerText = `100%`;
                statusText.innerText = "✅ Download Finished! Saving to your browser's default folder...";
                statusText.style.color = "#00ff00"; 
                
                const downloadUrl = `http://localhost:5000/api/serve?file=${encodeURIComponent(data.file)}&t=${Date.now()}`;
                
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = data.file; 
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        };

        evtSource.onerror = function() {
            evtSource.close();
            statusText.innerText = "❌ Lost connection to the server.";
            statusText.style.color = "red";
        };

    } catch (err) {
        statusText.innerText = `❌ Error starting download`;
        statusText.style.color = "red";
    }
});

clearBtn.addEventListener('click', function() {
    performCleanSlate();
    
    videoUrlInput.value = '';
    previewSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    restrictionNote.classList.add('hidden');
    errorMessage.style.display = 'none';
    currentTitle = "";
    videoSizeDisplay.innerText = ""; 
});