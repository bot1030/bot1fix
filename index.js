require("dotenv").config();
const fs = require("fs");
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
  ButtonStyle
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Message]
});

const DATA_FILE = "./giveaways.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let giveaways = loadData();

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway")

    .addStringOption(o =>
      o.setName("title")
        .setDescription("Giveaway title")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("description")
        .setDescription("Giveaway description")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("prize")
        .setDescription("Prize name")
        .setRequired(true))

    .addIntegerOption(o =>
      o.setName("winners")
        .setDescription("Number of winners")
        .setRequired(true))

    .addIntegerOption(o =>
      o.setName("days")
        .setDescription("Duration days")
        .setRequired(false))

    .addIntegerOption(o =>
      o.setName("hours")
        .setDescription("Duration hours")
        .setRequired(false))

    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Duration minutes")
        .setRequired(false))

    .addRoleOption(o =>
      o.setName("role1")
        .setDescription("Required role 1")
        .setRequired(false))

    .addRoleOption(o =>
      o.setName("role2")
        .setDescription("Required role 2")
        .setRequired(false))

    .addRoleOption(o =>
      o.setName("role3")
        .setDescription("Required role 3")
        .setRequired(false))

    .addRoleOption(o =>
      o.setName("pingrole")
        .setDescription("Role to ping")
        .setRequired(false))

    .addStringOption(o =>
      o.setName("fln")
        .setDescription("Fake winner ID")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll giveaway winner")
    .addStringOption(o =>
      o.setName("messageid")
        .setDescription("Giveaway message ID")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Force end giveaway")
    .addStringOption(o =>
      o.setName("messageid")
        .setDescription("Giveaway message ID")
        .setRequired(true))

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ Bot online");

  setInterval(checkGiveaways, 10000);
});

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async interaction => {

  /* ---------- CREATE GIVEAWAY ---------- */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "giveaway") {

      const title = interaction.options.getString("title");
      const desc = interaction.options.getString("description");
      const prize = interaction.options.getString("prize");
      const winners = interaction.options.getInteger("winners");

      const days = interaction.options.getInteger("days") || 0;
      const hours = interaction.options.getInteger("hours") || 0;
      const minutes = interaction.options.getInteger("minutes") || 0;

      const duration = (((days * 24 + hours) * 60) + minutes) * 60000;
      if (duration <= 0)
        return interaction.reply({ content: "Invalid time.", ephemeral: true });

      const endAt = Date.now() + duration;

      const reqRoles = [
        interaction.options.getRole("role1"),
        interaction.options.getRole("role2"),
        interaction.options.getRole("role3")
      ].filter(Boolean).map(r => r.id);

      const pingRole = interaction.options.getRole("pingrole");
      const fln = interaction.options.getString("fln") || null;

      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${title}`)
        .setColor(0x00ffff)
        .setDescription(
          `${desc}\n\n` +
          `🏆 Prize: ${prize}\n` +
          `👥 Winners: ${winners}\n` +
          `🔒 Requirements: ${reqRoles.length ? reqRoles.map(r => `<@&${r}>`).join(", ") : "None"}\n\n` +
          `👤 Participants: 0\n\n` +
          `⏰ Ends <t:${Math.floor(endAt / 1000)}:R>`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("join")
          .setLabel("🎉 Join")
          .setStyle(ButtonStyle.Success)
      );

      const msg = await interaction.channel.send({
        content: pingRole ? `<@&${pingRole.id}>` : null,
        embeds: [embed],
        components: [row]
      });

      giveaways[msg.id] = {
        channelId: msg.channel.id,
        prize,
        winners,
        endAt,
        users: [],
        reqRoles,
        fln,
        ended: false
      };

      saveData(giveaways);

      interaction.reply({ content: "Giveaway created.", ephemeral: true });
    }

    /* ---------- END ---------- */

    if (interaction.commandName === "end") {
      const id = interaction.options.getString("messageid");
      if (!giveaways[id])
        return interaction.reply({ content: "Not found.", ephemeral: true });

      await endGiveaway(id, interaction.user);
      interaction.reply({ content: "Giveaway ended.", ephemeral: true });
    }

    /* ---------- REROLL ---------- */

    if (interaction.commandName === "reroll") {
      const id = interaction.options.getString("messageid");
      const g = giveaways[id];

      if (!g)
        return interaction.reply({ content: "Not found.", ephemeral: true });

      if (!g.users.length)
        return interaction.reply({ content: "No participants.", ephemeral: true });

      const winner = g.fln || g.users[Math.floor(Math.random() * g.users.length)];

      const channel = await client.channels.fetch(g.channelId);
      channel.send(`🔁 ${interaction.user} rerolled the giveaway!\n🎉 New winner: <@${winner}>`);

      interaction.reply({ content: "Rerolled.", ephemeral: true });
    }
  }

  /* ---------- JOIN BUTTON ---------- */

  if (interaction.isButton() && interaction.customId === "join") {

    const g = giveaways[interaction.message.id];

    if (!g || g.ended)
      return interaction.reply({ content: "Giveaway ended.", ephemeral: true });

    if (Date.now() >= g.endAt)
      return endGiveaway(interaction.message.id);

    if (g.reqRoles.length) {
      const hasRole = g.reqRoles.some(r =>
        interaction.member.roles.cache.has(r)
      );

      if (!hasRole)
        return interaction.reply({
          content: "You don't meet the role requirements.",
          ephemeral: true
        });
    }

    if (!g.users.includes(interaction.user.id)) {
      g.users.push(interaction.user.id);
      saveData(giveaways);
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.setDescription(
      embed.data.description.replace(
        /👤 Participants: \d+/,
        `👤 Participants: ${g.users.length}`
      )
    );

    await interaction.message.edit({ embeds: [embed] });

    interaction.reply({ content: "You joined!", ephemeral: true });
  }
});

/* ---------------- END FUNCTION ---------------- */

async function endGiveaway(id, endedBy = null) {
  const g = giveaways[id];
  if (!g || g.ended) return;

  g.ended = true;
  saveData(giveaways);

  const channel = await client.channels.fetch(g.channelId);
  const message = await channel.messages.fetch(id);

  const embed = EmbedBuilder.from(message.embeds[0]);
  embed.setDescription(embed.data.description.replace(/⏰ Ends.*$/m, "🛑 Already Ended"));

  await message.edit({ embeds: [embed], components: [] });

  if (g.users.length) {
    const winner = g.fln || g.users[Math.floor(Math.random() * g.users.length)];
    channel.send(`🎉 Winner: <@${winner}>`);
  } else {
    channel.send("No participants.");
  }

  if (endedBy)
    channel.send(`🛑 ${endedBy} ended the giveaway.`);
}

/* ---------------- AUTO CHECK ---------------- */

function checkGiveaways() {
  for (const id in giveaways) {
    if (!giveaways[id].ended && Date.now() >= giveaways[id].endAt)
      endGiveaway(id);
  }
}

client.login(process.env.TOKEN);
