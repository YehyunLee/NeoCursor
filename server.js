const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// MediaPipe face_mesh: serve from npm package (has both SIMD and non-SIMD WASM)
app.use('/mediapipe/face_mesh', express.static(
  path.join(__dirname, 'node_modules', '@mediapipe', 'face_mesh')
));

// Serve static files from root directory
app.use(express.static(__dirname));

// Explicitly serve node_modules
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const fs = require('fs');
const startupLog = path.join(__dirname, 'silentcursor-startup.log');
const server = app.listen(PORT, () => {
  const msg = `Server running at http://localhost:${PORT}`;
  try { fs.appendFileSync(startupLog, `[${new Date().toISOString()}] ${msg}\n`); } catch (_) {}
  process.stderr.write(`[SilentCursor] ${msg}\n`);
});

module.exports = server;
