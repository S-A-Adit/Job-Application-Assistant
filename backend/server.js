const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const dotenvPath = fs.existsSync(path.join(__dirname, '../../.env')) 
  ? path.join(__dirname, '../../.env') 
  : (fs.existsSync(path.join(__dirname, '../.env')) ? path.join(__dirname, '../.env') : path.join(__dirname, '.env'));
const envConfig = require('dotenv').config({ path: dotenvPath });
if (envConfig.parsed && envConfig.parsed.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = envConfig.parsed.GEMINI_API_KEY;
}
if (envConfig.parsed && envConfig.parsed.PASSWORD) {
  process.env.PASSWORD = envConfig.parsed.PASSWORD;
}
if (envConfig.parsed && envConfig.parsed.USERNAME) {
  process.env.USERNAME = envConfig.parsed.USERNAME;
}

const app = express();
const PORT = process.env.PORT || 5000;
const prisma = new PrismaClient();

// --- CREDENTIALS ENCRYPTION HELPERS ---
const crypto = require('crypto');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SECRET_KEY_SEED = process.env.PASSWORD || process.env.ENCRYPTION_SECRET || 'ai-job-agent-default-secret-seed-value';
const ENCRYPTION_KEY = crypto.scryptSync(SECRET_KEY_SEED, 'salt-job-agent', 32);

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText; // Fallback for legacy plain text data
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt data, returning null:', err.message);
    return null;
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large resume base64 uploads
app.use(express.static(path.join(__dirname, 'public')));


// --- RESUMES API ---

