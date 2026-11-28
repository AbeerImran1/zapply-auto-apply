import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './config.js';
import { initialiseAI, parseJobPost } from './ai.js';
import { addJob, listJobs, recoverInterruptedPreparations } from './storage.js';
import { enqueueAutoApplication, loadApplicationProfile, validateCandidateDocuments } from './autopilot.js';
import { handleCommand } from './commands.js';

const config = loadConfig();
if (config.autoApply.enabled) {
  await loadApplicationProfile(config.applicationProfileFile);
  await validateCandidateDocuments(config);
  console.log('Autopilot profile and candidate documents passed startup validation.');
}
const recoveredPreparations = await recoverInterruptedPreparations(config.dataFile);
if (recoveredPreparations > 0) {
  console.log('Recovered ' + recoveredPreparations + ' interrupted preparation(s).');
}
initialiseAI(config);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function processJobMessage(message) {
  if (message.author.bot || !config.allowedChannelIds.has(message.channelId)) return;
  const content = message.content?.trim() ?? '';
  const embedText = message.embeds
    .flatMap((embed) => [embed.title, embed.description, embed.author?.name, embed.footer?.text,
      ...(embed.fields ?? []).flatMap((field) => [field.name, field.value])])
    .filter(Boolean).join('\n');
  const text = [content, embedText].filter(Boolean).join('\n').trim();
  if (text.length < 35) return;
  if (!/\b(job|jobs|hiring|vacancy|vacancies|internship|internships|graduate|position|role|recruitment|apply|application|opportunity|we are looking|we're looking)\b/i.test(text)) return;

  try {
    const sourceUrl = 'https://discord.com/channels/' + message.guildId + '/' + message.channelId + '/' + message.id;
    const parsed = await parseJobPost(text, sourceUrl);
    if (!parsed.isJobPost || parsed.confidence < 0.55 || !parsed.role || !parsed.company) return;
    const result = await addJob(config.dataFile, {
      company: parsed.company, role: parsed.role, location: parsed.location,
      employmentType: parsed.employmentType, description: parsed.description,
      applicationUrl: parsed.applicationUrl, applicationEmail: parsed.applicationEmail,
      deadline: parsed.deadline, confidence: parsed.confidence, sourceUrl,
      sourceMessageId: message.id, sourceChannelId: message.channelId,
    });
    if (result.added) {
      console.log('Detected job ' + result.job.id + ': ' + result.job.role + ' at ' + result.job.company);
      if (config.autoApply.enabled) {
        enqueueAutoApplication(result.job.id, config).catch((error) =>
          console.error('Autopilot failed for ' + result.job.id + ': ' + error.message));
      }
    }
  } catch (error) {
    console.error('Could not process Discord message ' + message.id + ': ' + error.message);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log('Zapply is online as ' + readyClient.user.tag + '.');
  console.log('Monitoring ' + config.allowedChannelIds.size + ' configured channel(s).');
  console.log(config.autoApply.enabled
    ? 'AUTOPILOT IS ENABLED. Daily cap: ' + config.autoApply.maxPerDay
    : 'Autopilot is disabled. Set AUTO_APPLY_ENABLED=true after completing your profile and allowlist.');

  if (config.autoApply.enabled) {
    // Resume queued jobs after a restart. Sending/unknown states are never retried.
    const pending = await listJobs(config.dataFile);
    for (const job of pending.filter((item) => (item.status === 'new' || (item.status === 'prepared' && item.autopilot)) && item.deliveryState === 'not_sent')) {
      enqueueAutoApplication(job.id, config).catch((error) =>
        console.error('Could not resume job ' + job.id + ': ' + error.message));
    }

    // Backfill recent messages so starting the bot does not miss posts sent while offline.
    for (const channelId of config.allowedChannelIds) {
      try {
        const channel = await readyClient.channels.fetch(channelId);
        if (!channel?.isTextBased() || !channel.messages) continue;
        const recent = await channel.messages.fetch({ limit: 25 });
        for (const message of [...recent.values()].reverse()) {
          await processJobMessage(message);
        }
      } catch (error) {
        console.error('Could not backfill channel ' + channelId + ': ' + error.message);
      }
    }
  }
});

if (config.autoApply.enabled) {
  const queueTimer = setInterval(async () => {
    try {
      const pending = await listJobs(config.dataFile);
      for (const job of pending.filter((item) => (item.status === 'new' || (item.status === 'prepared' && item.autopilot)) && item.deliveryState === 'not_sent')) {
        enqueueAutoApplication(job.id, config).catch((error) =>
          console.error('Scheduled autopilot retry failed for ' + job.id + ': ' + error.message));
      }
    } catch (error) {
      console.error('Could not scan autopilot queue: ' + error.message);
    }
  }, 60 * 60 * 1000);
  queueTimer.unref();
}

client.on(Events.MessageCreate, processJobMessage);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try { await handleCommand(interaction, config); }
  catch (error) {
    console.error('Command /' + interaction.commandName + ' failed: ' + error.message);
    const message = 'Something went wrong. Check the bot console for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exitCode = 1;
});

await client.login(config.discordToken);
