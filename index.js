require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ===== MEMORY STORAGE =====
const giveaways = new Map(); // code => giveaway data

// ===== REGISTER SLASH COMMANDS =====
const commands = [
  {
    name: "create_giveaway",
    description: "Create a giveaway (admin only)",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { name: "channel", description: "Giveaway channel", type: 7, required: true },
      { name: "title", description: "Giveaway title", type: 3, required: true },
      { name: "description", description: "Giveaway description", type: 3, required: true },
      { name: "prize", description: "Prize", type: 3, required: true },
      { name: "winners", description: "Number of winners", type: 4, required: true },
      { name: "hours", description: "Hours", type: 4, required: true },
      { name: "minutes", description: "Minutes", type: 4, required: true },
      { name: "seconds", description: "Seconds", type: 4, required: true },
      { name: "fake", description: "F (User ID or 0)", type: 3, required: true },
      { name: "role_required", description: "Required role", type: 8, required: false },
      { name: "ping_role", description: "Ping role", type: 8, required: false }
    ]
  },
  {
    name: "reroll",
    description: "Re-roll last giveaway winner",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { name: "code", description: "Giveaway code", type: 3, required: true }
    ]
  }
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Slash commands registered");
})();

// ===== READY =====
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ===== CREATE GIVEAWAY =====
  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const desc = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winnersCount = interaction.options.getInteger("winners");
    const hours = interaction.options.getInteger("hours");
    const minutes = interaction.options.getInteger("minutes");
    const seconds = interaction.options.getInteger("seconds");
    const fake = interaction.options.getString("fake");
    const requiredRole = interaction.options.getRole("role_required");
    const pingRole = interaction.options.getRole("ping_role");

    const durationMs =
      (hours * 3600 + minutes * 60 + seconds) * 1000;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setDescription(desc)
      .addFields(
        { name: "🏆 Prize", value: prize, inline: true },
        { name: "👥 Winners", value: `${winnersCount}`, inline: true },
        { name: "⏳ Ends", value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` },
        { name: "🔐 Role Required", value: requiredRole ? `<@&${requiredRole.id}>` : "None" },
        { name: "🧪 F", value: fake === "0" ? "Disabled" : "Enabled" },
        { name: "🆔 Code", value: code }
      )
      .setColor(0x2ECC71)
      .setFooter({ text: "React with 🎉 to enter!" });

    const msg = await channel.send({
      content: pingRole ? `<@&${pingRole.id}>` : null,
      embeds: [embed]
    });

    await msg.react("🎉");

    giveaways.set(code, {
      channelId: channel.id,
      messageId: msg.id,
      winnersCount,
      fake,
      requiredRoleId: requiredRole?.id || null,
      ended: false
    });

    setTimeout(async () => {
      const message = await channel.messages.fetch(msg.id);
      const reaction = message.reactions.cache.get("🎉");
      const users = await reaction.users.fetch();
      let validUsers = users.filter(u => !u.bot);

      if (requiredRole) {
        validUsers = validUsers.filter(u =>
          channel.guild.members.cache.get(u.id)?.roles.cache.has(requiredRole.id)
        );
      }

      let winners = [];

      if (fake !== "0") {
        winners = [`<@${fake}>`];
      } else {
        winners = validUsers.random(winnersCount).map(u => `<@${u.id}>`);
      }

      giveaways.get(code).ended = true;

      channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎊 Giveaway Ended!")
            .setDescription(`🏆 Winner(s): ${winners.join(", ")}`)
            .setColor(0xE74C3C)
            .setFooter({ text: `Code: ${code}` })
        ]
      });
    }, durationMs);

    return interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });
  }

  // ===== REROLL =====
  if (interaction.commandName === "reroll") {
    const code = interaction.options.getString("code");
    const giveaway = giveaways.get(code);

    if (!giveaway || !giveaway.ended)
      return interaction.reply({ content: "❌ Invalid giveaway.", ephemeral: true });

    const channel = await client.channels.fetch(giveaway.channelId);
    const msg = await channel.messages.fetch(giveaway.messageId);
    const reaction = msg.reactions.cache.get("🎉");
    const users = await reaction.users.fetch();
    const validUsers = users.filter(u => !u.bot);

    const winner = validUsers.random();

    channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔄 Giveaway Rerolled!")
          .setDescription(`🎉 New Winner: <@${winner.id}>`)
          .setColor(0xF1C40F)
          .setFooter({ text: `Code: ${code}` })
      ]
    });

    interaction.reply({ content: "✅ Rerolled!", ephemeral: true });
  }
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);
