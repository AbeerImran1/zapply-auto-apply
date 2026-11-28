# Zapply Auto-Apply Bot

Zapply is a Discord job-listing autopilot. Once you have configured your candidate profile, credentials, job preferences, and approved employer/ATS domains, it can run without per-application approval: detect vacancies, filter them, tailor your CV and cover letter, generate PDFs, fill supported application forms, submit them, and record the outcome. It can also send applications by email to explicitly approved recruiter domains.

**This is unattended, bounded automation—not an unrestricted form-filling agent.** It never invents candidate facts, answers demographic/medical/legal/consent declarations, bypasses CAPTCHA or bot checks, or retries a submission whose outcome is uncertain. Those cases are logged for later review.

## What it automates

- Monitors only configured Discord job channels and backfills recent posts after a restart.
- Uses OpenAI to detect and extract job details. AI-selected application links/emails must exactly match links/emails present in the original post.
- Filters jobs against your saved role keywords, excluded keywords, locations, and employment types.
- Creates a role-specific CV and cover-letter PDF using only facts in your supplied CV/profile.
- Sends an application email when SMTP is configured and the recruiter email domain is explicitly allowlisted.
- Otherwise uses Playwright on HTTPS application sites whose hostnames are explicitly allowlisted.
- Fills standard identity/contact/profile fields using the saved application profile, attaches CV/cover-letter files, and submits when one unambiguous supported form and submit button are found.
- Records submitted, skipped, filtered, failed, and uncertain jobs in the local application queue.
- Uses a serial queue, duplicate checks, and daily cap to reduce repeated submissions.
- Resumes eligible new/prepared applications after a restart but never retries a send/submit attempt with uncertain delivery.

## What it will not automate

- CAPTCHA, reCAPTCHA, hCaptcha, bot challenges, rate-limit challenges, or access restrictions.
- Creating accounts, entering passwords, or bypassing a site's sign-in process. You may sign in once in the persistent browser profile with `npm run login-browser`.
- Required questions that cannot be answered from your saved profile.
- Medical, disability, demographic, religion, race, gender, age, date-of-birth, criminal-record, diversity, legal attestation, signature, consent, or terms-acceptance questions.
- Payment details, bank details, national insurance numbers, passport/identity numbers, or other sensitive identifiers.
- Multi-page forms, custom widgets, non-standard application flows, or forms with ambiguous submit buttons.
- Sites or recruiter email domains that you have not allowlisted.
- Websites whose terms prohibit automated access or applications. You are responsible for checking the rules for each site you allowlist.

When a form contains a required field it cannot safely answer, Zapply stops before submission and records `needs_manual`. If it clicks submit but cannot verify a confirmation, it records `submission_unknown` and will not retry automatically.

## Requirements

- Node.js 22 or newer.
- A Discord application/bot and access to the job channels.
- An OpenAI API key and a model available to your account that supports JSON response mode.
- Chromium (installed by `setup.bat` through Playwright).
- SMTP credentials if you want email applications.
- A complete, accurate candidate CV and profile.

## Setup on Windows

