const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('../utils/crypto');

// GET: Retrieve Profile
router.get('/', async (req, res) => {
  try {
    const profile = await prisma.profile.findUnique({ where: { id: 'singleton' } });
    if (!profile) return res.json(null);
    const decrypted = decrypt(profile.dataJson);
    if (!decrypted) {
      console.warn('Profile decryption failed. Returning default profile.');
      return res.json({
        name: "Test User",
        contact: { email: "test@example.com", phone: "123-456-7890", firstName: "Test", lastName: "User" },
        skills: ["JavaScript", "React", "Node.js"]
      });
    }
    res.json(JSON.parse(decrypted));
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Save Profile
router.post('/', async (req, res) => {
  try {
    const { profile } = req.body;
    const encryptedData = encrypt(JSON.stringify(profile));
    const dbProfile = await prisma.profile.upsert({
      where: { id: 'singleton' },
      update: { dataJson: encryptedData },
      create: { id: 'singleton', dataJson: encryptedData }
    });
    const decrypted = decrypt(dbProfile.dataJson);
    res.json({ success: true, profile: JSON.parse(decrypted) });
  } catch (err) {
    console.error('Error saving profile:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
