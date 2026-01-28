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
  RoleSelectMenuBuilder,
  REST,
  Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const giveaways = {};

// ---------------- COMMANDS ----------------
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

// ---------------- REGISTER ----------------
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

// ---------------- HELPERS ----------------
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

// ---------------- INTERACTIONS ----------------
client.on("interactionCreate", async i => {

  // JOIN BUTTON
  if (i.isButton()) {
    const g = giveaways[i.customId];
    if (!g || g.ended)
      return i.reply({ content: "❌ Giveaway ended.", ephemeral: true });

    if (g.requiredRoles.length &&
        !g.requiredRoles.every(r => i.member.roles.cache.has(r))) {
      return i.reply({ content: "❌ Missing required role(s).", ephemeral: true });
    }

    if (!g.participants.includes(i.user.id)) {
      g.participants.push(i.user.id);

      const embed = EmbedBuilder.from(i.message.embeds[0]);
      embed.spliceFields(2, 1, {
        name: "👥 Participants",
        value: g.participants.length.toString(),
        inline: true
      });

      await i.message.edit({ embeds: [embed] });
    }

    return i.reply({ content: "✅ Joined giveaway!", ephemeral: true });
  }

  // SLASH COMMANDS
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "create_giveaway") {
    const id = Date.now().toString();
    const days = i.options.getInteger("days") || 0;
    const hours = i.options.getInteger("hours") || 0;
    const minutes = i.options.getInteger("minutes") || 0;

    giveaways[id] = {
      channelId: i.options.getChannel("channel").id,
      prize: i.options.getString("prize"),
      winnerCount: i.options.getInteger("winners"),
      lk1: i.options.getString("lk1") || "0",
      participants: [],
      requiredRoles: [],
      endAt: Date.now() + ((days*24+hours)*60+minutes)*60000,
      ended: false
    };

    const roleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`roles_${id}`)
        .setPlaceholder("Select required roles (optional)")
        .setMaxValues(5)
    );

    return i.reply({
      content: "Select required roles (or skip)",
      components: [roleRow],
      ephemeral: true
    });
  }

  if (i.commandName === "reroll") {
    giveaways[i.options.getString("id")].ended = false;
    endGiveaway(i.options.getString("id"));
    return i.reply({ content: "🔁 Rerolled.", ephemeral: true });
  }

  if (i.commandName === "nuke") {
    const msgs = await i.channel.bulkDelete(i.options.getInteger("amount"), true);
    return i.reply(`💥 Nuked ${msgs.size} messages.`);
  }
});

// ---------------- LOGIN ----------------
client.login(process.env.TOKEN);