1. Download this branch using GitHub's **Code → Download ZIP**, then extract it.
2. Open the extracted project folder in VS Code.
3. Run `setup.bat`. It installs dependencies, downloads Playwright Chromium, and creates private profile templates.
4. Edit `.env` and configure:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_OWNER_ID`, and `DISCORD_JOB_CHANNEL_IDS`.
   - `OPENAI_API_KEY` and `OPENAI_MODEL`.
   - `AUTO_APPLY_ALLOWED_HOSTS`: comma-separated HTTPS hostnames for job application websites/ATS providers you have checked and permit automated applications on. Examples of the syntax only: `boards.greenhouse.io,jobs.lever.co`.
   - `AUTO_APPLY_ALLOWED_EMAIL_DOMAINS`: comma-separated recruiter email domains that may receive application emails. Use only domains you explicitly trust.
   - `AUTO_APPLY_MAX_PER_DAY`: maximum successfully submitted applications each UTC day (1–30; default 5).
5. Complete these local-only files:
   - `private/base-cv.md`: your factual CV.
   - `private/profile.md`: additional factual context for AI drafting.
   - `private/application-profile.json`: your exact details and job preferences used for autofill.
6. In `application-profile.json`, replace all `REPLACE_WITH_...` values. Set at least one target keyword in `preferences.keywords`. Set `workAuthorisation.authorisedToWork` and `requiresSponsorship` to `true` or `false` only when you know the correct answer; otherwise leave them `null`. Add other exact question/answer pairs under `answers` only when you know the answer.
7. In Discord Developer Portal, enable **Message Content Intent** and invite the bot with `bot` and `applications.commands`. Give it only access to the channels it should monitor; do not grant Administrator.
8. Run `npm run check`, then register commands with `npm run register-commands`. Set `DISCORD_GUILD_ID` first for faster test-server command registration.
9. Leave `AUTO_APPLY_ENABLED=false` for the first run. Start with `npm start` and check that the bot connects and detects the right job posts.
10. When your profile and host/email allowlists are complete, set `AUTO_APPLY_ENABLED=true` in `.env` and restart the bot. From then on eligible applications run without per-job approval.

Keep the terminal open while the bot is running. Use `npm run dev` during development. Run it on a machine/server that stays online to monitor Discord continuously.

## One-time sign-in for an approved job site

Some job boards require an account. Add the site's hostname to `AUTO_APPLY_ALLOWED_HOSTS`, then run:

```powershell
npm run login-browser -- https://approved-job-site.example
```

A visible Chromium window opens using Zapply's persistent browser profile. Sign in normally yourself and press Enter in the terminal when finished. Cookies/session data remain in `private/browser-profile` and are ignored by Git. Do not use this to bypass a CAPTCHA or a site's access controls. Zapply still stops when a site asks for an unsupported or sensitive required answer.

## Autopilot settings

| Setting | Meaning |
|---|---|
| `AUTO_APPLY_ENABLED` | Must be `true` to automatically prepare and submit eligible applications. Defaults to `false`. |
| `AUTO_APPLY_ALLOWED_HOSTS` | Exact trusted HTTPS site domains for browser applications; subdomains are allowed. |
| `AUTO_APPLY_ALLOWED_EMAIL_DOMAINS` | Exact trusted recruiter email domains; subdomains are allowed. |
| `AUTO_APPLY_MAX_PER_DAY` | Daily successful submission cap, 1–30; default 5. |
| `AUTO_APPLY_HEADLESS` | Run browser headlessly; default `true`. |
| `BROWSER_PROFILE_DIR` | Persistent browser cookies/session directory. Keep private. |

Autopilot requires a completed JSON profile with first name, last name, email, and at least one target keyword. It also requires at least one application route: an allowed web hostname, or SMTP plus an allowed recruiter email domain.

## Manual commands and monitoring

Slash commands are owner-only:
| Command | Purpose |
|---|---|
| `/queue` | List detected jobs and statuses. |
| `/details id:<id>` | Inspect a job and its source/application link. |
| `/prepare id:<id>` | Generate documents manually. |
| `/approve id:<id>` | Approve a manually prepared application. |
| `/send id:<id>` | Send a manually approved email application. |

Typical autopilot states include `filtered_out`, `prepared`, `sent`, `web_submitted`, `needs_manual`, `needs_configuration`, `failed_preparation`, and `submission_unknown`. The detailed record is stored locally in `data/jobs.json`.

## Privacy and safety

- Never commit `.env`, your CV, candidate profile, generated PDFs, browser cookies/session data, bot tokens, or API keys. These paths are in `.gitignore`.
- Candidate CV/profile text and each job description are sent to OpenAI for drafting. Check your API provider's data-handling terms.
- Recruiter application emails may contain your CV and cover letter. Use only approved sender/recipient accounts and trusted email domains.
- Restrict monitored Discord channels to sources you trust. Anyone who can post there may cause a job to be analysed.
- Review every site’s terms and any anti-automation rules before adding its hostname. Do not use this tool to evade access controls, account restrictions, bot protections, or application limits.
- Job-board HTML changes frequently. The form runner supports ordinary visible HTML forms only; unsupported workflows are skipped.
- A successful browser click is not proof of successful submission. The bot requires a visible confirmation message; uncertain results are never retried automatically.
- Local JSON storage is designed for one bot process on one machine. Do not run multiple instances against the same data directory.

## Tests

Run `npm run check` or `check.bat`. The tests cover job storage, duplicate protection, restart recovery, link/email extraction, host/email allowlists, profile-field mapping, protected questions, preferences, and Discord text escaping. CI verifies syntax and tests but does not log into Discord, use your OpenAI account, send emails, or submit live applications.

## License

MIT. See [LICENSE](./LICENSE).
