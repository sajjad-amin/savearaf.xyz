# Antigravity Project Instructions


These instructions apply to all work performed inside this project folder.


## 1. Project Boundary
- Work only inside the current project/repository unless explicitly authorized otherwise.
- Before making changes, verify the current working directory, repository, branch, Git status, and recent commits.
- Never mix files, assumptions, architecture, prompts, or code from another project.
- If the task appears to belong to another project, stop and report the mismatch.


## 2. Inspect Before Editing
Before implementation:
- Read the relevant project documentation, handover/status files, configuration, source files, and tests.
- Understand the existing architecture before proposing or writing code.
- Treat current source code and tests as stronger evidence than outdated documentation.
- Do not invent missing architecture when the repository already has an established pattern.


## 3. Scope Lock
- Work only on the explicitly authorized task.
- Do not implement future phases or bonus features.
- Do not fix unrelated issues unless they block the authorized task.
- Do not redesign unrelated systems.
- Stop when the assigned task is complete.


## 4. Anti-Overengineering
Prefer the simplest framework-native solution.


Avoid unnecessary:
- abstractions
- dependencies
- services
- databases
- queues
- state-management layers
- configuration systems
- helper hierarchies
- speculative extensibility
- broad refactors


Reuse existing systems whenever practical.


## 5. Surgical Changes
- Inspect every file before editing it.
- Modify only the smallest necessary sections.
- Preserve unrelated code, formatting, comments, and configuration.
- Avoid whole-file rewrites when a targeted edit is sufficient.
- Avoid mass formatting and unrelated renaming.


## 6. Protected Work
- Preserve all existing user work.
- Never delete, overwrite, reset, or clean up files you did not create unless explicitly authorized.
- If unexpected changes already exist in the working tree, stop and report them.


## 7. Dependency Discipline
Before adding any dependency:
1. Check whether the project already provides the capability.
2. Check whether the framework or standard library already supports it.
3. Prefer a small native solution when appropriate.
4. Add a dependency only when genuinely necessary and authorized.


Do not perform broad dependency upgrades.


## 8. macOS / Homebrew
For macOS system tools:
- Verify whether the tool is already installed.
- Prefer Homebrew when installation is appropriate.
- Do not run broad `brew upgrade` or `brew cleanup`.
- Do not make permanent PATH changes unless explicitly required.


Project dependencies must use the project's normal package manager.


## 9. Git Safety
Before editing, inspect:


```bash
git status --short
git branch --show-current
git log --oneline -8
```


Never use destructive Git operations unless explicitly authorized.


Do not use by default:
- `git reset --hard`
- `git clean -fd`
- force checkout over user changes
- force push
- history rewriting
- unrelated rebases
- automatic stashing


Do not push, merge, tag, release, or start another phase without authorization.


## 10. Baseline First
Before implementation, establish:
- starting commit
- working-tree state
- relevant runtime/tool versions
- relevant baseline tests


## 11. Incremental Implementation
After meaningful changes:
- typecheck or compile when applicable
- run focused tests
- inspect the diff
- verify behavior before continuing


Do not make a large batch of changes without intermediate verification.


## 12. One Authority Per Responsibility
Do not create competing implementations for the same responsibility.


Avoid duplicate:
- validation systems
- media pipelines
- timeline engines
- theme systems
- caches
- configuration stores
- business logic


Reuse or narrowly extract shared logic when justified.


## 13. Security
Validate data at trust boundaries.


When handling files, paths, uploads, URLs, commands, credentials, or external services:
- reject unsafe input
- preserve containment boundaries
- avoid leaking secrets or private environment values
- avoid exposing unnecessary absolute filesystem paths
- do not weaken existing security for convenience


## 14. External Access
Do not download assets, scrape websites, call external APIs, upload files, or access production unless the current task explicitly authorizes it.


If unexpected external access becomes necessary, stop and report why.


## 15. Data Safety
Never perform destructive production actions without explicit authorization.


Do not:
- drop or truncate production tables
- reset production databases
- delete user data
- run destructive migrations
- seed production
- overwrite production files


Use development fixtures or synthetic data whenever practical.


## 16. No Fake Fixes
Never satisfy a task by:
- hardcoding expected outputs
- weakening tests
- skipping validation
- disabling failing tests
- bypassing the actual feature
- hiding errors


Fix the underlying issue.


## 17. Verification
Run the checks appropriate to the change, such as:
- typecheck / compile
- focused unit tests
- integration tests
- regression tests
- build
- runtime smoke test
- visual inspection for UI/media work
- security failure cases


Only claim a test passed if it was actually executed successfully.


## 18. Stop Conditions
Stop and report before continuing if:
- repository/project identity is wrong
- working tree contains unexpected changes
- protected files must be changed
- major architecture changes become necessary
- an unauthorized dependency is required
- production access is required
- a destructive action is required
- the current project contract conflicts materially with the task
- required tooling is unavailable
- the task would require substantial scope expansion


Do not silently work around these boundaries.


## 19. Documentation and Handover
Update documentation or handover files when the task materially changes:
- architecture
- runtime behavior
- public contracts
- setup
- configuration
- known limitations
- project status


When a handover file exists, record:
- task/phase
- starting commit
- implementation summary
- important decisions
- files changed
- tests run
- regression status
- limitations/deferred work
- final commit
- working-tree state


## 20. Final Diff Review
Before completion, run:


```bash
git status --short
git diff --check
git diff
```


Review every changed file and remove accidental or unrelated changes.


## 21. Final Report
Return:


### Result
PASS / PARTIAL / FAILED / BLOCKED


### Starting State
Repository, branch, starting commit, working-tree state.


### Implemented
What changed.


### Tests
Exact commands and results.


### Files Changed


### Deviations
Write `NONE` if there were none.


### Limitations


### Git
Final commit and final working-tree state.


### Recommended Next Step
Recommend only. Do not start it.


## 22. Hard Stop
When the authorized task is complete, stop.


Do not automatically:
- add bonus features
- refactor unrelated code
- upgrade dependencies
- begin another phase
- merge
- push
- release

## 23. Project-Specific Rules (Save Araf)
- **Stack:** Full-stack Astro (SSR Mode), Tailwind CSS, and Drizzle ORM (MySQL).
- **Authentication:** Auth.js (Google Login). Role-based access (Admin vs User/Donor).
- **Caching/Security:** Redis for caching public fundraising stats and rate-limiting.
- **Language:** Bilingual (i18n). Default: Bengali (BN), Toggle: English (EN).
- **Core Domain Logic:** Platelet (SDP) safe cooldown is 15 days. Whole Blood safe cooldown is 90 days.
- **Dynamic Content:** Bank accounts and patient updates (Blog with TinyMCE) must be dynamic and manageable from the admin dashboard.
- **Donor CRM Logic:** 
  1. Users must log in via Google. Post-login, updating their WhatsApp-connected phone number is mandatory.
  2. Users can register themselves as donors AND add other offline donors via their dashboard (Referral system).
  3. Admins can manually add donors.
- **No Experimental Features:** Use only stable Astro SSR features.