const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve the active resume
router.get('/active', async (req, res) => {
  try {
    const activeResume = await prisma.resume.findFirst({
      orderBy: { updatedAt: 'desc' }
    });
    
    if (!activeResume) {
      return res.json(null);
    }
    
    res.json({
      filename: activeResume.versionName,
      base64Data: activeResume.base64Data,
      updatedAt: activeResume.updatedAt.toISOString()
    });
  } catch (err) {
    console.error('Error fetching active resume:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Save/Upload reference resume file
router.post('/', async (req, res) => {
  try {
    const { filename, base64Data } = req.body;
    
    if (!filename || !base64Data) {
      return res.status(400).json({ error: 'Filename and base64Data are required.' });
    }

    await prisma.resume.deleteMany({});

    const newResume = await prisma.resume.create({
      data: {
        versionName: filename,
        filePath: `uploads/${filename}`,
        parsedJson: '{}',
        base64Data: base64Data
      }
    });

    res.json({
      success: true,
      resumeFile: {
        filename: newResume.versionName,
        base64Data: newResume.base64Data,
        updatedAt: newResume.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error('Error saving resume:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE: Delete active resumes
router.delete('/', async (req, res) => {
  try {
    await prisma.resume.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting resumes:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
