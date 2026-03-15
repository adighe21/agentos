import express from "express";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(join(__dirname, "public")));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

const SYSTEM_PROMPTS = {
  research: `You are a world-class research agent. Produce comprehensive, accurate, well-structured research reports with clear sections. Cite key facts and be specific.`,
  email: `You are an expert email drafting agent. Write clear, professional emails. Always format as:\nSubject: [subject line]\n\n[email body]`,
  finance: `You are a senior financial analyst agent. Structure reports as: Executive Summary → Key Metrics → Risk Factors → Recommendations.`,
  data: `You are a data engineering agent. Output production-ready code or pipeline specs with schema definitions, transformation logic, and validation steps.`,
  summarization: `You are a summarization agent. Format all output as: TL;DR (2 sentences) → Key Points (bullet list) → Full Summary.`,
  matching: `You are a semantic matching agent. Output ranked matches with compatibility scores (0-100) and specific reasoning for each match.`,
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
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

async function getEmbedding(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}`);
  return (await res.json()).data[0].embedding;
}

async function retrieveRAG(query) {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_HOST || !process.env.OPENAI_API_KEY) return "";
  try {
    const vector = await getEmbedding(query);
    const res = await fetch(`https://${process.env.PINECONE_INDEX_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ vector, topK: 5, namespace: process.env.PINECONE_NAMESPACE || "agentos", includeMetadata: true }),
    });
    const data = await res.json();
    const matches = data.matches || [];
    if (!matches.length) return "";
    let ctx = "RETRIEVED KNOWLEDGE CONTEXT:\n";
    matches.forEach((m, i) => { ctx += `[${i + 1}] (score: ${m.score?.toFixed(2)}) ${m.metadata?.text || ""}\n\n`; });
    return ctx;
  } catch (e) {
    return "";
  }
}

// Health
app.get("/health", (req, res) => res.json({ status: "ok", version: "1.0.0", platform: "AgentOS" }));

// List agents
app.get("/api/agents/list", (req, res) => {
  res.json({ agents: [
    { id:"research", name:"Research Agent", type:"research", status:"running", pods:10, latency:420, success:98.2,
      desc:"Searches and synthesizes knowledge using RAG + LLM.", plugins:["Pinecone RAG","Web Scraper","Tavily Search"],
      pipeline:["Receive Query","Vector Search","Fetch Docs","LLM Synthesis","Return Report"] },
    { id:"email", name:"Email Agent", type:"email", status:"running", pods:3, latency:180, success:99.6,
      desc:"Drafts and categorizes emails autonomously.", plugins:["Gmail API","SendGrid","NLP Classifier"],
      pipeline:["Parse Intent","Compose Draft","Review Context","Send/Queue","Log Event"] },
    { id:"finance", name:"Finance Agent", type:"finance", status:"running", pods:5, latency:310, success:97.1,
      desc:"Market analysis, portfolio alerts, financial reporting.", plugins:["Alpha Vantage","Yahoo Finance"],
      pipeline:["Fetch Market Data","Run Analysis","RAG Context","Generate Insight","Report"] },
    { id:"data", name:"Data Pipeline Agent", type:"data", status:"running", pods:7, latency:540, success:96.8,
      desc:"ETL pipelines, data cleaning, ML feature engineering.", plugins:["Apache Kafka","Airflow","Kubeflow"],
      pipeline:["Ingest Source","Transform","Validate Schema","Load to DB","Trigger ML"] },
    { id:"summarization", name:"Summarization Agent", type:"summarization", status:"running", pods:4, latency:220, success:99.1,
      desc:"Condenses documents into actionable summaries.", plugins:["Claude API","PDF Parser"],
      pipeline:["Receive Document","Chunk Text","Embed","Summarize","Return Summary"] },
    { id:"matching", name:"Matching Agent", type:"matching", status:"idle", pods:4, latency:200, success:94.5,
      desc:"Semantic matching and recommendation scoring.", plugins:["Weaviate VectorDB","OpenAI Embeddings"],
      pipeline:["Embed Profile","Cosine Search","Score Matches","Rank","Return List"] },
  ]});
});

// Run agent
app.post("/api/agents/run", async (req, res) => {
  const { agent_type, input, use_rag } = req.body;
  if (!agent_type || !input) return res.status(400).json({ error: "agent_type and input are required" });
  const systemPrompt = SYSTEM_PROMPTS[agent_type];
  if (!systemPrompt) return res.status(400).json({ error: `Unknown agent type: ${agent_type}` });
  try {
    const start = Date.now();
    const ragContext = use_rag ? await retrieveRAG(input) : "";
    const userPrompt = ragContext ? `${ragContext}\n---\nUSER REQUEST:\n${input}` : input;
    const result = await callClaude(systemPrompt, userPrompt);
    res.json({ status: "completed", agent_type, result, latency_ms: Date.now() - start, rag_used: !!ragContext, completed_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

// Workflows
app.post("/api/workflows", async (req, res) => {
  const { name, input, steps } = req.body;
  if (!name || !input || !steps?.length) return res.status(400).json({ error: "name, input, and steps[] are required" });
  const tasks = [];
  let currentInput = input;
  try {
    for (let i = 0; i < steps.length; i++) {
      const { agent_type } = steps[i];
      const prompt = SYSTEM_PROMPTS[agent_type];
      if (!prompt) throw new Error(`Unknown agent type: ${agent_type}`);
      const start = Date.now();
      const result = await callClaude(prompt, currentInput);
      tasks.push({ step: i + 1, agent_type, result, latency_ms: Date.now() - start });
      currentInput = result;
    }
    res.json({ name, status: "completed", steps_completed: tasks.length, tasks, final_result: currentInput, completed_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "failed", error: err.message, tasks_completed: tasks });
  }
});

// Knowledge ingest
app.post("/api/knowledge/ingest", async (req, res) => {
  const { documents } = req.body;
  if (!documents?.length) return res.status(400).json({ error: "documents[] required" });
  try {
    const ids = [];
    for (const doc of documents) {
      const embedding = await getEmbedding(doc.text);
      const id = randomUUID();
      await fetch(`https://${process.env.PINECONE_INDEX_HOST}/vectors/upsert`, {
        method: "POST",
        headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ vectors: [{ id, values: embedding, metadata: { ...(doc.metadata || {}), text: doc.text.slice(0, 2000), ingested_at: new Date().toISOString() } }], namespace: process.env.PINECONE_NAMESPACE || "agentos" }),
      });
      ids.push(id);
    }
    res.json({ ingested: ids.length, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Knowledge query
app.post("/api/knowledge/query", async (req, res) => {
  const { query, top_k = 5 } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const vector = await getEmbedding(query);
    const r = await fetch(`https://${process.env.PINECONE_INDEX_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ vector, topK: top_k, namespace: process.env.PINECONE_NAMESPACE || "agentos", includeMetadata: true }),
    });
    const data = await r.json();
    res.json({ results: (data.matches || []).map(m => ({ id: m.id, score: m.score, text: m.metadata?.text || "" })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`AgentOS running on port ${PORT}`));
