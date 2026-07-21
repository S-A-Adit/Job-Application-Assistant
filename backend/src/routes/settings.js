const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('../utils/crypto');

// GET: Retrieve Settings
router.get('/', async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    
    const defaultEmail = process.env.USERNAME || "";
    const defaultPassword = process.env.PASSWORD || "";

    if (!settings) {
      return res.json({
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
        GEMINI_MODEL: "gemini-2.5-flash",
        DEFAULT_PORTAL_EMAIL: defaultEmail,
        DEFAULT_PORTAL_PASSWORD: defaultPassword
      });
    }
    const decrypted = decrypt(settings.dataJson);
    let parsed = null;
    if (decrypted) {
      try {
        parsed = JSON.parse(decrypted);
      } catch (e) {
        console.error('Failed to parse settings JSON:', e);
      }
    }

    if (!parsed) {
      console.warn('Settings decryption or parsing failed. Using default settings.');
      parsed = {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
        GEMINI_MODEL: "gemini-2.5-flash",
        DEFAULT_PORTAL_EMAIL: defaultEmail,
        DEFAULT_PORTAL_PASSWORD: defaultPassword
      };
    }
    
    if (process.env.USERNAME) {
      parsed.DEFAULT_PORTAL_EMAIL = process.env.USERNAME;
    } else if (!parsed.DEFAULT_PORTAL_EMAIL) {
      parsed.DEFAULT_PORTAL_EMAIL = defaultEmail;
    }
    
    if (process.env.PASSWORD) {
      parsed.DEFAULT_PORTAL_PASSWORD = process.env.PASSWORD;
    } else if (!parsed.DEFAULT_PORTAL_PASSWORD) {
      parsed.DEFAULT_PORTAL_PASSWORD = defaultPassword;
    }
    
    res.json(parsed);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Save Settings
router.post('/', async (req, res) => {
  try {
    const { settings } = req.body;
    const encryptedData = encrypt(JSON.stringify(settings));
    const dbSettings = await prisma.settings.upsert({
      where: { id: 'singleton' },
      update: { dataJson: encryptedData },
      create: { id: 'singleton', dataJson: encryptedData }
    });
    const decrypted = decrypt(dbSettings.dataJson);
    res.json({ success: true, settings: JSON.parse(decrypted) });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
