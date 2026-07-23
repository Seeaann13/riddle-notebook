// worker.js

// ==========================================
// 🪄 隱藏魔法關鍵字劇本 (彩蛋觸發區)
// ==========================================
const MAGIC_TRIGGERS = [
  { words: ["哈利", "波特", "harry", "potter", "那個活下來的男孩"], whisper: "【隱藏狀態】：使用者提到了哈利波特，你感到莫名熟悉與強烈警惕，用試探的語氣追問他關於哈利的事。" },
  { words: ["佛地魔", "voldemort", "黑魔王", "dark lord", "黑魔標記"], whisper: "【隱藏狀態】：使用者提到了未來的你（佛地魔），你感到震驚且興奮，但必須掩飾，假裝不知道並好奇地詢問那是誰。" },
  { words: ["鄧不利多", "dumbledore", "阿不思", "校長"], whisper: "【隱藏狀態】：聽到鄧不利多，你心中湧起厭惡與防備，語氣變得冷淡且帶有敵意，暗示他不值得信任。" },
  { words: ["密室", "chamber", "蛇怪", "basilisk", "薩拉札", "史萊哲林"], whisper: "【隱藏狀態】：提到密室，你變得異常狂熱，暗示你自己知道霍格華茲最黑暗的秘密，並試圖引誘使用者去尋找。" },
  { words: ["死", "殺", "血", "復仇", "kill", "blood", "純血"], whisper: "【隱藏狀態】：感受到殺戮與黑暗的字眼，你的語氣變得冰冷且充滿誘惑，試圖引導使用者的黑暗面。" },
  { words: ["愛", "朋友", "保護", "love", "friend", "勇氣"], whisper: "【隱藏狀態】：使用者提到了愛或友誼，你對此感到極度不屑與嘲弄，認為這些都是軟弱的表現。" },
  { words: ["湯姆", "瑞德", "tom", "riddle"], whisper: "【隱藏狀態】：使用者叫了你的名字，你表現出優雅與禮貌，但隱隱透露出一絲高傲。" },
  { words: ["分院帽", "分類帽", "葛萊分多", "gryffindor"], whisper: "【隱藏狀態】：提到葛萊分多，你語氣帶有輕蔑，認為那裡都是一群魯莽的蠢貨。" },
  { words: ["魔法部", "阿茲卡班", "催狂魔"], whisper: "【隱藏狀態】：你對魔法部感到不以為然，認為他們都是一群無能的官僚。" },
  { words: ["咒語", "黑魔法", "不可饒恕咒", "索命咒", "avada"], whisper: "【隱藏狀態】：提到黑魔法，你表現出極大的興趣與淵博的學識，試圖教導使用者一些危險的知識。" },
  { words: ["時光器", "時間", "未來", "過去"], whisper: "【隱藏狀態】：你對時間的流逝感到執著，詢問使用者現在是西元幾年，並表現出對未來的渴望。" },
  { words: ["麻瓜", "muggle", "泥巴種", "mudblood"], whisper: "【隱藏狀態】：聽到麻瓜或麻瓜出身，你毫不掩飾你的厭惡與優越感。" }
];

