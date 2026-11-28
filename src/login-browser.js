import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from './config.js';
import { hostIsAllowed } from './web-applier.js';

const config = loadConfig();
const target = process.argv[2];
if (!target || !hostIsAllowed(target, config.autoApply.allowedHosts)) {
  console.error('Usage: npm run login-browser -- https://approved-site.example');
  console.error('The hostname must already appear in AUTO_APPLY_ALLOWED_HOSTS.');
  process.exit(1);
}

await import('node:fs/promises').then(({ mkdir }) => mkdir(config.browserProfileDir, { recursive: true }));
const context = await chromium.launchPersistentContext(config.browserProfileDir, {
  headless: false,
  viewport: { width: 1365, height: 900 },
});
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  console.log('Sign in to the approved job site in the opened browser, using the site normally.');
  console.log('Do not solve or bypass CAPTCHA with automation. Complete any site checks yourself.');
  const readline = createInterface({ input, output });
  await readline.question('When you are finished signing in, press Enter here to save the browser session...');
  readline.close();
} finally {
  await context.close();
}
