// dashboard.js - Script for the Full-Tab AI Job Agent Home Dashboard

// Chrome API Mock for local preview & testing
if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
  let mockResumeFile = {
    filename: "sample_reference_resume.pdf",
    base64Data: "JVBERi0xLjQKJ...",
    updatedAt: new Date().toISOString()
  };

  window.chrome = {
    runtime: {
      sendMessage: async (message) => {
        console.log("Mock sendMessage called:", message);
        if (message.action === "GET_SETTINGS") {
          return { GEMINI_API_KEY: "mock-key-12345", GEMINI_MODEL: "gemini-2.5-flash" };
        }
        if (message.action === "GET_PROFILE") {
          return {
            name: "John Doe",
            email: "john.doe@example.com",
            phone: "+1 (555) 019-2834",
            location: "San Francisco, CA"
          };
        }
        if (message.action === "GET_RESUME_FILE") {
          return mockResumeFile;
        }
        if (message.action === "SAVE_RESUME_FILE") {
          mockResumeFile = {
            filename: message.payload.filename,
            base64Data: message.payload.base64Data,
            updatedAt: new Date().toISOString()
          };
          return { success: true, resumeFile: mockResumeFile };
        }
        if (message.action === "DELETE_RESUME_FILE") {
          mockResumeFile = null;
          return { success: true };
        }
        if (message.action === "GET_COVER_LETTERS") {
          return [
            {
              id: "1",
              name: "Google Software Engineer Cover Letter",
              text: "Dear Hiring Team,\n\nI am writing to express my interest in the Software Engineer position at Google. With over five years of experience building high-scale distributed systems, I am confident in my ability to contribute to Google's engineering team.\n\nAt my previous role, I optimized a backend service that processed 50k requests per second, reducing average latency by 35%. I look forward to bringing my passion for system performance to Google.\n\nSincerely,\nJohn Doe",
              analysis: {
                tone: "Professional, confident, and metrics-driven",
                structure: "Standard greeting, short hook, high-impact paragraph highlighting a key backend achievement, and a polite sign-off.",
                skills: ["Go", "C++", "Distributed Systems", "Latency Tuning"],
                highlights: [
                  { wording: "optimized a backend service that processed 50k requests per second", achievement: "reduced average latency by 35%" }
                ]
              }
            },
            {
              id: "2",
              name: "Stripe Developer Relations Cover Letter",
              text: "Hi Stripe Developer Relations Team,\n\nI love API design and documentation, which is why I'm thrilled to apply for the Developer Advocate position at Stripe. I have been using Stripe APIs for years and am deeply passionate about developer experience.\n\nI have authored a popular open-source SDK that is used by over 10,000 developers worldwide, and regularly write technical tutorials that explain complex fintech concepts.\n\nCheers,\nJohn Doe",
              analysis: {
                tone: "Enthusiastic, developer-friendly, and community-oriented",
                structure: "Informal, conversational tone with standard warm closing.",
                skills: ["API Design", "Developer Experience", "Open Source", "Technical Writing"],
                highlights: [
                  { wording: "authored a popular open-source SDK used by 10,000+ developers", achievement: "proven developer community impact" }
                ]
              }
            },
            {
              id: "3",
              name: "Untrained Marketing Cover Letter",
              text: "Dear Hiring Manager,\n\nPlease accept this letter as my application for the Marketing Specialist role. I have run social media campaigns and want to join your team.\n\nThanks,\nJohn Doe"
            }
          ];
        }
        if (message.action === "GET_PORTAL_ACCOUNTS") {
          return [];
        }
        if (message.action === "SAVE_COVER_LETTERS") {
          return { success: true, coverLetters: message.payload };
        }
        return { success: true };
      }
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => ({})
      },
      onChanged: {
        addListener: () => {}
      }
    }
  };
}

let currentProfile = null;
let activeMergeDiff = null;
let currentCoverLetters = [];
let currentPortalAccounts = [];
let currentApplications = [];
let closeMerge = null;

