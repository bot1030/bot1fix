require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Store giveaways in memory (simple + works)
const giveaways = new Map();

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway')
    .addStringOption(o =>
      o.setName('prize')
        .setDescription('What is the prize?')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('duration')
        .setDescription('Duration in minutes')
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('require_role')
        .setDescription('Role required to join (optional)')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('ping_role')
        .setDescription('Role to ping for giveaway (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll the last giveaway')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Commands registered');
  } catch (err) {
    console.error(err);
  }
})();

/* ---------------- BOT READY ---------------- */

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {
  /* -------- GIVEAWAY COMMAND -------- */
  if (interaction.isChatInputCommand() && interaction.commandName === 'giveaway') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const prize = interaction.options.getString('prize');
    const duration = interaction.options.getInteger('duration');
    const requireRole = interaction.options.getRole('require_role');
    const pingRole = interaction.options.getRole('ping_role');

    const endTime = Date.now() + duration * 60 * 1000;

    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(
        `🏆 **Prize:** ${prize}\n\n` +
        `⏰ **Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\n` +
        `👥 **Participants:** 0\n\n` +
        `🔐 **Requirement:** ${
          requireRole ? `<@&${requireRole.id}>` : 'None'
        }`
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'Click the button below to join!' });

    const button = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('🎁 Join Giveaway')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    const content = pingRole ? `<@&${pingRole.id}>` : null;

    const message = await interaction.channel.send({
      content,
      embeds: [embed],
      components: [row]
    });

    giveaways.set(message.id, {
      prize,
      endTime,
      requireRoleId: requireRole?.id || null,
      participants: new Set(),
      messageId: message.id,
      channelId: interaction.channel.id
    });

    interaction.reply({ content: '✅ Giveaway created!', ephemeral: true });

    // Auto end
    setTimeout(async () => {
      const data = giveaways.get(message.id);
      if (!data) return;

      const users = Array.from(data.participants);
      let winner = null;

      if (users.length > 0) {
        winner = users[Math.floor(Math.random() * users.length)];
      }

      const endEmbed = EmbedBuilder.from(embed)
        .setDescription(
          `🏆 **Prize:** ${prize}\n\n` +
          `👑 **Winner:** ${winner ? `<@${winner}>` : 'No participants 😢'}`
        )
        .setFooter({ text: 'Giveaway ended' });

      await message.edit({ embeds: [endEmbed], components: [] });

      giveaways.set('last', data);
    }, duration * 60 * 1000);
  }

  /* -------- JOIN BUTTON -------- */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    const data = giveaways.get(interaction.message.id);
    if (!data) return interaction.reply({ content: '❌ Giveaway expired.', ephemeral: true });

    if (data.requireRoleId && !interaction.member.roles.cache.has(data.requireRoleId)) {
      return interaction.reply({
        content: '❌ You do not have the required role.',
        ephemeral: true
      });
    }

    data.participants.add(interaction.user.id);

    interaction.reply({ content: '🎉 You joined the giveaway!', ephemeral: true });
  }

  /* -------- REROLL COMMAND -------- */
  if (interaction.isChatInputCommand() && interaction.commandName === 'reroll') {
    const data = giveaways.get('last');

    if (!data || data.participants.size === 0) {
      return interaction.reply({ content: '❌ No giveaway to reroll.', ephemeral: true });
    }

    const users = Array.from(data.participants);
    const winner = users[Math.floor(Math.random() * users.length)];

    interaction.reply({
      content: `🔄 **New winner:** <@${winner}> 🎉`
    });
  }
});

/* ---------------- LOGIN ---------------- */

client.login(process.env.TOKEN);
