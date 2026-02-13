// Extract pure functions from background.js for testing.
// These are copied here to avoid needing a bundler; keep in sync with background.js.

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isUserSendPayload(payload) {
  if (!payload) return false;
  if (payload.action && payload.action !== "next") return false;
  const msgs = payload.messages;
  if (!Array.isArray(msgs)) return false;
  return msgs.some(m => {
    const role = m?.author?.role || m?.role;
    if (role !== "user") return false;
    const content = m?.content;
    if (typeof content === "string" && content.trim().length > 0) return true;
    if (Array.isArray(content)) {
      return content.some(part => {
        if (typeof part === "string") return part.trim().length > 0;
        if (part?.type === "input_text" && typeof part?.text === "string") {
          return part.text.trim().length > 0;
        }
        return false;
      });
    }
    if (content?.parts && Array.isArray(content.parts)) {
      return content.parts.some(p => typeof p === "string" && p.trim().length > 0);
    }
    return false;
  });
}

module.exports = { todayKey, isUserSendPayload };
