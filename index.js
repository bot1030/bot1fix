require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message]
});

const giveaways = new Map();

/* ---------------- COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway")
    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Description").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption(o => o.setName("winners").setDescription("Winner count").setRequired(true))
    .addIntegerOption(o => o.setName("days").setDescription("Days (0 or blank)"))
    .addIntegerOption(o => o.setName("hours").setDescription("Hours (0 or blank)"))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes (0 or blank)"))
    .addRoleOption(o => o.setName("role1").setDescription("Required role 1"))
    .addRoleOption(o => o.setName("role2").setDescription("Required role 2"))
    .addRoleOption(o => o.setName("role3").setDescription("Required role 3"))
    .addRoleOption(o => o.setName("pingrole").setDescription("Ping role"))
    .addStringOption(o => o.setName("fln").setDescription("0 or number")),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Force end giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete messages")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ Bot online");
});

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

    /* ---- GIVEAWAY ---- */
    if (interaction.commandName === "giveaway") {
      const title = interaction.options.getString("title");
      const desc = interaction.options.getString("description");
      const prize = interaction.options.getString("prize");
      const winners = interaction.options.getInteger("winners");

      const days = interaction.options.getInteger("days") || 0;
      const hours = interaction.options.getInteger("hours") || 0;
      const minutes = interaction.options.getInteger("minutes") || 0;

      const durationMs = (((days * 24 + hours) * 60) + minutes) * 60 * 1000;
      if (durationMs <= 0)
        return interaction.reply({ content: "❌ Invalid duration", ephemeral: true });

      const endAt = Date.now() + durationMs;

      const reqRoles = [
        interaction.options.getRole("role1"),
        interaction.options.getRole("role2"),
        interaction.options.getRole("role3")
      ].filter(Boolean);

      const pingRole = interaction.options.getRole("pingrole");
      const flnRaw = interaction.options.getString("fln") || "0";
      const fln = flnRaw === "0" ? null : flnRaw;

      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${title}`)
        .setColor(0x00ffff)
        .setDescription(
          `${desc}\n\n` +
          `🏆 **Prize:** ${prize}\n` +
          `👥 **Winners:** ${winners}\n` +
          `🔒 **Requirements:** ${reqRoles.length ? reqRoles.map(r => `<@&${r.id}>`).join(", ") : "None"}\n\n` +
          `👤 **Participants:** 0\n\n` +
          `⏰ Ends <t:${Math.floor(endAt / 1000)}:R>`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("join_gw")
          .setLabel("🎉 Join Giveaway")
          .setStyle(ButtonStyle.Success)
      );

      const msg = await interaction.channel.send({
        content: pingRole ? `<@&${pingRole.id}>` : null,
        embeds: [embed],
        components: [row]
      });

      giveaways.set(msg.id, {
        channelId: msg.channel.id,
        prize,
        endAt,
        users: new Set(),
        reqRoles,
        fln,
        ended: false,
        baseEmbed: embed
      });

      interaction.reply({ content: "✅ Giveaway created", ephemeral: true });
    }

    /* ---- REROLL (PUBLIC) ---- */
    if (interaction.commandName === "reroll") {
      const g = giveaways.get(interaction.options.getString("messageid"));
      if (!g) return interaction.reply({ content: "❌ Giveaway not found", ephemeral: true });

      const pool = [...g.users];
      if (!pool.length)
        return interaction.reply({ content: "❌ No participants", ephemeral: true });

      const winner = g.fln ?? pool[Math.floor(Math.random() * pool.length)];

      await interaction.channel.send(
        `🔁 ${interaction.user} **rerolled the giveaway winner!**\n🎉 Congratulations <@${winner}>! You won **${g.prize}**`
      );

      interaction.reply({ content: "Rerolled", ephemeral: true });
    }

    /* ---- FORCE END (PUBLIC) ---- */
    if (interaction.commandName === "end") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g || g.ended)
        return interaction.reply({ content: "❌ Invalid giveaway", ephemeral: true });

      await endGiveaway(id, g);
      await interaction.channel.send(`🛑 ${interaction.user} **has force-ended this giveaway.**`);
      interaction.reply({ content: "Ended", ephemeral: true });
    }

    /* ---- NUKE ---- */
    if (interaction.commandName === "nuke") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const amount = interaction.options.getInteger("amount");
      const deleted = await interaction.channel.bulkDelete(amount, true);
      interaction.channel.send(`💣 Nuked **${deleted.size}** messages`);
      interaction.reply({ content: "Done", ephemeral: true });
    }
  }

  /* ---- JOIN BUTTON ---- */
  if (interaction.isButton() && interaction.customId === "join_gw") {
    const g = giveaways.get(interaction.message.id);
    if (!g || g.ended)
      return interaction.reply({ content: "❌ Giveaway ended", ephemeral: true });

    if (g.reqRoles.length) {
      const ok = g.reqRoles.some(r => interaction.member.roles.cache.has(r.id));
      if (!ok)
        return interaction.reply({ content: "❌ You don't meet requirements", ephemeral: true });
    }

    g.users.add(interaction.user.id);

    const updated = EmbedBuilder.from(g.baseEmbed)
      .setDescription(
        g.baseEmbed.data.description.replace(
          "👤 **Participants:** 0",
          `👤 **Participants:** ${g.users.size}`
        )
      );

    await interaction.message.edit({ embeds: [updated] });
    interaction.reply({ content: "✅ Joined giveaway", ephemeral: true });
  }
});

/* ---------------- END LOGIC ---------------- */

async function endGiveaway(id, g) {
  if (g.ended) return;
  g.ended = true;

  const channel = await client.channels.fetch(g.channelId);
  const message = await channel.messages.fetch(id);

  const embed = EmbedBuilder.from(message.embeds[0]);
  embed.setDescription(embed.data.description.replace(/⏰ Ends.*$/m, "🛑 **Already ended**"));

  await message.edit({ embeds: [embed], components: [] });

  if (g.users.size) {
    const pool = [...g.users];
    const winner = g.fln ?? pool[Math.floor(Math.random() * pool.length)];
    channel.send(`🎉 Congratulations <@${winner}>! You won **${g.prize}**`);
  } else {
    channel.send("❌ Giveaway ended with no participants");
  }
}

/* ---------------- AUTO CHECK ---------------- */

setInterval(() => {
  for (const [id, g] of giveaways) {
    if (!g.ended && Date.now() >= g.endAt) {
      endGiveaway(id, g);
    }
  }
}, 5000);

client.login(process.env.TOKEN);
