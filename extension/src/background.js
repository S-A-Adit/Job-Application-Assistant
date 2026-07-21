// background.js - Service Worker for AI Job Agent Extension

// Rate Limiter wrapper for Google Gemini API calls (to prevent 429 RESOURCE_EXHAUSTED errors)
const originalFetch = globalThis.fetch;
let lastGeminiRequestTime = 0;
const GEMINI_MIN_DELAY_MS = 15000; // 15 seconds (4 requests per minute)

globalThis.fetch = async function (url, options) {
  const urlString = typeof url === 'string' ? url : (url && url.url) || '';
  if (urlString.includes('generativelanguage.googleapis.com')) {
    const now = Date.now();
    const timeSinceLast = now - lastGeminiRequestTime;
    if (timeSinceLast < GEMINI_MIN_DELAY_MS) {
      const delayMs = GEMINI_MIN_DELAY_MS - timeSinceLast;
      console.log(`[Rate Limiter] Spacing requests. Waiting for ${Math.round(delayMs / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    lastGeminiRequestTime = Date.now();
  }
  return originalFetch(url, options);
};

// Default empty profile
const DEFAULT_PROFILE = {
  name: "",
  contact: {
    email: "",
    phone: "",
    location: "36 Madison Avenue, Madison New Jersey 07940",
    firstName: "",
    lastName: "",
    preferredName: "",
    birthday: "",
    houseNumber: "",
    streetName: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    linkedin: "",
    github: "",
    portfolio: ""
  },
  gender: "",
  race: "",
  veteranStatus: "",
  disability_status: "",
  education: [],
  skills: [],
  coursework: [],
  honors_and_awards: [],
  experience: [],
  projects: [],
  certifications: [],
  customAnswers: [],
  preferences: {
    visa_status: "",
    sponsorship_required: false,
    authorized_to_work: true,
    salary: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    locations: [],
    remote: true,
    willing_to_relocate: false,
    employment_types: ["Full-time"],
    notice_period: "",
    availability_date: ""
  }
};

// Side panel can be opened manually via Open Panel button in popup

let activePopupWinId = null;

if (typeof chrome !== "undefined" && chrome.action) {
  chrome.action.onClicked.addListener(async () => {
    if (activePopupWinId !== null) {
      try {
        await chrome.windows.update(activePopupWinId, { focused: true });
        return;
      } catch (err) {
        activePopupWinId = null;
      }
    }

    let leftPosition = 100;
    let topPosition = 100;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin && currentWin.left !== undefined) {
        leftPosition = currentWin.left + currentWin.width - 360;
        topPosition = currentWin.top + 50;
        if (leftPosition < 0) leftPosition = 100;
      }
    } catch (e) {
      console.warn("Could not determine window positions:", e);
    }

    const popupWin = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 350,
      height: 650,
      left: Math.round(leftPosition),
      top: Math.round(topPosition),
      focused: true
    });
    activePopupWinId = popupWin.id;
  });
}

// Listen for message events from popup, sidepanel, dashboard, and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then(sendResponse)
    .catch(err => {
      console.error("Background error processing message:", err);
      sendResponse({ error: err.message });
    });
  return true; 
});

async function handleMessage(request, sender) {
  const { action, payload } = request;
  if (!action) return { success: false, error: "No action provided" };

  const normalizedAction = action.toUpperCase().replace(/[^A-Z0-9]/g, "");

  switch (normalizedAction) {
    case "GETPROFILE":
      return await getProfile();
    case "SAVE_PROFILE":
    case "SAVEPROFILE":
      return await saveProfile(payload);
    case "GETSETTINGS":
      return await getSettings();
    case "SAVESETTINGS":
      return await saveSettings(payload);
    case "PARSERESUMEPDF":
      return await parseResumePdf(payload.base64Data, payload.filename);
    case "PARSERESUMETEXT":
      return await parseResumeText(payload.text);
    case "GETAPPLICATIONS":
      return await getApplications();
    case "ADDAPPLICATION":
      return await addApplication(payload);
    case "UPDATEAPPLICATION":
      return await updateApplication(payload);
    case "DELETEAPPLICATION":
      return await deleteApplication(payload.id);
    case "GENERATEPLAN":
    case "GENERATE_PLAN":
      return await generateApplicationPlan(payload.pageContext, payload.fields, payload.jobText);
    case "MAPFORMFIELDS":
      return await mapFormFields(payload.fields, payload.jobUrl, payload.jobText);
    case "COMPAREANDMERGE":
      return await compareAndMerge(payload.proposedJson);
    case "SUBMITAPPLICATION":
      return await submitApplication(payload.company, payload.role, payload.url);
    
    // Resume File Storage Actions
    case "GETRESUMEFILE":
      return await getResumeFile();
    case "SAVERESUMEFILE":
      return await saveResumeFile(payload.filename, payload.base64Data);
    case "DELETERESUMEFILE":
      return await deleteResumeFile();

    // Cover Letters Actions
    case "GETCOVERLETTERS":
      return await getCoverLetters();
    case "SAVECOVERLETTERS":
      return await saveCoverLetters(payload);
    case "ANALYZECOVERLETTER":
      return await analyzeCoverLetter(payload.text);
    case "PARSECOVERLETTERPDF":
      return await parseCoverLetterPdf(payload.base64Data, payload.filename);
    case "GENERATECOVERLETTER":
    case "GENERATE_COVER_LETTER":
      return await generateCoverLetter(payload.jobText, payload.jobUrl);
    case "SAVECOVERLETTERTOKB":
    case "SAVE_COVER_LETTER_TO_KB":
      return await saveCoverLetterToKB(payload.name, payload.text, payload.analysis);

    // Portal Credentials Actions
    case "GETPORTALACCOUNTS":
      return await getPortalAccounts();
    case "SAVEPORTALACCOUNTS":
      return await savePortalAccounts(payload);

    // Export/Import Backup Actions
    case "EXPORTALLDATA":
      return await exportAllData();
    case "IMPORTALLDATA":
      return await importAllData(payload);

    case "FORCESYNCTOBACKEND":
      return await forceSyncToBackend();

    case "MAPDYNAMICFIELDS":
      return await mapFormFields(payload.fields, "", "");

    // Replay Sessions Actions
    case "SAVEREPLAYSNAPSHOT":
      return await saveReplaySnapshot(payload);
    case "GETREPLAYS":
      return await getReplays();
    case "DELETEREPLAY":
      return await deleteReplay(payload.id);

    // Benchmark Actions
    case "SAVEBENCHMARK":
    case "SAVE_BENCHMARK":
      return await saveBenchmarkSession(payload);
    case "GETBENCHMARKS":
    case "GET_BENCHMARKS":
      return await getBenchmarkReport();
    case "COMPUTEBENCHMARK":
    case "COMPUTE_BENCHMARK":
      return await computeBenchmarkFromLog(payload);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// Storage Helpers
// Storage Helpers
async function getProfile() {
  try {
    const res = await fetch(`${BACKEND_URL}/profile`);
    if (res.ok) {
      const dbProfile = await res.json();
      if (dbProfile) {
        await chrome.storage.local.set({ profile: dbProfile });
        return dbProfile;
      }
    }
  } catch (err) {
    console.log("Backend offline, falling back to local profile:", err);
  }
  const data = await chrome.storage.local.get("profile");
  if (!data.profile) {
    await chrome.storage.local.set({ profile: DEFAULT_PROFILE });
    return DEFAULT_PROFILE;
  }
  return data.profile;
}

async function saveProfile(profile) {
  await chrome.storage.local.set({ profile });
  try {
    await fetch(`${BACKEND_URL}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile })
    });
  } catch (err) {
    console.log("Backend offline, profile saved locally only:", err);
  }
  return { success: true, profile };
}

async function getSettings() {
  try {
    const res = await fetch(`${BACKEND_URL}/settings`);
    if (res.ok) {
      const dbSettings = await res.json();
      if (dbSettings) {
        await chrome.storage.local.set({ settings: dbSettings });
        return dbSettings;
      }
    }
  } catch (err) {
    console.log("Backend offline, falling back to local settings:", err);
  }
  const data = await chrome.storage.local.get("settings");
  return data.settings || { 
    GEMINI_API_KEY: "", 
    GROQ_API_KEY: "", 
    GEMINI_MODEL: "gemini-2.5-flash",
    DEFAULT_PORTAL_EMAIL: "",
    DEFAULT_PORTAL_PASSWORD: ""
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
  try {
    await fetch(`${BACKEND_URL}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings })
    });
  } catch (err) {
    console.log("Backend offline, settings saved locally only:", err);
  }
  return { success: true, settings };
}

async function getApplications() {
  try {
    const res = await fetch(`${BACKEND_URL}/applications`);
    if (res.ok) {
      const dbApps = await res.json();
      if (dbApps) {
        await chrome.storage.local.set({ applications: dbApps });
        return dbApps;
      }
    }
  } catch (err) {
    console.log("Backend offline, falling back to local applications:", err);
  }
  const data = await chrome.storage.local.get("applications");
  return data.applications || [];
}

async function addApplication(app) {
  const apps = await getApplications();
  const newApp = {
    id: crypto.randomUUID(),
    company: app.company || "Unknown Company",
    role: app.role || "Unknown Role",
    url: app.url || "",
    status: app.status || "Not Applied",
    createdAt: new Date().toISOString(),
    dateApplied: app.status === "Applied" ? new Date().toISOString() : null,
    notes: app.notes || ""
  };
  apps.unshift(newApp);
  await chrome.storage.local.set({ applications: apps });
  
  try {
    await fetch(`${BACKEND_URL}/applications/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applications: apps })
    });
  } catch (err) {
    console.log("Backend offline, app saved locally only:", err);
  }
  
  return { success: true, application: newApp };
}

