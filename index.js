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
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

/* ---------------- COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('create_giveaway')
    .setDescription('Create a giveaway')
    .addChannelOption(o =>
      o.setName('channel').setDescription('Giveaway channel').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('title').setDescription('Giveaway title').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('description').setDescription('Giveaway description').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('winners').setDescription('Number of winners').setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('role_1').setDescription('Required role').setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_2').setDescription('Required role').setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('ping_role').setDescription('Ping role').setRequired(false)
    )
    .addStringOption(o =>
      o.setName('f').setDescription('0 or number').setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('hours').setDescription('0 or number').setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('minutes').setDescription('0 or number').setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('seconds').setDescription('0 or number').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll last giveaway'),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete messages')
    .addIntegerOption(o =>
      o.setName('amount').setDescription('0 or number').setRequired(true)
    )
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map(c => c.toJSON())
  });
})();

/* ---------------- GIVEAWAY DATA ---------------- */

let lastGiveaway = null;

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {

    /* -------- NUKE -------- */
    if (interaction.commandName === 'nuke') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: '❌ Admin only', ephemeral: true });

      const amount = interaction.options.getInteger('amount');
      const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply(`💣 Nuked **${deleted.size}** messages`);
    }

    /* -------- CREATE GIVEAWAY -------- */
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

      const Lk1 = interaction.options.getString('f') || '0';

      const hours = interaction.options.getInteger('hours') || 0;
      const minutes = interaction.options.getInteger('minutes') || 0;
      const seconds = interaction.options.getInteger('seconds') || 0;

      const duration = (hours * 3600 + minutes * 60 + seconds) * 1000;
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

      const button = new ButtonBuilder()
        .setCustomId('join_giveaway')
        .setLabel('🎉 Join Giveaway')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(button);

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
        Lk1,
        role1,
        role2,
        participants: new Set()
      };

      interaction.reply({ content: '✅ Giveaway created', ephemeral: true });

      setTimeout(async () => {
        const list = [];

        if (lastGiveaway.Lk1 !== '0') {
          list.push(`<@${lastGiveaway.Lk1}>`);
        } else {
          const arr = [...lastGiveaway.participants];
          for (let i = 0; i < winners && arr.length; i++) {
            list.push(`<@${arr.splice(Math.floor(Math.random() * arr.length), 1)[0]}>`);
          }
        }

        channel.send(`🎉 **Congratulations ${list.join(', ')}**\n🏆 **Prize:** ${prize}`);
      }, duration);
    }

    /* -------- REROLL -------- */
    if (interaction.commandName === 'reroll') {
      if (!lastGiveaway)
        return interaction.reply({ content: '❌ No giveaway found', ephemeral: true });

      const arr = [...lastGiveaway.participants];
      if (!arr.length)
        return interaction.reply({ content: '❌ No participants', ephemeral: true });

      const pick = arr[Math.floor(Math.random() * arr.length)];
      interaction.reply(`🔁 **Rerolled Winner:** <@${pick}>\n🏆 **Prize:** ${lastGiveaway.prize}`);
    }
  }

  /* -------- JOIN BUTTON -------- */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    if (!lastGiveaway)
      return interaction.reply({ content: '❌ Giveaway ended', ephemeral: true });

    if (
      (lastGiveaway.role1 && !interaction.member.roles.cache.has(lastGiveaway.role1.id)) ||
      (lastGiveaway.role2 && !interaction.member.roles.cache.has(lastGiveaway.role2.id))
    ) {
      return interaction.reply({ content: '❌ You do not meet requirements', ephemeral: true });
    }

    if (lastGiveaway.participants.has(interaction.user.id)) {
      return interaction.reply({ content: '⚠️ Already joined', ephemeral: true });
    }

    lastGiveaway.participants.add(interaction.user.id);

    const channel = await client.channels.fetch(lastGiveaway.channelId);
    const message = await channel.messages.fetch(lastGiveaway.messageId);

    const embed = EmbedBuilder.from(message.embeds[0]);
    embed.setFields(
      embed.data.fields.map(f =>
        f.name === '👤 Participants'
          ? { name: '👤 Participants', value: `${lastGiveaway.participants.size}` }
          : f
      )
    );

    await message.edit({ embeds: [embed] });
    interaction.reply({ content: '✅ Joined giveaway', ephemeral: true });
  }
});

/* ---------------- LOGIN ---------------- */

client.login(TOKEN);
