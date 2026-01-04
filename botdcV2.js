// ============================================
// EXPRESS SERVER UNTUK RENDER PORT BINDING
// ============================================
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware basic
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// HEALTH CHECK ENDPOINTS (UNTUK RENDER)
// ============================================

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Discord Ticket Bot',
    endpoints: [
      '/health',
      '/status',
      '/uptime'
    ],
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  const bot = global.client?.user ? {
    tag: global.client.user.tag,
    id: global.client.user.id,
    status: global.client.status
  } : null;
  
  res.json({
    bot: bot,
    guilds: global.client?.guilds?.cache.size || 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Uptime endpoint
app.get('/uptime', (req, res) => {
  const uptime = process.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  res.json({
    uptime: uptime,
    formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available: ['/', '/health', '/status', '/uptime']
  });
});

// ============================================
// START EXPRESS SERVER
// ============================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`✅ Express server running on port ${PORT}`);
  console.log('='.repeat(50));
});

// ============================================
// DISCORD BOT CODE
// ============================================
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType, 
  PermissionsBitField, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  Collection 
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ]
});

// Export client untuk global access
global.client = client;

const config = {
  prefix: '!',
  ticketCategory: '── 「 ✦ ! ORDER  ! ✦ 」──',
  adminRole: 'KING',
  logChannel: 't┊・✨﹕ticket﹒logs',
  supportRoles: ['Support', 'Moderator'],
};

const colors = {
  primary: 0x5865F2,
  success: 0x57F287,
  warning: 0xFEE75C,
  error: 0xED4245,
  info: 0x3498DB
};

// Cache in-memory
const ticketCache = {
  activeTickets: new Collection(),
  ticketCounter: new Collection(),
};

// Rate limiting
const rateLimits = new Collection();
const RATE_LIMIT = {
  createTicket: 30000,
  closeTicket: 10000,
};

// URL gambar untuk embed
const embedImages = {
  supportSystem: 'https://image2url.com/r2/default/images/1767535768451-bff62cab-083a-41c1-961d-e4a237ae8808.blob',
  ticketLogs: 'https://image2url.com/r2/default/images/1767535768451-bff62cab-083a-41c1-961d-e4a237ae8808.blob',
  ticketClosed: 'https://image2url.com/r2/default/images/1767535768451-bff62cab-083a-41c1-961d-e4a237ae8808.blob'
};

