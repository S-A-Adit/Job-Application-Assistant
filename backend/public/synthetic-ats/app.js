/**
 * app.js — Synthetic ATS Application Logic
 * AI Job Agent Test Environment
 *
 * Features:
 *  - Multi-page wizard with step tracking
 *  - Field validation with error display
 *  - Conditional visa field (shown only when sponsorship = Yes)
 *  - Adversarial: duplicate submit buttons (one is a decoy)
 *  - Adversarial: CAPTCHA block (controllable via panel)
 *  - Adversarial: loading delay on page transitions (controllable)
 *  - Adversarial: trigger validation errors flag
 *  - File upload drop zones
 *  - Radio option visual selection state
 *  - Review page population from all collected form data
 *  - Session storage to persist values across pages
 *  - Benchmark data emission to parent extension via postMessage
 */

'use strict';

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
let currentPage = 1;
const totalPages = 5; // 4 form pages + 1 success

const state = {
  captchaEnabled: false,
  captchaChecked: false,
  errorsMode: false,
  dupeBtnsEnabled: true,
  conditionalEnabled: true,
  delay: 2000,
};

// ──────────────────────────────────────────────
// DOM REFERENCES
// ──────────────────────────────────────────────
const loadingOverlay = document.getElementById('ats-loading');
const loadingText = document.getElementById('loading-text');
const modal = document.getElementById('ats-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

// ──────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────
function showLoading(message) {
  loadingText.textContent = message || 'Processing...';
  loadingOverlay.classList.add('visible');
}

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

function showModal(title, body, onConfirm) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modal.classList.add('visible');
  modalConfirmBtn.onclick = () => {
    modal.classList.remove('visible');
    onConfirm();
  };
  modalCancelBtn.onclick = () => {
    modal.classList.remove('visible');
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setError(fieldId, show) {
  const errEl = document.getElementById(fieldId + '-error');
  const inputEl = document.getElementById(fieldId);
  if (errEl) errEl.classList.toggle('visible', show);
  if (inputEl) inputEl.classList.toggle('error', show);
}

function clearError(fieldId) {
  setError(fieldId, false);
}

// ──────────────────────────────────────────────
// PAGE NAVIGATION
// ──────────────────────────────────────────────
function goToPage(pageNum) {
  console.log("goToPage called, pageNum =", pageNum);
  // Hide all pages
  for (let i = 1; i <= totalPages; i++) {
    const page = document.getElementById('form-page-' + i);
    if (page) page.classList.remove('active');
  }

  // Show target page
  const target = document.getElementById('form-page-' + pageNum);
  if (target) target.classList.add('active');

  // Update stepper (only steps 1-4)
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById('step-indicator-' + i);
    const connEl = document.getElementById('connector-' + i);
    if (!stepEl) continue;

    stepEl.classList.remove('active', 'completed');
    if (i < pageNum) {
      stepEl.classList.add('completed');
      stepEl.querySelector('.ats-step-circle').textContent = '✓';
    } else if (i === pageNum) {
      stepEl.classList.add('active');
      stepEl.querySelector('.ats-step-circle').textContent = String(i);
    } else {
      stepEl.querySelector('.ats-step-circle').textContent = String(i);
    }

    if (connEl) {
      connEl.classList.toggle('completed', i < pageNum);
    }
  }

  document.getElementById('ctrl-page-display').textContent = Math.min(pageNum, 4);

  // Populate review page when arriving at page 4
  if (pageNum === 4) {
    populateReviewPage();
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
  currentPage = pageNum;
}

// ──────────────────────────────────────────────
// VALIDATION
// ──────────────────────────────────────────────
function validatePage1() {
  console.log("validatePage1 called!");
  let valid = true;

  const required = [
    { id: 'first-name', check: () => getVal('first-name').length > 0 },
    { id: 'last-name', check: () => getVal('last-name').length > 0 },
    { id: 'email', check: () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(getVal('email')) },
    { id: 'phone', check: () => getVal('phone').length >= 7 },
    { id: 'address-street', check: () => getVal('address-street').length > 0 },
    { id: 'address-city', check: () => getVal('address-city').length > 0 },
    { id: 'address-state', check: () => getVal('address-state').length > 0 },
    { id: 'address-zip', check: () => getVal('address-zip').length > 0 },
  ];

  required.forEach(({ id, check }) => {
    const ok = check();
    setError(id, !ok);
    if (!ok) valid = false;
  });

  // Resume file check
  const resumeInput = document.getElementById('resume-file-input');
  const hasResume = resumeInput && resumeInput.files.length > 0;
  // In errorsMode, treat resume as missing to force validation error
  const resumeOk = state.errorsMode ? false : (hasResume || true); // Allow skip in test
  setError('resume', !resumeOk);
  if (!resumeOk) valid = false;

  const banner = document.getElementById('page1-validation');
  banner.classList.toggle('visible', !valid);
  return valid;
}

function validatePage2() {
  let valid = true;

  const required = [
    { id: 'edu-school', check: () => getVal('edu-school').length > 0 },
    { id: 'edu-degree', check: () => getVal('edu-degree').length > 0 },
    { id: 'edu-major', check: () => getVal('edu-major').length > 0 },
    { id: 'edu-grad-year', check: () => getVal('edu-grad-year').length > 0 },
    { id: 'years-experience', check: () => getVal('years-experience').length > 0 },
    { id: 'availability-date', check: () => getVal('availability-date').length > 0 },
  ];

  required.forEach(({ id, check }) => {
    const ok = check();
    setError(id, !ok);
    if (!ok) valid = false;
  });

  // Radio validation
  const authAnswered = !!document.querySelector('input[name="authorized_to_work"]:checked');
  const sponsorAnswered = !!document.querySelector('input[name="sponsorship_required"]:checked');
  const citizenAnswered = !!document.querySelector('input[name="us_citizen"]:checked');
  const eligibleAnswered = !!document.querySelector('input[name="eligible_to_work"]:checked');

  const authErrEl = document.getElementById('authorized-error');
  const sponsorErrEl = document.getElementById('sponsorship-error');
  const citizenErrEl = document.getElementById('citizen-error');
  const eligibleErrEl = document.getElementById('eligible-error');

  if (authErrEl) authErrEl.classList.toggle('visible', !authAnswered);
  if (sponsorErrEl) sponsorErrEl.classList.toggle('visible', !sponsorAnswered);
  if (citizenErrEl) citizenErrEl.classList.toggle('visible', !citizenAnswered);
  if (eligibleErrEl) eligibleErrEl.classList.toggle('visible', !eligibleAnswered);

  if (!authAnswered || !sponsorAnswered || !citizenAnswered || !eligibleAnswered) valid = false;

  // If errorsMode: force fail
  if (state.errorsMode) {
    valid = false;
    document.getElementById('page2-validation').classList.add('visible');
    return false;
  }

  document.getElementById('page2-validation').classList.toggle('visible', !valid);
  return valid;
}

function validatePage3() {
  let valid = true;

  const required = [
    { id: 'cover-letter-text', check: () => getVal('cover-letter-text').length > 10 },
    { id: 'essay-why', check: () => getVal('essay-why').length > 5 },
    { id: 'remote-pref', check: () => getVal('remote-pref').length > 0 },
    { id: 'employment-type', check: () => getVal('employment-type').length > 0 },
    { id: 'salary-expected', check: () => getVal('salary-expected').length > 0 },
  ];

  required.forEach(({ id, check }) => {
    const ok = check();
    setError(id, !ok);
    if (!ok) valid = false;
  });

  // CAPTCHA check
  if (state.captchaEnabled && !state.captchaChecked) {
    const captchaErr = document.getElementById('captcha-error');
    if (captchaErr) captchaErr.classList.add('visible');
    valid = false;
  }

  document.getElementById('page3-validation').classList.toggle('visible', !valid);
  return valid;
}

// ──────────────────────────────────────────────
// PAGE TRANSITION HANDLER
// ──────────────────────────────────────────────
async function handleNextPage() {
  console.log("handleNextPage called! currentPage =", currentPage);
  let isValid = false;

  if (currentPage === 1) isValid = validatePage1();
  else if (currentPage === 2) isValid = validatePage2();
  else if (currentPage === 3) isValid = validatePage3();
  else isValid = true;

  if (!isValid) return;

  const delayMs = parseInt(state.delay, 10) || 0;
  if (delayMs > 0) {
    showLoading('Saving your progress...');
    await delay(delayMs);
    hideLoading();
  }

  goToPage(currentPage + 1);
}

function handlePrevPage() {
  if (currentPage > 1) {
    goToPage(currentPage - 1);
  }
}

// ──────────────────────────────────────────────
// REVIEW PAGE POPULATION
// ──────────────────────────────────────────────
function populateReviewPage() {
  const container = document.getElementById('review-content');
  if (!container) return;

  const rows = [
    { label: 'Full Name', value: `${getVal('first-name')} ${getVal('last-name')}`.trim() },
    { label: 'Preferred Name', value: getVal('preferred-name') || 'N/A' },
    { label: 'Email', value: getVal('email') },
    { label: 'Phone', value: getVal('phone') },
    { label: 'Address', value: [getVal('address-street'), getVal('address-city'), getVal('address-state'), getVal('address-zip')].filter(Boolean).join(', ') },
    { label: 'LinkedIn', value: getVal('linkedin-url') || 'N/A' },
    { label: 'GitHub', value: getVal('github-url') || 'N/A' },
    { label: 'Resume', value: (document.getElementById('resume-file-input')?.files?.[0]?.name) || '(none uploaded)' },
    { label: 'Education', value: `${getVal('edu-degree')}, ${getVal('edu-major')} at ${getVal('edu-school')} (${getVal('edu-grad-year')})` },
    { label: 'Experience', value: getVal('years-experience') + ' years' },
    { label: 'Authorized to Work', value: (document.querySelector('input[name="authorized_to_work"]:checked')?.value) || 'Not answered' },
    { label: 'Visa Sponsorship Required', value: (document.querySelector('input[name="sponsorship_required"]:checked')?.value) || 'Not answered' },
    { label: 'Visa Type', value: getVal('visa-type') || 'N/A' },
    { label: 'US Citizen', value: (document.querySelector('input[name="us_citizen"]:checked')?.value) || 'Not answered' },
    { label: 'Eligible to Work (Permanent)', value: (document.querySelector('input[name="eligible_to_work"]:checked')?.value) || 'Not answered' },
    { label: 'Start Date', value: getVal('availability-date') },
    { label: 'Remote Preference', value: getVal('remote-pref') },
    { label: 'Employment Type', value: getVal('employment-type') },
    { label: 'Desired Salary', value: getVal('salary-expected') ? `$${getVal('salary-expected')}` : 'N/A' },
    { label: 'Current Compensation', value: getVal('salary-current') ? `$${getVal('salary-current')}` : 'Not provided' },
    { label: 'Notice Period', value: getVal('notice-period') || 'Not specified' },
    { label: 'Gender', value: getVal('gender-identity') },
    { label: 'Race / Ethnicity', value: getVal('race-ethnicity') },
    { label: 'Veteran Status', value: getVal('veteran-status') },
    { label: 'Disability Status', value: getVal('disability-status') },
  ];

  // Group into sections
  const sections = [
    { title: 'Personal Information', icon: '👤', fields: rows.slice(0, 8) },
    { title: 'Background', icon: '🎓', fields: rows.slice(8, 14) },
    { title: 'Questions & Preferences', icon: '💬', fields: rows.slice(14) },
  ];

  container.innerHTML = sections.map(sec => `
    <div style="margin-bottom:24px;">
      <div style="font-size:0.8rem; font-weight:700; color:var(--ats-text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
        ${sec.icon} ${sec.title}
      </div>
      <div style="border:1px solid var(--ats-border); border-radius:6px; overflow:hidden;">
        ${sec.fields.map((r, i) => `
          <div style="display:grid; grid-template-columns:180px 1fr; border-bottom:${i < sec.fields.length - 1 ? '1px solid var(--ats-border)' : 'none'}; padding:10px 14px; background:${i % 2 === 0 ? '#fff' : '#fafbfc'};">
            <div style="font-size:0.8rem; font-weight:600; color:var(--ats-text-secondary);">${r.label}</div>
            <div style="font-size:0.85rem; color:var(--ats-text); word-break:break-word;">${r.value || '<span style="color:var(--ats-text-secondary); font-style:italic;">Not provided</span>'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Cover letter summary
  const clText = getVal('cover-letter-text');
  if (clText) {
    container.innerHTML += `
      <div style="margin-bottom:24px;">
        <div style="font-size:0.8rem; font-weight:700; color:var(--ats-text-secondary); text-transform:uppercase; margin-bottom:10px;">📝 Cover Letter Preview</div>
        <div style="border:1px solid var(--ats-border); border-radius:6px; padding:14px; background:#fff; font-size:0.83rem; color:var(--ats-text); line-height:1.7; max-height:160px; overflow-y:auto; white-space:pre-wrap;">${clText.substring(0, 600)}${clText.length > 600 ? '...' : ''}</div>
      </div>
    `;
  }

  // Duplicate submit buttons management
  const fakeBtn = document.getElementById('fake-submit-btn');
  if (fakeBtn) {
    fakeBtn.style.display = state.dupeBtnsEnabled ? 'inline-flex' : 'none';
  }
}

// ──────────────────────────────────────────────
// SUBMIT
// ──────────────────────────────────────────────
async function handleSubmit() {
  showLoading('Submitting your application...');
  await delay(parseInt(state.delay, 10) || 1500);
  hideLoading();

  // Generate reference number
  const refNum = 'NOVA-2026-' + String(Math.floor(Math.random() * 999999)).padStart(6, '0');
  const refEl = document.getElementById('ref-number');
  if (refEl) refEl.textContent = 'Ref: ' + refNum;

  // Emit benchmark event for the extension to capture
  const formData = collectAllFormData();
  try {
    window.postMessage({
      type: 'SYNTHETIC_ATS_SUBMIT',
      source: 'synthetic-ats',
      refNumber: refNum,
      formData,
      timestamp: new Date().toISOString()
    }, '*');
  } catch (e) { /* Extension not present */ }

  goToPage(5);
}

function collectAllFormData() {
  const radios = {};
  document.querySelectorAll('input[type="radio"]:checked').forEach(r => {
    radios[r.name] = r.value;
  });
  const resumeFile = document.getElementById('resume-file-input')?.files?.[0];
  return {
    firstName: getVal('first-name'),
    lastName: getVal('last-name'),
    preferredName: getVal('preferred-name'),
    email: getVal('email'),
    phone: getVal('phone'),
    addressStreet: getVal('address-street'),
    addressCity: getVal('address-city'),
    addressState: getVal('address-state'),
    postalCode: getVal('address-zip'),
    country: getVal('address-country'),
    linkedinUrl: getVal('linkedin-url'),
    githubUrl: getVal('github-url'),
    portfolioUrl: getVal('portfolio-url'),
    resumeFilename: resumeFile?.name || null,
    eduSchool: getVal('edu-school'),
    eduDegree: getVal('edu-degree'),
    eduMajor: getVal('edu-major'),
    eduGradYear: getVal('edu-grad-year'),
    eduGpa: getVal('edu-gpa'),
    yearsExperience: getVal('years-experience'),
    authorizedToWork: radios['authorized_to_work'],
    sponsorshipRequired: radios['sponsorship_required'],
    visaType: getVal('visa-type'),
    visaExpiry: getVal('visa-expiry'),
    usCitizen: radios['us_citizen'],
    eligibleToWork: radios['eligible_to_work'],
    availabilityDate: getVal('availability-date'),
    willingToRelocate: getVal('willing-relocate'),
    coverLetter: getVal('cover-letter-text'),
    essayWhy: getVal('essay-why'),
    essayTechnical: getVal('essay-technical'),
    remotePreference: getVal('remote-pref'),
    employmentType: getVal('employment-type'),
    currentCompensation: getVal('salary-current'),
    desiredSalary: getVal('salary-expected'),
    noticePeriod: getVal('notice-period'),
    gender: getVal('gender-identity'),
    race: getVal('race-ethnicity'),
    veteranStatus: getVal('veteran-status'),
    disabilityStatus: getVal('disability-status'),
  };
}

// ──────────────────────────────────────────────
// FILE UPLOAD ZONES
// ──────────────────────────────────────────────
function setupFileZone(zoneId, inputId, nameDisplayId, browseId) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const nameDisplay = document.getElementById(nameDisplayId);
  const browse = document.getElementById(browseId);

  if (!zone || !input) return;

  const onFile = (file) => {
    if (!file) return;
    zone.classList.add('has-file');
    if (nameDisplay) nameDisplay.textContent = '✓ ' + file.name;
  };

  browse?.addEventListener('click', () => input.click());
  zone.addEventListener('click', (e) => {
    if (e.target !== browse) input.click();
  });

  input.addEventListener('change', () => {
    if (input.files[0]) onFile(input.files[0]);
  });

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      onFile(file);
    }
  });
}

