# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that automates LinkedIn "Easy Apply" job applications and LinkedIn feed engagement. No build step, bundler, or package manager — plain JavaScript loaded directly by Chrome.

## Development

### Loading the extension
1. Open `chrome://extensions/`, enable Developer mode
2. Click "Load unpacked" and select this repository folder
3. After code changes, click the reload button on the extension card

### Testing
No automated test framework. Test manually by loading the extension and navigating to:
- `https://www.linkedin.com/jobs/*` — for job application features
- `https://www.linkedin.com/feed` — for feed engagement features

Use Chrome DevTools console to inspect `window.linkedInAutoApply` namespace (content scripts) or the service worker console (background script).

## Architecture

### Two content script bundles (defined in `manifest.json`)

**Jobs bundle** — runs on `/jobs/*`:
```
utils.js → actions/openModal.js → actions/passDefaultSteps.js → actions/markTopChoice.js →
actions/handleAdditionalSteps.js → actions/passReviewStep.js → actions/handleApplicationSent.js →
actions.js → ui.js → content.js
```

**Feed bundle** — runs on `/feed`, `/feed/*`, `/`:
```
utils.js → feed/feedScraper.js → feed/feedEngagement.js → feed/feedAI.js → feed/feedUI.js → feed/feedContent.js
```

Script order matters — later scripts depend on objects registered by earlier ones.

### Global namespace: `window.linkedInAutoApply`

All modules share state through `window.linkedInAutoApply`. Key properties:
- `.settings` — user settings loaded from `chrome.storage.local` (via `loadSettings()` in `utils.js`)
- `.actions` — ordered array of action functions for the apply pipeline
- `.apply()` — main loop that iterates actions (in `content.js`)
- `.utils` — DOM helpers: `setFormControlValue`, `findPhoneInputs`, `selectOptionByText`, `checkRadioByLabel`, `typeIntoInput`
- `.feed` / `.feedEngagement` / `.feedUI` / `.feedAI` — feed module namespaces (IIFE-scoped, expose public API)

### Job application pipeline (`content.js → actions.js`)

`apply()` runs each action function in order. If an action returns `true`, it restarts the loop after a 2.5s delay. If all return `false`, the pipeline is done. Actions:
1. **openModal** — finds a job card with Easy Apply, checks keyword match, clicks to open modal
2. **passDefaultSteps** — auto-clicks "Next" on Contact Info / Resume steps, autofills phone
3. **markTopChoice** — skips the optional "top choice" step
4. **handleAdditionalSteps** — the largest action; autofills form fields (phone, languages, experience, location, visa, salary, work preference, etc.) using `settings` and `userProfile`. If unfilled required fields remain, waits for manual user input
5. **passReviewStep** — clicks submit on the review screen
6. **handleApplicationSent** — closes the post-apply modal, notifies background script

### Feed module (`feed/`)

- **feedScraper.js** — scrapes posts from the feed DOM using `data-testid`, `aria-label`, and text patterns (LinkedIn obfuscates CSS classes). Includes caching and hiring-signal detection (EN/ES)
- **feedEngagement.js** — auto-likes/comments/follows with rate limiting, human-like random delays, and daily/hourly safety caps
- **feedAI.js** — generates comments via LLM API (Qwen/Grok). Supports multiple providers: DashScope, OpenRouter, xAI, local (Ollama). Settings stored in `chrome.storage.local` under `feedAISettings`
- **feedUI.js** — floating buttons (Analyze Feed, Auto Engage, Feed Settings) and panels with progress bars
- **feedContent.js** — entry point; checks module availability, loads settings, creates UI, handles SPA navigation via MutationObserver

### Background service worker (`background.js`)

Handles messages from content scripts: `applicationSent`, `getStats`, `updateKeywords`, `feedAnalysisComplete`, `feedEngagementComplete`, `getKeywords`. Stores stats and keywords in `chrome.storage.local`. Sends Chrome notifications.

### Settings / storage

All user settings live in `chrome.storage.local`. The settings UI is built programmatically in `ui.js` (jobs) and `feed/feedUI.js` (feed). Key stored keys: `jobKeywords`, `phoneNumber`, `englishLevel`, `awsExperience`, `awsYearsExperience`, `javaYearsExperience`, `languages`, `userProfile`, `hispanicOption`, `authorizedToWorkInSpain`, `preferredLocation`, `feedAISettings`, `applicationStats`.

## Key Patterns

- **Multi-language form matching**: `handleAdditionalSteps.js` matches form labels in both English and Spanish (and sometimes other languages). When adding new autofill fields, follow the same regex pattern matching approach on label/aria-label/placeholder text.
- **LinkedIn DOM selectors**: LinkedIn uses obfuscated numbered CSS classes. Prefer `data-testid`, `aria-label`, `componentkey`, and semantic selectors (`.artdeco-button--primary`, `.jobs-easy-apply-modal`). Feed scraper uses selector strategies with fallback chains.
- **No build step**: All JS files are loaded directly. IIFEs are used in the feed module to avoid polluting the global scope while still exposing a public API on `window.linkedInAutoApply`.