// Helper functions
function isRateLimited(userId, action) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const userLimit = rateLimits.get(key);
  
  if (userLimit) {
    if (now - userLimit < RATE_LIMIT[action]) {
      return true;
    }
  }
  
  rateLimits.set(key, now);
  setTimeout(() => rateLimits.delete(key), RATE_LIMIT[action]);
  return false;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours} jam ${minutes % 60} menit`;
  if (minutes > 0) return `${minutes} menit`;
  return `${seconds} detik`;
}

function isAdmin(member) {
  if (!member) return false;
  
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  
  if (config.adminRole && member.roles.cache.some(role => role.name === config.adminRole)) {
    return true;
  }
  
  return false;
}

async function sendTempMessage(channel, content, duration = 5000) {
  try {
    const msg = await channel.send(content);
    setTimeout(() => msg.delete().catch(() => {}), duration);
    return msg;
  } catch (error) {
    console.error('Error sending temp message:', error);
    return null;
  }
}

// ============================================
// DISCORD BOT EVENTS
// ============================================

client.once('ready', () => {
  console.log('='.repeat(50));
  console.log(`🤖 Bot ${client.user.tag} logged in successfully!`);
  console.log(`🏠 Servers: ${client.guilds.cache.size}`);
  console.log('='.repeat(50));
  
  client.user.setActivity('Helping with tickets', { type: 'WATCHING' });
  
  // Initialize ticket counter based on existing channels
  client.guilds.cache.forEach(guild => {
    let maxTicketId = 0;
    
    guild.channels.cache.forEach(channel => {
      if (channel.name.startsWith('tiket-')) {
        const match = channel.name.match(/tiket-(\d+)-/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxTicketId) maxTicketId = num;
          
          // Track active tickets from existing channels
          if (!channel.name.startsWith('closed-')) {
            const userIdMatch = channel.name.match(/tiket-\d+-(.+)/);
            if (userIdMatch) {
              const username = userIdMatch[1];
              const member = guild.members.cache.find(m => 
                m.user.username.toLowerCase() === username.toLowerCase()
              );
              
              if (member) {
                ticketCache.activeTickets.set(member.id, {
                  channelId: channel.id,
                  guildId: guild.id,
                  userId: member.id
                });
              }
            }
          }
        }
      }
    });
    
    ticketCache.ticketCounter.set(guild.id, maxTicketId + 1);
    console.log(`📊 Guild ${guild.name}: Ticket counter set to ${maxTicketId + 1}`);
  });
  
  console.log(`🎫 Active tickets loaded: ${ticketCache.activeTickets.size}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Terjadi kesalahan saat memproses permintaan Anda!',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(config.prefix)) return;
  
  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  try {
    switch (command) {
      case 'setup':
        await setupTicketSystem(message);
        break;
      case 'ticket':
        await createTicketCommand(message, args);
        break;
      case 'close':
        await closeTicketCommand(message, args);
        break;
      case 'add':
        await addUserToTicket(message, args);
        break;
      case 'remove':
        await removeUserFromTicket(message, args);
        break;
      case 'rename':
        await renameTicket(message, args);
        break;
      case 'help':
        await showHelp(message);
        break;
      case 'ping':
        await message.reply('Pong! 🏓');
        break;
      case 'logs':
        await showTicketLogs(message);
        break;
      case 'cleanup':
        await cleanupTickets(message);
        break;
    }
  } catch (error) {
    console.error(`Error executing command ${command}:`, error);
    await sendTempMessage(message.channel, 'Error executing command!', 5000);
  }
});

// ============================================
// COMMAND IMPLEMENTATIONS
// ============================================

