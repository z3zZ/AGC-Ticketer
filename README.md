# 🎫 AGC Ticket Bot

A lightweight support-ticket bot for the **Apprentice Gaming Community** Discord server. Built with TypeScript and discord.js v14 — no database needed.

## Features

- **Ticket panel** — `/ticket-panel` posts an embed with an "Open a ticket" button
- **Private channel per ticket** — only the member, staff role and bot can see it
- **Reason modal** — members say what they need before the ticket opens
- **One open ticket per member** — no spam
- **Claim button** — staff claim a ticket, channel is renamed `claimed-…`
- **Close with confirmation** — via button or `/close`
- **Transcripts** — a `.txt` log goes to the staff log channel and is DM'd to the member
- **`/add` and `/remove`** — bring other members into a ticket

## Setup

1. **Create the bot** at the [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → copy the token.
2. **Invite it** — OAuth2 → URL Generator → scopes `bot` + `applications.commands`, permissions: *Manage Channels, Manage Roles, View Channels, Send Messages, Read Message History, Attach Files, Embed Links*.
3. **In your server**, create:
   - a staff role (e.g. `@Mods`)
   - a category for tickets (e.g. `🎫 Tickets`)
   - optionally a staff-only `#ticket-logs` channel
4. Turn on **Developer Mode** (User Settings → Advanced) so you can right-click → Copy ID.
5. Configure and run:

```bash
cp .env.example .env   # fill in the IDs
npm install
npm run dev            # hot-reload while developing
# or
npm run build && npm start
```

6. In the channel where you want the panel, run `/ticket-panel`.

> Make sure the bot's role sits **above** the staff role in Server Settings → Roles, or it won't be able to set permissions on ticket channels.

## Commands

| Command | Who | What |
|---|---|---|
| `/ticket-panel` | Manage Server | Posts the open-a-ticket panel |
| `/close` | Owner / staff | Close the current ticket |
| `/add @user` | Owner / staff | Add someone to the ticket |
| `/remove @user` | Owner / staff | Remove someone from the ticket |


## Roadmap ideas

- Ticket categories (Support / Report a player / Tournament entry)
- SQLite storage for ticket numbers and stats
- Auto-close inactive tickets
- HTML transcripts
