# Combined Architecture Decision Records & Engineering Trade‑offs

---

## Engineering Trade‑offs

### 1. Automated Application Submissions

**Why not automatically submit applications?**
- **Pros:** Highly convenient; saves maximum time for high‑volume applicants.
- **Cons:** Risk of hallucinated answers, accidental errors, legal concerns.
- **Decision:** Require user confirmation before final submission.

---

### 2. Form Autofill Logic

**Why semantic matching?**
- **Pros:** Higher accuracy, flexibility for varied phrasing.
- **Cons:** LLM API costs, requires network.
- **Decision:** Invoke AI only when deterministic matching fails.

---

### 3. Data Storage & Sync Strategy

**Why local database sync with browser local storage fallback?**
- **Pros:** Offline availability, resilience, privacy.
- **Cons:** Complex sync logic, extra dependencies.
- **Decision:** Implement dual storage sync using `chrome.storage.local` as cache and an Express + SQLite gateway for persistent backup.

---

### 4. Input Injection Method

**Why human typing simulation?**
- **Pros:** Bypasses anti‑bot scripts, ensures framework handlers capture updates.
- **Cons:** Slower than direct property assignments.
- **Decision:** Emulate keyboard events with micro‑delays.

---

### 5. Dynamic Form Handling

**Why MutationObserver page monitoring?**
- **Pros:** Automatically fills dynamically loaded sub‑questions.
- **Cons:** Higher memory usage, risk of loops.
- **Decision:** Use MutationObserver with debouncing and element locking to avoid redundant scans.

---

### 6. Self‑Correction Loop

**Why learned mappings overrides?**
- **Pros:** Adaptive learning, reduces LLM queries.
- **Cons:** Requires clean records, pruning stale data.
- **Decision:** Capture field modifications on submit and store as `LearnedMapping` for future prioritization.

---

### 7. Document Handling

**Why Base64 file database storage?**
- **Pros:** Simplifies backups, avoids local folder permission issues.
- **Cons:** Larger DB snapshots due to base64 overhead.
- **Decision:** Store resumes and cover letters as base64 entries within the database.

---

## ADR‑001 – Why SQLite?

**Decision:** SQLite

**Alternatives:** PostgreSQL, MongoDB

**Reason:**
- Runs locally
- Zero configuration
- Better privacy
- Ideal MVP

**Trade‑offs:** Less scalable

---

## ADR‑002 – Why Prisma?

**Decision:** Prisma ORM

**Alternatives:** Sequelize, TypeORM, Raw SQL Queries

**Reason:**
- Strongly typed client generation
- Clean schema migration tools
- Native support for SQLite relations
- Developer velocity

**Trade‑offs:**
- Additional dependency layer
- Slightly higher performance overhead than raw queries

---

## ADR‑003 – Why Express?

**Decision:** Express.js

**Alternatives:** NestJS, Fastify

**Reason:**
- Standard Node.js routing server
- Minimal setup and low configuration
- Familiarity and ecosystem compatibility
- Extensive middleware support (CORS, body parsing)

**Trade‑offs:** No built‑in dependency injection or structured module organization patterns (like NestJS)

---

## ADR‑004 – Why Chrome Extension?

**Decision:** Chrome Extension (Manifest V3)

**Alternatives:** Web Application, Desktop Application (Electron)

**Reason:**
- Direct DOM access to job application forms
- Security context bypass for cross‑origin pages
- Native integration with user's browser workflow
- Low friction configuration loading

**Trade‑offs:**
- Coupled to Chrome's Manifest V3 lifecycle limits
- Browser sandboxing limits hardware access

---

## ADR‑005 – Why OpenAI?

**Decision:** OpenAI LLM

**Alternatives:** Anthropic, Cohere, Local LLMs

**Reason:**
- State‑of‑the‑art language understanding
- Robust API with rate‑limit handling
- Good balance of cost vs performance for MVP

**Trade‑offs:**
- External service dependency
- Potential latency and cost considerations

---
