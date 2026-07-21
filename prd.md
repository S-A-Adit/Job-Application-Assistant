# 📄 Product Requirements Document (PRD): AI Job Agent

## 1. Document Control
*   **Product Name**: AI Job Agent
*   **Version**: 1.0.0
*   **Status**: Approved
*   **Target Release**: Q3 2026
*   **Authors**: DeepMind Antigravity Pair-Programmer

---

## 2. Problem Statement
Applying to multiple professional opportunities is a repetitive, tedious, and time-consuming process. Job seekers are forced to navigate dozens of independent portal environments (such as Greenhouse, Lever, and Workday) and populate long forms containing nearly identical biographical, professional, and educational questions structured in different layouts. 

Existing solutions fail in several ways:
1.  **Layout Brittleness**: Traditional browser autofill and simple browser extensions rely on static HTML matching (CSS selectors or `name`/`id` matching), which break when pages are dynamically loaded, updated, or when conditional fields appear.
2.  **Privacy & Security Vulnerabilities**: Most AI-powered autofill tools upload user resumes, cover letters, and highly sensitive personal credentials (including contact numbers, addresses, and demographic details) to insecure third-party cloud platforms.
3.  **Bot Detection Bans**: Modern job boards deploy anti-scraping and anti-bot scripts (like Cloudflare or Datadome). Naive form-fill scripts trigger these detectors by writing properties directly to element fields rather than emulating true human keystrokes.
4.  **Framework Synchronization Failures**: React, Angular, and Vue bindings fail to register programmatic value assignments to HTML input nodes, resulting in empty field submissions.

---

## 3. Goals
The core objective of the AI Job Agent is to deliver a highly accurate, automated, and secure local application experience.

*   **Semantic Intelligence**: Resolve the intent of complex form labels and prompts dynamically using Google Gemini API instead of relying on fixed HTML properties.
*   **Anti-Bot Compatibility**: Implement realistic user action simulators that mimic actual keystrokes and micro-delays.
*   **Local-First Privacy**: Keep the user's master dataset, cover letters, and uploaded resumes on their local machine inside encrypted SQLite structures.
*   **Adaptive Correction Learning**: Capture user edits to autofilled fields to improve subsequent auto-filling performance.
*   **Dynamic Observability**: Parse and react to live DOM changes as conditional questions arise.

---

## 4. Non-Goals
To keep the product focused, the following capabilities are explicitly declared out of scope for the current iteration:
*   **Fully Autonomous Submission (No-Click Auto-Submit)**: The agent will *never* automatically submit applications without a final user review. The user must review all fields and click the submit button.
*   **Cross-Browser Manifest Portability**: The extension is strictly targeted at Google Chrome (Manifest V3). Support for Safari, Firefox, or mobile browsers is not planned.
*   **Cloud Data Backup Hosting**: No central cloud databases will be hosted by the product. Synchronization and backups remain purely localized between the user's Chrome storage and their local database loopback server.
*   **Resume Parsing Services**: The extension does not offer an AI-driven resume builder. It relies on unstructured textual data inputs and raw document files.

---

## 5. User Personas

### Persona A: The High-Volume Applicant (Alex)
*   **Profile**: Active job seeker applying for 15+ engineering roles daily.
*   **Aspiration**: Wants to submit applications quickly and efficiently without having to re-type career histories.
*   **Pain Points**: Frustrated with Workday's custom combobox layouts, conditional screening essays, and the need to manually tailor a cover letter for every single application.

### Persona B: The Privacy-First Engineer (Taylor)
*   **Profile**: Senior Software Engineer who values personal data privacy.
*   **Aspiration**: Wants automated form-filling but is unwilling to host credentials, address details, or work histories on shared cloud repositories.
*   **Pain Points**: Rejects typical AI browser extension assistants because they scrape data and transmit it to external APIs. Requires absolute local isolation.

---

## 6. User Stories

*   **US-1: Profile Autofill**
    *   *As a* job candidate,
    *   *I want* the extension to automatically scan the active page and populate standard biographical details,
    *   *So that* I do not have to type my name, phone number, address, and social links on every application form.