document.addEventListener("DOMContentLoaded", () => {
  // Navigation Tabs
  const tabs = document.querySelectorAll(".sidebar-menu .menu-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      
      const tabId = tab.getAttribute("data-tab");
      document.querySelectorAll(".tab-content").forEach(content => {
        content.classList.remove("active");
      });
      document.getElementById(tabId).classList.add("active");

      // Lazy-load charts when benchmark tab is clicked (fixes canvas sizing bug)
      if (tabId === 'tab-benchmarks') {
        requestAnimationFrame(() => loadBenchmarks());
      }
    });
  });

  // Load All Storage Modules
  refreshAllData();

  // Listen for storage updates in other views to keep active resume card synchronized
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.resumeFile) {
        loadResumeFileWorkspace();
      }
    });
  }

  // Settings Save Handler
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  saveSettingsBtn.addEventListener("click", saveSettings);

  // Direct JSON Editor Modal Handlers
  const directEditBtn = document.getElementById("direct-edit-json-btn");
  const jsonModal = document.getElementById("json-modal");
  const jsonTextarea = document.getElementById("json-textarea");
  const closeJsonBtn = document.getElementById("close-json-modal");
  const cancelJsonBtn = document.getElementById("cancel-json-btn");
  const saveJsonBtn = document.getElementById("save-json-btn");

  directEditBtn.addEventListener("click", () => {
    if (!currentProfile) return;
    jsonTextarea.value = JSON.stringify(sortProfileJSON(currentProfile), null, 2);
    jsonModal.classList.add("active");
  });

  const closeJson = () => jsonModal.classList.remove("active");
  closeJsonBtn.addEventListener("click", closeJson);
  cancelJsonBtn.addEventListener("click", closeJson);

  saveJsonBtn.addEventListener("click", async () => {
    try {
      const parsed = JSON.parse(jsonTextarea.value);
      const sorted = sortProfileJSON(parsed);
      const res = await chrome.runtime.sendMessage({
        action: "SAVE_PROFILE",
        payload: sorted
      });
      if (res && res.success) {
        currentProfile = res.profile;
        renderProfile(currentProfile);
        closeJson();
      } else {
        alert("Failed to save profile memory.");
      }
    } catch (e) {
      alert(`Invalid JSON format: ${e.message}`);
    }
  });

  // PDF Upload & Merge Handlers
  const pdfInput = document.getElementById("pdf-upload-input");
  const uploadBtn = document.getElementById("upload-btn");
  const uploadStatus = document.getElementById("upload-status");
  const syncProfileCheckbox = document.getElementById("sync-profile-checkbox");

  const updateUploadButtonText = () => {
    if (syncProfileCheckbox.checked) {
      uploadBtn.textContent = "⚡ Parse & Upload Resume PDF";
    } else {
      uploadBtn.textContent = "📁 Save as Reference Document";
    }
  };

  syncProfileCheckbox.addEventListener("change", updateUploadButtonText);

  pdfInput.addEventListener("change", () => {
    if (pdfInput.files && pdfInput.files.length > 0) {
      uploadBtn.removeAttribute("disabled");
      uploadStatus.textContent = `Ready to upload: ${pdfInput.files[0].name}`;
    } else {
      uploadBtn.setAttribute("disabled", "true");
      uploadStatus.textContent = "Select a PDF or DOCX resume file.";
    }
  });

  uploadBtn.addEventListener("click", async () => {
    const file = pdfInput.files[0];
    if (!file) return;

    const isSyncEnabled = syncProfileCheckbox.checked;

    uploadBtn.setAttribute("disabled", "true");
    if (isSyncEnabled) {
      uploadBtn.textContent = "🧠 AI Extracting Data...";
    } else {
      uploadBtn.textContent = "💾 Saving Document...";
    }
    uploadStatus.textContent = "Converting file content...";

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const base64Data = arrayBufferToBase64(arrayBuffer);

        if (!isSyncEnabled) {
          uploadStatus.textContent = "Saving as active reference document...";
          await chrome.runtime.sendMessage({
            action: "SAVE_RESUME_FILE",
            payload: { filename: file.name, base64Data }
          });
          uploadStatus.textContent = "Saved as active reference document successfully!";
          return;
        }

        const isDocx = file.name.toLowerCase().endsWith(".docx");
        let parseRes = null;

        if (isDocx) {
          uploadStatus.textContent = "Extracting text from DOCX document...";
          const extractedText = await extractTextFromDocx(arrayBuffer);
          
          uploadStatus.textContent = "Sending DOCX text parsing request to Gemini...";
          parseRes = await chrome.runtime.sendMessage({
            action: "PARSE_RESUME_TEXT",
            payload: { text: extractedText }
          });
        } else {
          uploadStatus.textContent = "Sending PDF parsing request to Gemini...";
          parseRes = await chrome.runtime.sendMessage({
            action: "PARSE_RESUME_PDF",
            payload: { base64Data, filename: file.name }
          });
        }

        if (!parseRes || !parseRes.success || !parseRes.parsedJson) {
          throw new Error(parseRes?.error || "Failed to extract structured resume details.");
        }

        // 2. Save physical file as official resume in storage
        await chrome.runtime.sendMessage({
          action: "SAVE_RESUME_FILE",
          payload: { filename: file.name, base64Data }
        });

        uploadStatus.textContent = "Comparing new facts against master profile...";

        // 3. Compare parsed profile against current memory
        const compareRes = await chrome.runtime.sendMessage({
          action: "COMPARE_AND_MERGE",
          payload: { proposedJson: parseRes.parsedJson }
        });

        if (compareRes) {
          activeMergeDiff = compareRes;
          openMergeModal(activeMergeDiff);
        } else {
          throw new Error("No comparative differences found.");
        }

      } catch (err) {
        console.error(err);
        alert(`Error parsing resume: ${err.message}`);
      } finally {
        uploadBtn.removeAttribute("disabled");
        updateUploadButtonText();
        pdfInput.value = "";
        loadResumeFileWorkspace();
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // Merge Modal Handlers
  const mergeModal = document.getElementById("merge-modal");
  const closeMergeBtn = document.getElementById("close-merge-modal");
  const cancelMergeBtn = document.getElementById("cancel-merge-btn");
  const saveMergeBtn = document.getElementById("save-merge-btn");

  closeMerge = () => mergeModal.classList.remove("active");
  closeMergeBtn.addEventListener("click", closeMerge);
  cancelMergeBtn.addEventListener("click", closeMerge);
  saveMergeBtn.addEventListener("click", applyMergeSelections);

  // Cover Letter Add/Edit Modal Handlers
  const addLetterBtn = document.getElementById("add-letter-btn");
  const letterModal = document.getElementById("letter-modal");
  const letterModalTitle = document.getElementById("letter-modal-title");
  const closeLetterBtn = document.getElementById("close-letter-modal");
  const cancelLetterBtn = document.getElementById("cancel-letter-btn");
  const saveLetterBtn = document.getElementById("save-letter-btn");
  let tempCoverLetterAnalysis = null;

  addLetterBtn.addEventListener("click", () => {
    letterModalTitle.textContent = "Add Past Cover Letter";
    document.getElementById("letter-id").value = "";
    document.getElementById("letter-name").value = "";
    document.getElementById("letter-text").value = "";
    const fileInput = document.getElementById("letter-file-input");
    if (fileInput) fileInput.value = "";
    tempCoverLetterAnalysis = null;
    const statusMsg = document.getElementById("letter-status-message");
    if (statusMsg) {
      statusMsg.style.display = "none";
      statusMsg.style.color = "var(--text-muted)";
    }
    letterModal.classList.add("active");
  });

  const closeLetter = () => {
    letterModal.classList.remove("active");
    tempCoverLetterAnalysis = null;
  };
  closeLetterBtn.addEventListener("click", closeLetter);
  cancelLetterBtn.addEventListener("click", closeLetter);

  // File Upload listener inside cover letter modal
  const letterFileInput = document.getElementById("letter-file-input");
  if (letterFileInput) {
    letterFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const statusMsg = document.getElementById("letter-status-message");
      if (statusMsg) {
        statusMsg.style.display = "inline";
        statusMsg.style.color = "var(--text-muted)";
        statusMsg.textContent = "🧠 Reading & Parsing Document...";
      }
      saveLetterBtn.disabled = true;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const arrayBuffer = evt.target.result;
          const isDocx = file.name.toLowerCase().endsWith(".docx");
          let extractedText = "";
          let analysis = null;

          if (isDocx) {
            statusMsg.textContent = "🧠 Extracting Word document content...";
            extractedText = await extractTextFromDocx(arrayBuffer);
            
            statusMsg.textContent = "🧠 Analyzing style & wording metrics...";
            const res = await chrome.runtime.sendMessage({
              action: "ANALYZE_COVER_LETTER",
              payload: { text: extractedText }
            });
            if (res && res.success) {
              analysis = res.analysis;
            } else {
              throw new Error(res?.error || "Failed to analyze document style.");
            }
          } else {
            statusMsg.textContent = "🧠 Parsing PDF and extracting style...";
            const base64Data = arrayBufferToBase64(arrayBuffer);
            const res = await chrome.runtime.sendMessage({
              action: "PARSE_COVER_LETTER_PDF",
              payload: { base64Data, filename: file.name }
            });

            if (res && res.success && res.parsed) {
              extractedText = res.parsed.text || "";
              analysis = res.parsed.analysis;
            } else {
              throw new Error(res?.error || "Failed to parse PDF document.");
            }
          }

          document.getElementById("letter-text").value = extractedText;
          const nameField = document.getElementById("letter-name");
          if (!nameField.value) {
            nameField.value = file.name.replace(/\.[^/.]+$/, "") + " Cover Letter";
          }
          tempCoverLetterAnalysis = analysis;

          if (statusMsg) {
            statusMsg.textContent = "📄 Document loaded! Ready to save.";
            statusMsg.style.color = "#10b981";
          }
        } catch (err) {
          alert(`Error parsing cover letter: ${err.message}`);
          if (statusMsg) {
            statusMsg.textContent = "⚠️ Failed parsing.";
            statusMsg.style.color = "#ef4444";
          }
        } finally {
          saveLetterBtn.disabled = false;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  saveLetterBtn.addEventListener("click", async () => {
    const id = document.getElementById("letter-id").value;
    const name = document.getElementById("letter-name").value.trim();
    const text = document.getElementById("letter-text").value.trim();

    if (!name || !text) {
      alert("Identifier Name and Letter Text are required.");
      return;
    }

    const statusMsg = document.getElementById("letter-status-message");
    if (statusMsg) {
      statusMsg.style.display = "inline";
      statusMsg.style.color = "var(--text-muted)";
      statusMsg.textContent = "🧠 Training AI Style Model...";
    }
    saveLetterBtn.disabled = true;

    // Use pre-analyzed metadata from PDF if available, otherwise analyze the raw text input now
    let analysis = tempCoverLetterAnalysis;
    if (!analysis) {
      const analysisRes = await chrome.runtime.sendMessage({
        action: "ANALYZE_COVER_LETTER",
        payload: { text }
      });
      if (analysisRes && analysisRes.success) {
        analysis = analysisRes.analysis;
      }
    }

    const templates = [...currentCoverLetters];
    if (id) {
      const idx = templates.findIndex(t => t.id === id);
      if (idx !== -1) {
        const oldLetter = templates[idx];
        templates[idx] = { 
          id, 
          name, 
          text, 
          analysis: analysis || oldLetter.analysis || null 
        };
      }
    } else {
      templates.push({ 
        id: crypto.randomUUID(), 
        name, 
        text, 
        analysis 
      });
    }

    const res = await chrome.runtime.sendMessage({
      action: "SAVE_COVER_LETTERS",
      payload: templates
    });

    if (statusMsg) statusMsg.style.display = "none";
    saveLetterBtn.disabled = false;

    if (res && res.success) {
      currentCoverLetters = res.coverLetters;
      renderCoverLetters();
      closeLetter();
    } else {
      alert("Failed to save cover letter.");
    }
  });

  // Portal Account Modal Handlers
  const addPortalBtn = document.getElementById("add-portal-btn");
  const portalModal = document.getElementById("portal-modal");
  const closePortalBtn = document.getElementById("close-portal-modal");
  const cancelPortalBtn = document.getElementById("cancel-portal-btn");
  const savePortalBtn = document.getElementById("save-portal-btn");

  addPortalBtn.addEventListener("click", () => {
    document.getElementById("portal-domain").value = "";
    document.getElementById("portal-username").value = "";
    document.getElementById("portal-password").value = "";
    portalModal.classList.add("active");
  });

  const closePortal = () => portalModal.classList.remove("active");
  closePortalBtn.addEventListener("click", closePortal);
  cancelPortalBtn.addEventListener("click", closePortal);

  savePortalBtn.addEventListener("click", async () => {
    const domain = document.getElementById("portal-domain").value.trim().toLowerCase();
    const username = document.getElementById("portal-username").value.trim();
    const password = document.getElementById("portal-password").value.trim();

    if (!domain || !username || !password) {
      alert("All fields are required.");
      return;
    }

    const accounts = [...currentPortalAccounts];
    accounts.push({ id: crypto.randomUUID(), domain, username, password });

    const res = await chrome.runtime.sendMessage({
      action: "SAVE_PORTAL_ACCOUNTS",
      payload: accounts
    });

    if (res && res.success) {
      currentPortalAccounts = res.portalAccounts;
      renderPortalAccounts();
      closePortal();
    } else {
      alert("Failed to save portal credentials.");
    }
  });

  // Export Data Handler
  const exportBtn = document.getElementById("export-backup-btn");
  exportBtn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ action: "EXPORT_ALL_DATA" });
    if (res && res.success && res.backup) {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.backup, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `ai_job_agent_backup_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } else {
      alert("Failed to compile export backup JSON.");
    }
  });

  // Import Backup Handlers
  const importInput = document.getElementById("import-backup-input");
  const importBtn = document.getElementById("import-backup-btn");

  importBtn.addEventListener("click", () => {
    importInput.click();
  });

  importInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const res = await chrome.runtime.sendMessage({
          action: "IMPORT_ALL_DATA",
          payload: parsed
        });

        if (res && res.success) {
          const status = document.getElementById("backup-status");
          status.style.display = "block";
          setTimeout(() => {
            status.style.display = "none";
            window.location.reload(); // Refresh workspace
          }, 1500);
        } else {
          alert("Failed to parse and import backup database.");
        }
      } catch (err) {
        alert(`Invalid backup JSON file: ${err.message}`);
      } finally {
        importInput.value = "";
      }
    };
    reader.readAsText(file);
  });

  // Push Storage to SQLite Database
  const syncDbBtn = document.getElementById("sync-db-btn");
  const syncDbStatus = document.getElementById("sync-db-status");

  syncDbBtn.addEventListener("click", async () => {
    syncDbStatus.style.display = "inline";
    syncDbStatus.textContent = "Syncing...";
    syncDbStatus.style.color = "var(--text-muted)";
    
    try {
      const res = await chrome.runtime.sendMessage({ action: "FORCE_SYNC_TO_BACKEND" });
      if (res && res.success) {
        syncDbStatus.textContent = "Sync completed successfully!";
        syncDbStatus.style.color = "var(--accent-light)";
      } else {
        syncDbStatus.textContent = (res && res.error) ? `Sync failed: ${res.error}` : "Sync failed: Backend offline.";
        syncDbStatus.style.color = "#ff6b6b";
      }
    } catch (err) {
      syncDbStatus.textContent = "Sync failed: Service worker offline.";
      syncDbStatus.style.color = "#ff6b6b";
    }
    
    setTimeout(() => {
      syncDbStatus.style.display = "none";
    }, 4000);
  });

  // URL Hash Routing for redirect navigation
  const handleHashRouting = async () => {
    const hash = window.location.hash;
    if (hash === "#settings") {
      const settingsTabBtn = document.querySelector(".sidebar-menu .menu-btn[data-tab='tab-settings']");
      if (settingsTabBtn) settingsTabBtn.click();
    } else if (hash === "#merge") {
      const data = await chrome.storage.local.get("tempProposedJson");
      if (data && data.tempProposedJson) {
        const tempProposedJson = data.tempProposedJson;
        await chrome.storage.local.remove("tempProposedJson");
        
        try {
          const compareRes = await chrome.runtime.sendMessage({
            action: "COMPARE_AND_MERGE",
            payload: { proposedJson: tempProposedJson }
          });
          if (compareRes) {
            activeMergeDiff = compareRes;
            openMergeModal(activeMergeDiff);
          }
        } catch (e) {
          console.error("Merge hash routing failed:", e);
        }
      }
    }
  };
  handleHashRouting();
});

// Refresh Dashboard Data
async function refreshAllData() {
  loadSettings();
  loadProfile();
  loadResumeFileWorkspace();
  loadCoverLetters();
  loadPortalAccounts();
  loadReplaySessions();
  loadPreferences();
  loadBenchmarks();
}

// --- PREFERENCES ---

async function loadPreferences() {
  const profile = await chrome.runtime.sendMessage({ action: "GET_PROFILE" });
  const prefs = profile?.preferences || {};

  const safe = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  safe('pref-visa-status', prefs.visa_status);
  const authEl = document.getElementById('pref-authorized');
  if (authEl) authEl.value = prefs.authorized_to_work === false ? 'false' : 'true';
  const sponsEl = document.getElementById('pref-sponsorship');
  if (sponsEl) sponsEl.value = prefs.sponsorship_required === true ? 'true' : 'false';
  safe('pref-salary', prefs.salary);
  safe('pref-salary-min', prefs.salary_min);
  safe('pref-salary-max', prefs.salary_max);
  safe('pref-currency', prefs.salary_currency || 'USD');
  const remoteEl = document.getElementById('pref-remote');
  if (remoteEl) remoteEl.value = prefs.remote === false ? 'false' : 'true';
  const relocEl = document.getElementById('pref-relocate');
  if (relocEl) relocEl.value = prefs.willing_to_relocate === true ? 'true' : 'false';
  safe('pref-locations', (prefs.locations || []).join(', '));
  safe('pref-employment-types', (prefs.employment_types || []).join(', '));
  safe('pref-notice', prefs.notice_period);
  safe('pref-availability-date', prefs.availability_date);
}

async function savePreferences() {
  const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const prefs = {
    visa_status: get('pref-visa-status'),
    authorized_to_work: get('pref-authorized') !== 'false',
    sponsorship_required: get('pref-sponsorship') === 'true',
    salary: get('pref-salary'),
    salary_min: get('pref-salary-min'),
    salary_max: get('pref-salary-max'),
    salary_currency: get('pref-currency') || 'USD',
    remote: get('pref-remote') !== 'false',
    willing_to_relocate: get('pref-relocate') === 'true',
    locations: get('pref-locations').split(',').map(s => s.trim()).filter(Boolean),
    employment_types: get('pref-employment-types').split(',').map(s => s.trim()).filter(Boolean),
    notice_period: get('pref-notice'),
    availability_date: get('pref-availability-date')
  };

  const currentProfile = await chrome.runtime.sendMessage({ action: "GET_PROFILE" });
  const updatedProfile = { ...currentProfile, preferences: prefs };
  await chrome.runtime.sendMessage({ action: "SAVE_PROFILE", payload: updatedProfile });

  const statusEl = document.getElementById('preferences-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
  }
}

// Wire save button + benchmark controls
document.addEventListener('DOMContentLoaded', () => {
  const savePrefBtn = document.getElementById('save-preferences-btn');
  if (savePrefBtn) savePrefBtn.addEventListener('click', savePreferences);

  const refreshBenchBtn = document.getElementById('refresh-benchmarks-btn');
  if (refreshBenchBtn) refreshBenchBtn.addEventListener('click', loadBenchmarks);

  // Platform filter dropdown — reload charts on change
  const platformFilter = document.getElementById('bm-platform-filter');
  if (platformFilter) platformFilter.addEventListener('change', loadBenchmarks);
});

// --- BENCHMARKS (Phase 6) ---

// Chart instances — kept in module scope so they can be destroyed on refresh
let _bmChartAccuracy = null;
let _bmChartConfidence = null;
let _bmChartErrors = null;
let _bmChartPlatforms = null;

// Global chart defaults for dark mode
function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = 'rgba(148,163,184,0.85)';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'Inter', 'Outfit', system-ui, sans-serif";
  Chart.defaults.font.size = 11;
}

const PLATFORM_COLORS = {
  greenhouse:      '#10b981',
  lever:           '#6366f1',
  workday:         '#f59e0b',
  ashby:           '#06b6d4',
  icims:           '#8b5cf6',
  taleo:           '#f97316',
  'synthetic-ats': '#ec4899',
  smartrecruiters: '#14b8a6',
  generic:         '#64748b',
};

const PLATFORM_ICONS = {
  greenhouse: '🌿', lever: '⚙️', workday: '☁️', ashby: '🔷',
  icims: '🏢', taleo: '📋', 'synthetic-ats': '🧪', generic: '🌐',
};

function destroyCharts() {
  [_bmChartAccuracy, _bmChartConfidence, _bmChartErrors, _bmChartPlatforms].forEach(c => {
    if (c) { try { c.destroy(); } catch (_) {} }
  });
  _bmChartAccuracy = _bmChartConfidence = _bmChartErrors = _bmChartPlatforms = null;
}

function pct(v)  { return v != null ? `${(v * 100).toFixed(1)}%` : '—'; }
function pctN(v) { return v != null ? parseFloat((v * 100).toFixed(1)) : null; }
function msToS(v){ return v ? `${(v / 1000).toFixed(1)}s` : '—'; }

function setKPI(id, value, deltaValue, barPct, invertDelta = false) {
  const valEl = document.getElementById(id);
  const deltaEl = document.getElementById(`${id}-delta`);
  const barEl = document.getElementById(`${id}-bar`);
  if (valEl) valEl.textContent = value;
  if (barEl) { setTimeout(() => { barEl.style.width = `${Math.min(100, Math.max(0, barPct || 0))}%`; }, 80); }
  if (deltaEl && deltaValue != null) {
    const sign = deltaValue > 0 ? '+' : '';
    const isGood = invertDelta ? deltaValue < 0 : deltaValue > 0;
    const isBad  = invertDelta ? deltaValue > 0 : deltaValue < 0;
    const cls = isGood ? 'up' : isBad ? 'down' : 'flat';
    const arrow = isGood ? '▲' : isBad ? '▼' : '─';
    deltaEl.textContent = `${arrow} ${sign}${deltaValue.toFixed(1)}% vs prev`;
    deltaEl.className = `bm-kpi-delta ${cls}`;
  } else if (deltaEl) {
    deltaEl.textContent = '';
  }
}

function buildLineChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,18,30,0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + '%' : '—'}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 8 } },
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => v + '%' } }
      }
    }
  });
}

function buildBarChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,18,30,0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + '%' : '—'}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => v + '%' } }
      }
    }
  });
}

function buildDoughnut(canvasId, labels, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 1.5,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,18,30,0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

function renderRegressionBanner(sessions) {
  const banner = document.getElementById('bm-regression-banner');
  if (!banner || sessions.length < 2) { if (banner) banner.style.display = 'none'; return; }

  const prev = sessions[sessions.length - 2];
  const curr = sessions[sessions.length - 1];

  const regressions = [];
  const checks = [
    { key: 'completionRate', label: 'Completion Rate', good: 'higher' },
    { key: 'fieldAccuracy',  label: 'Field Accuracy',  good: 'higher' },
    { key: 'avgConfidence',  label: 'Avg Confidence',  good: 'higher' },
    { key: 'errorRate',      label: 'Error Rate',      good: 'lower'  },
    { key: 'skipRate',       label: 'Skip Rate',       good: 'lower'  },
  ];
  for (const c of checks) {
    const p = prev[c.key], cu = curr[c.key];
    if (p == null || cu == null) continue;
    const regressed = c.good === 'higher' ? cu < p - 0.05 : cu > p + 0.05;
    if (regressed) regressions.push(`${c.label} (${pct(p)} → ${pct(cu)})`);
  }

  banner.style.display = 'flex';
  if (regressions.length === 0) {
    banner.className = 'bm-regression-pass';
    banner.innerHTML = `<span>✅</span> <span>No regressions vs. previous session. All key metrics are stable or improved.</span>`;
  } else {
    banner.className = 'bm-regression-fail';
    banner.innerHTML = `<span>🔴</span> <span><strong>Regression detected</strong> vs. previous session: ${regressions.join(' · ')}</span>`;
  }
}

function renderSessionTable(sessions, tableContainer) {
  if (!sessions || sessions.length === 0) {
    tableContainer.innerHTML = `<div class="letters-empty-box">No benchmark sessions yet. Run the autofill agent on the test ATS to generate data.</div>`;
    return;
  }

  const countEl = document.getElementById('bm-session-count');
  if (countEl) countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  let html = `<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
    <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.08);">
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Platform</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Completion</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Accuracy</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Confidence</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Skip</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Errors</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Time</th>
      <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;">Date</th>
    </tr></thead><tbody>`;

  // Most recent first
  const sorted = [...sessions].reverse();
  for (const s of sorted) {
    const platIcon = PLATFORM_ICONS[s.platform] || '🌐';
    const platColor = PLATFORM_COLORS[s.platform] || '#64748b';
    const dateStr = new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    html += `<tr class="bm-session-row">
      <td style="padding:9px 10px;">
        <span class="bm-platform-badge" style="background:${platColor}22;color:${platColor};border-color:${platColor}44;">
          ${platIcon} ${s.platform || 'generic'}
        </span>
      </td>
      <td style="padding:9px 10px;color:#10b981;font-weight:600;">${pct(s.completionRate)}</td>
      <td style="padding:9px 10px;color:#6366f1;font-weight:600;">${pct(s.fieldAccuracy)}</td>
      <td style="padding:9px 10px;color:#f59e0b;font-weight:600;">${pct(s.avgConfidence)}</td>
      <td style="padding:9px 10px;color:#f97316;">${pct(s.skipRate)}</td>
      <td style="padding:9px 10px;color:#ef4444;">${pct(s.errorRate)}</td>
      <td style="padding:9px 10px;color:var(--text-muted);">${s.totalTimeMs ? msToS(s.totalTimeMs) : '—'}</td>
      <td style="padding:9px 10px;color:var(--text-muted);font-size:0.75rem;">${dateStr}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  tableContainer.innerHTML = html;
}

