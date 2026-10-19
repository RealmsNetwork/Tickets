import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMissingDefaults } from './utils/settings-migration.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.resolve(root, process.env.TICKETS_CONFIG || './config/settings.json');
const examplePath = path.join(root, 'config', 'settings.example.json');

if (!fs.existsSync(configPath)) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(examplePath, configPath);
  console.warn(`[setup] Created ${path.relative(root, configPath)} from the sample settings. Review IDs and roles before using the bot.`);
}

let settings;
try {
  settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  throw new Error(`Unable to read JSON settings at ${configPath}: ${error.message}`);
}

const sampleSettings = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
if (addMissingDefaults(settings, sampleSettings)) {
  fs.writeFileSync(configPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  console.info(`[config] Migrated ${path.relative(root, configPath)} with missing defaults.`);
}

if (typeof settings?.ticketing?.channelPrefix !== 'string') {
  throw new Error('settings.ticketing.channelPrefix must be a string.');
}

const queueDisplay = settings?.ticketing?.queue?.display;
if (queueDisplay?.enabled) {
  if (!settings.ticketing.queue?.enabled) {
    throw new Error('ticketing.queue.display.enabled requires ticketing.queue.enabled to be true.');
  }
  if (!/^\d{17,20}$/.test(String(queueDisplay.channelId ?? ''))) {
    throw new Error('ticketing.queue.display.channelId must be a valid Discord channel ID when the queue display is enabled.');
  }
  if ((queueDisplay.type ?? 'embed') !== 'embed') {
    throw new Error('ticketing.queue.display.type currently supports only "embed".');
  }
  const refreshSeconds = Number(queueDisplay.refreshIntervalSeconds ?? 60);
  if (!Number.isFinite(refreshSeconds) || refreshSeconds < 15 || refreshSeconds > 86400) {
    throw new Error('ticketing.queue.display.refreshIntervalSeconds must be between 15 and 86400.');
  }
  const maxTickets = Number(queueDisplay.maxTickets ?? 15);
  if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 25) {
    throw new Error('ticketing.queue.display.maxTickets must be an integer between 1 and 25.');
  }
}

const categories = settings?.ticketing?.categories;
if (!Array.isArray(categories) || categories.length < 1) {
  throw new Error('settings.ticketing.categories must contain at least one category.');
}
if (categories.length > 25) throw new Error('Discord select menus support at most 25 ticket categories per panel in this release.');
if (!Array.isArray(settings.priorityLevels) || settings.priorityLevels.length < 1 || settings.priorityLevels.length > 25) {
  throw new Error('settings.priorityLevels must contain between 1 and 25 priority levels.');
}
const categoryIds = new Set();
for (const category of categories) {
  if (!category?.id || !/^[a-z0-9_-]{1,40}$/i.test(category.id)) {
    throw new Error('Every ticket category needs a unique id (letters, digits, _ and - only; max 40 characters).');
  }
  if (categoryIds.has(category.id)) throw new Error(`Duplicate ticket category id: ${category.id}`);
  categoryIds.add(category.id);
  if (category.channelPrefix !== undefined && typeof category.channelPrefix !== 'string') {
    throw new Error(`Category ${category.id} channelPrefix must be a string.`);
  }
  if (!Array.isArray(category.questions)) category.questions = [];
  if (category.questions.length > 3) category.questions = category.questions.slice(0, 3);
  for (const question of category.questions) {
    if (!String(question?.label ?? '').trim()) throw new Error(`Category ${category.id} has a question without a label.`);
  }
}

export const config = {
  ...settings,
  root,
  configPath,
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || '',
  databasePath: path.resolve(root, process.env.TICKETS_DATABASE || settings.database?.path || './data/tickets.sqlite'),
  openAiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  dashboardSecret: process.env.DASHBOARD_SECRET || '',
  dashboardPort: Number(process.env.DASHBOARD_PORT || 8787)
};

export function validateRuntimeConfig({ requireDiscord = true } = {}) {
  if (requireDiscord && !config.token) throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and set your bot token.');
  if (requireDiscord && !config.clientId) throw new Error('DISCORD_CLIENT_ID is missing. Set the application ID in .env.');
  if (config.features?.aiCloseSummaries && !config.openAiKey) {
    console.warn('[config] AI close summaries are enabled but OPENAI_API_KEY is not set; summaries will be skipped.');
  }
  if (config.ticketing.queue?.enabled && !config.databasePath) throw new Error('The queue requires a persistent database path.');
}