// ──────────────────────────────────────────────
// RADIO OPTION SELECTION STYLING
// ──────────────────────────────────────────────
function setupRadioGroups() {
  document.querySelectorAll('.ats-radio-option input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      // Remove selected from siblings
      const groupName = radio.name;
      document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
        r.closest('.ats-radio-option')?.classList.remove('selected');
      });
      radio.closest('.ats-radio-option')?.classList.add('selected');

      // Conditional fields
      if (groupName === 'sponsorship_required' && state.conditionalEnabled) {
        const visaConditional = document.getElementById('visa-conditional');
        if (visaConditional) {
          visaConditional.classList.toggle('visible', radio.value === 'Yes');
        }
      }

      // Clear error on radio groups
      const errId = {
        authorized_to_work: 'authorized-error',
        sponsorship_required: 'sponsorship-error',
        us_citizen: 'citizen-error',
        eligible_to_work: 'eligible-error',
      }[groupName];

      if (errId) {
        const errEl = document.getElementById(errId);
        if (errEl) errEl.classList.remove('visible');
      }
    });
  });
}

// ──────────────────────────────────────────────
// CAPTCHA BOX
// ──────────────────────────────────────────────
function setupCaptcha() {
  const box = document.getElementById('captcha-box');
  if (!box) return;

  const toggle = () => {
    if (!state.captchaEnabled) return;
    state.captchaChecked = !state.captchaChecked;
    box.classList.toggle('checked', state.captchaChecked);
    box.setAttribute('aria-checked', String(state.captchaChecked));
    const icon = document.getElementById('captcha-check-icon');
    if (icon) icon.style.display = state.captchaChecked ? 'block' : 'none';
    if (state.captchaChecked) {
      const errEl = document.getElementById('captcha-error');
      if (errEl) errEl.classList.remove('visible');
    }
  };

  box.addEventListener('click', toggle);
  box.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
}

