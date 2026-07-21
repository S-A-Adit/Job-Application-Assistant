const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve all learned mappings
router.get('/', async (req, res) => {
  try {
    const list = await prisma.learnedMapping.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(list);
  } catch (err) {
    console.error('Error fetching learned mappings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Add or update a learned mapping
router.post('/', async (req, res) => {
  try {
    const { fieldLabel, fieldName, fieldType, incorrectValue, correctValue } = req.body;
    if (!fieldLabel || !fieldName || correctValue === undefined) {
      return res.status(400).json({ error: 'fieldLabel, fieldName, and correctValue are required.' });
    }

    const existing = await prisma.learnedMapping.findFirst({
      where: { fieldLabel, fieldName }
    });

    let result;
    if (existing) {
      result = await prisma.learnedMapping.update({
        where: { id: existing.id },
        data: { fieldType, incorrectValue, correctValue }
      });
    } else {
      result = await prisma.learnedMapping.create({
        data: { fieldLabel, fieldName, fieldType, incorrectValue, correctValue }
      });
    }
    res.json({ success: true, learnedMapping: result });
  } catch (err) {
    console.error('Error saving learned mapping:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Clear all learned mappings
router.post('/clear', async (req, res) => {
  try {
    await prisma.learnedMapping.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing learned mappings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
