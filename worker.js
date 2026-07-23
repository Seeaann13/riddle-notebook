// worker.js - 魔法日記後端服務 (Cloudflare Worker + D1)

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default {
  async fetch(request, env, ctx) {
    // 動態 Origin CORS 防護
    const clientOrigin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": clientOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    // 處理預檢請求 (Preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      // 路由 1: 對話聊天 API
      if (request.method === "POST" && url.pathname === "/api/chat") {
        return await handleChat(request, env, corsHeaders);
      }

      // 路由 2: 歷史紀錄查詢 API
      if (request.method === "GET" && url.pathname === "/api/history") {
        return await handleHistory(request, env, corsHeaders, url);
      }

      return new Response(JSON.stringify({ error: "API 路徑錯誤" }), { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("Worker Error:", err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

// ==========================================
// 📖 處理歷史紀錄查詢
// ==========================================
async function handleHistory(request, env, corsHeaders, url) {
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "缺少 session_id" }), { status: 400, headers: corsHeaders });
  }

  const res = await env.DB.prepare(
    `SELECT user_text, ai_reply, created_at FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 15`
  ).bind(sessionId).all();

  return new Response(JSON.stringify({ conversations: res.results || [] }), { status: 200, headers: corsHeaders });
}

// ==========================================
// 💬 處理對話請求
// ==========================================
async function handleChat(request, env, corsHeaders) {
  const body = await request.json();
  const { session_id, user_text, image_b64, user_api_key } = body;

  if (!session_id || !image_b64) {
    return new Response(JSON.stringify({ error: "缺少必要參數 (session_id 或圖片)" }), { status: 400, headers: corsHeaders });
  }

  const safeUserText = user_text || "";

  // 1. D1 批量（Batch）操作：紀錄 Session 並更新時間（降低通訊延遲）
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO sessions (session_id) VALUES (?)`).bind(session_id),
    env.DB.prepare(`UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE session_id = ?`).bind(session_id)
  ]);

  // 2. 抓取最近 3 筆歷史紀錄
  const historyRes = await env.DB.prepare(
    `SELECT user_text, ai_reply FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 3`
  ).bind(session_id).all();
  const history = (historyRes.results || []).reverse();

  // 3. 掃描隱藏彩蛋
  let secretWhisper = "";
  const recentText = (safeUserText + " " + history.map(h => h.user_text).join(" ")).toLowerCase();
  
  for (const trigger of MAGIC_TRIGGERS) {
    if (trigger.words.some(word => recentText.includes(word))) {
      secretWhisper = `\n${trigger.whisper}`;
      break;
    }
  }

  // 4. 組裝提示詞
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

  history.forEach(m => {
    messages.push({ role: "user", content: `我之前寫了：「${m.user_text}」` });
    messages.push({ role: "assistant", content: m.ai_reply });
  });

  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_b64}` } },
      { type: "text", text: "請解析圖片並以 JSON 格式回覆。千萬不要輸出 <think>。" }
    ]
  });

  // 5. 選擇 API Key 陣列（自備 Key 優先 + 3 把內置 Key 輪詢）
  const apiKeys = [];
  if (user_api_key && user_api_key.trim() !== '') {
    apiKeys.push(user_api_key.trim());
  }
  [env.GROQ_KEY_1, env.GROQ_KEY_2, env.GROQ_KEY_3].forEach(k => { if(k) apiKeys.push(k); });
  
  if (apiKeys.length === 0) {
    return new Response(JSON.stringify({ error: "伺服器未配置 API Key" }), { status: 500, headers: corsHeaders });
  }

  // 洗牌打亂順序
  for (let i = apiKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [apiKeys[i], apiKeys[j]] = [apiKeys[j], apiKeys[i]];
  }

  let successData = null;
  let allKeysExhausted = true;

  // 6. 輪詢與智慧等待
  for (const key of apiKeys) {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "qwen/qwen3.6-27b", messages, max_tokens: 2048, temperature: 0.75 })
    });

    if (groqRes.ok) {
      successData = await groqRes.json();
      allKeysExhausted = false;
      break;
    }

    if (groqRes.status === 429) {
      const retryAfter = groqRes.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 2;

      if (waitSeconds <= 3) {
        await sleep(waitSeconds * 1000);
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
    }
  }

  if (allKeysExhausted) {
    return new Response(JSON.stringify({ error: "429" }), { status: 429, headers: corsHeaders });
  }

  // 7. 防呆擷取與 JSON 清洗 (包含 Optional Chaining 防崩潰)
  let rawText = successData?.choices?.[0]?.message?.content;
  if (!rawText) {
    return new Response(JSON.stringify({ error: "模型回傳無效內容" }), { status: 502, headers: corsHeaders });
  }

  rawText = rawText.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^```json/i, '').replace(/```$/i, '').trim();
  
  let parsed = { user_text: "無法辨識", reply: "" };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error("無 JSON 括號");
  } catch(e) {
    const replyMatch = rawText.match(/"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (replyMatch) parsed.reply = replyMatch[1].replace(/\\n/g, '\n');
    else parsed.reply = rawText.replace(/[\{\}"]/g, '').replace(/reply:/i, '').replace(/user_text:.*?,/i, '').trim();
  }

  // 8. 存入 D1 並自動清理超額對話（只留該 Session 最近 20 筆，防爆資料庫容量）
  if (parsed.reply) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO conversations (session_id, user_text, ai_reply) VALUES (?, ?, ?)`
      ).bind(session_id, parsed.user_text || "無法辨識", parsed.reply),
      
      env.DB.prepare(
        `DELETE FROM conversations WHERE session_id = ? AND id NOT IN (
           SELECT id FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 20
         )`
      ).bind(session_id, session_id)
    ]);
  }

  return new Response(JSON.stringify({ reply: parsed.reply, user_text: parsed.user_text }), { status: 200, headers: corsHeaders });
}
