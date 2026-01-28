require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('create_giveaway')
    .setDescription('Create a giveaway')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Giveaway channel')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('title')
        .setDescription('Giveaway title')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('description')
        .setDescription('Giveaway description')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('prize')
        .setDescription('Prize')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('winners')
        .setDescription('Number of winners')
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('role_1')
        .setDescription('Required role 1')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_2')
        .setDescription('Required role 2')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('ping_role')
        .setDescription('Role to ping')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('f')
        .setDescription('0 or number')
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('hours')
        .setDescription('0 or number')
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('minutes')
        .setDescription('0 or number')
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('seconds')
        .setDescription('0 or number')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll last giveaway'),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete messages')
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('0 or number')
        .setRequired(true)
    )
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('✅ Slash commands registered');
})();

/* ---------------- GIVEAWAY STORAGE ---------------- */

let lastGiveaway = null;

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* ---------- NUKE ---------- */
  if (interaction.commandName === 'nuke') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Admin only', ephemeral: true });

    const amount = interaction.options.getInteger('amount');
    const messages = await interaction.channel.bulkDelete(amount, true);

    return interaction.reply(`💣 Nuked **${messages.size}** messages`);
  }

  /* ---------- CREATE GIVEAWAY ---------- */
  if (interaction.commandName === 'create_giveaway') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Admin only', ephemeral: true });

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const desc = interaction.options.getString('description');
    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');

    const role1 = interaction.options.getRole('role_1');
    const role2 = interaction.options.getRole('role_2');
    const pingRole = interaction.options.getRole('ping_role');

    const fakeWinner = interaction.options.getString('f') || '0';

    const hours = interaction.options.getInteger('hours') || 0;
    const minutes = interaction.options.getInteger('minutes') || 0;
    const seconds = interaction.options.getInteger('seconds') || 0;

    const duration =
      (hours * 3600 + minutes * 60 + seconds) * 1000;

    if (duration <= 0)
      return interaction.reply({ content: '❌ Duration must be > 0', ephemeral: true });

    const endAt = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setDescription(desc)
      .addFields(
        { name: '🏆 Prize', value: prize },
        { name: '👥 Winners', value: `${winners}` },
        {
          name: '🔒 Requirements',
          value: `${role1 ? role1 : 'None'} ${role2 ? role2 : ''}`
        },
        { name: '⏰ Ends', value: `<t:${Math.floor(endAt / 1000)}:R>` },
        { name: '👤 Participants', value: '0' }
      )
      .setColor('Gold');

    const joinBtn = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('🎉 Join Giveaway')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(joinBtn);

    const msg = await channel.send({
      content: pingRole ? `${pingRole}` : null,
      embeds: [embed],
      components: [row]
    });

    lastGiveaway = {
      messageId: msg.id,
      channelId: channel.id,
      endAt,
      winners,
      prize,
      fakeWinner,
      role1,
      role2,
      participants: new Set()
    };

    interaction.reply({ content: '✅ Giveaway created', ephemeral: true });

    setTimeout(async () => {
      const winnersList = [];

      if (fakeWinner !== '0') {
        winnersList.push(`<@${fakeWinner}>`);
      } else {
        const arr = Array.from(lastGiveaway.participants);
        for (let i = 0; i < winners && arr.length > 0; i++) {
          const pick = arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
          winnersList.push(`<@${pick}>`);
        }
      }

      channel.send(
        `🎉 **Congratulations ${winnersList.join(', ')}**!\n🏆 **Prize:** ${prize}`
      );
    }, duration);
  }

  /* ---------- REROLL ---------- */
  if (interaction.commandName === 'reroll') {
    if (!lastGiveaway)
      return interaction.reply({ content: '❌ No giveaway found', ephemeral: true });

    const arr = Array.from(lastGiveaway.participants);
    if (arr.length === 0)
      return interaction.reply({ content: '❌ No participants', ephemeral: true });

    const pick = arr[Math.floor(Math.random() * arr.length)];
    interaction.reply(
      `🔁 **Rerolled Winner:** <@${pick}>\n🏆 **Prize:** ${lastGiveaway.prize}`
    );
  }
});

/* ---------- BUTTON HANDLER ---------- */

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'join_giveaway') {
    if (!lastGiveaway) return interaction.reply({ content: '❌ Giveaway ended', ephemeral: true });

    if (
      (lastGiveaway.role1 && !interaction.member.roles.cache.has(lastGiveaway.role1.id)) ||
      (lastGiveaway.role2 && !interaction.member.roles.cache.has(lastGiveaway.role2.id))
    ) {
      return interaction.reply({ content: '❌ You do not meet requirements', ephemeral: true });
    }

    lastGiveaway.participants.add(interaction.user.id);
    interaction.reply({ content: '✅ Joined giveaway', ephemeral: true });
  }
});

/* ---------------- LOGIN ---------------- */

client.login(TOKEN);
