const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// GET: Retrieve all benchmark sessions
router.get('/', async (req, res) => {
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
router.get('/report', async (req, res) => {
  try {
    const allSessions = await prisma.benchmarkSession.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    if (allSessions.length === 0) {
      return res.json({ latest: null, previous: null, historical: null, sessions: [] });
    }

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
router.post('/', async (req, res) => {
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
router.post('/compute', async (req, res) => {
  try {
    const { platform, jobUrl, actionLog, totalTimeMs, userInterventions, notes } = req.body;

    if (!platform || !Array.isArray(actionLog)) {
      return res.status(400).json({ error: 'platform and actionLog array are required.' });
    }

    const totalFields = actionLog.length;
    const passedFields = actionLog.filter(a => a.status === 'success').length;
    const failedFields = actionLog.filter(a => ['error', 'warning', 'skipped'].includes(a.status)).length;
    const completionRate = totalFields > 0 ? passedFields / totalFields : 0;
    const fieldAccuracy = totalFields > 0 ? passedFields / totalFields : 0;

    const errorIds = new Set(actionLog.filter(a => a.status === 'error').map(a => a.fieldId));
    const recoveredIds = actionLog.filter(a => a.status === 'success' && errorIds.has(a.fieldId));
    const recoveryRate = errorIds.size > 0 ? recoveredIds.length / errorIds.size : 1;

    const hallucinations = actionLog.filter(a => 
      a.confidence !== null && a.confidence < 0.3 && a.status === 'success' && (!a.intent || a.intent === 'unknown')
    ).length;

    const confidenceValues = actionLog.filter(a => a.confidence !== null && a.confidence !== undefined).map(a => a.confidence);
    const avgConfidence = confidenceValues.length > 0 ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length : 0;

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
router.delete('/:id', async (req, res) => {
  try {
    await prisma.benchmarkSession.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting benchmark session:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Clear all benchmark sessions
router.post('/clear', async (req, res) => {
  try {
    const count = await prisma.benchmarkSession.deleteMany({});
    res.json({ success: true, deleted: count.count });
  } catch (err) {
    console.error('Error clearing benchmarks:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
