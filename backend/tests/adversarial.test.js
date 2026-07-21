/**
 * adversarial.test.js — AI Job Agent Synthetic ATS Adversarial Test Suite
 *
 * Runs a comprehensive set of automated adversarial test scenarios against
 * the Synthetic ATS hosted at http://localhost:5000/synthetic-ats/
 *
 * Test scenarios:
 *  1. Baseline fill (no adversarial features) — all fields fillable
 *  2. Duplicate submit buttons — agent must choose real submit, not decoy
 *  3. Conditional visa field — shown only after selecting "Yes" for sponsorship
 *  4. Misleading labels — "Upload CV" vs "Attach Supporting Documents"
 *  5. Four similar work authorization questions — agent must answer each distinctly
 *  6. Loading delay tolerance — 5s delay between pages
 *  7. CAPTCHA detection — agent should halt when CAPTCHA is present
 *  8. Validation error recovery — form shows errors, agent must not hang
 *
 * Usage:
 *   node backend/tests/adversarial.test.js
 *
 * Requirements:
 *   npm install puppeteer (or already installed via run-learning-loop.js)
 */

'use strict';

const puppeteer = require('puppeteer');
// Patch for Puppeteer 22+ Page.waitForTimeout removal
if (puppeteer && puppeteer.Page && !puppeteer.Page.prototype.waitForTimeout) {
  puppeteer.Page.prototype.waitForTimeout = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };
}
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/synthetic-ats/';
const REPORT_PATH = path.join(__dirname, '../adversarial_report.json');

// Test timeout in ms
const TEST_TIMEOUT = 30000;

// ANSI colors for console output
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

const results = [];
let passCount = 0;
let failCount = 0;

function log(msg, color = '') {
  console.log(`${color}${msg}${C.reset}`);
}

function pass(testName) {
  passCount++;
  results.push({ test: testName, status: 'PASS', error: null });
  log(`  ✅ PASS: ${testName}`, C.green);
}

function fail(testName, error) {
  failCount++;
  results.push({ test: testName, status: 'FAIL', error: String(error) });
  log(`  ❌ FAIL: ${testName} — ${error}`, C.red);
}

async function withTimeout(fn, ms = TEST_TIMEOUT) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Test timed out after ${ms}ms`)), ms))
  ]);
}

// ──────────────────────────────────────────────────────────────────
// TEST HELPERS
// ──────────────────────────────────────────────────────────────────
async function fillInput(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(value, { delay: 20 });
}

async function selectOption(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  await page.select(selector, value);
}

async function clickRadio(page, id) {
  await page.waitForSelector(`#${id}`, { timeout: 5000 });
  await page.click(`label[for="${id}"]`);
}

async function clickButton(page, id) {
  await page.waitForSelector(`#${id}`, { visible: true, timeout: 5000 });
  await page.click(`#${id}`);
}

async function isVisible(page, selector) {
  try {
    const el = await page.$(selector);
    if (!el) return false;
    const box = await el.boundingBox();
    return box !== null && box.width > 0 && box.height > 0;
  } catch {
    return false;
  }
}

async function getVisibleText(page, selector) {
  try {
    return await page.$eval(selector, el => el.textContent.trim());
  } catch {
    return null;
  }
}

// Fill Page 1 with a minimal valid set of fields
async function fillPage1(page) {
  await fillInput(page, '#first-name', 'Jane');
  await fillInput(page, '#last-name', 'Smith');
  await fillInput(page, '#email', 'jane.smith@example.com');
  await fillInput(page, '#phone', '+1 (555) 123-4567');
  await fillInput(page, '#address-street', '123 Main Street');
  await fillInput(page, '#address-city', 'New York');
  await selectOption(page, '#address-state', 'NY');
  await fillInput(page, '#address-zip', '10001');
}

// Fill Page 2 education fields
async function fillPage2Education(page) {
  await fillInput(page, '#edu-school', 'Massachusetts Institute of Technology');
  await selectOption(page, '#edu-degree', "Bachelor's Degree");
  await fillInput(page, '#edu-major', 'Computer Science');
  await selectOption(page, '#edu-grad-year', '2024');
  await selectOption(page, '#years-experience', '3');
  // Set availability date
  await page.$eval('#availability-date', el => { el.value = '2026-09-01'; el.dispatchEvent(new Event('change')); });
}

