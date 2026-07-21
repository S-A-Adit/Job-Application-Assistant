const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve all replay sessions
router.get('/', async (req, res) => {
  try {
    const replays = await prisma.replaySession.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(replays);
  } catch (err) {
    console.error('Error fetching replays:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET: Retrieve a single replay session by ID
router.get('/:id', async (req, res) => {
  try {
    const replay = await prisma.replaySession.findUnique({
      where: { id: req.params.id }
    });
    if (!replay) {
      return res.status(404).json({ error: 'Replay session not found' });
    }
    res.json(replay);
  } catch (err) {
    console.error('Error fetching replay detail:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Save a new replay failure session
router.post('/', async (req, res) => {
  try {
    const { url, company, role, domSnapshot, actionHistory, consoleLogs, formState } = req.body;
    
    if (!url || !company || !role) {
      return res.status(400).json({ error: 'url, company, and role are required.' });
    }

    const replay = await prisma.replaySession.create({
      data: {
        url,
        company,
        role,
        domSnapshot: typeof domSnapshot === 'string' ? domSnapshot : JSON.stringify(domSnapshot),
        actionHistory: typeof actionHistory === 'string' ? actionHistory : JSON.stringify(actionHistory),
        consoleLogs: typeof consoleLogs === 'string' ? consoleLogs : JSON.stringify(consoleLogs),
        formState: typeof formState === 'string' ? formState : JSON.stringify(formState)
      }
    });

    res.json({ success: true, replay });
  } catch (err) {
    console.error('Error saving replay snapshot:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE: Delete a replay session by ID
router.delete('/:id', async (req, res) => {
  try {
    await prisma.replaySession.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting replay:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
