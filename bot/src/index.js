import { createServer } from "node:http";
import { request } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const botDir = join(__dirname, "..");

loadEnv(join(botDir, ".env"));

const env = process.env;
const token = requiredEnv("BOT_TOKEN");
const apiBase = `https://api.telegram.org/bot${token}`;
const channelId = requiredEnv("CHANNEL_ID");
const channelInviteUrl = env.CHANNEL_INVITE_URL || "https://t.me/+idyFDaVLUPY2ZmRi";
const channelTitle = env.CHANNEL_TITLE || "Кластер уникальности";
const botName = env.BOT_NAME || "Елена Насырова Бот";
const materials = JSON.parse(readFileSync(join(botDir, "materials.json"), "utf8"));

const socialLinks = [
  ["Кластер уникальности", channelInviteUrl, "канал с материалами, мыслями и практиками"],
  ["✈️ Telegram", env.CONTACT_TG_URL || "https://t.me/alteyapro", "личные сообщения и быстрый контакт"],
  ["▶️ Rutube", env.RUTUBE_CHANNEL_URL || "https://rutube.ru/channel/49466882/", "подкасты Елены с мастерами"],
  ["vk VK", env.VK_URL || "https://vk.com/alteyaprogroup", "анонсы и дополнительные материалы"],
  ["◎ Instagram", env.INSTAGRAM_URL || "https://www.instagram.com/nasyrovaelena?igshid=MzRlODBiNWFlZA%3D%3D", "визуальная лента и живой контекст"],
  ["◇ Сайт", env.SITE_URL || "https://elena-nasyrova.ru/", "визитка, музыка и практики"]
];

const flows = new Set(["sacrameditations", "sila_roda"]);
let offset = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (env.PORT) startHealthServer(Number(env.PORT));

  console.log(`${botName} started in polling mode`);
  await api("deleteWebhook", { drop_pending_updates: false });

  while (true) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"]
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("Polling error:", error.message);
      await wait(1500);
    }
  }
}

async function handleUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const [commandRaw, payloadRaw] = text.split(/\s+/, 2);
  const command = commandRaw?.split("@")[0];
  const payload = normalizePayload(payloadRaw);

  if (command === "/start") {
    if (payload && flows.has(payload)) {
      await sendGate(chatId, message.from, payload);
      return;
    }

    await sendWelcome(chatId);
    return;
  }

  if (command === "/sacrameditations") {
    await sendGate(chatId, message.from, "sacrameditations");
    return;
  }

  if (command === "/sila_roda") {
    await sendGate(chatId, message.from, "sila_roda");
    return;
  }

  if (command === "/socials") {
    await sendSocials(chatId);
    return;
  }

  if (command === "/help") {
    await sendHelp(chatId);
    return;
  }

  await sendWelcome(chatId);
}

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const data = callback.data || "";

  if (data.startsWith("check:")) {
    const flow = normalizePayload(data.slice("check:".length));
    await api("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Проверяю подписку"
    });
    await sendGate(chatId, callback.from, flow);
    return;
  }

  if (data.startsWith("open:")) {
    const flow = normalizePayload(data.slice("open:".length));
    await api("answerCallbackQuery", { callback_query_id: callback.id });
    await sendMaterial(chatId, flow);
    return;
  }

  if (data === "socials") {
    await api("answerCallbackQuery", { callback_query_id: callback.id });
    await sendSocials(chatId);
  }
}

async function sendWelcome(chatId) {
  await sendMessage(chatId, [
    `Здравствуйте. Я ${botName}.`,
    "",
    "Помогу получить материалы Елены после подписки на канал, а ещё сохраню рядом важные ссылки: Telegram, Rutube, VK, Instagram и сайт.",
    "",
    "Что хотите открыть?"
  ].join("\n"), {
    inline_keyboard: [
      [{ text: "Бесплатные сакрамедитации", callback_data: "check:sacrameditations" }],
      [{ text: "Спектакль-практика «Сила Рода»", callback_data: "check:sila_roda" }],
      [{ text: "Контакты и соцсети", callback_data: "socials" }]
    ]
  });
}

