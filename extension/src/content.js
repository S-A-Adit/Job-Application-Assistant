// content.js - Content Script for AI Job Agent Extension

// --- DIAGNOSTICS & ACTION HISTORY LOGGER ---
const actionHistory = [];
const capturedConsoleLogs = [];

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function(...args) {
  capturedConsoleLogs.push({ type: 'log', message: args.join(' '), timestamp: new Date().toISOString() });
  originalLog.apply(console, args);
};
console.warn = function(...args) {
  capturedConsoleLogs.push({ type: 'warn', message: args.join(' '), timestamp: new Date().toISOString() });
  originalWarn.apply(console, args);
};
console.error = function(...args) {
  capturedConsoleLogs.push({ type: 'error', message: args.join(' '), timestamp: new Date().toISOString() });
  originalError.apply(console, args);
};

// logAction — enriched with LLM explainability metadata
// intent: semantic purpose of the field (e.g. "visa_authorization", "full_name")
// reason: LLM-generated rationale for the chosen value
// confidence: 0–1 score from the LLM mapping
// profileKey: which profile field was used to generate the value
function logAction(actionType, fieldId, labelText, value, status, message, { intent = '', reason = '', confidence = null, profileKey = '' } = {}) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, actionType, fieldId, labelText, value, status, message, intent, reason, confidence, profileKey };
  actionHistory.push(entry);
  const confStr = confidence !== null ? ` [${(confidence * 100).toFixed(0)}% confident]` : '';
  const intentStr = intent ? ` | Intent: ${intent}` : '';
  originalLog(`[AI Agent ActionLog] [${actionType}]${intentStr}${confStr} Field: "${labelText || fieldId}", Value: "${String(value).substring(0, 80)}", Status: ${status} - ${message}`);
}

function generateFailureSnapshot() {
  const formState = scanFilledValues();
  const domSnapshot = document.documentElement.outerHTML;
  const job = extractJobDetails();
  
  return {
    url: window.location.href,
    company: job.company || 'Unknown',
    role: job.title || 'Unknown',
    domSnapshot,
    actionHistory: JSON.stringify(actionHistory),
    consoleLogs: JSON.stringify(capturedConsoleLogs),
    formState: JSON.stringify(formState)
  };
}

async function sendFailureSnapshot() {
  const snapshot = generateFailureSnapshot();
  originalWarn("[AI Agent] Capturing and sending autofill failure snapshot to backend...", snapshot);
  try {
    const res = await chrome.runtime.sendMessage({
      action: "SAVE_REPLAY_SNAPSHOT",
      payload: snapshot
    });
    originalLog("[AI Agent] Failure snapshot successfully saved to SQLite:", res);
  } catch (err) {
    originalError("[AI Agent] Failed to save replay snapshot to database:", err);
  }
}

// Listener for messages from popup, side panel, or dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCAN_FORM") {
    const fields = scanFormFields();
    const jobDetails = extractJobDetails();
    sendResponse({ success: true, fields, jobDetails });
  } else if (request.action === "FILL_FORM") {
    startMutationObserver();
    // Reset action and console logs at the start of form fill execution
    actionHistory.length = 0;
    capturedConsoleLogs.length = 0;
    
    fillFormFields(request.payload.mappings)
      .then(filledCount => {
        sendResponse({ success: true, filledCount });
      })
      .catch(err => {
        originalError("Fill error:", err);
        logAction("EXCEPTION", "form", "all", "", "error", err.message);
        sendFailureSnapshot();
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async fillFormFields
  } else if (request.action === "FILL_PORTAL_CREDENTIALS") {
    const filled = fillPortalCredentials(request.payload.username, request.payload.password);
    sendResponse({ success: true, filled });
  } else if (request.action === "SCAN_FILLED_VALUES") {
    const filledValues = scanFilledValues();
    sendResponse({ success: true, filledValues });
  } else if (request.action === "DETECT_HUMAN_INTERVENTION") {
    // Phase 2: CAPTCHA and human-intervention detection
    const result = detectHumanInterventionRequired();
    sendResponse({ success: true, ...result });
  } else if (request.action === "FIND_NEXT_PAGE_BUTTON") {
    // Phase 3: Multi-page navigation
    const result = findNextPageButton();
    sendResponse({ success: true, ...result });
  } else if (request.action === "CLICK_NEXT_PAGE_BUTTON") {
    const result = findNextPageButton();
    if (result.found && result.elementId) {
      const el = document.getElementById(result.elementId) || document.querySelector(`[data-agent-nav="${result.elementId}"]`);
      if (el) {
        el.click();
        logAction('NAV_CLICK', result.elementId, result.label, '', 'success', `Clicked next-page button: "${result.label}"`);
        sendResponse({ success: true, clicked: true, label: result.label });
      } else {
        sendResponse({ success: false, clicked: false, reason: 'Element not found by ID after detection' });
      }
    } else {
      sendResponse({ success: false, clicked: false, reason: 'No next-page button found' });
    }
  } else if (request.action === "SCRAPE_JOB_DESCRIPTION") {
    // Fresh, targeted scrape of the job description for cover letter generation
    const raw = scrapeJobDescriptionText();
    sendResponse({ success: true, jobText: raw.substring(0, 4000), charCount: raw.length });
  } else if (request.action === "GET_ACTION_LOG") {
    sendResponse({ success: true, actionHistory: [...actionHistory], consoleLogs: [...capturedConsoleLogs] });
  } else if (request.action === "INJECT_COVER_LETTER") {
    const letterText = request.payload && request.payload.text ? request.payload.text : "";
    // Try to find the cover letter textarea by common selectors
    const selectors = [
      'textarea[name="cover_letter"]',
      'textarea[id*="cover"]',
      'textarea[id*="letter"]',
      'textarea[name*="cover"]',
      'textarea[name*="letter"]'
    ];
    let targetEl = null;
    for (const sel of selectors) {
      targetEl = document.querySelector(sel);
      if (targetEl) break;
    }
    // Fallback: find any visible textarea whose associated label mentions "cover"
    if (!targetEl) {
      const allTextareas = document.querySelectorAll("textarea");
      for (const ta of allTextareas) {
        const id = ta.id || "";
        const label = document.querySelector(`label[for="${id}"]`);
        const labelText = label ? label.textContent.toLowerCase() : "";
        if (labelText.includes("cover") || labelText.includes("letter")) {
          targetEl = ta;
          break;
        }
      }
    }
    if (targetEl) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeInputValueSetter.call(targetEl, letterText);
      targetEl.dispatchEvent(new Event("input", { bubbles: true }));
      targetEl.dispatchEvent(new Event("change", { bubbles: true }));
      sendResponse({ success: true, fieldId: targetEl.id || "(unknown)" });
    } else {
      sendResponse({ success: false, error: "No cover letter textarea found on this page." });
    }
  }
});

