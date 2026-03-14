const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from root directory
app.use(express.static(__dirname));

// Explicitly serve node_modules
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = server;
