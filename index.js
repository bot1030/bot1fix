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

const activeGiveaways = new Map();
const endedGiveaways = [];

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway')
    .addStringOption(o => o.setName('title').setRequired(true))
    .addStringOption(o => o.setName('description').setRequired(true))
    .addStringOption(o => o.setName('prize').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setRequired(true))
    .addIntegerOption(o => o.setName('minutes'))
    .addIntegerOption(o => o.setName('seconds'))
    .addIntegerOption(o => o.setName('f'))
    .addRoleOption(o => o.setName('role1'))
    .addRoleOption(o => o.setName('role2'))
    .addRoleOption(o => o.setName('role3')),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Reroll last giveaway'),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete messages')
    .addIntegerOption(o => o.setName('amount').setRequired(true))
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

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {

    /* ===== GIVEAWAY ===== */
    if (interaction.commandName === 'giveaway') {
      const minutes = interaction.options.getInteger('minutes') || 0;
      const seconds = interaction.options.getInteger('seconds') || 0;
      const duration = (minutes * 60 + seconds) * 1000;
      if (duration <= 0) {
        return interaction.reply({ content: 'Time must be more than 0', ephemeral: true });
      }

      const roles = ['role1', 'role2', 'role3']
        .map(r => interaction.options.getRole(r))
        .filter(Boolean)
        .map(r => r.id);

      const giveaway = {
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        prize: interaction.options.getString('prize'),
        winners: interaction.options.getInteger('winners'),
        fake: interaction.options.getInteger('f') || 0,
        roles,
        users: [],
        endsAt: Date.now() + duration,
        channelId: interaction.channel.id
      };

      const embed = new EmbedBuilder()
        .setTitle(`🎉 ${giveaway.title}`)
        .setDescription(giveaway.description)
        .setColor('Gold')
        .addFields(
          { name: 'Prize', value: giveaway.prize, inline: true },
          { name: 'Winners', value: `${giveaway.winners}`, inline: true },
          { name: 'Participants', value: '0', inline: true },
          { name: 'Ends', value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>` }
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
      activeGiveaways.set(msg.id, giveaway);

      setTimeout(() => endGiveaway(msg.id), duration);

      interaction.reply({ content: 'Giveaway created!', ephemeral: true });
    }

    /* ===== REROLL ===== */
    if (interaction.commandName === 'reroll') {
      const last = endedGiveaways.at(-1);
      if (!last) {
        return interaction.reply({ content: 'No ended giveaway to reroll', ephemeral: true });
      }

      const winners = pickWinners(last.users, last.winners);
      const channel = await client.channels.fetch(last.channelId);

      await channel.send(
        `🔁 **REROLL**\n🎉 Congratulations ${winners.join(', ')}!\nYou won **${last.prize}**`
      );

      interaction.reply({ content: 'Rerolled!', ephemeral: true });
    }

    /* ===== NUKE ===== */
    if (interaction.commandName === 'nuke') {
      const amount = interaction.options.getInteger('amount');
      await interaction.channel.bulkDelete(amount, true);
      await interaction.channel.send(`💣 Nuked ${amount} messages`);
      await interaction.reply({ content: 'Done', ephemeral: true });
    }
  }

  /* ===== JOIN BUTTON ===== */
  if (interaction.isButton() && interaction.customId === 'join_giveaway') {
    const giveaway = activeGiveaways.get(interaction.message.id);
    if (!giveaway) {
      return interaction.reply({ content: 'Giveaway ended', ephemeral: true });
    }

    if (giveaway.roles.length) {
      if (!giveaway.roles.some(r => interaction.member.roles.cache.has(r))) {
        return interaction.reply({ content: 'You do not meet requirements', ephemeral: true });
      }
    }

    if (!giveaway.users.includes(interaction.user.id)) {
      giveaway.users.push(interaction.user.id);
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.data.fields = embed.data.fields.map(f =>
      f.name === 'Participants'
        ? { name: 'Participants', value: `${giveaway.users.length}`, inline: true }
        : f
    );

    await interaction.message.edit({ embeds: [embed] });
    interaction.reply({ content: 'Joined!', ephemeral: true });
  }
});

/* ================= END GIVEAWAY ================= */
async function endGiveaway(messageId) {
  const giveaway = activeGiveaways.get(messageId);
  if (!giveaway) return;

  const channel = await client.channels.fetch(giveaway.channelId);
  const winners = pickWinners(giveaway.users, giveaway.winners);

  if (winners.length) {
    await channel.send(
      `🎉 Congratulations ${winners.join(', ')}!\nYou won **${giveaway.prize}**`
    );
  } else {
    await channel.send('No valid participants.');
  }

  endedGiveaways.push(giveaway);
  activeGiveaways.delete(messageId);
}

function pickWinners(users, count) {
  return [...users]
    .sort(() => 0.5 - Math.random())
    .slice(0, count)
    .map(u => `<@${u}>`);
}

client.login(process.env.TOKEN);
