require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const giveaways = new Map(); // messageId → data

/* ---------------- SLASH COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('F')
    .addChannelOption(o =>
      o.setName('channel').setDescription('Target channel').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('title').setDescription('Title').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('description').setDescription('Description').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('winners').setDescription('Winner count').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('hours').setDescription('Hours').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('minutes').setDescription('Minutes').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('seconds').setDescription('Seconds').setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('require_role').setDescription('Required role')
    )
    .addRoleOption(o =>
      o.setName('ping_role').setDescription('Ping role')
    )
    .addStringOption(o =>
      o.setName('f').setDescription('F').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('F')
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

/* ---------------- READY ---------------- */

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ---------------- INTERACTIONS ---------------- */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* -------- GIVEAWAY -------- */

  if (interaction.commandName === 'giveaway') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');
    const hours = interaction.options.getInteger('hours');
    const minutes = interaction.options.getInteger('minutes');
    const seconds = interaction.options.getInteger('seconds');
    const requireRole = interaction.options.getRole('require_role');
    const pingRole = interaction.options.getRole('ping_role');
    const fakeWinner = interaction.options.getString('f');

    const duration =
      (hours * 3600 + minutes * 60 + seconds) * 1000;
    const endTime = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle('F')
      .setColor(0x2B2D31)
      .setDescription(`**${title}**\n${description}\n\n**${prize}**`)
      .addFields(
        { name: 'Ends', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
        { name: 'Access', value: requireRole ? `<@&${requireRole.id}>` : 'Public', inline: true },
        { name: 'Status', value: 'Waiting', inline: true }
      )
      .setFooter({ text: 'F' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('join')
        .setLabel('F')
        .setStyle(ButtonStyle.Secondary)
    );

    const msg = await channel.send({
      content: pingRole ? `<@&${pingRole.id}>` : null,
      embeds: [embed],
      components: [row]
    });

    await msg.react('🎉');

    giveaways.set(msg.id, {
      channelId: channel.id,
      messageId: msg.id,
      winners,
      fakeWinner,
      requireRole,
      endTime
    });

    interaction.reply({ content: '✅', ephemeral: true });

    setTimeout(async () => endGiveaway(msg.id), duration);
  }

  /* -------- REROLL -------- */

  if (interaction.commandName === 'reroll') {
    const last = [...giveaways.values()].pop();
    if (!last) return interaction.reply({ content: '❌', ephemeral: true });

    const channel = await client.channels.fetch(last.channelId);
    const message = await channel.messages.fetch(last.messageId);

    const reaction = message.reactions.cache.get('🎉');
    const users = (await reaction.users.fetch()).filter(u => !u.bot);

    const winner = users.random();
    channel.send(`F → <@${winner.id}>`);
    interaction.reply({ content: 'F', ephemeral: true });
  }
});

/* ---------------- END GIVEAWAY ---------------- */

async function endGiveaway(messageId) {
  const data = giveaways.get(messageId);
  if (!data) return;

  const channel = await client.channels.fetch(data.channelId);
  const message = await channel.messages.fetch(messageId);

  const reaction = message.reactions.cache.get('🎉');
  let users = (await reaction.users.fetch()).filter(u => !u.bot);

  if (data.requireRole) {
    users = users.filter(u =>
      channel.guild.members.cache.get(u.id)?.roles.cache.has(data.requireRole.id)
    );
  }

  let winners = [];

  if (data.fakeWinner !== '0') {
    winners = [`<@${data.fakeWinner}>`];
  } else {
    winners = users.random(data.winners).map(u => `<@${u.id}>`);
  }

  channel.send(`F → ${winners.join(', ')}`);
  giveaways.delete(messageId);
}

/* ---------------- LOGIN ---------------- */

client.login(process.env.TOKEN);