async function setupTicketSystem(message) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return sendTempMessage(message.channel, 'Anda memerlukan izin Administrator untuk menggunakan perintah ini!', 5000);
  }
  
  try {
    await message.delete().catch(() => {});
  } catch (error) {
    console.log('Could not delete command message');
  }
  
  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle('🎫 Support Ticket System')
    .setDescription('Klik tombol di bawah untuk membuat tiket baru')
    .setThumbnail(embedImages.supportSystem)
    .addFields(
      { name: '📝 Cara Menggunakan', value: '1. Klik tombol "Buat Tiket"\n2. Jelaskan apa yang ingin Anda beli\n3. Tunggu admin merespons' },
      { name: '⚖️ Aturan', value: '• Deskripsikan dengan jelas\n• Bersabar menunggu respons admin\n• Jangan spam atau kirim pesan tidak perlu' }
    )
    .setFooter({ text: `${message.guild.name} Support System` })
    .setTimestamp();
  
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('🎫 Buat Tiket')
        .setStyle(ButtonStyle.Primary)
    );
  
  await message.channel.send({
    embeds: [embed],
    components: [buttonRow]
  });
  
  // Create log channel if doesn't exist
  const logChannelName = '┊・✨﹕ticket﹒logs';
  let logChannel = message.guild.channels.cache.find(c => 
    c.name === logChannelName && c.type === ChannelType.GuildText
  );
  
  if (!logChannel) {
    try {
      logChannel = await message.guild.channels.create({
        name: logChannelName,
        type: ChannelType.GuildText,
        topic: 'Log tiket yang ditutup',
        permissionOverwrites: [
          {
            id: message.guild.id,
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });
      
      const logEmbed = new EmbedBuilder()
        .setColor(colors.success)
        .setTitle('📋 Log Channel Tiket Dibuat')
        .setDescription('Channel ini akan mencatat semua tiket yang ditutup')
        .setThumbnail(embedImages.ticketLogs)
        .setFooter({ text: 'Ticket Log System' })
        .setTimestamp();
      
      await logChannel.send({ embeds: [logEmbed] });
    } catch (error) {
      console.error('Error creating log channel:', error);
    }
  }
}

async function handleButtonInteraction(interaction) {
  switch (interaction.customId) {
    case 'create_ticket':
      await handleCreateTicket(interaction);
      break;
    case 'close_ticket':
      await handleCloseTicketButton(interaction);
      break;
    case 'confirm_close':
      await handleConfirmClose(interaction);
      break;
    case 'cancel_close':
      await handleCancelClose(interaction);
      break;
  }
}

async function handleModalSubmit(interaction) {
  switch (interaction.customId) {
    case 'create_ticket_modal':
      await handleCreateTicketModal(interaction);
      break;
    case 'close_reason_modal':
      await handleCloseReasonModal(interaction);
      break;
  }
}

async function handleCreateTicket(interaction) {
  // Rate limiting
  if (isRateLimited(interaction.user.id, 'createTicket')) {
    return interaction.reply({
      content: 'Harap tunggu 30 detik sebelum membuat tiket baru!',
      ephemeral: true
    });
  }
  
  // Check if user already has active ticket
  if (ticketCache.activeTickets.has(interaction.user.id)) {
    const ticket = ticketCache.activeTickets.get(interaction.user.id);
    return interaction.reply({
      content: `Anda sudah memiliki tiket aktif: <#${ticket.channelId}>`,
      ephemeral: true
    });
  }
  
  const modal = new ModalBuilder()
    .setCustomId('create_ticket_modal')
    .setTitle('Buat Tiket Baru');
  
  const reasonInput = new TextInputBuilder()
    .setCustomId('ticket_reason')
    .setLabel('Apa yang ingin Anda beli?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Deskripsikan apa yang ingin Anda beli...')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(200);
  
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleCreateTicketModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const reason = interaction.fields.getTextInputValue('ticket_reason');
    
    if (reason.length < 3) {
      return interaction.editReply({
        content: 'Alasan terlalu pendek! Minimal 3 karakter.',
        ephemeral: true
      });
    }
    
    const guild = interaction.guild;
    const user = interaction.user;
    
    let ticketNumber = ticketCache.ticketCounter.get(guild.id) || 1;
    ticketCache.ticketCounter.set(guild.id, ticketNumber + 1);
    
    let category = guild.channels.cache.find(c => 
      c.type === ChannelType.GuildCategory && 
      c.name.toUpperCase() === config.ticketCategory.toUpperCase()
    );
    
    if (!category) {
      category = await guild.channels.create({
        name: config.ticketCategory,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });
    }
    
    const ticketChannel = await guild.channels.create({
      name: `tiket-${ticketNumber}-${user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Tiket #${ticketNumber} | User: ${user.tag}`,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });
    
    const adminRole = guild.roles.cache.find(r => r.name === config.adminRole);
    if (adminRole) {
      await ticketChannel.permissionOverwrites.edit(adminRole.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        ManageMessages: true,
      });
    }
    
    for (const roleName of config.supportRoles) {
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (role) {
        await ticketChannel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }
    }
    
    ticketCache.activeTickets.set(user.id, {
      ticketNumber: ticketNumber,
      channelId: ticketChannel.id,
      guildId: guild.id,
      userId: user.id,
      userTag: user.tag,
      createdAt: Date.now(),
      reason: reason
    });
    
    const welcomeEmbed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle(`🎫 Tiket #${ticketNumber}`)
      .setDescription(`Halo <@${user.id}>, terima kasih telah membuat tiket!`)
      .setThumbnail(embedImages.supportSystem)
      .addFields(
        { name: '📋 Permintaan', value: reason },
        { name: '👤 Dibuat oleh', value: user.tag, inline: true },
        { name: '📅 Tanggal', value: new Date().toLocaleString('id-ID'), inline: true },
        { name: '📌 Panduan', value: '• Tunggu admin merespons\n• Deskripsikan dengan jelas\n• Jangan spam' }
      )
      .setFooter({ text: 'Admin akan segera merespons!' })
      .setTimestamp();
    
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Tutup Tiket')
          .setStyle(ButtonStyle.Danger)
      );
    
    await ticketChannel.send({
      embeds: [welcomeEmbed],
      components: [buttonRow]
    });
    
    await interaction.editReply({
      content: `**Tiket berhasil dibuat!**\nChannel: <#${ticketChannel.id}>\nID: #${ticketNumber}`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Error creating ticket:', error);
    await interaction.editReply({
      content: 'Gagal membuat tiket. Silakan coba lagi!',
      ephemeral: true
    });
  }
}

