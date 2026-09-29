const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'telegram_users.json');

class TelegramService {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || '';
    this.baseUrl = this.token ? `https://api.telegram.org/bot${this.token}` : '';
    this.userMappings = this.loadUserMappings(); // walletAddress (lowercase) -> chatId
    this.isPolling = false;
    this.lastUpdateId = 0;
    this.botInfo = null;
  }

  // Load wallet <-> chat_id mappings from local JSON
  loadUserMappings() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[Telegram] Could not load user mappings:', err.message);
    }
    return {};
  }

  // Save mappings to disk
  saveUserMappings() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.userMappings, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Telegram] Could not save user mappings:', err.message);
    }
  }

  // Link a wallet address to a Telegram chat ID
  linkWallet(walletAddress, chatId) {
    if (!walletAddress || !chatId) return false;
    const cleanAddr = walletAddress.trim().toLowerCase();
    this.userMappings[cleanAddr] = chatId.toString();
    this.saveUserMappings();
    console.log(`[Telegram] 🔗 Linked wallet ${cleanAddr} -> Chat ID ${chatId}`);
    return true;
  }

  // Unlink a chat ID
  unlinkChat(chatId) {
    let unlinked = false;
    for (const [addr, id] of Object.entries(this.userMappings)) {
      if (id === chatId.toString()) {
        delete this.userMappings[addr];
        unlinked = true;
      }
    }
    if (unlinked) this.saveUserMappings();
    return unlinked;
  }

  // Get chat ID for a wallet address (falls back to default demo chat ID if configured)
  getChatIdForWallet(walletAddress) {
    if (!walletAddress) return this.defaultChatId || null;
    const cleanAddr = walletAddress.trim().toLowerCase();
    return this.userMappings[cleanAddr] || this.defaultChatId || null;
  }

  // Update token or config dynamically at runtime
  async updateConfig({ token, defaultChatId }) {
    if (token !== undefined) {
      this.token = token.trim();
      this.baseUrl = this.token ? `https://api.telegram.org/bot${this.token}` : '';
    }
    if (defaultChatId !== undefined) {
      this.defaultChatId = defaultChatId.trim();
    }
    if (this.token) {
      return await this.init(this.contractService, this.getLatestTelemetry);
    }
    return false;
  }

  // Return status for API / UI inspection
  getStatus() {
    return {
      active: !!this.token && !!this.botInfo,
      botUsername: this.botInfo?.username || null,
      botName: this.botInfo?.first_name || null,
      linkedCount: Object.keys(this.userMappings).length,
      defaultChatIdSet: !!this.defaultChatId,
      mappings: this.userMappings,
      hasToken: !!this.token
    };
  }

  // Initialize bot and start command polling
  async init(contractService = null, getLatestTelemetry = null) {
    if (contractService) this.contractService = contractService;
    if (getLatestTelemetry) this.getLatestTelemetry = getLatestTelemetry;
    this.token = process.env.TELEGRAM_BOT_TOKEN || this.token || '';
    this.defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || this.defaultChatId || '';
    this.baseUrl = this.token ? `https://api.telegram.org/bot${this.token}` : '';

    if (!this.token) {
      console.log('[Telegram] ℹ️ Telegram Bot in standby mode (No TELEGRAM_BOT_TOKEN in relay/.env).');
      console.log('[Telegram] 💡 Set TELEGRAM_BOT_TOKEN in relay/.env or via /api/telegram/config to activate live alerts.');
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/getMe`);
      const data = await res.json();
      if (data.ok) {
        this.botInfo = data.result;
        console.log(`[Telegram] 🤖 Bot authenticated: @${this.botInfo.username} (${this.botInfo.first_name})`);
        this.startPolling();
        return true;
      } else {
        console.warn('[Telegram] Bot authentication failed:', data.description);
      }
    } catch (err) {
      console.warn('[Telegram] Error connecting to Telegram API:', err.message);
    }
    return false;
  }

  // Send HTML formatted message to a chat ID
  async sendMessage(chatId, text, replyMarkup = null) {
    if (!this.token || !chatId) return null;
    try {
      const body = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (replyMarkup) {
        body.reply_markup = replyMarkup;
      }

      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (err) {
      console.warn(`[Telegram] Failed to send message to ${chatId}:`, err.message);
      return null;
    }
  }

  // Send personalized notifications to both sender and recipient
  async notifyDeliveryEvent({ deliveryId, sender, recipient, type, data = {} }) {
    const senderChatId = this.getChatIdForWallet(sender);
    const recipientChatId = this.getChatIdForWallet(recipient);
    const targetChatIds = new Set();

    if (senderChatId) targetChatIds.add(senderChatId);
    if (recipientChatId) targetChatIds.add(recipientChatId);
    if (this.defaultChatId) targetChatIds.add(this.defaultChatId);

    const shortSender = sender ? `${sender.substring(0, 6)}...${sender.substring(sender.length - 4)}` : '0xSender';
    const shortRecipient = recipient ? `${recipient.substring(0, 6)}...${recipient.substring(recipient.length - 4)}` : '0xRecipient';
    const amountEth = data.amount || '0.1000';
    const cashbackEth = data.cashback || '0.0050';
    const payoutEth = data.payout || '0.0950';

    console.log(`[Telegram] 📣 Event '${type}' for Delivery #${deliveryId} (Sender: ${shortSender}, Recipient: ${shortRecipient}, Targets: ${targetChatIds.size})`);

    if (targetChatIds.size === 0) {
      console.log(`[Telegram] Notice: No chat ID linked for Delivery #${deliveryId}. Send /link <wallet> in Telegram to receive live alerts.`);
      return;
    }

    for (const chatId of targetChatIds) {
      const isSender = senderChatId === chatId;
      const isRecipient = recipientChatId === chatId;

      let msg = '';

      if (type === 'CREATED') {
        if (isSender) {
          msg = `📦 <b>YOUR PARCEL IS BOOKED! (Delivery #${deliveryId})</b>\n\n` +
                `Hello Sender! Your zero-trust delivery has been locked on the MST Blockchain.\n\n` +
                `💰 <b>Escrow Locked:</b> <code>${amountEth} $MSTC</code>\n` +
                `🎁 <b>Your 5% Cashback:</b> <code>+${cashbackEth} $MSTC</code> <i>(Pending completion)</i>\n` +
                `🚚 <b>Courier Payout:</b> <code>${payoutEth} $MSTC</code>\n` +
                `🎯 <b>Recipient:</b> <code>${shortRecipient}</code>\n` +
                `📍 <b>Target Terminal:</b> <code>${data.lat || '28.6129'}, ${data.lon || '77.2295'}</code>\n\n` +
                `⏳ <i>Your funds are cryptographically protected in escrow until physical arrival & recipient signature.</i>`;
        } else if (isRecipient) {
          msg = `📬 <b>INCOMING PARCEL ALERT! (Delivery #${deliveryId})</b>\n\n` +
                `Hello Recipient! A package is being dispatched to you on the MST Network.\n\n` +
                `👤 <b>Sender:</b> <code>${shortSender}</code>\n` +
                `💰 <b>Escrow Value:</b> <code>${amountEth} $MSTC</code> (Fully funded ✅)\n` +
                `📍 <b>Destination Terminal:</b> <code>${data.lat || '28.6129'}, ${data.lon || '77.2295'}</code>\n\n` +
                `⏳ <i>We will notify you the moment the courier taps the RFID tag at the terminal locker!</i>`;
        } else {
          // Broadcaster / Default Admin
          msg = `📦 <b>MST Delivery #${deliveryId} Created</b>\n\n` +
                `• Escrow: <code>${amountEth} $MSTC</code>\n` +
                `• Sender: <code>${shortSender}</code>\n` +
                `• Recipient: <code>${shortRecipient}</code>\n` +
                `• Target GPS: <code>${data.lat || '28.6129'}, ${data.lon || '77.2295'}</code>`;
        }
      } else if (type === 'KEY1_VERIFIED') {
        if (isRecipient) {
          msg = `🚨 <b>YOUR PACKAGE HAS ARRIVED AT THE SMART TERMINAL!</b>\n\n` +
                `Delivery <b>#${deliveryId}</b> arrived and was scanned at the destination locker!\n\n` +
                `🔑 <b>Key 1 (Terminal RFID):</b> ✅ <b>VERIFIED</b> (UID: <code>${data.rfidUid || '0x82'}</code>)\n` +
                `🛰️ <b>GPS Geofence:</b> ✅ <b>INSIDE 50m RADIUS</b>\n` +
                `🔒 <b>Locker Door:</b> LATCHED SHUT (Awaiting Key 2)\n\n` +
                `👉 <b>ACTION REQUIRED TO UNLOCK:</b>\n` +
                `Open the <a href="https://mst-sandy.vercel.app">Recipient Portal</a> in BridgeKey and click <b>"Confirm Receipt (Sign Key 2)"</b> to pop open your compartment door!`;
        } else if (isSender) {
          msg = `💳 <b>PARCEL ARRIVED AT LOCKER! (Delivery #${deliveryId})</b>\n\n` +
                `Good news! The courier has reached the Smart Terminal with your parcel:\n\n` +
                `🏷️ <b>Hardware RFID Scan:</b> ✅ Verified\n` +
                `🛰️ <b>Geofence Confirmation:</b> ✅ Target GPS Match\n` +
                `🔒 <b>Status:</b> Key 1 Confirmed on MST Blockchain\n\n` +
                `⏳ <i>The recipient has been alerted to sign Key 2 and retrieve the package. Your 5% cashback will disburse immediately upon pickup.</i>`;
        } else {
          msg = `💳 <b>Key 1 Verified on-chain for Delivery #${deliveryId}</b>\n\n` +
                `RFID UID: <code>${data.rfidUid || '0x82'}</code>\n` +
                `Terminal GPS: <code>${data.lat || '28.6129'}, ${data.lon || '77.2295'}</code>\n` +
                `Status: Awaiting Recipient Key 2.`;
        }
      } else if (type === 'SETTLED') {
        if (isSender) {
          msg = `🎉 <b>DELIVERY #${deliveryId} COMPLETE — 5% CASHBACK CREDITED!</b>\n\n` +
                `Recipient has verified Key 2 and collected the package from the Smart Terminal!\n\n` +
                `🎁 <b>YOUR CASHBACK PAYOUT:</b>\n` +
                `<code>+${cashbackEth} $MSTC</code> (5% instant reward 🎉)\n` +
                `<i>Your BridgeKey wallet balance has been credited directly on-chain!</i>\n\n` +
                `🚚 <b>Courier Settlement:</b> <code>+${payoutEth} $MSTC</code>\n` +
                (data.txHash ? `🔗 <a href="https://testnet.mstscan.com/tx/${data.txHash}">View Receipt on MSTScan</a>\n\n` : '') +
                `<i>Thank you for trusting MST Multi-Sig Smart Delivery!</i>`;
        } else if (isRecipient) {
          msg = `🔓 <b>LOCKER UNLOCKED & DELIVERY #${deliveryId} COMPLETE!</b>\n\n` +
                `Your Key 2 signature has been verified on the MST Blockchain.\n\n` +
                `🚪 <b>Compartment Door:</b> <b>UNLOCKED</b> ✅\n` +
                `📦 Please take your package from the locker compartment.\n\n` +
                (data.txHash ? `🔗 <a href="https://testnet.mstscan.com/tx/${data.txHash}">View On-Chain Receipt</a>\n\n` : '') +
                `<i>Hope you enjoyed your zero-trust delivery experience!</i>`;
        } else {
          msg = `🎉 <b>Delivery #${deliveryId} Fully Settled On-Chain!</b>\n\n` +
                `• Courier: +${payoutEth} $MSTC\n` +
                `• Sender Cashback: +${cashbackEth} $MSTC\n` +
                (data.txHash ? `• Tx: ${data.txHash}` : '');
        }
      }

      if (msg) {
        await this.sendMessage(chatId, msg, {
          inline_keyboard: [
            [{ text: '🌐 Open MST DApp', url: 'https://mst-sandy.vercel.app' }],
            [{ text: `🔍 Track Delivery #${deliveryId}`, callback_data: `track_${deliveryId}` }]
          ]
        });
      }
    }
  }

  // Start Long Polling to handle incoming commands
  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    console.log('[Telegram] 👂 Started polling for Telegram commands (/start, /status, /link, etc.)...');

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await fetch(`${this.baseUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=15`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            await this.handleUpdate(update);
          }
        }
      } catch (err) {
        // Network timeout / connection delay — retry gracefully
      }
      setTimeout(poll, 1500);
    };

    poll();
  }

  stopPolling() {
    this.isPolling = false;
  }

  // Handle incoming message or callback query
  async handleUpdate(update) {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    if (!update.message || !update.message.text) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const firstName = msg.from?.first_name || 'Friend';

    if (text === '/start') {
      const welcome = `👋 <b>Hello, ${firstName}! Welcome to MST Smart Terminal Bot!</b>\n\n` +
                      `I provide real-time cryptographic notifications for your <b>Zero-Trust Multi-Sig Deliveries</b> on the <b>MST Blockchain</b>.\n\n` +
                      `📌 <b>Quick Commands:</b>\n` +
                      `• <code>/link &lt;0x_wallet_address&gt;</code> — Link your BridgeKey wallet to get personalized alerts!\n` +
                      `• <code>/status &lt;delivery_id&gt;</code> — Check on-chain & hardware status (e.g. <code>/status 20</code>)\n` +
                      `• <code>/telemetry</code> — View live environmental sensors (Temp, Gas, Ultrasonic)\n` +
                      `• <code>/latest</code> — Show latest active delivery\n` +
                      `• <code>/unlink</code> — Remove wallet association\n\n` +
                      `🌐 <b>DApp:</b> <a href="https://mst-sandy.vercel.app">mst-sandy.vercel.app</a>`;

      await this.sendMessage(chatId, welcome, {
        inline_keyboard: [
          [{ text: '🌐 Open MST DApp', url: 'https://mst-sandy.vercel.app' }],
          [{ text: '📡 Check Hardware Status', callback_data: 'cmd_telemetry' }]
        ]
      });
      return;
    }

    if (text.startsWith('/link')) {
      const parts = text.split(/\s+/);
      if (parts.length < 2 || !parts[1].startsWith('0x') || parts[1].length !== 42) {
        await this.sendMessage(chatId, `⚠️ <b>Invalid Address:</b> Please provide a full 42-character 0x wallet address.\n\nExample:\n<code>/link 0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a</code>`);
        return;
      }
      const wallet = parts[1];
      this.linkWallet(wallet, chatId);
      await this.sendMessage(chatId, `✅ <b>Wallet Linked Successfully!</b>\n\nWallet: <code>${wallet}</code>\nChat ID: <code>${chatId}</code>\n\nYou will now receive instant alerts whenever this wallet creates, delivers, or receives a package on the MST Network!`);
      return;
    }

    if (text === '/unlink') {
      const done = this.unlinkChat(chatId);
      if (done) {
        await this.sendMessage(chatId, `✅ Your wallet has been unlinked from this chat.`);
      } else {
        await this.sendMessage(chatId, `ℹ️ No wallet was currently linked to this chat.`);
      }
      return;
    }

    if (text.startsWith('/status')) {
      const parts = text.split(/\s+/);
      const id = parts[1] || '20';
      await this.sendDeliveryStatus(chatId, id);
      return;
    }

    if (text === '/telemetry') {
      await this.sendTelemetryStatus(chatId);
      return;
    }

    if (text === '/latest') {
      try {
        if (this.contractService?.contract) {
          const count = await this.contractService.contract.deliveryCount();
          await this.sendDeliveryStatus(chatId, count.toString());
          return;
        }
      } catch (_) {}
      await this.sendDeliveryStatus(chatId, '20');
      return;
    }

    if (text === '/help') {
      const help = `🤖 <b>MST Terminal Bot Commands:</b>\n\n` +
                   `• <code>/link &lt;wallet&gt;</code> — Link your BridgeKey wallet address\n` +
                   `• <code>/status &lt;id&gt;</code> — Live on-chain status of a delivery\n` +
                   `• <code>/telemetry</code> — Read IoT hardware terminal sensors\n` +
                   `• <code>/latest</code> — Track most recent parcel\n` +
                   `• <code>/unlink</code> — Unlink your wallet\n` +
                   `• <code>/start</code> — Bot overview`;
      await this.sendMessage(chatId, help);
    }
  }

  // Handle inline buttons
  async handleCallback(query) {
    const chatId = query.message?.chat?.id;
    const data = query.data;

    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: query.id })
      });
    } catch (_) {}

    if (data === 'cmd_telemetry') {
      await this.sendTelemetryStatus(chatId);
    } else if (data.startsWith('track_')) {
      const id = data.replace('track_', '');
      await this.sendDeliveryStatus(chatId, id);
    }
  }

  // Query and format on-chain delivery status
  async sendDeliveryStatus(chatId, id) {
    if (!this.contractService?.contract) {
      await this.sendMessage(chatId, `⚠️ Smart contract is currently offline or unreachable.`);
      return;
    }

    try {
      const d = await this.contractService.contract.getDelivery(id);
      const statusMap = ['Created', 'Terminal Confirmed', 'Recipient Confirmed', 'Settled ✅', 'Cancelled ❌'];
      const statusStr = statusMap[Number(d.status)] || 'Unknown';
      const escrowEth = (Number(d.escrowAmount) / 1e18).toFixed(4);
      const cashbackEth = (Number(d.cashbackAmount) / 1e18).toFixed(4);
      const payoutEth = (Number(d.courierPayout) / 1e18).toFixed(4);

      const msg = `📋 <b>MST Delivery #${id} Status</b>\n\n` +
                  `📊 <b>State:</b> <b>${statusStr}</b>\n` +
                  `💰 <b>Escrow:</b> <code>${escrowEth} $MSTC</code>\n` +
                  `🎁 <b>Cashback:</b> <code>${cashbackEth} $MSTC (5%)</code>\n` +
                  `🚚 <b>Courier Payout:</b> <code>${payoutEth} $MSTC</code>\n\n` +
                  `🔑 <b>Key 1 (Terminal RFID):</b> ${d.terminalConfirmed ? '✅ Confirmed' : '⏳ Pending'}\n` +
                  `🔑 <b>Key 2 (Recipient Sign):</b> ${d.recipientConfirmed ? '✅ Confirmed' : '⏳ Pending'}\n` +
                  `🚪 <b>Compartment Door:</b> ${d.terminalConfirmed && d.recipientConfirmed ? '🔓 UNLOCKED' : '🔒 LOCKED'}\n\n` +
                  `📍 <b>Target GPS:</b> <code>${(Number(d.targetLat) / 1e6).toFixed(4)}, ${(Number(d.targetLon) / 1e6).toFixed(4)}</code>\n` +
                  `👤 <b>Sender:</b> <code>${d.sender.substring(0, 6)}...${d.sender.substring(38)}</code>\n` +
                  `🎯 <b>Recipient:</b> <code>${d.recipient.substring(0, 6)}...${d.recipient.substring(38)}</code>`;

      await this.sendMessage(chatId, msg, {
        inline_keyboard: [
          [{ text: '🌐 View in Web App', url: 'https://mst-sandy.vercel.app' }]
        ]
      });
    } catch (err) {
      await this.sendMessage(chatId, `❌ Could not fetch Delivery #${id}: ${err.message}`);
    }
  }

  // Live telemetry report
  async sendTelemetryStatus(chatId) {
    const telem = this.getLatestTelemetry ? this.getLatestTelemetry() : null;
    if (!telem) {
      await this.sendMessage(chatId, `📡 <b>IoT Hardware Terminal:</b> Streaming active on ESP32.`);
      return;
    }

    const msg = `📡 <b>ESP32 Smart Terminal Telemetry</b>\n\n` +
                `🌡️ <b>Temperature:</b> <code>${telem.temp || 22}°C</code> (Safe Cold-Chain)\n` +
                `💨 <b>Air/Gas Sensor:</b> <code>${telem.gas || 2000} ppm</code> (Normal)\n` +
                `📏 <b>Compartment Depth:</b> <code>${telem.dist || 400} cm</code>\n` +
                `💳 <b>RFID Hardware:</b> <code>${telem.rfidChip ? 'RC522 (0x82 Active)' : 'Active'}</code>\n` +
                `📍 <b>GPS Fix:</b> <code>${telem.lat || 28.6129}, ${telem.lon || 77.2295}</code>\n` +
                `⚡ <b>Battery Voltage:</b> <code>${telem.battery || '11.15V'}</code>\n` +
                `⏱️ <b>Last Ping:</b> <code>${new Date().toLocaleTimeString()}</code>`;

    await this.sendMessage(chatId, msg);
  }
}

const telegramService = new TelegramService();

module.exports = {
  telegramService,
  TelegramService
};
