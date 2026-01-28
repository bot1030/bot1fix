require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const giveaways = new Map(); // messageId => giveaway data

/* ---------------- REGISTER COMMAND ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('create_giveaway')
    .setDescription('Create a giveaway (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Giveaway channel').setRequired(true))
    .addStringOption(o =>
      o.setName('title').setDescription('Giveaway title').setRequired(true))
    .addStringOption(o =>
      o.setName('description').setDescription('Giveaway description').setRequired(true))
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize').setRequired(true))
    .addIntegerOption(o =>
      o.setName('winners').setDescription('Number of winners').setRequired(true))
    .addIntegerOption(o =>
      o.setName('hours').setDescription('Hours').setRequired(true))
    .addIntegerOption(o =>
      o.setName('minutes').setDescription('Minutes').setRequired(true))
    .addIntegerOption(o =>
      o.setName('seconds').setDescription('Seconds').setRequired(true))
    .addStringOption(o =>
      o.setName('f')
        .setDescription('Fake winner ID or 0')
        .setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log('✅ Slash command registered');
})();

/* ---------------- BOT READY ---------------- */

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {

  /* ---------- CREATE GIVEAWAY ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === 'create_giveaway') {

    const data = {
      channel: interaction.options.getChannel('channel'),
      title: interaction.options.getString('title'),
      description: interaction.options.getString('description'),
      prize: interaction.options.getString('prize'),
      winners: interaction.options.getInteger('winners'),
      hours: interaction.options.getInteger('hours'),
      minutes: interaction.options.getInteger('minutes'),
      seconds: interaction.options.getInteger('seconds'),
      fakeWinner: interaction.options.getString('f'),
      requiredRoles: [],
      participants: new Set()
    };

    interaction.client.tempGiveaway = data;

    const roleMenu = new RoleSelectMenuBuilder()
      .setCustomId('select_roles')
      .setPlaceholder('Select required roles (optional)')
      .setMinValues(0)
      .setMaxValues(5);

    const row = new ActionRowBuilder().addComponents(roleMenu);

    await interaction.reply({
      content: '🔐 Select required roles (or skip)',
      components: [row],
      ephemeral: true
    });
  }

  /* ---------- ROLE SELECT ---------- */
  if (interaction.isRoleSelectMenu() && interaction.customId === 'select_roles') {
    const data = interaction.client.tempGiveaway;
    data.requiredRoles = interaction.values;

    const durationMs =
      (data.hours * 3600 + data.minutes * 60 + data.seconds) * 1000;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${data.title}`)
      .setDescription(data.description)
      .addFields(
        { name: '🏆 Prize', value: data.prize, inline: true },
        { name: '👥 Winners', value: `${data.winners}`, inline: true },
        { name: '⏳ Ends', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` },
        { name: '📊 Participants', value: '0' }
      )
      .setColor('Gold');

    if (data.requiredRoles.length) {
      embed.addFields({
        name: '🔐 Required Roles',
        value: data.requiredRoles.map(r => `<@&${r}>`).join(', ')
      });
    }

    const button = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('🎉 Join Giveaway')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    const msg = await data.channel.send({
      embeds: [embed],
      components: [row]
    });

    giveaways.set(msg.id, data);

    setTimeout(async () => {
      const g = giveaways.get(msg.id);
      if (!g) return;

      let winners = [];

      if (g.fakeWinner !== '0') {
        winners.push(`<@${g.fakeWinner}>`);
      } else {
        const pool = [...g.participants];
        while (winners.length < g.winners && pool.length) {
          winners.push(`<@${pool.splice(Math.floor(Math.random() * pool.length), 1)}>`);
        }
      }

      await msg.reply(`🎉 **Giveaway Ended!**\nWinner(s): ${winners.join(', ') || 'No participants 😢'}`);
      giveaways.delete(msg.id);
    }, durationMs);

    await interaction.update({ content: '✅ Giveaway started!', components: [] });
  }

  /* ---------- JOIN GIVEAWAY ---------- */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    const g = giveaways.get(interaction.message.id);
    if (!g) return interaction.reply({ content: '❌ Giveaway ended.', ephemeral: true });

    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (g.requiredRoles.length &&
        !g.requiredRoles.some(r => member.roles.cache.has(r))) {
      return interaction.reply({
        content: '❌ You do not meet the role requirements.',
        ephemeral: true
      });
    }

    g.participants.add(interaction.user.id);

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.spliceFields(3, 1, {
      name: '📊 Participants',
      value: `${g.participants.size}`
    });

    await interaction.message.edit({ embeds: [embed] });
    await interaction.reply({ content: '✅ Joined!', ephemeral: true });
  }
});

/* ---------------- LOGIN ---------------- */
client.login(process.env.TOKEN);