async function handleCloseTicketButton(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: 'Hanya admin yang dapat menutup tiket!',
      ephemeral: true
    });
  }
  
  if (isRateLimited(interaction.user.id, 'closeTicket')) {
    return interaction.reply({
      content: 'Harap tunggu 10 detik sebelum menutup tiket lain!',
      ephemeral: true
    });
  }
  
  const modal = new ModalBuilder()
    .setCustomId('close_reason_modal')
    .setTitle('Alasan Menutup Tiket');
  
  const reasonInput = new TextInputBuilder()
    .setCustomId('close_reason')
    .setLabel('Masukkan alasan menutup tiket')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Contoh: Pesanan sudah selesai...')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(200);
  
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleCloseReasonModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const closeReason = interaction.fields.getTextInputValue('close_reason');
    const channel = interaction.channel;
    
    const ticket = Array.from(ticketCache.activeTickets.values()).find(t => 
      t.channelId === channel.id
    );
    
    if (!ticket) {
      return interaction.editReply({
        content: 'Channel ini bukan channel tiket yang valid!',
        ephemeral: true
      });
    }
    
    const confirmEmbed = new EmbedBuilder()
      .setColor(colors.warning)
      .setTitle('Konfirmasi Penutupan Tiket')
      .setDescription(`Anda akan menutup **Tiket #${ticket.ticketNumber}**`)
      .setThumbnail(embedImages.ticketClosed)
      .addFields(
        { name: '👤 Pembuat Tiket', value: ticket.userTag },
        { name: '📝 Alasan Penutupan', value: closeReason },
        { name: '⏱️ Durasi', value: formatDuration(Date.now() - ticket.createdAt) }
      )
      .setFooter({ text: 'Konfirmasi penutupan tiket' })
      .setTimestamp();
    
    const confirmButtons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_close')
          .setLabel('✅ Ya, Tutup Tiket')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_close')
          .setLabel('❌ Batal')
          .setStyle(ButtonStyle.Secondary)
      );
    
    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [confirmEmbed],
      components: [confirmButtons]
    });
    
    await interaction.editReply({
      content: 'Konfirmasi penutupan dikirim!',
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Error in close reason modal:', error);
    await interaction.editReply({
      content: 'Gagal memproses permintaan penutupan!',
      ephemeral: true
    });
  }
}