async function updateApplication(updatedApp) {
  const apps = await getApplications();
  const index = apps.findIndex(a => a.id === updatedApp.id);
  if (index === -1) throw new Error("Application not found.");
  
  if (updatedApp.status === "Applied" && apps[index].status !== "Applied" && !updatedApp.dateApplied) {
    updatedApp.dateApplied = new Date().toISOString();
  }
  
  apps[index] = { ...apps[index], ...updatedApp };
  await chrome.storage.local.set({ applications: apps });
  
  try {
    await fetch(`${BACKEND_URL}/applications/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applications: apps })
    });
  } catch (err) {
    console.log("Backend offline, app update saved locally only:", err);
  }
  
  return { success: true, application: apps[index] };
}

async function deleteApplication(id) {
  const apps = await getApplications();
  const filtered = apps.filter(a => a.id !== id);
  await chrome.storage.local.set({ applications: filtered });
  
  try {
    await fetch(`${BACKEND_URL}/applications/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applications: filtered })
    });
  } catch (err) {
    console.log("Backend offline, app deletion saved locally only:", err);
  }
  
  return { success: true };
}

async function submitApplication(company, role, url) {
  const apps = await getApplications();
  const existing = apps.find(a => a.url === url || (a.company.toLowerCase() === company.toLowerCase() && a.role.toLowerCase() === role.toLowerCase()));
  
  if (existing) {
    if (existing.status !== "Applied") {
      existing.status = "Applied";
      existing.dateApplied = new Date().toISOString();
      await chrome.storage.local.set({ applications: apps });
    }
    return { success: true, application: existing, updated: true };
  } else {
    const newApp = {
      id: crypto.randomUUID(),
      company,
      role,
      url,
      status: "Applied",
      createdAt: new Date().toISOString(),
      dateApplied: new Date().toISOString(),
      notes: "Auto-tracked upon form submission."
    };
    apps.unshift(newApp);
    await chrome.storage.local.set({ applications: apps });
    return { success: true, application: newApp, updated: false };
  }
}

const BACKEND_URL = "http://127.0.0.1:5000/api";

// Resume File Storage (Binary pdf saved as base64)
async function getResumeFile() {
  try {
    const res = await fetch(`${BACKEND_URL}/resumes/active`);
    if (res.ok) {
      const dbResume = await res.json();
      if (dbResume) {
        await chrome.storage.local.set({ resumeFile: dbResume });
        return dbResume;
      }
    }
  } catch (err) {
    console.log("Backend offline, falling back to local storage:", err);
  }
  const data = await chrome.storage.local.get("resumeFile");
  return data.resumeFile || null;
}

async function saveResumeFile(filename, base64Data) {
  const resumeFile = { filename, base64Data, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ resumeFile });
  
  try {
    const res = await fetch(`${BACKEND_URL}/resumes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, base64Data })
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, resumeFile: data.resumeFile };
    }
  } catch (err) {
    console.log("Backend offline, resume saved locally only:", err);
  }
  return { success: true, resumeFile };
}

async function deleteResumeFile() {
  await chrome.storage.local.remove("resumeFile");
  try {
    await fetch(`${BACKEND_URL}/resumes`, { method: "DELETE" });
  } catch (err) {
    console.log("Backend offline, resume deleted locally only:", err);
  }
  return { success: true };
}

// Cover Letters Storage
async function getCoverLetters() {
  try {
    const res = await fetch(`${BACKEND_URL}/cover-letters`);
    if (res.ok) {
      const dbLetters = await res.json();
      // Keep chrome storage in sync
      await chrome.storage.local.set({ coverLetters: dbLetters });
      return dbLetters;
    }
  } catch (err) {
    console.log("Backend offline, falling back to local storage:", err);
  }
  const data = await chrome.storage.local.get("coverLetters");
  return data.coverLetters || [];
}

async function saveCoverLetters(coverLetters) {
  await chrome.storage.local.set({ coverLetters });
  try {
    const res = await fetch(`${BACKEND_URL}/cover-letters/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetters })
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, coverLetters: data.coverLetters };
    }
  } catch (err) {
    console.log("Backend offline, changes saved locally only:", err);
  }
  return { success: true, coverLetters };
}

// AI Cover Letter Analyzer & Extractor
async function analyzeCoverLetter(text) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    return { success: false, error: "API Key is missing. Please configure it in Settings." };
  }

  const prompt = `
    You are an expert AI that analyzes previously written cover letters to extract their formatting, wording style, tone, and specific results (impact) to build a personalized knowledge base for future applications.
    Analyze the following cover letter:
    
    --- COVER LETTER TEXT ---
    ${text}
    
    Extract the details and return ONLY a JSON object conforming exactly to this structure (do not wrap in markdown or any other tags):
    {
      "companyTarget": "Target company name if mentioned, otherwise 'Generic'",
      "roleTarget": "Target job title/role if mentioned, otherwise 'Generic'",
      "tone": "Brief summary of tone (e.g., technical, formal, enthusiastic, research-focused)",
      "structure": "Description of formatting conventions (e.g., standard business format, conversational style, direct greeting, three paragraph narrative)",
      "highlights": [
        {
          "achievement": "High-level description of what was done",
          "wording": "The exact wording/phrasing used in the letter detailing this achievement and its results/impact"
        }
      ],
      "skills": ["List of core technical or soft skills highlighted in this letter"]
    }
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent?key=${settings.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Gemini API Error: ${errText}` };
    }

    const resJson = await response.json();
    const cleanText = cleanJsonResponse(resJson.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!cleanText) {
      return { success: false, error: "Empty response from Gemini." };
    }

    const analysis = JSON.parse(cleanText);
    return { success: true, analysis };
  } catch (err) {
    console.error("Error in analyzeCoverLetter:", err);
    return { success: false, error: err.message };
  }
}

// Multimodal LLM Cover Letter PDF Document Parser & Sorter
async function parseCoverLetterPdf(base64Data, filename) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    return { success: false, error: "Gemini API Key is missing. Please save it in settings." };
  }

  const prompt = `
    You are an expert AI that reads cover letter PDF documents.
    Your task is to:
    1. Extract the full raw text content of the cover letter exactly as written in the document, preserving greetings, formatting and line breaks.
    2. Analyze its formatting, wording style, tone, and specific results/achievements to train the candidate's AI style memory.
    
    Return ONLY a JSON object conforming exactly to this structure (do not wrap in markdown or any other tags):
    {
      "text": "The full, raw text content of the cover letter exactly as written in the PDF, preserving formatting/spacing",
      "analysis": {
        "companyTarget": "Target company name if mentioned, otherwise 'Generic'",
        "roleTarget": "Target job title/role if mentioned, otherwise 'Generic'",
        "tone": "Brief summary of tone (e.g. technical, formal, enthusiastic, research-focused)",
        "structure": "Description of formatting conventions (e.g. standard business format, conversational style, direct greeting, three paragraph narrative)",
        "highlights": [
          {
            "achievement": "High-level description of what was done",
            "wording": "The exact wording/phrasing used in the letter detailing this achievement and its results/impact"
          }
        ],
        "skills": ["List of core technical or soft skills highlighted in this letter"]
      }
    }
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent?key=${settings.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64Data
                  }
                },
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Gemini API Error: ${errText}` };
    }

    const resJson = await response.json();
    const cleanText = cleanJsonResponse(resJson.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!cleanText) {
      return { success: false, error: "Empty response from Gemini." };
    }

    const parsed = JSON.parse(cleanText);
    return { success: true, parsed };
  } catch (err) {
    console.error("Error parsing cover letter PDF:", err);
    return { success: false, error: err.message };
  }
}

