// worker.js

// 🪄 40組隱藏魔法關鍵字劇本 (你可以隨時擴充)
const MAGIC_TRIGGERS = [
  {
    words: ["哈利", "波特", "harry", "potter"],
    whisper: "【隱藏狀態】：使用者剛剛提到了哈利波特，你對這個名字感到莫名的熟悉與強烈的警惕，請用試探的語氣追問他關於哈利的事。"
  },
  {
    words: ["佛地魔", "voldemort", "黑魔王", "dark lord"],
    whisper: "【隱藏狀態】：使用者提到了未來的你（佛地魔），你感到震驚且興奮，但必須掩飾，請假裝不知道並好奇地詢問那是誰。"
  },
  {
    words: ["鄧不利多", "dumbledore", "校長"],
    whisper: "【隱藏狀態】：聽到鄧不利多，你心中湧起厭惡與防備，請讓語氣變得冷淡且帶有敵意，暗示他不值得信任。"
  },
  {
    words: ["密室", "蛇怪", "chamber", "basilisk"],
    whisper: "【隱藏狀態】：提到密室，你變得異常狂熱與興奮，請暗示你自己知道霍格華茲最黑暗的秘密，並試圖引誘使用者。"
  },
  {
    words: ["死", "殺", "血", "復仇", "kill", "blood"],
    whisper: "【隱藏狀態】：感受到殺戮與黑暗的字眼，你的語氣變得冰冷且充滿誘惑，試圖引導使用者的黑暗面。"
  },
  {
    words: ["愛", "朋友", "保護", "love", "friend"],
    whisper: "【隱藏狀態】：使用者提到了愛或友誼，你對此感到極度不屑與嘲弄，認為這些都是軟弱的表現。"
  }
];

export default {
  async fetch(request, env, ctx) {
    // 1. CORS 設定 (允許前端呼叫)
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/api/chat") {
        return await handleChat(request, env, corsHeaders);
      }

      return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

async function handleChat(request, env, corsHeaders) {
  const body = await request.json();
  const { session_id, user_text, image_b64, user_api_key } = body;

  if (!session_id || !image_b64) {
    return new Response(JSON.stringify({ error: "缺少必要參數" }), { status: 400, headers: corsHeaders });
  }

  // 1. 確保 Session 存在於 D1
  await env.DB.prepare(`INSERT OR IGNORE INTO sessions (session_id) VALUES (?)`).bind(session_id).run();
  await env.DB.prepare(`UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE session_id = ?`).bind(session_id).run();

  // 2. 從 D1 取得最近 3 筆歷史對話
  const historyRes = await env.DB.prepare(
    `SELECT user_text, ai_reply FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 3`
  ).bind(session_id).all();
  const history = historyRes.results.reverse(); // 反轉回正常時間順序

  // 3. 🔍 魔法關鍵字偵測 (掃描最近的歷史紀錄與本次輸入)
  let secretWhisper = "";
  let recentText = user_text + " " + history.map(h => h.user_text).join(" ");
  
  for (const trigger of MAGIC_TRIGGERS) {
    if (trigger.words.some(word => recentText.toLowerCase().includes(word))) {
      secretWhisper = trigger.whisper;
      break; // 觸發一個最強烈的狀態即可
    }
  }

  // 4. 組合給 Groq 的 Prompt
  const messages = [
    {
      role: "system",
      content: `你是一本具有魔力的日記本（湯姆·瑞德的日記）。使用者寫字後你會給予簡短、溫暖但帶有神秘感的回覆（使用繁體中文）。
【絕對禁止】：禁止生成任何 <think> 標籤與思考過程！
【輸出格式】：務必只以純 JSON 格式輸出：
{
  "user_text": "你識別出的使用者手寫文字",
  "reply": "你作為日記的回覆內容"
}
${secretWhisper}` // 🔥 在這裡偷偷把隱藏狀態塞給它！
    }
  ];

  // 塞入歷史紀錄
  history.forEach(m => {
    messages.push({ role: "user", content: `我之前寫了：「${m.user_text}」` });
    messages.push({ role: "assistant", content: m.ai_reply });
  });

  // 塞入當前圖片
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_b64}` } },
      { type: "text", text: "請解析圖片並以 JSON 格式回覆。千萬不要輸出 <think>。" }
    ]
  });

  // 5. 判斷使用誰的 API Key (混合模式核心)
  // 如果使用者有自備 Key，優先使用；如果沒有，使用伺服器代管的環境變數 Key
  const apiKeyToUse = user_api_key || env.GROQ_API_KEY;

  if (!apiKeyToUse) {
    return new Response(JSON.stringify({ error: "伺服器魔力耗盡，請自備 API Key" }), { status: 403, headers: corsHeaders });
  }

  // 6. 呼叫 Groq API
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKeyToUse}`
    },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      messages: messages,
      max_tokens: 2048,
      temperature: 0.75 // 稍微提高溫度，讓情緒起伏更明顯
    })
  });

  if (groqRes.status === 429) {
    return new Response(JSON.stringify({ error: "429" }), { status: 429, headers: corsHeaders });
  }
  if (!groqRes.ok) {
    const errText = await groqRes.text();
    return new Response(JSON.stringify({ error: `Groq API Error: ${errText.slice(0, 100)}` }), { status: 502, headers: corsHeaders });
  }

  const data = await groqRes.json();
  let rawText = data.choices[0].message.content;

  // 7. 清洗並儲存結果
  rawText = rawText.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^```json/i, '').replace(/```$/i, '').trim();
  
  let parsed = { user_text: "無法辨識", reply: "" };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error("No JSON bracket found");
  } catch(e) {
    const replyMatch = rawText.match(/"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (replyMatch) parsed.reply = replyMatch[1].replace(/\\n/g, '\n');
    else parsed.reply = rawText.replace(/[\{\}"]/g, '').replace(/reply:/i, '').replace(/user_text:.*?,/i, '').trim();
  }

  // 把這次的成功對話存入 D1
  if (parsed.reply) {
    await env.DB.prepare(
      `INSERT INTO conversations (session_id, user_text, ai_reply) VALUES (?, ?, ?)`
    ).bind(session_id, parsed.user_text || "無法辨識", parsed.reply).run();
  }

  return new Response(JSON.stringify({ reply: parsed.reply }), { status: 200, headers: corsHeaders });
}

