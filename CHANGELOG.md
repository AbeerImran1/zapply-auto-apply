# Changelog

## 1.1.0 — Bounded unattended application autopilot

- Automatically queues detected Discord vacancies for filtering, document generation, and submission after one-time profile/configuration.
- Added Playwright support for straightforward HTTPS application forms on explicitly allowlisted hosts.
- Added SMTP auto-send only for explicitly selected recruiter addresses on allowlisted email domains.
- Added saved application profile, job preferences, explicit form-answer mapping, and one-time persistent browser sign-in helper.
- Added daily submission cap, serial processing, startup backfill, and recovery of prepared-but-not-yet-submitted jobs.
- Required fields with unknown answers, protected questions, login/captcha challenges, redirects, unsupported forms, and uncertain submission confirmations are skipped or locked rather than guessed or retried.
- Added automated tests for allowlists, application field mapping, protected questions, and job preferences.

Live Discord/OpenAI/SMTP/browser submissions still require configuration and an actual user-environment test.