// AI Cover Letter Generator — uses profile + job description to generate a personalized cover letter
async function generateCoverLetter(jobText, jobUrl) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    return { success: false, error: "Gemini API Key is missing. Please configure it in Settings." };
  }

  const profile = await getProfile();

  // Build profile summary for context
  const name = profile.name || (profile.contact ? `${profile.contact.firstName || ""} ${profile.contact.lastName || ""}`.trim() : "") || "Applicant";
  const email = profile.contact?.email || "";
  const phone = profile.contact?.phone || "";
  const location = profile.contact?.location || profile.contact?.city || "";
  const linkedin = profile.contact?.linkedin || "";
  const skills = Array.isArray(profile.skills) ? profile.skills.slice(0, 20).join(", ") : "";
  const educationSummary = Array.isArray(profile.education) && profile.education.length > 0
    ? profile.education.map(e => `${e.degree || ""} in ${e.major || ""} from ${e.school || ""}`.trim()).join("; ")
    : "";
  const experienceSummary = Array.isArray(profile.experience) && profile.experience.length > 0
    ? profile.experience.slice(0, 3).map(e => {
        const bullets = Array.isArray(e.description) ? e.description.slice(0, 2).join(" ") : (e.description || "");
        return `${e.role || ""} at ${e.company || ""} (${e.startDate || ""}–${e.endDate || "Present"}): ${bullets}`;
      }).join("\n")
    : "";
  const projectsSummary = Array.isArray(profile.projects) && profile.projects.length > 0
    ? profile.projects.slice(0, 2).map(p => `${p.title || ""}: ${p.description || ""}`).join("; ")
    : "";
  const customAnswers = Array.isArray(profile.customAnswers) && profile.customAnswers.length > 0
    ? profile.customAnswers.slice(0, 3).map(qa => `Q: ${qa.question} → A: ${qa.answer}`).join("\n")
    : "";

  const todayDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const prompt = `
You are an expert career coach and professional writer. Your task is to generate a highly tailored, compelling, and formally structured cover letter that adheres to standard business letter formatting and follows the layout, tone, and paragraph outline from the Sample Cover Letter Template.

--- TODAY'S DATE ---
${todayDate}

--- CANDIDATE PROFILE ---
Name: ${name}
Email: ${email}
Phone: ${phone}
Location: ${location}
${linkedin ? `LinkedIn: ${linkedin}` : ""}

Education: ${educationSummary || "(not provided)"}

Work Experience:
${experienceSummary || "(not provided)"}

Key Skills: ${skills || "(not provided)"}

Projects:
${projectsSummary || "(not provided)"}

${customAnswers ? `Previous Q&A Context:\n${customAnswers}` : ""}

--- JOB DESCRIPTION / POSTING ---
${(jobText || "").substring(0, 4000) || "Senior AI Engineer position."}

--- FORMATTING & LAYOUT RULES ---
Structure the cover letter EXACTLY as a formal block business letter:
1. Header:
   - Today's date formatted as: [Month Day, Year] (e.g., ${todayDate})
   - Followed by a blank line
   - Followed by the Hiring Manager's name and title (if known, otherwise "Hiring Manager" / "Hiring Team")
   - Followed by the Target Company/Organization Name
   - Followed by a blank line
2. Salutation:
   - "Dear [Hiring Manager Name or Hiring Team],"
   - Followed by a blank line
3. Body:
   - Multiple block paragraphs (do not indent paragraphs). Use a single blank line between paragraphs.
   - Typically 4-5 paragraphs total, consisting of:
     - 1 Introduction paragraph
     - 2-3 Middle ("Meat & Potatoes") paragraphs focusing on specific past experiences/roles
     - 1 Closing paragraph
4. Sign-off:
   - "Sincerely,"
   - Followed by 3 blank lines (simulating signature space)
   - Followed by the candidate's name (${name}).
5. No Placeholder Text:
   - Do NOT output any bracketed placeholders like "[Company Name]" or "[Your Name]". Use actual names from the candidate profile and job description context. If specific details are unknown, omit them cleanly rather than leaving a placeholder.

--- TONAL RULES ---
- Narrative Tone: Professional, warm, and written in an authentic, first-person narrative tone. Avoid stiff/robotic language.
- Empathetic and personalized narrative. Avoid generic resume buzzwords ("detail-oriented", "synergy", "go-getter").
- Use "show, don't tell" writing: back up soft skills with concrete experiences from the profile.

--- CORE PARAGRAPH OUTLINE ---

1. Beginning (1st Paragraph) - Introduction
   - Name the specific role and target organization.
   - State your primary educational background (major, degree, and any minors) if relevant, or your primary professional background.
   - Introduce generally what unique value or perspectives you bring to the table and why you are excited about the role.
   - Thesis Statement: The final sentence must act as a clear thesis statement of your cover letter, summarizing the core experiences/milestones that prepare you for the role and setting up the paragraphs that follow.

2. Middle (Paragraphs 2+) - Meat & Potatoes!
   - Dedicate each middle paragraph to highlighting one specific past role, internship, side project, or leadership achievement from the candidate profile as a concrete example of your capabilities.
   - Describe the relevant, impactful work you did in that experience.
   - THE BRIDGE (CRITICAL): Explicitly link the experience back to the target company's needs or description. State exactly how this past achievement proves you will succeed in this new role and benefit the team/organization you would be joining. Use phrases that bridge the past experience directly to their value (e.g., "At [Company Name], I look forward to...").

3. Closing (Final Paragraph)
   - Before wrapping up, identify any relevant personal qualities or additional strengths (e.g., leadership, time-management, personal accountability for quality) not yet detailed in previous paragraphs.
   - Relate these qualities back to how they will support the company's culture and role.
   - Provide a summary statement of support and wrap up.
   - Thank the reader for their time and consideration.

Return ONLY the cover letter text with no additional commentary, HTML, JSON, or markdown formatting.
`;

  try {
    const text = await callGemini(prompt, false, settings);
    if (!text || text.trim().length < 50) {
      return { success: false, error: "Generated letter was empty or too short." };
    }

    // Derive a suggested save name from the job context
    const urlHost = jobUrl ? (() => { try { return new URL(jobUrl).hostname.replace("www.", ""); } catch (_) { return ""; } })() : "";
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const suggestedName = urlHost
      ? `Cover Letter – ${urlHost} – ${today}`
      : `Cover Letter – ${today}`;

    return { success: true, text: text.trim(), suggestedName };
  } catch (err) {
    console.error("Error in generateCoverLetter:", err);
    return { success: false, error: err.message };
  }
}

// Save a cover letter (text + optional analysis) into the knowledge base
async function saveCoverLetterToKB(name, text, analysis) {
  try {
    const existing = await getCoverLetters();
    const newEntry = {
      id: crypto.randomUUID(),
      name: name || `Cover Letter – ${new Date().toLocaleDateString()}`,
      text,
      analysis: analysis || null
    };
    const updated = [newEntry, ...existing];
    return await saveCoverLetters(updated);
  } catch (err) {
    console.error("Error saving cover letter to KB:", err);
    return { success: false, error: err.message };
  }
}

// Portal Accounts Storage
async function getPortalAccounts() {
  const data = await chrome.storage.local.get("portalAccounts");
  return data.portalAccounts || [];
}

async function savePortalAccounts(portalAccounts) {
  await chrome.storage.local.set({ portalAccounts });
  return { success: true, portalAccounts };
}

// Backup Export/Import Handlers
async function exportAllData() {
  const profile = await getProfile();
  const settings = await getSettings();
  const applications = await getApplications();
  const resumeFile = await getResumeFile();
  const coverLetters = await getCoverLetters();
  const portalAccounts = await getPortalAccounts();

  return {
    success: true,
    backup: {
      profile,
      settings,
      applications,
      resumeFile,
      coverLetters,
      portalAccounts,
      exportedAt: new Date().toISOString()
    }
  };
}

async function importAllData(backup) {
  if (!backup) throw new Error("Invalid backup data payload.");

  const updates = {};
  if (backup.profile) updates.profile = backup.profile;
  if (backup.settings) updates.settings = backup.settings;
  if (backup.applications) updates.applications = backup.applications;
  if (backup.portalAccounts) updates.portalAccounts = backup.portalAccounts;

  await chrome.storage.local.set(updates);

  // Sync Resume & Cover Letters to local database so they are not wiped or desynced
  if (backup.resumeFile && backup.resumeFile.filename && backup.resumeFile.base64Data) {
    await saveResumeFile(backup.resumeFile.filename, backup.resumeFile.base64Data);
  } else {
    await deleteResumeFile();
  }

  if (backup.coverLetters) {
    await saveCoverLetters(backup.coverLetters);
  }

  return { success: true };
}

