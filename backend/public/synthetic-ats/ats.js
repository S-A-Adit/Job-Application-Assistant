// ats.js — Synthetic ATS controller
// Supports query params: ?mode=adversarial&delay=2000&skin=workday&company=Acme

(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') || 'normal';
  const skin = params.get('skin') || 'default';
  const networkDelay = parseInt(params.get('delay') || '0', 10);
  const company = params.get('company') || 'TechCorp Inc.';
  const role = params.get('role') || 'Software Engineer — Full Stack';

  // Apply skin
  if (skin && skin !== 'default') {
    document.body.classList.add('skin-' + skin);
  }

  // Apply company/role customization
  const companyEl = document.getElementById('ats-company-name');
  const roleEl = document.getElementById('ats-job-title');
  if (companyEl) companyEl.textContent = company;
  if (roleEl) roleEl.textContent = role;

  // Adversarial mode: show duplicate button, inject misleading elements
  if (mode === 'adversarial') {
    const modeBanner = document.getElementById('mode-banner');
    if (modeBanner) {
      modeBanner.textContent = '⚠ ADVERSARIAL MODE — Duplicate buttons, conditional traps, and misleading labels are active';
      modeBanner.style.display = 'block';
      document.body.style.paddingTop = '40px';
    }
    // Reveal decoy continue button on page 1
    const decoy = document.getElementById('page1-continue-decoy');
    if (decoy) decoy.style.display = 'inline-block';
    // Inject a random slow-loading spinner after 500ms (simulates dynamic DOM)
    setTimeout(() => {
      const container = document.getElementById('page-1');
      if (container) {
        const trap = document.createElement('div');
        trap.style.cssText = 'margin-top:12px;font-size:0.78rem;color:#94a3b8;display:flex;align-items:center;gap:8px;';
        trap.innerHTML = '<div style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.15);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;"></div> Loading additional form fields...';
        container.querySelector('.form-nav')?.before(trap);
        setTimeout(() => trap.remove(), 3000);
      }
    }, 500);
  }

  // Conditional visa field logic
  const sponsorshipRadios = document.querySelectorAll('input[name="sponsorship_required"]');
  const visaTypeField = document.getElementById('visa-type-field');
  sponsorshipRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (visaTypeField) {
        visaTypeField.style.display = radio.value === 'Yes' ? 'block' : 'none';
      }
    });
  });

  // Resume upload preview
  const resumeInput = document.getElementById('resume-upload');
  const resumePreview = document.getElementById('resume-preview');
  if (resumeInput && resumePreview) {
    resumeInput.addEventListener('change', () => {
      const file = resumeInput.files[0];
      resumePreview.textContent = file ? `✅ ${file.name} (${(file.size / 1024).toFixed(1)} KB)` : 'No file selected';
    });
  }

  // Page navigation
  let currentPage = 1;
  const totalPages = 6;

  window.goToPage = function(page) {
    if (networkDelay > 0) {
      // Simulate loading delay
      const nav = document.querySelector(`#page-${currentPage} .form-nav .ats-btn-primary`);
      if (nav) {
        nav.textContent = 'Loading...';
        nav.setAttribute('disabled', 'true');
      }
      setTimeout(() => {
        navigateToPage(page);
        if (nav) {
          nav.removeAttribute('disabled');
        }
      }, networkDelay);
    } else {
      navigateToPage(page);
    }
  };

  function navigateToPage(page) {
    document.getElementById(`page-${currentPage}`)?.classList.remove('active');
    currentPage = page;
    const target = document.getElementById(`page-${page}`);
    if (target) {
      target.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Update progress steps
    document.querySelectorAll('.ats-step').forEach(step => {
      const stepNum = parseInt(step.dataset.step);
      step.classList.remove('active', 'completed');
      if (stepNum === page) step.classList.add('active');
      else if (stepNum < page) step.classList.add('completed');
    });
    // Build review on last page
    if (page === 6) buildReview();
  }

  window.showDecoyError = function() {
    showModal('This button does not submit the form. Please use the correct "Continue" button.');
  };

  window.showModal = function(msg) {
    const modal = document.getElementById('error-modal');
    const text = document.getElementById('modal-error-text');
    if (modal && text) {
      text.textContent = msg || 'Please complete all required fields before continuing.';
      modal.style.display = 'flex';
    }
  };

  window.closeModal = function() {
    const modal = document.getElementById('error-modal');
    if (modal) modal.style.display = 'none';
  };

  window.submitApplication = function() {
    const certify = document.getElementById('certify-checkbox');
    if (!certify || !certify.checked) {
      showModal('You must certify the information is accurate before submitting.');
      return;
    }

    const submitNav = document.getElementById('submit-nav');
    const loader = document.getElementById('submit-loader');
    const success = document.getElementById('submit-success');

    if (submitNav) submitNav.style.display = 'none';
    if (loader) loader.style.display = 'flex';

    const delay = networkDelay > 0 ? networkDelay : 1800;
    setTimeout(() => {
      if (loader) loader.style.display = 'none';
      if (success) {
        success.style.display = 'block';
        const refEl = document.getElementById('app-ref');
        if (refEl) refEl.textContent = 'ATS-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      }
    }, delay);
  };

  // Review builder
  function buildReview() {
    const container = document.getElementById('review-summary');
    if (!container) return;

    const fields = [
      { label: 'First Name', id: 'first-name' },
      { label: 'Last Name', id: 'last-name' },
      { label: 'Email', id: 'email-address' },
      { label: 'Phone', id: 'phone-number' },
      { label: 'LinkedIn', id: 'linkedin-url' },
      { label: 'City', id: 'city-field' },
      { label: 'State', id: 'state-field' },
      { label: 'Country', id: 'country-field' },
      { label: 'Work Authorization', name: 'work_authorized' },
      { label: 'Sponsorship Required', name: 'sponsorship_required' },
      { label: 'Visa Type', id: 'visa-type' },
      { label: 'Resume', id: 'resume-upload', isFile: true },
      { label: 'School', id: 'school-name' },
      { label: 'Degree', id: 'degree-level' },
      { label: 'Major', id: 'field-of-study' },
      { label: 'Graduation Year', id: 'graduation-year' },
      { label: 'Employer', id: 'recent-employer' },
      { label: 'Job Title', id: 'job-title' },
      { label: 'Years of Experience', id: 'years-experience' },
      { label: 'Expected Salary', id: 'expected-salary' },
      { label: 'Why Interested', id: 'why-interested' },
      { label: 'Greatest Strength', id: 'greatest-strength' },
      { label: 'Remote Preference', id: 'remote-preference' },
      { label: 'Gender', id: 'gender-select' },
      { label: 'Race / Ethnicity', id: 'ethnicity-select' },
    ];

    let html = '';
    for (const f of fields) {
      let value = '';
      if (f.id) {
        const el = document.getElementById(f.id);
        if (el) {
          if (f.isFile) {
            value = el.files[0]?.name || '—';
          } else {
            value = el.value?.trim() || '—';
          }
        }
      } else if (f.name) {
        const checked = document.querySelector(`input[name="${f.name}"]:checked`);
        value = checked?.value || '—';
      }
      if (value && value !== '—') {
        html += `<div class="review-row"><span class="review-label">${f.label}</span><span class="review-value">${value.length > 100 ? value.substring(0, 100) + '...' : value}</span></div>`;
      }
    }

    container.innerHTML = html || '<div class="review-placeholder">No data entered yet. Please go back and fill in required fields.</div>';
  }

})();