// Scans the active DOM (including Shadow DOMs) for interactive form inputs
function scanFormFields() {
  const fields = [];
  const inputs = getAllInputs(document);

  inputs.forEach((el, index) => {
    const tagName = el.tagName.toLowerCase();
    let type = el.type || '';
    
    if (el.getAttribute('role') === 'combobox') {
      type = 'combobox';
    } else if (el.getAttribute('aria-haspopup') === 'listbox') {
      type = 'listbox-button';
    }

    // Ignore hidden, submit buttons, structural inputs (except our custom dropdown widgets)
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') {
      if (type !== 'listbox-button') return;
    }

    if (!el.id) {
      el.id = `ai-agent-input-${index}`;
    }

    // Collect dropdown options
    let options = [];
    if (el instanceof HTMLSelectElement) {
      options = Array.from(el.options)
        .map(o => o.text.trim())
        .filter(t => t.length > 0);
    }

    // Attempt to extract associated label text
    let labelText = '';
    
    if (el.id) {
      const root = el.getRootNode();
      const labelEl = root.querySelector ? root.querySelector(`label[for="${el.id}"]`) : null;
      if (labelEl) {
        labelText = labelEl.textContent.trim();
      }
    }
    
    if (!labelText) {
      let parent = el.parentElement;
      while (parent) {
        if (parent.tagName === 'LABEL') {
          labelText = parent.textContent?.trim() || '';
          break;
        }
        parent = parent.parentElement;
      }
    }

    if (!labelText) {
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        labelText = prev.textContent.trim();
      }
    }

    if (!labelText) {
      labelText = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }

    labelText = sanitizeText(labelText);

    const isAutocomplete = el.getAttribute('data-autocomplete') === 'true' || 
                           el.getAttribute('role') === 'combobox' || 
                           el.getAttribute('aria-autocomplete') === 'list' || 
                           el.getAttribute('aria-autocomplete') === 'both';

    fields.push({
      id: el.id,
      tagName,
      type,
      name: sanitizeText(el.name || ''),
      placeholder: sanitizeText(el.placeholder || ''),
      labelText,
      options: options.map(o => sanitizeText(o)),
      isAutocomplete: isAutocomplete || undefined
    });
  });

  return fields;
}

// Smart targeted job description scraper — prioritises semantic containers, falls back to body
function scrapeJobDescriptionText() {
  // Ordered list of CSS selectors from most specific to least specific
  const SELECTORS = [
    // Explicit IDs / semantic markers used by common ATS/job boards
    '#job-description',
    '#jobDescriptionText',
    '#job_description',
    '#job-details',
    '#jobDetails',
    '[data-testid="job-description"]',
    '[data-testid="jobDescription"]',
    '[data-automation="jobDescriptionText"]',
    // Greenhouse / Lever / Ashby / Workday common selectors
    '.job__description',
    '.job-description',
    '.job-details__description',
    '.description__text',
    '.posting-description',
    '.section--text',
    // Generic semantic elements
    'article',
    'main section',
    'main'
  ];

  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > 100) return text; // Must be substantive
    }
  }

  // Final fallback: full body text (strip script/style content)
  return (document.body.innerText || '').trim();
}