async function sendHelp(chatId) {
  await sendMessage(chatId, [
    "Я проверяю подписку на канал и открываю материалы Елены.",
    "",
    "Команды:",
    "/sacrameditations — сакрамедитации",
    "/sila_roda — спектакль-практика «Сила Рода»",
    "/socials — контакты и соцсети"
  ].join("\n"));
}

async function sendGate(chatId, user, flow) {
  if (!flows.has(flow)) {
    await sendWelcome(chatId);
    return;
  }

  const subscribed = await isSubscribed(user.id);
  if (subscribed) {
    await sendMaterial(chatId, flow);
    return;
  }

  await sendMessage(chatId, [
    `Чтобы открыть материал, подпишитесь на канал «${channelTitle}».`,
    "",
    "После подписки нажмите «Я подписался», и я сразу проверю доступ."
  ].join("\n"), {
    inline_keyboard: [
      [{ text: `Подписаться на ${channelTitle}`, url: channelInviteUrl }],
      [{ text: "Я подписался", callback_data: `check:${flow}` }]
    ]
  });
}

async function sendMaterial(chatId, flow) {
  const material = materials[flow];
  const materialUrl = material.envUrl ? env[material.envUrl] || material.fallbackUrl || "" : material.fallbackUrl || "";
  const rows = [];

  if (materialUrl) rows.push([{ text: material.title, url: materialUrl }]);
  rows.push([{ text: "Rutube Елены", url: env.RUTUBE_CHANNEL_URL || "https://rutube.ru/channel/49466882/" }]);
  rows.push([{ text: "Контакты и соцсети", callback_data: "socials" }]);

  await sendMessage(chatId, [
    `Доступ открыт: ${material.title}`,
    "",
    material.description,
    "",
    materialUrl ? "Нажмите кнопку ниже, чтобы открыть материал." : material.emptyText
  ].join("\n"), { inline_keyboard: rows });

  await sendSocials(chatId, {
    intro: "Еще можно остаться рядом с Еленой в других пространствах. Там больше уникального контента, подкасты, анонсы и живые материалы:"
  });
}

async function sendSocials(chatId, options = {}) {
  const rows = socialLinks
    .filter(([, url]) => Boolean(url))
    .map(([title, url]) => [{ text: title, url }]);

  const list = socialLinks
    .filter(([, url]) => Boolean(url))
    .map(([title, , note]) => `${title} — ${note}`)
    .join("\n");

  await sendMessage(chatId, [
    "Где еще быть рядом:",
    "",
    options.intro || "Можно подписаться, сохранить страницу или вернуться сюда позже.",
    "",
    list,
    "",
    "Почта для связи: altadaran@gmail.com"
  ].join("\n"), { inline_keyboard: rows });
}

async function isSubscribed(userId) {
  try {
    const member = await api("getChatMember", {
      chat_id: channelId,
      user_id: userId
    });

    return ["creator", "administrator", "member"].includes(member.status);
  } catch (error) {
    console.error("Subscription check failed:", error.message);
    return false;
  }
}

async function sendMessage(chatId, text, replyMarkup) {
  return api("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: replyMarkup
  });
}

async function api(method, payload = {}) {
  const data = await postJson(`${apiBase}/${method}`, payload);
  if (!data.ok) {
    throw new Error(`${method}: ${data.description || "Telegram API error"}`);
  }

  return data.result;
}

function postJson(url, payload) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      },
      timeout: 60000
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(new Error(`Telegram returned invalid JSON: ${error.message}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Telegram request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function normalizePayload(payload) {
  if (!payload) return "";
  return payload.trim().toLowerCase().replace(/-/g, "_");
}

function requiredEnv(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = unquote(value);
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function startHealthServer(port) {
  createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(`${botName} is running\n`);
  }).listen(port, () => {
    console.log(`Health server listening on ${port}`);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
