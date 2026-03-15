const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPTS = {
  research: `You are a world-class research agent. Produce comprehensive, accurate, well-structured research reports. Use clear sections, cite key facts, be specific and thorough.`,
  email: `You are an expert email drafting agent. Write clear, professional, context-appropriate emails. Always include: Subject: [subject line]\n\n[email body]`,
  finance: `You are a senior financial analyst agent. Provide rigorous, data-driven analysis. Structure: Executive Summary → Key Metrics → Risk Factors → Recommendations. Add caveats where data is estimated.`,
  data: `You are a data engineering agent. Produce clean, production-ready code or pipeline specifications. Include schema definitions, transformation logic, and validation steps.`,
  summarization: `You are a summarization agent. Format all output as: TL;DR (2 sentences) → Key Points (bullet list) → Full Summary. Preserve all critical facts and numbers.`,
  matching: `You are a semantic matching and recommendation agent. Output ranked matches with compatibility scores (0-100) and specific reasoning for each match.`,
};

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  return (await res.json()).data[0].embedding;
}

async function retrieveRAG(query) {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_HOST || !process.env.OPENAI_API_KEY) return "";
  try {
    const vector = await embed(query);
    const res = await fetch(`https://${process.env.PINECONE_INDEX_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ vector, topK: 5, namespace: process.env.PINECONE_NAMESPACE || "agentos", includeMetadata: true }),
    });
    const data = await res.json();
    const matches = data.matches || [];
    if (!matches.length) return "";
    let ctx = "RETRIEVED KNOWLEDGE CONTEXT:\n";
    matches.forEach((m, i) => { ctx += `[${i+1}] (score: ${m.score?.toFixed(2)}) ${m.metadata?.text || ""}\n\n`; });
    return ctx;
  } catch (e) {
    console.warn("RAG failed:", e.message);
    return "";
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "invalid JSON" }) }; }

  const { agent_type, input, use_rag } = body;
  if (!agent_type || !input) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "agent_type and input required" }) };

  const systemPrompt = SYSTEM_PROMPTS[agent_type];
  if (!systemPrompt) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `unknown agent_type: ${agent_type}` }) };

  const start = Date.now();
  try {
    const ragContext = use_rag ? await retrieveRAG(input) : "";
    const userPrompt = ragContext ? `${ragContext}\n---\nUSER REQUEST:\n${input}` : input;
    const result = await callClaude(systemPrompt, userPrompt);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        status: "completed",
        agent_type,
        input,
        result,
        latency_ms: Date.now() - start,
        rag_used: !!ragContext,
        completed_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ status: "failed", error: err.message }) };
  }
};
