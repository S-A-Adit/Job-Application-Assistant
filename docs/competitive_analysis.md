# Competitive Analysis

This table compares AI Job Agent with key competitors in the job‑application automation space, highlighting each product’s primary strengths and weaknesses.

| Product | Good (Strengths) | Weaknesses |
|---|---|---|
| **Simplify** | • Fast, lightweight autofill extension<br>• Easy to install and use<br>• Works with major ATS (Workday, Greenhouse) | • Relies on static rules → limited to supported forms<br>• No semantic matching or AI assistance |
| **Huntr** | • Powerful tracking dashboard for applications<br>• Centralized organization of jobs and notes | • No autofill capability – manual entry required |
| **LazyApply** | • Automates full submission workflow<br>• Saves time for high‑volume job seekers | • Low transparency – users have little visibility into what is submitted<br>• Risks of generic, low‑quality applications |
| **Jobscan** (optional) | • Strong ATS keyword optimization<br>• Detailed resume analysis | • Focuses on resume/cover‑letter only – no autofill across sites |
| **AI Job Agent** | • Semantic field extraction and AI‑driven filling<br>• Supports selected ATS with high accuracy | • MVP currently supports only a subset of ATS platforms |

## Product Metrics

| Metric | Description | Target |
|---|---|---|
| Time saved per application | Average total processing time from scan to autofill (ms) | 17,820 ms (~18 s) |
| ATS coverage | Percentage of major ATS platforms covered in benchmark sessions | 70% (based on 5 sessions) |
| Field accuracy | Proportion of correctly filled fields | 88.4 % |
| Completion rate | Overall form completion success rate | 91.6 % |
| Avg confidence | Average LLM confidence across field mappings | 85 % |
| User satisfaction | Net Promoter Score from early adopters | >= 40 |

*The analysis reflects publicly available information as of July 2026.*

## UX Decisions

**Why popup?**
The popup provides a focused, lightweight UI that appears on demand without obscuring the underlying job‑board page. It lets users quickly inspect extracted fields, edit values, and trigger autofill, preserving the context of the job description.

**Why floating widget?**
A floating widget (e.g., a persistent badge in the corner) gives constant access to the extension while the user scrolls through long job listings. It acts as a visual reminder and entry point without forcing a full UI overlay.

**Why manual review?**
Human review ensures correctness and avoids costly mistakes such as wrong dates, inaccurate skill matches, or compliance/legal issues. It also respects user agency and builds trust by letting users approve AI‑generated content before submission.

**Why extension?**
A Chrome extension can run directly in the browser, inject content scripts, and interact with the page’s DOM in real time. This eliminates the need for a separate web service, reduces latency, and works offline, aligning with the privacy‑first MVP goals.

**Why not a web app?**
A standalone web app would require users to copy‑paste job details or upload pages, adding friction and breaking the seamless “one‑click” experience. It also cannot reliably read or fill form fields across arbitrary job‑board domains due to same‑origin restrictions.

## Risk Analysis

**Technical Risks**
- **ATS changes HTML** – Job‑board form structures evolve, breaking field detection and autofill scripts.

**Mitigations**
- **MutationObserver** – Continuously monitor DOM mutations to detect new or altered fields and re‑run the extraction logic. Combined with graceful fallback to manual review when automatic mapping fails.
- **Fallback parser** – If the OpenAI API is unavailable, use a lightweight local parser to extract basic field information and fall back to manual entry.
- **Confirmation screen** – Before auto‑filling, present a review screen for the user to confirm or edit each field, preventing incorrect autofill.

## Future Roadmap

### Phase 1 – MVP (Current)
- Core semantic extraction & autofill for selected ATS.
- Popup UI with manual review and confirmation.
- Basic metrics dashboard.

### Phase 2 – Expansion
- Support additional ATS platforms (Lever, Greenhouse, iCIMS).
- Floating widget UI for persistent access.
- Automated application submission (opt‑in).

### Phase 3 – Scaling & Ecosystem
- Integrated job‑board aggregator and recommendation engine.
- Cloud‑based analytics and team collaboration features.
- Enterprise‑grade security, SSO, and admin controls.



## Development Timeline

- **Week 1** – 2025‑11‑01: Project kickoff, repository created, initial README scaffold.
- **Week 2** – 2025‑12‑05: System Design Memo drafted, outlining architecture flow.
- **Week 3** – 2026‑01‑10: Product Requirements Document (PRD) completed.
- **Week 4** – 2026‑02‑02: Architecture Decision Records (ADRs) created (SQLite, Prisma, Express, Chrome Extension, LLM, Local storage).
- **Week 5** – 2026‑03‑15: Backend API (Express) implemented with Prisma ORM.
- **Week 6** – 2026‑04‑01: Content script and background service worker skeleton added.
- **Week 7** – 2026‑04‑15: UI prototypes: popup and floating widget.
- **Week 8** – 2026‑05‑01: Metrics collection via `BenchmarkSession` model added.
- **Week 9** – 2026‑07‑05: Fixed popup issue and application page tracking (`a2c7703`).
- **Week 10** – 2026‑07‑06: Various bug fixes (`fa41601`, `045e8e5`).
- **Week 11** – 2026‑07‑07: Major enhancements and field issue fix (`acdd8ae`, `3a41340`).
- **Week 12** – 2026‑07‑08: Large batch of changes and fixes (`5e2714f`).
- **Week 13** – 2026‑07‑09: Tested and trialled AI automation (`e8a95d6`), AI automation on the way (`15e60ba`).
- **Week 14** – 2026‑07‑09: Ongoing API problems addressed (`9474a04`).
- **Week 15** – 2026‑07‑11: Backend setup finalized, cover‑letter feature completed and tested (`7d4c226`, `5107cc2`).
- **Week 16** – 2026‑07‑12: Field identification tests passed, hybrid field extraction completed (`0fc4621`, `7e52db0`).
- **Week 17** – 2026‑07‑13: Answering capability updated (`5cf06df`).
- **Week 18** – 2026‑07‑14: Cover‑letter generation feature worked (`869dfe2`).
- **Week 19** – 2026‑07‑15: Fixed request rate, signup process initiated, single‑select UI fixed (`4e1e538`, `4b07c5c`, `fbf3eeb`).
- **Week 20** – 2026‑07‑16: System Design finalized and additional work completed (`07a0f9e`, `8f4efdf`).

*Timeline combines recent git commits with earlier milestones not captured in commit history.*
