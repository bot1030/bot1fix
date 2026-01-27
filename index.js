require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  PermissionsBitField, 
  EmbedBuilder 
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ]
});

/* ====== SLASH COMMAND ====== */
const commands = [
  new SlashCommandBuilder()
    .setName('create-giveaway')
    .setDescription('Create a giveaway')
    .addChannelOption(o =>
      o.setName('channel').setDescription('Giveaway channel').setRequired(true))
    .addStringOption(o =>
      o.setName('title').setDescription('Giveaway title').setRequired(true))
    .addStringOption(o =>
      o.setName('description').setDescription('Description').setRequired(true))
    .addIntegerOption(o =>
      o.setName('winners').setDescription('Winner count').setRequired(true))
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize').setRequired(true))
    .addRoleOption(o =>
      o.setName('role')
       .setDescription('Required role (optional)')
       .setRequired(false))
    .addRoleOption(o =>
      o.setName('ping')
       .setDescription('Ping role (optional)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('f')
       .setDescription('Fake winner user ID (0 = random)')
       .setRequired(false))
].map(c => c.toJSON());

/* ====== REGISTER COMMAND ====== */
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Commands registered.');
  } catch (err) {
    console.error(err);
  }
})();

/* ====== BOT READY ====== */
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ====== INTERACTION ====== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'create-giveaway') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Admins only.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const desc = interaction.options.getString('description');
    const winners = interaction.options.getInteger('winners');
    const prize = interaction.options.getString('prize');
    const role = interaction.options.getRole('role');
    const ping = interaction.options.getRole('ping');
    const fakeWinner = interaction.options.getString('f') || '0';

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setDescription(desc)
      .addFields(
        { name: 'Prize', value: prize, inline: true },
        { name: 'Winners', value: `${winners}`, inline: true },
        { name: 'Requirement', value: role ? role.toString() : 'None' }
      )
      .setColor(0xffc300)
      .setFooter({ text: 'React with 🎉 to join!' });

    const msg = await channel.send({
      content: ping ? ping.toString() : null,
      embeds: [embed]
    });

    await msg.react('🎉');

    interaction.reply({ content: 'Giveaway created!', ephemeral: true });
  }
});

/* ====== LOGIN ====== */
client.login(process.env.TOKEN);
