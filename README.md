# RealmsNetwork Tickets

A Discord support ticket bot built for RealmsNetwork. Written from scratch in Node.js with Discord.js, SQLite persistence, and sharding support out of the box.

## Features

**Ticketing**
- Category-select panel so users pick the right queue before a ticket opens
- Per-category parent channels, support roles, required roles, and up to three custom intake questions
- Open-ticket limits, creation cooldowns, and a staff-managed blacklist
- Optional persistent queue with priority ordering, strict-order enforcement, and per-staff claim caps
- Working-hours schedule and optional inactivity reminders on stale tickets

**Staff tools**
- Claim/unclaim, add/remove participants, rename, change category, set priority, tag
- Close with transcript, reopen, delete with confirmation, follow-up alerts
- `/ticket-queue next` to pull the next waiting ticket when the queue is enabled
- Auto-claim on first staff response (optional)

**Transcripts and logs**
- HTML transcript exported on close and attached to the ticket log channel
- Optional DM to the ticket owner and optional local copy on disk

**Stats and extras**
- Ticket counts, staff action metrics, leaderboard, first-response timing, average completion time
- Satisfaction reviews (optional, requested after close)
- Suggestion submissions with voting and staff decision workflow
- Staff-tracked invoice records with optional payment link — does not process payments
- Optional AI-generated close summaries via OpenAI (disabled by default)

## Requirements

- Node.js ≥ 22.12
- A Discord application and bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- Bot permissions: View Channel, Send Messages, Manage Channels, Manage Roles, Embed Links, Attach Files, Use Application Commands

## Setup

```sh
npm install
```

Copy `.env.example` to `.env` and fill in your token and client ID. Never commit `.env`.

```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
```

On first start, `config/settings.json` is created automatically from `config/settings.example.json`. Open it and set your role IDs, channel IDs, and ticket category parent channel IDs before inviting the bot to your server.

On later starts, missing settings are automatically added from the sample config without overwriting existing custom values.

Deploy slash commands:

```sh
npm run commands:deploy
```

Set `DISCORD_DEV_GUILD_ID` in `.env` to scope command deployment to one server during testing. Without it, commands deploy globally and can take a few minutes to appear.

Start the bot:

```sh
npm start          # sharding launcher (recommended)
npm run start:single  # single process, useful for debugging
```

Once online, run `/ticket-panel` in the channel where users should open tickets.

## Configuration

`config/settings.json` controls all server behavior. The main things to set:

| Key | What it does |
|---|---|
| `permissions.staffRoleIds` | Roles that can manage tickets |
| `permissions.adminRoleIds` | Roles with full admin access |
| `channels.ticketLogsId` | Channel where ticket events are logged |
| `ticketing.categories` | The ticket categories shown in the panel |
| `ticketing.channelPrefix` | Prefix for new and reopened ticket channels (default: `ticket-`; for example, `support-`) |
| `ticketing.categories[].channelPrefix` | Optional per-category prefix such as `general-`; an empty value inherits `ticketing.channelPrefix` |
| `ticketing.maxOpenPerUser` | Max open tickets per user (`0` = unlimited) |
| `ticketing.creationCooldownSeconds` | Minimum seconds between ticket opens |
| `ticketing.queue.enabled` | Turn the persistent queue on or off |
| `ticketing.queue.strictOrder` | Only allow claiming the highest-ranked waiting ticket |
| `ticketing.queue.display` | Optional priority-ordered queue embed, automatically created/edited in `channelId` and refreshed on the configured interval; its message ID is persisted in SQLite so restarts edit the same message |
| `priorityLevels[].rank` | Numeric priority weight; higher ranks sort before lower ranks, with oldest tickets first within the same rank |
| `ticketing.queue.staffCapacity` | Max active claims per staff member (`0` = no cap) |
| `ticketing.workingHours` | Restrict ticket opening to a time schedule |
| `ticketing.inactivityMonitor` | Alert staff on stale tickets |
| `ticketing.transcripts.dmOwnerOnClose` | DM the transcript to the user on close |
| `features.aiCloseSummaries` | Enable OpenAI summaries (requires `OPENAI_API_KEY`) |
| `features.suggestions` | Enable the suggestion workflow |
| `features.reviews` | Let users rate their support experience |

Category IDs must be letters, digits, underscores, or hyphens (max 40 chars). Each category can have a `parentCategoryId`, `supportRoleIds`, `requiredRoleIds`, and up to three `questions`. Each category can also set `channelPrefix` to override the global prefix; for example, `channelPrefix`: `general-` gives that category channels such as `general-12-someone`. Configure the optional queue embed under `ticketing.queue.display`; set `enabled`, `type: "embed"`, and a text `channelId`. The bot creates the message on first use and edits the stored message on restarts and at `refreshIntervalSeconds`.

## Commands

| Command | What it does |
|---|---|
| `/ticket-panel` | Post the support panel |
| `/ticket-close` | Close the ticket and export a transcript |
| `/ticket-delete` | Permanently delete after a final transcript attempt |
| `/ticket-claim` / `/ticket-unclaim` | Assign or release a ticket |
| `/ticket-add` / `/ticket-remove` | Add or remove a participant |
| `/ticket-rename` | Rename the ticket channel |
| `/ticket-category` | Move ticket to a different category |
| `/ticket-priority` | Set ticket priority |
| `/ticket-tag add/remove/list` | Manage ticket tags |
| `/ticket-transcript` | Export transcript without closing |
| `/ticket-alert` | Send the owner a follow-up message |
| `/ticket-pin` | Pin the opening info message |
| `/ticket-queue list/next/position` | Inspect or process the queue |
| `/ticket-blacklist add/remove/check` | Control who can open tickets |
| `/ticket-stats` / `/staff-stats` / `/review-stats` | View metrics |
| `/suggest` / `/suggestion-manage` | Submit and moderate suggestions |
| `/invoice create/status/mark-paid` | Track staff-managed invoices |
| `/ping` | Check bot latency |

## Deployment

`npm start` runs Discord's `ShardingManager` and lets Discord.js pick the shard count. All shard processes share one SQLite file (WAL mode, busy timeout configured). Back up the database while the bot is stopped or via SQLite's backup API.

This is a **single-host** setup. Do not share one SQLite file across separate machines. For multi-host scaling, swap in a PostgreSQL adapter and a distributed coordination layer.

Ticket transcripts may contain personal information. Restrict log-channel access, set reasonable retention, and protect database backups.

## Development

```sh
npm test     # run the test suite
npm run check  # syntax check all source files
npm run dev    # start with --watch for auto-restart
```

## License

[PolyForm Noncommercial 1.0](LICENSE) — free to use, modify, and self-host for non-commercial purposes. Commercial use, monetization, and reselling are not permitted.