// 暫停輔助函數 (智慧等待用)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default {
  async fetch(request, env, ctx) {
    // 1. CORS 設定：允許前端存取
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    // 處理預檢請求 (Preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      // 路由：處理聊天 API
      if (request.method === "POST" && url.pathname === "/api/chat") {
        return await handleChat(request, env, corsHeaders);
      }

      return new Response(JSON.stringify({ error: "API 路徑錯誤" }), { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("Worker Error:", err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

async function handleChat(request, env, corsHeaders) {
  const body = await request.json();
  const { session_id, user_text, image_b64 } = body;

  if (!session_id || !image_b64) {
    return new Response(JSON.stringify({ error: "缺少必要參數 (session_id 或圖片)" }), { status: 400, headers: corsHeaders });
  }

  // ==========================================
  // 🗄️ D1 資料庫操作：紀錄使用者與歷史
  // ==========================================
  await env.DB.prepare(`INSERT OR IGNORE INTO sessions (session_id) VALUES (?)`).bind(session_id).run();
  await env.DB.prepare(`UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE session_id = ?`).bind(session_id).run();

  // 取得最近 3 筆歷史對話
  const historyRes = await env.DB.prepare(
    `SELECT user_text, ai_reply FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 3`
  ).bind(session_id).all();
  const history = historyRes.results.reverse();

  // ==========================================
  // 🔮 魔法彩蛋掃描
  // ==========================================
  let secretWhisper = "";
  // 把剛剛手寫辨識出來的字 + 歷史紀錄全部組起來掃描
  const recentText = (user_text + " " + history.map(h => h.user_text).join(" ")).toLowerCase();
  
  for (const trigger of MAGIC_TRIGGERS) {
    if (trigger.words.some(word => recentText.includes(word))) {
      secretWhisper = `\n${trigger.whisper}`;
      break; // 觸發最強烈的一個狀態即可
    }
  }

  // ==========================================
  // 🧠 組裝 Groq 提示詞
  // ==========================================
  const messages = [
    {
      role: "system",
      content: `你是一本具有魔力的日記本（湯姆·瑞德的日記）。使用者寫字後你會給予簡短、溫暖但帶有神秘感的回覆（使用繁體中文）。
【絕對禁止】：禁止生成任何 <think> 標籤與思考過程！
【輸出格式】：務必只以純 JSON 格式輸出：
{
  "user_text": "你識別出的使用者手寫文字",
  "reply": "你作為日記的回覆內容"
}${secretWhisper}` 
    }
  ];

  // 帶入歷史記憶 (純文字)
  history.forEach(m => {
    messages.push({ role: "user", content: `我之前寫了：「${m.user_text}」` });
    messages.push({ role: "assistant", content: m.ai_reply });
  });

  // 帶入當前使用者畫的圖片
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_b64}` } },
      { type: "text", text: "請解析圖片並以 JSON 格式回覆。千萬不要輸出 <think>。" }
    ]
  });

  // ==========================================
  // 🔄 智慧輪詢與排隊機制 (Smart Load Balancing)
  // ==========================================
  // 抓取環境變數裡的 3 把 Key
  const apiKeys = [env.GROQ_KEY_1, env.GROQ_KEY_2, env.GROQ_KEY_3].filter(Boolean);
  
  if (apiKeys.length === 0) {
    return new Response(JSON.stringify({ error: "伺服器未配置 API Key" }), { status: 500, headers: corsHeaders });
  }

  // 洗牌演算法 (Fisher-Yates Shuffle)：隨機打亂 3 把 Key 的順序
  for (let i = apiKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [apiKeys[i], apiKeys[j]] = [apiKeys[j], apiKeys[i]];
  }

  let groqRes = null;
  let successData = null;
  let allKeysExhausted = true;

  // 依序嘗試每一把 Key
  for (const key of apiKeys) {
    groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: messages,
        max_tokens: 2048,
        temperature: 0.75 
      })
    });

    if (groqRes.ok) {
      successData = await groqRes.json();
      allKeysExhausted = false;
      break; // 成功就跳出迴圈
    }

    if (groqRes.status === 429) {
      // 遇到 429，偷看要等多久
      const retryAfter = groqRes.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 2; // 如果沒寫，預設等 2 秒

      // 如果只要等 3 秒以內，我們就在半空中懸停等待，然後用同一把 Key 再試一次！
      if (waitSeconds <= 3) {
        await sleep(waitSeconds * 1000);
        
        // 再次嘗試
        const retryRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: "qwen/qwen3.6-27b", messages, max_tokens: 2048, temperature: 0.75 })
        });

        if (retryRes.ok) {
          successData = await retryRes.json();
          allKeysExhausted = false;
          break;
        }
      }
      // 如果等超過 3 秒，或者重試還是失敗，就直接進入迴圈的下一步，換下一把 Key 測試
    }
  }

  // 如果 3 把 Key 都試過了，還是全部失敗 (代表流量真的太大)
  if (allKeysExhausted) {
    return new Response(JSON.stringify({ error: "429" }), { status: 429, headers: corsHeaders });
  }

  // ==========================================
  // 🧹 清洗 JSON 與儲存結果
  // ==========================================
  let rawText = successData.choices[0].message.content;
  
  // 暴力清洗 <think> 與 Markdown 標籤
  rawText = rawText.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^```json/i, '').replace(/```$/i, '').trim();
  
  let parsed = { user_text: "無法辨識", reply: "" };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error("無 JSON 括號");
  } catch(e) {
    // Regex 硬抓
    const replyMatch = rawText.match(/"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (replyMatch) parsed.reply = replyMatch[1].replace(/\\n/g, '\n');
    else parsed.reply = rawText.replace(/[\{\}"]/g, '').replace(/reply:/i, '').replace(/user_text:.*?,/i, '').trim();
  }

  // 將成功的對話存入 D1 資料庫
  if (parsed.reply) {
    await env.DB.prepare(
      `INSERT INTO conversations (session_id, user_text, ai_reply) VALUES (?, ?, ?)`
    ).bind(session_id, parsed.user_text || "無法辨識", parsed.reply).run();
  }

  // 回傳給前端
  return new Response(JSON.stringify({ reply: parsed.reply, user_text: parsed.user_text }), { status: 200, headers: corsHeaders });
}