async function loadBenchmarks() {
  applyChartDefaults();
  destroyCharts();

  // Read active platform filter
  const filterEl = document.getElementById('bm-platform-filter');
  const platformFilter = filterEl ? filterEl.value : 'all';

  try {
    const res = await fetch('http://localhost:5000/api/benchmarks/report');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // All sessions, optionally filtered
    let sessions = data.sessions || [];
    if (platformFilter !== 'all') {
      sessions = sessions.filter(s => s.platform === platformFilter);
    }
    sessions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const latest  = sessions[sessions.length - 1] || null;
    const previous = sessions[sessions.length - 2] || null;

    // ── KPI Cards ────────────────────────────────────────────────
    if (latest) {
      const delta = (key, invert = false) => {
        if (!previous || previous[key] == null || latest[key] == null) return null;
        return parseFloat(((latest[key] - previous[key]) * 100).toFixed(1));
      };

      setKPI('bm-completion',    pct(latest.completionRate),    delta('completionRate'),  pctN(latest.completionRate));
      setKPI('bm-accuracy',      pct(latest.fieldAccuracy),     delta('fieldAccuracy'),   pctN(latest.fieldAccuracy));
      setKPI('bm-confidence',    pct(latest.avgConfidence),     delta('avgConfidence'),   pctN(latest.avgConfidence));
      setKPI('bm-semantic',      pct(latest.semanticAccuracy),  delta('semanticAccuracy'), pctN(latest.semanticAccuracy));
      setKPI('bm-recovery',      pct(latest.recoveryRate),      delta('recoveryRate'),    pctN(latest.recoveryRate));
      setKPI('bm-skip',          pct(latest.skipRate),          delta('skipRate', true),  pctN(latest.skipRate), true);
      setKPI('bm-hallucinations', latest.hallucinations != null ? String(latest.hallucinations) : '—',
             null, Math.min(100, (latest.hallucinations || 0) * 10));
      setKPI('bm-time',          msToS(latest.totalTimeMs),     null,
             latest.totalTimeMs ? Math.min(100, latest.totalTimeMs / 300) : 0);
    }

    // ── Chart labels (truncated session dates) ───────────────────
    const labels = sessions.map(s => {
      const d = new Date(s.createdAt);
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
    const hasData = sessions.length > 0;

    // ── Chart 1: Accuracy Trends ─────────────────────────────────
    const c1Empty = document.getElementById('bm-chart-accuracy-empty');
    const c1Canvas = document.getElementById('bm-chart-accuracy');
    if (hasData && c1Canvas) {
      if (c1Empty) c1Empty.style.display = 'none';
      c1Canvas.style.display = 'block';
      _bmChartAccuracy = buildLineChart('bm-chart-accuracy', labels, [
        { label: 'Completion', data: sessions.map(s => pctN(s.completionRate)), borderColor: '#10b981', backgroundColor: '#10b98122', tension: 0.35, fill: true, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Field Accuracy', data: sessions.map(s => pctN(s.fieldAccuracy)), borderColor: '#6366f1', backgroundColor: '#6366f115', tension: 0.35, fill: false, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Semantic', data: sessions.map(s => pctN(s.semanticAccuracy)), borderColor: '#8b5cf6', backgroundColor: '#8b5cf615', tension: 0.35, fill: false, pointRadius: 3, pointHoverRadius: 5, borderDash: [4,3] },
      ]);
    } else {
      if (c1Canvas) c1Canvas.style.display = 'none';
      if (c1Empty) c1Empty.style.display = 'block';
    }

    // ── Chart 2: Confidence & Recovery ───────────────────────────
    const c2Empty = document.getElementById('bm-chart-confidence-empty');
    const c2Canvas = document.getElementById('bm-chart-confidence');
    if (hasData && c2Canvas) {
      if (c2Empty) c2Empty.style.display = 'none';
      c2Canvas.style.display = 'block';
      _bmChartConfidence = buildLineChart('bm-chart-confidence', labels, [
        { label: 'Avg Confidence', data: sessions.map(s => pctN(s.avgConfidence)), borderColor: '#f59e0b', backgroundColor: '#f59e0b22', tension: 0.35, fill: true, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Recovery Rate', data: sessions.map(s => pctN(s.recoveryRate)), borderColor: '#06b6d4', backgroundColor: '#06b6d415', tension: 0.35, fill: false, pointRadius: 3, pointHoverRadius: 5 },
      ]);
    } else {
      if (c2Canvas) c2Canvas.style.display = 'none';
      if (c2Empty) c2Empty.style.display = 'block';
    }

    // ── Chart 3: Error & Skip Rates (bar) ────────────────────────
    const c3Empty = document.getElementById('bm-chart-errors-empty');
    const c3Canvas = document.getElementById('bm-chart-errors');
    if (hasData && c3Canvas) {
      if (c3Empty) c3Empty.style.display = 'none';
      c3Canvas.style.display = 'block';
      _bmChartErrors = buildBarChart('bm-chart-errors', labels, [
        { label: 'Error Rate', data: sessions.map(s => pctN(s.errorRate)), backgroundColor: '#ef444488', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3 },
        { label: 'Skip Rate',  data: sessions.map(s => pctN(s.skipRate)),  backgroundColor: '#f9731688', borderColor: '#f97316', borderWidth: 1, borderRadius: 3 },
      ]);
    } else {
      if (c3Canvas) c3Canvas.style.display = 'none';
      if (c3Empty) c3Empty.style.display = 'block';
    }

    // ── Chart 4: Platform Distribution (doughnut) ─────────────────
    const c4Empty = document.getElementById('bm-chart-platforms-empty');
    const c4Canvas = document.getElementById('bm-chart-platforms');
    const legendEl = document.getElementById('bm-platform-legend');
    const allSessions = data.sessions || []; // Use unfiltered for distribution
    const platformCounts = {};
    for (const s of allSessions) {
      platformCounts[s.platform || 'generic'] = (platformCounts[s.platform || 'generic'] || 0) + 1;
    }
    const platLabels = Object.keys(platformCounts);
    const platValues = platLabels.map(k => platformCounts[k]);
    const platColors = platLabels.map(k => PLATFORM_COLORS[k] || '#64748b');

    if (platLabels.length > 0 && c4Canvas) {
      if (c4Empty) c4Empty.style.display = 'none';
      c4Canvas.style.display = 'block';
      _bmChartPlatforms = buildDoughnut('bm-chart-platforms', platLabels, platValues, platColors);
      // Build legend
      if (legendEl) {
        legendEl.innerHTML = platLabels.map((label, i) => `
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${platColors[i]};flex-shrink:0;"></span>
            <span style="color:var(--text-secondary);flex:1;">${PLATFORM_ICONS[label] || '🌐'} ${label}</span>
            <span style="color:var(--text-muted);font-weight:600;">${platValues[i]}</span>
          </div>`).join('');
      }
    } else {
      if (c4Canvas) c4Canvas.style.display = 'none';
      if (c4Empty) c4Empty.style.display = 'block';
      if (legendEl) legendEl.innerHTML = '';
    }

    // ── Regression Banner ────────────────────────────────────────
    renderRegressionBanner(sessions);

    // ── Session Table ────────────────────────────────────────────
    const tableContainer = document.getElementById('benchmark-table-container');
    if (tableContainer) renderSessionTable(sessions, tableContainer);

  } catch (err) {
    console.warn('[Benchmarks] Could not load from backend:', err.message);
    // Show friendly offline state
    const tableContainer = document.getElementById('benchmark-table-container');
    if (tableContainer) {
      tableContainer.innerHTML = `<div class="letters-empty-box" style="color:#f59e0b;">
        ⚠️ Backend offline — start the server with <code style="font-family:monospace;background:rgba(255,255,255,0.07);padding:2px 6px;border-radius:4px;">npm run dev</code> in /backend to load benchmarks.
      </div>`;
    }
    // Clear KPI cards
    ['bm-completion','bm-accuracy','bm-confidence','bm-semantic','bm-recovery','bm-skip','bm-hallucinations','bm-time'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
  }
}


// Settings
async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
  if (settings) {
    document.getElementById("settings-gemini-key").value = settings.GEMINI_API_KEY || "";
    document.getElementById("settings-gemini-model").value = settings.GEMINI_MODEL || "gemini-2.5-flash";
    document.getElementById("settings-default-email").value = settings.DEFAULT_PORTAL_EMAIL || "";
    document.getElementById("settings-default-password").value = settings.DEFAULT_PORTAL_PASSWORD || "";
    document.getElementById("settings-custom-essay-prompt").value = settings.CUSTOM_ESSAY_PROMPT || "";
  }
}

async function saveSettings() {
  const key = document.getElementById("settings-gemini-key").value.trim();
  const model = document.getElementById("settings-gemini-model").value;
  const defaultEmail = document.getElementById("settings-default-email").value.trim();
  const defaultPassword = document.getElementById("settings-default-password").value.trim();
  const customEssayPrompt = document.getElementById("settings-custom-essay-prompt").value.trim();

  const res = await chrome.runtime.sendMessage({
    action: "SAVE_SETTINGS",
    payload: { 
      GEMINI_API_KEY: key, 
      GEMINI_MODEL: model,
      DEFAULT_PORTAL_EMAIL: defaultEmail,
      DEFAULT_PORTAL_PASSWORD: defaultPassword,
      CUSTOM_ESSAY_PROMPT: customEssayPrompt
    }
  });

  if (res && res.success) {
    const status = document.getElementById("settings-status");
    status.style.display = "block";
    setTimeout(() => {
      status.style.display = "none";
    }, 2000);
  }
}

// Profile Rendering
async function loadProfile() {
  currentProfile = await chrome.runtime.sendMessage({ action: "GET_PROFILE" });
  renderProfile(currentProfile);
}

function renderProfile(profile) {
  if (!profile) return;

  document.getElementById("prof-name").textContent = profile.name || "Not Specified";
  document.getElementById("prof-preferredName").textContent = profile.contact?.preferredName || "Not Specified";
  document.getElementById("prof-email").textContent = profile.contact?.email || "Not Specified";
  document.getElementById("prof-phone").textContent = profile.contact?.phone || "Not Specified";
  document.getElementById("prof-location").textContent = profile.contact?.location || "Not Specified";
  document.getElementById("prof-gender").textContent = profile.gender || "Not Specified";
  document.getElementById("prof-race").textContent = profile.race || "Not Specified";
  document.getElementById("prof-veteran").textContent = profile.veteranStatus || "Not Specified";

  // Skills & Certs
  const skillsContainer = document.getElementById("prof-skills");
  if (profile.skills && profile.skills.length > 0) {
    const seen = new Set();
    const uniqueSkills = [];
    profile.skills.forEach(s => {
      if (s) {
        const clean = s.trim();
        const lower = clean.toLowerCase();
        if (clean && !seen.has(lower)) {
          seen.add(lower);
          uniqueSkills.push(clean);
        }
      }
    });
    skillsContainer.innerHTML = uniqueSkills.map(s => `<span class="tag">${s}</span>`).join("");
  } else {
    skillsContainer.innerHTML = `<span class="text-muted-size">None</span>`;
  }

  const certsContainer = document.getElementById("prof-certs");
  if (profile.certifications && profile.certifications.length > 0) {
    const seen = new Set();
    const uniqueCerts = [];
    profile.certifications.forEach(c => {
      if (c) {
        const clean = c.trim();
        const lower = clean.toLowerCase();
        if (clean && !seen.has(lower)) {
          seen.add(lower);
          uniqueCerts.push(clean);
        }
      }
    });
    certsContainer.innerHTML = uniqueCerts.map(c => `<span class="tag-cert">${c}</span>`).join("");
  } else {
    certsContainer.innerHTML = `<span class="text-muted-size">None</span>`;
  }

  // Lists
  const renderList = (containerId, arr, htmlGenerator) => {
    const el = document.getElementById(containerId);
    if (arr && arr.length > 0) {
      el.innerHTML = arr.map(htmlGenerator).join("");
    } else {
      el.innerHTML = `<span class="text-muted-size">None listed</span>`;
    }
  };

  renderList("prof-education-list", profile.education, ed => `
    <div class="info-card">
      <div class="school-name-text">${ed.school}</div>
      <div class="degree-meta-text">${ed.degree} in ${ed.major} (${ed.startYear} - ${ed.endYear || ed.expectedGraduation})</div>
    </div>
  `);

  renderList("prof-experience-list", profile.experience, exp => `
    <div class="info-card experience-item">
      <div class="school-name-text">${exp.role} @ ${exp.company}</div>
      <div class="exp-date-row">${exp.startDate} - ${exp.endDate}</div>
      <p class="exp-desc-paragraph">${Array.isArray(exp.description) ? exp.description.join(" ") : exp.description}</p>
    </div>
  `);

  renderList("prof-projects-list", profile.projects, p => `
    <div class="info-card project-item">
      <div class="school-name-text">${p.title}</div>
      <p class="project-desc-paragraph">${p.description}</p>
    </div>
  `);

  const qaContainer = document.getElementById("prof-qa-list");
  if (profile.customAnswers && profile.customAnswers.length > 0) {
    qaContainer.innerHTML = profile.customAnswers.map(qa => `
      <div class="glass qa-card-box">
        <div class="question-text-bold">Q: ${qa.question}</div>
        <div class="answer-text-white">A: ${qa.answer}</div>
      </div>
    `).join("");
  } else {
    qaContainer.innerHTML = `<span class="text-muted-size">None saved</span>`;
  }
}

// Resume PDF Workspace Manager
async function loadResumeFileWorkspace() {
  const res = await chrome.runtime.sendMessage({ action: "GET_RESUME_FILE" });
  const container = document.getElementById("active-resume-card");

  if (res && res.filename) {
    const file = res;
    const dateFormatted = file.updatedAt ? new Date(file.updatedAt).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    }) : "Unknown";

    container.innerHTML = `
      <div class="icon-resume-placeholder" style="margin-bottom: 8px;">📄</div>
      <div class="school-name-text" style="font-size: 1.05rem; word-break: break-all; max-width: 100%;">${file.filename}</div>
      <div class="desc-small-text" style="margin-top: 2px;">Uploaded: ${dateFormatted}</div>
      
      <div class="flex-row-gap-center btn-block" style="margin-top: 20px;">
        <button id="download-resume-btn" class="btn btn-secondary flex-grow-1">⬇️ Download PDF</button>
        <button id="delete-resume-btn" class="btn btn-danger" style="padding: 10px 12px;">Delete</button>
      </div>
    `;

    // Download PDF event
    document.getElementById("download-resume-btn").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${file.base64Data}`;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    // Delete PDF event
    document.getElementById("delete-resume-btn").addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete this resume PDF from extension storage?")) {
        const delRes = await chrome.runtime.sendMessage({ action: "DELETE_RESUME_FILE" });
        if (delRes && delRes.success) {
          loadResumeFileWorkspace();
        }
      }
    });

  } else {
    container.innerHTML = `
      <div class="icon-resume-placeholder">📄</div>
      <div class="text-muted-size">No resume PDF stored in local storage yet.</div>
    `;
  }
}

// Cover Letter Manager
async function loadCoverLetters() {
  const letters = await chrome.runtime.sendMessage({ action: "GET_COVER_LETTERS" });
  currentCoverLetters = letters || [];
  renderCoverLetters();
}

function renderCoverLetters() {
  const container = document.getElementById("letters-list-container");
  if (currentCoverLetters.length === 0) {
    container.innerHTML = `<div class="letters-empty-box">No past cover letters stored yet. Click add to train the AI.</div>`;
    return;
  }

  container.innerHTML = currentCoverLetters.map(letter => {
    let analysisHTML = "";
    if (letter.analysis) {
      analysisHTML = `
        <div class="letter-analysis-preview-section">
          <div class="badge-ai-trained">⚡ AI Trained: Style & Impact Extracted</div>
          <div class="analysis-grid-layout">
            <div><span class="detail-label-title">Tone/Style:</span> <span class="detail-value-text">${letter.analysis.tone}</span></div>
            <div><span class="detail-label-title">Format/Structure:</span> <span class="detail-value-text">${letter.analysis.structure}</span></div>
            <div style="margin-top: 4px;">
              <span class="detail-label-title">Skills Highlighted:</span> 
              <div style="display: inline-block; margin-left: 4px;">
                ${(letter.analysis.skills || []).map(s => `<span class="tag-small">${s}</span>`).join("")}
              </div>
            </div>
            <div style="margin-top: 8px;">
              <span class="detail-label-title">Extracted Impact Phrasing:</span>
              <div class="analysis-highlights-box">
                ${(letter.analysis.highlights || []).map(h => `
                  <div class="highlight-item-detail">
                    ⭐ <i>"${h.wording}"</i> <br>
                    <span class="highlight-desc-text">Result: ${h.achievement}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      analysisHTML = `
        <div class="letter-analysis-preview-section">
          <div class="badge-ai-untrained">⚠️ Style Not Trained</div>
          <div style="margin-top: 8px;">
            <button class="btn btn-secondary analyze-letter-btn btn-padding-small" data-id="${letter.id}">🧠 Analyze past style & results</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="glass letter-card">
        <div class="school-name-text border-bottom-padding" style="font-size: 1.05rem; display: flex; align-items: center; justify-content: space-between;">
          <span>📝 ${letter.name}</span>
        </div>
        <div class="letter-body-preview-wrapper">
          <div class="letter-body-preview">${letter.text}</div>
        </div>
        ${analysisHTML}
        <div class="actions-flex-end" style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-color);">
          <button class="btn btn-secondary edit-letter-btn btn-padding-small" data-id="${letter.id}">Edit Text</button>
          <button class="btn btn-danger delete-letter-btn btn-padding-small" data-id="${letter.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  // Edit Letters Listeners
  document.querySelectorAll(".edit-letter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      const letter = currentCoverLetters.find(l => l.id === id);
      if (letter) {
        document.getElementById("letter-modal-title").textContent = "Edit Past Cover Letter";
        document.getElementById("letter-id").value = letter.id;
        document.getElementById("letter-name").value = letter.name;
        document.getElementById("letter-text").value = letter.text;
        document.getElementById("letter-modal").classList.add("active");
      }
    });
  });

  // Analyze Letters Listener
  document.querySelectorAll(".analyze-letter-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      const letter = currentCoverLetters.find(l => l.id === id);
      if (!letter) return;

      btn.disabled = true;
      btn.textContent = "🧠 Analyzing & Extracting...";

      const res = await chrome.runtime.sendMessage({
        action: "ANALYZE_COVER_LETTER",
        payload: { text: letter.text }
      });

      if (res && res.success) {
        letter.analysis = res.analysis;
        const saveRes = await chrome.runtime.sendMessage({
          action: "SAVE_COVER_LETTERS",
          payload: currentCoverLetters
        });
        if (saveRes && saveRes.success) {
          currentCoverLetters = saveRes.coverLetters;
          renderCoverLetters();
        }
      } else {
        alert(res?.error || "Failed to analyze cover letter style. Make sure Gemini API Key is configured.");
        btn.disabled = false;
        btn.textContent = "🧠 Analyze past style & results";
      }
    });
  });

  // Delete Letters Listeners
  document.querySelectorAll(".delete-letter-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      if (confirm("Are you sure you want to delete this past cover letter?")) {
        const filtered = currentCoverLetters.filter(l => l.id !== id);
        const res = await chrome.runtime.sendMessage({
          action: "SAVE_COVER_LETTERS",
          payload: filtered
        });
        if (res && res.success) {
          currentCoverLetters = res.coverLetters;
          renderCoverLetters();
        }
      }
    });
  });
}

