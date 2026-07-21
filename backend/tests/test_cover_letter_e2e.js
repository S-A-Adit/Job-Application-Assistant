// test_cover_letter_e2e.js
// Runs a full E2E test of the Cover Letter Generator using Puppeteer and the loaded extension
// Run from backend/ directory: node tests/test_cover_letter_e2e.js

const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

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
  console.log("Retrieving Gemini API Key from database...");
  const { apiKey, model } = await getApiKeyFromDb();
  await prisma.$disconnect(); // Release database lock immediately to prevent deadlocks
  if (!apiKey) {
    throw new Error("Gemini API key is not configured in the database settings!");
  }
  console.log(`Using key: ${apiKey.substring(0, 7)}... and model: ${model}`);

  const extensionPath = path.resolve(__dirname, '../../extension');
  console.log(`Loading extension from: ${extensionPath}`);

  // Launch Puppeteer with extension loaded (matching run-learning-loop.js)
  const browser = await puppeteer.launch({
    headless: false, // extensions only work in headful mode
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      const page = await target.page();
      if (page) {
        page.on('console', msg => console.log(`PAGE LOG [${target.url().substring(0, 40)}...]:`, msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
      }
    }
  });

  try {
    // Wait to let browser initialize
    console.log("Waiting for extension to initialize...");
    await new Promise(r => setTimeout(r, 4000));

    // Find Extension ID
    console.log("Finding Extension ID...");
    const targets = await browser.targets();
    const serviceWorkerTarget = targets.find(t => t.type() === 'service_worker');
    if (!serviceWorkerTarget) {
      throw new Error('Could not find Extension Service Worker target. Make sure manifest.json and background.js are correct.');
    }
    const serviceWorkerUrl = serviceWorkerTarget.url();
    const extensionId = serviceWorkerUrl.split('/')[2];
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

    // Set up settings inside Chrome storage.local
    console.log("Configuring Gemini API key in extension storage...");
    const bgPage = await browser.newPage();
    await bgPage.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await bgPage.evaluate(async (key, mdl) => {
      await chrome.storage.local.set({
        settings: {
          GEMINI_API_KEY: key,
          GEMINI_MODEL: mdl || "gemini-2.5-flash"
        }
      });
      console.log("Settings successfully written to storage.");
    }, apiKey, model);
    await bgPage.close();

    // 1. Open mock job application page
    console.log("Opening Mock Application page...");
    const appPage = await browser.newPage();
    await appPage.goto('http://localhost:5000/mock-app.html');
    
    // Wait for loading spinner to clear
    console.log("Waiting for form container to load...");
    await appPage.waitForSelector('#app-container', { visible: true, timeout: 5000 });
    
    // Verify Job Description is visible
    const jdVisible = await appPage.evaluate(() => {
      const el = document.getElementById('job-description');
      return el && el.offsetHeight > 0;
    });
    console.log(`Job Description block visible on page: ${jdVisible}`);

    // 2. Open sidepanel.html in a tab to act as our sidepanel controller
    console.log("Opening sidepanel.html controller...");
    const sidepanelPage = await browser.newPage();

    sidepanelPage.on('console', msg => console.log('SIDEPANEL LOG:', msg.text()));
    sidepanelPage.on('pageerror', err => console.log('SIDEPANEL ERROR:', err.message));

    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Bring the mock-app page back to the front so it is the active tab in the window
    console.log("Bringing mock-app page to the front (active)...");
    await appPage.bringToFront();

    // Wait for form detection status
    console.log("Waiting for sidepanel scanner to identify form...");
    await sidepanelPage.waitForFunction(() => {
      const el = document.getElementById('status-message');
      return el && el.textContent.includes('Form Detected');
    }, { timeout: 12000 });

    const statusText = await sidepanelPage.$eval('#status-message', el => el.textContent);
    console.log(`Sidepanel status: ${statusText}`);

    // Check if the "Generate Cover Letter" button is enabled
    const isGenBtnEnabled = await sidepanelPage.$eval('#gen-cover-letter-btn', el => !el.disabled);
    console.log(`'Generate Cover Letter' button enabled: ${isGenBtnEnabled}`);

    if (!isGenBtnEnabled) {
      throw new Error("Generate Cover Letter button is disabled!");
    }

    // 3. Click the Generate Cover Letter button programmatically to avoid CDP click hangs
    console.log("Triggering 'Generate Cover Letter' click...");
    await sidepanelPage.evaluate(() => {
      const btn = document.getElementById('gen-cover-letter-btn');
      if (btn) btn.click();
    });

    // Wait for the generator modal to show and change state to editor using Node-level polling to bypass background tab throttling
    console.log("Waiting for Gemini AI cover letter generation (polling every 3s)...");
    
    let editorVisible = false;
    let errorVisible = false;
    let errorText = "";

    for (let i = 0; i < 30; i++) { // Max 90 seconds
      const stateInfo = await sidepanelPage.evaluate(() => {
        const gen = document.getElementById("cl-generating-state");
        const edit = document.getElementById("cl-editor-state");
        const err = document.getElementById("cl-error-state");
        const errText = document.getElementById("cl-error-text");
        const status = document.getElementById("cl-status-msg");
        
        return {
          generatingVisible: gen ? gen.style.display !== "none" : false,
          editorVisible: edit ? edit.style.display !== "none" : false,
          errorVisible: err ? err.style.display !== "none" : false,
          errorText: errText ? errText.textContent : "",
          statusText: status ? status.textContent : ""
        };
      });

      console.log(`[POLLING STATUS] Gen: ${stateInfo.generatingVisible}, Edit: ${stateInfo.editorVisible}, Err: ${stateInfo.errorVisible} | Status: "${stateInfo.statusText}"`);
      
      if (stateInfo.editorVisible) {
        editorVisible = true;
        break;
      }
      if (stateInfo.errorVisible) {
        errorVisible = true;
        errorText = stateInfo.errorText;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (errorVisible) {
      throw new Error(`Generation failed with error: ${errorText}`);
    }
    if (!editorVisible) {
      throw new Error("Timed out waiting for Gemini AI cover letter generation.");
    }

    const generatedLetter = await sidepanelPage.$eval('#cl-editor-textarea', el => el.value);
    const saveName = await sidepanelPage.$eval('#cl-save-name', el => el.value);
    console.log(`\n🎉 Cover Letter Generated successfully!`);
    console.log(`Suggested Name: "${saveName}"`);
    console.log(`Letter Length: ${generatedLetter.length} characters`);
    console.log(`Preview of generated letter:\n${generatedLetter.substring(0, 300)}...\n`);

    // 4. Click "Upload to Form" programmatically
    console.log("Triggering 'Upload to Application Form' click...");
    await sidepanelPage.evaluate(() => {
      const btn = document.getElementById('cl-upload-btn');
      if (btn) btn.click();
    });

    // Wait for status message
    await sidepanelPage.waitForFunction(() => {
      const el = document.getElementById('cl-status-msg');
      return el && el.textContent.includes('uploaded to form successfully');
    }, { timeout: 5000 });

    const clStatus = await sidepanelPage.$eval('#cl-status-msg', el => el.textContent);
    console.log(`Sidepanel Modal Status: "${clStatus}"`);

    // 5. Verify text is in the main form's cover-letter textarea
    console.log("Verifying textarea value in Mock Application Form...");
    const formCoverLetterValue = await appPage.$eval('#cover-letter', el => el.value);
    console.log(`Cover Letter field filled length: ${formCoverLetterValue.length} characters`);
    
    if (formCoverLetterValue.trim() === generatedLetter.trim()) {
      console.log("\n✅ SUCCESS: Cover letter matches generated text exactly!");
    } else {
      throw new Error(`Cover letter value in form mismatch! Expected: ${generatedLetter.substring(0, 30)}... Got: ${formCoverLetterValue.substring(0, 30)}...`);
    }

    // 6. Test Save to Knowledge Base programmatically
    console.log("Triggering 'Save to Knowledge Base' click...");
    await sidepanelPage.evaluate(() => {
      const btn = document.getElementById('cl-save-kb-btn');
      if (btn) btn.click();
    });
    // Wait for the save status message using Node-level polling to bypass background tab throttling
    let saved = false;
    for (let i = 0; i < 10; i++) {
      saved = await sidepanelPage.evaluate(() => {
        const el = document.getElementById('cl-status-msg');
        return el && el.textContent.includes('Saved to Knowledge Base');
      });
      if (saved) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!saved) {
      const currentStatus = await sidepanelPage.$eval('#cl-status-msg', el => el.textContent);
      throw new Error(`Timed out waiting for save confirmation. Current status: "${currentStatus}"`);
    }
    console.log("✅ SUCCESS: Cover letter saved to Knowledge Base database.");

    // Retrieve cover letters from backend API to confirm persistence
    console.log("Checking API to verify cover letter is in SQLite DB...");
    const res = await fetch('http://localhost:5000/api/cover-letters');
    if (res.ok) {
      const letters = await res.json();
      const savedLetter = letters.find(l => l.name === saveName);
      if (savedLetter) {
        console.log(`✅ SUCCESS: Found letter "${saveName}" in database.`);
      } else {
        throw new Error(`Could not find saved letter "${saveName}" in database response.`);
      }
    } else {
      throw new Error(`Failed to fetch /api/cover-letters: ${res.status}`);
    }

  } finally {
    console.log("Closing browser...");
    await browser.close();
    await prisma.$disconnect();
  }
}

run().catch(err => {
  console.error("\n❌ E2E TEST FAILED:", err);
  prisma.$disconnect();
  process.exit(1);
});