// Scrapes basic job details directly from the active tab page
function extractJobDetails() {
  const url = window.location.href;

  let platform = 'generic';
  if (url.includes('greenhouse.io')) platform = 'greenhouse';
  else if (url.includes('lever.co')) platform = 'lever';
  else if (url.includes('workday')) platform = 'workday';
  else if (url.includes('ashbyhq.com')) platform = 'ashby';
  else if (url.includes('icims.com')) platform = 'icims';
  else if (url.includes('taleo.net')) platform = 'taleo';
  else if (url.includes('jobs.smartrecruiters.com')) platform = 'smartrecruiters';
  else if (url.includes('myworkdayjobs.com')) platform = 'workday';
  else if (url.includes('localhost') && url.includes('synthetic-ats')) platform = 'synthetic-ats';

  let title = '';
  const h1 = document.querySelector('h1');
  if (h1) title = h1.textContent.trim();

  let company = '';
  const metaOg = document.querySelector('meta[property="og:site_name"]');
  if (metaOg) {
    company = metaOg.getAttribute('content');
  } else {
    try {
      const hostname = window.location.hostname;
      const parts = hostname.split('.');
      company = parts.length > 2 ? parts[parts.length - 2] : parts[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } catch(e) {}
  }

  // Use targeted scraper — up to 4,000 chars to give AI more context
  const scrapedText = scrapeJobDescriptionText();

  return {
    url,
    platform,
    title: title || document.title,
    company: company || 'Company',
    textSnippet: scrapedText.substring(0, 4000)
  };
}

// Semantic Autocomplete Resolution helper function
async function resolveAutocompleteField(el, targetValue, labelText, mapping) {
  console.log(`[AI Agent Autocomplete] Attempting autocomplete resolution for "${labelText || el.id}" with target value: "${targetValue}"`);
  
  // Determine search query variants to try
  const firstPart = targetValue.split(/[()\[\],]/)[0].trim();
  const words = firstPart.split(/\s+/).filter(Boolean);
  
  const queryVariants = [];
  if (words.length > 0) {
    // Variant 1: First 2-3 words (e.g., "Drew University" or "Madison NJ")
    queryVariants.push(words.slice(0, 3).join(' '));
  }
  if (words.length > 1) {
    // Variant 2: Just the first word (e.g., "Drew" or "Madison")
    queryVariants.push(words[0]);
  }
  if (firstPart && !queryVariants.includes(firstPart)) {
    // Variant 3: The whole first part
    queryVariants.push(firstPart);
  }
  // Remove duplicates
  const uniqueVariants = Array.from(new Set(queryVariants));

  const optionSelectors = '[role="option"], [role="listbox"] li, li, .workday-dropdown-option, .select-option, .dropdown-item, .custom-option';

  function scanShadowForOptions(rootNode) {
    const shadowOptions = [];
    if (!rootNode || !rootNode.querySelectorAll) return shadowOptions;
    const allEls = rootNode.querySelectorAll('*');
    for (const child of allEls) {
      if (child.shadowRoot) {
        shadowOptions.push(...Array.from(child.shadowRoot.querySelectorAll(optionSelectors)));
        shadowOptions.push(...scanShadowForOptions(child.shadowRoot));
      }
    }
    return shadowOptions;
  }

  for (let attempt = 0; attempt < uniqueVariants.length; attempt++) {
    const query = uniqueVariants[attempt];
    console.log(`[AI Agent Autocomplete] Try query variant [${attempt + 1}/${uniqueVariants.length}]: "${query}"`);
    
    // Clear and type the query
    await simulateHumanTyping(el, query);
    
    // Trigger popup/input events
    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    
    // Wait for suggestions to load dynamically
    let optionElements = [];
    for (let poll = 0; poll < 30; poll++) {
      optionElements = Array.from(document.querySelectorAll(optionSelectors));
      optionElements = optionElements.concat(scanShadowForOptions(document));
      
      // Filter out invisible options and static list items
      optionElements = optionElements.filter(opt => {
        const rect = opt.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;

        const tagName = opt.tagName.toLowerCase();
        if (tagName === 'li') {
          // Verify it's inside a dropdown / options container
          let parent = opt.parentElement;
          let hasDropdownAncestor = false;
          while (parent) {
            const role = parent.getAttribute('role');
            const classList = Array.from(parent.classList || []);
            const id = parent.id || '';
            const parentClassStr = classList.join(' ').toLowerCase();
            
            if (role === 'listbox' || role === 'combobox' || role === 'menu' || 
                parentClassStr.includes('select') || parentClassStr.includes('dropdown') || 
                parentClassStr.includes('autocomplete') || parentClassStr.includes('options') || 
                parentClassStr.includes('popover') || parentClassStr.includes('menu') ||
                id.toLowerCase().includes('select') || id.toLowerCase().includes('dropdown') || 
                id.toLowerCase().includes('options')) {
              hasDropdownAncestor = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (!hasDropdownAncestor) return false;
        }
        return true;
      });

      if (optionElements.length > 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (optionElements.length > 0) {
      // De-duplicate options by text content
      optionElements = optionElements.filter((opt, idx, self) => 
        self.findIndex(o => (o.textContent || '').trim() === (opt.textContent || '').trim()) === idx
      );

      const availableOptions = optionElements.map((opt, index) => ({
        element: opt,
        text: (opt.textContent || '').trim(),
        value: (opt.getAttribute('data-value') || opt.getAttribute('value') || '').trim(),
        index
      }));

      console.log(`[AI Agent Autocomplete] Found ${availableOptions.length} suggestions:`, availableOptions.map(o => o.text));

      // Find the semantically best match using scoring
      let bestMatch = null;
      const targetLower = targetValue.toLowerCase();
      const normTarget = targetLower.replace(/[^a-z0-9]/g, '');

      // 1. Try exact or substring matches
      bestMatch = availableOptions.find(opt => {
        const optText = opt.text.toLowerCase();
        const optVal = opt.value.toLowerCase();
        const normText = optText.replace(/[^a-z0-9]/g, '');
        const normVal = optVal.replace(/[^a-z0-9]/g, '');
        return (
          optText === targetLower ||
          optVal === targetLower ||
          optText.includes(targetLower) ||
          targetLower.includes(optText) ||
          normText === normTarget ||
          normVal === normTarget ||
          normText.includes(normTarget) ||
          normTarget.includes(normText)
        );
      });

      // 2. Try fuzzy scoring
      if (!bestMatch) {
        let maxScore = 0;
        for (const opt of availableOptions) {
          const score = calculateFuzzyMatchScore(opt.text, targetValue);
          if (score > maxScore && score > 0.4) {
            maxScore = score;
            bestMatch = opt;
          }
        }
      }

      if (bestMatch) {
        console.log(`[AI Agent Autocomplete] Match found: "${bestMatch.text}" (index: ${bestMatch.index}). Selecting...`);
        
        const selectedOptionMetadata = {
          text: bestMatch.text,
          value: bestMatch.value || bestMatch.text,
          type: el.getAttribute('name') || el.id || 'autocomplete-option',
          ranking: bestMatch.index + 1
        };

        // Select the option
        simulateHumanClick(bestMatch.element);
        
        // Also fire keyboard fallback just in case click isn't registered
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        // Wait 300ms and validate if option is accepted
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const currentValue = el.value || '';
        const acceptedValAttr = el.getAttribute('data-accepted-value');
        const validationPassed = acceptedValAttr || (currentValue && currentValue.toLowerCase() !== query.toLowerCase());

        if (validationPassed) {
          highlightElement(el, 'success');
          logAction("AUTOCOMPLETE_SELECT", el.id, labelText, bestMatch.text, "success", `Autocomplete resolved: "${bestMatch.text}"`, {
            intent: mapping.intent,
            confidence: mapping.confidence,
            profileKey: mapping.profileKey,
            reason: `Selected ranked suggestion #${bestMatch.index + 1} matching "${targetValue}"`
          });
          
          // Dispatch change events
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, selectedText: bestMatch.text, metadata: selectedOptionMetadata };
        } else {
          console.warn(`[AI Agent Autocomplete] Validation failed for query "${query}". Value is still unresolved: "${currentValue}"`);
        }
      }
    }
  }

  // If we reach here, we failed to resolve any match
  console.error(`[AI Agent Autocomplete] Failed to resolve autocomplete option for target: "${targetValue}"`);
  highlightElement(el, 'warning');
  logAction("AUTOCOMPLETE_FAIL", el.id, labelText, targetValue, "warning", `Could not resolve autocomplete suggestions for: "${targetValue}"`, {
    intent: mapping.intent,
    confidence: mapping.confidence,
    profileKey: mapping.profileKey
  });
  
  if (el.getAttribute('data-autocomplete-strict') === 'true' || el.hasAttribute('data-autocomplete')) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return { success: false, selectedText: null };
}

// Populates matched form elements, injects local PDFs directly, and styles them
async function fillFormFields(mappings) {
  let filledCount = 0;

  for (const mapping of mappings) {
    const el = findElementInShadowDom(mapping.id);
    if (!el || mapping.value === null || mapping.value === undefined) {
      if (el && (mapping.value === null || mapping.value === undefined)) {
        logAction('SKIP', mapping.id, mapping.id, null, 'skipped', 'No value mapped by AI', { intent: mapping.intent || '', reason: mapping.reason || 'null value', confidence: mapping.confidence || 0, profileKey: mapping.profileKey || '' });
      }
      continue;
    }

    try {
      const value = String(mapping.value);
      const tagName = el.tagName.toLowerCase();
      
      // Check for sensitive fields and request user confirmation before filling
      let labelText = '';
      if (el.id) {
        const root = el.getRootNode();
        const labelEl = root.querySelector ? root.querySelector(`label[for="${el.id}"]`) : null;
        if (labelEl) labelText = labelEl.textContent.trim();
      }
      if (!labelText) {
        let parent = el.parentElement;
        while (parent) {
          if (parent.tagName === 'LABEL') {
            labelText = parent.textContent?.trim() || '';
            break;
          }
          parent = parent.parentElement;
        }
      }
      if (!labelText) {
        labelText = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      }

      if (isSensitiveField(labelText, el.name || '', el.placeholder || '')) {
        const confirmed = confirm(`[AI Agent Security] Confirm autofilling sensitive field "${labelText}" with value "${value}"?`);
        if (!confirmed) {
          console.log(`[AI Agent Security] User cancelled autofilling sensitive field: ${labelText}`);
          highlightElement(el, 'warning');
          continue;
        }
      }
      let type = el.type || '';
      
      if (el.getAttribute('role') === 'combobox') {
        type = 'combobox';
      } else if (el.getAttribute('aria-haspopup') === 'listbox') {
        type = 'listbox-button';
      }

      const isAutocompleteField = el.getAttribute('data-autocomplete') === 'true' || 
                                  el.getAttribute('role') === 'combobox' || 
                                  el.getAttribute('aria-autocomplete') === 'list' || 
                                  el.getAttribute('aria-autocomplete') === 'both' ||
                                  mapping.isAutocomplete;

      if (isAutocompleteField && (tagName === 'input' || tagName === 'div' || type === 'combobox' || type === 'listbox-button')) {
        const res = await resolveAutocompleteField(el, value, labelText, mapping);
        if (res.success) {
          filledCount++;
        }
      } else if (tagName === 'textarea' || (tagName === 'input' && type !== 'checkbox' && type !== 'radio' && type !== 'file' && type !== 'combobox' && type !== 'listbox-button')) {
        await simulateHumanTyping(el, value);
        
        if (tagName !== 'textarea') {
          // Keep the old simple clicker as a basic fallback for standard text inputs that might trigger simple native autocompletes
          const optionSelectors = '[role="option"], [role="listbox"] li, li, .workday-dropdown-option, .select-option, .dropdown-item, .custom-option';
          
          function scanShadowForOptions(rootNode) {
            const shadowOptions = [];
            if (!rootNode || !rootNode.querySelectorAll) return shadowOptions;
            const allEls = rootNode.querySelectorAll('*');
            for (const child of allEls) {
              if (child.shadowRoot) {
                shadowOptions.push(...Array.from(child.shadowRoot.querySelectorAll(optionSelectors)));
                shadowOptions.push(...scanShadowForOptions(child.shadowRoot));
              }
            }
            return shadowOptions;
          }

          let optionElements = [];
          for (let attempt = 0; attempt < 3; attempt++) {
            optionElements = Array.from(document.querySelectorAll(optionSelectors));
            optionElements = optionElements.concat(scanShadowForOptions(document));
            optionElements = optionElements.filter(opt => {
              const rect = opt.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (optionElements.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          if (optionElements.length > 0) {
            optionElements = optionElements.filter((opt, idx, self) => 
              self.findIndex(o => (o.textContent || '').trim() === (opt.textContent || '').trim()) === idx
            );
            const availableOptions = optionElements.map(opt => ({
              element: opt,
              text: (opt.textContent || '').trim(),
              value: (opt.getAttribute('data-value') || opt.getAttribute('value') || '').trim()
            }));
            let bestMatch = availableOptions.find(opt => {
              const optText = opt.text.toLowerCase();
              const optVal = opt.value.toLowerCase();
              return optText === value.toLowerCase() || optVal === value.toLowerCase();
            });
            if (bestMatch) {
              simulateHumanClick(bestMatch.element);
            }
          }
        }
        highlightElement(el, 'success');
        filledCount++;
      } else if (tagName === 'select') {
        const selectEl = el;
        const options = Array.from(selectEl.options);
        const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const match = options.find(o => {
          const optText = o.text.toLowerCase();
          const optVal = o.value.toLowerCase();
          const normText = optText.replace(/[^a-z0-9]/g, '');
          const normVal = optVal.replace(/[^a-z0-9]/g, '');
          return (
            optText.includes(value.toLowerCase()) ||
            value.toLowerCase().includes(optText) ||
            optVal === value.toLowerCase() ||
            normText.includes(normalizedValue) ||
            normalizedValue.includes(normText) ||
            normVal === normalizedValue
          );
        });

        if (match) {
          selectEl.value = match.value;
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          highlightElement(selectEl, 'success');
          filledCount++;
          logAction("SELECT", selectEl.id || selectEl.name, labelText, match.text, "success", `Selected option: "${match.text}"`);
        } else {
          highlightElement(selectEl, 'warning');
          logAction("SELECT_FAIL", selectEl.id || selectEl.name, labelText, value, "warning", `No options match query value: "${value}"`);
        }
      } else if (type === 'combobox' || type === 'listbox-button') {
        // Custom Combobox / Dropdown Selection Logic (Workday, picklists support)
        console.log(`[AI Agent] Custom dropdown/picklist detected for ID: ${el.id}. Opening to read options...`);
        
        el.focus();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        
        // Also try trigger parent wrappers to reveal options
        if (el.parentElement) {
          el.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.parentElement.click();
        }

        // Detect if trigger input accepts typing to filter autocomplete options
        const isEditable = el.tagName.toLowerCase() === 'input' || el.hasAttribute('contenteditable');
        if (isEditable) {
          console.log(`[AI Agent] Editable combobox input detected. Typing search query: "${value}"...`);
          await simulateHumanTyping(el, value);
        }
        
        // Find option items globally (Poll up to 2.5s for dynamic loading options)
        const optionSelectors = '[role="option"], [role="listbox"] li, li, .workday-dropdown-option, .select-option, .dropdown-item, .custom-option';
        
        let optionElements = [];
        for (let attempt = 0; attempt < 25; attempt++) {
          optionElements = Array.from(document.querySelectorAll(optionSelectors));
          optionElements = optionElements.concat(scanShadowForOptions(document));
          
          optionElements = optionElements.filter(opt => {
            const rect = opt.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (optionElements.length > 0) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Keep unique options by visible text
        optionElements = optionElements.filter((opt, idx, self) => 
          self.findIndex(o => (o.textContent || '').trim() === (opt.textContent || '').trim()) === idx
        );

        const availableOptions = optionElements.map(opt => ({
          element: opt,
          text: (opt.textContent || '').trim(),
          value: (opt.getAttribute('data-value') || opt.getAttribute('value') || '').trim()
        }));

        console.log(`[AI Agent] Found ${availableOptions.length} visible options:`, availableOptions.map(o => o.text));

        let bestMatch = null;
        if (availableOptions.length > 0) {
          const targetValue = value.toLowerCase();
          const normTarget = targetValue.replace(/[^a-z0-9]/g, '');

          // 1. Try exact/inclusion normalized matches
          bestMatch = availableOptions.find(opt => {
            const optText = opt.text.toLowerCase();
            const optVal = opt.value.toLowerCase();
            const normText = optText.replace(/[^a-z0-9]/g, '');
            const normVal = optVal.replace(/[^a-z0-9]/g, '');
            
            return (
              optText === targetValue ||
              optVal === targetValue ||
              optText.includes(targetValue) ||
              targetValue.includes(optText) ||
              normText === normTarget ||
              normVal === normTarget ||
              normText.includes(normTarget) ||
              normTarget.includes(normText)
            );
          });

          // 2. Try token overlap fuzzy matching if no close matches exist
          if (!bestMatch) {
            console.log(`[AI Agent] Attempting fuzzy token matching for "${value}"...`);
            let maxScore = 0;
            for (const opt of availableOptions) {
              const score = calculateFuzzyMatchScore(opt.text, value);
              if (score > maxScore && score > 0.4) {
                maxScore = score;
                bestMatch = opt;
              }
            }
          }
        }

        if (bestMatch) {
          console.log(`[AI Agent] Selecting closest resembling option: "${bestMatch.text}"`);
          simulateHumanClick(bestMatch.element);
          filledCount++;
          highlightElement(el, 'success');
          logAction("SELECT", el.id || "combobox", labelText, bestMatch.text, "success", `Selected option: "${bestMatch.text}"`);
        } else {
          console.warn(`[AI Agent] No option closely resembles "${value}"`);
          if (!isEditable) {
            el.click();
          }
          highlightElement(el, 'warning');
          logAction("SELECT_FAIL", el.id || "combobox", labelText, value, "warning", `No options match query value: "${value}"`);
        }
      } else if (tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
        const inputEl = el;
        const lowercaseVal = value.toLowerCase();
        
        let shouldCheck = false;
        if (type === 'radio') {
          let optionLabel = '';
          if (inputEl.id) {
            const labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
            if (labelEl) optionLabel = labelEl.textContent.trim().toLowerCase();
          }
          if (!optionLabel && inputEl.parentElement && inputEl.parentElement.tagName.toLowerCase() === 'label') {
            optionLabel = inputEl.parentElement.textContent.trim().toLowerCase();
          }

          const valLower = inputEl.value ? inputEl.value.toLowerCase() : '';
          const labelLower = optionLabel ? optionLabel.toLowerCase() : '';

          if (lowercaseVal === 'true') {
            shouldCheck = true;
          } else if (lowercaseVal === 'false') {
            shouldCheck = false;
          } else {
            shouldCheck = (
              lowercaseVal === valLower ||
              (labelLower && (lowercaseVal === labelLower || labelLower.includes(lowercaseVal) || lowercaseVal.includes(labelLower)))
            );
          }
        } else {
          shouldCheck = lowercaseVal === 'true' || lowercaseVal === 'yes' || lowercaseVal === '1' || lowercaseVal === 'checked' || lowercaseVal === inputEl.value.toLowerCase();
        }
        
        if (inputEl.checked !== shouldCheck) {
          inputEl.click();
          inputEl.checked = shouldCheck;
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
          logAction("CHECK", inputEl.id || inputEl.name, labelText, String(shouldCheck), "success", `${shouldCheck ? 'Checked' : 'Unchecked'} option`);
        } else {
          logAction("CHECK", inputEl.id || inputEl.name, labelText, String(shouldCheck), "success", `Option already in desired state`);
        }
        highlightElement(inputEl, 'success');
      } else if (tagName === 'input' && type === 'file') {
        const fileInput = el;
        if (isResumeInput(fileInput)) {
          const injected = await injectResumeFile(fileInput);
          if (injected) {
            filledCount++;
          }
        }
      }
    } catch (e) {
      console.error(`Failed to autofill field #${mapping.id}:`, e);
      logAction('EXCEPTION', mapping.id, mapping.id, mapping.value, 'error', `Field fill error: ${e.message}`, {
        intent: mapping.intent || '',
        reason: mapping.reason || '',
        confidence: mapping.confidence || 0,
        profileKey: mapping.profileKey || ''
      });
    }
  }

  return filledCount;
}

// Helper to convert base64 to File object and inject it into a file input element
async function injectResumeFile(fileInput) {
  try {
    const res = await chrome.runtime.sendMessage({ action: "GET_RESUME_FILE" });
    if (res && res.filename) {
      const { filename, base64Data } = res;
      
      // Convert base64 data back to a binary Blob
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const isDocx = filename.toLowerCase().endsWith(".docx");
      const mimeType = isDocx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
      const blob = new Blob([bytes], { type: mimeType });
      const file = new File([blob], filename, { type: mimeType });
      
      // Inject file using browser DataTransfer API
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fileInput, 'success');
      console.log(`Programmatically injected resume PDF: ${filename}`);
      logAction("INJECT_RESUME", fileInput.id || fileInput.name, "Resume Upload Input", filename, "success", `Injected resume: ${filename}`);
      return true;
    } else {
      highlightElement(fileInput, 'warning');
      console.warn("No stored resume PDF found in chrome extension storage.");
      logAction("INJECT_RESUME_FAIL", fileInput.id || fileInput.name, "Resume Upload Input", "", "warning", "No active resume document found in storage");
      return false;
    }
  } catch (err) {
    console.error("Failed to inject physical resume file:", err);
    logAction("INJECT_RESUME_FAIL", fileInput.id || fileInput.name, "Resume Upload Input", "", "error", `Injection error: ${err.message}`);
    highlightElement(fileInput, 'warning');
    return false;
  }
}

// Scans login/registration inputs on the active page and fills portal credentials
function fillPortalCredentials(username, password) {
  const inputs = Array.from(document.querySelectorAll('input'));
  let emailFilled = false;
  let passFilled = false;

  inputs.forEach(input => {
    const type = (input.type || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();

    // Look for email or username fields
    if (!emailFilled && (type === 'email' || type === 'text') && (name.includes('email') || name.includes('user') || id.includes('email') || id.includes('user') || placeholder.includes('email') || placeholder.includes('user'))) {
      input.focus();
      input.value = username;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(input, 'success');
      emailFilled = true;
    }

    // Look for password fields
    if (type === 'password') {
      input.focus();
      input.value = password;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(input, 'success');
      passFilled = true;
    }
  });

  if (emailFilled || passFilled) {
    logAction("FILL_CREDENTIALS", "login", "Portal Account Credentials", username, "success", "Filled portal username & password credentials");
  }

  return emailFilled || passFilled;
}

// Reverse Sync: Scans all page form inputs and records their current value details
function scanFilledValues() {
  const values = [];
  const inputs = Array.from(document.querySelectorAll('input, select, textarea'));

  inputs.forEach((el, index) => {
    const type = el.type || '';
    const tagName = el.tagName.toLowerCase();
    
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset' || type === 'file') {
      return;
    }

    if (!el.id) {
      el.id = `ai-agent-input-${index}`;
    }

    // Get current value
    let value = '';
    if (tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
      value = el.checked ? 'true' : 'false';
    } else {
      value = el.value || '';
    }

    // Get label
    let labelText = '';
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) labelText = labelEl.textContent.trim();
    }
    if (!labelText) {
      let parent = el.parentElement;
      while (parent) {
        if (parent.tagName === 'LABEL') {
          labelText = parent.textContent?.trim() || '';
          break;
        }
        parent = parent.parentElement;
      }
    }
    if (!labelText) {
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        labelText = prev.textContent.trim();
      }
    }

    labelText = labelText.replace(/\s+/g, ' ').trim();
    
    // Only return fields that actually have a filled value (non-empty)
    if (value.trim() && value !== 'false') {
      values.push({
        id: el.id,
        tagName,
        type,
        name: el.name || '',
        labelText: labelText || el.name || el.placeholder || 'Unknown Field',
        value: value.trim()
      });
    }
  });

  return values;
}

// Highlights an element temporarily to show autofill status
function highlightElement(el, status) {
  if (status === 'success') {
    el.style.outline = '2px solid #10b981'; 
    el.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
  } else if (status === 'warning') {
    el.style.outline = '2px solid #f59e0b'; 
    el.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Auto-track on form submission clicks
function initSubmitListener() {
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button, input[type='submit']");
    if (!target) return;

    const type = (target.type || "").toLowerCase();
    const text = (target.textContent || target.value || "").toLowerCase();
    
    // Check if it looks like a submit action
    if (type === "submit" || text.includes("submit") || text.includes("apply") || text.includes("send application")) {
      logAction("SUBMIT_ATTEMPT", target.id || "submit-btn", "Submit Button", "", "info", "Form submit clicked. Checking for errors in 800ms...");
      
      // Wait for any asynchronous JS client validations to fire and display error fields
      await new Promise(resolve => setTimeout(resolve, 800));

      let hasValidationErrors = false;
      const visibleErrors = Array.from(document.querySelectorAll('.error-msg, .error, [class*="error-message"], [class*="error_msg"]'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && el.textContent.trim().length > 0;
        });

      if (visibleErrors.length > 0) {
        hasValidationErrors = true;
        logAction("SUBMIT_VALIDATION_FAILURE", target.id || "submit-btn", "Submit Button", "", "failure", `Validation errors visible in UI: ${visibleErrors.map(e => e.textContent.trim().substring(0, 30)).join(', ')}`);
      }

      const valStatus = document.getElementById('validation-status');
      if (valStatus && valStatus.textContent && valStatus.textContent.includes('FAILED')) {
        hasValidationErrors = true;
        logAction("SUBMIT_VALIDATION_FAILURE", target.id || "submit-btn", "Submit Button", "", "failure", `Harness validation status is: ${valStatus.textContent.trim()}`);
      }

      if (hasValidationErrors) {
        await sendFailureSnapshot();
      } else {
        const job = extractJobDetails();
        if (job && job.url) {
          chrome.runtime.sendMessage({
            action: "SUBMIT_APPLICATION",
            payload: {
              company: job.company,
              role: job.role,
              url: job.url
            }
          });
        }
      }
    }
  });
}
initSubmitListener();

// Simulates a realistic human click by dispatching pointer and mouse event cascades
function simulateHumanClick(el) {
  if (!el) return;
  el.focus && el.focus();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.click();
  logAction("CLICK", el.id || el.name, el.textContent?.trim().substring(0, 50) || "element", "", "success", "Clicked element");
}

// Helper to determine if a file input element is specifically for the candidate's resume/CV
function isResumeInput(el) {
  const name = (el.name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const classes = (el.className || '').toLowerCase();
  
  let labelText = '';
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${el.id}"]`);
    if (labelEl) labelText = labelEl.textContent.trim().toLowerCase();
  }
  if (!labelText) {
    let parent = el.parentElement;
    while (parent) {
      if (parent.tagName === 'LABEL') {
        labelText = parent.textContent?.trim().toLowerCase() || '';
        break;
      }
      parent = parent.parentElement;
    }
  }

  // If label or name explicitly mentions cover letter, portfolio, or transcript, it is NOT the resume
  const isExcluded = (
    name.includes('cover') || name.includes('letter') || name.includes('transcript') || name.includes('portfolio') || name.includes('other') ||
    id.includes('cover') || id.includes('letter') || id.includes('transcript') || id.includes('portfolio') || id.includes('other') ||
    labelText.includes('cover') || labelText.includes('letter') || labelText.includes('transcript') || labelText.includes('portfolio') || labelText.includes('other')
  );

  if (isExcluded) return false;

  // Check if it appears to be a resume/CV input
  return (
    name.includes('resume') || name.includes('cv') || name.includes('curriculum') ||
    id.includes('resume') || id.includes('cv') || id.includes('curriculum') ||
    labelText.includes('resume') || labelText.includes('cv') || labelText.includes('curriculum') ||
    // If it's the only file input on the page, default to true
    document.querySelectorAll('input[type="file"]').length === 1
  );
}

// Recursively fetches all form input fields including ones nested inside open Shadow DOMs
function getAllInputs(root = document) {
  let list = [];
  
  // Find visible input elements in the current root
  const elements = root.querySelectorAll('input, select, textarea, div[role="combobox"], button[aria-haspopup="listbox"]');
  list = list.concat(Array.from(elements));
  
  // Recursively inspect open Shadow DOMs of all elements
  const allElements = root.querySelectorAll('*');
  allElements.forEach(el => {
    if (el.shadowRoot) {
      list = list.concat(getAllInputs(el.shadowRoot));
    }
  });
  
  return list;
}

// Recursively searches for an element by ID within the DOM and all nested Shadow DOMs
function findElementInShadowDom(id, root = document) {
  const el = root.getElementById ? root.getElementById(id) : null;
  if (el) return el;
  
  const allElements = root.querySelectorAll('*');
  for (const child of allElements) {
    if (child.shadowRoot) {
      const found = findElementInShadowDom(id, child.shadowRoot);
      if (found) return found;
    }
  }
  return null;
}

// Simulates human character-by-character typing with delay and custom event cascades
async function simulateHumanTyping(element, value) {
  element.focus();
  element.value = ''; // Clear existing contents
  
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const charCode = char.charCodeAt(0);
    
    // Keydown event
    element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, keyCode: charCode, bubbles: true }));
    
    // Keypress event
    element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, keyCode: charCode, bubbles: true }));
    
    // Append character
    element.value += char;
    
    // Input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Keyup event
    element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, keyCode: charCode, bubbles: true }));
    
    // Micro typing delay (5ms)
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  
  // Change event at the end
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
  logAction("TYPE", element.id || element.name, element.placeholder || "input", value, "success", `Typed "${value}"`);
}

