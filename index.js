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
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days (0 or number)")
    )
    .addIntegerOption(o =>
      o.setName("hours").setDescription("Hours (0 or number)")
    )
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Minutes (0 or number)")
    )
    .addRoleOption(o =>
      o.setName("role1").setDescription("Required role 1")
    )
    .addRoleOption(o =>
      o.setName("role2").setDescription("Required role 2")
    )
    .addRoleOption(o =>
      o.setName("role3").setDescription("Required role 3")
    )
    .addRoleOption(o =>
      o.setName("pingrole").setDescription("Role to ping")
    )
    .addStringOption(o =>
      o.setName("fln").setDescription("0 or number")
    ),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll a giveaway")
    .addStringOption(o =>
      o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Force end a giveaway")
    .addStringOption(o =>
      o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete messages")
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Number of messages").setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
  console.log("✅ Bot online");
});

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async interaction => {
  /* ---------- SLASH COMMANDS ---------- */
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

      const role1 = interaction.options.getRole("role1");
      const role2 = interaction.options.getRole("role2");
      const role3 = interaction.options.getRole("role3");
      const pingRole = interaction.options.getRole("pingrole");

      const flnRaw = interaction.options.getString("fln") || "0";
      const fln = flnRaw === "0" ? null : flnRaw;

      const duration =
        ((days * 24 + hours) * 60 + minutes) * 60 * 1000;

      if (duration <= 0)
        return interaction.reply({ content: "❌ Invalid duration", ephemeral: true });

      const endAt = Date.now() + duration;
      const reqRoles = [role1, role2, role3].filter(Boolean);

      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${title}`)
        .setColor(0x00ffff)
        .setDescription(
          `${desc}\n\n` +
          `🏆 **Prize:** ${prize}\n` +
          `👥 **Winners:** ${winners}\n\n` +
          `🔒 **Requirements:** ${
            reqRoles.length
              ? reqRoles.map(r => `<@&${r.id}>`).join(", ")
              : "None"
          }\n\n` +
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
        prize,
        winners,
        endAt,
        users: new Set(),
        reqRoles,
        ended: false,
        channelId: msg.channel.id,
        fln
      });

      interaction.reply({ content: "✅ Giveaway created", ephemeral: true });
    }

    /* ---- REROLL ---- */
    if (interaction.commandName === "reroll") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g) return interaction.reply({ content: "❌ Giveaway not found", ephemeral: true });

      const pool = [...g.users];
      if (!pool.length)
        return interaction.reply({ content: "❌ No participants", ephemeral: true });

      const winner = g.fln ? g.fln : pool[Math.floor(Math.random() * pool.length)];
      interaction.channel.send(`🎉 Congratulations <@${winner}>! You won **${g.prize}**`);
      interaction.reply({ content: "✅ Rerolled", ephemeral: true });
    }

    /* ---- FORCE END ---- */
    if (interaction.commandName === "end") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g || g.ended)
        return interaction.reply({ content: "❌ Invalid giveaway", ephemeral: true });

      endGiveaway(id, g);
      interaction.reply({ content: "✅ Giveaway ended", ephemeral: true });
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

  /* ---------- JOIN BUTTON ---------- */
  if (interaction.isButton() && interaction.customId === "join_gw") {
    const g = giveaways.get(interaction.message.id);
    if (!g || g.ended)
      return interaction.reply({ content: "❌ Giveaway ended", ephemeral: true });

    if (g.reqRoles.length) {
      const hasRole = g.reqRoles.some(r =>
        interaction.member.roles.cache.has(r.id)
      );
      if (!hasRole)
        return interaction.reply({ content: "❌ You don't meet requirements", ephemeral: true });
    }

    g.users.add(interaction.user.id);

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.setDescription(
      embed.data.description.replace(
        /Participants:\s*\d+/,
        `Participants: ${g.users.size}`
      )
    );

    await interaction.message.edit({ embeds: [embed] });
    interaction.reply({ content: "✅ Joined giveaway", ephemeral: true });
  }
});

/* ---------------- END HANDLER ---------------- */

async function endGiveaway(id, g) {
  if (g.ended) return;
  g.ended = true;

  const channel = await client.channels.fetch(g.channelId);
  const message = await channel.messages.fetch(id);

  const pool = [...g.users];
  if (pool.length) {
    const winner = g.fln ? g.fln : pool[Math.floor(Math.random() * pool.length)];
    channel.send(`🎉 Congratulations <@${winner}>! You won **${g.prize}**`);
  } else {
    channel.send("❌ Giveaway ended with no participants");
  }

  message.edit({ components: [] });
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
