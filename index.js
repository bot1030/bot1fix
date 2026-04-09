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
  ButtonStyle,
  PermissionsBitField
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
const joinLocks = new Set();

function noPerm(interaction) {
  return interaction.reply({
    content: `${interaction.user} you doesn't have permission to use this command`
  });
}

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway")

    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Description").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption(o => o.setName("winners").setDescription("Winner count").setRequired(true))
    .addIntegerOption(o => o.setName("days").setDescription("Days"))
    .addIntegerOption(o => o.setName("hours").setDescription("Hours"))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes"))
    .addRoleOption(o => o.setName("role1").setDescription("Required role 1"))
    .addRoleOption(o => o.setName("role2").setDescription("Required role 2"))
    .addRoleOption(o => o.setName("role3").setDescription("Required role 3"))
    .addRoleOption(o => o.setName("pingrole").setDescription("Role to ping"))
    .addStringOption(o => o.setName("fln").setDescription(".")),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Force end giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll giveaway")
    .addStringOption(o => o.setName("messageid").setDescription("Message ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete and recreate this channel"),

  new SlashCommandBuilder()
    .setName("done")
    .setDescription("Send completed delivery message"),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Number of messages to delete")
        .setRequired(true)
    )

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ Bot online");
  setInterval(checkGiveaways, 10000);
});

/* ---------------- INTERACTION ---------------- */

client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

    /* ---------- CREATE GIVEAWAY ---------- */

    if (interaction.commandName === "giveaway") {

      const allowedUsers = [
        "786683877107302461",
        "473647287026057227"
      ];

      if (!allowedUsers.includes(interaction.user.id))
        return interaction.reply({ content: "you do not have permission to use this command" });

      const duration =
        (((interaction.options.getInteger("days") || 0) * 24 +
          (interaction.options.getInteger("hours") || 0)) * 60 +
          (interaction.options.getInteger("minutes") || 0)) * 60000;

      if (duration <= 0)
        return interaction.reply({ content: "Invalid duration.", ephemeral: true });

      const endAt = Date.now() + duration;
      const prize = interaction.options.getString("prize");
      const winners = interaction.options.getInteger("winners");

      const reqRoles = [
        interaction.options.getRole("role1"),
        interaction.options.getRole("role2"),
        interaction.options.getRole("role3")
      ].filter(Boolean).map(r => r.id);

      const pingRole = interaction.options.getRole("pingrole");
      const fln = interaction.options.getString("fln") || null;

      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${interaction.options.getString("title")}`)
        .setColor(0x00ffff)
        .setDescription(
          `${interaction.options.getString("description")}\n\n` +
          `🏆 Prize: **${prize}**\n` +
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

      interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });
    }

    /* ---------- END ---------- */

    if (interaction.commandName === "end") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return noPerm(interaction);

      await endGiveaway(interaction.options.getString("messageid"), interaction.user);
      return interaction.reply({ content: "Giveaway ended.", ephemeral: true });
    }

    /* ---------- REROLL ---------- */

    if (interaction.commandName === "reroll") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return noPerm(interaction);

      const id = interaction.options.getString("messageid");
      const g = giveaways[id];
      if (!g || !g.users.length)
        return interaction.reply({ content: "No participants.", ephemeral: true });

      const winner = g.fln || g.users[Math.floor(Math.random() * g.users.length)];
      const channel = await client.channels.fetch(g.channelId);

      channel.send(`🔁 ${interaction.user} rerolled!\n🎉 Congratulations <@${winner}> you won **${g.prize}**! 🏆✨`);

      return interaction.reply({ content: "Rerolled.", ephemeral: true });
    }

    /* ---------- NUKE ---------- */

    if (interaction.commandName === "nuke") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return noPerm(interaction);

      const channel = interaction.channel;
      const newChannel = await channel.clone();
      await channel.delete();

      return newChannel.send("💣 Channel nuked.");
    }

    /* ---------- DONE ---------- */

    if (interaction.commandName === "done") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return noPerm(interaction);

      return interaction.reply({
        content:
`✅ 【出貨完成通知】

親愛的買家您好 ❤️
您購買的商品已成功發送完畢！📦✨
👉 已完成贈送 / 已成功入帳
歡迎登入遊戲確認您的物品 👀

若有任何問題都可以隨時私訊我～
感謝支持 JK遊戲商城，期待下次再為您服務！🛒💙
（方便的話麻煩幫我們JK商城發誠文）`
      });
    }

    /* ---------- DELETE ---------- */

    if (interaction.commandName === "delete") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return noPerm(interaction);

      const amount = interaction.options.getInteger("amount");

      if (amount < 1 || amount > 100)
        return interaction.reply({
          content: "Amount must be between 1 and 100"
        });

      await interaction.channel.bulkDelete(amount, true);

      interaction.reply({
        content: `🧹 Deleted ${amount} messages`
      });
    }
  }

  /* ---------- JOIN BUTTON ---------- */

  if (interaction.isButton() && interaction.customId === "join") {

    const id = interaction.message.id;
    const g = giveaways[id];

    if (!g || g.ended)
      return interaction.reply({ content: "Giveaway ended.", ephemeral: true });

    if (Date.now() >= g.endAt)
      return endGiveaway(id);

    if (g.reqRoles.length) {
      const hasRole = g.reqRoles.some(r =>
        interaction.member.roles.cache.has(r)
      );
      if (!hasRole)
        return interaction.reply({ content: "Missing required role.", ephemeral: true });
    }

    if (joinLocks.has(id))
      return interaction.reply({ content: "Processing... try again.", ephemeral: true });

    joinLocks.add(id);

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

    joinLocks.delete(id);

    interaction.reply({ content: "✅ You joined the giveaway! 🎉", ephemeral: true });
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
    channel.send(`🎉 Congratulations <@${winner}> won **${g.prize}**! 🏆✨`);
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
