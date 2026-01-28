require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const giveaways = {}; // in-memory store (same as before)

// ================= COMMAND REGISTRATION =================
const commands = [
  new SlashCommandBuilder()
    .setName("create_giveaway")
    .setDescription("Create a giveaway (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days").setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName("hours").setDescription("Hours").setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Minutes").setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Required role").setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("ping").setDescription("Ping role").setRequired(false)
    )
    .addStringOption(o =>
      o.setName("lk1").setDescription("0 or number").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Reroll a giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("id").setDescription("Giveaway ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Delete messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Messages").setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

// ================= GIVEAWAY SCHEDULER (FIXED) =================
function scheduleGiveawayEnd(id) {
  const g = giveaways[id];
  if (!g || g.ended) return;

  const remaining = g.endAt - Date.now();
  if (remaining <= 0) {
    endGiveaway(id);
  } else {
    setTimeout(() => endGiveaway(id), remaining);
  }
}

// ================= END GIVEAWAY =================
async function endGiveaway(id) {
  const g = giveaways[id];
  if (!g || g.ended) return;
  g.ended = true;

  const channel = await client.channels.fetch(g.channelId);
  const msg = await channel.messages.fetch(g.messageId);

  let winners = [];

  if (g.lk1 && g.lk1 !== "0") {
    winners.push(`<@${g.lk1}>`);
  } else {
    const pool = [...g.participants];
    while (winners.length < g.winnerCount && pool.length > 0) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      winners.push(`<@${pick}>`);
    }
  }

  const embed = EmbedBuilder.from(msg.embeds[0])
    .setColor(0xff0000)
    .setFooter({ text: "🎉 Giveaway Ended" });

  await msg.edit({ embeds: [embed], components: [] });

  await channel.send(
    winners.length
      ? `🎉 **Congratulations ${winners.join(", ")}!**\n🏆 **Prize:** ${g.prize}`
      : "❌ No valid participants."
  );
}

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  // BUTTON JOIN
  if (interaction.isButton()) {
    const id = interaction.customId;
    const g = giveaways[id];
    if (!g || g.ended) {
      return interaction.reply({ content: "❌ Giveaway ended.", ephemeral: true });
    }

    if (g.roleReq) {
      if (!interaction.member.roles.cache.has(g.roleReq)) {
        return interaction.reply({ content: "❌ Missing required role.", ephemeral: true });
      }
    }

    if (!g.participants.includes(interaction.user.id)) {
      g.participants.push(interaction.user.id);
    }

    return interaction.reply({ content: "✅ Joined giveaway!", ephemeral: true });
  }

  // SLASH COMMANDS
  if (!interaction.isChatInputCommand()) return;

  // CREATE GIVEAWAY
  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const desc = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winners = interaction.options.getInteger("winners");
    const days = interaction.options.getInteger("days") || 0;
    const hours = interaction.options.getInteger("hours") || 0;
    const minutes = interaction.options.getInteger("minutes") || 0;
    const role = interaction.options.getRole("role");
    const ping = interaction.options.getRole("ping");
    const lk1 = interaction.options.getString("lk1") || "0";

    const durationMs =
      ((days * 24 + hours) * 60 + minutes) * 60 * 1000;

    const endAt = Date.now() + durationMs;
    const id = Date.now().toString();

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(desc)
      .addFields(
        { name: "🏆 Prize", value: prize, inline: true },
        { name: "👥 Winners", value: winners.toString(), inline: true },
        { name: "⏰ Ends", value: `<t:${Math.floor(endAt / 1000)}:R>` }
      )
      .setColor(0x00ffcc);

    if (role) embed.addFields({ name: "🔒 Requirement", value: role.toString() });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel("🎉 Join Giveaway")
        .setStyle(ButtonStyle.Success)
    );

    const msg = await channel.send({
      content: ping ? ping.toString() : null,
      embeds: [embed],
      components: [row]
    });

    giveaways[id] = {
      channelId: channel.id,
      messageId: msg.id,
      prize,
      winnerCount: winners,
      participants: [],
      roleReq: role ? role.id : null,
      lk1,
      endAt,
      ended: false
    };

    scheduleGiveawayEnd(id);
    return interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });
  }

  // REROLL
  if (interaction.commandName === "reroll") {
    const id = interaction.options.getString("id");
    if (!giveaways[id]) {
      return interaction.reply({ content: "❌ Invalid giveaway ID.", ephemeral: true });
    }
    giveaways[id].ended = false;
    endGiveaway(id);
    return interaction.reply({ content: "🔁 Giveaway rerolled.", ephemeral: true });
  }

  // NUKE
  if (interaction.commandName === "nuke") {
    const amount = interaction.options.getInteger("amount");
    const msgs = await interaction.channel.bulkDelete(amount, true);
    await interaction.reply({
      content: `💥 Nuked ${msgs.size} messages.`,
      ephemeral: false
    });
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