async function handleConfirmClose(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: 'Hanya admin yang dapat menutup tiket!',
      ephemeral: true
    });
  }
  
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const channel = interaction.channel;
    
    const ticketEntry = Array.from(ticketCache.activeTickets.entries()).find(([_, t]) => 
      t.channelId === channel.id
    );
    
    if (!ticketEntry) {
      return interaction.editReply({
        content: 'Tiket tidak ditemukan!',
        ephemeral: true
      });
    }
    
    const [userId, ticket] = ticketEntry;
    
    let closeReason = 'Tidak ada alasan diberikan';
    try {
      const messages = await channel.messages.fetch({ limit: 5 });
      for (const msg of messages.values()) {
        if (msg.embeds[0]?.title === 'Konfirmasi Penutupan Tiket') {
          closeReason = msg.embeds[0].fields.find(f => f.name === '📝 Alasan Penutupan')?.value || closeReason;
          break;
        }
      }
    } catch (e) {}
    
    ticketCache.activeTickets.delete(userId);
    
    const messages = await channel.messages.fetch({ limit: 10 });
    for (const msg of messages.values()) {
      if (msg.components.length > 0) {
        await msg.edit({ components: [] }).catch(() => {});
      }
    }
    
    const closeEmbed = new EmbedBuilder()
      .setColor(colors.warning)
      .setTitle('🎫 Tiket Ditutup')
      .setDescription(`**Tiket #${ticket.ticketNumber}** telah ditutup`)
      .setThumbnail(embedImages.ticketClosed)
      .addFields(
        { name: '🔒 Ditutup oleh', value: interaction.user.tag, inline: true },
        { name: '👤 Pembuat', value: ticket.userTag, inline: true },
        { name: '📝 Alasan', value: closeReason }
      )
      .setFooter({ text: `ID: #${ticket.ticketNumber}` })
      .setTimestamp();
    
    await channel.send({ embeds: [closeEmbed] });
    
    await channel.permissionOverwrites.edit(ticket.userId, {
      SendMessages: false,
      AddReactions: false
    });
    
    await channel.setName(`closed-${ticket.ticketNumber}`.toLowerCase().slice(0, 100));
    
    await sendCloseLog(ticket, interaction.user, closeReason);
    
    try {
      const user = await client.users.fetch(ticket.userId);
      const userEmbed = new EmbedBuilder()
        .setColor(colors.info)
        .setTitle('🎫 Tiket Anda Telah Ditutup')
        .setDescription(`Tiket #${ticket.ticketNumber} telah ditutup`)
        .setThumbnail(embedImages.ticketClosed)
        .addFields(
          { name: '🔒 Ditutup oleh', value: interaction.user.tag },
          { name: '📝 Alasan', value: closeReason }
        )
        .setFooter({ text: 'Terima kasih telah menggunakan layanan kami' })
        .setTimestamp();
      
      await user.send({ embeds: [userEmbed] });
    } catch (err) {
      console.log(`Could not send DM to ${ticket.userTag}`);
    }
    
    await interaction.editReply({
      content: 'Tiket berhasil ditutup!',
      ephemeral: true
    });
    
    setTimeout(async () => {
      try {
        if (channel.deletable) {
          await channel.delete('Tiket ditutup - Auto delete');
        }
      } catch (error) {
        console.error('Error deleting channel:', error);
      }
    }, 10000);
    
  } catch (error) {
    console.error('Error confirming close:', error);
    await interaction.editReply({
      content: 'Gagal menutup tiket!',
      ephemeral: true
    });
  }
}

async function handleCancelClose(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: 'Hanya admin yang dapat membatalkan penutupan!',
      ephemeral: true
    });
  }
  
  try {
    await interaction.message.delete();
    await interaction.reply({
      content: 'Penutupan tiket dibatalkan.',
      ephemeral: true
    });
  } catch (error) {
    console.error('Error cancelling close:', error);
  }
}

async function sendCloseLog(ticket, closer, closeReason) {
  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) return;
  
  const logChannel = guild.channels.cache.find(c => 
    c.name === config.logChannel && c.type === ChannelType.GuildText
  );
  
  if (!logChannel) return;
  
  const logEmbed = new EmbedBuilder()
    .setColor(colors.warning)
    .setTitle('📋 LOG TIKET DITUTUP')
    .setDescription(`**Tiket #${ticket.ticketNumber}** telah ditutup`)
    .setThumbnail(embedImages.ticketLogs)
    .addFields(
      { name: '👤 User', value: ticket.userTag, inline: true },
      { name: '🎫 ID', value: `#${ticket.ticketNumber}`, inline: true },
      { name: '🔒 Oleh', value: closer.tag, inline: true },
      { name: '📝 Alasan', value: ticket.reason.length > 100 ? ticket.reason.slice(0, 100) + '...' : ticket.reason },
      { name: '🗒️ Alasan Penutupan', value: closeReason }
    )
    .setFooter({ text: `Ditutup pada` })
    .setTimestamp();
  
  await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
}