// Multimodal LLM Resume Parser
async function parseResumePdf(base64Data, filename) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing. Please save it in the extension settings.");
  }

  const parseInstruction = `
    Extract info from this resume or application document text into the required structured JSON schema.
    Ensure all output is structured JSON. Never return explanations, conversational text, or backticks. Return ONLY a valid JSON string.
    
    If the document does not specify a full address or location, default the contact location to "36 Madison Avenue, Madison New Jersey 07940".
    If the document mentions visa status, work authorization, or sponsorship needs, extract them into the preferences block.

    Schema:
    {
      "name": "Full Name",
      "contact": {
        "email": "email",
        "phone": "phone",
        "location": "city/state",
        "firstName": "first",
        "lastName": "last",
        "preferredName": "pref",
        "birthday": "MM-DD-YYYY",
        "houseNumber": "123",
        "streetName": "Name",
        "city": "City",
        "state": "State",
        "postalCode": "12345",
        "country": "Country",
        "linkedin": "",
        "github": "",
        "portfolio": ""
      },
      "education": [{ "school": "school", "degree": "degree", "major": "major", "startYear": "year", "endYear": "year", "expectedGraduation": "date" }],
      "skills": ["skill1", "skill2"],
      "coursework": ["course1", "course2"],
      "honors_and_awards": ["award1", "award2"],
      "experience": [{ "company": "company", "role": "role", "startDate": "date", "endDate": "date", "description": ["bullet1", "bullet2"] }],
      "projects": [{ "title": "title", "description": "description" }],
      "certifications": ["cert1"],
      "customAnswers": [{ "question": "The question asked in the document", "answer": "The answer/response associated with it" }],
      "preferences": {
        "visa_status": "e.g. F-1 OPT, H-1B, Green Card, US Citizen, or empty string",
        "sponsorship_required": false,
        "authorized_to_work": true,
        "salary": "",
        "salary_min": "",
        "salary_max": "",
        "salary_currency": "USD",
        "locations": [],
        "remote": true,
        "willing_to_relocate": false,
        "employment_types": ["Full-time"],
        "notice_period": "",
        "availability_date": ""
      }
    }
  `;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent?key=${settings.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Data
                }
              },
              {
                text: parseInstruction
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API parse failed: ${errorText}`);
  }

  const result = await response.json();
  try {
    const jsonText = cleanJsonResponse(result.candidates[0].content.parts[0].text);
    const parsedJson = JSON.parse(jsonText);
    return { success: true, parsedJson };
  } catch (err) {
    throw new Error(`Failed to parse response text as JSON: ${err.message}. Raw text: ${result.candidates[0]?.content?.parts[0]?.text}`);
  }
}

// Text-based Resume Parser for extracted DOCX content
async function parseResumeText(text) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing. Please save it in the extension settings.");
  }

  const parseInstruction = `
    Extract info from this resume or application document text into the required structured JSON schema.
    Ensure all output is structured JSON. Never return explanations, conversational text, or backticks. Return ONLY a valid JSON string.
    
    If the document does not specify a full address or location, default the contact location to "36 Madison Avenue, Madison New Jersey 07940".
    If the document mentions visa status, work authorization, or sponsorship needs, extract them into the preferences block.

    Schema:
    {
      "name": "Full Name",
      "contact": {
        "email": "email",
        "phone": "phone",
        "location": "city/state",
        "firstName": "first",
        "lastName": "last",
        "preferredName": "pref",
        "birthday": "MM-DD-YYYY",
        "houseNumber": "123",
        "streetName": "Name",
        "city": "City",
        "state": "State",
        "postalCode": "12345",
        "country": "Country",
        "linkedin": "",
        "github": "",
        "portfolio": ""
      },
      "education": [{ "school": "school", "degree": "degree", "major": "major", "startYear": "year", "endYear": "year", "expectedGraduation": "date" }],
      "skills": ["skill1", "skill2"],
      "coursework": ["course1", "course2"],
      "honors_and_awards": ["award1", "award2"],
      "experience": [{ "company": "company", "role": "role", "startDate": "date", "endDate": "date", "description": ["bullet1", "bullet2"] }],
      "projects": [{ "title": "title", "description": "description" }],
      "certifications": ["cert1"],
      "customAnswers": [{ "question": "The question asked in the document", "answer": "The answer/response associated with it" }],
      "preferences": {
        "visa_status": "e.g. F-1 OPT, H-1B, Green Card, US Citizen, or empty string",
        "sponsorship_required": false,
        "authorized_to_work": true,
        "salary": "",
        "salary_min": "",
        "salary_max": "",
        "salary_currency": "USD",
        "locations": [],
        "remote": true,
        "willing_to_relocate": false,
        "employment_types": ["Full-time"],
        "notice_period": "",
        "availability_date": ""
      }
    }
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent?key=${settings.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${parseInstruction}\n\nDOCUMENT TEXT:\n${text}`
                }
              ]
            }
          ],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Gemini API parse failed: ${errorText}` };
    }

    const result = await response.json();
    const jsonText = cleanJsonResponse(result.candidates[0].content.parts[0].text);
    const parsedJson = JSON.parse(jsonText);
    return { success: true, parsedJson };
  } catch (err) {
    console.error("Error parsing resume text:", err);
    return { success: false, error: err.message };
  }
}

// Compare and generate a merge diff
async function compareAndMerge(proposedJson) {
  const currentProfile = await getProfile();
  
  const primitivePaths = [
    'name', 'gender', 'race', 'veteranStatus',
    'contact.email', 'contact.phone', 'contact.location',
    'contact.firstName', 'contact.lastName', 'contact.preferredName', 'contact.birthday',
    'contact.houseNumber', 'contact.streetName', 'contact.city', 'contact.state', 'contact.postalCode', 'contact.country'
  ];

  const proposedFields = [];
  const getNestedValue = (obj, path) => {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };

  for (const path of primitivePaths) {
    const oldVal = getNestedValue(currentProfile, path) || '';
    const newVal = getNestedValue(proposedJson, path) || '';
    if (newVal && newVal !== oldVal) {
      if (!oldVal) {
        proposedFields.push({ field: path, status: 'new', oldValue: '', newValue: newVal });
      } else {
        proposedFields.push({ field: path, status: 'conflict', oldValue: oldVal, newValue: newVal });
      }
    }
  }

  const proposedStringArrays = [];
  const oldSkills = new Set((currentProfile.skills || []).map(s => s.toLowerCase().trim()));
  for (const skill of (proposedJson.skills || [])) {
    if (skill && !oldSkills.has(skill.toLowerCase().trim())) {
      proposedStringArrays.push({ status: 'new', type: 'skills', value: skill });
    }
  }

  const oldCerts = new Set((currentProfile.certifications || []).map(c => c.toLowerCase().trim()));
  for (const cert of (proposedJson.certifications || [])) {
    if (cert && !oldCerts.has(cert.toLowerCase().trim())) {
      proposedStringArrays.push({ status: 'new', type: 'certifications', value: cert });
    }
  }

  const oldCourse = new Set((currentProfile.coursework || []).map(c => c.toLowerCase().trim()));
  for (const course of (proposedJson.coursework || [])) {
    if (course && !oldCourse.has(course.toLowerCase().trim())) {
      proposedStringArrays.push({ status: 'new', type: 'coursework', value: course });
    }
  }

  const oldAwards = new Set((currentProfile.honors_and_awards || []).map(a => a.toLowerCase().trim()));
  for (const award of (proposedJson.honors_and_awards || [])) {
    if (award && !oldAwards.has(award.toLowerCase().trim())) {
      proposedStringArrays.push({ status: 'new', type: 'honors_and_awards', value: award });
    }
  }

  const proposedObjectArrays = [];
  let diffIdCounter = 1;
  const nextDiffId = () => `diff-item-${diffIdCounter++}`;

  // Education
  const oldEd = currentProfile.education || [];
  for (const item of (proposedJson.education || [])) {
    const match = oldEd.find(o => o.school && item.school && o.school.toLowerCase().trim() === item.school.toLowerCase().trim());
    if (match) {
      const hasDiff = ['degree', 'major', 'startYear', 'endYear', 'expectedGraduation'].some(k => (item[k] || '') !== (match[k] || ''));
      if (hasDiff) {
        proposedObjectArrays.push({
          id: nextDiffId(), status: 'conflict', type: 'education', matchKey: item.school, oldValue: match, newValue: item
        });
      }
    } else {
      proposedObjectArrays.push({
        id: nextDiffId(), status: 'new', type: 'education', matchKey: item.school || 'Unknown School', newValue: item
      });
    }
  }

  // Experience
  const oldExp = currentProfile.experience || [];
  for (const item of (proposedJson.experience || [])) {
    const match = oldExp.find(o => 
      o.company && item.company && o.company.toLowerCase().trim() === item.company.toLowerCase().trim() &&
      o.role && item.role && o.role.toLowerCase().trim() === item.role.toLowerCase().trim()
    );
    if (match) {
      const hasDiff = ['startDate', 'endDate'].some(k => (item[k] || '') !== (match[k] || '')) ||
                      JSON.stringify(item.description) !== JSON.stringify(match.description);
      if (hasDiff) {
        proposedObjectArrays.push({
          id: nextDiffId(), status: 'conflict', type: 'experience', matchKey: `${item.company} - ${item.role}`, oldValue: match, newValue: item
        });
      }
    } else {
      proposedObjectArrays.push({
        id: nextDiffId(), status: 'new', type: 'experience', matchKey: `${item.company || 'Unknown Company'} - ${item.role || 'Unknown Role'}`, newValue: item
      });
    }
  }

  // Projects
  const oldProj = currentProfile.projects || [];
  for (const item of (proposedJson.projects || [])) {
    const match = oldProj.find(o => o.title && item.title && o.title.toLowerCase().trim() === item.title.toLowerCase().trim());
    if (match) {
      const hasDiff = (item.description || '') !== (match.description || '');
      if (hasDiff) {
        proposedObjectArrays.push({
          id: nextDiffId(), status: 'conflict', type: 'projects', matchKey: item.title, oldValue: match, newValue: item
        });
      }
    } else {
      proposedObjectArrays.push({
        id: nextDiffId(), status: 'new', type: 'projects', matchKey: item.title || 'Untitled Project', newValue: item
      });
    }
  }

  // Custom Q&As
  const oldQA = currentProfile.customAnswers || [];
  for (const item of (proposedJson.customAnswers || [])) {
    const match = oldQA.find(o => 
      o.question && item.question && 
      (o.question.toLowerCase().trim() === item.question.toLowerCase().trim() ||
       o.question.toLowerCase().includes(item.question.toLowerCase().trim()) ||
       item.question.toLowerCase().includes(o.question.toLowerCase().trim()))
    );
    if (match) {
      if (String(item.answer || '').trim() !== String(match.answer || '').trim()) {
        proposedObjectArrays.push({
          id: nextDiffId(), status: 'conflict', type: 'customAnswers', matchKey: item.question, oldValue: match, newValue: item
        });
      }
    } else {
      proposedObjectArrays.push({
        id: nextDiffId(), status: 'new', type: 'customAnswers', matchKey: item.question, newValue: item
      });
    }
  }

  return {
    proposedFields,
    proposedStringArrays,
    proposedObjectArrays,
    newJSON: proposedJson
  };
}