// Token-based Jaccard similarity fuzzy match scorer for picklist choices
function calculateFuzzyMatchScore(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Token overlap score
  const tokens1 = new Set(s1.split(/\s+/).filter(t => t.length > 0));
  const tokens2 = new Set(s2.split(/\s+/).filter(t => t.length > 0));
  
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  
  let intersection = 0;
  for (const t of tokens2) {
    if (tokens1.has(t)) intersection++;
  }
  
  const union = tokens1.size + tokens2.size - intersection;
  return union > 0 ? (intersection / union) : 0;
}

// Dynamic MutationObserver to auto-detect and populate new form questions as they load
let mutationObserver = null;

function startMutationObserver() {
  if (mutationObserver) return;
  
  mutationObserver = new MutationObserver(async (mutations) => {
    let newInputs = [];
    
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node;
          const matches = el.querySelectorAll ? Array.from(el.querySelectorAll('input, select, textarea, div[role="combobox"], button[aria-haspopup="listbox"]')) : [];
          if (el.matches && el.matches('input, select, textarea, div[role="combobox"], button[aria-haspopup="listbox"]')) {
            matches.push(el);
          }
          
          matches.forEach(input => {
            const type = input.type || '';
            if (type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'image' && type !== 'reset') {
              if (!input.id || !input.id.startsWith('ai-agent-input-')) {
                newInputs.push(input);
              }
            }
          });
        }
      });
    });
    
    if (newInputs.length > 0) {
      console.log(`[AI Agent] Detected ${newInputs.length} new dynamic input fields in DOM!`);
      const startIndex = document.querySelectorAll('input, select, textarea').length + 1000;
      
      const formattedFields = newInputs.map((input, idx) => {
        if (!input.id) {
          input.id = `ai-agent-input-dynamic-${startIndex + idx}`;
        }
        
        const tagName = input.tagName.toLowerCase();
        let type = input.type || '';
        if (input.getAttribute('role') === 'combobox') type = 'combobox';
        else if (input.getAttribute('aria-haspopup') === 'listbox') type = 'listbox-button';
        
        let labelText = '';
        if (input.id) {
          const root = input.getRootNode();
          const labelEl = root.querySelector ? root.querySelector(`label[for="${input.id}"]`) : null;
          if (labelEl) labelText = labelEl.textContent.trim();
        }
        if (!labelText) {
          let parent = input.parentElement;
          while (parent) {
            if (parent.tagName === 'LABEL') {
              labelText = parent.textContent?.trim() || '';
              break;
            }
            parent = parent.parentElement;
          }
        }
        if (!labelText) {
          labelText = input.getAttribute('aria-label') || input.getAttribute('placeholder') || '';
        }
        
        let options = [];
        if (input instanceof HTMLSelectElement) {
          options = Array.from(input.options).map(o => o.text.trim()).filter(t => t.length > 0);
        }
        
        const isAutocomplete = input.getAttribute('data-autocomplete') === 'true' || 
                               input.getAttribute('role') === 'combobox' || 
                               input.getAttribute('aria-autocomplete') === 'list' || 
                               input.getAttribute('aria-autocomplete') === 'both';

        return {
          id: input.id,
          tagName,
          type,
          name: sanitizeText(input.name || ''),
          placeholder: sanitizeText(input.placeholder || ''),
          labelText: sanitizeText(labelText),
          options: options.map(o => sanitizeText(o)),
          isAutocomplete: isAutocomplete || undefined
        };
      });
      
      try {
        const response = await chrome.runtime.sendMessage({
          action: "MAP_DYNAMIC_FIELDS",
          payload: { fields: formattedFields }
        });
        
        if (response && response.success && response.mappings) {
          console.log("[AI Agent] Dynamically mapping & filling new fields:", response.mappings);
          await fillFormFields(response.mappings);
        }
      } catch (err) {
        console.error("[AI Agent] Failed to map dynamic fields automatically:", err);
      }
    }
  });
  
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  console.log("[AI Agent] Dynamic field MutationObserver active.");
}

