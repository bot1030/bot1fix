require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require("discord.js");

// 🔎 debug check (remove later)
console.log("TOKEN:", process.env.TOKEN ? "FOUND" : "MISSING");
console.log("CLIENT_ID:", process.env.CLIENT_ID ? "FOUND" : "MISSING");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= STORAGE ================= */

const activeGiveaways = new Map();
// messageId => giveaway data

const giveawayHistory = new Map();
// messageId => ended giveaway data

const luckRoles = new Map();
// roleId => multiplier

/* ================= HELPER FUNCTIONS ================= */

function extractUserId(input) {
  if (!input) return null;

  return input
    .replace("<@", "")
    .replace("!", "")
    .replace(">", "")
    .trim();
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function getLuckRolesText() {
  if (luckRoles.size === 0) {
    return "No luck roles configured.";
  }

  const text = [...luckRoles.entries()]
    .map(([roleId, multiplier]) => `<@&${roleId}> has \`x${multiplier}\``)
    .join("\n");

  if (text.length > 1024) {
    return text.slice(0, 1000) + "\n...more luck roles";
  }

  return text;
}

function getHighestLuckMultiplier(member) {
  let weight = 1;

  if (!member?.roles?.cache) return weight;

  // Luck does NOT stack.
  // If user has multiple luck roles, only the highest multiplier is used.
  for (const [roleId, multiplier] of luckRoles.entries()) {
    if (member.roles.cache.has(roleId)) {
      weight = Math.max(weight, multiplier);
    }
  }

  return weight;
}

function buildGiveawayEmbed(gw, status = "running", winnersText = null) {
  const isEnded = status === "ended";

  const embed = new EmbedBuilder()
    .setTitle(isEnded ? `🏁 ${gw.title}` : `🎉 ${gw.title}`)
    .setDescription(
      isEnded
        ? `${gw.description}\n\n**Status:** Giveaway ended.`
        : `${gw.description}\n\nClick **Join Giveaway** to enter.`
    )
    .addFields(
      { name: "🏆 Prize", value: gw.prize, inline: true },
      { name: "🎯 Winners", value: `${gw.winners}`, inline: true },
      { name: "👥 Joined", value: `${gw.participants.size}`, inline: true },
      {
        name: isEnded ? "⏰ Ended" : "⏰ Ends",
        value: isEnded
          ? `<t:${Math.floor(Date.now() / 1000)}:R>`
          : `<t:${Math.floor(gw.endAt / 1000)}:R>\n<t:${Math.floor(gw.endAt / 1000)}:F>`,
        inline: false
      },
      {
        name: "🔒 Required Role",
        value: gw.requiredRoleId ? `<@&${gw.requiredRoleId}>` : "None",
        inline: true
      },
      {
        name: "🍀 Luck Roles",
        value: getLuckRolesText(),
        inline: false
      }
    )
    .setColor(isEnded ? "DarkButNotBlack" : "Gold")
    .setFooter({
      text: isEnded
        ? "Giveaway closed"
        : "Button giveaway • Luck roles do not stack"
    })
    .setTimestamp();

  if (winnersText) {
    embed.addFields({
      name: "🎊 Winner(s)",
      value: winnersText,
      inline: false
    });
  }

  return embed;
}

function buildGiveawayButtons(ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("gw_join")
      .setLabel(ended ? "Giveaway Ended" : "Join Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),

    new ButtonBuilder()
      .setCustomId("gw_participants")
      .setLabel("Show Participants")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false)
  );
}

async function pickMultipleWeightedWinners(gw, guild, amount, excludeIds = new Set()) {
  const entries = [];

  for (const [userId, data] of gw.participants.entries()) {
    if (excludeIds.has(userId)) continue;

    let weight = data.weightAtJoin || 1;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      weight = getHighestLuckMultiplier(member);
    }

    if (!Number.isFinite(weight) || weight <= 0) weight = 1;

    entries.push({
      userId,
      weight
    });
  }

  const winners = [];

  while (winners.length < amount && entries.length > 0) {
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      const randomIndex = Math.floor(Math.random() * entries.length);
      const picked = entries.splice(randomIndex, 1)[0];
      winners.push(picked.userId);
      continue;
    }

    let random = Math.random() * totalWeight;
    let pickedIndex = 0;

    for (let i = 0; i < entries.length; i++) {
      random -= entries[i].weight;

      if (random <= 0) {
        pickedIndex = i;
        break;
      }
    }

    const picked = entries.splice(pickedIndex, 1)[0];
    winners.push(picked.userId);
  }

  return winners;
}

