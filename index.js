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
  ButtonStyle
} = require("discord.js");

// 🔎 debug check (remove later)
console.log("TOKEN:", process.env.TOKEN ? "FOUND" : "MISSING");
console.log("CLIENT_ID:", process.env.CLIENT_ID ? "FOUND" : "MISSING");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= STORAGE ================= */

const activeGiveaways = new Map();
// messageId => {
//   forcedWinnerId: string | null
// }

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

function getLuckRolesText() {
  if (luckRoles.size === 0) {
    return "No luck roles configured.";
  }

  const text = [...luckRoles.entries()]
    .map(([roleId, multiplier]) => `<@&${roleId}> has x${multiplier}`)
    .join("\n");

  if (text.length > 1024) {
    return text.slice(0, 1000) + "\n...more luck roles";
  }

  return text;
}

async function pickWeightedWinner(validUsers, guild) {
  const entries = [];

  for (const user of validUsers.values()) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) continue;

    let weight = 1;

    // Luck does NOT stack.
    // If the user has multiple luck roles, only the highest multiplier is used.
    for (const [roleId, multiplier] of luckRoles.entries()) {
      if (member.roles.cache.has(roleId)) {
        weight = Math.max(weight, multiplier);
      }
    }

    entries.push({
      user,
      weight
    });
  }

  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return entries[Math.floor(Math.random() * entries.length)].user;
  }

  let random = Math.random() * totalWeight;

  for (const entry of entries) {
    random -= entry.weight;
    if (random <= 0) return entry.user;
  }

  return entries[entries.length - 1].user;
}

/* ================= SLASH COMMAND ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // REQUIRED FIRST
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
    )
    .addIntegerOption(o =>
      o.setName("hours")
        .setDescription("Hours")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("f")
        .setDescription("F")
        .setRequired(true)
    )

    // OPTIONAL AFTER
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
    )
].map(c => c.toJSON());

/* ================= REGISTER ================= */

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Slash command registered");
})();

/* ================= BOT READY ================= */

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ================= BUTTON LOGIC ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "show_participants") return;

  const fetched = await interaction.message.fetch();
  const reaction = fetched.reactions.cache.get("🎉");

  if (!reaction) {
    return interaction.reply({
      content: "👥 **Participants (0)**\nNo participants yet.",
      ephemeral: true
    });
  }

  const users = await reaction.users.fetch();
  const valid = users.filter(u => !u.bot);

  const participantList = valid
    .map(u => `<@${u.id}>`)
    .slice(0, 50)
    .join("\n");

  await interaction.reply({
    content:
      `👥 **Participants (${valid.size})**\n` +
      `${participantList || "No participants yet."}` +
      `${valid.size > 50 ? `\n...and ${valid.size - 50} more` : ""}`,
    ephemeral: true
  });
});

/* ================= GIVEAWAY LOGIC ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* ================= WC COMMAND ================= */

  if (interaction.commandName === "wc") {
    const gwMessageId = interaction.options.getString("gw_message_id");
    const flnInput = interaction.options.getString("fln");
    const fln = extractUserId(flnInput);

    const giveaway = activeGiveaways.get(gwMessageId);

    if (!giveaway) {
      return interaction.reply({
        content: "❌ Giveaway not found or not currently running.",
        ephemeral: true
      });
    }

    if (fln === "0") {
      giveaway.forcedWinnerId = null;
      activeGiveaways.set(gwMessageId, giveaway);

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

    giveaway.forcedWinnerId = member.id;
    activeGiveaways.set(gwMessageId, giveaway);

    return interaction.reply({
      content: `✅ FLN changed to ${member}.`,
      ephemeral: true
    });
  }

  /* ================= LUCK SETUP COMMAND ================= */

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

    return interaction.reply({
      content: `✅ ${role} luck multiplier set to x${multiplier}.`,
      ephemeral: true
    });
  }

  /* ================= CREATE GIVEAWAY COMMAND ================= */

  if (interaction.commandName !== "create_giveaway") return;

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

  const durationMs =
    (hours * 3600 + minutes * 60 + seconds) * 1000;

  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${title}`)
    .setDescription(description)
    .addFields(
      { name: "🏆 Prize", value: prize, inline: true },
      { name: "👥 Winners", value: `${winners}`, inline: true },
      {
        name: "⏰ Ends",
        value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`
      },
      {
        name: "🍀 Luck Roles",
        value: getLuckRolesText()
      }
    )
    .setColor("Gold")
    .setFooter({ text: "React with 🎉 to enter!" });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("show_participants")
        .setLabel("Show Participants")
        .setStyle(ButtonStyle.Secondary)
    );

  const msg = await channel.send({
    content: pingRole ? `${pingRole}` : null,
    embeds: [embed],
    components: [row]
  });

  activeGiveaways.set(msg.id, {
    forcedWinnerId: fake !== "0" ? extractUserId(fake) : null
  });

  await msg.react("🎉");

  await interaction.reply({
    content: `✅ Giveaway created\nGW Message ID: \`${msg.id}\``,
    ephemeral: true
  });

  setTimeout(async () => {
    const fetched = await msg.fetch();
    const reaction = fetched.reactions.cache.get("🎉");

    if (!reaction) {
      channel.send("❌ No valid participants");
      activeGiveaways.delete(msg.id);
      return;
    }

    const users = await reaction.users.fetch();
    const valid = users.filter(u => !u.bot);

    const giveaway = activeGiveaways.get(msg.id);

    let winner;

    if (giveaway && giveaway.forcedWinnerId) {
      winner = await interaction.guild.members.fetch(giveaway.forcedWinnerId).catch(() => null);
    } else {
      if (luckRoles.size > 0) {
        winner = await pickWeightedWinner(valid, interaction.guild);
      } else {
        winner = valid.random();
      }
    }

    channel.send(
      winner
        ? `🎊 **Winner:** ${winner}`
        : "❌ No valid participants"
    );

    activeGiveaways.delete(msg.id);
  }, durationMs);
});

/* ================= LOGIN ================= */

client.login(process.env.TOKEN);
