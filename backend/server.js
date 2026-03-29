const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const downloadsDir = path.join(os.tmpdir(), 'youtube-downloads-temp');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

// Absolute paths to your executables so we can run them safely from the Temp folder
const ytDlpPath = path.resolve(__dirname, 'yt-dlp.exe');
const ffmpegDir = path.resolve(__dirname); 

const activeJobs = {};

app.get('/api/info', (req, res) => {
    // 1. Remove timeout limits for analyzing massive videos
    req.setTimeout(0); 
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

    console.log(`Fetching info for: ${videoUrl}`);
    
    // 2. Add --no-cache-dir and force it to run inside the Temp directory (cwd)
    const ytDlp = spawn(ytDlpPath, ['--js-runtime', 'node', '--no-cache-dir', '--no-playlist', '-j', videoUrl], {
        cwd: downloadsDir 
    });
    
    let output = '';
    ytDlp.stdout.on('data', (data) => { output += data.toString(); });
    
    ytDlp.on('error', (err) => {
        console.error("Failed to start yt-dlp:", err);
        if (!res.headersSent) res.status(500).json({ error: 'yt-dlp executable not found.' });
    });

    ytDlp.on('close', (code) => {
        if (code !== 0 && !res.headersSent) return res.status(500).json({ error: 'Failed info fetch' });
        try {
            const metadata = JSON.parse(output);
            res.json({
                title: metadata.title,
                channel: metadata.uploader,
                duration: metadata.duration,
                id: metadata.id,
                formats: metadata.formats.filter(f => f.vcodec !== 'none').map(f => ({
                    format_id: f.format_id,
                    resolution: f.height ? f.height.toString() : 'Auto',
                    size: f.filesize || f.filesize_approx || 0
                }))
            });
        } catch (e) { 
            if (!res.headersSent) res.status(500).json({ error: 'Parsing error from yt-dlp output' }); 
        }
    });
});

app.get('/api/start-download', (req, res) => {
    const { url, formatId, title } = req.query;
    console.log(`\n--- New Download Requested ---`);

    if (!url || !formatId) return res.status(400).json({ error: 'Missing parameters' });

    const safeTitle = (title || 'video').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const jobId = Date.now().toString();
    const fileName = `${safeTitle}_${jobId}.mp4`;
    const filePath = path.join(downloadsDir, fileName);

    activeJobs[jobId] = { progress: '0', speed: 'Starting...', status: 'downloading', file: fileName };

    try {
        const downloadProcess = spawn(ytDlpPath, [
            '--js-runtime', 'node',
            '--ffmpeg-location', ffmpegDir,
            '--no-cache-dir', // Forbid local cache files
            '--newline', 
            '-f', `${formatId}+bestaudio[ext=m4a]/best`,
            '--merge-output-format', 'mp4',
            '-o', filePath,
            url
        ], {
            cwd: downloadsDir // Trap all ffmpeg temporary text files in the system Temp folder
        });

        downloadProcess.on('error', (err) => {
            activeJobs[jobId].status = 'error';
            activeJobs[jobId].speed = 'Error: ' + err.message;
        });

        const handleLogData = (data) => {
            const output = data.toString();
            const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
            const speedMatch = output.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/);

            if (progressMatch && activeJobs[jobId]) activeJobs[jobId].progress = progressMatch[1];
            if (speedMatch && activeJobs[jobId]) activeJobs[jobId].speed = speedMatch[1];
        };

        downloadProcess.stdout.on('data', handleLogData);
        downloadProcess.stderr.on('data', handleLogData);

        downloadProcess.on('close', (code) => {
            if (code === 0 && fs.existsSync(filePath)) {
                activeJobs[jobId].status = 'completed';
                activeJobs[jobId].progress = '100';
                console.log(`[Job ${jobId}] Merged successfully. Ready for browser download.`);
            } else {
                activeJobs[jobId].status = 'error';
            }
        });

        res.json({ jobId });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error: ' + err.message });
    }
});

app.get('/api/progress', (req, res) => {
    // 3. Prevent the progress bar from timing out during a 1-hour download
    req.setTimeout(0); 
    const jobId = req.query.jobId;
    if (!jobId || !activeJobs[jobId]) return res.status(404).send('Job not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const interval = setInterval(() => {
        const job = activeJobs[jobId];
        if (!job) {
            clearInterval(interval);
            return;
        }

        res.write(`data: ${JSON.stringify(job)}\n\n`);

        if (job.status === 'completed' || job.status === 'error') {
            clearInterval(interval);
            setTimeout(() => { delete activeJobs[jobId]; }, 60000); 
        }
    }, 500);
});

app.get('/api/serve', (req, res) => {
    // 4. Prevent the connection from timing out while transferring a giant 2GB file
    req.setTimeout(0); 
    const file = req.query.file;
    const filePath = path.join(downloadsDir, file);

    if (fs.existsSync(filePath)) {
        res.download(filePath, file, (err) => {
            if (!err) {
                try { fs.unlinkSync(filePath); } catch (e) {} 
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));