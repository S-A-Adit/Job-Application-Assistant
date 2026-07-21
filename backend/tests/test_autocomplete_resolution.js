// test_autocomplete_resolution.js
// Runs semantic autocomplete resolution tests against mock-app.html section 13
// Run from backend/ directory: node tests/test_autocomplete_resolution.js

const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load env variables
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
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (!settings) throw new Error("No settings found in SQLite DB.");
  const data = JSON.parse(decrypt(settings.dataJson));
  return { apiKey: data.GEMINI_API_KEY, model: data.GEMINI_MODEL };
}

async function run() {
  console.log("Retrieving settings from database...");
  const { apiKey, model } = await getApiKeyFromDb();
  await prisma.$disconnect();

  const extensionPath = path.resolve(__dirname, '../../extension');
  console.log(`Loading extension from: ${extensionPath}`);

  const tmpUserDataDir = path.resolve(__dirname, '../.tmp_user_data_autocomplete');
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
        page.on('console', async msg => {
          const text = msg.text();
          if (text.includes('[AI Agent') || text.includes('error') || text.includes('Autocomplete')) {
            try {
              const args = await Promise.all(msg.args().map(arg => arg.jsonValue()));
              console.log('PAGE LOG:', ...args);
            } catch (e) {
              console.log('PAGE LOG:', text);
            }
          }
        });
      }
    }
  });

  try {
    console.log("Waiting for extension to initialize...");
    let serviceWorkerTarget;
    for (let i = 0; i < 20; i++) {
      const targets = await browser.targets();
      serviceWorkerTarget = targets.find(t => t.type() === 'service_worker');
      if (serviceWorkerTarget) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!serviceWorkerTarget) {
      const targets = await browser.targets();
      console.log("All discovered targets:", targets.map(t => ({ type: t.type(), url: t.url() })));
      throw new Error('Could not find Extension Service Worker target.');
    }
    const extensionId = serviceWorkerTarget.url().split('/')[2];
    console.log(`🚀 Discovered Extension ID: ${extensionId}`);

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
      console.log("Auth container detected. Logging in to unlock mock application form...");
      const testEmail = (envConfig.parsed && envConfig.parsed.USERNAME) || 'sadit@drew.edu';
      await appPage.type('#auth-email', testEmail);
      await appPage.type('#auth-password', process.env.PASSWORD || 'jqsJx340wcXN*');
      const confirmPass = await appPage.$('#auth-confirm-password');
      if (confirmPass) {
        await appPage.type('#auth-confirm-password', process.env.PASSWORD || 'jqsJx340wcXN*');
      }
      await appPage.click('#auth-submit-btn');
    }

    await appPage.waitForSelector('#app-container', { visible: true, timeout: 5000 });

    // Open sidepanel
    console.log("Opening sidepanel.html controller...");
    const sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Hydrate extension settings
    console.log("Configuring Gemini API key in extension storage...");
    await sidepanelPage.evaluate(async (key, mdl) => {
      const payload = { GEMINI_API_KEY: key, GEMINI_MODEL: mdl };
      await chrome.storage.local.set({ settings: payload });
    }, apiKey, model);

    // Bring mock app back to focus
    await appPage.bringToFront();

    // Scan form fields to get element IDs
    console.log("Scanning fields from sidepanel...");
    const scanResult = await sidepanelPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const activeTab = tabs.find(t => t.url && t.url.includes('mock-app.html'));
      if (!activeTab) throw new Error("Could not find mock-app.html tab");
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_FORM" }, (res) => resolve(res));
      });
    });

    if (!scanResult || !scanResult.success || !scanResult.fields) {
      throw new Error("Failed to scan fields from page");
    }

    const fields = scanResult.fields;
    console.log(`Scanned ${fields.length} fields from mock-app.html.`);

    // Find autocomplete fields
    const autoFields = fields.filter(f => f.id.startsWith('auto-') || f.isAutocomplete);
    console.log(`Identified ${autoFields.length} autocomplete fields.`);

    // Define controlled mappings for autocomplete test scenarios
    const mappings = [
      { id: 'auto-location', value: 'Madison, New Jersey, United States', intent: 'auto_location', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-university', value: 'Drew University', intent: 'auto_university', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-company', value: 'Monstarlab', intent: 'auto_company', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-skills', value: 'Machine Learning', intent: 'auto_skills', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-degree', value: 'Bachelor of Science', intent: 'auto_degree', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-visa', value: 'F-1 Student Visa', intent: 'auto_visa', confidence: 0.99, isAutocomplete: true },
      { id: 'auto-no-match', value: 'Quantum Physics', intent: 'auto_no_match', confidence: 0.99, isAutocomplete: true }
    ];

    console.log("\nExecuting FILL_FORM with controlled mappings...");
    const fillResult = await sidepanelPage.evaluate(async (maps) => {
      const tabs = await chrome.tabs.query({ active: true });
      const activeTab = tabs.find(t => t.url && t.url.includes('mock-app.html'));
      if (!activeTab) throw new Error("Could not find active tab to fill");
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { action: "FILL_FORM", payload: { mappings: maps } }, (res) => resolve(res));
      });
    }, mappings);

    console.log(`Fill completed. Result: ${JSON.stringify(fillResult)}`);
    
    // Wait for dropdown selections to complete and settle
    console.log("Waiting 2.5s for dynamic suggestion UI cycles to settle...");
    await new Promise(r => setTimeout(r, 2500));

    // Retrieve form state from the page context
    const formState = await appPage.evaluate(() => {
      return window.getFormState();
    });

    console.log("\n══════════════════════════════════════════════════════════════════════════════════════════");
    console.log(" SEMANTIC AUTOCOMPLETE RESOLUTION REPORT");
    console.log("══════════════════════════════════════════════════════════════════════════════════════════");
    console.log(
      " " +
      "Field ID".padEnd(20) + " | " +
      "Target Value".padEnd(38) + " | " +
      "Accepted Value".padEnd(20) + " | " +
      "Status"
    );
    console.log("──────────────────────────────────────────────────────────────────────────────────────────");

    const tests = [
      { id: 'auto-location', target: 'Madison, New Jersey, United States', actual: formState.autoLocation, expectEmpty: false },
      { id: 'auto-university', target: 'Drew University', actual: formState.autoUniversity, expectEmpty: false },
      { id: 'auto-company', target: 'Monstarlab', actual: formState.autoCompany, expectEmpty: false },
      { id: 'auto-skills', target: 'Machine Learning', actual: formState.autoSkills, expectEmpty: false },
      { id: 'auto-degree', target: 'Bachelor of Science', actual: formState.autoDegree, expectEmpty: false },
      { id: 'auto-visa', target: 'F-1 Student Visa', actual: formState.autoVisa, expectEmpty: false },
      { id: 'auto-no-match', target: 'Quantum Physics', actual: formState.autoNoMatch, expectEmpty: true }
    ];

    let failures = 0;
    for (const test of tests) {
      let passed = false;
      if (test.expectEmpty) {
        passed = !test.actual || test.actual === '';
      } else {
        passed = test.actual === test.target;
      }

      if (!passed) failures++;

      console.log(
        " " +
        test.id.padEnd(20) + " | " +
        test.target.padEnd(38) + " | " +
        (test.actual || "(empty)").padEnd(20) + " | " +
        (passed ? "✅ PASS" : "❌ FAIL")
      );
    }
    console.log("──────────────────────────────────────────────────────────────────────────────────────────");

    if (failures === 0) {
      console.log("🎉 SUCCESS: All autocomplete resolution tests passed successfully!");
    } else {
      throw new Error(`FAIL: ${failures} autocomplete test cases failed.`);
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
