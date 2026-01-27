require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

/* =========================
   MEMORY
========================= */
let lastGiveaway = null;

/* =========================
   COMMANDS
========================= */
const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway (Admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Giveaway channel").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Description").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption(o => o.setName("winners").setDescription("Winner count").setRequired(true))
    .addIntegerOption(o => o.setName("hours").setDescription("Hours"))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes"))
    .addIntegerOption(o => o.setName("seconds").setDescription("Seconds"))
    .addRoleOption(o => o.setName("role").setDescription("Required role"))
    .addRoleOption(o => o.setName("ping_role").setDescription("Ping role"))
    .addStringOption(o => o.setName("f").setDescription("F (User ID or 0)")),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll last giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

/* =========================
   REGISTER
========================= */
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Commands registered");
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

  /* ===== BUTTON ===== */
  if (interaction.isButton() && interaction.customId === "enter_giveaway") {
    if (!lastGiveaway || lastGiveaway.ended)
      return interaction.reply({ content: "❌ Giveaway ended.", ephemeral: true });

    if (
      lastGiveaway.requiredRoleId &&
      !interaction.member.roles.cache.has(lastGiveaway.requiredRoleId)
    ) {
      return interaction.reply({ content: "❌ Missing required role.", ephemeral: true });
    }

    if (lastGiveaway.entries.has(interaction.user.id)) {
      return interaction.reply({ content: "⚠️ You already joined.", ephemeral: true });
    }

    lastGiveaway.entries.add(interaction.user.id);

    /* UPDATE PARTICIPANT COUNT */
    const channel = await client.channels.fetch(lastGiveaway.channelId);
    const msg = await channel.messages.fetch(lastGiveaway.messageId);

    const embed = EmbedBuilder.from(msg.embeds[0]);
    embed.setFields({
      name: "👥 Participants",
      value: `${lastGiveaway.entries.size}`,
      inline: true,
    });

    await msg.edit({ embeds: [embed] });

    return interaction.reply({
      content: "🎉 You entered the giveaway!",
      ephemeral: true,
    });
  }

  if (!interaction.isChatInputCommand()) return;

  /* ===== CREATE ===== */
  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winnersCount = interaction.options.getInteger("winners");

    const h = interaction.options.getInteger("hours") || 0;
    const m = interaction.options.getInteger("minutes") || 0;
    const s = interaction.options.getInteger("seconds") || 0;

    const role = interaction.options.getRole("role");
    const pingRole = interaction.options.getRole("ping_role");
    const fakeWinner = interaction.options.getString("f") || "0";

    const duration = (h * 3600 + m * 60 + s) * 1000;
    if (duration <= 0)
      return interaction.reply({ content: "❌ Invalid duration.", ephemeral: true });

    const endTime = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setColor(0xffc300)
      .setDescription(
        `**${description}**\n\n🏆 **Prize:** ${prize}\n👥 **Winners:** ${winnersCount}\n⏰ **Ends:** <t:${Math.floor(endTime / 1000)}:R>\n${role ? `🔒 **Role Required:** ${role}` : ""}`
      )
      .addFields({
        name: "👥 Participants",
        value: "0",
        inline: true,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("enter_giveaway")
        .setLabel("🎉 Enter Giveaway")
        .setStyle(ButtonStyle.Success)
    );

    if (pingRole) await channel.send({ content: `${pingRole}` });

    const msg = await channel.send({ embeds: [embed], components: [row] });

    lastGiveaway = {
      channelId: channel.id,
      messageId: msg.id,
      winnersCount,
      requiredRoleId: role?.id || null,
      fakeWinner,
      entries: new Set(),
      ended: false,
    };

    await interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });

    setTimeout(async () => {
      lastGiveaway.ended = true;

      let pool = Array.from(lastGiveaway.entries);
      let winners = [];

      if (fakeWinner !== "0") {
        winners = [`<@${fakeWinner}>`];
      } else {
        while (winners.length < winnersCount && pool.length) {
          winners.push(`<@${pool.splice(Math.floor(Math.random() * pool.length), 1)[0]}>`);
        }
      }

      const endEmbed = EmbedBuilder.from(embed)
        .setColor(0x2ecc71)
        .addFields({
          name: "👥 Total Participants",
          value: `${lastGiveaway.entries.size}`,
          inline: true,
        })
        .setDescription(
          embed.data.description +
          `\n\n🏆 **Winner(s):** ${winners.join(", ")}`
        );

      await msg.edit({ embeds: [endEmbed], components: [] });
      await channel.send(`🎉 **GIVEAWAY ENDED!** Congratulations ${winners.join(", ")}`);
    }, duration);
  }

  /* ===== REROLL ===== */
  if (interaction.commandName === "reroll") {
    if (!lastGiveaway || !lastGiveaway.ended)
      return interaction.reply({ content: "❌ No giveaway to reroll.", ephemeral: true });

    let pool = Array.from(lastGiveaway.entries);
    let winners = [];

    while (winners.length < lastGiveaway.winnersCount && pool.length) {
      winners.push(`<@${pool.splice(Math.floor(Math.random() * pool.length), 1)[0]}>`);
    }

    await interaction.reply({
      content: `🔄 **New Winner(s):** ${winners.join(", ")}`,
    });
  }
});

/* =========================
   LOGIN
========================= */
client.login(process.env.TOKEN);