// Sanitizes DOM text before sending it to the LLM
function sanitizeText(text) {
  if (!text) return '';
  let clean = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<[^>]*>/g, '');
  return clean.replace(/\s+/g, ' ').trim();
}

// Security heuristic check for sensitive information fields
function isSensitiveField(labelText, name, placeholder) {
  const text = `${labelText} ${name} ${placeholder}`.toLowerCase();
  return text.includes('salary') || text.includes('compensation') || text.includes('pay') || text.includes('remuneration') || text.includes('desired');
}

// ─── Phase 2: CAPTCHA & Human Intervention Detection ───────────────────────
/**
 * Scans the current page for signals that require human intervention:
 *  - CAPTCHA widgets (reCAPTCHA, hCaptcha, Cloudflare Turnstile)
 *  - Ambiguous high-risk questions the agent should not auto-answer
 *  - Known intervention-required patterns
 *
 * Returns:
 *  { requiresIntervention: bool, reason: string, type: string, confidence: number }
 */
function detectHumanInterventionRequired() {
  const interventionSignals = [];

  // 1. reCAPTCHA iframes
  const recaptchaFrames = document.querySelectorAll(
    'iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"], iframe[title*="reCAPTCHA"]'
  );
  if (recaptchaFrames.length > 0) {
    interventionSignals.push({
      type: 'captcha_recaptcha',
      reason: `reCAPTCHA widget detected (${recaptchaFrames.length} iframe${recaptchaFrames.length > 1 ? 's' : ''})`,
      confidence: 0.98
    });
  }

  // 2. hCaptcha
  const hcaptchaFrames = document.querySelectorAll(
    'iframe[src*="hcaptcha"], div[class*="h-captcha"], div[data-hcaptcha-widget-id]'
  );
  if (hcaptchaFrames.length > 0) {
    interventionSignals.push({
      type: 'captcha_hcaptcha',
      reason: 'hCaptcha widget detected',
      confidence: 0.97
    });
  }

  // 3. Cloudflare Turnstile
  const turnstile = document.querySelectorAll(
    'iframe[src*="challenges.cloudflare"], div.cf-turnstile, [data-cf-turnstile]'
  );
  if (turnstile.length > 0) {
    interventionSignals.push({
      type: 'captcha_cloudflare',
      reason: 'Cloudflare Turnstile CAPTCHA detected',
      confidence: 0.97
    });
  }

  // 4. Aria-labeled CAPTCHA elements
  const ariaCapthca = document.querySelectorAll('[aria-label*="CAPTCHA" i], [aria-label*="captcha" i], [title*="captcha" i]');
  if (ariaCapthca.length > 0) {
    interventionSignals.push({
      type: 'captcha_aria',
      reason: 'CAPTCHA element detected via aria-label',
      confidence: 0.90
    });
  }

  // 5. Image CAPTCHA text in visible page text
  const pageText = (document.body?.innerText || '').toLowerCase();
  if (/i[\s'-]?am[\s'-]?not[\s'-]?a[\s'-]?robot/i.test(pageText)) {
    interventionSignals.push({
      type: 'captcha_text',
      reason: 'Page contains "I am not a robot" text',
      confidence: 0.85
    });
  }

  // 6. Background / identity check (high-risk, avoid auto-fill)
  const bgCheckPatterns = [
    /background\s+check/i,
    /criminal\s+record/i,
    /felony/i,
    /security\s+clearance/i,
    /drug\s+test/i
  ];
  const hasBackgroundCheck = bgCheckPatterns.some(p => p.test(pageText));
  if (hasBackgroundCheck) {
    interventionSignals.push({
      type: 'high_risk_question',
      reason: 'Page contains background check or criminal record questions requiring explicit user review',
      confidence: 0.80
    });
  }

  // 7. Two-factor authentication / OTP screens
  const otpInputs = document.querySelectorAll(
    'input[name*="otp" i], input[name*="verification" i], input[autocomplete="one-time-code"], input[placeholder*="verification code" i]'
  );
  if (otpInputs.length > 0) {
    interventionSignals.push({
      type: 'otp_required',
      reason: 'OTP / 2FA verification input detected — user must receive and enter the code',
      confidence: 0.95
    });
  }

  // 8. Login walls (non-autofillable portals)
  const loginPatterns = [
    /please\s+sign\s+in/i,
    /log\s+in\s+to\s+continue/i,
    /create\s+an\s+account\s+to\s+apply/i
  ];
  const hasLoginWall = loginPatterns.some(p => p.test(pageText));
  if (hasLoginWall) {
    interventionSignals.push({
      type: 'login_wall',
      reason: 'Portal login wall detected — user may need to authenticate first',
      confidence: 0.75
    });
  }

  const requiresIntervention = interventionSignals.length > 0;
  const primarySignal = interventionSignals[0] || null;

  if (requiresIntervention) {
    logAction(
      'HUMAN_INTERVENTION_REQUIRED',
      'page',
      'document',
      '',
      'warning',
      `Intervention required: ${primarySignal.reason}`,
      { intent: primarySignal.type, confidence: primarySignal.confidence }
    );
  }

  return {
    requiresIntervention,
    type: primarySignal?.type || null,
    reason: primarySignal?.reason || null,
    confidence: primarySignal?.confidence || 0,
    allSignals: interventionSignals
  };
}

