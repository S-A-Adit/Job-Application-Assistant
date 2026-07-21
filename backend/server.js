const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadEnv } = require('./src/config/env');
const seedDatabase = require('./src/services/seedService');

// Load Environment Configuration
loadEnv();

const app = express();
const PORT = process.env.PORT || 5000;

// Global Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Routers
app.use('/api/resumes', require('./src/routes/resumes'));
app.use('/api/cover-letters', require('./src/routes/coverLetters'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/applications', require('./src/routes/applications'));
app.use('/api/learned-mappings', require('./src/routes/learnedMappings'));
app.use('/api/replays', require('./src/routes/replays'));
app.use('/api/benchmarks', require('./src/routes/benchmarks'));

// Seed Database and Start Server
seedDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`AI Job Agent Backend Server running on port ${PORT}`);
  });
});
