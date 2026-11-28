import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeJobId } from './utils.js';

const emptyStore = () => ({ version: 1, jobs: [] });
let writeQueue = Promise.resolve();

async function readStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.jobs)) throw new Error('Invalid job store format.');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw new Error(\`Could not read \${filePath}: \${error.message}\`);
  }
}

async function writeStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = \`\${filePath}.tmp\`;
  await writeFile(tempPath, \`\${JSON.stringify(store, null, 2)}\n\`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

async function mutate(filePath, callback) {
  const operation = writeQueue.then(async () => {
    const store = await readStore(filePath);
    const result = await callback(store);
    await writeStore(filePath, store);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export async function listJobs(filePath) {
  await writeQueue;
  const store = await readStore(filePath);
  return [...store.jobs].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

export async function getJob(filePath, id) {
  const jobs = await listJobs(filePath);
  return jobs.find((job) => job.id === id) ?? null;
}

export async function addJob(filePath, jobInput) {
  return mutate(filePath, (store) => {
    const duplicate = store.jobs.find((job) =>
      (job.sourceMessageId && job.sourceMessageId === jobInput.sourceMessageId)
      || (job.applicationUrl && jobInput.applicationUrl && job.applicationUrl === jobInput.applicationUrl));
    if (duplicate) return { added: false, job: duplicate };

    const job = {
      ...jobInput,
      id: makeJobId(),
      createdAt: new Date().toISOString(),
      status: 'new',
      approved: false,
      deliveryState: 'not_sent',
      pack: null,
    };
    store.jobs.push(job);
    return { added: true, job };
  });
}

export async function updateJob(filePath, id, updater) {
  return mutate(filePath, (store) => {
    const index = store.jobs.findIndex((job) => job.id === id);
    if (index < 0) return null;
    const current = store.jobs[index];
    const next = typeof updater === 'function' ? updater({ ...current }) : { ...current, ...updater };
    store.jobs[index] = next;
    return next;
  });
}

/** Atomic compare-and-update used to prevent duplicate preparation and send attempts. */
export async function updateJobIf(filePath, id, predicate, updater) {
  return mutate(filePath, (store) => {
    const index = store.jobs.findIndex((job) => job.id === id);
    if (index < 0) return { updated: false, reason: 'not_found', job: null };
    const current = store.jobs[index];
    if (!predicate(current)) return { updated: false, reason: 'state_changed', job: current };
    const next = typeof updater === 'function' ? updater({ ...current }) : { ...current, ...updater };
    store.jobs[index] = next;
    return { updated: true, reason: null, job: next };
  });
}

/**
 * Recover preparation jobs interrupted by a process restart. Preparation is reversible.
 * A job in "sending" is deliberately not reset: SMTP may already have delivered it.
 */
export async function recoverInterruptedPreparations(filePath) {
  return mutate(filePath, (store) => {
    let recovered = 0;
    for (const job of store.jobs) {
      if (job.status !== 'preparing' || job.deliveryState !== 'not_sent') continue;
      job.status = job.pack ? 'prepared' : 'new';
      job.approved = false;
      job.preparationRecoveredAt = new Date().toISOString();
      recovered += 1;
    }
    return recovered;
  });
}
