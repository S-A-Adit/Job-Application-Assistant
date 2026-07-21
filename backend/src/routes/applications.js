const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve Applications
router.get('/', async (req, res) => {
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
router.post('/sync', async (req, res) => {
  try {
    const { applications } = req.body;
    if (!Array.isArray(applications)) {
      return res.status(400).json({ error: 'Applications array is required.' });
    }

    const uniqueAppsMap = new Map();
    for (const app of applications) {
      if (app.url) {
        uniqueAppsMap.set(app.url, app);
      }
    }
    const uniqueApps = Array.from(uniqueAppsMap.values());

    const syncedApps = await prisma.$transaction(async (tx) => {
      await tx.applicationDraft.deleteMany({});
      await tx.application.deleteMany({});

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

module.exports = router;
