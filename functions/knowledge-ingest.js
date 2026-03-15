const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
  });
  return (await res.json()).data[0].embedding;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  const { documents } = JSON.parse(event.body || "{}");
  if (!documents?.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "documents[] required" }) };

  try {
    const { randomUUID } = await import("crypto");
    const vectors = await Promise.all(documents.map(async (doc) => ({
      id: randomUUID(),
      values: await embed(doc.text),
      metadata: { ...(doc.metadata || {}), text: doc.text.slice(0, 2000), ingested_at: new Date().toISOString() },
    })));

    await fetch(`https://${process.env.PINECONE_INDEX_HOST}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ vectors, namespace: process.env.PINECONE_NAMESPACE || "agentos" }),
    });

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ingested: vectors.length, ids: vectors.map(v => v.id) }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
