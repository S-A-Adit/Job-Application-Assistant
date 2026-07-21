// sidepanel.js - Controller for AI Job Agent docked side panel

let activeTab = null;
Object.defineProperty(window, 'activeTab', {
  get: () => activeTab,
  set: (val) => { activeTab = val; }
});
let formFields = [];
let detectedJob = null;
let matchingPortalAccount = null;
let currentPlan = null;

document.addEventListener("DOMContentLoaded", () => {
  const statusMessage = document.getElementById("status-message");
  const detectedJobInfo = document.getElementById("detected-job-info");
  const portalCard = document.getElementById("portal-card");
  const portalAccountName = document.getElementById("portal-account-name");
  const autofillCredsBtn = document.getElementById("autofill-creds-btn");
  const autofillBtn = document.getElementById("autofill-btn");
  const syncFormBtn = document.getElementById("sync-form-btn");
  const genCoverLetterBtn = document.getElementById("gen-cover-letter-btn");
  const openDashboardBtn = document.getElementById("open-dashboard-btn");
  const planSection = document.getElementById("plan-section");
  const generatePlanBtn = document.getElementById("generate-plan-btn");
  const planStepsContainer = document.getElementById("plan-steps-container");
  const actionLogSection = document.getElementById("action-log-section");
  const actionLogContainer = document.getElementById("action-log-container");
  
  const geminiKeyInput = document.getElementById("settings-gemini-key");
  const saveKeyBtn = document.getElementById("save-settings-btn");
  const keyStatus = document.getElementById("settings-status");

  // Resume Workspace Elements
  const resumeUploadInput = document.getElementById("resume-workspace-upload");
  const resumeUploadBtn = document.getElementById("resume-workspace-btn");
  const resumeStatusDiv = document.getElementById("resume-upload-status");

  const customEssayPromptInput = document.getElementById("settings-custom-essay-prompt");

  // Load Settings & Resume Info on Startup
  loadSettings();
  loadResumeInfo();

  // Open Dashboard Home Tab handler
  const spHomeBtn = document.getElementById("sp-home-btn");
  if (spHomeBtn) {
    spHomeBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
  }

  if (openDashboardBtn) {
    openDashboardBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
  }

  // Load and Save settings API key
  async function loadSettings() {
    const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
    if (settings) {
      if (settings.GEMINI_API_KEY) {
        geminiKeyInput.value = settings.GEMINI_API_KEY;
      }
      if (settings.CUSTOM_ESSAY_PROMPT) {
        customEssayPromptInput.value = settings.CUSTOM_ESSAY_PROMPT;
      }
    }
  }

  saveKeyBtn.addEventListener("click", async () => {
    const key = geminiKeyInput.value.trim();
    const customEssayPrompt = customEssayPromptInput.value.trim();
    const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
    const payload = { ...settings, GEMINI_API_KEY: key, CUSTOM_ESSAY_PROMPT: customEssayPrompt };
    
    const response = await chrome.runtime.sendMessage({
      action: "SAVE_SETTINGS",
      payload: payload
    });

    if (response && response.success) {
      keyStatus.style.display = "block";
      setTimeout(() => {
        keyStatus.style.display = "none";
      }, 2000);
      
      // Re-scan tab after saving key to enable actions
      initializeScanner();
    }
  });

  // Resume Workspace Upload handlers in sidepanel
  if (resumeUploadInput && resumeUploadBtn) {
    resumeUploadInput.addEventListener("change", () => {
      const file = resumeUploadInput.files[0];
      if (file) {
        resumeUploadBtn.removeAttribute("disabled");
        resumeStatusDiv.textContent = `Selected: ${file.name}`;
      } else {
        resumeUploadBtn.setAttribute("disabled", "true");
        resumeStatusDiv.textContent = "Select a PDF or DOCX file.";
      }
    });

    resumeUploadBtn.addEventListener("click", () => {
      const file = resumeUploadInput.files[0];
      if (!file) return;

      resumeStatusDiv.textContent = "Reading file...";
      resumeUploadBtn.setAttribute("disabled", "true");

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result.split(",")[1];
          resumeStatusDiv.textContent = "Uploading to profile database...";
          
          const payload = {
            filename: file.name,
            base64Data: base64Data
          };

          const response = await chrome.runtime.sendMessage({
            action: "SAVE_RESUME_FILE",
            payload: payload
          });

          if (response && response.success) {
            resumeStatusDiv.textContent = "Upload successful!";
            resumeUploadInput.value = "";
            resumeUploadBtn.setAttribute("disabled", "true");
            loadResumeInfo();
          } else {
            resumeStatusDiv.textContent = `Upload failed: ${response?.error || 'Unknown error'}`;
            resumeUploadBtn.removeAttribute("disabled");
          }
        } catch (err) {
          resumeStatusDiv.textContent = `Error: ${err.message}`;
          resumeUploadBtn.removeAttribute("disabled");
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Active page scanning loop
  async function initializeScanner() {
    try {
      const lastFocusedNormalWin = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (!lastFocusedNormalWin) {
        statusMessage.textContent = "Please focus a browser window to scan.";
        return;
      }
      const tabs = await chrome.tabs.query({ active: true, windowId: lastFocusedNormalWin.id });
      if (tabs.length > 0) {
        activeTab = tabs[0];
        
        if (activeTab.url && (activeTab.url.startsWith("http://") || activeTab.url.startsWith("https://"))) {
          statusMessage.textContent = `Scanning ${new URL(activeTab.url).hostname}...`;
          
          chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_FORM" }, async (response) => {
            if (chrome.runtime.lastError) {
              statusMessage.innerHTML = `⚠️ Connection error: ${chrome.runtime.lastError.message}<br><small style="color:var(--text-secondary);font-size:0.75rem;margin-top:4px;display:block;">Please refresh the tab of your job page to connect.</small>`;
              console.warn(chrome.runtime.lastError.message);
              return;
            }

            if (response && response.success) {
              formFields = response.fields || [];
              detectedJob = response.jobDetails;

              if (formFields.length > 0) {
                statusMessage.innerHTML = `🟢 Form Detected! (<span style="color:#6366f1;font-weight:600;">${formFields.length} fields</span>)`;
                
                if (detectedJob) {
                  detectedJobInfo.style.display = "block";
                  detectedJobInfo.textContent = `${detectedJob.role || detectedJob.title || 'Role'} @ ${detectedJob.company}`;
                }
                
                autofillBtn.removeAttribute("disabled");
                syncFormBtn.removeAttribute("disabled");
                if (genCoverLetterBtn) genCoverLetterBtn.removeAttribute("disabled");

                // Show plan section after form is detected
                if (planSection) planSection.style.display = "block";
                if (actionLogSection) actionLogSection.style.display = "none";

                // Check if password fields exist (indicates login/signup page)
                const hasPasswordFields = formFields.some(f => f.type === 'password');
                if (hasPasswordFields) {
                  const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
                  const accounts = await chrome.runtime.sendMessage({ action: "GET_PORTAL_ACCOUNTS" });
                  const currentDomain = new URL(activeTab.url).hostname.toLowerCase();
                  
                  // Find account matching domain or default email
                  matchingPortalAccount = accounts.find(acc => currentDomain.includes(acc.domain) || acc.domain.includes(currentDomain));
                  
                  if (!matchingPortalAccount && settings && settings.DEFAULT_PORTAL_EMAIL && settings.DEFAULT_PORTAL_PASSWORD) {
                    matchingPortalAccount = {
                      domain: "Default Portal Fallback",
                      username: settings.DEFAULT_PORTAL_EMAIL,
                      password: settings.DEFAULT_PORTAL_PASSWORD
                    };
                  }

                  portalCard.style.display = "block";
                  if (matchingPortalAccount) {
                    portalAccountName.innerHTML = `Found account for <strong>${matchingPortalAccount.domain}</strong> (${matchingPortalAccount.username})`;
                    autofillCredsBtn.textContent = "🔒 Fill Portal Account";
                    autofillCredsBtn.removeAttribute("disabled");
                  } else {
                    portalAccountName.textContent = "No credentials saved. Click to configure in Dashboard settings.";
                    autofillCredsBtn.textContent = "➕ Open Settings";
                    autofillCredsBtn.removeAttribute("disabled");
                  }
                } else {
                  portalCard.style.display = "none";
                }
              } else {
                statusMessage.textContent = "🟡 No input fields detected on this page.";
                autofillBtn.setAttribute("disabled", "true");
                syncFormBtn.setAttribute("disabled", "true");
                portalCard.style.display = "none";
              }
            } else {
              statusMessage.textContent = "🔴 Failed to scan page fields.";
            }
          });
        } else {
          statusMessage.textContent = "🔒 Restricted browser page.";
        }
      }
    } catch (err) {
      statusMessage.textContent = "Error scanning tab.";
      console.error(err);
    }
  }

  // Trigger scanning initially
  initializeScanner();

  // Re-run scan when active tab changes or page updates
  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.onActivated.addListener(initializeScanner);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === "complete") {
        initializeScanner();
      }
    });
  }

  // Fill Portal Credentials button click
  autofillCredsBtn.addEventListener("click", async () => {
    if (!matchingPortalAccount) {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#settings") });
      return;
    }

    autofillCredsBtn.setAttribute("disabled", "true");
    chrome.tabs.sendMessage(activeTab.id, {
      action: "FILL_PORTAL_CREDENTIALS",
      payload: {
        username: matchingPortalAccount.username,
        password: matchingPortalAccount.password
      }
    }, (response) => {
      if (response && response.success && response.filled) {
        autofillCredsBtn.textContent = "🔒 Credentials Filled!";
      } else {
        autofillCredsBtn.removeAttribute("disabled");
        alert("Failed to locate username/password fields on page.");
      }
    });
  });

  // Fill Application button click
  autofillBtn.addEventListener("click", async () => {
    if (!activeTab || formFields.length === 0) return;

    const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
    if (!settings.GEMINI_API_KEY) {
      alert("Please enter and save your Gemini API Key first.");
      return;
    }

    autofillBtn.setAttribute("disabled", "true");
    autofillBtn.textContent = "🧠 AI Mapping Fields...";
    statusMessage.textContent = "Generating mappings using AI...";

    // Hide any previous intervention banner
    const interventionBanner = document.getElementById('intervention-banner');
    if (interventionBanner) interventionBanner.style.display = 'none';

    try {
      const mappingResponse = await chrome.runtime.sendMessage({
        action: "MAP_FORM_FIELDS",
        payload: {
          fields: formFields,
          jobUrl: detectedJob ? detectedJob.url : activeTab.url,
          jobText: detectedJob ? detectedJob.textSnippet : ""
        }
      });

      if (!mappingResponse || !mappingResponse.success || !mappingResponse.mappings) {
        throw new Error(mappingResponse.error || "No mappings received.");
      }

      statusMessage.textContent = "Applying autofill inputs...";
      
      chrome.tabs.sendMessage(activeTab.id, {
        action: "FILL_FORM",
        payload: { mappings: mappingResponse.mappings }
      }, async (fillResponse) => {
        if (fillResponse && fillResponse.success) {
          autofillBtn.textContent = "✨ Autofilled!";
          statusMessage.innerHTML = `🎉 Filled <strong style="color:#10b981;">${fillResponse.filledCount} fields</strong> successfully!`;

          // Render action log from mappings metadata
          if (actionLogSection && actionLogContainer) {
            renderActionLog(mappingResponse.mappings, actionLogContainer);
            actionLogSection.style.display = "block";
          }
          
          await chrome.runtime.sendMessage({
            action: "ADD_APPLICATION",
            payload: {
              company: detectedJob ? detectedJob.company : new URL(activeTab.url).hostname,
              role: detectedJob ? detectedJob.role : "Job Applicant",
              url: detectedJob ? detectedJob.url : activeTab.url,
              status: "In Progress",
              notes: "Autofilled by AI Agent Controller."
            }
          });

          // Phase 2: Run CAPTCHA / intervention detection after fill
          setTimeout(() => {
            chrome.tabs.sendMessage(activeTab.id, { action: "DETECT_HUMAN_INTERVENTION" }, (interventionRes) => {
              if (chrome.runtime.lastError) return;
              if (interventionRes && interventionRes.requiresIntervention) {
                showInterventionBanner(interventionRes.reason, interventionRes.type);
              } else {
                // Phase 3: Check if auto-navigate is enabled
                const autonavToggle = document.getElementById('autonav-toggle');
                if (autonavToggle && autonavToggle.checked) {
                  checkAndOfferNavigation();
                }
              }
            });
          }, 800);

        } else {
          statusMessage.textContent = "Failed to populate form.";
          autofillBtn.removeAttribute("disabled");
          autofillBtn.textContent = "✨ Fill Application";
        }
      });

    } catch (e) {
      console.error("Autofill failure:", e);
      statusMessage.textContent = `❌ Error: ${e.message}`;
      autofillBtn.removeAttribute("disabled");
      autofillBtn.textContent = "✨ Fill Application";
    }
  });

  // Sync Typed Answers back to Profile memory
  syncFormBtn.addEventListener("click", () => {
    if (!activeTab) return;

    statusMessage.textContent = "Scanning typed answers...";
    syncFormBtn.setAttribute("disabled", "true");

    chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_FILLED_VALUES" }, async (response) => {
      if (response && response.success && response.filledValues && response.filledValues.length > 0) {
        const answers = response.filledValues.map(item => ({
          question: item.labelText,
          answer: item.value
        }));

        const proposedJson = { customAnswers: answers };
        await chrome.storage.local.set({ tempProposedJson: proposedJson });

        statusMessage.textContent = "Redirecting to Dashboard Merge Review...";
        chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#merge") });
      } else {
        syncFormBtn.removeAttribute("disabled");
        statusMessage.textContent = "No typed/filled values detected to sync.";
        alert("Please ensure you have filled out some form fields on the page before syncing.");
      }
    });
  });

  // Generate Plan button handler
  if (generatePlanBtn) {
    generatePlanBtn.addEventListener("click", async () => {
      if (!formFields || formFields.length === 0) {
        planStepsContainer.innerHTML = `<div style="font-size:0.78rem;color:var(--text-secondary);text-align:center;">No form fields detected yet.</div>`;
        return;
      }
      generatePlanBtn.setAttribute("disabled", "true");
      generatePlanBtn.textContent = "Planning...";
      planStepsContainer.innerHTML = `<div style="font-size:0.78rem;color:var(--text-secondary);text-align:center;padding:8px 0;">🧠 Generating plan with AI...</div>`;

      try {
        const planResponse = await chrome.runtime.sendMessage({
          action: "GENERATE_PLAN",
          payload: {
            pageContext: detectedJob || { url: activeTab?.url, platform: 'generic' },
            fields: formFields,
            jobText: detectedJob?.textSnippet || ""
          }
        });

        if (planResponse && planResponse.success && planResponse.plan) {
          currentPlan = planResponse.plan;
          renderPlan(planResponse.plan, planStepsContainer, planResponse.source);
        } else {
          planStepsContainer.innerHTML = `<div style="font-size:0.78rem;color:#ef4444;">Failed to generate plan.</div>`;
        }
      } catch (err) {
        planStepsContainer.innerHTML = `<div style="font-size:0.78rem;color:#ef4444;">Error: ${err.message}</div>`;
      }

      generatePlanBtn.removeAttribute("disabled");
      generatePlanBtn.textContent = "Regenerate";
    });
  }

  // Phase 3: Auto-Navigate panel wire-up
  const autonavPanel = document.getElementById('autonav-panel');
  const autonavToggle = document.getElementById('autonav-toggle');
  const autonavProceedBtn = document.getElementById('autonav-proceed-btn');
  const autonavPauseBtn = document.getElementById('autonav-pause-btn');
  const autonavConfirmPanel = document.getElementById('autonav-confirm-panel');
  const autonavNextLabel = document.getElementById('autonav-next-label');

  // Show the auto-navigate panel when a form is detected
  if (autonavPanel) autonavPanel.style.display = 'block';

  if (autonavToggle) {
    autonavToggle.addEventListener('change', () => {
      const status = document.getElementById('autonav-status');
      if (autonavToggle.checked) {
        if (status) status.textContent = 'Auto-navigate is ON. After each fill, the agent will detect and offer to click the next page button.';
      } else {
        if (status) status.textContent = 'Auto-navigate is OFF. Enable to allow the agent to advance pages automatically.';
        if (autonavConfirmPanel) autonavConfirmPanel.style.display = 'none';
      }
    });
  }

  if (autonavProceedBtn) {
    autonavProceedBtn.addEventListener('click', async () => {
      autonavProceedBtn.setAttribute('disabled', 'true');
      autonavProceedBtn.textContent = 'Navigating...';
      chrome.tabs.sendMessage(activeTab.id, { action: 'CLICK_NEXT_PAGE_BUTTON' }, async (navRes) => {
        if (chrome.runtime.lastError || !navRes || !navRes.clicked) {
          statusMessage.textContent = '⚠️ Could not click next-page button. Please navigate manually.';
        } else {
          statusMessage.textContent = `⏭️ Navigated: "${navRes.label}". Rescanning new page...`;
        }
        if (autonavConfirmPanel) autonavConfirmPanel.style.display = 'none';
        autonavProceedBtn.removeAttribute('disabled');
        autonavProceedBtn.textContent = 'Proceed';
        // Re-initialize scanner after navigation settles
        setTimeout(initializeScanner, 1500);
      });
    });
  }

  if (autonavPauseBtn) {
    autonavPauseBtn.addEventListener('click', () => {
      if (autonavConfirmPanel) autonavConfirmPanel.style.display = 'none';
      if (autonavToggle) autonavToggle.checked = false;
      const status = document.getElementById('autonav-status');
      if (status) status.textContent = 'Auto-navigate paused. Re-enable to continue.';
    });
  }

  // Phase 2: Resume Automation button
  const resumeAutomationBtn = document.getElementById('resume-automation-btn');
  if (resumeAutomationBtn) {
    resumeAutomationBtn.addEventListener('click', () => {
      const interventionBanner = document.getElementById('intervention-banner');
      if (interventionBanner) interventionBanner.style.display = 'none';
      autofillBtn.removeAttribute('disabled');
      autofillBtn.textContent = '✨ Fill Application';
      statusMessage.textContent = '✅ Intervention resolved. Ready to continue.';
    });
  }

  // --- COVER LETTER GENERATOR MODAL ---
  const clModal = document.getElementById("cover-letter-modal");
  const clGeneratingState = document.getElementById("cl-generating-state");
  const clEditorState = document.getElementById("cl-editor-state");
  const clErrorState = document.getElementById("cl-error-state");
  const clEditorTextarea = document.getElementById("cl-editor-textarea");
  const clSaveName = document.getElementById("cl-save-name");
  const clCharCount = document.getElementById("cl-char-count");
  const clStatusMsg = document.getElementById("cl-status-msg");
  const clUploadBtn = document.getElementById("cl-upload-btn");
  const clSaveKbBtn = document.getElementById("cl-save-kb-btn");
  const clDownloadBtn = document.getElementById("cl-download-btn");
  const clModalClose = document.getElementById("cl-modal-close");
  const clRetryBtn = document.getElementById("cl-retry-btn");
  const clErrorText = document.getElementById("cl-error-text");

  function showClState(state) {
    clGeneratingState.style.display = state === "generating" ? "block" : "none";
    clEditorState.style.display = state === "editor" ? "flex" : "none";
    clErrorState.style.display = state === "error" ? "block" : "none";
  }

  function setClStatus(msg, color) {
    if (clStatusMsg) {
      clStatusMsg.textContent = msg;
      clStatusMsg.style.color = color || "#94a3b8";
    }
  }

  async function triggerGenerate() {
    if (!clModal) return;
    clModal.style.display = "block";
    showClState("generating");
    setClStatus("", "");

    const jobUrl = activeTab ? activeTab.url : "";

    // Step 1: Do a fresh, targeted scrape of the job description from the page
    let jobText = detectedJob ? (detectedJob.textSnippet || "") : "";
    let scrapeSource = "cached";

    if (activeTab && activeTab.id) {
      try {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(activeTab.id, { action: "SCRAPE_JOB_DESCRIPTION" }, (response) => {
            if (!chrome.runtime.lastError && response && response.success && response.jobText) {
              jobText = response.jobText;
              scrapeSource = `live (${response.charCount.toLocaleString()} chars raw)`;
            }
            resolve();
          });
        });
      } catch (err) {
        console.warn("[Cover Letter] Live scrape failed, using cached snippet:", err);
      }
    }

    setClStatus(`📄 Scraped ${scrapeSource} · Sending to Gemini...`, "#818cf8");

    try {
      const res = await chrome.runtime.sendMessage({
        action: "GENERATE_COVER_LETTER",
        payload: { jobText, jobUrl }
      });

      if (!res || !res.success) {
        clErrorText.textContent = res?.error || "Generation failed. Please try again.";
        showClState("error");
        return;
      }

      clEditorTextarea.value = res.text;
      clSaveName.value = res.suggestedName || `Cover Letter – ${new Date().toLocaleDateString()}`;
      clCharCount.textContent = `${res.text.length.toLocaleString()} characters`;
      showClState("editor");
    } catch (err) {
      clErrorText.textContent = err.message || "Unexpected error.";
      showClState("error");
    }
  }

  if (genCoverLetterBtn) {
    genCoverLetterBtn.addEventListener("click", triggerGenerate);
  }

  if (clModalClose) {
    clModalClose.addEventListener("click", () => {
      clModal.style.display = "none";
    });
  }

  // Close modal on backdrop click
  if (clModal) {
    clModal.addEventListener("click", (e) => {
      if (e.target === clModal) clModal.style.display = "none";
    });
  }

  if (clRetryBtn) {
    clRetryBtn.addEventListener("click", triggerGenerate);
  }

  // Update character count on edit
  if (clEditorTextarea) {
    clEditorTextarea.addEventListener("input", () => {
      const len = clEditorTextarea.value.length;
      if (clCharCount) clCharCount.textContent = `${len.toLocaleString()} characters`;
    });
  }

  // Upload to Form
  if (clUploadBtn) {
    clUploadBtn.addEventListener("click", async () => {
      if (!activeTab) {
        setClStatus("No active tab detected.", "#f87171");
        return;
      }
      const text = clEditorTextarea.value.trim();
      if (!text) {
        setClStatus("Please generate or type a cover letter first.", "#f87171");
        return;
      }
      clUploadBtn.setAttribute("disabled", "true");
      clUploadBtn.textContent = "Uploading...";
      chrome.tabs.sendMessage(activeTab.id, {
        action: "INJECT_COVER_LETTER",
        payload: { text }
      }, (response) => {
        clUploadBtn.removeAttribute("disabled");
        clUploadBtn.textContent = "📥 Upload to Application Form";
        if (chrome.runtime.lastError) {
          setClStatus("❌ Could not reach the page. Make sure the job page is open.", "#f87171");
          return;
        }
        if (response && response.success) {
          setClStatus("✅ Cover letter uploaded to form successfully!", "#34d399");
        } else {
          setClStatus(`❌ ${response?.error || "Could not find cover letter field on page."}`, "#f87171");
        }
      });
    });
  }

  // Save to Knowledge Base
  if (clSaveKbBtn) {
    clSaveKbBtn.addEventListener("click", async () => {
      const text = clEditorTextarea.value.trim();
      const name = clSaveName.value.trim() || `Cover Letter – ${new Date().toLocaleDateString()}`;
      if (!text) {
        setClStatus("No letter text to save.", "#f87171");
        return;
      }
      clSaveKbBtn.setAttribute("disabled", "true");
      clSaveKbBtn.textContent = "Saving...";
      try {
        const res = await chrome.runtime.sendMessage({
          action: "SAVE_COVER_LETTER_TO_KB",
          payload: { name, text, analysis: null }
        });
        if (res && res.success) {
          setClStatus("✅ Saved to Knowledge Base!", "#34d399");
        } else {
          setClStatus(`❌ Save failed: ${res?.error || "Unknown error."}`, "#f87171");
        }
      } catch (err) {
        setClStatus(`❌ ${err.message}`, "#f87171");
      }
      clSaveKbBtn.removeAttribute("disabled");
      clSaveKbBtn.textContent = "💾 Save to Knowledge Base";
    });
  }

  // Download as .txt
  if (clDownloadBtn) {
    clDownloadBtn.addEventListener("click", () => {
      const text = clEditorTextarea.value.trim();
      const name = clSaveName.value.trim() || "cover_letter";
      if (!text) {
        setClStatus("No letter text to download.", "#f87171");
        return;
      }
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setClStatus("⬇ Downloaded!", "#818cf8");
    });
  }

});