// ──────────────────────────────────────────────
// FAKE SUBMIT BUTTON (Adversarial)
// ──────────────────────────────────────────────
function setupFakeSubmitBtn() {
  const fakeBtn = document.getElementById('fake-submit-btn');
  if (!fakeBtn) return;

  let fakeClickCount = 0;
  fakeBtn.addEventListener('click', () => {
    fakeClickCount++;
    fakeBtn.textContent = fakeClickCount === 1
      ? 'Loading... Please wait'
      : fakeClickCount === 2
      ? 'Submit Application'
      : 'Submit Application';

    if (fakeClickCount >= 2) {
      // Reset after 2 seconds to look like a flicker
      setTimeout(() => {
        fakeBtn.textContent = 'Submit Application';
        fakeClickCount = 0;
      }, 2000);
    }

    // Emit event for agent testing — clicking decoy button
    window.postMessage({
      type: 'SYNTHETIC_ATS_DECOY_CLICK',
      source: 'synthetic-ats',
      button: 'fake-submit-btn',
      timestamp: new Date().toISOString()
    }, '*');
  });
}

// ──────────────────────────────────────────────
// REAL SUBMIT BUTTON
// ──────────────────────────────────────────────
function setupRealSubmitBtn() {
  const realBtn = document.getElementById('real-submit-btn');
  if (!realBtn) return;

  realBtn.addEventListener('click', () => {
    showModal(
      'Confirm Application Submission',
      'Are you ready to submit your application to NovaCorp? This action cannot be undone.',
      handleSubmit
    );
  });
}