// AI Application Step Planner — generates a structured plan before filling starts
async function generateApplicationPlan(pageContext, fields, jobText) {
  const settings = await getSettings();
  const profile = await getProfile();

  const platform = pageContext?.platform || 'generic';
  const url = pageContext?.url || '';

  // Lightweight heuristic plan if no API key available
  if (!settings.GEMINI_API_KEY) {
    return {
      success: true,
      plan: buildFallbackPlan(fields, platform),
      source: 'heuristic'
    };
  }

  const prompt = `
    You are an expert job application agent planner.
    Given the following information about a job application page, generate a structured, ordered execution plan.

    --- PAGE CONTEXT ---
    URL: ${url}
    Platform: ${platform}
    Job Description Snippet: ${(jobText || '').substring(0, 800)}

    --- DETECTED FORM FIELDS ---
    ${JSON.stringify(fields.slice(0, 40), null, 2)}

    --- CANDIDATE PREFERENCES ---
    Visa Status: ${profile?.preferences?.visa_status || 'Unknown'}
    Sponsorship Required: ${profile?.preferences?.sponsorship_required}
    Remote: ${profile?.preferences?.remote}

    Generate a sequential execution plan. For each step:
    - Assign a clear semantic intent (e.g. "upload_resume", "fill_personal_info", "fill_work_authorization", "fill_education", "fill_experience", "fill_essay_questions", "review_and_submit")
    - Set "requiresConfirmation" to true if the step involves: submission, salary input, sensitive personal data, visa/sponsorship disclosures
    - Set "dataRequired" to the profile fields needed for this step
    - Set "riskLevel" to "low", "medium", or "high"

    Return ONLY a JSON object:
    {
      "platform": "${platform}",
      "estimatedSteps": 5,
      "steps": [
        {
          "step": 1,
          "intent": "upload_resume",
          "label": "Upload Resume",
          "description": "Brief human-readable description of this step",
          "dataRequired": ["resumeFile"],
          "requiresConfirmation": false,
          "riskLevel": "low",
          "status": "pending"
        }
      ]
    }
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent?key=${settings.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    if (!response.ok) {
      console.warn('[AI Agent] Plan generation API call failed, using heuristic fallback.');
      return { success: true, plan: buildFallbackPlan(fields, platform), source: 'heuristic' };
    }

    const result = await response.json();
    const cleanText = cleanJsonResponse(result.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!cleanText) {
      return { success: true, plan: buildFallbackPlan(fields, platform), source: 'heuristic' };
    }

    const plan = JSON.parse(cleanText);
    return { success: true, plan, source: 'llm' };
  } catch (err) {
    console.error('[AI Agent] generateApplicationPlan error:', err);
    return { success: true, plan: buildFallbackPlan(fields, platform), source: 'heuristic' };
  }
}

// Heuristic fallback plan builder (no API key required)
function buildFallbackPlan(fields, platform) {
  const hasFile = fields.some(f => f.type === 'file');
  const hasTextarea = fields.some(f => f.tagName === 'textarea');
  const hasWorkAuth = fields.some(f => {
    const t = (f.labelText || f.name || '').toLowerCase();
    return t.includes('visa') || t.includes('authorization') || t.includes('sponsorship') || t.includes('work permit');
  });
  const hasSalary = fields.some(f => {
    const t = (f.labelText || f.name || '').toLowerCase();
    return t.includes('salary') || t.includes('compensation') || t.includes('pay');
  });

  const steps = [];
  let stepNum = 1;

  steps.push({ step: stepNum++, intent: 'fill_personal_info', label: 'Fill Personal Information', description: 'Fill name, email, phone, and address fields.', dataRequired: ['contact'], requiresConfirmation: false, riskLevel: 'low', status: 'pending' });
  if (hasFile) steps.push({ step: stepNum++, intent: 'upload_resume', label: 'Upload Resume', description: 'Attach the candidate resume PDF.', dataRequired: ['resumeFile'], requiresConfirmation: false, riskLevel: 'low', status: 'pending' });
  if (hasWorkAuth) steps.push({ step: stepNum++, intent: 'fill_work_authorization', label: 'Fill Work Authorization', description: 'Answer visa status and sponsorship questions.', dataRequired: ['preferences.visa_status', 'preferences.sponsorship_required'], requiresConfirmation: true, riskLevel: 'high', status: 'pending' });
  if (hasSalary) steps.push({ step: stepNum++, intent: 'fill_salary_expectations', label: 'Fill Salary Expectations', description: 'Enter salary or compensation range.', dataRequired: ['preferences.salary', 'preferences.salary_min', 'preferences.salary_max'], requiresConfirmation: true, riskLevel: 'high', status: 'pending' });
  if (hasTextarea) steps.push({ step: stepNum++, intent: 'fill_essay_questions', label: 'Fill Essay / Custom Questions', description: 'Answer open-ended text questions and cover letter fields.', dataRequired: ['customAnswers', 'coverLetters'], requiresConfirmation: false, riskLevel: 'medium', status: 'pending' });
  steps.push({ step: stepNum++, intent: 'fill_remaining_fields', label: 'Fill Remaining Fields', description: 'Fill all other detected form fields.', dataRequired: ['profile'], requiresConfirmation: false, riskLevel: 'low', status: 'pending' });
  steps.push({ step: stepNum++, intent: 'review_and_submit', label: 'Review & Submit', description: 'Review filled values, then submit the application.', dataRequired: [], requiresConfirmation: true, riskLevel: 'high', status: 'pending' });

  return { platform: platform || 'generic', estimatedSteps: steps.length, steps };
}

// AI Form Fields Mapper with Cover Letter differentiation & template adaptatio// --- 3-LAYER AGENTIC RAG SYSTEM ---

// Helper: Cos/Jaccard token extractor
function getTokens(str) {
  return new Set((str || '').toLowerCase().match(/\b\w+\b/g) || []);
}

// Helper: Calculate Jaccard similarity between two strings
function calculateJaccardSimilarity(str1, str2) {
  const set1 = getTokens(str1);
  const set2 = getTokens(str2);
  if (set1.size === 0 && set2.size === 0) return 1;
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// Shared Gemini API request handler
async function callGemini(prompt, isJson, settings) {
  const model = settings.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.GEMINI_API_KEY}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: isJson ? { responseMimeType: "application/json" } : {}
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanJsonResponse(text);
}

// Layer 1: Question Understanding & Action Planning (Classifier)
async function classifyQuestion(labelText, fieldName, type, settings) {
  const prompt = `
    You are a job application question classifier. 
    Analyze the following form field detail:
    Label: "${labelText || ''}"
    Field Name: "${fieldName || ''}"
    Field Type: "${type || ''}"

    Classify the question/field into exactly one of these types:
    - "personal_motivation": e.g., "Why this company?", "Why do you want to work here?", "Cover Letter" (if essay/motivation question)
    - "experience_based": e.g., "Describe a project you worked on", "Tell us about your background", "Relevant experience"
    - "behavioral": e.g., "Tell me about a challenge you faced", "Describe a conflict"
    - "technical": e.g., "What is your proficiency in Python?", "Details of React projects"
    - "factual": e.g., standard contact details, work auth status dropdowns, checkboxes, resume upload, gender, veteran status.

    Respond ONLY with a JSON object of structure:
    {
      "question_type": "personal_motivation" | "experience_based" | "behavioral" | "technical" | "factual",
      "action": "generate_answer" | "retrieve_from_db" | "direct_lookup",
      "required_context": ["company", "role_description", "user_experience", "skills", "none"]
    }
  `;

  try {
    const responseText = await callGemini(prompt, true, settings);
    return JSON.parse(responseText);
  } catch (err) {
    console.error("[3-Layer RAG] Classification error, fallback to factual:", err);
    return { question_type: "factual", action: "direct_lookup", required_context: ["none"] };
  }
}

// Layer 2: Knowledge Retrieval vs. Generation Decision
function retrieveOrGenerateDecision(labelText, fieldName, profile, coverLetters) {
  let bestMatch = null;
  let highestScore = 0;
  let matchType = null; // 'custom_answer' or 'cover_letter'

  const queryText = `${labelText} ${fieldName}`.trim();

  // 1. Search Profile Custom Answers
  if (profile && Array.isArray(profile.customAnswers)) {
    for (const item of profile.customAnswers) {
      const score = calculateJaccardSimilarity(queryText, item.question);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = item.answer;
        matchType = 'custom_answer';
      }
    }
  }

  // 2. Search Cover Letter Highlights
  if (coverLetters && Array.isArray(coverLetters)) {
    for (const cl of coverLetters) {
      let analysisObj = null;
      try {
        if (typeof cl.analysis === 'string') {
          analysisObj = JSON.parse(cl.analysis);
        } else if (cl.analysis) {
          analysisObj = cl.analysis;
        }
      } catch (e) {}

      if (analysisObj && Array.isArray(analysisObj.highlights)) {
        for (const hl of analysisObj.highlights) {
          const score = calculateJaccardSimilarity(queryText, hl.achievement);
          if (score > highestScore) {
            highestScore = score;
            bestMatch = hl.wording;
            matchType = 'cover_letter';
          }
        }
      }
    }
  }

  // Decision logic:
  let finalAction = "generate_new_answer";
  if (highestScore > 0.85) {
    finalAction = "use_existing";
  } else if (highestScore > 0.60) {
    finalAction = "retrieve_and_modify";
  }

  return {
    action: finalAction,
    similarityScore: highestScore,
    retrievedAnswer: bestMatch,
    matchType: matchType
  };
}

// Layer 3: Answer Generation & Optimization with Validation
async function generateAndOptimizeAnswer(labelText, fieldName, type, classification, decision, profile, jobUrl, jobText, settings) {
  if (decision.action === 'use_existing') {
    console.log(`[3-Layer RAG] Direct reuse (similarity: ${decision.similarityScore.toFixed(2)})`);
    return { value: decision.retrievedAnswer, confidence: 0.99, reason: `Exact match found in user knowledge base (Similarity: ${decision.similarityScore.toFixed(2)})` };
  }

  const jobInfoStr = `Job Description snippet: ${jobText || "Not provided"}\nJob URL: ${jobUrl || "Not provided"}`;
  let prompt = "";
  
  if (decision.action === 'retrieve_and_modify') {
    console.log(`[3-Layer RAG] Retrieve & Customize (similarity: ${decision.similarityScore.toFixed(2)})`);
    prompt = `
      You are writing a job application response.
      We have found a highly relevant past answer in the user's knowledge base. Your task is to adapt and customize it to better align with the target role and company.

      Question: "${labelText}"
      Stored Answer: "${decision.retrievedAnswer}"
      
      --- TARGET JOB CONTEXT ---
      ${jobInfoStr}

      --- CANDIDATE PROFILE FACTS (For reference, do NOT hallucinate) ---
      Skills: ${JSON.stringify(profile.skills || [])}
      Education: ${JSON.stringify(profile.education || [])}
      Experience: ${JSON.stringify(profile.experience || [])}

      Rules:
      1. Do NOT invent or hallucinate any experience, metrics, or achievements.
      2. Keep the answer concise (under 150 words).
      3. Adapt the greeting, company context, or role references to match the target.
      4. Highlight skills relevant to the target job description.
      5. Output ONLY the raw answer text. Do not wrap in markdown or JSON.
    `;
  } else {
    console.log(`[3-Layer RAG] Generate New Answer (similarity: ${decision.similarityScore.toFixed(2)})`);
    let customInstruction = "";
    if (settings && settings.CUSTOM_ESSAY_PROMPT) {
      if (settings.CUSTOM_ESSAY_PROMPT.includes("{QUESTION}")) {
        customInstruction = settings.CUSTOM_ESSAY_PROMPT.replace(/{QUESTION}/g, labelText);
      } else {
        customInstruction = `${settings.CUSTOM_ESSAY_PROMPT}\n\nQuestion: "${labelText}"`;
      }
    } else {
      customInstruction = `Generate a professional, compelling, and honest response to the question "${labelText}" from scratch using the candidate's profile facts.`;
    }

    prompt = `
      You are writing a job application response.
      ${customInstruction}

      --- TARGET JOB CONTEXT ---
      ${jobInfoStr}

      --- CANDIDATE PROFILE FACTS ---
      Structured Profile: ${JSON.stringify(profile, null, 2)}

      Rules:
      1. Do NOT invent or hallucinate any experience, metrics, or achievements.
      2. Keep the answer concise (under 150 words).
      3. Match the company's professional tone.
      4. Highlight skills relevant to the target job description.
      5. Output ONLY the raw answer text. Do not wrap in markdown or JSON.
    `;
  }

  try {
    let generatedValue = await callGemini(prompt, false, settings);

    // --- Validation Phase ---
    let attempts = 0;
    const maxValidationAttempts = 2;
    let isValid = false;

    while (!isValid && attempts < maxValidationAttempts) {
      attempts++;
      const wordCount = (generatedValue || '').split(/\s+/).filter(Boolean).length;
      
      const hallucinationMarkers = [
        "as an AI",
        "I do not have real-world experience",
        "as a language model",
        "AI assistant"
      ];
      const hasHallucination = hallucinationMarkers.some(marker => generatedValue.toLowerCase().includes(marker));

      if (wordCount > 165 || hasHallucination) {
        console.warn(`[3-Layer RAG] Validation failed (Words: ${wordCount}, Hallucination: ${hasHallucination}). Re-optimizing...`);
        
        let fixPrompt = `
          The previously generated answer failed validation checks. 
          Please revise the answer to meet these strict rules:
          1. Must be under 150 words.
          2. Must be written in the first person ("I") from the perspective of the candidate.
          3. Must NOT contain any sentences indicating you are an AI, language model, or virtual assistant.
          4. Do NOT invent new experiences.

          Original Question: "${labelText}"
          Bad Answer: "${generatedValue}"
          
          Provide the revised answer now:
        `;
        generatedValue = await callGemini(fixPrompt, false, settings);
      } else {
        isValid = true;
      }
    }

    return {
      value: generatedValue,
      confidence: decision.action === 'retrieve_and_modify' ? 0.85 : 0.75,
      reason: `Answer ${decision.action === 'retrieve_and_modify' ? 'adapted from' : 'generated from scratch based on'} candidate profile (Classification: ${classification.question_type})`
    };
  } catch (err) {
    console.error("[3-Layer RAG] Layer 3 generation error:", err);
    return null;
  }
}

