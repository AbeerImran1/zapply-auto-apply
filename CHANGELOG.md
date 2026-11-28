# Changelog

## 1.0.1 — Reliability and contact-selection hardening

- Recover jobs left in `preparing` after a process restart so the user can run `/prepare` again.
- Keep jobs left in `sending` locked because an interrupted SMTP request may already have reached the recipient.
- Stop silently choosing the first URL or email address in a Discord post. The AI must select the contact, and the selected value must exactly match the original post.
- Extend syntax checking to `.mjs` files as well as `.js` files.
- Add regression tests for interrupted preparation recovery, uncertain email sends, and explicit contact selection.

All 14 automated tests pass with Node.js 22.16.0. Live Discord, OpenAI, and SMTP integrations have not been exercised in this environment.