*   **US-2: Semantic Resolution of Edge Cases**
    *   *As a* candidate filling out custom questionnaires,
    *   *I want* the AI assistant to parse custom text screening questions (e.g. "Tell us about a React project you built...") and pull relevant paragraphs from my profile,
    *   *So that* I can provide accurate answers to non-standard questions without typing.
*   **US-3: Custom Dropdown Choice Selection**
    *   *As a* job seeker,
    *   *I want* the autofill engine to automatically open dropdown lists and select options that match my background (e.g., degree level, location),
    *   *So that* I don't have to manually search through long picklists.
*   **US-4: Cover Letter Customization**
    *   *As a* candidate,
    *   *I want* to tailormake cover letters using job description context and my template text,
    *   *So that* my submission remains highly relevant to the role.
*   **US-5: Offline Persistence & Synchronization**
    *   *As a* user,
    *   *I want* to manage my profile and resumes locally inside SQLite,
    *   *So that* I never lose my profile settings when Chrome updates or when I reinstall the extension.
*   **US-6: Corrections Capture**
    *   *As a* candidate,
    *   *I want* the extension to save when I correct an autofilled field value,
    *   *So that* future applications will remember my preferred choice.

---

## 7. MVP Scope

The core MVP consists of the following components:

### 1. Automation Engine ([content.js](file:///f:/Projects/CodePath/ai-job-agent/extension/content.js))
*   Dynamic layout scanning using a browser-based `MutationObserver`.
*   Interactive human-like keyboard emulation via KeyboardEvent flows (`keydown`, `keypress`, `input`, `keyup`) with randomized delays (10ms - 50ms).
*   Automatic handling of native dropdowns (`<select>`) and custom select roles (`[role="combobox"]`).

### 2. Browser Context Coordination ([background.js](file:///f:/Projects/CodePath/ai-job-agent/extension/background.js))
*   Port connection messaging with active page frames.
*   Secure HTTP integration with the Gemini API gateway using locally stored keys.
*   Local background synchronization checks.

### 3. User Dashboard ([dashboard.html](file:///f:/Projects/CodePath/ai-job-agent/extension/dashboard.html))
*   Profile editor interface.
*   Resume version file uploader.
*   Application tracker logs list.

### 4. Relational Database Service ([server.js](file:///f:/Projects/CodePath/ai-job-agent/backend/server.js))
*   Local database persistence schemas ([schema.prisma](file:///f:/Projects/CodePath/ai-job-agent/backend/prisma/schema.prisma)) running SQLite.
*   Encryption pipeline utilizing AES-256-GCM configurations to safeguard profile and settings singletons.

---

## 8. Future Scope

Post-MVP development focuses on increasing automation intelligence and scaling data capabilities:
*   **Autonomous Job Discovery Agents**: Scrape job board aggregates (LinkedIn, Greenhouse indexes) to fetch openings and populate the user's tracker feed.
*   **Local LLM Integration**: Run lighter-weight LLMs (e.g. Llama-3, Phi-3) using Ollama local endpoints to completely eliminate external API calls.
*   **Cross-Device Peer Syncing**: Secure, encrypted peer-to-peer data replication among the user's devices without centralized servers.
*   **Deeper Diagnostic Tools**: Enhanced replay systems with screenshot triggers to capture parsing mistakes in visual layouts.

---

## 9. Success Metrics

The following metrics will define product validation success:

*   **Field Mapping Accuracy**: $\ge 95\%$ correct semantic mappings evaluated across standard benchmarks ([run-learning-loop.js](file:///f:/Projects/CodePath/ai-job-agent/backend/run-learning-loop.js)).
*   **Submission Speed Increase**: Target average completion time under 45 seconds per multi-step form.
*   **Zero Leakage Integrity**: Confirmed encryption verification (100% of credentials stored on `dev.db` encrypted at rest).
*   **Offline Data Availability**: Immediate form scanning works when disconnected from the backend database server.
*   **Zero Anti-Bot Triggers**: The human typing emulation loop yields zero form blocks or CAPTCHA triggers on standard Greenhouse/Lever portals.