async function updateActiveGiveawayEmbeds() {
  for (const gw of activeGiveaways.values()) {
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    if (!channel) continue;

    const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (!msg) continue;

    await msg.edit({
      embeds: [buildGiveawayEmbed(gw, "running")],
      components: [buildGiveawayButtons(false)]
    }).catch(() => null);
  }
}

async function finishGiveaway(messageId) {
  const gw = activeGiveaways.get(messageId);

  if (!gw || gw.ended) return null;

  gw.ended = true;

  if (gw.timer) {
    clearTimeout(gw.timer);
  }

  const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
  const channel = await client.channels.fetch(gw.channelId).catch(() => null);

  if (!guild || !channel) {
    activeGiveaways.delete(messageId);
    return null;
  }

  const winnerIds = [];
  const excludeIds = new Set();

  if (gw.forcedWinnerId) {
    const forcedMember = await guild.members.fetch(gw.forcedWinnerId).catch(() => null);

    if (forcedMember) {
      winnerIds.push(forcedMember.id);
      excludeIds.add(forcedMember.id);
    }
  }

  const neededWinners = Math.max(1, gw.winners) - winnerIds.length;

  if (neededWinners > 0) {
    const randomWinners = await pickMultipleWeightedWinners(gw, guild, neededWinners, excludeIds);

    for (const id of randomWinners) {
      winnerIds.push(id);
      excludeIds.add(id);
    }
  }

  const winnersText = winnerIds.length > 0
    ? winnerIds.map(id => `<@${id}>`).join(", ")
    : "No valid participants.";

  const msg = await channel.messages.fetch(gw.messageId).catch(() => null);

  if (msg) {
    await msg.edit({
      embeds: [buildGiveawayEmbed(gw, "ended", winnersText)],
      components: [buildGiveawayButtons(true)]
    }).catch(() => null);
  }

  await channel.send(
    winnerIds.length > 0
      ? `🎊 **Winner(s):** ${winnersText}`
      : "❌ No valid participants."
  );

  gw.lastWinnerIds = winnerIds;
  gw.endedAt = Date.now();

  giveawayHistory.set(messageId, gw);
  activeGiveaways.delete(messageId);

  return {
    winnerIds,
    winnersText
  };
}

/* ================= SLASH COMMANDS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Giveaway channel")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Giveaway title")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("description")
        .setDescription("Giveaway description")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("prize")
        .setDescription("Prize")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("winners")
        .setDescription("Number of winners")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(o =>
      o.setName("hours")
        .setDescription("Hours")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setRequired(true)
        .setMinValue(0)
    )
    .addStringOption(o =>
      o.setName("f")
        .setDescription("F")
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("required_role")
        .setDescription("Required role")
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("ping_role")
        .setDescription("Ping a role")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("wc")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("gw_message_id")
        .setDescription(".")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("fln")
        .setDescription(".")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lucksetup")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(".")
        .setRequired(true)
    )
    .addNumberOption(o =>
      o.setName("multiplier")
        .setDescription(".")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("gw_message_id")
        .setDescription(".")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("gw_message_id")
        .setDescription(".")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription(".")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(".")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
].map(c => c.toJSON());

/* ================= REGISTER ================= */

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered");
})();

