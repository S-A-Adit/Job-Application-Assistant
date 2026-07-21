// test_signup_login.js
// Runs automated signup/login autofill verification tests against mock-app.html
// Run from backend/ directory: node tests/test_signup_login.js

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
if (envConfig.parsed && envConfig.parsed.USERNAME) {
  process.env.USERNAME = envConfig.parsed.USERNAME;
}

const expectedEmail = process.env.USERNAME || "sadit@drew.edu";
const expectedPassword = process.env.PASSWORD || "jqsJx340wcXN*";

async function run() {
  const extensionPath = path.resolve(__dirname, '../../extension');
  console.log(`Loading extension from: ${extensionPath}`);

  const tmpUserDataDir = path.resolve(__dirname, '../.tmp_user_data_signup_login');
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
          if (text.includes('[AI Agent') || text.includes('error') || text.includes('FILL_CREDENTIALS')) {
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
      throw new Error('Could not find Extension Service Worker target.');
    }
    const extensionId = serviceWorkerTarget.url().split('/')[2];
    console.log(`🚀 Discovered Extension ID: ${extensionId}`);

    // Open Mock App Page
    console.log("Opening Mock Application page...");
    const appPage = await browser.newPage();
    await appPage.goto('http://localhost:5000/mock-app.html', { waitUntil: 'networkidle0' });
    
    console.log("Waiting for auth-container to load...");
    await appPage.waitForSelector('#auth-container', { visible: true, timeout: 5000 });

    // Open sidepanel.html controller
    console.log("Opening sidepanel.html controller...");
    const sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Verify settings get hydrated with environment variables
    console.log("Verifying settings default to env variables...");
    const settings = await sidepanelPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "GET_SETTINGS" }, resolve);
      });
    });

    console.log("Fetched Settings:", JSON.stringify(settings, null, 2));
    if (settings.DEFAULT_PORTAL_EMAIL !== expectedEmail) {
      throw new Error(`Email mismatch! Expected: ${expectedEmail}, got: ${settings.DEFAULT_PORTAL_EMAIL}`);
    }
    if (settings.DEFAULT_PORTAL_PASSWORD !== expectedPassword) {
      throw new Error(`Password mismatch! Expected: ${expectedPassword}, got: ${settings.DEFAULT_PORTAL_PASSWORD}`);
    }
    console.log("✅ Credentials are correctly initialized in extension settings!");

    // Bring mock app back to focus
    await appPage.bringToFront();

    // Verify Tab switching works (isSignupMode is true by default, meaning Password Confirmation field is present)
    const confirmPassVisible = await appPage.evaluate(() => {
      const el = document.getElementById('confirm-password-group');
      return el && el.style.display !== 'none';
    });
    console.log(`Password confirmation input group visible: ${confirmPassVisible}`);
    if (!confirmPassVisible) {
      throw new Error("Confirm Password input group should be visible in Sign Up mode.");
    }

    // Trigger Fill Portal Credentials from sidepanel
    console.log("Triggering FILL_PORTAL_CREDENTIALS from extension...");
    const fillResult = await sidepanelPage.evaluate(async (email, password) => {
      const tabs = await chrome.tabs.query({ active: true });
      const activeTab = tabs.find(t => t.url && t.url.includes('mock-app.html'));
      if (!activeTab) throw new Error("Could not find mock-app.html tab");
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, {
          action: "FILL_PORTAL_CREDENTIALS",
          payload: { username: email, password: password }
        }, resolve);
      });
    }, expectedEmail, expectedPassword);

    console.log("Autofill Result:", JSON.stringify(fillResult));

    // Wait a brief moment to settle
    await new Promise(r => setTimeout(r, 1000));

    // Inspect if fields on mock-app are filled correctly
    const filledState = await appPage.evaluate(() => {
      return {
        emailVal: document.getElementById('auth-email').value,
        passVal: document.getElementById('auth-password').value,
        confirmPassVal: document.getElementById('auth-confirm-password').value
      };
    });

    console.log("Auth fields filled state:", JSON.stringify(filledState, null, 2));

    if (filledState.emailVal !== expectedEmail) {
      throw new Error(`Autofill email failed! Expected: ${expectedEmail}, got: ${filledState.emailVal}`);
    }
    if (filledState.passVal !== expectedPassword) {
      throw new Error(`Autofill password failed! Expected: ${expectedPassword}, got: ${filledState.passVal}`);
    }
    if (filledState.confirmPassVal !== expectedPassword) {
      throw new Error(`Autofill confirmation password failed! Expected: ${expectedPassword}, got: ${filledState.confirmPassVal}`);
    }

    console.log("✅ Autofill validation passed! Both password fields and email field are filled correctly.");

    // Submit auth form to unlock main app
    console.log("Submitting Auth form...");
    await appPage.click('#auth-submit-btn');

    // Wait for app-container to show up and auth-container to hide
    console.log("Waiting for app-container to unlock...");
    await appPage.waitForSelector('#app-container', { visible: true, timeout: 3000 });

    const authHidden = await appPage.evaluate(() => {
      const el = document.getElementById('auth-container');
      return !el || el.style.display === 'none';
    });

    if (!authHidden) {
      throw new Error("auth-container should be hidden after successful submission!");
    }

    console.log("✅ Auth form submitted successfully and main application form is now unlocked!");
    console.log("🎉 SUCCESS: Automated Signup/Login flow verified completely!");

  } catch (err) {
    console.error("\n❌ TEST FAILURE:", err);
    process.exit(1);
  } finally {
    console.log("Closing browser...");
    await browser.close();
  }
}

run();