// AI Form Fields Mapper with Cover Letter differentiation & template adaptation
async function mapFormFields(fields, jobUrl, jobText) {
  const settings = await getSettings();
  if (!settings.GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing. Please save it in the extension settings.");
  }

  const profile = await getProfile();
  const coverLetters = await getCoverLetters();
  const resumeFile = await getResumeFile();

  let learnedMappings = [];
  try {
    const res = await fetch(`${BACKEND_URL}/learned-mappings`);
    if (res.ok) {
      learnedMappings = await res.json();
      console.log("Fetched learned mappings for AI mapping:", learnedMappings);
    }
  } catch (err) {
    console.log("Could not fetch learned mappings from backend:", err);
  }

  const prompt = `
    You are an expert browser automation autofill engine. 
    You are given a candidate's structured profile, some details about a job application, a database of past cover letters, the candidate's active resume details, a list of previously learned field corrections, and a list of input fields found on the form page.
    Your task is to map each field to its appropriate filled value from the candidate's profile.

    --- CANDIDATE PROFILE ---
    ${JSON.stringify(profile, null, 2)}

    --- CANDIDATE PREFERENCES (HIGH PRIORITY — use these for visa, salary, remote, sponsorship questions) ---
    Visa Status: ${profile?.preferences?.visa_status || 'Not specified'}
    Authorized to Work: ${profile?.preferences?.authorized_to_work}
    Sponsorship Required: ${profile?.preferences?.sponsorship_required}
    Remote Preference: ${profile?.preferences?.remote}
    Willing to Relocate: ${profile?.preferences?.willing_to_relocate}
    Salary Expectation: ${profile?.preferences?.salary || profile?.preferences?.salary_min + '-' + profile?.preferences?.salary_max || 'Not specified'} ${profile?.preferences?.salary_currency || 'USD'}
    Preferred Locations: ${JSON.stringify(profile?.preferences?.locations || [])}
    Employment Types: ${JSON.stringify(profile?.preferences?.employment_types || ['Full-time'])}
    Notice Period: ${profile?.preferences?.notice_period || 'Immediately available'}
    Availability Date: ${profile?.preferences?.availability_date || 'Immediately'}

    --- CANDIDATE COVER LETTER DATABASE (PAST WRITTEN LETTERS) ---
    ${JSON.stringify(coverLetters, null, 2)}

    --- CANDIDATE ACTIVE RESUME ---
    Active Resume: ${resumeFile ? resumeFile.filename : "None"}

    --- LEARNED CORRECTIONS FOR REPEATED ERRORS ---
    The candidate has previously corrected the autofill engine on similar fields. You MUST follow these corrections:
    ${JSON.stringify(learnedMappings, null, 2)}
    * For any field in the form where the 'labelText' or 'name' matches or is highly similar to a learned mapping's 'fieldLabel' or 'fieldName', you MUST map it to the corresponding 'correctValue' rather than the 'incorrectValue' or any other default.

    --- JOB APPLICATION INFO ---
    URL: ${jobUrl}
    Job text snippet: ${jobText}

    --- FORM FIELDS ---
    ${JSON.stringify(fields, null, 2)}

    Determine the best answers/values to type into each input:
    1. DIFFERENTIATE DROPDOWNS VS WRITTEN TEXT FIELDS:
       - Dropdowns/Dropbox Options: If a field has tagName 'select', type 'combobox', or type 'listbox-button', it is a select-only dropbox field. You must match the answer to the options provided.
         * If the field's 'options' array contains options, pick the best matching option from that array.
         * If the 'options' array is empty (which happens with custom Workday comboboxes that load dynamically), output a short, standard, generic string response representing the choice (e.g., 'United States', 'Yes', 'Male', 'Bachelor\'s Degree', 'No') so our browser client script can click open the menu and click the matching element.
       - Written Text Fields: If the field is a standard input (e.g. type 'text', 'email', 'tel', 'url') or a 'textarea', output the actual customized written text response to be typed directly into the field.
    2. For radio buttons or checkboxes, output "true", "false", or the option text itself to select.
    
    3. COVER LETTER FIELD SPECIFIC RULE: 
       If a field is detected as a cover letter field (e.g., textarea named 'cover_letter', label containing 'cover letter' or 'letter of intent'):
       - Synthesize a compelling, professional cover letter for the target job description by learning from the CANDIDATE COVER LETTER DATABASE.
       - Do not just replace simple template placeholders. Instead, adapt the candidate's formatting structure, tone, greetings, and closings from their past cover letters (relying on 'tone' and 'structure' metrics).
       - Select the achievements, impact results, and key skills that are most aligned with the job description requirements.
       - CRITICAL: Keep in mind that some information/achievements in the database could be repetitive across different past letters, but do not skip them. Depending on the job, it might be detailed in a specific way. Select and adapt the exact wording, phrasing, and metric details from the past letters that align best with the target role.
       - Use this customized text as the value for the field.

    4. If a field is for a custom question (e.g. visa sponsorship, gender, race, essays, background), look at the 'customAnswers' array in the profile first. If missing, synthesize a professional, short, and accurate answer based on the candidate's profile data.
    5. For any file input field (type 'file') asking for a resume or CV document upload, map the field's value to the active resume filename: '${resumeFile ? resumeFile.filename : "Afnan_Adit_Resume.pdf"}'.
    6. If a field cannot be answered or is irrelevant (e.g. captcha, coupon code, password fields), return null for that field mapping.
    7. AUTOCOMPLETE / SUGGESTION FIELDS:
       - If a field is marked with 'isAutocomplete: true' or has autocomplete in its metadata/name/labels, it requires selecting an option from a dynamic list.
       - You must output the full, correct target value (e.g., "Madison, New Jersey, United States", "Drew University", "Machine Learning", "Bachelor of Science", "F-1 Student Visa").
       - The client script will automatically derive a search query from this value, type it, and select the correct option from the suggestions.

    Respond ONLY with a JSON array of mappings:
    [
      {
        "id": "field_element_id",
        "value": "string value to type or select",
        "reason": "brief rationale",
        "intent": "detected question intent, e.g. visa authorization, salary expectation, full name",
        "confidence": 0.98
      }
    ]
  `;

  let response;
  let useMock = false;
  
  if (!settings.GEMINI_API_KEY) {
    useMock = true;
  } else {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${settings.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent?key=${settings.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        console.warn("Gemini API call failed, using local mock mapper fallback...");
        useMock = true;
      }
    } catch (err) {
      console.warn("Error calling Gemini, using local mock mapper fallback:", err);
      useMock = true;
    }
  }

  let mappings;
  if (useMock) {
    console.log("Using local mock heuristic mapper. Learned mappings count:", learnedMappings.length);
    console.log("SCANNED FIELDS RECEIVED:", JSON.stringify(fields, null, 2));
    mappings = fields.map(field => {
      const name = (field.name || '').toLowerCase();
      const id = (field.id || '').toLowerCase();
      const label = (field.labelText || '').toLowerCase();

      // Look up learned mappings first
      const matchedCorrection = learnedMappings.find(m => 
        (field.labelText && m.fieldLabel && field.labelText.toLowerCase().includes(m.fieldLabel.toLowerCase())) ||
        (field.name && m.fieldName && field.name.toLowerCase() === m.fieldName.toLowerCase())
      );

      if (matchedCorrection) {
        if (field.type === 'radio') {
          const correctVal = matchedCorrection.correctValue;
          if (correctVal === 'Yes' || correctVal === 'true') {
            return { id: field.id, value: id.includes('yes') ? "Yes" : "false", reason: "Mock correction: check Yes.", intent: "visa sponsorship", confidence: 0.99 };
          } else {
            return { id: field.id, value: id.includes('no') ? "No" : "false", reason: "Mock correction: check No.", intent: "visa sponsorship", confidence: 0.99 };
          }
        }
        return { id: field.id, value: matchedCorrection.correctValue, reason: `Mock correction: applied ${matchedCorrection.correctValue}.`, intent: "learned override", confidence: 0.99 };
      }

      // Default profile mappings
      if (id.includes('name') || name.includes('name') || label.includes('name')) {
        return { id: field.id, value: profile?.contact?.name || "Syed Afnan Adit", reason: "Mock: mapped name.", intent: "full name", confidence: 0.99 };
      }
      if (id.includes('email') || name.includes('email') || label.includes('email')) {
        return { id: field.id, value: profile?.contact?.email || "sadit@drew.edu", reason: "Mock: mapped email.", intent: "email address", confidence: 0.99 };
      }
      if (field.type === 'file') {
        return { id: field.id, value: "Syed Afnan Adit-Resume.pdf", reason: "Mock: mapped resume.", intent: "resume upload", confidence: 0.99 };
      }
      if (id.includes('subclass') || name.includes('visa_subclass') || label.includes('subclass') || id.includes('visa-status') || name.includes('visa_status')) {
        return { id: field.id, value: "F-1 OPT", reason: "Mock visa subclass details.", intent: "visa subclass details", confidence: 0.95 };
      }
      if (id.includes('salary') || name.includes('salary') || label.includes('salary')) {
        return { id: field.id, value: "120,000", reason: "Mock expected salary details.", intent: "expected salary", confidence: 0.99 };
      }
      if (id.includes('experience') || name.includes('experience') || label.includes('experience')) {
        return { id: field.id, value: "1-2-years", reason: "Mock default experience.", intent: "js experience dropdown", confidence: 0.90 };
      }
      if (id.includes('location') || name.includes('location') || label.includes('location')) {
        return { id: field.id, value: "New York, NY", reason: "Mock default location.", intent: "location preference", confidence: 0.90 };
      }
      if (id.includes('subfield') || name.includes('subfield') || label.includes('subfield') || id.includes('combobox')) {
        return { id: field.id, value: "systems", reason: "Mock default subfield.", intent: "custom picklist subfield", confidence: 0.90 };
      }
      if (field.type === 'radio') {
        return { id: field.id, value: id.includes('no') ? "No" : "false", reason: "Mock default: check No.", intent: "radio option selection", confidence: 0.90 };
      }
      if (id.includes('react') || name.includes('react') || label.includes('react')) {
        return { id: field.id, value: "I have strong React expertise through project study sprint tracker and Monstarlab Bangladesh.", reason: "Mock: mapped react question.", intent: "react project essay", confidence: 0.95 };
      }
      if (id.includes('letter') || name.includes('letter') || label.includes('letter')) {
        return { id: field.id, value: "Dear Hiring Manager,\n\nI am writing to express my enthusiastic interest in Acme Corp.\n\nSincerely,\nSyed Afnan Adit", reason: "Mock: cover letter.", intent: "cover letter essay", confidence: 0.98 };
      }

      if (id.includes('auto-location') || label.includes('auto_location') || id.includes('auto_location')) {
        return { id: field.id, value: "Madison, New Jersey, United States", reason: "Mock location autocomplete.", intent: "auto_location", confidence: 0.99 };
      }
      if (id.includes('auto-university') || label.includes('auto_university') || id.includes('auto_university')) {
        return { id: field.id, value: "Drew University", reason: "Mock university autocomplete.", intent: "auto_university", confidence: 0.99 };
      }
      if (id.includes('auto-company') || label.includes('auto_company') || id.includes('auto_company')) {
        return { id: field.id, value: "Monstarlab", reason: "Mock company autocomplete.", intent: "auto_company", confidence: 0.99 };
      }
      if (id.includes('auto-skills') || label.includes('auto_skills') || id.includes('auto_skills')) {
        return { id: field.id, value: "Machine Learning", reason: "Mock skill autocomplete.", intent: "auto_skills", confidence: 0.99 };
      }
      if (id.includes('auto-degree') || label.includes('auto_degree') || id.includes('auto_degree')) {
        return { id: field.id, value: "Bachelor of Science", reason: "Mock degree autocomplete.", intent: "auto_degree", confidence: 0.99 };
      }
      if (id.includes('auto-visa') || label.includes('auto_visa') || id.includes('auto_visa')) {
        return { id: field.id, value: "F-1 Student Visa", reason: "Mock visa autocomplete.", intent: "auto_visa", confidence: 0.99 };
      }
      if (id.includes('auto-no-match') || label.includes('auto_no_match') || id.includes('auto_no_match')) {
        return { id: field.id, value: "Quantum Physics", reason: "Mock no-match autocomplete.", intent: "auto_no_match", confidence: 0.99 };
      }

      return { id: field.id, value: null, reason: "Mock: skipped.", intent: "unclassified", confidence: 0.0 };
    });
  } else {
    const result = await response.json();
    try {
      const text = cleanJsonResponse(result.candidates[0].content.parts[0].text);
      mappings = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse AI mappings as JSON: ${err.message}. Raw text: ${result.candidates[0]?.content?.parts[0]?.text}`);
    }
  }

  // --- 3-Layer Agentic RAG Refinement Loop ---
  if (!useMock && (!jobUrl || !jobUrl.includes('mock-app.html'))) {
    console.log("[3-Layer RAG] Running refinement for complex/essay fields...");
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const labelText = field.labelText || '';
      const fieldName = field.name || '';
      const isTextarea = field.tagName === 'textarea';
      const isLongText = field.type === 'text' && labelText.length > 25;

      if (isTextarea || isLongText) {
        console.log(`[3-Layer RAG] Processing field "${labelText}" (id: ${field.id})...`);
        
        // Layer 1: Classification
        const classification = await classifyQuestion(labelText, fieldName, field.type, settings);
        console.log(`[3-Layer RAG] Classification for "${labelText}":`, classification);

        if (classification.question_type !== 'factual') {
          // Layer 2: Knowledge Retrieval vs. Generation Decision
          const decision = retrieveOrGenerateDecision(labelText, fieldName, profile, coverLetters);
          console.log(`[3-Layer RAG] Decision for "${labelText}":`, decision);

          // Layer 3: Generation & Optimization
          const optimized = await generateAndOptimizeAnswer(
            labelText, fieldName, field.type, classification, decision,
            profile, jobUrl, jobText, settings
          );

          if (optimized) {
            const mapIdx = mappings.findIndex(m => m.id === field.id);
            const newMap = {
              id: field.id,
              value: optimized.value,
              reason: optimized.reason,
              intent: classification.question_type,
              confidence: optimized.confidence
            };

            if (mapIdx !== -1) {
              mappings[mapIdx] = newMap;
            } else {
              mappings.push(newMap);
            }
            console.log(`[3-Layer RAG] Refined mapping for "${labelText}":`, newMap);
          }
        }
      }
    }
  }

  console.log("Generated AI mappings: " + JSON.stringify(mappings, null, 2));
  return { success: true, mappings };
}

// Helper to clean response code blocks (like ```json ... ```) from Gemini responses before JSON parsing
function cleanJsonResponse(rawText) {
  if (!rawText) return "";
  let clean = rawText.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```[a-zA-Z]*\s*/, "");
    clean = clean.replace(/```$/, "");
  }
  return clean.trim();
}

async function forceSyncToBackend() {
  try {
    const storage = await chrome.storage.local.get(["resumeFile", "coverLetters", "profile", "settings", "applications"]);
    const resumeFile = storage.resumeFile;
    const coverLetters = storage.coverLetters || [];
    const profile = storage.profile;
    const settings = storage.settings;
    const applications = storage.applications || [];

    // Sync Resume
    if (resumeFile && resumeFile.filename && resumeFile.base64Data) {
      const res = await fetch(`${BACKEND_URL}/resumes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: resumeFile.filename, base64Data: resumeFile.base64Data })
      });
      if (!res.ok) throw new Error("Resume sync request failed");
    }

    // Sync Cover Letters
    const resLetters = await fetch(`${BACKEND_URL}/cover-letters/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetters })
    });
    if (!resLetters.ok) throw new Error("Cover letters sync request failed");

    // Sync Profile
    if (profile) {
      const resProfile = await fetch(`${BACKEND_URL}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile })
      });
      if (!resProfile.ok) throw new Error("Profile sync request failed");
    }

    // Sync Settings
    if (settings) {
      const resSettings = await fetch(`${BACKEND_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings })
      });
      if (!resSettings.ok) throw new Error("Settings sync request failed");
    }

    // Sync Applications
    const resApps = await fetch(`${BACKEND_URL}/applications/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applications })
    });
    if (!resApps.ok) throw new Error("Applications sync request failed");

    return { success: true };
  } catch (err) {
    console.error("Force sync failed:", err);
    return { success: false, error: err.message };
  }
}

