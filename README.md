

# Zapply Auto-Apply Bot 

An end-to-end automation pipeline that monitors the **Zapply Discord Server** for new job listings, dynamically tailors a CV and generates a cover letter using AI, and autonomously submits applications on the user's behalf.

## The Problem
Applying for software engineering internships and jobs is a full-time job in itself. Job listings on Discord servers (like Zapply) are posted rapidly and often have a short window before the role is filled. Manually reading, tailoring a CV, writing a cover letter, and applying takes hours. 

## The Solution
This bot acts as a personal recruiter. It operates 24/7, instantly reacting to job postings, using LLMs to tailor application documents to the specific job description, and applying via email or web forms while the user sleeps.

## Architecture & Workflow
1. **The Listener:** A Discord bot (using `discord.js`) listens to specific channels in the Zapply server.
2. **The Parser:** When a job post is detected, it extracts the Company Name, Role, Required Skills, and Application Method (Email or URL).
3. **The AI Tailor:** The job description is sent to an LLM (e.g., OpenAI GPT-4 or Claude). The AI rewrites the base CV to highlight relevant skills and generates a custom cover letter.
4. **The Generator:** Uses `pdf-lib` or Python's `reportlab` to generate professional PDF versions of the CV and cover letter.
5. **The Applier:** 
   - *If Email:* Uses `Nodemailer` to send the PDFs directly to the recruiter.
   - *If Web Form:* Uses `Playwright` to navigate to the application URL, fill out standard fields, and upload the PDFs.

## Tech Stack (Planned)
- **Runtime:** Node.js + TypeScript
- **Discord Integration:** `discord.js`
- **AI Integration:** OpenAI API (or Anthropic API)
- **PDF Generation:** `pdf-lib` or `html-pdf-node`
- **Web Automation:** `Playwright`
- **Queue/State Management:** Redis + BullMQ (to prevent rate-limiting and track applied jobs)
- **Database:** PostgreSQL or SQLite (to log successfully applied jobs and avoid duplicates)

## Roadmap
- [ ] **Phase 1: Discord Listener:** Setup the bot, connect to the Zapply server, and log new messages to the console.
- [ ] **Phase 2: Data Parsing:** Build regex/LLM logic to extract Company, Role, and Application Link from the Discord message.
- [ ] **Phase 3: AI Tailoring:** Integrate OpenAI to dynamically generate a cover letter based on the parsed job description.
- [ ] **Phase 4: PDF Generation:** Programmatically build and export the tailored CV and Cover Letter as PDFs.
- [ ] **Phase 5: Auto-Apply (Email):** Automate sending the email with attachments via SMTP.
- [ ] **Phase 6: Dashboard:** Build a Next.js dashboard to track application success rates and view generated documents.

## Disclaimer
This tool is built for educational purposes to explore AI and automation. Users are responsible for ensuring they comply with the Terms of Service of the platforms they interact with. Always review AI-generated documents before submitting them to real employers.
