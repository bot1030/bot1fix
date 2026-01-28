require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const giveaways = new Map();

/* ======================
   SLASH COMMANDS
====================== */
const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway')
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes (optional)'))
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (optional)'))
    .addIntegerOption(o => o.setName('f').setDescription('0 or number'))
    .addRoleOption(o => o.setName('role1').setDescription('Required role'))
    .addRoleOption(o => o.setName('role2').setDescription('Required role'))
    .addRoleOption(o => o.setName('role3').setDescription('Required role')),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll last giveaway'),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete messages')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands.map(c => c.toJSON()) }
  );
});

/* ======================
   INTERACTIONS
====================== */
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    /* ===== GIVEAWAY ===== */
    if (interaction.commandName === 'giveaway') {
      const minutes = interaction.options.getInteger('minutes') || 0;
      const seconds = interaction.options.getInteger('seconds') || 0;
      const durationMs = (minutes * 60 + seconds) * 1000;
      if (durationMs <= 0) {
        return interaction.reply({ content: 'Time must be > 0', ephemeral: true });
      }

      const roles = ['role1', 'role2', 'role3']
        .map(r => interaction.options.getRole(r))
        .filter(Boolean)
        .map(r => r.id);

      const data = {
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        prize: interaction.options.getString('prize'),
        winners: interaction.options.getInteger('winners'),
        fake: interaction.options.getInteger('f') || 0,
        roles,
        users: [],
        endsAt: Date.now() + durationMs
      };

      const embed = new EmbedBuilder()
        .setTitle(`🎉 ${data.title}`)
        .setDescription(data.description)
        .setColor('Gold')
        .addFields(
          { name: 'Prize', value: data.prize, inline: true },
          { name: 'Winners', value: `${data.winners}`, inline: true },
          { name: 'Ends', value: `<t:${Math.floor(data.endsAt / 1000)}:R>` },
          { name: 'Participants', value: '0', inline: true }
        );

      if (roles.length) {
        embed.addFields({
          name: 'Requirements',
          value: roles.map(r => `<@&${r}>`).join(', ')
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('join_giveaway')
          .setLabel('🎉 Join Giveaway')
          .setStyle(ButtonStyle.Success)
      );

      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
      giveaways.set(msg.id, data);

      setTimeout(() => endGiveaway(msg, interaction.channel), durationMs);

      await interaction.reply({ content: 'Giveaway created!', ephemeral: true });
    }

    /* ===== REROLL ===== */
    if (interaction.commandName === 'reroll') {
      const last = [...giveaways.entries()].pop();
      if (!last) return interaction.reply({ content: 'No giveaway found', ephemeral: true });

      const [id, g] = last;
      const channel = interaction.channel;
      const winners = pickWinners(g.users, g.winners);

      await channel.send(
        `🔁 **REROLL**\n🎉 Congratulations ${winners.join(', ')}!\nYou won **${g.prize}**`
      );

      interaction.reply({ content: 'Rerolled!', ephemeral: true });
    }

    /* ===== NUKE ===== */
    if (interaction.commandName === 'nuke') {
      const amount = interaction.options.getInteger('amount');
      await interaction.channel.bulkDelete(amount, true);
      interaction.reply({ content: `💣 Deleted ${amount} messages`, ephemeral: true });
    }
  }

  /* ===== BUTTON JOIN ===== */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    const g = giveaways.get(interaction.message.id);
    if (!g) return interaction.reply({ content: 'Giveaway ended', ephemeral: true });

    if (g.roles.length) {
      const member = interaction.member;
      if (!g.roles.some(r => member.roles.cache.has(r))) {
        return interaction.reply({ content: 'You do not meet the role requirements', ephemeral: true });
      }
    }

    if (!g.users.includes(interaction.user.id)) {
      g.users.push(interaction.user.id);
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.data.fields = embed.data.fields.map(f =>
      f.name === 'Participants'
        ? { name: 'Participants', value: `${g.users.length}`, inline: true }
        : f
    );

    await interaction.message.edit({ embeds: [embed] });
    await interaction.reply({ content: 'You joined the giveaway!', ephemeral: true });
  }
});

/* ======================
   GIVEAWAY END
====================== */
async function endGiveaway(msg, channel) {
  const g = giveaways.get(msg.id);
  if (!g) return;

  const winners = pickWinners(g.users, g.winners);

  if (winners.length) {
    await channel.send(
      `🎉 Congratulations ${winners.join(', ')}!\nYou won **${g.prize}**`
    );
  } else {
    await channel.send('No valid participants.');
  }

  giveaways.delete(msg.id);
}

function pickWinners(users, count) {
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(u => `<@${u}>`);
}

/* ======================
   LOGIN
====================== */
client.login(process.env.TOKEN);