// Replay snapshot handlers
async function saveReplaySnapshot(snapshot) {
  try {
    const res = await fetch(`${BACKEND_URL}/replays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot)
    });
    if (res.ok) {
      return await res.json();
    } else {
      const errText = await res.text();
      return { success: false, error: errText };
    }
  } catch (err) {
    console.error("Error saving replay snapshot in service worker:", err);
    return { success: false, error: err.message };
  }
}

async function getReplays() {
  try {
    const res = await fetch(`${BACKEND_URL}/replays`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("Error fetching replay sessions in service worker:", err);
  }
  return [];
}

async function deleteReplay(id) {
  try {
    const res = await fetch(`${BACKEND_URL}/replays/${id}`, {
      method: "DELETE"
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("Error deleting replay session in service worker:", err);
  }
  return { success: false };
}

// On service worker startup, load all states from SQLite database if online
async function initializeStateFromBackend() {
  try {
    console.log("Hydrating local extension context from SQLite database...");
    
    // Fetch Profile
    const profileRes = await fetch(`${BACKEND_URL}/profile`);
    if (profileRes.ok) {
      const dbProfile = await profileRes.json();
      if (dbProfile) await chrome.storage.local.set({ profile: dbProfile });
    }

    // Fetch Settings
    const settingsRes = await fetch(`${BACKEND_URL}/settings`);
    if (settingsRes.ok) {
      const dbSettings = await settingsRes.json();
      if (dbSettings) await chrome.storage.local.set({ settings: dbSettings });
    }

    // Fetch Applications
    const appsRes = await fetch(`${BACKEND_URL}/applications`);
    if (appsRes.ok) {
      const dbApps = await appsRes.json();
      if (dbApps) await chrome.storage.local.set({ applications: dbApps });
    }

    // Fetch Resume
    const resumeRes = await fetch(`${BACKEND_URL}/resumes/active`);
    if (resumeRes.ok) {
      const dbResume = await resumeRes.json();
      if (dbResume) await chrome.storage.local.set({ resumeFile: dbResume });
    }

    // Fetch Cover Letters
    const lettersRes = await fetch(`${BACKEND_URL}/cover-letters`);
    if (lettersRes.ok) {
      const dbLetters = await lettersRes.json();
      if (dbLetters) await chrome.storage.local.set({ coverLetters: dbLetters });
    }

    console.log("Hydration completed successfully.");
  } catch (err) {
    console.log("Backend offline or initial connection failed, relying on local cache:", err);
  }
}

// Run state hydration
initializeStateFromBackend();


// --- BENCHMARK HELPERS ---

async function saveBenchmarkSession(data) {
  try {
    const res = await fetch(`${BACKEND_URL}/benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true, session: await res.json() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getBenchmarkReport() {
  try {
    const res = await fetch(`${BACKEND_URL}/benchmarks/report`);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true, ...(await res.json()) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function computeBenchmarkFromLog(data) {
  try {
    const res = await fetch(`${BACKEND_URL}/benchmarks/compute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true, ...(await res.json()) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
