import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { commandData } from './commands.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.discordToken);
const route = config.discordGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
  : Routes.applicationCommands(config.discordClientId);

await rest.put(route, { body: commandData });
console.log(\`Registered \${commandData.length} slash command(s) \${config.discordGuildId ? 'for the test server' : 'globally'}.\`);