// Portal Accounts list
async function loadPortalAccounts() {
  const accounts = await chrome.runtime.sendMessage({ action: "GET_PORTAL_ACCOUNTS" });
  currentPortalAccounts = accounts || [];
  renderPortalAccounts();
}

function renderPortalAccounts() {
  const container = document.getElementById("portals-list-container");
  if (currentPortalAccounts.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; color:var(--text-muted); font-size:0.85rem;">No portal credentials stored yet.</div>`;
    return;
  }

  container.innerHTML = currentPortalAccounts.map(account => `
    <div class="creds-row">
      <div class="credential-label-heading">🌐 ${account.domain}</div>
      <div class="credential-value-desc">Email: ${account.username}</div>
      <div class="credential-muted-desc">Password: ••••••••</div>
      <button class="btn btn-danger delete-portal-btn btn-remove-padding" data-id="${account.id}">Remove</button>
    </div>
  `).join("");

  document.querySelectorAll(".delete-portal-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      if (confirm("Remove credential for this portal domain?")) {
        const filtered = currentPortalAccounts.filter(p => p.id !== id);
        const res = await chrome.runtime.sendMessage({
          action: "SAVE_PORTAL_ACCOUNTS",
          payload: filtered
        });
        if (res && res.success) {
          currentPortalAccounts = res.portalAccounts;
          renderPortalAccounts();
        }
      }
    });
  });
}



