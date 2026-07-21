// test_field_identification.js
// Runs field identification evaluation against mock-app.html with all 13 categories
// Run from backend/ directory: node tests/test_field_identification.js

const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load environment variables from parent directory .env file and override system-wide ones
const dotenvPath = fs.existsSync(path.join(__dirname, '../../../.env')) 
  ? path.join(__dirname, '../../../.env') 
  : (fs.existsSync(path.join(__dirname, '../../.env')) 
    ? path.join(__dirname, '../../.env') 
    : (fs.existsSync(path.join(__dirname, '../.env')) ? path.join(__dirname, '../.env') : path.join(__dirname, '.env')));
const envConfig = require('dotenv').config({ path: dotenvPath });
if (envConfig.parsed && envConfig.parsed.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = envConfig.parsed.GEMINI_API_KEY;
}
if (envConfig.parsed && envConfig.parsed.PASSWORD) {
  process.env.PASSWORD = envConfig.parsed.PASSWORD;
}

const prisma = new PrismaClient();

const SECRET_KEY_SEED = process.env.PASSWORD || process.env.ENCRYPTION_SECRET || 'ai-job-agent-default-secret-seed-value';
const ENCRYPTION_KEY = crypto.scryptSync(SECRET_KEY_SEED, 'salt-job-agent', 32);
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return encryptedText;
  }
}

async function getApiKeyFromDb() {
  const { decrypt } = require('../src/utils/crypto');
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (!settings || !settings.dataJson) return { apiKey: process.env.GEMINI_API_KEY || "", model: "gemini-3.5-flash-lite" };
  const decrypted = decrypt(settings.dataJson);
  if (!decrypted) return { apiKey: process.env.GEMINI_API_KEY || "", model: "gemini-3.5-flash-lite" };
  try {
    const data = JSON.parse(decrypted);
    return { apiKey: data.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "", model: data.GEMINI_MODEL || "gemini-3.5-flash-lite" };
  } catch (e) {
    return { apiKey: process.env.GEMINI_API_KEY || "", model: "gemini-3.5-flash-lite" };
  }
}

// Smart validator for semantic intent matching
function isIntentMatch(expected, actual) {
  if (!expected || !actual) return false;
  const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const expClean = clean(expected);
  const actClean = clean(actual);
  
  if (expClean === actClean) return true;
  if (actClean.includes(expClean) || expClean.includes(actClean)) return true;
  
  const getStems = (s) => s.toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.substring(0, 4));
    
  const expStems = getStems(expected);
  const actStems = getStems(actual);
  
  // Check common stems
  const commonStems = expStems.filter(s => actStems.includes(s));
  const majorStems = ['relo', 'spon', 'auth', 'work', 'skil', 'expe', 'proj', 'educ', 'degr', 'majo', 'grad', 'cert', 'why', 'role', 'moti', 'name', 'emai', 'phon', 'link', 'gith', 'port', 'addr', 'city', 'stat', 'coun', 'post', 'zip', 'pref', 'subf'];
  
  for (const s of commonStems) {
    if (majorStems.includes(s)) return true;
  }
  
  // Handle cross-semantic clusters (e.g., salary/compensation)
  const isSalary = (s) => s.includes('sala') || s.includes('comp') || s.includes('pay');
  if (isSalary(expClean) && isSalary(actClean)) return true;

  // Semantic fallbacks
  const lowerAct = actual.toLowerCase();
  if (expected === 'experience_description' && (lowerAct.includes('responsibilities') || lowerAct.includes('achievement') || lowerAct.includes('experience'))) return true;
  if (expected === 'skills' && (lowerAct.includes('languages') || lowerAct.includes('technologies') || lowerAct.includes('skill') || lowerAct.includes('python') || lowerAct.includes('react') || lowerAct.includes('aws') || lowerAct.includes('docker'))) return true;
  if (expected === 'why_role' && (lowerAct.includes('interest') || lowerAct.includes('why') || lowerAct.includes('motivation'))) return true;
  if (expected === 'ml_experience' && (lowerAct.includes('ml') || lowerAct.includes('machine learning') || lowerAct.includes('llm'))) return true;
  if (expected === 'js_experience' && (lowerAct.includes('javascript') || lowerAct.includes('js'))) return true;

  return false;
}

