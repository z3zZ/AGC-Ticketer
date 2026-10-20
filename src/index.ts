import "dotenv/config";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  OverwriteType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

// ─── Config ──────────────────────────────────────────────────────────────────
const env = (key: string, required = true): string => {
  const v = process.env[key];
  if (!v && required) throw new Error(`Missing env var: ${key}`);
  return v ?? "";
};

const config = {
  token: env("DISCORD_TOKEN"),
  guildId: env("GUILD_ID"),
  staffRoleId: env("STAFF_ROLE_ID"),
  ticketCategoryId: env("TICKET_CATEGORY_ID"),
  logChannelId: env("LOG_CHANNEL_ID", false), // optional: transcripts go here
};

const SERVER_NAME = "Apprentice Gaming Community";
const BRAND_COLOUR = 0x5865f2;

// Custom IDs for buttons / modals
const IDS = {
  open: "ticket:open",
  modal: "ticket:modal",
  reason: "ticket:reason",
  claim: "ticket:claim",
  close: "ticket:close",
  closeConfirm: "ticket:close-confirm",
  closeCancel: "ticket:close-cancel",
} as const;

// ─── Slash commands ──────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post the 'Open a ticket' panel in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a member to this ticket")
    .addUserOption((o) => o.setName("user").setDescription("Who to add").setRequired(true)),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a member from this ticket")
    .addUserOption((o) => o.setName("user").setDescription("Who to remove").setRequired(true)),
  new SlashCommandBuilder().setName("close").setDescription("Close this ticket"),
].map((c) => c.toJSON());

// ─── Helpers ─────────────────────────────────────────────────────────────────
// The ticket owner's ID is stored in the channel topic, so no database needed.
const OWNER_PREFIX = "ticket-owner:";

const getOwnerId = (channel: TextChannel): string | null =>
  channel.topic?.startsWith(OWNER_PREFIX) ? channel.topic.slice(OWNER_PREFIX.length).split(" ")[0] : null;

const isTicket = (channel: unknown): channel is TextChannel =>
  channel instanceof TextChannel && channel.parentId === config.ticketCategoryId && getOwnerId(channel) !== null;

const isStaff = (member: GuildMember | null): boolean =>
  !!member &&
  (member.roles.cache.has(config.staffRoleId) || member.permissions.has(PermissionFlagsBits.ManageChannels));

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "user";