// Document Merging Modal Controller
function openMergeModal(diff) {
  const container = document.getElementById("merge-diff-contents");
  container.innerHTML = "";

  let sectionsHtml = "";

  if (diff.proposedFields.length > 0) {
    sectionsHtml += `
      <div>
        <h4 class="diff-section-header">Contact & Personal Modifications</h4>
        <div class="diff-list-container">
          ${diff.proposedFields.map(field => `
            <div class="diff-item ${field.status === 'conflict' ? 'diff-conflict' : 'diff-new'}">
              <input type="checkbox" class="merge-primitive-chk diff-checkbox" data-field="${field.field}" checked>
              <div>
                <strong class="diff-item-key">${field.field.replace('contact.', '')}</strong>
                <div class="diff-badge-wrapper">
                  <span class="diff-badge ${field.status === 'conflict' ? 'diff-badge-conflict' : 'diff-badge-new'}">${field.status.toUpperCase()}</span>
                </div>
              </div>
              <div class="diff-old-value">${field.status === 'conflict' ? field.oldValue : '(Empty)'}</div>
              <div class="diff-new-value">${field.newValue}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (diff.proposedStringArrays.length > 0) {
    const listTypes = ['skills', 'certifications', 'coursework', 'honors_and_awards'];
    
    listTypes.forEach(type => {
      const items = diff.proposedStringArrays.filter(s => s.type === type);
      if (items.length === 0) return;

      sectionsHtml += `
        <div>
          <h4 class="diff-section-header" style="color: var(--accent-purple); text-transform: capitalize;">New ${type.replace(/_/g, ' ')}</h4>
          <div class="tag-container">
            ${items.map(item => `
              <label class="glass merge-badge-label">
                <input type="checkbox" class="merge-string-chk" data-type="${type}" data-val="${item.value}" checked>
                <span>${item.value}</span>
              </label>
            `).join("")}
          </div>
        </div>
      `;
    });
  }

  if (diff.proposedObjectArrays.length > 0) {
    sectionsHtml += `
      <div>
        <h4 class="diff-section-header" style="color: var(--color-success);">Work, Projects, & Q&A additions</h4>
        <div class="diff-list-container">
          ${diff.proposedObjectArrays.map(item => `
            <div class="diff-item ${item.status === 'conflict' ? 'diff-conflict' : 'diff-new'}">
              <input type="checkbox" class="merge-object-chk diff-checkbox" data-id="${item.id}" checked>
              <div>
                <strong class="diff-item-key">${item.type}: ${item.matchKey}</strong>
                <div class="diff-badge-wrapper">
                  <span class="diff-badge ${item.status === 'conflict' ? 'diff-badge-conflict' : 'diff-badge-new'}">${item.status.toUpperCase()}</span>
                </div>
              </div>
              <div style="font-size:0.85rem; color:var(--text-muted); grid-column: span 2;">
                ${item.status === 'conflict' ? `
                  <div class="old-desc-text">Old Description: ${JSON.stringify(item.oldValue)}</div>
                  <div class="new-desc-text">New Description: ${JSON.stringify(item.newValue)}</div>
                ` : `
                  <div class="new-desc-text">${JSON.stringify(item.newValue)}</div>
                `}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (sectionsHtml === "") {
    container.innerHTML = `<div class="table-empty-row">No new changes detected. All details already exist in your Master Profile.</div>`;
  } else {
    container.innerHTML = sectionsHtml;
  }

  document.getElementById("merge-modal").classList.add("active");
}

async function applyMergeSelections() {
  if (!activeMergeDiff) return;

  const approvedFields = Array.from(document.querySelectorAll(".merge-primitive-chk:checked")).map(el => el.getAttribute("data-field"));
  const approvedSkills = Array.from(document.querySelectorAll(".merge-string-chk[data-type='skills']:checked")).map(el => el.getAttribute("data-val"));
  const approvedCerts = Array.from(document.querySelectorAll(".merge-string-chk[data-type='certifications']:checked")).map(el => el.getAttribute("data-val"));
  const approvedCoursework = Array.from(document.querySelectorAll(".merge-string-chk[data-type='coursework']:checked")).map(el => el.getAttribute("data-val"));
  const approvedAwards = Array.from(document.querySelectorAll(".merge-string-chk[data-type='honors_and_awards']:checked")).map(el => el.getAttribute("data-val"));
  
  const approvedObjectIds = Array.from(document.querySelectorAll(".merge-object-chk:checked")).map(el => el.getAttribute("data-id"));
  const approvedArrayItems = activeMergeDiff.proposedObjectArrays.filter(o => approvedObjectIds.includes(o.id));

  const masterJSON = JSON.parse(JSON.stringify(currentProfile));

  const setNestedValue = (obj, path, val) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') current[part] = {};
      current = current[part];
    }
    current[parts[parts.length - 1]] = val;
  };

  const getNestedValue = (obj, path) => {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };

  // Primitives
  approvedFields.forEach(field => {
    const val = getNestedValue(activeMergeDiff.newJSON, field);
    if (val !== undefined) {
      setNestedValue(masterJSON, field, val);
    }
  });

  // Strings
  const applyStrings = (targetArr, approved) => {
    if (!Array.isArray(targetArr)) targetArr = [];
    const set = new Set(targetArr.map(s => s.toLowerCase().trim()));
    approved.forEach(item => {
      if (!set.has(item.toLowerCase().trim())) targetArr.push(item);
    });
    return targetArr;
  };

  masterJSON.skills = applyStrings(masterJSON.skills, approvedSkills);
  masterJSON.certifications = applyStrings(masterJSON.certifications, approvedCerts);
  masterJSON.coursework = applyStrings(masterJSON.coursework, approvedCoursework);
  masterJSON.honors_and_awards = applyStrings(masterJSON.honors_and_awards, approvedAwards);

  // Objects
  approvedArrayItems.forEach(item => {
    const { type, status, newValue } = item;
    if (!Array.isArray(masterJSON[type])) masterJSON[type] = [];

    if (status === 'new') {
      masterJSON[type].push(newValue);
    } else if (status === 'conflict') {
      if (type === 'education') {
        const idx = masterJSON.education.findIndex(o => o.school && newValue.school && o.school.toLowerCase().trim() === newValue.school.toLowerCase().trim());
        if (idx !== -1) masterJSON.education[idx] = { ...masterJSON.education[idx], ...newValue };
        else masterJSON.education.push(newValue);
      } else if (type === 'experience') {
        const idx = masterJSON.experience.findIndex(o => o.company && newValue.company && o.company.toLowerCase().trim() === newValue.company.toLowerCase().trim() && o.role && newValue.role && o.role.toLowerCase().trim() === newValue.role.toLowerCase().trim());
        if (idx !== -1) masterJSON.experience[idx] = { ...masterJSON.experience[idx], ...newValue };
        else masterJSON.experience.push(newValue);
      } else if (type === 'projects') {
        const idx = masterJSON.projects.findIndex(o => o.title && newValue.title && o.title.toLowerCase().trim() === newValue.title.toLowerCase().trim());
        if (idx !== -1) masterJSON.projects[idx] = { ...masterJSON.projects[idx], ...newValue };
        else masterJSON.projects.push(newValue);
      } else if (type === 'customAnswers') {
        const idx = masterJSON.customAnswers.findIndex(o => o.question && newValue.question && (o.question.toLowerCase().trim() === newValue.question.toLowerCase().trim() || o.question.toLowerCase().includes(newValue.question.toLowerCase().trim()) || newValue.question.toLowerCase().includes(o.question.toLowerCase().trim())));
        if (idx !== -1) masterJSON.customAnswers[idx] = { ...masterJSON.customAnswers[idx], ...newValue };
        else masterJSON.customAnswers.push(newValue);
      }
    }
  });

  const res = await chrome.runtime.sendMessage({
    action: "SAVE_PROFILE",
    payload: masterJSON
  });

  if (res && res.success) {
    currentProfile = res.profile;
    renderProfile(currentProfile);
    closeMerge();
    alert("Master memory updated successfully with approved merges!");
  } else {
    alert("Error updating profile.");
  }
}

