exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };
  }
  try {
    const { prompt } = JSON.parse(event.body);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await response.json();
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: err.message }) };
  }
};
