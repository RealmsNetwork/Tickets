import { REST, Routes } from 'discord.js';
import { config, validateRuntimeConfig } from '../src/config.js';
import { buildCommands } from '../src/commands/definitions.js';

validateRuntimeConfig();
const rest = new REST({ version: '10' }).setToken(config.token);
const payload = buildCommands(config);
const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

try {
  await rest.put(route, { body: payload });
  console.log(`Registered ${payload.length} slash commands ${config.devGuildId ? `in guild ${config.devGuildId}` : 'globally'}.`);
} catch (error) {
  console.error('Command deployment failed:', error);
  process.exitCode = 1;
}