// Logical Profile JSON Sorter Helper
function sortProfileJSON(profile) {
  if (!profile) return profile;

  const topLevelOrder = [
    'name', 'contact', 'education', 'skills', 'coursework', 
    'honors_and_awards', 'experience', 'projects', 'certifications', 'customAnswers'
  ];

  const contactOrder = [
    'firstName', 'lastName', 'preferredName', 'email', 'phone', 'location', 
    'houseNumber', 'streetName', 'city', 'state', 'postalCode', 'country', 
    'birthday', 'gender', 'race', 'veteranStatus'
  ];

  const edOrder = ['school', 'degree', 'major', 'startYear', 'endYear', 'expectedGraduation'];
  const expOrder = ['company', 'role', 'startDate', 'endDate', 'description'];
  const projOrder = ['title', 'description'];
  const qaOrder = ['question', 'answer'];

  const sortObject = (obj, order) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const sorted = {};
    
    order.forEach(key => {
      if (key in obj) {
        sorted[key] = obj[key];
      }
    });

    Object.keys(obj).forEach(key => {
      if (!(key in sorted)) {
        sorted[key] = obj[key];
      }
    });

    return sorted;
  };

  const result = sortObject(profile, topLevelOrder);

  if (result.contact) {
    result.contact = sortObject(result.contact, contactOrder);
  }

  if (Array.isArray(result.education)) {
    result.education = result.education.map(item => sortObject(item, edOrder));
  }

  if (Array.isArray(result.experience)) {
    result.experience = result.experience.map(item => sortObject(item, expOrder));
  }

  if (Array.isArray(result.projects)) {
    result.projects = result.projects.map(item => sortObject(item, projOrder));
  }

  if (Array.isArray(result.customAnswers)) {
    result.customAnswers = result.customAnswers.map(item => sortObject(item, qaOrder));
  }

  return result;
}

