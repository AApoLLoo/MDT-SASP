const field = (name, value, inline = true) => ({ name, value: String(value || "—").slice(0, 1024), inline });

// Posts one embed to a Discord webhook. No-op when the webhook is not configured.
const postEmbed = async (webhook, embed) => {
  if (!webhook) return;
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ color: 0x2f6bff, ...embed }] }),
  });
  if (!res.ok) throw new Error(`Webhook Discord : HTTP ${res.status}`);
};

export { field, postEmbed };
