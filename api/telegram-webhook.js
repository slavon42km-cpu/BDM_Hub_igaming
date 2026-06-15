const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

const QUESTIONS = [
  {
    field: "role",
    text: "Great. What best describes you or your company?\nExamples: affiliate, media buyer, affiliate network, operator, advertiser, platform, tech provider."
  },
  {
    field: "looking_for",
    text: "What exactly are you looking for?\nExamples: offers, traffic, partnership, tracker, automation, consulting, platform setup, process optimization."
  },
  {
    field: "geos",
    text: "Which GEOs are relevant for you?\nExample: DE, CA, AU, UK, LATAM, Tier 1, worldwide."
  },
  {
    field: "traffic_or_product",
    text: "What traffic source, product type or business model are we talking about?\nExamples: PPC, SEO, ASO, social, influencer, push, native, casino, sportsbook, affiliate network, tracker, operator platform."
  },
  {
    field: "volume_or_scale",
    text: "What is your current volume, expected scale or business stage?\nExamples: 50 FTD/month, 500+ leads/month, launching soon, existing operator, scaling media buying team."
  },
  {
    field: "preferred_contact",
    text: "What is the best way to contact you?\nExamples: Telegram username, WhatsApp, email, LinkedIn."
  },
  {
    field: "comment",
    text: "Any additional context I should know?"
  }
];

const START_MESSAGE = "Welcome to Affiliate iGaming Bot.\nWhat type of iGaming opportunity are you looking for?";

const START_KEYBOARD = {
  inline_keyboard: [
    [{ text: "I'm looking for iGaming offers", callback_data: "path:offers" }],
    [{ text: "I have traffic", callback_data: "path:traffic" }],
    [{ text: "I represent an operator / advertiser", callback_data: "path:operator" }],
    [{ text: "I need tracker / automation", callback_data: "path:automation" }],
    [{ text: "I need consulting", callback_data: "path:consulting" }]
  ]
};

// Flow state is stored in memory for now.
// Vercel may reset this between cold starts, so this is intentionally temporary.
const flowState = globalThis.__telegramLeadFlowState || new Map();
globalThis.__telegramLeadFlowState = flowState;

module.exports = async function telegramWebhook(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("Telegram webhook endpoint is running.");
  }

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // Webhook receives Telegram updates here.
    const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    await handleTelegramUpdate(update);
  } catch (error) {
    console.error("Telegram webhook internal error:", error);
  }

  // Telegram should always receive HTTP 200 OK, even after internal errors.
  return res.status(200).send("OK");
};

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data || "";
  const user = callbackQuery.from || {};
  const chatId = callbackQuery.message?.chat?.id || user.id;

  if (!data.startsWith("path:") || !user.id || !chatId) {
    return;
  }

  const path = data.replace("path:", "");
  flowState.set(String(user.id), {
    path,
    chatId,
    user,
    step: 0,
    answers: {}
  });

  await sendMessage(chatId, QUESTIONS[0].text);
}

async function handleMessage(message) {
  const text = (message.text || "").trim();
  const chatId = message.chat?.id;
  const user = message.from || {};
  const userId = user.id ? String(user.id) : "";

  if (!chatId || !userId) {
    return;
  }

  if (text === "/start") {
    flowState.delete(userId);
    await sendMessage(chatId, START_MESSAGE, START_KEYBOARD);
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      "This bot helps qualify iGaming partnership requests: offers, traffic, operators, automation, tracker and consulting inquiries. Use /start to begin."
    );
    return;
  }

  if (text === "/contact") {
    await sendMessage(chatId, "Fastest direct contact: @Farmacevt777");
    return;
  }

  const state = flowState.get(userId);
  if (!state) {
    await sendMessage(chatId, "Use /start to begin.");
    return;
  }

  const currentQuestion = QUESTIONS[state.step];
  state.answers[currentQuestion.field] = text || "-";
  state.step += 1;
  state.chatId = chatId;
  state.user = user;

  if (state.step < QUESTIONS.length) {
    flowState.set(userId, state);
    await sendMessage(chatId, QUESTIONS[state.step].text);
    return;
  }

  const summary = buildAdminSummary(state);
  const adminChatId = process.env.ADMIN_CHAT_ID;

  if (adminChatId) {
    await sendMessage(adminChatId, summary);
  } else {
    console.error("ADMIN_CHAT_ID is not configured.");
  }

  flowState.delete(userId);

  await sendMessage(
    chatId,
    "Thanks. I received your request and will review it shortly. I will contact you via your preferred contact method."
  );
}

// Admin summary is generated here after all lead fields are collected.
function buildAdminSummary(state) {
  const user = state.user || {};
  const answers = state.answers || {};
  const username = user.username ? `@${user.username}` : "-";
  const firstName = user.first_name || "";
  const lastName = user.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim() || "-";

  return [
    "New iGaming Lead",
    "",
    "Telegram User:",
    "",
    `* ID: ${user.id || "-"}`,
    `* Username: ${username}`,
    `* Name: ${fullName}`,
    "",
    "Lead Details:",
    "",
    `* Path: ${state.path || "-"}`,
    `* Role: ${answers.role || "-"}`,
    `* Looking for: ${answers.looking_for || "-"}`,
    `* GEOs: ${answers.geos || "-"}`,
    `* Traffic / Product: ${answers.traffic_or_product || "-"}`,
    `* Volume / Scale: ${answers.volume_or_scale || "-"}`,
    `* Preferred Contact: ${answers.preferred_contact || "-"}`,
    `* Comment: ${answers.comment || "-"}`
  ].join("\n");
}

// Messages are sent to Telegram through the Bot API here.
async function sendMessage(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured.");
    return false;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    })
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Telegram sendMessage failed:", response.status, details);
    return false;
  }

  return true;
}
