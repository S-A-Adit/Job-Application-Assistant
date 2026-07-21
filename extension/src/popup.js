// popup.js - Twin controller for AI Job Agent standalone popup window

let activeTab = null;
let formFields = [];
let detectedJob = null;
let matchingPortalAccount = null;

document.addEventListener("DOMContentLoaded", () => {
  const statusMessage = document.getElementById("status-message");
  const detectedJobInfo = document.getElementById("detected-job-info");
  const portalCard = document.getElementById("portal-card");
  const portalAccountName = document.getElementById("portal-account-name");
  const autofillCredsBtn = document.getElementById("autofill-creds-btn");
  const autofillBtn = document.getElementById("autofill-btn");
  const syncFormBtn = document.getElementById("sync-form-btn");
  const openDashboardBtn = document.getElementById("open-dashboard-btn");
  
  const popupHomeBtn = document.getElementById("popup-home-btn");
  const closePopupBtn = document.getElementById("close-popup-btn");
  const geminiKeyInput = document.getElementById("settings-gemini-key");
  const saveKeyBtn = document.getElementById("save-settings-btn");
  const keyStatus = document.getElementById("settings-status");

  // Resume Workspace Elements
  const resumeUploadInput = document.getElementById("resume-workspace-upload");
  const resumeUploadBtn = document.getElementById("resume-workspace-btn");
  const resumeStatusDiv = document.getElementById("resume-upload-status");

  // Load Settings & Resume Info on Startup
  loadSettings();
  loadResumeInfo();

  // Close Popup button handler
  if (closePopupBtn) {
    closePopupBtn.addEventListener("click", () => {
      window.close();
    });
  }

  // Home buttons handler
  if (popupHomeBtn) {
    popupHomeBtn.addEventListener("click", () => {
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
    if (settings && settings.GEMINI_API_KEY) {
      geminiKeyInput.value = settings.GEMINI_API_KEY;
    }
  }

  saveKeyBtn.addEventListener("click", async () => {
    const key = geminiKeyInput.value.trim();
    const settings = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
    const payload = { ...settings, GEMINI_API_KEY: key };
    
    const response = await chrome.runtime.sendMessage({
      action: "SAVE_SETTINGS",
      payload: payload
    });

    if (response && response.success) {
      keyStatus.style.display = "block";
      setTimeout(() => {
        keyStatus.style.display = "none";
      }, 2000);
      
      // Re-scan tab after saving key
      initializeScanner();
    }
  });

  // Resume Workspace Upload handlers
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
      const urlParams = new URLSearchParams(window.location.search);
      const queryTabId = urlParams.get('tabId');
      
      if (queryTabId) {
        const tab = await chrome.tabs.get(parseInt(queryTabId));
        activeTab = tab;
      } else {
        const lastFocusedNormalWin = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
        if (!lastFocusedNormalWin) {
          statusMessage.textContent = "Please focus a browser window to scan.";
          return;
        }
        const tabs = await chrome.tabs.query({ active: true, windowId: lastFocusedNormalWin.id });
        if (tabs.length > 0) {
          activeTab = tabs[0];
        }
      }
      
      if (activeTab) {
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
        window.close();
      } else {
        syncFormBtn.removeAttribute("disabled");
        statusMessage.textContent = "No typed/filled values detected to sync.";
        alert("Please ensure you have filled out some form fields on the page before syncing.");
      }
    });
  });
});

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
        <button id="pop-download-resume-btn" class="btn btn-secondary" style="flex-grow: 1; padding: 4px; font-size: 0.75rem;">Download</button>
        <button id="pop-delete-resume-btn" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;">Delete</button>
      </div>
    `;

    document.getElementById("pop-download-resume-btn").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${res.base64Data}`;
      link.download = res.filename;
      link.click();
    });

    document.getElementById("pop-delete-resume-btn").addEventListener("click", async () => {
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