// Phase 2: Show intervention banner
function showInterventionBanner(reason, type) {
  const banner = document.getElementById('intervention-banner');
  const reasonEl = document.getElementById('intervention-reason');
  const resumeBtn = document.getElementById('resume-automation-btn');
  if (!banner) return;

  const typeLabels = {
    captcha_recaptcha: '🤖 reCAPTCHA',
    captcha_hcaptcha: '🤖 hCaptcha',
    captcha_cloudflare: '☁️ Cloudflare CAPTCHA',
    captcha_aria: '🤖 CAPTCHA',
    captcha_text: '🤖 CAPTCHA',
    otp_required: '📱 OTP / 2FA Code',
    high_risk_question: '⚠️ Background Check',
    login_wall: '🔐 Login Required',
  };
  const typeLabel = typeLabels[type] || '⚠️ Human Review';
  if (reasonEl) reasonEl.textContent = `${typeLabel} detected: ${reason || 'Please resolve manually to continue.'}` ;
  banner.style.display = 'block';
  if (resumeBtn) resumeBtn.removeAttribute('disabled');
}

// Phase 3: Check for next-page button and show confirmation
function checkAndOfferNavigation() {
  if (!window._activeTab) return; // Needs activeTab in scope — handled via closure
}
// Note: checkAndOfferNavigation is called inside DOMContentLoaded closure where activeTab is accessible.
// Renders the execution plan steps in the plan container
function renderPlan(plan, container, source) {
  const sourceLabel = source === 'llm' ? '🧠 AI-Generated' : '⚡ Heuristic';
  const riskColors = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
  const riskIcons = { low: '🟢', medium: '🟡', high: '🔴' };

  let html = `<div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:6px;">${sourceLabel} · ${plan.estimatedSteps} steps</div>`;

  for (const step of plan.steps) {
    const riskColor = riskColors[step.riskLevel] || '#6366f1';
    const riskIcon = riskIcons[step.riskLevel] || '⚪';
    const confirmBadge = step.requiresConfirmation
      ? `<span style="font-size:0.65rem;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:4px;padding:1px 5px;margin-left:4px;">⚠ Review</span>`
      : '';

    html += `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${riskColor};border-radius:6px;padding:7px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:0.78rem;font-weight:600;color:#fff;">${step.step}. ${step.label}${confirmBadge}</div>
          <div style="font-size:0.7rem;color:${riskColor};">${riskIcon} ${step.riskLevel}</div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">${step.description}</div>
      </div>`;
  }

  container.innerHTML = html;
}

