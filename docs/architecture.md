# Architecture notes

- `src/launcher.js` owns process-level sharding; `src/bot.js` starts one Discord.js client per shard.
- `src/db/database.js` owns the SQLite schema and data access methods. Ticket, participant, suggestion, vote, review, blacklist, invoice, cooldown, and staff-event records survive restarts.
- `src/commands/definitions.js` is the single source for slash-command registration.
- `src/handlers/interactions.js` routes slash commands, button/select interactions, and modal submits.
- `src/services/tickets.js` owns ticket lifecycle and Discord channel-permission updates.
- `src/services/transcripts.js` creates HTML exports with escaped message content and linked attachments.
- `src/services/ai.js` optionally summarizes ticket contents. It is disabled by default and only makes outbound API requests when explicitly enabled and configured.
- `src/services/permissions.js` centralizes staff/admin and ticket-owner access checks.

## Operational invariants

1. A ticket has one persistent row keyed by a unique channel ID.
2. Tickets can be created only for configured categories.
3. The queue is represented by ticket status plus priority/creation-time ordering, so a restart does not lose queue entries.
4. Closing exports the transcript before restricting the creator's ability to send messages.
5. Deletion attempts a final transcript export before deleting the channel and related ticket row.
6. Invoice rows are records only; they are not payment confirmations from a provider.
