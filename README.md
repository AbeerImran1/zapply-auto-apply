# Zapply Auto-Apply Bot

A review-first Discord job assistant. It monitors selected job-post channels, detects vacancies, drafts a role-tailored CV and cover letter from your own files, and creates PDFs for you to review.

**You stay in control.** Zapply does not submit web forms, click employer submission buttons, accept legal declarations, or invent eligibility answers. An application email is sent only after you review the documents, run `/approve`, and explicitly run `/send`.

## Features

- Monitors only the Discord channel IDs configured in `.env`.
- Filters likely job posts before making an OpenAI request.
- Extracts company, role, location, employment type, deadline, application URL, and contact email.
- Only retains an application URL or email explicitly selected by the AI when it exactly matches content in the original Discord post. It never guesses the first URL or email.
- Stores detected jobs in a local JSON file and prevents duplicate message/link entries.
- Uses your private base CV and profile to draft a truthful, role-specific CV, cover letter, and email.
- Generates separate CV and cover-letter PDFs.
- Provides owner-only slash commands: `/queue`, `/details`, `/prepare`, `/approve`, and `/send`.
- Uses atomic state transitions to block concurrent duplicate preparation/sending.
- Recovers interrupted document preparation after a restart, while keeping uncertain email sends locked to avoid duplicates.

## Requirements

- Node.js 22 or newer.
- A Discord application and bot token.
- An OpenAI API key and a model available to your API account that supports JSON response mode.
- SMTP credentials only if you intend to send application emails. SMTP is optional.

## Setup on Windows

1. Download and extract the [Zapply source archive](./zapply-auto-apply-source.zip).
2. Open the extracted `zapply-auto-apply` folder in VS Code.
3. Run `setup.bat` to install dependencies and create the example private files. Alternatively, run `npm install` in the terminal.
4. Copy `.env.example` to `.env` if setup has not already done so.
5. Edit `.env` and set:
   - `DISCORD_TOKEN`: your Discord bot token.
   - `DISCORD_CLIENT_ID`: the Application ID from the Discord Developer Portal.
   - `DISCORD_OWNER_ID`: your Discord user ID. Only this user can run the bot's commands.
   - `DISCORD_JOB_CHANNEL_IDS`: comma-separated IDs of channels the bot is allowed to monitor.
   - `OPENAI_API_KEY` and `OPENAI_MODEL`.
6. Replace `private/base-cv.md` and `private/profile.md` with your own accurate information. These are local files and are ignored by Git.
7. In the Discord Developer Portal:
   - Enable **Message Content Intent** under **Bot → Privileged Gateway Intents**.
   - Invite the bot with the `bot` and `applications.commands` scopes.
   - Grant only the channel access it needs, plus permission to use application commands and attach files. Do not grant Administrator.
8. In Discord, enable Developer Mode and copy your user ID and the IDs of the job channels you want to monitor.
9. Run `npm run check`.
10. Optionally set `DISCORD_GUILD_ID` in `.env` to your test server for faster slash-command registration. Then run `npm run register-commands`.
11. Start the bot with `npm start` or double-click `start.bat`.

Keep the terminal open while the bot is running. Use `npm run dev` during development.

## Discord commands

| Command | Purpose |
|---|---|
| `/queue` | List recently detected jobs and their state. |
| `/details id:<id>` | Show job details, the original source post, application link, and selected contact email. |
| `/prepare id:<id>` | Generate the tailored CV and cover-letter PDFs. |
| `/approve id:<id>` | Record that you have reviewed the generated PDFs. |
| `/send id:<id>` | Send the approved PDFs to the selected email address from the original post. |

Use the short ID shown by `/queue`. If the job post does not contain a clearly selected email address, use the application URL and apply manually. Check `/details` before approving so you can verify the employer, role, link, and recipient.

## Optional SMTP setup

To enable `/send`, configure all of these values in `.env`:

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.

Port 587 normally uses `SMTP_SECURE=false`; port 465 normally uses `SMTP_SECURE=true`. Use an app password or provider-approved credential. Do not commit `.env`.

The bot verifies SMTP before taking the sending lock. If a failure occurs after an actual send attempt begins, delivery may be ambiguous; the job stays locked against automatic resending. Check your Sent folder and provider logs before doing anything else.

## Tests

Run `npm run check` or double-click `check.bat`. The check validates JavaScript/MJS syntax and runs 14 automated tests covering storage, duplicate prevention, atomic state transitions, recovery after interrupted preparation, link/email selection, validation, and Discord text escaping.

The tests do not contact Discord, OpenAI, or an SMTP provider. Live service configuration and login still need to be completed on your machine.

## Current limitations

- Storage is a local JSON file intended for one bot process on one machine. Multi-instance hosting needs a database and distributed locking.
- The bot analyses Discord message and embed text only. It does not OCR images or inspect attached documents.
- There is no web-form automation, job-board login, dashboard, or automatic application status tracking.
- AI-generated documents are drafts. Verify every claim, date, qualification, and contact detail before use.
- The bot never answers sensitive eligibility, identity, payment, or legal-declaration questions on your behalf.

## Privacy and security

- Never commit `.env`, your CV, profile, generated PDFs, bot tokens, or API keys.
- Only monitor channels you are allowed to access and trust. Members able to post in those channels can trigger job-post analysis.
- Slash commands are restricted to `DISCORD_OWNER_ID`.
- Your CV/profile text and the job description are sent to OpenAI when you run `/prepare`. Review your API provider's data-handling terms first.
- The bot does not submit web forms or complete sensitive identity, payment, or legal-declaration fields.

## License

MIT. See [LICENSE](./LICENSE).