// Convert ArrayBuffer to Base64 String
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Extract raw text from Microsoft Word (.docx) documents in pure JavaScript
async function extractTextFromDocx(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  
  // 1. Find the End of Central Directory (EOCD) signature from the end of the file
  let eocdOffset = arrayBuffer.byteLength - 22;
  while (eocdOffset >= 0) {
    if (view.getUint32(eocdOffset, true) === 0x06054b50) {
      break;
    }
    eocdOffset--;
  }
  
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP file (EOCD signature not found).");
  }
  
  const cdCount = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  
  // 2. Scan Central Directory headers to find word/document.xml
  let offset = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (offset >= arrayBuffer.byteLength - 46) break;
    
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid Central Directory signature: 0x${signature.toString(16)}`);
    }
    
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    
    const fileNameBytes = new Uint8Array(arrayBuffer, offset + 46, fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);
    const normalizedFileName = fileName.replace(/\\/g, "/");
    
    if (normalizedFileName === "word/document.xml") {
      // 3. Read local file header to find where file data starts
      const localView = new DataView(arrayBuffer, localHeaderOffset, 30);
      if (localView.getUint32(0, true) !== 0x04034b50) {
        throw new Error("Invalid local file header signature.");
      }
      const localFileNameLength = localView.getUint16(26, true);
      const localExtraFieldLength = localView.getUint16(28, true);
      
      const fileDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
      const compressedData = new Uint8Array(arrayBuffer, fileDataOffset, compressedSize);
      
      let xmlText = "";
      if (compressionMethod === 8) { // DEFLATE
        const ds = new DecompressionStream("deflate-raw");
        const decompressedStream = new Response(compressedData).body.pipeThrough(ds);
        xmlText = await new Response(decompressedStream).text();
      } else if (compressionMethod === 0) { // Store
        xmlText = new TextDecoder().decode(compressedData);
      } else {
        throw new Error(`Unsupported compression method: ${compressionMethod}`);
      }
      
      return parseDocxXmlText(xmlText);
    }
    
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  
  throw new Error("Could not find word/document.xml inside DOCX file structure.");
}

function parseDocxXmlText(xmlText) {
  const decodeXmlEntities = (str) => {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  };

  const paragraphs = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch;
  
  while ((pMatch = pRegex.exec(xmlText)) !== null) {
    const pContent = pMatch[1];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch;
    let paragraphText = "";
    
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      paragraphText += tMatch[1];
    }
    
    paragraphs.push(decodeXmlEntities(paragraphText));
  }
  
  // Fallback: directly find w:t elements if paragraphs are empty
  if (paragraphs.length === 0) {
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(xmlText)) !== null) {
      paragraphs.push(decodeXmlEntities(tMatch[1]));
    }
  }
  
  return paragraphs.join("\n");
}

// Replay Sessions UI Loader & Renderers
async function loadReplaySessions() {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
  const replays = await chrome.runtime.sendMessage({ action: "GET_REPLAYS" });
  renderReplaysList(replays || []);
}

function renderReplaysList(replays) {
  const container = document.getElementById("replays-list-container");
  if (!container) return;

  if (replays.length === 0) {
    container.innerHTML = `<div class="letters-empty-box">No failure replay sessions recorded. The agent is running smoothly!</div>`;
    return;
  }

  container.innerHTML = replays.map(rep => {
    const dateStr = new Date(rep.createdAt).toLocaleString();
    let history = [];
    let logs = [];
    try { history = JSON.parse(rep.actionHistory || '[]'); } catch(e){}
    try { logs = JSON.parse(rep.consoleLogs || '[]'); } catch(e){}
    
    return `
      <div class="letter-card glass" style="margin-bottom: 16px; padding: 16px; border-radius: 8px;">
        <div class="flex-between" style="border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 12px; gap: 8px;">
          <div style="flex-grow: 1;">
            <h4 style="margin: 0; font-size: 1.05rem; color: #fff;">${rep.company} - ${rep.role}</h4>
            <span style="font-size: 0.75rem; color: var(--text-secondary); display: block; margin-top: 2px; word-break: break-all;">
              URL: <a href="${rep.url}" target="_blank" style="color: var(--color-accent); text-decoration: none;">${rep.url}</a>
            </span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right; flex-shrink: 0;">
            <div>${dateStr}</div>
            <button class="btn btn-secondary delete-replay-btn" data-id="${rep.id}" style="padding: 4px 8px; font-size: 0.75rem; margin-top: 4px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">Delete</button>
          </div>
        </div>

        <div class="uploader-stretch-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <!-- Action History Log -->
          <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px; font-size: 0.8rem; border: 1px solid var(--border-color);">
            <div style="font-weight: 600; margin-bottom: 8px; color: #fff; font-size: 0.85rem;">⚙️ Action History (${history.length})</div>
            <div style="max-height: 150px; overflow-y: auto; padding-right: 4px;">
              ${history.length === 0 ? '<span class="text-muted-size">No actions logged</span>' : history.map(h => `
                <div style="margin-bottom: 6px; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 4px;">
                  <span style="color: ${h.status === 'success' ? '#10b981' : h.status === 'warning' ? '#f59e0b' : '#ef4444'}; font-weight: 600;">[${h.actionType}]</span>
                  <span style="color: #fff; font-weight: 500;">${h.labelText || h.fieldId}</span>${h.value ? `: "${h.value}"` : ''}
                  <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 1px;">${h.message || ''}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Console Logs -->
          <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px; font-size: 0.8rem; border: 1px solid var(--border-color);">
            <div style="font-weight: 600; margin-bottom: 8px; color: #fff; font-size: 0.85rem;">🖥️ Service Worker / Content Logs (${logs.length})</div>
            <div style="max-height: 150px; overflow-y: auto; padding-right: 4px; font-family: monospace; line-height: 1.3;">
              ${logs.length === 0 ? '<span class="text-muted-size">No console logs captured</span>' : logs.map(l => `
                <div style="margin-bottom: 4px; color: ${l.type === 'error' ? '#ef4444' : l.type === 'warn' ? '#f59e0b' : '#94a3b8'};">
                  [${l.type.toUpperCase()}] ${l.message}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div style="margin-top: 14px; text-align: right; border-top: 1px solid var(--border-color); padding-top: 10px;">
          <button class="btn btn-primary replay-btn" data-id="${rep.id}" style="padding: 6px 12px; font-size: 0.8rem;">
            🔄 Replay Failure
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  container.querySelectorAll(".delete-replay-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (confirm("Are you sure you want to delete this failure replay session?")) {
        await chrome.runtime.sendMessage({ action: "DELETEREPLAY", payload: { id } });
        loadReplaySessions();
      }
    });
  });

  container.querySelectorAll(".replay-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const replay = replays.find(r => r.id === id);
      if (replay) {
        triggerReplaySession(replay);
      }
    });
  });
}

async function triggerReplaySession(replay) {
  let formFields = [];
  try {
    formFields = JSON.parse(replay.formState || '[]');
  } catch(e) {
    alert("Failed to parse replay form state: " + e.message);
    return;
  }

  if (formFields.length === 0) {
    alert("Replay failed: No filled values were recorded for this session.");
    return;
  }

  alert(`Starting replay. Opening target page:\n${replay.url}\nThe agent will automatically try to re-autofill the form fields.`);

  // Create the mappings format: [{ id: "full-name", value: "Syed Afnan Adit" }]
  const mappings = formFields.map(f => ({
    id: f.id,
    value: f.value
  }));

  // Open the new tab
  chrome.tabs.create({ url: replay.url, active: true }, (tab) => {
    // Listen for page load completion
    function listener(tabId, info) {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        
        // Wait 1.5s for dynamic initialization on the page
        setTimeout(() => {
          // Send FILL_FORM message to content script of the newly opened tab
          chrome.tabs.sendMessage(tab.id, {
            action: "FILL_FORM",
            payload: { mappings }
          }, (response) => {
            console.log("Replay fill response:", response);
          });
        }, 1500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