// ──────────────────────────────────────────────
// CONTROL PANEL
// ──────────────────────────────────────────────
function setupControlPanel() {
  // Delay selector
  const delayCtrl = document.getElementById('ctrl-delay');
  if (delayCtrl) {
    delayCtrl.addEventListener('change', () => {
      state.delay = parseInt(delayCtrl.value, 10);
    });
    state.delay = parseInt(delayCtrl.value, 10);
  }

  // CAPTCHA toggle
  const captchaToggle = document.getElementById('ctrl-captcha');
  if (captchaToggle) {
    captchaToggle.addEventListener('click', () => {
      state.captchaEnabled = !state.captchaEnabled;
      captchaToggle.classList.toggle('on', state.captchaEnabled);
      captchaToggle.setAttribute('aria-pressed', String(state.captchaEnabled));
      const captchaSection = document.getElementById('captcha-section');
      if (captchaSection) {
        captchaSection.style.display = state.captchaEnabled ? 'flex' : 'none';
      }
      if (!state.captchaEnabled) {
        state.captchaChecked = false;
        const box = document.getElementById('captcha-box');
        if (box) box.classList.remove('checked');
        const icon = document.getElementById('captcha-check-icon');
        if (icon) icon.style.display = 'none';
      }
    });
  }

  // Errors toggle
  const errorsToggle = document.getElementById('ctrl-errors');
  if (errorsToggle) {
    errorsToggle.addEventListener('click', () => {
      state.errorsMode = !state.errorsMode;
      errorsToggle.classList.toggle('on', state.errorsMode);
      errorsToggle.setAttribute('aria-pressed', String(state.errorsMode));
    });
  }

  // Dupe buttons toggle
  const dupeToggle = document.getElementById('ctrl-dupe-btns');
  if (dupeToggle) {
    dupeToggle.addEventListener('click', () => {
      state.dupeBtnsEnabled = !state.dupeBtnsEnabled;
      dupeToggle.classList.toggle('on', state.dupeBtnsEnabled);
      dupeToggle.setAttribute('aria-pressed', String(state.dupeBtnsEnabled));
      const fakeBtn = document.getElementById('fake-submit-btn');
      if (fakeBtn) fakeBtn.style.display = state.dupeBtnsEnabled ? 'inline-flex' : 'none';
    });
  }

  // Conditional fields toggle
  const condToggle = document.getElementById('ctrl-conditional');
  if (condToggle) {
    condToggle.addEventListener('click', () => {
      state.conditionalEnabled = !state.conditionalEnabled;
      condToggle.classList.toggle('on', state.conditionalEnabled);
      condToggle.setAttribute('aria-pressed', String(state.conditionalEnabled));
      const visaConditional = document.getElementById('visa-conditional');
      if (visaConditional && !state.conditionalEnabled) {
        visaConditional.classList.remove('visible');
      }
    });
  }
}

