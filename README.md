# Edward Sarpong Enterprise — Website

Custom cabinetry & interiors business website built on **Firebase Hosting + Cloud Functions** (Node 18).

---

## Table of Contents

1. [Project structure](#project-structure)
2. [Prerequisites](#prerequisites)
3. [Local development](#local-development)
4. [GitHub Secrets checklist](#github-secrets-checklist)
5. [Runtime config (Firebase Functions)](#runtime-config)
6. [Placeholder values to replace](#placeholder-values-to-replace)
7. [Deploy workflow](#deploy-workflow)
8. [Rollback](#rollback)
9. [Observability & monitoring](#observability--monitoring)
10. [Known gaps / roadmap](#known-gaps--roadmap)

---

## Project structure

```
.github/workflows/ci-deploy.yml  → CI lint + staging preview + production deploy
firebase.json                    → Hosting routes, security headers, CSP
firestore.rules                  → Firestore access rules
storage.rules                    → Firebase Storage access rules
public/
  index.html                     → Main marketing page
  shop.html                      → Shop / order flow
  shop.js / shop-config.js       → Shop logic + Firebase web config (fill placeholders)
  crm/
    index.html                   → Internal CRM (auth-gated)
    app.js                       → CRM logic
    config.js                    → CRM Firebase web config (fill placeholders)
  privacy.html                   → Privacy policy + Terms + Cookie policy
  sitemap.xml                    → XML sitemap
functions/
  index.js                       → Cloud Functions: submitLead, submitOrder
  package.json                   → Node 18 dependencies
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 LTS | https://nodejs.org |
| Firebase CLI | latest | `npm i -g firebase-tools` |
| Firebase project | — | https://console.firebase.google.com |

---

## Local development

```bash
# 1. Install functions dependencies
cd functions && npm install && cd ..

# 2. Log in to Firebase
firebase login

# 3. Select your project
firebase use <YOUR_PROJECT_ID>

# 4. Start local emulators (hosting + functions + firestore)
firebase emulators:start --only hosting,functions,firestore,storage

# Site runs at http://localhost:5000
# Functions at http://localhost:5001
# Firestore UI at http://localhost:4000
```

---

## GitHub Secrets checklist

Go to **GitHub → repo → Settings → Secrets and variables → Actions** and add:

| Secret name | What it is | Where to get it |
|-------------|-----------|-----------------|
| `FIREBASE_TOKEN` | CI deploy token | Run `firebase login:ci` locally |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Firebase console → Project settings |
| `FIREBASE_SERVICE_ACCOUNT` | JSON key for preview channel deploys | Firebase console → Project settings → Service accounts → Generate new key |
| `TURNSTILE_SECRET` | Cloudflare Turnstile **secret** key | https://dash.cloudflare.com → Turnstile |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | e.g. `https://www.edwardsarpong.com,https://edwardsarpong.com` |

> **GitHub Environment:** The production deploy job uses a GitHub Environment called `production`.
> Create it at **Settings → Environments → New environment → production** and optionally add required reviewers for an approval gate.

---

## Runtime config

The functions read runtime configuration for security-sensitive values. After adding the GitHub Secrets above, the CI pipeline sets them automatically on every production deploy.

To set them manually (one-off or local testing):

```bash
firebase functions:config:set \
  security.turnstile_secret="<YOUR_TURNSTILE_SECRET>" \
  security.allowed_origins="https://www.edwardsarpong.com,https://edwardsarpong.com"

# Verify
firebase functions:config:get
```

For local emulator testing, create `functions/.runtimeconfig.json`:

```json
{
  "security": {
    "turnstile_secret": "1x0000000000000000000000000000000AA",
    "allowed_origins": "http://localhost:5000,http://127.0.0.1:5000"
  }
}
```

> The value `1x0000000000000000000000000000000AA` is Cloudflare's always-pass test secret for local dev.

---

## Placeholder values to replace

These values exist in source files and **must** be replaced before going live:

| File | Placeholder | Replace with |
|------|------------|-------------|
| `public/shop-config.js` | `YOUR_API_KEY` etc. | Firebase web app credentials |
| `public/crm/config.js` | `YOUR_API_KEY` etc. | Same Firebase web app credentials |
| `public/index.html` line ~2195 | `YOUR_TURNSTILE_SITE_KEY` | Cloudflare Turnstile **site** key |
| `public/shop.html` line ~126 | `YOUR_TURNSTILE_SITE_KEY` | Cloudflare Turnstile **site** key |
| `public/shop.js` line ~24 | `ADD_MOMO_NUMBER` | Actual MTN Mobile Money number |
| `public/shop.js` line ~28–30 | `ADD_BANK_NAME` / `ADD_ACCOUNT_NUMBER` | Actual bank details |

> **Do not commit real secrets to source control.** Firebase web app API keys are safe to commit (they are domain-restricted); Mobile Money and bank details should be stored in Firestore settings via the CRM settings panel, not hardcoded.

---

## Deploy workflow

### Pull requests → Staging preview

Every PR automatically deploys a Firebase Hosting preview channel (expires in 7 days).
The preview URL is posted as a PR comment.

### Push to `main` → Production

1. CI job lints and validates.
2. Deploy job sets Firebase runtime config from secrets.
3. Deploy job runs `firebase deploy --only hosting,functions`.

### Manual dry-run (CI only, no deploy)

Trigger the workflow manually via **Actions → Run workflow** and set `skip_deploy: true`.

---

## Rollback

### Hosting (instant)

```bash
# List recent releases
firebase hosting:releases:list --project <YOUR_PROJECT_ID>

# Roll back to a specific version
firebase hosting:rollback --project <YOUR_PROJECT_ID>
```

### Functions

```bash
# Re-deploy a previous Git commit
git checkout <previous-sha>
firebase deploy --only functions --project <YOUR_PROJECT_ID>
git checkout main
```

### Firestore rules

```bash
git checkout <previous-sha> -- firestore.rules
firebase deploy --only firestore:rules --project <YOUR_PROJECT_ID>
git checkout main -- firestore.rules
```

---

## Observability & monitoring

Currently **not implemented** (roadmap item). Recommended additions:

- **Error tracking** — [Sentry](https://sentry.io) with the Firebase Functions SDK or a simple `console.error` → Cloud Logging alert in Firebase.
- **Uptime monitoring** — Firebase Hosting is monitored by Google's infrastructure; add an external check (e.g. UptimeRobot free tier) for the Cloud Functions endpoint.
- **Cloud Logging alerts** — In Google Cloud Console, create a log-based alert for `severity=ERROR` on the `edward-sarpong-official` project.
- **Analytics** — Uncomment and wire up the `loadAnalyticsCookies()` stub in `public/index.html` with a real GA4 Measurement ID once consent is given.

---

## Known gaps / roadmap

| Gap | Priority | Notes |
|-----|----------|-------|
| Automated test suite | High | No unit/integration tests exist yet. Add Jest for functions. |
| Error monitoring (Sentry) | High | No runtime alerting on function failures. |
| Data retention enforcement | Medium | Privacy policy states data is deleted on request; no automated purge job exists. |
| GDPR policy detail | Medium | Retention periods, lawful bases, processor list, and DSR SLAs are not specified. |
| Staging Firebase project | Medium | Currently preview channels share the production project's Firestore. A separate staging project is safer. |
| Image ownership | Low | Gallery images use Unsplash/Pinterest stock photos — replace with actual project photos. |
| Accessibility audit | Low | WCAG 2.1 AA baseline controls are present; a formal axe-core scan has not been run. |
