require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// ===== SLASH COMMAND =====
const commands = [
  new SlashCommandBuilder()
    .setName('create_giveaway')
    .setDescription('Create a giveaway (admin only)')
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
    .addIntegerOption(o =>
      o.setName('hours')
        .setDescription('Hours')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('minutes')
        .setDescription('Minutes')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('seconds')
        .setDescription('Seconds')
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('required_role')
        .setDescription('Role required to enter')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('ping_role')
        .setDescription('Role to ping')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('f')
        .setDescription('F')
        .setRequired(true)
    )
    .toJSON()
];

// ===== REGISTER COMMAND =====
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered');
  } catch (err) {
    console.error(err);
  }
})();

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== GIVEAWAY HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'create_giveaway') return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }

  const channel = interaction.options.getChannel('channel');
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const prize = interaction.options.getString('prize');
  const winnersCount = interaction.options.getInteger('winners');
  const hours = interaction.options.getInteger('hours');
  const minutes = interaction.options.getInteger('minutes');
  const seconds = interaction.options.getInteger('seconds');
  const requiredRole = interaction.options.getRole('required_role');
  const pingRole = interaction.options.getRole('ping_role');
  const fakeWinner = interaction.options.getString('f');

  const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (durationMs <= 0) {
    return interaction.reply({ content: '❌ Invalid duration.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${title}`)
    .setDescription(description)
    .addFields(
      { name: '🏆 Prize', value: prize, inline: true },
      { name: '👥 Winners', value: `${winnersCount}`, inline: true },
      { name: '⏳ Ends in', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
      { name: '🎭 Requirement', value: requiredRole ? `<@&${requiredRole.id}>` : 'None' }
    )
    .setColor(0x00ffcc)
    .setFooter({ text: 'React with 🎉 to enter!' });

  const pingText = pingRole ? `<@&${pingRole.id}>` : '';
  const msg = await channel.send({ content: pingText, embeds: [embed] });
  await msg.react('🎉');

  await interaction.reply({ content: '✅ Giveaway created!', ephemeral: true });

  setTimeout(async () => {
    const fetched = await msg.fetch();
    const reaction = fetched.reactions.cache.get('🎉');
    if (!reaction) return;

    let users = await reaction.users.fetch();
    users = users.filter(u => !u.bot);

    if (requiredRole) {
      users = users.filter(u =>
        fetched.guild.members.cache.get(u.id)?.roles.cache.has(requiredRole.id)
      );
    }

    let winners = [];

    if (fakeWinner !== '0') {
      const forced = await client.users.fetch(fakeWinner).catch(() => null);
      if (forced) winners.push(forced);
    } else {
      users = Array.from(users.values());
      for (let i = 0; i < winnersCount && users.length; i++) {
        winners.push(users.splice(Math.floor(Math.random() * users.length), 1)[0]);
      }
    }

    const endEmbed = new EmbedBuilder()
      .setTitle('🎊 Giveaway Ended!')
      .setDescription(
        winners.length
          ? winners.map(w => `<@${w.id}>`).join(', ')
          : 'No valid participants.'
      )
      .setColor(0xffcc00);

    channel.send({ embeds: [endEmbed] });
  }, durationMs);
});

// ===== LOGIN =====
client.login(process.env.TOKEN);