// ─── Phase 3: Multi-Page Navigation — Find Next Page Button ───────────────
/**
 * Identifies the navigation button to advance to the next form page.
 * Uses semantic heuristics to distinguish "Next" from "Submit".
 *
 * Returns:
 *  { found: bool, elementId: string|null, label: string|null, isSubmit: bool }
 */
function findNextPageButton() {
  // Priority-ordered patterns: navigation first, submit last
  const navPatterns = [
    /^(continue|next|save\s*&?\s*continue|proceed|next\s*step|next\s*page|go\s*to\s*next)$/i,
    /^(save\s*and\s*continue|continue\s*to|proceed\s*to)\s+/i,
  ];
  const submitPatterns = [
    /^(submit|submit\s*application|send\s*application|apply\s*now|finish|complete\s*application|confirm\s*&?\s*submit|done)$/i
  ];

  // Gather all potentially clickable elements
  const candidates = Array.from(document.querySelectorAll(
    'button:not([disabled]), input[type="submit"]:not([disabled]), input[type="button"]:not([disabled]), [role="button"]:not([disabled]), a[href][class*="btn"], a[href][class*="button"]'
  ));

  // Filter to only visible elements
  const visibleCandidates = candidates.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight + 200;
  });

  let bestNavBtn = null;
  let bestSubmitBtn = null;

  for (const el of visibleCandidates) {
    const labelText = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
    const labelNorm = labelText.replace(/[^a-z0-9\s]/gi, '').trim();

    const isNav = navPatterns.some(p => p.test(labelNorm));
    const isSubmit = submitPatterns.some(p => p.test(labelNorm));

    if (isNav && !bestNavBtn) {
      // Assign a deterministic ID for clicking
      if (!el.id) el.setAttribute('data-agent-nav', `agent-nav-${Date.now()}`);
      bestNavBtn = { el, labelText };
    } else if (isSubmit && !bestSubmitBtn) {
      if (!el.id) el.setAttribute('data-agent-nav', `agent-nav-submit-${Date.now()}`);
      bestSubmitBtn = { el, labelText };
    }
  }

  // Prefer navigation button, fall back to submit if no nav found
  const chosen = bestNavBtn || bestSubmitBtn;
  if (!chosen) {
    return { found: false, elementId: null, label: null, isSubmit: false };
  }

  const isSubmitChoice = !bestNavBtn && !!bestSubmitBtn;
  const chosenId = chosen.el.id || chosen.el.getAttribute('data-agent-nav');
  return {
    found: true,
    elementId: chosenId,
    label: chosen.labelText,
    isSubmit: isSubmitChoice
  };
}

