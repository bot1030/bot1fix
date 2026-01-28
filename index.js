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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

/* ================= STORAGE ================= */
const giveaways = new Map(); // messageId => giveaway
const tempGiveaways = new Map(); // userId => temp giveaway
const lastGiveawayByChannel = new Map(); // channelId => messageId

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName('create_giveaway')
    .setDescription('Create a giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Channel').setRequired(true))
    .addStringOption(o =>
      o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o =>
      o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize').setRequired(true))
    .addIntegerOption(o =>
      o.setName('winners').setDescription('Winners').setRequired(true))
    .addIntegerOption(o =>
      o.setName('hours').setDescription('Hours').setRequired(true))
    .addIntegerOption(o =>
      o.setName('minutes').setDescription('Minutes').setRequired(false))
    .addIntegerOption(o =>
      o.setName('seconds').setDescription('Seconds').setRequired(false))
    .addStringOption(o =>
      o.setName('f').setDescription('0 or number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll last giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Amount').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log('✅ Commands registered');
})();

/* ================= READY ================= */
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ================= INTERACTIONS ================= */
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
      minutes: interaction.options.getInteger('minutes') ?? 0,
      seconds: interaction.options.getInteger('seconds') ?? 0,
      fakeWinner: interaction.options.getString('f') ?? '0',
      requiredRoles: [],
      participants: new Set()
    };

    tempGiveaways.set(interaction.user.id, data);

    const roleMenu = new RoleSelectMenuBuilder()
      .setCustomId('giveaway_roles')
      .setPlaceholder('Select required roles (optional)')
      .setMinValues(0)
      .setMaxValues(5);

    const confirmBtn = new ButtonBuilder()
      .setCustomId('confirm_giveaway')
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success);

    await interaction.reply({
      content: 'Select roles and confirm',
      components: [
        new ActionRowBuilder().addComponents(roleMenu),
        new ActionRowBuilder().addComponents(confirmBtn)
      ],
      ephemeral: true
    });
  }

  /* ---------- ROLE SELECT ---------- */
  if (interaction.isRoleSelectMenu() && interaction.customId === 'giveaway_roles') {
    const data = tempGiveaways.get(interaction.user.id);
    if (!data) return;
    data.requiredRoles = interaction.values;
    await interaction.reply({ content: 'Roles saved', ephemeral: true });
  }

  /* ---------- CONFIRM GIVEAWAY ---------- */
  if (interaction.isButton() && interaction.customId === 'confirm_giveaway') {
    const data = tempGiveaways.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'No data', ephemeral: true });

    const durationMs =
      (data.hours * 3600 + data.minutes * 60 + data.seconds) * 1000;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${data.title}`)
      .setDescription(data.description)
      .setColor('Gold')
      .addFields(
        { name: 'Prize', value: data.prize, inline: true },
        { name: 'Winners', value: `${data.winners}`, inline: true },
        { name: 'Ends', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` },
        { name: 'Participants', value: '0' }
      );

    if (data.requiredRoles.length) {
      embed.addFields({
        name: 'Required Roles',
        value: data.requiredRoles.map(r => `<@&${r}>`).join(', ')
      });
    }

    const joinBtn = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('Join Giveaway')
      .setStyle(ButtonStyle.Success);

    const msg = await data.channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(joinBtn)]
    });

    giveaways.set(msg.id, data);
    lastGiveawayByChannel.set(msg.channel.id, msg.id);
    tempGiveaways.delete(interaction.user.id);

    setTimeout(async () => endGiveaway(msg.id), durationMs);

    await interaction.update({ content: 'Giveaway started', components: [] });
  }

  /* ---------- JOIN ---------- */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    const g = giveaways.get(interaction.message.id);
    if (!g) return interaction.reply({ content: 'Ended', ephemeral: true });

    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (g.requiredRoles.length &&
        !g.requiredRoles.some(r => member.roles.cache.has(r))) {
      return interaction.reply({ content: 'Missing role', ephemeral: true });
    }

    g.participants.add(interaction.user.id);

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.spliceFields(3, 1, {
      name: 'Participants',
      value: `${g.participants.size}`
    });

    await interaction.message.edit({ embeds: [embed] });
    await interaction.reply({ content: 'Joined', ephemeral: true });
  }

  /* ---------- REROLL ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === 'reroll') {
    const msgId = lastGiveawayByChannel.get(interaction.channel.id);
    if (!msgId) return interaction.reply({ content: 'No giveaway', ephemeral: true });
    await endGiveaway(msgId, true);
    await interaction.reply({ content: 'Rerolled' });
  }

  /* ---------- NUKE ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === 'nuke') {
    const amount = interaction.options.getInteger('amount');
    await interaction.channel.bulkDelete(amount, true);
    await interaction.reply({ content: `Deleted ${amount}`, ephemeral: true });
  }
});

/* ================= END GIVEAWAY ================= */
async function endGiveaway(messageId, reroll = false) {
  const g = giveaways.get(messageId);
  if (!g) return;

  let winners = [];

  if (!reroll && g.fakeWinner !== '0') {
    winners.push(`<@${g.fakeWinner}>`);
  } else {
    const pool = [...g.participants];
    while (winners.length < g.winners && pool.length) {
      winners.push(`<@${pool.splice(Math.floor(Math.random() * pool.length), 1)}>`);
    }
  }

  const channel = g.channel;
  await channel.send(`🎉 Winner(s): ${winners.join(', ') || 'None'}`);

  if (!reroll) giveaways.delete(messageId);
}

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
