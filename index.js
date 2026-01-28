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
  Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const giveaways = {};

/* ---------------- COMMANDS ---------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName("channel").setDescription("Giveaway channel").setRequired(true))
    .addStringOption(o =>
      o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o =>
      o.setName("description").setDescription("Description").setRequired(true))
    .addStringOption(o =>
      o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption(o =>
      o.setName("winners").setDescription("Winner count").setRequired(true))
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days"))
    .addIntegerOption(o =>
      o.setName("hours").setDescription("Hours"))
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Minutes"))
    .addRoleOption(o =>
      o.setName("role1").setDescription("Required role 1"))
    .addRoleOption(o =>
      o.setName("role2").setDescription("Required role 2"))
    .addRoleOption(o =>
      o.setName("role3").setDescription("Required role 3"))
    .addRoleOption(o =>
      o.setName("ping").setDescription("Ping role"))
    .addStringOption(o =>
      o.setName("lk1").setDescription("0 or number")),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("id").setDescription("Giveaway ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Amount").setRequired(true))
].map(c => c.toJSON());

/* ---------------- REGISTER ---------------- */
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

/* ---------------- HELPERS ---------------- */
function scheduleEnd(id) {
  const g = giveaways[id];
  const remaining = g.endAt - Date.now();
  setTimeout(() => endGiveaway(id), Math.max(remaining, 0));
}

async function endGiveaway(id) {
  const g = giveaways[id];
  if (!g || g.ended) return;
  g.ended = true;

  const channel = await client.channels.fetch(g.channelId);
  const msg = await channel.messages.fetch(g.messageId);

  let winners = [];

  if (g.lk1 !== "0") {
    winners.push(`<@${g.lk1}>`);
  } else {
    const pool = [...g.participants];
    while (winners.length < g.winnerCount && pool.length) {
      winners.push(`<@${pool.splice(Math.random()*pool.length|0,1)[0]}>`);
    }
  }

  const endedEmbed = EmbedBuilder.from(msg.embeds[0])
    .setColor(0xff0000)
    .setFooter({ text: "🎉 Giveaway Ended" });

  await msg.edit({ embeds: [endedEmbed], components: [] });

  await channel.send(
    winners.length
      ? `🎉 **Congratulations ${winners.join(", ")}!**\n🏆 **Prize:** ${g.prize}`
      : "❌ No valid participants."
  );
}

/* ---------------- INTERACTIONS ---------------- */
client.on("interactionCreate", async i => {

  /* JOIN BUTTON */
  if (i.isButton()) {
    const g = giveaways[i.customId];
    if (!g || g.ended)
      return i.reply({ content: "❌ Giveaway ended.", ephemeral: true });

    if (
      g.requiredRoles.length &&
      !g.requiredRoles.every(r => i.member.roles.cache.has(r))
    ) {
      return i.reply({
        content: "❌ You do not meet the role requirements.",
        ephemeral: true
      });
    }

    if (!g.participants.includes(i.user.id)) {
      g.participants.push(i.user.id);

      const embed = EmbedBuilder.from(i.message.embeds[0]);
      embed.spliceFields(3, 1, {
        name: "👥 Participants",
        value: g.participants.length.toString(),
        inline: true
      });

      await i.message.edit({ embeds: [embed] });
    }

    return i.reply({ content: "✅ You joined the giveaway!", ephemeral: true });
  }

  if (!i.isChatInputCommand()) return;

  /* CREATE GIVEAWAY */
  if (i.commandName === "create_giveaway") {
    const id = Date.now().toString();

    const days = i.options.getInteger("days") || 0;
    const hours = i.options.getInteger("hours") || 0;
    const minutes = i.options.getInteger("minutes") || 0;

    const roles = [
      i.options.getRole("role1"),
      i.options.getRole("role2"),
      i.options.getRole("role3")
    ].filter(Boolean).map(r => r.id);

    const roleText = roles.length
      ? roles.map(r => `<@&${r}>`).join(", ")
      : "None";

    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(i.options.getString("title"))
      .setDescription(i.options.getString("description"))
      .addFields(
        { name: "🏆 Prize", value: i.options.getString("prize"), inline: true },
        { name: "🎯 Winners", value: i.options.getInteger("winners").toString(), inline: true },
        { name: "🔒 Required Roles", value: roleText, inline: false },
        { name: "👥 Participants", value: "0", inline: true },
        {
          name: "⏰ Ends",
          value: `<t:${Math.floor(
            (Date.now() + ((days*24+hours)*60+minutes)*60000) / 1000
          )}:R>`
        }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel("🎉 Join Giveaway")
        .setStyle(ButtonStyle.Success)
    );

    const channel = i.options.getChannel("channel");
    const ping = i.options.getRole("ping");

    const msg = await channel.send({
      content: ping ? ping.toString() : null,
      embeds: [embed],
      components: [row]
    });

    giveaways[id] = {
      channelId: channel.id,
      messageId: msg.id,
      prize: i.options.getString("prize"),
      winnerCount: i.options.getInteger("winners"),
      participants: [],
      requiredRoles: roles,
      lk1: i.options.getString("lk1") || "0",
      endAt: Date.now() + ((days*24+hours)*60+minutes)*60000,
      ended: false
    };

    scheduleEnd(id);
    return i.reply({ content: `✅ Giveaway created (ID: ${id})`, ephemeral: true });
  }

  /* REROLL */
  if (i.commandName === "reroll") {
    giveaways[i.options.getString("id")].ended = false;
    endGiveaway(i.options.getString("id"));
    return i.reply({ content: "🔁 Giveaway rerolled.", ephemeral: true });
  }

  /* NUKE */
  if (i.commandName === "nuke") {
    const msgs = await i.channel.bulkDelete(i.options.getInteger("amount"), true);
    return i.reply(`💥 Nuked ${msgs.size} messages.`);
  }
});

/* ---------------- LOGIN ---------------- */
client.login(process.env.TOKEN);
