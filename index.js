require("dotenv").config();
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
  PermissionsBitField,
  AttachmentBuilder
} = require("discord.js");
const { Pool } = require("pg");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message]
});

const giveaways = new Map();

/* ---------------- DATABASE ---------------- */

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

async function initStockDatabase() {
  if (!pool) {
    console.log("⚠️ DATABASE_URL missing. Stock commands will not work.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_trades (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
      shares NUMERIC NOT NULL,
      price NUMERIC NOT NULL,
      gross_amount NUMERIC NOT NULL,
      commission NUMERIC NOT NULL,
      tax NUMERIC NOT NULL,
      net_amount NUMERIC NOT NULL,
      realized_profit NUMERIC NOT NULL DEFAULT 0,
      trade_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE stock_trades
    ADD COLUMN IF NOT EXISTS trade_date DATE;
  `);

  console.log("✅ Stock database ready");
}

/* ---------------- STOCK HELPERS ---------------- */

const COMMISSION_RATE = 0.001425;
const TAISHIN_DISCOUNT = 0.28;
const MIN_COMMISSION = 20;
const SELL_TAX_RATE = 0.003;

function normalizeStockSymbol(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return raw;

  // Keep user-provided Taiwan suffix if they typed it.
  if (/\.(TW|TWO)$/i.test(raw)) return raw;

  // Taiwan stocks/ETFs may be listed on either TWSE (.TW) or TPEx (.TWO).
  // Do not force .TW here; fetchCurrentPrice will try both .TW and .TWO.
  return raw;
}

function getStockBase(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\.(TW|TWO)$/i, "");
}

function getYahooSymbolCandidates(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  const base = getStockBase(raw);
  const candidates = [];

  function add(value) {
    if (value && !candidates.includes(value)) candidates.push(value);
  }

  add(raw);

  if (base) {
    add(`${base}.TW`);
    add(`${base}.TWO`);
  }

  return candidates;
}

function parseGoogleFinancePrice(html) {
  if (!html) return null;

  const patterns = [
    /class="YMlKec fxKbKc"[^>]*>([^<]+)</,
    /data-last-price="([0-9.,]+)"/,
    /"lastPrice":"?([0-9.,]+)"?/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const cleaned = String(match[1])
      .replace(/,/g, "")
      .replace(/NT\$/gi, "")
      .replace(/TWD/gi, "")
      .replace(/[^0-9.\-]/g, "")
      .trim();

    const price = Number(cleaned);
    if (Number.isFinite(price) && price > 0) return price;
  }

  return null;
}

async function fetchYahooCurrentPrice(yahooSymbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;

    if (!Number.isFinite(Number(price))) return null;
    return Number(price);
  } catch (err) {
    return null;
  }
}

async function fetchGoogleFinancePrice(symbol) {
  const base = getStockBase(symbol);
  if (!base) return null;

  const exchanges = ["TPE", "TWO"];

  for (const exchange of exchanges) {
    try {
      const url = `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exchange}?hl=zh-TW`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
        }
      });

      if (!res.ok) continue;

      const html = await res.text();
      const price = parseGoogleFinancePrice(html);

      if (price !== null) return price;
    } catch (err) {
      continue;
    }
  }

  return null;
}


async function fetchYahooSearchSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&lang=zh-TW&region=TW`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    });

    if (!res.ok) return [];

    const data = await res.json();
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
    const symbols = [];

    for (const quote of quotes) {
      const symbol = String(quote?.symbol || "").toUpperCase();
      if (!symbol) continue;

      // Keep Taiwan market symbols first. This supports TWSE and TPEx.
      if (/\.(TW|TWO)$/i.test(symbol) && !symbols.includes(symbol)) {
        symbols.push(symbol);
      }
    }

    return symbols;
  } catch (err) {
    return [];
  }
}

async function fetchGoogleFinanceSearchSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  try {
    const url = `https://www.google.com/finance/search?q=${encodeURIComponent(q)}&hl=zh-TW`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    });

    if (!res.ok) return [];

    const html = await res.text();
    const symbols = [];
    const regex = /\/finance\/quote\/([^"/:?]+):(TPE|TWO)/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const base = String(match[1] || "").toUpperCase();
      const exchange = String(match[2] || "").toUpperCase();
      const symbol = exchange === "TWO" ? `${base}.TWO` : `${base}.TW`;

      if (base && !symbols.includes(symbol)) {
        symbols.push(symbol);
      }
    }

    return symbols;
  } catch (err) {
    return [];
  }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  const n = Number(value || 0);
  return `NT$${n.toLocaleString("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value) {
  const n = Number(value || 0);
  return `${n.toFixed(2)}%`;
}


function parseTradeDateInput(input) {
  const value = String(input || "").trim();
  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "INVALID";
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "INVALID";
  }

  return value;
}

function formatTradeDate(value) {
  if (!value) return "未填寫";
  return new Date(value).toLocaleDateString("zh-TW");
}

function calculateCommission(grossAmount) {
  const fee = Number(grossAmount) * COMMISSION_RATE * TAISHIN_DISCOUNT;
  return roundMoney(Math.max(MIN_COMMISSION, fee));
}

function calculateBuy(grossAmount) {
  const commission = calculateCommission(grossAmount);
  return {
    commission,
    tax: 0,
    netAmount: roundMoney(Number(grossAmount) + commission)
  };
}

function calculateSell(grossAmount) {
  const commission = calculateCommission(grossAmount);
  const tax = roundMoney(Number(grossAmount) * SELL_TAX_RATE);
  return {
    commission,
    tax,
    netAmount: roundMoney(Number(grossAmount) - commission - tax)
  };
}

async function fetchCurrentPrice(symbol, name = null) {
  const checkedSymbols = [];

  function addCandidates(values) {
    for (const value of values || []) {
      const normalized = String(value || "").trim().toUpperCase();
      if (normalized && !checkedSymbols.includes(normalized)) {
        checkedSymbols.push(normalized);
      }
    }
  }

  // 1) Direct lookup from the registered symbol.
  // Example: registered 009823.TW can fail, but 009823.TWO may work.
  addCandidates(getYahooSymbolCandidates(symbol));

  for (const candidate of checkedSymbols) {
    const price = await fetchYahooCurrentPrice(candidate);
    if (price !== null) return price;
  }

  for (const candidate of checkedSymbols) {
    const price = await fetchGoogleFinancePrice(candidate);
    if (price !== null) return price;
  }

  // 2) If the registered stock code is wrong or not recognized, resolve by股名.
  // Example: if user registered 台積電 with a wrong code, search 台積電 and use the matched listed ticker.
  const searchQueries = [name, `${name || ""} 股票`, getStockBase(symbol)].filter(Boolean);

  for (const query of searchQueries) {
    const yahooSearchSymbols = await fetchYahooSearchSymbols(query);
    addCandidates(yahooSearchSymbols);

    for (const candidate of yahooSearchSymbols) {
      const price = await fetchYahooCurrentPrice(candidate);
      if (price !== null) return price;
    }
  }

  for (const query of searchQueries) {
    const googleSearchSymbols = await fetchGoogleFinanceSearchSymbols(query);
    addCandidates(googleSearchSymbols);

    for (const candidate of googleSearchSymbols) {
      const price = await fetchYahooCurrentPrice(candidate);
      if (price !== null) return price;

      const googlePrice = await fetchGoogleFinancePrice(candidate);
      if (googlePrice !== null) return googlePrice;
    }
  }

  return null;
}

async function getUserTrades(userId) {
  if (!pool) return [];

  const result = await pool.query(
    `SELECT * FROM stock_trades WHERE user_id = $1 ORDER BY id ASC`,
    [userId]
  );

  return result.rows;
}

function buildPositions(trades) {
  const positions = new Map();

  for (const trade of trades) {
    const symbol = normalizeStockSymbol(trade.symbol);

    if (!positions.has(symbol)) {
      positions.set(symbol, {
        symbol,
        name: trade.name,
        shares: 0,
        costBasis: 0,
        realizedProfit: 0,
        totalBuyGross: 0,
        totalBuyCost: 0,
        totalSellGross: 0,
        totalSellNet: 0
      });
    }

    const pos = positions.get(symbol);
    const shares = Number(trade.shares);
    const gross = Number(trade.gross_amount);
    const net = Number(trade.net_amount);

    if (trade.type === "BUY") {
      pos.name = trade.name;
      pos.shares += shares;
      pos.costBasis += net;
      pos.totalBuyGross += gross;
      pos.totalBuyCost += net;
    }

    if (trade.type === "SELL") {
      const avgCost = pos.shares > 0 ? pos.costBasis / pos.shares : 0;
      const avgGross = pos.shares > 0 ? pos.totalBuyGross / pos.shares : 0;
      const removedCost = avgCost * shares;
      const removedGross = avgGross * shares;

      pos.shares -= shares;
      pos.costBasis -= removedCost;
      pos.totalBuyGross -= removedGross;
      pos.totalBuyCost -= removedCost;
      pos.realizedProfit += net - removedCost;
      pos.totalSellGross += gross;
      pos.totalSellNet += net;

      if (pos.shares < 0.000001) {
        pos.shares = 0;
        pos.costBasis = 0;
        pos.totalBuyGross = 0;
        pos.totalBuyCost = 0;
      }
    }
  }

  return positions;
}

function createHistoryCsv(trades) {
  const header = [
    "ID",
    "類型",
    "股票代號",
    "股名",
    "股數",
    "單價",
    "成交金額",
    "手續費",
    "證交稅",
    "實付/實收",
    "已實現損益",
    "實際交易日期",
    "紀錄時間"
  ];

  const lines = [header.join(",")];

  for (const t of trades) {
    const row = [
      t.id,
      t.type === "BUY" ? "買進" : "賣出",
      t.symbol,
      t.name,
      Number(t.shares),
      Number(t.price),
      Number(t.gross_amount).toFixed(2),
      Number(t.commission).toFixed(2),
      Number(t.tax).toFixed(2),
      Number(t.net_amount).toFixed(2),
      Number(t.realized_profit).toFixed(2),
      t.trade_date ? new Date(t.trade_date).toLocaleDateString("zh-TW") : "未填寫",
      new Date(t.created_at).toLocaleString("zh-TW")
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);

    lines.push(row.join(","));
  }

  return "\uFEFF" + lines.join("\n");
}

function requireDatabaseReply(interaction) {
  if (pool) return false;

  interaction.reply({
    content: "❌ 資料庫尚未設定，請確認 Railway 的 DATABASE_URL。",
    ephemeral: true
  });

  return true;
}

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/* ---------------- COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("建立抽獎")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName("title").setDescription("標題").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("內容說明").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("獎品").setRequired(true))
    .addIntegerOption(o => o.setName("winners").setDescription("得獎人數").setRequired(true))
    .addIntegerOption(o => o.setName("days").setDescription("天數，可填 0"))
    .addIntegerOption(o => o.setName("hours").setDescription("小時，可填 0"))
    .addIntegerOption(o => o.setName("minutes").setDescription("分鐘，可填 0"))
    .addRoleOption(o => o.setName("role1").setDescription("需求身分組 1"))
    .addRoleOption(o => o.setName("role2").setDescription("需求身分組 2"))
    .addRoleOption(o => o.setName("role3").setDescription("需求身分組 3"))
    .addRoleOption(o => o.setName("pingrole").setDescription("標記身分組"))
    .addStringOption(o => o.setName("fln").setDescription("指定得獎者 ID，沒有就填 0")),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("重抽抽獎")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName("messageid").setDescription("抽獎訊息 ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("強制結束抽獎")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName("messageid").setDescription("抽獎訊息 ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("刪除訊息")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addIntegerOption(o => o.setName("amount").setDescription("刪除數量").setRequired(true)),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("新增股票買進紀錄")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName("stock").setDescription("股票代號，例如 2330 或 2330.TW").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("股名，例如 台積電").setRequired(true))
    .addNumberOption(o => o.setName("shares").setDescription("股數").setRequired(true))
    .addNumberOption(o => o.setName("price").setDescription("每股成交價格").setRequired(true))
    .addStringOption(o => o.setName("date").setDescription("實際買進日期，例如 2026-08-10，可不填")),

  new SlashCommandBuilder()
    .setName("sellstock")
    .setDescription("新增股票賣出紀錄")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName("stock").setDescription("股票代號，例如 2330 或 2330.TW").setRequired(true))
    .addNumberOption(o => o.setName("shares").setDescription("賣出股數").setRequired(true))
    .addNumberOption(o => o.setName("price").setDescription("每股賣出價格").setRequired(true))
    .addStringOption(o => o.setName("date").setDescription("實際賣出日期，例如 2026-08-10，可不填")),

  new SlashCommandBuilder()
    .setName("showstock")
    .setDescription("查看股票紀錄與損益")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("deletestock")
    .setDescription("刪除錯誤股票紀錄")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addIntegerOption(o => o.setName("id").setDescription("要刪除的紀錄 ID").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await initStockDatabase();
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ Bot online");
});

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: "❌ 此指令僅限管理員使用。", ephemeral: true });
    }

    /* ---- GIVEAWAY ---- */
    if (interaction.commandName === "giveaway") {
      const title = interaction.options.getString("title");
      const desc = interaction.options.getString("description");
      const prize = interaction.options.getString("prize");
      const winners = interaction.options.getInteger("winners");

      const days = interaction.options.getInteger("days") || 0;
      const hours = interaction.options.getInteger("hours") || 0;
      const minutes = interaction.options.getInteger("minutes") || 0;

      const durationMs = (((days * 24 + hours) * 60) + minutes) * 60 * 1000;
      if (durationMs <= 0)
        return interaction.reply({ content: "❌ 抽獎時間無效。", ephemeral: true });

      const endAt = Date.now() + durationMs;

      const reqRoles = [
        interaction.options.getRole("role1"),
        interaction.options.getRole("role2"),
        interaction.options.getRole("role3")
      ].filter(Boolean);

      const pingRole = interaction.options.getRole("pingrole");
      const flnRaw = interaction.options.getString("fln") || "0";
      const fln = flnRaw === "0" ? null : flnRaw;

      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${title}`)
        .setColor(0x00ffff)
        .setDescription(
          `${desc}\n\n` +
          `🏆 **獎品：** ${prize}\n` +
          `👥 **得獎人數：** ${winners}\n` +
          `🔒 **參加條件：** ${reqRoles.length ? reqRoles.map(r => `<@&${r.id}>`).join(", ") : "無"}\n\n` +
          `👤 **參與人數：** 0\n\n` +
          `⏰ 結束時間 <t:${Math.floor(endAt / 1000)}:R>`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("join_gw")
          .setLabel("🎉 參加抽獎")
          .setStyle(ButtonStyle.Success)
      );

      const msg = await interaction.channel.send({
        content: pingRole ? `<@&${pingRole.id}>` : null,
        embeds: [embed],
        components: [row]
      });

      giveaways.set(msg.id, {
        channelId: msg.channel.id,
        prize,
        endAt,
        users: new Set(),
        reqRoles,
        fln,
        ended: false,
        baseEmbed: embed
      });

      interaction.reply({ content: "✅ 抽獎已建立。", ephemeral: true });
    }

    /* ---- REROLL (PUBLIC) ---- */
    if (interaction.commandName === "reroll") {
      const g = giveaways.get(interaction.options.getString("messageid"));
      if (!g) return interaction.reply({ content: "❌ 找不到抽獎。", ephemeral: true });

      const pool = [...g.users];
      if (!pool.length)
        return interaction.reply({ content: "❌ 沒有參與者。", ephemeral: true });

      const winner = g.fln ?? pool[Math.floor(Math.random() * pool.length)];

      await interaction.channel.send(
        `🔁 ${interaction.user} **重新抽出了得獎者！**\n🎉 恭喜 <@${winner}>！你贏得了 **${g.prize}**。`
      );

      interaction.reply({ content: "✅ 已重新抽獎。", ephemeral: true });
    }

    /* ---- FORCE END (PUBLIC) ---- */
    if (interaction.commandName === "end") {
      const id = interaction.options.getString("messageid");
      const g = giveaways.get(id);
      if (!g || g.ended)
        return interaction.reply({ content: "❌ 抽獎無效或已結束。", ephemeral: true });

      await endGiveaway(id, g);
      await interaction.channel.send(`🛑 ${interaction.user} **已強制結束此抽獎。**`);
      interaction.reply({ content: "✅ 抽獎已結束。", ephemeral: true });
    }

    /* ---- NUKE ---- */
    if (interaction.commandName === "nuke") {
      const amount = interaction.options.getInteger("amount");
      const deleted = await interaction.channel.bulkDelete(amount, true);
      interaction.channel.send(`💣 已清除 **${deleted.size}** 則訊息。`);
      interaction.reply({ content: "✅ 完成。", ephemeral: true });
    }

    /* ---- BUY STOCK ---- */
    if (interaction.commandName === "buy") {
      if (requireDatabaseReply(interaction)) return;

      const symbol = normalizeStockSymbol(interaction.options.getString("stock"));
      const name = interaction.options.getString("name").trim();
      const shares = Number(interaction.options.getNumber("shares"));
      const price = Number(interaction.options.getNumber("price"));
      const tradeDate = parseTradeDateInput(interaction.options.getString("date"));

      if (tradeDate === "INVALID") {
        return interaction.reply({ content: "❌ 日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-08-10。", ephemeral: true });
      }

      if (!symbol || !name || shares <= 0 || price <= 0) {
        return interaction.reply({ content: "❌ 股票代號、股名、股數或價格無效。", ephemeral: true });
      }

      const grossAmount = roundMoney(shares * price);
      const fee = calculateBuy(grossAmount);

      const result = await pool.query(
        `INSERT INTO stock_trades
         (user_id, symbol, name, type, shares, price, gross_amount, commission, tax, net_amount, realized_profit, trade_date)
         VALUES ($1,$2,$3,'BUY',$4,$5,$6,$7,$8,$9,0,$10)
         RETURNING id`,
        [interaction.user.id, symbol, name, shares, price, grossAmount, fee.commission, fee.tax, fee.netAmount, tradeDate]
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ 買進紀錄已新增")
        .setColor(0x2ecc71)
        .addFields(
          { name: "紀錄 ID", value: `${result.rows[0].id}`, inline: true },
          { name: "實際買進日期", value: tradeDate || "未填寫", inline: true },
          { name: "股票", value: `${name} (${symbol})`, inline: true },
          { name: "股數", value: `${shares}`, inline: true },
          { name: "成交均價", value: formatMoney(price), inline: true },
          { name: "成交金額", value: formatMoney(grossAmount), inline: true },
          { name: "買進手續費", value: formatMoney(fee.commission), inline: true },
          { name: "投資成本", value: formatMoney(fee.netAmount), inline: true }
        )
        .setFooter({ text: "手續費已依台新證券 2.8 折與最低 20 元計算。" })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    /* ---- SELL STOCK ---- */
    if (interaction.commandName === "sellstock") {
      if (requireDatabaseReply(interaction)) return;

      const symbol = normalizeStockSymbol(interaction.options.getString("stock"));
      const shares = Number(interaction.options.getNumber("shares"));
      const price = Number(interaction.options.getNumber("price"));
      const tradeDate = parseTradeDateInput(interaction.options.getString("date"));

      if (tradeDate === "INVALID") {
        return interaction.reply({ content: "❌ 日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-08-10。", ephemeral: true });
      }

      if (!symbol || shares <= 0 || price <= 0) {
        return interaction.reply({ content: "❌ 股票代號、股數或價格無效。", ephemeral: true });
      }

      const trades = await getUserTrades(interaction.user.id);
      const positions = buildPositions(trades);
      const pos = positions.get(symbol);

      if (!pos || pos.shares < shares) {
        return interaction.reply({
          content: `❌ 持股不足。你目前持有 ${pos ? pos.shares : 0} 股 ${symbol}。`,
          ephemeral: true
        });
      }

      const avgCost = pos.costBasis / pos.shares;
      const removedCost = avgCost * shares;
      const grossAmount = roundMoney(shares * price);
      const fee = calculateSell(grossAmount);
      const realizedProfit = roundMoney(fee.netAmount - removedCost);

      const result = await pool.query(
        `INSERT INTO stock_trades
         (user_id, symbol, name, type, shares, price, gross_amount, commission, tax, net_amount, realized_profit, trade_date)
         VALUES ($1,$2,$3,'SELL',$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [interaction.user.id, symbol, pos.name, shares, price, grossAmount, fee.commission, fee.tax, fee.netAmount, realizedProfit, tradeDate]
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ 賣出紀錄已新增")
        .setColor(realizedProfit >= 0 ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: "紀錄 ID", value: `${result.rows[0].id}`, inline: true },
          { name: "實際賣出日期", value: tradeDate || "未填寫", inline: true },
          { name: "股票", value: `${pos.name} (${symbol})`, inline: true },
          { name: "賣出股數", value: `${shares}`, inline: true },
          { name: "賣出單價", value: formatMoney(price), inline: true },
          { name: "成交金額", value: formatMoney(grossAmount), inline: true },
          { name: "賣出手續費", value: formatMoney(fee.commission), inline: true },
          { name: "證交稅", value: formatMoney(fee.tax), inline: true },
          { name: "實際收入", value: formatMoney(fee.netAmount), inline: true },
          { name: "已實現損益", value: formatMoney(realizedProfit), inline: true }
        )
        .setFooter({ text: "賣出已扣除手續費與 0.3% 證交稅。" })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    /* ---- SHOW STOCK ---- */
    if (interaction.commandName === "showstock") {
      if (requireDatabaseReply(interaction)) return;

      await interaction.deferReply({ ephemeral: true });

      const trades = await getUserTrades(interaction.user.id);

      if (!trades.length) {
        return interaction.editReply("📭 尚未有任何股票紀錄。");
      }

      const positions = buildPositions(trades);
      const openPositions = [...positions.values()].filter(p => p.shares > 0);

      let totalCost = 0;
      let totalMarketNet = 0;
      let totalUnrealized = 0;
      let totalRealized = [...positions.values()].reduce((sum, p) => sum + p.realizedProfit, 0);

      const lines = [];

      for (const pos of openPositions) {
        const currentPrice = await fetchCurrentPrice(pos.symbol, pos.name);
        const avgCost = pos.shares > 0 ? pos.costBasis / pos.shares : 0;

        totalCost += pos.costBasis;

        if (currentPrice !== null) {
          const marketGross = roundMoney(currentPrice * pos.shares);
          const exitFee = calculateSell(marketGross);
          const marketNet = exitFee.netAmount;
          const unrealized = roundMoney(marketNet - pos.costBasis);
          const profitRate = pos.costBasis > 0 ? (unrealized / pos.costBasis) * 100 : 0;

          totalMarketNet += marketNet;
          totalUnrealized += unrealized;

          lines.push(
            `**${pos.name} (${pos.symbol})**\n` +
            `股數：${pos.shares}\n` +
            `成交金額：${formatMoney(pos.totalBuyGross)}\n` +
            `投資成本：${formatMoney(pos.costBasis)}\n` +
            `現在價格：${formatMoney(currentPrice)}\n` +
            `成交均價：${formatMoney(avgCost)}\n` +
            `帳面收入：${formatMoney(marketNet)}\n` +
            `未實現損益：${formatMoney(unrealized)}\n` +
            `損益率：${formatPercent(profitRate)}\n` +
            `損益平均率：${formatPercent(profitRate)}`
          );
        } else {
          lines.push(
            `**${pos.name} (${pos.symbol})**\n` +
            `股數：${pos.shares}\n` +
            `成交金額：${formatMoney(pos.totalBuyGross)}\n` +
            `投資成本：${formatMoney(pos.costBasis)}\n` +
            `現在價格：無法取得\n` +
            `成交均價：${formatMoney(avgCost)}\n` +
            `帳面收入：無法計算\n` +
            `未實現損益：無法計算\n` +
            `損益率：無法計算\n` +
            `損益平均率：無法計算`
          );
        }
      }

      const totalProfit = totalRealized + totalUnrealized;
      const unrealizedRate = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;

      const summaryEmbed = new EmbedBuilder()
        .setTitle("📈 股票紀錄總覽")
        .setColor(totalProfit >= 0 ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: "目前持股檔數", value: `${openPositions.length}`, inline: true },
          { name: "交易紀錄數", value: `${trades.length}`, inline: true },
          { name: "目前投資成本", value: formatMoney(totalCost), inline: true },
          { name: "已實現損益", value: formatMoney(totalRealized), inline: true },
          { name: "未實現損益", value: formatMoney(totalUnrealized), inline: true },
          { name: "總損益", value: formatMoney(totalProfit), inline: true },
          { name: "未實現損益率", value: formatPercent(unrealizedRate), inline: true }
        )
        .setFooter({ text: "未實現損益以 Yahoo Finance／Google Finance 目前價格估算，並扣除預估賣出手續費與證交稅。" })
        .setTimestamp();

      const embeds = [summaryEmbed];

      if (lines.length) {
        let chunk = "";
        let count = 1;

        for (const line of lines) {
          if ((chunk + "\n\n" + line).length > 3900) {
            embeds.push(
              new EmbedBuilder()
                .setTitle(`📊 持股明細 ${count}`)
                .setColor(0x3498db)
                .setDescription(chunk)
            );
            chunk = line;
            count++;
          } else {
            chunk = chunk ? `${chunk}\n\n${line}` : line;
          }
        }

        if (chunk) {
          embeds.push(
            new EmbedBuilder()
              .setTitle(`📊 持股明細 ${count}`)
              .setColor(0x3498db)
              .setDescription(chunk)
          );
        }
      }

      const csv = createHistoryCsv(trades);
      const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
        name: "stock_history.csv"
      });

      return interaction.editReply({
        embeds: embeds.slice(0, 10),
        files: [file]
      });
    }

    /* ---- DELETE STOCK RECORD ---- */
    if (interaction.commandName === "deletestock") {
      if (requireDatabaseReply(interaction)) return;

      const id = interaction.options.getInteger("id");

      const result = await pool.query(
        `DELETE FROM stock_trades WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, interaction.user.id]
      );

      if (!result.rows.length) {
        return interaction.reply({ content: "❌ 找不到此紀錄，或你沒有權限刪除。", ephemeral: true });
      }

      return interaction.reply({
        content: `✅ 已刪除股票紀錄 ID：${id}`,
        ephemeral: true
      });
    }
  }

  /* ---- JOIN BUTTON ---- */
  if (interaction.isButton() && interaction.customId === "join_gw") {
    const g = giveaways.get(interaction.message.id);
    if (!g || g.ended)
      return interaction.reply({ content: "❌ 抽獎已結束。", ephemeral: true });

    if (g.reqRoles.length) {
      const ok = g.reqRoles.some(r => interaction.member.roles.cache.has(r.id));
      if (!ok)
        return interaction.reply({ content: "❌ 你不符合參加條件。", ephemeral: true });
    }

    g.users.add(interaction.user.id);

    const updated = EmbedBuilder.from(g.baseEmbed)
      .setDescription(
        g.baseEmbed.data.description.replace(
          "👤 **參與人數：** 0",
          `👤 **參與人數：** ${g.users.size}`
        )
      );

    await interaction.message.edit({ embeds: [updated] });
    interaction.reply({ content: "✅ 你已成功參加抽獎。", ephemeral: true });
  }
});

/* ---------------- END LOGIC ---------------- */

async function endGiveaway(id, g) {
  if (g.ended) return;
  g.ended = true;

  const channel = await client.channels.fetch(g.channelId);
  const message = await channel.messages.fetch(id);

  const embed = EmbedBuilder.from(message.embeds[0]);
  embed.setDescription(embed.data.description.replace(/⏰ 結束時間.*$/m, "🛑 **抽獎已結束**"));

  await message.edit({ embeds: [embed], components: [] });

  if (g.users.size) {
    const pool = [...g.users];
    const winner = g.fln ?? pool[Math.floor(Math.random() * pool.length)];
    channel.send(`🎉 恭喜 <@${winner}>！你贏得了 **${g.prize}**。`);
  } else {
    channel.send("❌ 抽獎結束，但沒有任何參與者。");
  }
}

/* ---------------- AUTO CHECK ---------------- */

setInterval(() => {
  for (const [id, g] of giveaways) {
    if (!g.ended && Date.now() >= g.endAt) {
      endGiveaway(id, g);
    }
  }
}, 5000);

client.login(process.env.TOKEN);