async function run() {
  console.log("Retrieving Gemini API Key from database...");
  const { apiKey, model } = await getApiKeyFromDb();
  await prisma.$disconnect();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured in the database settings!");
  }
  console.log(`Using key: ${apiKey.substring(0, 7)}... and model: ${model}`);

  const extensionPath = path.resolve(__dirname, '../../extension');
  console.log(`Loading extension from: ${extensionPath}`);

  const tmpUserDataDir = path.resolve(__dirname, '../.tmp_user_data_field_id');
  console.log(`Using isolated user data directory: ${tmpUserDataDir}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--user-data-dir=${tmpUserDataDir}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      const page = await target.page();
      if (page) {
        page.on('console', msg => {
          const text = msg.text();
          if (text.includes('[AI Agent') || text.includes('error')) {
            console.log(`PAGE LOG [${target.url().substring(0, 40)}...]:`, text);
          }
        });
      }
    }
  });

  try {
    console.log("Waiting for extension to initialize...");
    await new Promise(r => setTimeout(r, 4000));

    // Find Extension ID
    console.log("Finding Extension ID...");
    const targets = await browser.targets();
    const serviceWorkerTarget = targets.find(t => t.type() === 'service_worker');
    if (!serviceWorkerTarget) {
      throw new Error('Could not find Extension Service Worker target.');
    }
    const extensionId = serviceWorkerTarget.url().split('/')[2];
    console.log(`🚀 Discovered Extension ID: ${extensionId}`);

    // Redirect background service worker console logs
    try {
      const worker = await serviceWorkerTarget.worker();
      if (worker) {
        worker.on('console', msg => console.log('BACKGROUND LOG:', msg.text()));
        console.log("BACKGROUND LOG redirection active.");
      }
    } catch (e) {
      console.warn("Could not attach log redirection to service worker:", e.message);
    }

    // Open Mock App Page
    console.log("Opening Mock Application page...");
    const appPage = await browser.newPage();
    await appPage.goto('http://localhost:5000/mock-app.html', { waitUntil: 'networkidle0' });

    // Wait for loading spinner to clear and either auth-container or app-container to display
    await appPage.waitForFunction(() => {
      const auth = document.getElementById('auth-container');
      const app = document.getElementById('app-container');
      return (auth && auth.style.display !== 'none') || (app && app.style.display !== 'none');
    }, { timeout: 8000 });

    const authVisible = await appPage.evaluate(() => {
      const authEl = document.getElementById('auth-container');
      return authEl && authEl.style.display !== 'none';
    });

    if (authVisible) {
      console.log("Auth container detected. Signing up / logging in to unlock application form...");
      const testEmail = (envConfig.parsed && envConfig.parsed.USERNAME) || 'sadit@drew.edu';
      await appPage.type('#auth-email', testEmail);
      await appPage.type('#auth-password', process.env.PASSWORD || 'jqsJx340wcXN*');
      const confirmPass = await appPage.$('#auth-confirm-password');
      if (confirmPass) {
        await appPage.type('#auth-confirm-password', process.env.PASSWORD || 'jqsJx340wcXN*');
      }
      await appPage.click('#auth-submit-btn');
    }

    // Wait for mock form container to load
    await appPage.waitForSelector('#app-container', { visible: true, timeout: 5000 });
    console.log("Job Description block visible on page: true");

    // Open side panel
    console.log("Opening sidepanel.html controller...");
    const sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Hydrate extension settings with the database key
    console.log("Configuring Gemini API key in extension storage...");
    await sidepanelPage.evaluate(async (key, mdl) => {
      const payload = { GEMINI_API_KEY: key, GEMINI_MODEL: mdl };
      await chrome.storage.local.set({ settings: payload });
    }, apiKey, model);

    // Bring mock app back to focus
    await appPage.bringToFront();

    // Trigger form scanning via sidepanel context
    console.log("Scanning form fields from sidepanel context...");
    const scanResult = await sidepanelPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const activeTab = tabs.find(t => t.url && t.url.includes('mock-app.html'));
      if (!activeTab) throw new Error("Could not find mock-app.html tab");
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_FORM" }, (res) => resolve(res));
      });
    });

    if (!scanResult || !scanResult.success || !scanResult.fields) {
      throw new Error(`Failed to scan form: ${JSON.stringify(scanResult)}`);
    }

    const detectedFields = scanResult.fields;
    console.log(`Detected ${detectedFields.length} raw form inputs.`);

    // Perform AI field mapping
    console.log("Sending fields to Gemini for semantic intent classification...");
    console.log("(This may take up to 20-30 seconds depending on network latency)...");
    
    const mappingResult = await sidepanelPage.evaluate(async (fields, jobText) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "MAPFORMFIELDS",
          payload: {
            fields: fields,
            jobUrl: "http://localhost:5000/mock-app.html",
            jobText: jobText
          }
        }, (res) => resolve(res));
      });
    }, detectedFields, scanResult.jobDetails?.description || "");

    if (!mappingResult || !mappingResult.success || !mappingResult.mappings) {
      // Note: background returns { success: true, mappings: [...] } on mapFormFields
      throw new Error(`Mapping failed: ${JSON.stringify(mappingResult)}`);
    }

    const aiMappings = mappingResult.mappings; // This is the field mapping array
    console.log(`Successfully mapped ${aiMappings.length} fields.\n`);

    // Verify against ground truth DOM elements
    console.log("══════════════════════════════════════════════════════════════════════════════════════════");
    console.log(" FIELD IDENTIFICATION REPORT");
    console.log("══════════════════════════════════════════════════════════════════════════════════════════");
    console.log(
      " " +
      "Field ID".padEnd(25) + " | " +
      "Label/Name".padEnd(30) + " | " +
      "Expected Intent".padEnd(20) + " | " +
      "AI Intent".padEnd(20) + " | " +
      "Match"
    );
    console.log("──────────────────────────────────────────────────────────────────────────────────────────");

    let totalValids = 0;
    let correctMatches = 0;
    let totalSkipped = 0;

    for (const rawField of detectedFields) {
      const fieldId = rawField.id;
      if (fieldId.startsWith('auto-')) continue;
      const labelText = rawField.labelText || rawField.name || rawField.placeholder || "(no identifier)";
      
      // Get ground truth attributes from page
      const groundTruth = await appPage.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        return {
          expectedIntent: el.getAttribute('data-expected-ai-intent') || '',
          skip: el.getAttribute('data-skip') === 'true' || el.closest('[data-skip="true"]') !== null
        };
      }, fieldId);

      if (!groundTruth) continue;

      const expected = groundTruth.expectedIntent;
      const isSkip = groundTruth.skip;

      // Find AI mapping
      const mapping = aiMappings.find(m => m.id === fieldId);
      const actual = mapping ? mapping.intent : null;

      if (isSkip) {
        totalSkipped++;
        console.log(
          ` ` +
          fieldId.padEnd(25) + " | " +
          labelText.substring(0, 30).padEnd(30) + " | " +
          "skip".padEnd(20) + " | " +
          (actual || "skipped").padEnd(20) + " | " +
          "⏭️ (skipped diversity)"
        );
        continue;
      }

      totalValids++;
      const isMatch = isIntentMatch(expected, actual);
      if (isMatch) {
        correctMatches++;
      }

      console.log(
        ` ` +
        fieldId.padEnd(25) + " | " +
        labelText.substring(0, 30).padEnd(30) + " | " +
        expected.padEnd(20) + " | " +
        (actual || "None").padEnd(20) + " | " +
        (isMatch ? "✅ PASS" : "❌ FAIL")
      );
    }

    console.log("──────────────────────────────────────────────────────────────────────────────────────────");
    const accuracy = ((correctMatches / totalValids) * 100).toFixed(1);
    console.log(` TOTAL EVALUATED FIELDS: ${totalValids}`);
    console.log(` CORRECT MATCHES:        ${correctMatches}`);
    console.log(` SKIPPED DIVERSITY:      ${totalSkipped}`);
    console.log(` IDENTIFICATION ACCURACY: ${accuracy}%`);
    console.log("══════════════════════════════════════════════════════════════════════════════════════════\n");

    if (parseFloat(accuracy) >= 80) {
      console.log("🎉 SUCCESS: Field Identification accuracy is above 80% benchmark!");
    } else {
      throw new Error(`FAIL: Accuracy of ${accuracy}% is below target benchmark of 80%`);
    }

  } catch (err) {
    console.error("\n❌ TEST FAILURE:", err);
    process.exit(1);
  } finally {
    console.log("Closing browser...");
    await browser.close();
  }
}

run();
