// Optional: identifying a part from a photo, and smarter BOM matching, using the person's own Anthropic
// API key. The key stays in this browser (localStorage) and is sent only to api.anthropic.com.
// Without a key, everything still works from the inventory search.
const KEY = 'parts-bin.ai';
const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const RETIRED = ['claude-sonnet-4-5']; // a saved choice that Anthropic has since retired moves to the default

export const ai = {
  get key() { return get().key || ''; },
  get model() { const m = get().model; return !m || RETIRED.includes(m) ? DEFAULT_MODEL : m; },
  save({ key, model }) {
    try { localStorage.setItem(KEY, JSON.stringify({ key: String(key || '').trim(), model: String(model || '').trim() || DEFAULT_MODEL })); } catch {}
  },
  get on() { return !!this.key; },
};

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function jpeg(file) {
  try {
    const bmp = await createImageBitmap(file); const max = 1280; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}

// Same shape as the Stockroom artifact's sample.json(prompt, {images}), so the screens didn't change.
export function makeSample() {
  if (!ai.on) return null;
  async function ask(prompt, opts = {}) {
    const content = [];
    if (opts.images) {
      const img = await jpeg(opts.images);
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toBase64(img) } });
    }
    content.push({ type: 'text', text: prompt });
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: ai.model, max_tokens: 1500, messages: [{ role: 'user', content }] }),
      });
    } catch { throw { code: 'network', message: 'Couldn’t reach the Anthropic API.' }; }
    if (r.status === 401) throw { code: 'not_granted', message: 'The API key was refused. Check it in Settings.' };
    if (r.status === 429) throw { code: 'rate_limited', message: 'Too many requests. Wait a moment.' };
    if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch {} throw { code: 'error', message: m || 'The API answered ' + r.status }; }
    const j = await r.json();
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }
  const sample = async (prompt, opts) => ({ text: await ask(prompt, opts), truncated: false });
  sample.json = async (prompt, opts) => {
    const text = await ask(prompt + '\n\nReply with only the JSON, no other text.', opts);
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = m ? m[1] : text.slice(Math.min(...['{', '['].map(c => text.indexOf(c)).filter(i => i >= 0)), Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1);
    try { return JSON.parse(body); } catch { throw { code: 'invalid_json', message: 'The answer wasn’t readable.', text }; }
  };
  sample.limits = async () => ({ images: { maxCount: 1 } });
  return sample;
}