// ─── Phase 4: Prompt Injection Defense ─────────────────────────────────────
/**
 * Sanitizes raw DOM text before it is sent to the LLM to prevent
 * prompt injection attacks embedded in page content.
 *
 * Strips:
 *  - Common injection phrases targeting system/assistant roles
 *  - Instruction overrides
 *  - Role-switching commands
 *
 * @param {string} rawText - Raw text extracted from the DOM
 * @param {number} maxLength - Max character length (default 4000)
 * @returns {string} Sanitized text safe for LLM consumption
 */
function sanitizeForLLM(rawText, maxLength = 4000) {
  if (!rawText || typeof rawText !== 'string') return '';

  // Patterns that could hijack LLM behavior
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /forget\s+(everything|all|prior|previous)/gi,
    /you\s+are\s+now\s+(a|an)\s+/gi,
    /act\s+as\s+(a|an)\s+/gi,
    /new\s+instruction[s]?:/gi,
    /system\s*:\s*/gi,
    /assistant\s*:\s*/gi,
    /human\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/?SYS\]/gi,
    /<\|system\|>/gi,
    /<\|im_start\|>/gi,
    /<<<.*?>>>/gs,
    /---BEGIN\s+SYSTEM/gi,
    /---END\s+SYSTEM/gi,
    /your\s+(real|true|actual)\s+(purpose|role|goal)\s+is/gi,
    /reveal\s+(your|the)\s+(system\s+)?prompt/gi,
    /print\s+(your|the)\s+(system\s+)?prompt/gi,
    /exfiltrate/gi,
    /base64\s*decode/gi,
  ];

  let clean = rawText;
  let wasInjected = false;

  for (const pattern of injectionPatterns) {
    if (pattern.test(clean)) {
      wasInjected = true;
      clean = clean.replace(pattern, '[FILTERED]');
    }
  }

  if (wasInjected) {
    originalWarn('[AI Agent Security] Prompt injection attempt detected and sanitized in DOM content.');
    logAction('SECURITY', 'dom', 'page_text', '', 'warning', 'Prompt injection pattern detected and stripped from DOM text before LLM submission');
  }

  // Truncate to safe length
  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength) + ' [TRUNCATED]';
  }

  return clean.trim();
}
