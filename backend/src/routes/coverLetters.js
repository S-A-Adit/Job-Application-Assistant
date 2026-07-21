const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve all cover letters
router.get('/', async (req, res) => {
  try {
    const dbLetters = await prisma.coverLetter.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    const formatted = dbLetters.map(letter => ({
      id: letter.id,
      name: letter.name,
      text: letter.text,
      analysis: letter.analysis ? JSON.parse(letter.analysis) : null
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching cover letters:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Sync/Save all cover letters
router.post('/sync', async (req, res) => {
  try {
    const { coverLetters } = req.body;

    if (!Array.isArray(coverLetters)) {
      return res.status(400).json({ error: 'Payload must contain a coverLetters array.' });
    }

    const syncedLetters = await prisma.$transaction(async (tx) => {
      await tx.coverLetter.deleteMany({});

      const inserts = coverLetters.map(letter => tx.coverLetter.create({
        data: {
          id: letter.id || undefined,
          name: letter.name,
          text: letter.text,
          analysis: letter.analysis ? JSON.stringify(letter.analysis) : null
        }
      }));

      return Promise.all(inserts);
    });

    const formatted = syncedLetters.map(letter => ({
      id: letter.id,
      name: letter.name,
      text: letter.text,
      analysis: letter.analysis ? JSON.parse(letter.analysis) : null
    }));

    res.json({ success: true, coverLetters: formatted });
  } catch (err) {
    console.error('Error syncing cover letters:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
