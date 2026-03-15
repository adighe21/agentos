const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  const { query, top_k = 5 } = JSON.parse(event.body || "{}");
  if (!query) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "query required" }) };

  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: query, model: "text-embedding-3-small" }),
    });
    const { data } = await embedRes.json();
    const vector = data[0].embedding;

    const qRes = await fetch(`https://${process.env.PINECONE_INDEX_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ vector, topK: top_k, namespace: process.env.PINECONE_NAMESPACE || "agentos", includeMetadata: true }),
    });
    const { matches } = await qRes.json();

    const results = (matches || []).map(m => ({ id: m.id, score: m.score, text: m.metadata?.text || "", metadata: m.metadata || {} }));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ results, count: results.length }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
