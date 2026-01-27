require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

/* =======================
   CLIENT
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* =======================
   GIVEAWAY STORAGE
======================= */
const giveaways = new Map();

/* =======================
   SLASH COMMANDS
======================= */
const commands = [
  {
    name: "create_giveaway",
    description: "Create a giveaway (admin only)",
    default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    options: [
      { name: "channel", description: "Giveaway channel", type: 7, required: true },
      { name: "title", description: "Title", type: 3, required: true },
      { name: "description", description: "Description", type: 3, required: true },
      { name: "prize", description: "Prize", type: 3, required: true },
      { name: "winners", description: "Number of winners", type: 4, required: true },
      { name: "hours", description: "Hours", type: 4, required: true },
      { name: "minutes", description: "Minutes", type: 4, required: true },
      { name: "seconds", description: "Seconds", type: 4, required: true },

      // OPTIONAL (must be after required)
      { name: "role", description: "Required role", type: 8, required: false },
      { name: "ping_role", description: "Ping role", type: 8, required: false },
      { name: "f", description: "Fake winner ID or 0", type: 3, required: false }
    ]
  },
  {
    name: "reroll",
    description: "Reroll a giveaway (admin only)",
    default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    options: [
      { name: "code", description: "Giveaway code", type: 3, required: true }
    ]
  }
];

/* =======================
   REGISTER COMMANDS
======================= */
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error(err);
  }
})();

/* =======================
   READY
======================= */
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* =======================
   INTERACTIONS
======================= */
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* ===== CREATE GIVEAWAY ===== */
  if (interaction.commandName === "create_giveaway") {
    const channel = interaction.options.getChannel("channel");
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const prize = interaction.options.getString("prize");
    const winners = interaction.options.getInteger("winners");

    const hours = interaction.options.getInteger("hours");
    const minutes = interaction.options.getInteger("minutes");
    const seconds = interaction.options.getInteger("seconds");

    const requiredRole = interaction.options.getRole("role");
    const pingRole = interaction.options.getRole("ping_role");
    const fakeWinner = interaction.options.getString("f") || "0";

    const duration =
      ((hours * 3600) + (minutes * 60) + seconds) * 1000;

    if (duration <= 0) {
      return interaction.reply({ content: "❌ Invalid duration.", ephemeral: true });
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setDescription(
        `${description}\n\n🏆 **Prize:** ${prize}\n👥 **Winners:** ${winners}\n⏰ **Ends:** <t:${Math.floor((Date.now() + duration) / 1000)}:R>`
      )
      .setColor(0x2ecc71)
      .setFooter({ text: `Code: ${code}` });

    const message = await channel.send({
      content: pingRole ? `<@&${pingRole.id}>` : null,
      embeds: [embed]
    });

    await message.react("🎉");

    giveaways.set(code, {
      channelId: channel.id,
      messageId: message.id,
      winners,
      requiredRoleId: requiredRole?.id || null,
      fakeWinner,
      ended: false
    });

    interaction.reply({ content: "✅ Giveaway created.", ephemeral: true });

    setTimeout(async () => {
      const data = giveaways.get(code);
      if (!data) return;

      const ch = await client.channels.fetch(data.channelId);
      const msg = await ch.messages.fetch(data.messageId);
      const reaction = msg.reactions.cache.get("🎉");
      if (!reaction) return;

      let users = (await reaction.users.fetch()).filter(u => !u.bot);

      if (data.requiredRoleId) {
        users = users.filter(u =>
          ch.guild.members.cache
            .get(u.id)
            ?.roles.cache.has(data.requiredRoleId)
        );
      }

      let winnersList = [];

      if (data.fakeWinner !== "0") {
        winnersList = [`<@${data.fakeWinner}>`];
      } else {
        winnersList = users.random(Math.min(users.size, data.winners))
          .map(u => `<@${u.id}>`);
      }

      data.ended = true;

      ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎊 Giveaway Ended!")
            .setDescription(`🏆 **Winner(s):** ${winnersList.join(", ")}`)
            .setColor(0xf1c40f)
        ]
      });
    }, duration);
  }

  /* ===== REROLL ===== */
  if (interaction.commandName === "reroll") {
    const code = interaction.options.getString("code");
    const data = giveaways.get(code);

    if (!data || !data.ended) {
      return interaction.reply({ content: "❌ Giveaway not found or not ended.", ephemeral: true });
    }

    const ch = await client.channels.fetch(data.channelId);
    const msg = await ch.messages.fetch(data.messageId);
    const reaction = msg.reactions.cache.get("🎉");
    if (!reaction) return;

    let users = (await reaction.users.fetch()).filter(u => !u.bot);
    if (users.size === 0) {
      return interaction.reply({ content: "❌ No users to reroll.", ephemeral: true });
    }

    const winner = users.random();

    ch.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔄 Giveaway Rerolled")
          .setDescription(`🎉 **New Winner:** <@${winner.id}>`)
          .setColor(0x3498db)
          .setFooter({ text: `Code: ${code}` })
      ]
    });

    interaction.reply({ content: "✅ Rerolled successfully.", ephemeral: true });
  }
});

/* =======================
   LOGIN (USE TOKEN)
======================= */
client.login(process.env.TOKEN);