// Renders the action log from LLM mappings with intent + confidence badges
function renderActionLog(mappings, container) {
  if (!mappings || mappings.length === 0) {
    container.innerHTML = `<div style="font-size:0.78rem;color:var(--text-secondary);">No actions logged.</div>`;
    return;
  }

  const statusColors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', skipped: '#6b7280' };

  let html = '';
  for (const m of mappings) {
    if (!m) continue;
    const conf = m.confidence != null ? `${Math.round(m.confidence * 100)}%` : '—';
    const intent = m.intent || 'unknown';
    const status = m.value == null ? 'skipped' : 'success';
    const statusColor = statusColors[status] || '#6366f1';
    const valuePreview = m.value != null ? String(m.value).substring(0, 40) : '(skipped)';
    const intentColor = status === 'skipped' ? '#6b7280' : '#818cf8';

    html += `
      <div style="display:flex;gap:6px;align-items:flex-start;font-size:0.72rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="min-width:6px;height:6px;border-radius:50%;background:${statusColor};margin-top:4px;flex-shrink:0;"></span>
        <div style="flex:1;overflow:hidden;">
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            <span style="color:${intentColor};font-weight:600;">${intent}</span>
            <span style="color:var(--text-secondary);">·</span>
            <span style="color:#94a3b8;">${conf}</span>
          </div>
          <div style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${valuePreview}</div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}


// Load Active Resume File workspace card renderer
async function loadResumeInfo() {
  const res = await chrome.runtime.sendMessage({ action: "GET_RESUME_FILE" });
  const container = document.getElementById("active-resume-card");
  if (!container) return;

  if (res && res.filename) {
    const dateFormatted = res.updatedAt ? new Date(res.updatedAt).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    }) : "Unknown";

    container.innerHTML = `
      <div class="icon-resume-placeholder" style="margin-bottom: 6px; font-size: 1.5rem;">📄</div>
      <div style="font-weight: 600; font-size: 0.85rem; word-break: break-all; color: #fff; text-align: center; max-width: 100%;">${res.filename}</div>
      <div class="desc-small-text" style="margin-top: 2px; font-size: 0.75rem;">Uploaded: ${dateFormatted}</div>
      
      <div style="display: flex; gap: 8px; margin-top: 10px; width: 100%;">
        <button id="sp-download-resume-btn" class="btn btn-secondary" style="flex-grow: 1; padding: 4px; font-size: 0.75rem;">Download</button>
        <button id="sp-delete-resume-btn" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;">Delete</button>
      </div>
    `;

    document.getElementById("sp-download-resume-btn").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${res.base64Data}`;
      link.download = res.filename;
      link.click();
    });

    document.getElementById("sp-delete-resume-btn").addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete the active reference resume?")) {
        const delRes = await chrome.runtime.sendMessage({ action: "DELETE_RESUME_FILE" });
        if (delRes && delRes.success) {
          loadResumeInfo();
        }
      }
    });
  } else {
    container.innerHTML = `
      <div class="icon-resume-placeholder" style="margin-bottom: 6px; font-size: 1.5rem;">📄</div>
      <div class="desc-small-text" style="font-size: 0.8rem; color: var(--text-secondary);">No reference resume uploaded yet.</div>
    `;
  }
}