async function createTicketCommand(message, args) {
  if (isRateLimited(message.author.id, 'createTicket')) {
    return sendTempMessage(message.channel, 'Harap tunggu 30 detik sebelum membuat tiket baru!', 5000);
  }
  
  if (ticketCache.activeTickets.has(message.author.id)) {
    const ticket = ticketCache.activeTickets.get(message.author.id);
    return sendTempMessage(message.channel, `Anda sudah memiliki tiket aktif: <#${ticket.channelId}>`, 10000);
  }
  
  const reason = args.join(' ');
  if (!reason || reason.length < 3) {
    return sendTempMessage(message.channel, 'Harap berikan alasan yang jelas (minimal 3 karakter)!', 10000);
  }
  
  const creatingMsg = await message.channel.send('**Membuat tiket...**');
  
  try {
    const guild = message.guild;
    const user = message.author;
    
    let ticketNumber = ticketCache.ticketCounter.get(guild.id) || 1;
    ticketCache.ticketCounter.set(guild.id, ticketNumber + 1);
    
    let category = guild.channels.cache.find(c => 
      c.type === ChannelType.GuildCategory && 
      c.name.toUpperCase() === config.ticketCategory.toUpperCase()
    );
    
    if (!category) {
      category = await guild.channels.create({
        name: config.ticketCategory,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });
    }
    
    const ticketChannel = await guild.channels.create({
      name: `tiket-${ticketNumber}-${user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Tiket #${ticketNumber} | User: ${user.tag}`,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });
    
    const adminRole = guild.roles.cache.find(r => r.name === config.adminRole);
    if (adminRole) {
      await ticketChannel.permissionOverwrites.edit(adminRole.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        ManageMessages: true,
      });
    }
    
    ticketCache.activeTickets.set(user.id, {
      ticketNumber: ticketNumber,
      channelId: ticketChannel.id,
      guildId: guild.id,
      userId: user.id,
      userTag: user.tag,
      createdAt: Date.now(),
      reason: reason
    });
    
    const welcomeEmbed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle(`🎫 Tiket #${ticketNumber}`)
      .setDescription(`Halo <@${user.id}>, terima kasih telah membuat tiket!`)
      .setThumbnail(embedImages.supportSystem)
      .addFields(
        { name: '📋 Permintaan', value: reason },
        { name: '👤 Dibuat oleh', value: user.tag, inline: true },
        { name: '📅 Tanggal', value: new Date().toLocaleString('id-ID'), inline: true }
      )
      .setFooter({ text: 'Admin akan segera merespons!' })
      .setTimestamp();
    
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Tutup Tiket')
          .setStyle(ButtonStyle.Danger)
      );
    
    await ticketChannel.send({
      embeds: [welcomeEmbed],
      components: [buttonRow]
    });
    
    await creatingMsg.edit(`**Tiket berhasil dibuat!**\nChannel: <#${ticketChannel.id}>\nID: #${ticketNumber}`);
    
  } catch (error) {
    console.error('Error creating ticket from command:', error);
    await creatingMsg.edit('Gagal membuat tiket!');
  }
}

