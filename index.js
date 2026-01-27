require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
} = require("discord.js");

/* =========================
   CLIENT
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

/* =========================
   MEMORY STORAGE
========================= */
let lastGiveaway = null;

/* =========================
   SLASH COMMANDS
========================= */
const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway (Admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // REQUIRED OPTIONS FIRST
    .addChannelOption(o =>
      o.setName("channel").setDescription("Giveaway channel").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title").setDescription("Giveaway title").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("description").setDescription("Giveaway description").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("prize").setDescription("Prize").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("winners").setDescription("Number of winners").setRequired(true)
    )

    // OPTIONAL
    .addIntegerOption(o =>
      o.setName("hours").setDescription("Hours").setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Minutes").setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName("seconds").setDescription("Seconds").setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Required role").setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("ping_role").setDescription("Ping role").setRequired(false)
    )
    .addStringOption(o =>
      o.setName("f").setDescription("F (User ID or 0)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll last giveaway (Admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

/* =========================
   REGISTER COMMANDS
========================= */
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Slash commands registered");
})();

/* =========================
   READY
========================= */
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* =========================
   INTERACTIONS
========================= */
client.on("interactionCreate", async interaction => {

  /* ===== BUTTON: ENTER GIVEAWAY ===== */
  if (interaction.isButton()) {
    if (interaction.customId !== "enter_giveaway") return;

    if (!lastGiveaway || lastGiveaway.ended) {
      return interaction.reply({
        content: "❌ This giveaway has ended.",
        ephemeral: true,
      });
    }

    const member = interaction.member;

    if (
      lastGiveaway.requiredRoleId &&
      !member.roles.cache.has(lastGiveaway.requiredRoleId)
    ) {
      return interaction.reply({
        content: "❌ You do not have the required role to enter this giveaway.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "🎉 You have successfully entered the giveaway!",
      ephemeral: true,
    });
  }

  /* ===== SLASH COMMANDS ===== */
  if (!interaction.isChatInputCommand()) return;

  /* ===== CREATE GIVEAWAY ===== */
  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winnersCount = interaction.options.getInteger("winners");

    const hours = interaction.options.getInteger("hours") || 0;
    const minutes = interaction.options.getInteger("minutes") || 0;
    const seconds = interaction.options.getInteger("seconds") || 0;

    const requiredRole = interaction.options.getRole("role");
    const pingRole = interaction.options.getRole("ping_role");
    const fakeWinner = interaction.options.getString("f") || "0";

    const durationMs =
      (hours * 3600 + minutes * 60 + seconds) * 1000;

    if (durationMs <= 0) {
      return interaction.reply({
        content: "❌ Invalid duration.",
        ephemeral: true,
      });
    }

    const endTime = Date.now() + durationMs;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setColor(0xffc300)
      .setDescription(
        `**${description}**\n\n` +
        `🏆 **Prize:** ${prize}\n` +
        `👥 **Winners:** ${winnersCount}\n` +
        `⏰ **Ends:** <t:${Math.floor(endTime / 1000)}:R>\n` +
        `${requiredRole ? `🔒 **Required Role:** ${requiredRole}\n` : ""}\n` +
        `🎉 Click the button below to enter!`
      )
      .setFooter({ text: "Good luck!" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("enter_giveaway")
        .setLabel("🎉 Enter Giveaway")
        .setStyle(ButtonStyle.Success)
    );

    if (pingRole) {
      await channel.send({ content: `${pingRole}` });
    }

    const message = await channel.send({
      embeds: [embed],
      components: [row],
    });

    lastGiveaway = {
      channelId: channel.id,
      messageId: message.id,
      winnersCount,
      requiredRoleId: requiredRole?.id || null,
      fakeWinner,
      ended: false,
    };

    await interaction.reply({
      content: "✅ Giveaway created!",
      ephemeral: true,
    });

    setTimeout(async () => {
      if (!lastGiveaway || lastGiveaway.ended) return;
      lastGiveaway.ended = true;

      const msg = await channel.messages.fetch(message.id);
      const users = new Set();

      msg.reactions?.cache?.forEach(r =>
        r.users.cache.forEach(u => !u.bot && users.add(u.id))
      );

      let entries = Array.from(users);

      if (requiredRole) {
        entries = entries.filter(id =>
          channel.guild.members.cache.get(id)?.roles.cache.has(requiredRole.id)
        );
      }

      let winners = [];

      if (fakeWinner !== "0") {
        winners.push(`<@${fakeWinner}>`);
      } else {
        while (winners.length < winnersCount && entries.length > 0) {
          const pick = entries.splice(
            Math.floor(Math.random() * entries.length),
            1
          )[0];
          winners.push(`<@${pick}>`);
        }
      }

      const endEmbed = EmbedBuilder.from(embed)
        .setColor(0x2ecc71)
        .setDescription(
          embed.data.description +
          `\n\n🏆 **Winner(s):** ${winners.join(", ")}`
        );

      await msg.edit({ embeds: [endEmbed], components: [] });
      await channel.send(`🎉 **Giveaway Ended!** Congrats ${winners.join(", ")}`);
    }, durationMs);
  }

  /* ===== REROLL ===== */
  if (interaction.commandName === "reroll") {
    if (!lastGiveaway || !lastGiveaway.ended) {
      return interaction.reply({
        content: "❌ No finished giveaway to reroll.",
        ephemeral: true,
      });
    }

    const channel = await client.channels.fetch(lastGiveaway.channelId);
    const msg = await channel.messages.fetch(lastGiveaway.messageId);

    const users = new Set();
    msg.reactions?.cache?.forEach(r =>
      r.users.cache.forEach(u => !u.bot && users.add(u.id))
    );

    let entries = Array.from(users);
    let winners = [];

    while (winners.length < lastGiveaway.winnersCount && entries.length > 0) {
      const pick = entries.splice(
        Math.floor(Math.random() * entries.length),
        1
      )[0];
      winners.push(`<@${pick}>`);
    }

    await channel.send(`🔄 **Rerolled Winner(s):** ${winners.join(", ")}`);
    await interaction.reply({ content: "✅ Rerolled!", ephemeral: true });
  }
});

/* =========================
   LOGIN
========================= */
client.login(process.env.TOKEN);