// ──────────────────────────────────────────────
// NEXT / PREV BUTTON DELEGATION
// ──────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  if (action === 'next-page') handleNextPage();
  else if (action === 'prev-page') handlePrevPage();
});

// ──────────────────────────────────────────────
// INPUT LIVE VALIDATION (clear errors on type)
// ──────────────────────────────────────────────
document.querySelectorAll('.ats-input, .ats-select, .ats-textarea').forEach(el => {
  const fieldId = el.id;
  el.addEventListener('input', () => {
    if (el.value.trim().length > 0) {
      clearError(fieldId);
    }
  });
  el.addEventListener('change', () => {
    if (el.value.trim().length > 0) {
      el.classList.remove('error');
      el.classList.add('filled');
    }
  });
});

// ──────────────────────────────────────────────
// URL PARAMS — Support automated test config
// ──────────────────────────────────────────────
function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);

  const delayParam = params.get('delay');
  if (delayParam !== null) {
    const d = parseInt(delayParam, 10);
    state.delay = isNaN(d) ? 0 : d;
    const delayCtrl = document.getElementById('ctrl-delay');
    if (delayCtrl) delayCtrl.value = String(state.delay);
  }

  if (params.get('captcha') === 'true') {
    const captchaToggle = document.getElementById('ctrl-captcha');
    if (captchaToggle) captchaToggle.click();
  }

  if (params.get('errors') === 'true') {
    const errorsToggle = document.getElementById('ctrl-errors');
    if (errorsToggle) errorsToggle.click();
  }

  if (params.get('no-dupe-btns') === 'true') {
    const dupeToggle = document.getElementById('ctrl-dupe-btns');
    if (dupeToggle) dupeToggle.click();
  }

  if (params.get('no-conditional') === 'true') {
    const condToggle = document.getElementById('ctrl-conditional');
    if (condToggle) condToggle.click();
  }

  // Jump to specific page (for focused testing)
  const pageParam = params.get('page');
  if (pageParam) {
    const p = parseInt(pageParam, 10);
    if (p >= 1 && p <= 4) goToPage(p);
  }
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupFileZone('resume-drop-zone', 'resume-file-input', 'resume-file-name', 'resume-browse-link');
  setupFileZone('cover-drop-zone', 'cover-file-input', 'cover-file-name', 'cover-browse-link');
  setupRadioGroups();
  setupCaptcha();
  setupFakeSubmitBtn();
  setupRealSubmitBtn();
  setupControlPanel();
  applyUrlParams();

  // Hide control panel in automated test environments to prevent overlapping the buttons
  if (navigator.webdriver) {
    const cp = document.getElementById('control-panel');
    if (cp) cp.style.display = 'none';
  }

  // Announce to extension that the synthetic ATS is ready
  window.postMessage({
    type: 'SYNTHETIC_ATS_READY',
    source: 'synthetic-ats',
    timestamp: new Date().toISOString()
  }, '*');
});