// Build a plain-text transcript of the ticket (up to the last 500 messages).
async function buildTranscript(channel: TextChannel): Promise<AttachmentBuilder> {
  const lines: string[] = [];
  let before: string | undefined;
  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    for (const m of batch.values()) {
      const content = m.content || (m.embeds.length ? "[embed]" : "");
      const files = m.attachments.map((a) => a.url).join(" ");
      lines.push(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${content} ${files}`.trim());
    }
    before = batch.last()?.id;
  }
  return new AttachmentBuilder(Buffer.from(lines.reverse().join("\n"), "utf8"), {
    name: `${channel.name}-transcript.txt`,
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function postPanel(i: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOUR)
    .setTitle(`🎫 ${SERVER_NAME} — Support`)
    .setDescription(
      "Need help, want to report something, or have a question for the mods?\n\n" +
        "Hit **Open a ticket** below and a private channel will be created just for you and the staff team.",
    )
    .setFooter({ text: SERVER_NAME });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.open).setLabel("Open a ticket").setEmoji("📩").setStyle(ButtonStyle.Primary),
  );

  await (i.channel as TextChannel).send({ embeds: [embed], components: [row] });
  await i.reply({ content: "Panel posted ✅", flags: MessageFlags.Ephemeral });
}

async function showOpenModal(i: ButtonInteraction) {
  // Stop people opening several tickets at once
  const existing = i.guild!.channels.cache.find(
    (c) => c instanceof TextChannel && isTicket(c) && getOwnerId(c) === i.user.id,
  );
  if (existing) {
    return i.reply({ content: `You already have an open ticket: ${existing}`, flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(IDS.modal)
    .setTitle("Open a ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.reason)
          .setLabel("What do you need help with?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
  await i.showModal(modal);
}

async function createTicket(i: ModalSubmitInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = i.guild!;
  const reason = i.fields.getTextInputValue(IDS.reason);

  const channel = await guild.channels.create({
    name: `ticket-${slug(i.user.username)}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `${OWNER_PREFIX}${i.user.id} | opened ${new Date().toISOString()}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: i.user.id,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: config.staffRoleId,
        type: OverwriteType.Role,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      },
      {
        id: i.client.user.id,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOUR)
    .setTitle("Ticket opened")
    .setDescription(`Thanks ${i.user} — a member of staff will be with you shortly.`)
    .addFields({ name: "Reason", value: reason.slice(0, 1024) })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.claim).setLabel("Claim").setEmoji("🙋").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(IDS.close).setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `${i.user} <@&${config.staffRoleId}>`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [i.user.id], roles: [config.staffRoleId] },
  });

  await i.editReply(`Your ticket is open: ${channel}`);
}

async function claimTicket(i: ButtonInteraction) {
  if (!isStaff(i.member as GuildMember)) {
    return i.reply({ content: "Only staff can claim tickets.", flags: MessageFlags.Ephemeral });
  }
  const channel = i.channel as TextChannel;
  await channel.setName(`claimed-${channel.name.replace(/^(ticket|claimed)-/, "")}`).catch(() => null);
  await i.reply({ content: `🙋 ${i.user} has claimed this ticket.` });
}

async function askToClose(i: ButtonInteraction | ChatInputCommandInteraction) {
  const channel = i.channel;
  if (!isTicket(channel)) {
    return i.reply({ content: "This isn't a ticket channel.", flags: MessageFlags.Ephemeral });
  }
  const member = i.member as GuildMember;
  if (getOwnerId(channel) !== i.user.id && !isStaff(member)) {
    return i.reply({ content: "Only the ticket owner or staff can close this.", flags: MessageFlags.Ephemeral });
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.closeConfirm).setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(IDS.closeCancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await i.reply({ content: "Are you sure you want to close this ticket?", components: [row] });
}

async function closeTicket(i: ButtonInteraction) {
  const channel = i.channel;
  if (!isTicket(channel)) return;
  const member = i.member as GuildMember;
  if (getOwnerId(channel) !== i.user.id && !isStaff(member)) {
    return i.reply({ content: "Only the ticket owner or staff can close this.", flags: MessageFlags.Ephemeral });
  }

  await i.update({ content: "🔒 Closing ticket in 5 seconds…", components: [] });

  // Send transcript to log channel (and DM the owner) if configured
  try {
    const transcript = await buildTranscript(channel);
    const ownerId = getOwnerId(channel)!;
    const logEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`Ticket closed: #${channel.name}`)
      .addFields(
        { name: "Opened by", value: `<@${ownerId}>`, inline: true },
        { name: "Closed by", value: `${i.user}`, inline: true },
      )
      .setTimestamp();

    if (config.logChannelId) {
      const log = await i.guild!.channels.fetch(config.logChannelId);
      if (log?.isTextBased()) await log.send({ embeds: [logEmbed], files: [transcript] });
    }
    const owner = await i.client.users.fetch(ownerId);
    await owner
      .send({ content: `Your ticket in **${SERVER_NAME}** was closed. Here's a copy of the conversation.`, files: [transcript] })
      .catch(() => null); // DMs might be off
  } catch (err) {
    console.error("Transcript failed:", err);
  }

  setTimeout(() => channel.delete(`Ticket closed by ${i.user.tag}`).catch(console.error), 5000);
}

async function addOrRemove(i: ChatInputCommandInteraction, add: boolean) {
  const channel = i.channel;
  if (!isTicket(channel)) {
    return i.reply({ content: "Use this inside a ticket channel.", flags: MessageFlags.Ephemeral });
  }
  if (!isStaff(i.member as GuildMember) && getOwnerId(channel) !== i.user.id) {
    return i.reply({ content: "Only staff or the ticket owner can do that.", flags: MessageFlags.Ephemeral });
  }
  const user = i.options.getUser("user", true);
  if (add) {
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await i.reply(`➕ Added ${user} to the ticket.`);
  } else {
    if (user.id === getOwnerId(channel)) {
      return i.reply({ content: "You can't remove the ticket owner.", flags: MessageFlags.Ephemeral });
    }
    await channel.permissionOverwrites.delete(user.id);
    await i.reply(`➖ Removed ${user} from the ticket.`);
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  // Guild commands update instantly (global ones can take up to an hour)
  const guild = await c.guilds.fetch(config.guildId);
  await guild.commands.set(commands);
  console.log(`✅ Logged in as ${c.user.tag} — commands registered in ${guild.name}`);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      switch (i.commandName) {
        case "ticket-panel":
          return await postPanel(i);
        case "add":
          return await addOrRemove(i, true);
        case "remove":
          return await addOrRemove(i, false);
        case "close":
          return await askToClose(i);
      }
    } else if (i.isButton()) {
      switch (i.customId) {
        case IDS.open:
          return await showOpenModal(i);
        case IDS.claim:
          return await claimTicket(i);
        case IDS.close:
          return await askToClose(i);
        case IDS.closeConfirm:
          return await closeTicket(i);
        case IDS.closeCancel:
          return await i.update({ content: "Close cancelled.", components: [] });
      }
    } else if (i.isModalSubmit() && i.customId === IDS.modal) {
      return await createTicket(i);
    }
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) {
      const msg = { content: "Something went wrong — please try again or ping a mod.", flags: MessageFlags.Ephemeral } as const;
      if (i.replied || i.deferred) await i.followUp(msg).catch(() => null);
      else await i.reply(msg).catch(() => null);
    }
  }
});

client.login(config.token);