/* ================= BOT READY ================= */

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ================= BUTTON LOGIC ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  /* ================= JOIN BUTTON ================= */

  if (interaction.customId === "gw_join") {
    const gw = activeGiveaways.get(interaction.message.id);

    if (!gw) {
      return interaction.reply({
        content: "❌ This giveaway is not running anymore.",
        ephemeral: true
      });
    }

    const member = interaction.member;

    if (gw.requiredRoleId && !member.roles.cache.has(gw.requiredRoleId)) {
      return interaction.reply({
        content: `❌ You need <@&${gw.requiredRoleId}> to join this giveaway.`,
        ephemeral: true
      });
    }

    if (gw.participants.has(interaction.user.id)) {
      gw.participants.delete(interaction.user.id);

      await interaction.reply({
        content: "✅ You left the giveaway.",
        ephemeral: true
      });
    } else {
      const weightAtJoin = getHighestLuckMultiplier(member);

      gw.participants.set(interaction.user.id, {
        joinedAt: Date.now(),
        weightAtJoin
      });

      await interaction.reply({
        content: `🎉 You joined the giveaway! Your luck: \`x${weightAtJoin}\``,
        ephemeral: true
      });
    }

    await interaction.message.edit({
      embeds: [buildGiveawayEmbed(gw, "running")],
      components: [buildGiveawayButtons(false)]
    }).catch(() => null);

    return;
  }

  /* ================= SHOW PARTICIPANTS BUTTON ================= */

  if (interaction.customId === "gw_participants") {
    const gw =
      activeGiveaways.get(interaction.message.id) ||
      giveawayHistory.get(interaction.message.id);

    if (!gw) {
      return interaction.reply({
        content: "❌ Giveaway data not found.",
        ephemeral: true
      });
    }

    const participantIds = [...gw.participants.keys()];

    const participantList = participantIds
      .slice(0, 50)
      .map(id => `<@${id}>`)
      .join("\n");

    return interaction.reply({
      content:
        `👥 **Participants (${participantIds.length})**\n` +
        `${participantList || "No participants yet."}` +
        `${participantIds.length > 50 ? `\n...and ${participantIds.length - 50} more` : ""}`,
      ephemeral: true
    });
  }
});