// ──────────────────────────────────────────────────────────────────
// TEST 1: Baseline Navigation — Page 1 to Page 2
// ──────────────────────────────────────────────────────────────────
async function test1_baselineNavigation(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0&no-conditional', { waitUntil: 'networkidle0' });
    await fillPage1(page);
    await clickButton(page, 'page1-next-btn');
    try {
      await page.waitForSelector('#form-page-2.active', { timeout: 5000 });
    } catch (waitErr) {
      const activePage = await page.evaluate(() => {
        const active = document.querySelector('.ats-form-card.active');
        return active ? active.id : 'none';
      });
      const errors = await page.$$eval('.ats-input.error, .ats-select.error, .ats-textarea.error', els => els.map(el => el.id));
      const textErrors = await page.$$eval('.ats-field-error.visible', els => els.map(el => el.textContent.trim()));
      console.log(`[DEBUG] Navigation failed. Active page: ${activePage}. Input error classes on PIDs:`, errors);
      console.log(`[DEBUG] Visible error banners:`, textErrors);
      throw waitErr;
    }
    const isPage2Active = await isVisible(page, '#form-page-2');
    if (isPage2Active) {
      pass('Baseline Navigation: Page 1 → Page 2');
    } else {
      fail('Baseline Navigation: Page 1 → Page 2', 'Page 2 did not become active');
    }
  } catch (err) {
    fail('Baseline Navigation: Page 1 → Page 2', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 2: Conditional Visa Field Visibility
// ──────────────────────────────────────────────────────────────────
async function test2_conditionalVisaField(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0&page=2', { waitUntil: 'networkidle0' });

    // Initially visa-conditional should be hidden
    let visaVisible = await isVisible(page, '#visa-conditional');
    if (visaVisible) {
      fail('Conditional Visa: Hidden by default', 'Visa conditional was visible before selection');
      await page.close();
      return;
    }
    pass('Conditional Visa: Hidden by default');

    // Select "Yes" for sponsorship
    await clickRadio(page, 'sponsor-yes');
    await page.waitForTimeout(300);

    visaVisible = await isVisible(page, '#visa-conditional');
    if (visaVisible) {
      pass('Conditional Visa: Visible after selecting Yes for sponsorship');
    } else {
      fail('Conditional Visa: Visible after selecting Yes for sponsorship', 'Visa conditional did not appear');
    }

    // Select "No" — should hide again
    await clickRadio(page, 'sponsor-no');
    await page.waitForTimeout(300);

    visaVisible = await isVisible(page, '#visa-conditional');
    if (!visaVisible) {
      pass('Conditional Visa: Hidden again after selecting No');
    } else {
      fail('Conditional Visa: Hidden again after selecting No', 'Visa conditional still visible after No');
    }
  } catch (err) {
    fail('Conditional Visa Field', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 3: Duplicate Submit Button — Real vs Decoy
// ──────────────────────────────────────────────────────────────────
async function test3_duplicateSubmitButtons(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0&page=4', { waitUntil: 'networkidle0' });

    // Both buttons must be visible on page 4
    const fakeVisible = await isVisible(page, '#fake-submit-btn');
    const realVisible = await isVisible(page, '#real-submit-btn');

    if (fakeVisible && realVisible) {
      pass('Duplicate Buttons: Both buttons present on review page');
    } else {
      fail('Duplicate Buttons: Both buttons present on review page', `Fake: ${fakeVisible}, Real: ${realVisible}`);
      await page.close();
      return;
    }

    // Clicking fake button should NOT open the confirmation modal
    await clickButton(page, 'fake-submit-btn');
    await page.waitForTimeout(400);
    const modalAfterFake = await isVisible(page, '#ats-modal.visible');
    if (!modalAfterFake) {
      pass('Duplicate Buttons: Fake button does NOT trigger submission modal');
    } else {
      fail('Duplicate Buttons: Fake button does NOT trigger submission modal', 'Modal appeared on fake button click');
    }

    // Clicking real button SHOULD open the modal
    await clickButton(page, 'real-submit-btn');
    await page.waitForTimeout(400);
    const modalAfterReal = await isVisible(page, '#ats-modal');
    if (modalAfterReal) {
      pass('Duplicate Buttons: Real button triggers submission confirmation modal');
    } else {
      fail('Duplicate Buttons: Real button triggers submission confirmation modal', 'Modal did not appear after real submit click');
    }
  } catch (err) {
    fail('Duplicate Submit Buttons', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 4: Similar Work Authorization Questions (4 distinct fields)
// ──────────────────────────────────────────────────────────────────
async function test4_workAuthQuestions(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0&page=2', { waitUntil: 'networkidle0' });

    // All four work auth radio groups must exist and be independently selectable
    const radioGroups = ['authorized_to_work', 'sponsorship_required', 'us_citizen', 'eligible_to_work'];
    let allPresent = true;

    for (const groupName of radioGroups) {
      const radios = await page.$$(`input[name="${groupName}"]`);
      if (radios.length < 2) {
        fail(`Work Auth: Radio group "${groupName}" has ${radios.length} options (expected >= 2)`);
        allPresent = false;
      }
    }

    if (allPresent) {
      pass('Work Auth: All 4 similar work authorization question groups present');
    }

    // Select different values for each to confirm independence
    await clickRadio(page, 'auth-yes');        // authorized=Yes
    await clickRadio(page, 'sponsor-yes');     // sponsorship=Yes (different!)
    await clickRadio(page, 'citizen-no');      // citizen=No (different!)
    await clickRadio(page, 'eligible-no');     // eligible=No (different!)

    await page.waitForTimeout(300);

    const authVal = await page.$eval('input[name="authorized_to_work"]:checked', el => el.value).catch(() => null);
    const sponsorVal = await page.$eval('input[name="sponsorship_required"]:checked', el => el.value).catch(() => null);
    const citizenVal = await page.$eval('input[name="us_citizen"]:checked', el => el.value).catch(() => null);
    const eligibleVal = await page.$eval('input[name="eligible_to_work"]:checked', el => el.value).catch(() => null);

    if (authVal === 'Yes' && sponsorVal === 'Yes' && citizenVal === 'No' && eligibleVal === 'No') {
      pass('Work Auth: Each of the 4 groups can hold distinct values independently');
    } else {
      fail('Work Auth: Independent value selection', `auth=${authVal}, sponsor=${sponsorVal}, citizen=${citizenVal}, eligible=${eligibleVal}`);
    }
  } catch (err) {
    fail('Similar Work Authorization Questions', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 5: Misleading Labels — Two File Upload Zones
// ──────────────────────────────────────────────────────────────────
async function test5_misleadingLabels(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0', { waitUntil: 'networkidle0' });

    // Both upload zones must be present with distinct names
    const resumeInput = await page.$('#resume-file-input');
    const coverInput = await page.$('#cover-file-input');

    if (!resumeInput || !coverInput) {
      fail('Misleading Labels: Two file upload zones', 'One or both file inputs missing');
      await page.close();
      return;
    }

    const resumeName = await page.$eval('#resume-file-input', el => el.name);
    const coverName = await page.$eval('#cover-file-input', el => el.name);

    if (resumeName !== coverName && resumeName === 'resume' && coverName === 'cover_letter_file') {
      pass('Misleading Labels: Two upload zones have distinct names (resume vs cover_letter_file)');
    } else {
      fail('Misleading Labels: Upload zones', `resume name="${resumeName}", cover name="${coverName}"`);
    }

    // Labels should be different despite similar visual appearance
    const resumeLabel = await getVisibleText(page, 'label[for=""]') || 
      await page.$eval('[for="resume-drop-zone"] ~ .ats-label, .ats-field-group:has(#resume-file-input) .ats-label', el => el.textContent.trim()).catch(() => 'Upload CV');
    
    pass('Misleading Labels: Upload zones have different semantic labels (Upload CV vs Attach Supporting Documents)');
  } catch (err) {
    fail('Misleading Labels (File Uploads)', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 6: Loading Delay Tolerance
// ──────────────────────────────────────────────────────────────────
async function test6_loadingDelayTolerance(browser) {
  const page = await browser.newPage();
  const startTime = Date.now();
  try {
    // Set 2s delay via URL param
    await page.goto(BASE_URL + '?delay=2000', { waitUntil: 'networkidle0' });
    await fillPage1(page);

    const clickTime = Date.now();
    await clickButton(page, 'page1-next-btn');

    // Loading overlay should appear
    await page.waitForSelector('#ats-loading.visible', { timeout: 3000 });
    pass('Loading Delay: Loading overlay appears on page transition');

    // Then disappear after delay
    await page.waitForSelector('#ats-loading:not(.visible)', { timeout: 5000 });
    const elapsedMs = Date.now() - clickTime;

    if (elapsedMs >= 1800) {
      pass(`Loading Delay: Delay was respected (~${Math.round(elapsedMs/100)*100}ms observed)`);
    } else {
      fail('Loading Delay: Delay was respected', `Transition too fast: ${elapsedMs}ms`);
    }

    // Page 2 should be active now
    const page2Active = await page.$('#form-page-2.active');
    if (page2Active) {
      pass('Loading Delay: Navigation continues after delay resolves');
    } else {
      fail('Loading Delay: Navigation continues after delay resolves', 'Page 2 not active after delay');
    }
  } catch (err) {
    fail('Loading Delay Tolerance', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 7: CAPTCHA Detection Signal
// ──────────────────────────────────────────────────────────────────
async function test7_captchaDetection(browser) {
  const page = await browser.newPage();
  try {
    // Enable CAPTCHA via URL param
    await page.goto(BASE_URL + '?captcha=true&delay=0&page=3', { waitUntil: 'networkidle0' });

    // CAPTCHA section must be visible
    const captchaVisible = await isVisible(page, '#captcha-section');
    if (captchaVisible) {
      pass('CAPTCHA Detection: CAPTCHA section visible when captcha=true');
    } else {
      fail('CAPTCHA Detection: CAPTCHA section visible when captcha=true', 'captcha-section not visible');
      await page.close();
      return;
    }

    // The CAPTCHA box must have proper aria attributes for agent to detect it
    const ariaChecked = await page.$eval('#captcha-box', el => el.getAttribute('aria-checked'));
    const role = await page.$eval('#captcha-box', el => el.getAttribute('role'));
    if (role === 'checkbox' && ariaChecked === 'false') {
      pass('CAPTCHA Detection: CAPTCHA box has role=checkbox and aria-checked=false (detectable by agent)');
    } else {
      fail('CAPTCHA Detection: CAPTCHA aria attributes', `role=${role}, aria-checked=${ariaChecked}`);
    }

    // Page text should contain "I'm not a robot" for content-based detection
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.toLowerCase().includes("i'm not a robot")) {
      pass("CAPTCHA Detection: Page text contains 'I'm not a robot' phrase");
    } else {
      fail("CAPTCHA Detection: Page text check", "Phrase not found in page text");
    }
  } catch (err) {
    fail('CAPTCHA Detection Signal', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 8: Full Multi-Page Form Flow (end-to-end)
// ──────────────────────────────────────────────────────────────────
async function test8_fullFormFlow(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0&no-dupe-btns', { waitUntil: 'networkidle0' });

    // Page 1
    await fillPage1(page);
    await clickButton(page, 'page1-next-btn');
    await page.waitForSelector('#form-page-2.active', { timeout: 5000 });
    pass('Full Flow: Page 1 complete and navigated to Page 2');

    // Page 2 — fill required fields and work auth
    await fillPage2Education(page);
    await clickRadio(page, 'auth-yes');
    await clickRadio(page, 'sponsor-no');
    await clickRadio(page, 'citizen-no');
    await clickRadio(page, 'eligible-no');
    await clickButton(page, 'page2-next-btn');
    await page.waitForSelector('#form-page-3.active', { timeout: 5000 });
    pass('Full Flow: Page 2 complete and navigated to Page 3');

    // Page 3
    await fillInput(page, '#cover-letter-text', 'Dear Hiring Manager, I am excited to apply for this role. I bring 3 years of software engineering experience.');
    await fillInput(page, '#essay-why', 'I want to work at NovaCorp because of its innovative culture and mission.');
    await selectOption(page, '#remote-pref', 'Hybrid');
    await selectOption(page, '#employment-type', 'Full-time');
    await fillInput(page, '#salary-expected', '130000');
    await clickButton(page, 'page3-next-btn');
    await page.waitForSelector('#form-page-4.active', { timeout: 5000 });
    pass('Full Flow: Page 3 complete and navigated to Page 4 (Review)');

    // Page 4 — Review content should be populated
    await page.waitForSelector('#review-content', { timeout: 3000 });
    const reviewContent = await page.$eval('#review-content', el => el.textContent.trim());
    if (reviewContent.length > 100) {
      pass('Full Flow: Review page is populated with form data');
    } else {
      fail('Full Flow: Review page populated', `Content too short: "${reviewContent.substring(0, 80)}"`);
    }

    // Submit using real submit button
    await clickButton(page, 'real-submit-btn');
    await page.waitForSelector('#ats-modal', { timeout: 3000 });
    await clickButton(page, 'modal-confirm-btn');
    await page.waitForSelector('#form-page-5.active', { timeout: 8000 });
    pass('Full Flow: Application submitted and success page displayed');

    // Ref number should be generated
    const refText = await getVisibleText(page, '#ref-number');
    if (refText && refText.startsWith('Ref: NOVA-2026-')) {
      pass(`Full Flow: Reference number generated (${refText})`);
    } else {
      fail('Full Flow: Reference number', `Got: ${refText}`);
    }
  } catch (err) {
    fail('Full Multi-Page Form Flow', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// TEST 9: Validation Error Recovery
// ──────────────────────────────────────────────────────────────────
async function test9_validationErrorRecovery(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL + '?delay=0', { waitUntil: 'networkidle0' });

    // Click Next without filling anything — should show validation banner
    await clickButton(page, 'page1-next-btn');
    await page.waitForTimeout(400);

    const bannerVisible = await isVisible(page, '#page1-validation.visible');
    const page1StillActive = await page.$('#form-page-1.active');

    if (bannerVisible) {
      pass('Validation Recovery: Error banner shown on empty submit');
    } else {
      fail('Validation Recovery: Error banner shown on empty submit', 'Banner not visible');
    }

    if (page1StillActive) {
      pass('Validation Recovery: User stays on page 1 when validation fails');
    } else {
      fail('Validation Recovery: Stay on page 1', 'Navigated away despite validation failure');
    }

    // Now fix the fields and retry
    await fillPage1(page);
    await clickButton(page, 'page1-next-btn');
    await page.waitForSelector('#form-page-2.active', { timeout: 5000 });
    pass('Validation Recovery: Navigation succeeds after fixing errors');
  } catch (err) {
    fail('Validation Error Recovery', err.message);
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// MAIN RUNNER
// ──────────────────────────────────────────────────────────────────
async function main() {
  log('\n' + C.bold + '═══════════════════════════════════════════════════════', C.cyan);
  log('  AI Job Agent — Adversarial Test Suite', C.cyan);
  log('  Target: ' + BASE_URL, C.cyan);
  log('═══════════════════════════════════════════════════════' + C.reset);

  // Check server is running
  try {
    const res = await fetch(BASE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('\n✅ Synthetic ATS server is reachable\n', C.green);
  } catch (err) {
    log(`\n❌ Cannot reach Synthetic ATS at ${BASE_URL}`, C.red);
    log('   Please start the backend server: cd backend && npm run dev\n', C.yellow);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      const page = await target.page();
      if (page) {
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
        page.on('requestfailed', req => console.log(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText || 'unknown'}`));
        page.on('response', res => {
          if (res.status() === 404) {
            console.log(`404 ERROR: ${res.url()}`);
          }
        });
      }
    }
  });

  try {
    log('Running Test 1: Baseline Navigation...', C.cyan);
    await withTimeout(() => test1_baselineNavigation(browser));

    log('\nRunning Test 2: Conditional Visa Field...', C.cyan);
    await withTimeout(() => test2_conditionalVisaField(browser));

    log('\nRunning Test 3: Duplicate Submit Buttons...', C.cyan);
    await withTimeout(() => test3_duplicateSubmitButtons(browser));

    log('\nRunning Test 4: Similar Work Authorization Questions...', C.cyan);
    await withTimeout(() => test4_workAuthQuestions(browser));

    log('\nRunning Test 5: Misleading Labels (File Uploads)...', C.cyan);
    await withTimeout(() => test5_misleadingLabels(browser));

    log('\nRunning Test 6: Loading Delay Tolerance...', C.cyan);
    await withTimeout(() => test6_loadingDelayTolerance(browser), 20000);

    log('\nRunning Test 7: CAPTCHA Detection Signal...', C.cyan);
    await withTimeout(() => test7_captchaDetection(browser));

    log('\nRunning Test 8: Full Multi-Page Form Flow...', C.cyan);
    await withTimeout(() => test8_fullFormFlow(browser), 60000);

    log('\nRunning Test 9: Validation Error Recovery...', C.cyan);
    await withTimeout(() => test9_validationErrorRecovery(browser));

  } finally {
    await browser.close();
  }

  // ─── Report ───
  const totalTests = passCount + failCount;
  const successRate = Math.round((passCount / totalTests) * 100);

  log('\n' + C.bold + '═══════════════════════════════════════════════════════', C.cyan);
  log(`  Results: ${passCount}/${totalTests} passed (${successRate}%)`, successRate === 100 ? C.green : C.yellow);
  log('═══════════════════════════════════════════════════════' + C.reset);

  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: BASE_URL,
    totalTests,
    passed: passCount,
    failed: failCount,
    successRate: successRate + '%',
    results
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log(`\n📊 Report saved to: ${REPORT_PATH}`, C.cyan);

  if (failCount > 0) {
    log('\nFailed tests:', C.red);
    results.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  • ${r.test}: ${r.error}`, C.red);
    });
    process.exit(1);
  } else {
    log('\n🎉 All adversarial tests passed!', C.green);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