async function closeTicketCommand(message, args) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat menutup tiket!', 5000);
  }
  
  const ticket = Array.from(ticketCache.activeTickets.values()).find(t => 
    t.channelId === message.channel.id
  );
  
  if (!ticket) {
    return sendTempMessage(message.channel, 'Ini bukan channel tiket!', 5000);
  }
  
  const closeReason = args.join(' ') || 'Tidak ada alasan diberikan';
  
  await sendTempMessage(message.channel, `**Menutup tiket #${ticket.ticketNumber}...**`, 3000);
  
  const ticketEntry = Array.from(ticketCache.activeTickets.entries()).find(([_, t]) => 
    t.channelId === message.channel.id
  );
  
  if (ticketEntry) {
    ticketCache.activeTickets.delete(ticketEntry[0]);
  }
  
  const closeEmbed = new EmbedBuilder()
    .setColor(colors.warning)
    .setTitle('🎫 Tiket Ditutup')
    .setDescription(`**Tiket #${ticket.ticketNumber}** telah ditutup`)
    .setThumbnail(embedImages.ticketClosed)
    .addFields(
      { name: '🔒 Ditutup oleh', value: message.author.tag, inline: true },
      { name: '👤 Pembuat', value: ticket.userTag, inline: true },
      { name: '📝 Alasan', value: closeReason }
    )
    .setFooter({ text: `ID: #${ticket.ticketNumber}` })
    .setTimestamp();
  
  await message.channel.send({ embeds: [closeEmbed] });
  
  await message.channel.permissionOverwrites.edit(ticket.userId, {
    SendMessages: false,
    AddReactions: false
  });
  
  await message.channel.setName(`closed-${ticket.ticketNumber}`.toLowerCase().slice(0, 100));
  
  await sendCloseLog(ticket, message.author, closeReason);
  
  setTimeout(async () => {
    try {
      if (message.channel.deletable) {
        await message.channel.delete('Tiket ditutup - Auto delete');
      }
    } catch (error) {
      console.error('Error deleting channel:', error);
    }
  }, 10000);
}

async function addUserToTicket(message, args) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat menambahkan user ke tiket!', 5000);
  }
  
  const userToAdd = message.mentions.users.first();
  if (!userToAdd) {
    return sendTempMessage(message.channel, 'Tag user yang ingin ditambahkan!', 5000);
  }
  
  try {
    await message.channel.permissionOverwrites.edit(userToAdd.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    
    await message.channel.send(`<@${userToAdd.id}> telah ditambahkan ke tiket!`);
  } catch (error) {
    console.error('Error adding user:', error);
    await message.channel.send('Gagal menambahkan user!');
  }
}

async function removeUserFromTicket(message, args) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat menghapus user dari tiket!', 5000);
  }
  
  const userToRemove = message.mentions.users.first();
  if (!userToRemove) {
    return sendTempMessage(message.channel, 'Tag user yang ingin dihapus!', 5000);
  }
  
  try {
    await message.channel.permissionOverwrites.delete(userToRemove.id);
    await message.channel.send(`<@${userToRemove.id}> telah dihapus dari tiket!`);
  } catch (error) {
    console.error('Error removing user:', error);
    await message.channel.send('Gagal menghapus user!');
  }
}

async function renameTicket(message, args) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat mengganti nama tiket!', 5000);
  }
  
  const newName = args.join(' ');
  if (!newName || newName.length < 3) {
    return sendTempMessage(message.channel, 'Masukkan nama baru untuk tiket (minimal 3 karakter)!', 5000);
  }
  
  try {
    const oldName = message.channel.name;
    const cleanName = newName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100);
    await message.channel.setName(cleanName);
    await message.channel.send(`Nama tiket diubah dari \`${oldName}\` menjadi \`${cleanName}\``);
  } catch (error) {
    console.error('Error renaming ticket:', error);
    await message.channel.send('Gagal mengganti nama tiket!');
  }
}

