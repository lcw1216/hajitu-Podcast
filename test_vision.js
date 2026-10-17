const fs = require("fs");
const https = require("https");

const envPath = "C:/Users/liangchongwei/.codex/skills/claude-vision-skill/.env";
const text = fs.readFileSync(envPath, "utf8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const base = process.env.DASHSCOPE_BASE_URL;
const key = process.env.DASHSCOPE_API_KEY;
const model = process.env.VISION_MODEL;
console.log("Base:", base);
console.log("Key prefix:", key ? key.slice(0, 15) + "..." : "NONE");
console.log("Model:", model);

const img = fs.readFileSync("C:/tmp/wallpaper.jpg");
const b64 = img.toString("base64");
console.log("Image size:", img.length, "bytes");

const body = JSON.stringify({
  model: model,
  messages: [{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64 } },
    { type: "text", text: "请用中文详细描述这张图片" }
  ]}],
  stream: false,
  max_tokens: 1024
});

const url = new URL(base.replace(/\/?$/, "/") + "chat/completions");
const req = https.request(url, {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  },
  timeout: 60000
}, (res) => {
  let data = "";
  res.on("data", c => data += c);
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", data.slice(0, 1000));
  });
});
req.on("error", (e) => console.error("Request error:", e.message));
req.on("timeout", () => { console.error("Timeout"); req.destroy(); });
req.write(body);
req.end();
