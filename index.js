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

const giveaways = new Map(); // messageId -> data

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway")
    .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption(o => o.setName("days").setDescription("Days (0 or number)"))
    .addIntegerOption(o => o.setName("hours").setDescription("Hours (0 or number)"))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes (0 or number)"))
    .addRoleOption(o => o.setName("role1").setDescription("Required role 1"))
    .addRoleOption(o => o.setName("role2").setDescription("Required role 2"))
    .addRoleOption(o => o.setName("role3").setDescription("Required role 3")),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll a giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Force end a giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete messages")
    .addIntegerOption(o => o.setName("amount").setDescription("Number").setRequired(true)),

  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send a message as bot")
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
  console.log("✅ Bot ready");
});

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {

    /* ---------- GIVEAWAY ---------- */
    if (interaction.commandName === "giveaway") {
      const prize = interaction.options.getString("prize");
      const days = interaction.options.getInteger("days") || 0;
      const hours = interaction.options.getInteger("hours") || 0;
      const minutes = interaction.options.getInteger("minutes") || 0;

      const role1 = interaction.options.getRole("role1");
      const role2 = interaction.options.getRole("role2");
      const role3 = interaction.options.getRole("role3");

      const duration =
        ((days * 24 + hours) * 60 + minutes) * 60 * 1000;

      const endAt = Date.now() + duration;

      const reqRoles = [role1, role2, role3].filter(r => r);

      const embed = new EmbedBuilder()
        .setTitle("🎁 GIVEAWAY")
        .setDescription(
          `**Prize:** ${prize}\n\n` +
          `**Requirements:** ${
            reqRoles.length
              ? reqRoles.map(r => `<@&${r.id}>`).join(", ")
              : "None"
          }\n\n` +
          `**Participants:** 0\n\n` +
          `Ends <t:${Math.floor(endAt / 1000)}:R>`
        )
        .setColor(0x00f7ff);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("join_giveaway")
          .setLabel("🎉 Join Giveaway")
          .setStyle(ButtonStyle.Success)
      );

      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

      giveaways.set(msg.id, {
        prize,
        endAt,
        users: new Set(),
        reqRoles,
        ended: false
      });

      interaction.reply({ content: "✅ Giveaway created", ephemeral: true });
    }

    /* ---------- REROLL ---------- */
    if (interaction.commandName === "reroll") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g) return interaction.reply({ content: "❌ Not found", ephemeral: true });

      const Lk1 = [...g.users];
      if (!Lk1.length) return interaction.reply("❌ No participants");

      const winner = Lk1[Math.floor(Math.random() * Lk1.length)];
      interaction.channel.send(`🎉 Congratulations <@${winner}>, you won: **${g.prize}**`);
      interaction.reply({ content: "✅ Rerolled", ephemeral: true });
    }

    /* ---------- FORCE END ---------- */
    if (interaction.commandName === "end") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g || g.ended) return interaction.reply("❌ Invalid giveaway");

      g.ended = true;
      const Lk1 = [...g.users];
      if (Lk1.length) {
        const w = Lk1[Math.floor(Math.random() * Lk1.length)];
        interaction.channel.send(`🎉 Congratulations <@${w}>, you won: **${g.prize}**`);
      } else {
        interaction.channel.send("❌ Giveaway ended with no participants");
      }
      interaction.reply({ content: "✅ Ended", ephemeral: true });
    }

    /* ---------- NUKE ---------- */
    if (interaction.commandName === "nuke") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const amt = interaction.options.getInteger("amount");
      const deleted = await interaction.channel.bulkDelete(amt, true);
      interaction.channel.send(`💣 **Nuked \`${deleted.size}\` messages**`);
      interaction.reply({ content: "Done", ephemeral: true });
    }

    /* ---------- SEND ---------- */
    if (interaction.commandName === "send") {
      const ch = interaction.options.getChannel("channel");
      const msg = interaction.options.getString("message");
      ch.send(msg);
      interaction.reply({ content: "✅ Sent", ephemeral: true });
    }
  }

  /* ---------- BUTTON JOIN ---------- */
  if (interaction.isButton() && interaction.customId === "join_giveaway") {
    const g = giveaways.get(interaction.message.id);
    if (!g) return interaction.reply({ content: "❌ Giveaway not found", ephemeral: true });

    if (g.reqRoles.length) {
      const hasRole = g.reqRoles.some(r => interaction.member.roles.cache.has(r.id));
      if (!hasRole)
        return interaction.reply({ content: "❌ You don't meet role requirements", ephemeral: true });
    }

    g.users.add(interaction.user.id);

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.setDescription(
      embed.data.description.replace(
        /Participants:\s*\d+/,
        `Participants: ${g.users.size}`
      )
    );

    interaction.message.edit({ embeds: [embed] });
    interaction.reply({ content: "✅ Joined giveaway", ephemeral: true });
  }
});

/* ---------- END CHECK LOOP ---------- */
setInterval(() => {
  for (const [id, g] of giveaways) {
    if (!g.ended && Date.now() >= g.endAt) {
      g.ended = true;
      const Lk1 = [...g.users];
      if (Lk1.length) {
        const w = Lk1[Math.floor(Math.random() * Lk1.length)];
        client.channels.cache.forEach(ch => {
          if (ch.messages?.cache.has(id)) {
            ch.send(`🎉 Congratulations <@${w}>, you won: **${g.prize}**`);
          }
        });
      }
    }
  }
}, 5000);

client.login(process.env.TOKEN);