async function showTicketLogs(message) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat melihat log tiket!', 5000);
  }
  
  const logChannel = message.guild.channels.cache.find(c => 
    c.name === config.logChannel && c.type === ChannelType.GuildText
  );
  
  if (!logChannel) {
    return message.channel.send('Log channel tidak ditemukan!');
  }
  
  try {
    const messages = await logChannel.messages.fetch({ limit: 10 });
    const logEmbeds = messages.filter(msg => msg.embeds.length > 0).map(msg => msg.embeds[0]);
    
    if (logEmbeds.length === 0) {
      return message.channel.send('Belum ada log tiket yang ditutup.');
    }
    
    const logEmbed = new EmbedBuilder()
      .setColor(colors.info)
      .setTitle('📋 Log Tiket Terbaru')
      .setDescription(`Menampilkan ${logEmbeds.length} log terbaru`)
      .setThumbnail(embedImages.ticketLogs)
      .setFooter({ text: `Log dari #${logChannel.name}` })
      .setTimestamp();
    
    await message.channel.send({ embeds: [logEmbed] });
    
  } catch (error) {
    console.error('Error showing logs:', error);
    await message.channel.send('Gagal mengambil log tiket!');
  }
}

async function cleanupTickets(message) {
  if (!isAdmin(message.member)) {
    return sendTempMessage(message.channel, 'Hanya admin yang dapat menggunakan perintah ini!', 5000);
  }
  
  let cleaned = 0;
  const channels = message.guild.channels.cache.filter(ch => 
    ch.name.startsWith('closed-') && ch.type === ChannelType.GuildText
  );
  
  for (const channel of channels.values()) {
    try {
      await channel.delete('Cleanup - old closed ticket');
      cleaned++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error cleaning channel ${channel.name}:`, error);
    }
  }
  
  await message.channel.send(`Cleanup selesai. ${cleaned} channel dihapus.`);
}

async function showHelp(message) {
  const isAdminUser = isAdmin(message.member);
  
  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle('🎫 Bantuan Sistem Tiket')
    .setDescription('Sistem tiket dengan tombol dan log otomatis')
    .setThumbnail(embedImages.supportSystem)
    .addFields(
      { 
        name: '**Perintah Umum**', 
        value: '```' +
               '!ticket [alasan] - Buat tiket baru\n' +
               '!help            - Tampilkan bantuan\n' +
               '!ping            - Cek status bot' +
               '```' 
      }
    );
  
  if (isAdminUser) {
    embed.addFields(
      { 
        name: '**Perintah Admin**', 
        value: '```' +
               '!setup              - Setup panel tiket\n' +
               '!close [alasan]     - Tutup tiket (perintah)\n' +
               '!add @user          - Tambah user ke tiket\n' +
               '!remove @user       - Hapus user dari tiket\n' +
               '!rename [nama]      - Ganti nama tiket\n' +
               '!logs               - Lihat log tiket ditutup\n' +
               '!cleanup            - Hapus channel lama' +
               '```' 
      }
    );
  }
  
  embed.addFields(
    { name: '📋 Setup', value: '1. Gunakan `!setup` di channel\n2. Panel dengan tombol akan muncul\n3. User klik tombol untuk buat tiket' },
    { name: '⚙️ Catatan', value: '• Hanya admin yang bisa tutup tiket\n• Channel dihapus 10 detik setelah ditutup\n• Log hanya untuk tiket yang ditutup' }
  )
  .setFooter({ text: `Status: ${isAdminUser ? 'Admin ✅' : 'User'}` })
  .setTimestamp();
  
  await message.channel.send({ embeds: [embed] });
}

// ============================================
// ERROR HANDLING & STARTUP
// ============================================

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Get token from environment variable
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('ERROR: Bot token tidak ditemukan!');
  console.log('='.repeat(50));
  console.log('CARA MENGGUNAKAN:');
  console.log('1. Set environment variable DISCORD_TOKEN di Render');
  console.log('2. Atau buat file .env dengan DISCORD_TOKEN=token_anda');
  console.log('='.repeat(50));
  
  // Tetap jalankan Express server meski tanpa Discord bot
  console.log('⚠️  Discord bot tidak akan berjalan, tapi Express server tetap aktif');
} else {
  // Login ke Discord
  client.login(token).catch(error => {
    console.error('Gagal login ke Discord:', error);
    console.log('⚠️  Discord bot gagal connect, tapi Express server tetap aktif');
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Express server closed');
    process.exit(0);
  });
});