// GET: Retrieve the active resume (the most recently updated one)
app.get('/api/resumes/active', async (req, res) => {
  try {
    const activeResume = await prisma.resume.findFirst({
      orderBy: { updatedAt: 'desc' }
    });
    
    if (!activeResume) {
      return res.json(null);
    }
    
    // Format JSON response to match extension's expected schema
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
app.post('/api/resumes', async (req, res) => {
  try {
    const { filename, base64Data } = req.body;
    
    if (!filename || !base64Data) {
      return res.status(400).json({ error: 'Filename and base64Data are required.' });
    }

    // Clear existing reference documents to replace with the most recent one
    await prisma.resume.deleteMany({});

    const newResume = await prisma.resume.create({
      data: {
        versionName: filename,
        filePath: `uploads/${filename}`,
        parsedJson: '{}', // Default parsed json structure
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
app.delete('/api/resumes', async (req, res) => {
  try {
    await prisma.resume.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting resumes:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- COVER LETTERS API ---

// GET: Retrieve all cover letters
app.get('/api/cover-letters', async (req, res) => {
  try {
    const dbLetters = await prisma.coverLetter.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    // Map database entries to match extension schema
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

// POST: Sync/Save all cover letters (overwrites database with sync catalog)
app.post('/api/cover-letters/sync', async (req, res) => {
  try {
    const { coverLetters } = req.body;

    if (!Array.isArray(coverLetters)) {
      return res.status(400).json({ error: 'Payload must contain a coverLetters array.' });
    }

    // Wrap in a transaction to safely clean and replace
    const syncedLetters = await prisma.$transaction(async (tx) => {
      // 1. Clear database cover letters
      await tx.coverLetter.deleteMany({});

      // 2. Insert new list
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

    // Map back to extension schema
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

// GET: Retrieve Profile
app.get('/api/profile', async (req, res) => {
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
app.post('/api/profile', async (req, res) => {
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

// GET: Retrieve Settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    
    const defaultEmail = (envConfig.parsed && envConfig.parsed.USERNAME) || process.env.USERNAME || "";
    const defaultPassword = (envConfig.parsed && envConfig.parsed.PASSWORD) || process.env.PASSWORD || "";

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
    
    if (envConfig.parsed && envConfig.parsed.USERNAME) {
      parsed.DEFAULT_PORTAL_EMAIL = envConfig.parsed.USERNAME;
    } else if (!parsed.DEFAULT_PORTAL_EMAIL) {
      parsed.DEFAULT_PORTAL_EMAIL = defaultEmail;
    }
    
    if (envConfig.parsed && envConfig.parsed.PASSWORD) {
      parsed.DEFAULT_PORTAL_PASSWORD = envConfig.parsed.PASSWORD;
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
app.post('/api/settings', async (req, res) => {
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

// GET: Retrieve Applications
app.get('/api/applications', async (req, res) => {
  try {
    const list = await prisma.application.findMany({
      orderBy: { createdAt: 'desc' }
    });
    const formatted = list.map(app => ({
      id: app.id,
      company: app.company,
      role: app.role,
      url: app.url,
      status: app.status,
      notes: app.notes,
      createdAt: app.createdAt.toISOString()
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Error fetching applications:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Sync/Overwrite Applications
app.post('/api/applications/sync', async (req, res) => {
  try {
    const { applications } = req.body;
    if (!Array.isArray(applications)) {
      return res.status(400).json({ error: 'Applications array is required.' });
    }

    // Filter out duplicate URLs to prevent database unique constraint failures
    const uniqueAppsMap = new Map();
    for (const app of applications) {
      if (app.url) {
        uniqueAppsMap.set(app.url, app);
      }
    }
    const uniqueApps = Array.from(uniqueAppsMap.values());

    const syncedApps = await prisma.$transaction(async (tx) => {
      // Clear database applications
      await tx.applicationDraft.deleteMany({});
      await tx.application.deleteMany({});

      // Insert new applications
      const inserts = uniqueApps.map(app => tx.application.create({
        data: {
          id: app.id || undefined,
          company: app.company,
          role: app.role,
          url: app.url,
          status: app.status,
          notes: app.notes,
          createdAt: app.createdAt ? new Date(app.createdAt) : new Date()
        }
      }));

      return Promise.all(inserts);
    });

    const formatted = syncedApps.map(app => ({
      id: app.id,
      company: app.company,
      role: app.role,
      url: app.url,
      status: app.status,
      notes: app.notes,
      createdAt: app.createdAt.toISOString()
    }));

    res.json({ success: true, applications: formatted });
  } catch (err) {
    console.error('Error syncing applications:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- LEARNED MAPPINGS API ---

// GET: Retrieve all learned mappings
app.get('/api/learned-mappings', async (req, res) => {
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
app.post('/api/learned-mappings', async (req, res) => {
  try {
    const { fieldLabel, fieldName, fieldType, incorrectValue, correctValue } = req.body;
    if (!fieldLabel || !fieldName || correctValue === undefined) {
      return res.status(400).json({ error: 'fieldLabel, fieldName, and correctValue are required.' });
    }

    // Find if there is an existing mapping for the exact label and name
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
app.post('/api/learned-mappings/clear', async (req, res) => {
  try {
    await prisma.learnedMapping.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing learned mappings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- REPLAY SESSIONS API ---

// GET: Retrieve all replay sessions
app.get('/api/replays', async (req, res) => {
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
app.get('/api/replays/:id', async (req, res) => {
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
app.post('/api/replays', async (req, res) => {
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
app.delete('/api/replays/:id', async (req, res) => {
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


// --- BENCHMARK API ---

// GET: Retrieve all benchmark sessions
app.get('/api/benchmarks', async (req, res) => {
  try {
    const benchmarks = await prisma.benchmarkSession.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(benchmarks);
  } catch (err) {
    console.error('Error fetching benchmarks:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET: Retrieve latest benchmark report (aggregated)
app.get('/api/benchmarks/report', async (req, res) => {
  try {
    const allSessions = await prisma.benchmarkSession.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    if (allSessions.length === 0) {
      return res.json({ latest: null, previous: null, historical: null, sessions: [] });
    }

    // Enrich each session with derived skipRate and errorRate
    const sessions = allSessions.map(s => {
      const skipRate  = s.totalFields > 0 ? (s.failedFields / s.totalFields) : 0;
      const errorRate = s.totalFields > 0 ? Math.max(0, (s.totalFields - s.passedFields - s.failedFields) / s.totalFields) : 0;
      return { ...s, skipRate, errorRate };
    });

    const latest   = sessions[sessions.length - 1];
    const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null;

    const avg = (key) => sessions.reduce((acc, s) => acc + (s[key] || 0), 0) / sessions.length;

    const historical = {
      totalSessions:       sessions.length,
      avgCompletionRate:   avg('completionRate'),
      avgFieldAccuracy:    avg('fieldAccuracy'),
      avgConfidence:       avg('avgConfidence'),
      avgRecoveryRate:     avg('recoveryRate'),
      avgSemanticAccuracy: avg('semanticAccuracy'),
      avgSkipRate:         avg('skipRate'),
      avgErrorRate:        avg('errorRate'),
      totalHallucinations: sessions.reduce((a, s) => a + (s.hallucinations || 0), 0),
      totalInterventions:  sessions.reduce((a, s) => a + (s.userInterventions || 0), 0),
    };

    res.json({ latest, previous, historical, sessions });
  } catch (err) {
    console.error('Error generating benchmark report:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Save a new benchmark session (manual data)
app.post('/api/benchmarks', async (req, res) => {
  try {
    const {
      platform, jobUrl, completionRate, fieldAccuracy, navigationAccuracy,
      recoveryRate, hallucinations, userInterventions, avgConfidence,
      semanticAccuracy, totalTimeMs, passedFields, failedFields, totalFields, rawLog, notes
    } = req.body;

    if (!platform) {
      return res.status(400).json({ error: 'platform is required.' });
    }

    const session = await prisma.benchmarkSession.create({
      data: {
        platform, jobUrl: jobUrl || '',
        completionRate: completionRate || 0,
        fieldAccuracy: fieldAccuracy || 0,
        navigationAccuracy: navigationAccuracy || 0,
        recoveryRate: recoveryRate || 0,
        hallucinations: hallucinations || 0,
        userInterventions: userInterventions || 0,
        avgConfidence: avgConfidence || 0,
        semanticAccuracy: semanticAccuracy || 0,
        totalTimeMs: totalTimeMs || 0,
        passedFields: passedFields || 0,
        failedFields: failedFields || 0,
        totalFields: totalFields || 0,
        rawLog: typeof rawLog === 'string' ? rawLog : JSON.stringify(rawLog || []),
        notes: notes || ''
      }
    });

    res.json({ success: true, session });
  } catch (err) {
    console.error('Error saving benchmark session:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Compute and save benchmark metrics from a raw action log
app.post('/api/benchmarks/compute', async (req, res) => {
  try {
    const { platform, jobUrl, actionLog, totalTimeMs, userInterventions, notes } = req.body;

    if (!platform || !Array.isArray(actionLog)) {
      return res.status(400).json({ error: 'platform and actionLog array are required.' });
    }

    // Compute metrics from the action log
    const totalFields = actionLog.length;
    const passedFields = actionLog.filter(a => a.status === 'success').length;
    const failedFields = actionLog.filter(a => ['error', 'warning', 'skipped'].includes(a.status)).length;
    const completionRate = totalFields > 0 ? passedFields / totalFields : 0;
    const fieldAccuracy = totalFields > 0 ? passedFields / totalFields : 0;

    // Recovery rate: fields with errors that eventually succeeded
    const errorIds = new Set(actionLog.filter(a => a.status === 'error').map(a => a.fieldId));
    const recoveredIds = actionLog.filter(a => a.status === 'success' && errorIds.has(a.fieldId));
    const recoveryRate = errorIds.size > 0 ? recoveredIds.length / errorIds.size : 1;

    // Hallucinations: filled fields where confidence < 0.3 and intent = 'unknown'
    const hallucinations = actionLog.filter(a => 
      a.confidence !== null && a.confidence < 0.3 && a.status === 'success' && (!a.intent || a.intent === 'unknown')
    ).length;

    // Average confidence
    const confidenceValues = actionLog.filter(a => a.confidence !== null && a.confidence !== undefined).map(a => a.confidence);
    const avgConfidence = confidenceValues.length > 0 ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length : 0;

    // Semantic accuracy: fields with a known intent (not 'unknown' or empty)
    const knownIntents = actionLog.filter(a => a.intent && a.intent !== 'unknown' && a.intent !== 'unclassified');
    const semanticAccuracy = totalFields > 0 ? knownIntents.length / totalFields : 0;

    const session = await prisma.benchmarkSession.create({
      data: {
        platform, jobUrl: jobUrl || '',
        completionRate, fieldAccuracy, navigationAccuracy: completionRate,
        recoveryRate, hallucinations, userInterventions: userInterventions || 0,
        avgConfidence, semanticAccuracy,
        totalTimeMs: totalTimeMs || 0,
        passedFields, failedFields, totalFields,
        rawLog: JSON.stringify(actionLog),
        notes: notes || ''
      }
    });

    res.json({ success: true, session, computed: { completionRate, fieldAccuracy, recoveryRate, hallucinations, avgConfidence, semanticAccuracy } });
  } catch (err) {
    console.error('Error computing benchmark metrics:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE: Remove a benchmark session
app.delete('/api/benchmarks/:id', async (req, res) => {
  try {
    await prisma.benchmarkSession.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting benchmark session:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Clear all benchmark sessions
app.post('/api/benchmarks/clear', async (req, res) => {
  try {
    const count = await prisma.benchmarkSession.deleteMany({});
    res.json({ success: true, deleted: count.count });
  } catch (err) {
    console.error('Error clearing benchmarks:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- SEED DATABASE FUNCTION ---
async function seedDatabase() {
  try {
    console.log('Running database seeding check...');

    // 1. Seed Settings from .env
    const existingSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    let settingsData = {};
    if (existingSettings) {
      try {
        const decrypted = decrypt(existingSettings.dataJson);
        if (decrypted) {
          settingsData = JSON.parse(decrypted);
        } else {
          // Fallback if legacy JSON format fails decrypting or password changed
          settingsData = JSON.parse(existingSettings.dataJson);
        }
      } catch (e) {
        console.warn('Failed to decrypt/parse existing settings, using empty defaults.');
      }
    }

    if (process.env.GEMINI_API_KEY) {
      settingsData.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      settingsData.GROQ_API_KEY = settingsData.GROQ_API_KEY || "";
      settingsData.GEMINI_MODEL = "gemini-2.5-flash";
      settingsData.DEFAULT_PORTAL_EMAIL = settingsData.DEFAULT_PORTAL_EMAIL || process.env.USERNAME || "";
      settingsData.DEFAULT_PORTAL_PASSWORD = settingsData.DEFAULT_PORTAL_PASSWORD || process.env.PASSWORD || "";

      await prisma.settings.upsert({
        where: { id: 'singleton' },
        update: { dataJson: encrypt(JSON.stringify(settingsData)) },
        create: { id: 'singleton', dataJson: encrypt(JSON.stringify(settingsData)) }
      });
      console.log('Seeded/Updated Settings from .env variables (encrypted).');
    } else if (!existingSettings) {
      const defaultSettings = {
        GEMINI_API_KEY: "",
        GROQ_API_KEY: "",
        GEMINI_MODEL: "gemini-2.5-flash",
        DEFAULT_PORTAL_EMAIL: "",
        DEFAULT_PORTAL_PASSWORD: ""
      };
      await prisma.settings.create({
        data: {
          id: 'singleton',
          dataJson: encrypt(JSON.stringify(defaultSettings))
        }
      });
      console.log('Seeded default empty Settings (encrypted).');
    }

    // Load backup data if available
    const backupPath = path.join(__dirname, '..', 'ai_job_agent_backup_1783188783994.json');
    let backupData = null;
    if (fs.existsSync(backupPath)) {
      try {
        backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        console.log('Loaded seed data from backup file.');
      } catch (err) {
        console.error('Failed to parse backup JSON file:', err);
      }
    }

    // 2. Seed Profile
    const profileCount = await prisma.profile.count();
    if (profileCount === 0) {
      let profileData = {};
      if (backupData && backupData.profile) {
        profileData = backupData.profile;
      } else {
        profileData = {
          name: "Test User",
          contact: { email: "test@example.com", phone: "123-456-7890", firstName: "Test", lastName: "User" },
          skills: ["JavaScript", "React", "Node.js"]
        };
      }
      await prisma.profile.create({
        data: {
          id: 'singleton',
          dataJson: encrypt(JSON.stringify(profileData))
        }
      });
      console.log('Seeded Profile database table (encrypted).');
    }

    // 3. Seed Cover Letters
    const coverLettersCount = await prisma.coverLetter.count();
    if (coverLettersCount === 0 && backupData && Array.isArray(backupData.coverLetters)) {
      for (const letter of backupData.coverLetters) {
        await prisma.coverLetter.create({
          data: {
            id: letter.id || undefined,
            name: letter.name,
            text: letter.text,
            analysis: letter.analysis ? JSON.stringify(letter.analysis) : null
          }
        });
      }
      console.log(`Seeded ${backupData.coverLetters.length} Cover Letters.`);
    }

    // 4. Seed Active Resume
    const resumeCount = await prisma.resume.count();
    if (resumeCount === 0) {
      const filename = "Afnan_Adit_Resume.pdf";
      const dummyBase64 = "JVBERi0xLjQKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCjIgMCBvYmoKICA8PCAvVHlwZSAvUGFnZXMKICAgICAvS2lkcyBbIDMgMCBSIF0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UKICAgICAvUGFyZW50IDIgMCBSCiAgICAgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXQogICAgIC9Db250ZW50cyA0IDAgUgogID4+CmVuZG9iago0IDAgb2JqCiAgPDwgL0xlbmd0aCA1NiA+PgpzdHJlYW0KQlQKICAvRjEgMTIgVGYKICA3MiA3MTIgVGQKICAoRHVtbXkgUmVzdW1lIGZvciBBSSBKb2IgQWdlbnQgVGVzdGluZykgVGoKRUQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA2OSAwMDAwMCBuIAowMDAwMDAwMTMwIDAwMDAwIG4gCjAwMDAwMDAyMjUgMDAwMDAgbiAKdHJhaWxlcgogIDw8IC9TaXplIDUKICAgICAvUm9vdCAxIDAgUgogID4+CnN0YXJ0eHJlZgozMzAKJSVFT0Y=";
      await prisma.resume.create({
        data: {
          versionName: filename,
          filePath: `uploads/${filename}`,
          parsedJson: '{}',
          base64Data: dummyBase64
        }
      });
      console.log('Seeded active Resume PDF.');
    }
  } catch (err) {
    console.error('Error seeding database:', err);
  }
}

seedDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`AI Job Agent Backend Server running on port ${PORT}`);
  });
});