/* ================= COMMAND LOGIC ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "❌ Admin only.",
      ephemeral: true
    });
  }

  /* ================= CREATE GIVEAWAY ================= */

  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winners = interaction.options.getInteger("winners");
    const hours = interaction.options.getInteger("hours");
    const minutes = interaction.options.getInteger("minutes");
    const seconds = interaction.options.getInteger("seconds");
    const fake = interaction.options.getString("f");
    const requiredRole = interaction.options.getRole("required_role");
    const pingRole = interaction.options.getRole("ping_role");

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: "❌ Invalid giveaway channel.",
        ephemeral: true
      });
    }

    const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

    if (durationMs <= 0) {
      return interaction.reply({
        content: "❌ Duration must be at least 1 second.",
        ephemeral: true
      });
    }

    const gw = {
      messageId: null,
      guildId: interaction.guild.id,
      channelId: channel.id,
      title,
      description,
      prize,
      winners,
      endAt: Date.now() + durationMs,
      requiredRoleId: requiredRole ? requiredRole.id : null,
      pingRoleId: pingRole ? pingRole.id : null,
      forcedWinnerId: fake !== "0" ? extractUserId(fake) : null,
      participants: new Map(),
      timer: null,
      ended: false,
      lastWinnerIds: []
    };

    const msg = await channel.send({
      content: pingRole ? `${pingRole}` : null,
      embeds: [buildGiveawayEmbed(gw, "running")],
      components: [buildGiveawayButtons(false)]
    });

    gw.messageId = msg.id;

    gw.timer = setTimeout(() => {
      finishGiveaway(msg.id);
    }, durationMs);

    activeGiveaways.set(msg.id, gw);

    return interaction.reply({
      content: `✅ Giveaway created.\nGW Message ID: \`${msg.id}\``,
      ephemeral: true
    });
  }

  /* ================= WC COMMAND ================= */

  if (interaction.commandName === "wc") {
    const gwMessageId = interaction.options.getString("gw_message_id");
    const flnInput = interaction.options.getString("fln");
    const fln = extractUserId(flnInput);

    const gw = activeGiveaways.get(gwMessageId);

    if (!gw) {
      return interaction.reply({
        content: "❌ Giveaway not found or not currently running.",
        ephemeral: true
      });
    }

    if (fln === "0") {
      gw.forcedWinnerId = null;

      return interaction.reply({
        content: "✅ FLN removed for this giveaway.",
        ephemeral: true
      });
    }

    const member = await interaction.guild.members.fetch(fln).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ Invalid FLN user ID or mention.",
        ephemeral: true
      });
    }

    gw.forcedWinnerId = member.id;

    return interaction.reply({
      content: `✅ FLN changed to ${member}.`,
      ephemeral: true
    });
  }

  /* ================= LUCK SETUP ================= */

  if (interaction.commandName === "lucksetup") {
    const role = interaction.options.getRole("role");
    const multiplier = interaction.options.getNumber("multiplier");

    if (multiplier < 1 || multiplier > 10) {
      return interaction.reply({
        content: "❌ Multiplier must be between 1 and 10.",
        ephemeral: true
      });
    }

    luckRoles.set(role.id, multiplier);

    await updateActiveGiveawayEmbeds();

    return interaction.reply({
      content: `✅ ${role} luck multiplier set to \`x${multiplier}\`.\nActive giveaway embeds updated.`,
      ephemeral: true
    });
  }

  /* ================= END GIVEAWAY ================= */

  if (interaction.commandName === "end") {
    const gwMessageId = interaction.options.getString("gw_message_id");

    if (!activeGiveaways.has(gwMessageId)) {
      return interaction.reply({
        content: "❌ Giveaway not found or already ended.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const result = await finishGiveaway(gwMessageId);

    if (!result) {
      return interaction.editReply("❌ Could not end giveaway.");
    }

    return interaction.editReply("✅ Giveaway ended.");
  }

  /* ================= REROLL GIVEAWAY ================= */

  if (interaction.commandName === "reroll") {
    const gwMessageId = interaction.options.getString("gw_message_id");
    const gw = giveawayHistory.get(gwMessageId);

    if (!gw) {
      return interaction.reply({
        content: "❌ Ended giveaway not found. You can only reroll ended giveaways.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);

    if (!guild || !channel) {
      return interaction.editReply("❌ Could not access giveaway guild or channel.");
    }

    let excludeIds = new Set(gw.lastWinnerIds || []);

    let newWinnerIds = await pickMultipleWeightedWinners(
      gw,
      guild,
      Math.max(1, gw.winners),
      excludeIds
    );

    // If there are not enough people to exclude old winners, allow previous winners again.
    if (newWinnerIds.length === 0) {
      newWinnerIds = await pickMultipleWeightedWinners(
        gw,
        guild,
        Math.max(1, gw.winners),
        new Set()
      );
    }

    if (newWinnerIds.length === 0) {
      return interaction.editReply("❌ No valid participants to reroll.");
    }

    gw.lastWinnerIds = newWinnerIds;
    giveawayHistory.set(gwMessageId, gw);

    const winnersText = newWinnerIds.map(id => `<@${id}>`).join(", ");

    const msg = await channel.messages.fetch(gw.messageId).catch(() => null);

    if (msg) {
      await msg.edit({
        embeds: [buildGiveawayEmbed(gw, "ended", winnersText)],
        components: [buildGiveawayButtons(true)]
      }).catch(() => null);
    }

    await channel.send(`🔁 **Rerolled Winner(s):** ${winnersText}`);

    return interaction.editReply("✅ Giveaway rerolled.");
  }

  /* ================= NUKE MESSAGES ================= */

  if (interaction.commandName === "nuke") {
    const amount = interaction.options.getInteger("amount");
    const targetChannel = interaction.options.getChannel("channel") || interaction.channel;

    if (!targetChannel || !targetChannel.isTextBased() || !targetChannel.bulkDelete) {
      return interaction.reply({
        content: "❌ Invalid channel for message deletion.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const deleted = await targetChannel.bulkDelete(amount, true).catch(() => null);

    if (!deleted) {
      return interaction.editReply("❌ Could not delete messages. Check bot permissions.");
    }

    return interaction.editReply(`✅ Deleted ${deleted.size} message(s).`);
  }
});

/* ================= LOGIN ================= */

client.login(process.env.TOKEN);
