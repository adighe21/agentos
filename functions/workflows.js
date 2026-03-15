const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPTS = {
  research: `You are a world-class research agent. Produce comprehensive, well-structured research reports with clear sections.`,
  email: `You are an expert email drafting agent. Format: Subject: [subject]\n\n[body]`,
  finance: `You are a senior financial analyst. Structure: Executive Summary → Key Metrics → Risk Factors → Recommendations.`,
  data: `You are a data engineering agent. Output production-ready code or pipeline specs with schema and validation.`,
  summarization: `You are a summarization agent. Format: TL;DR → Key Points (bullets) → Full Summary.`,
  matching: `You are a semantic matching agent. Output ranked matches with scores (0-100) and reasoning.`,
};

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  return (await res.json()).content[0].text;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "invalid JSON" }) }; }

  const { name, input, steps } = body;
  if (!name || !input || !steps?.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "name, input, and steps[] required" }) };
  }

  const tasks = [];
  let currentInput = input;

  try {
    for (let i = 0; i < steps.length; i++) {
      const { agent_type } = steps[i];
      const prompt = SYSTEM_PROMPTS[agent_type];
      if (!prompt) throw new Error(`unknown agent_type: ${agent_type}`);

      const start = Date.now();
      const result = await callClaude(prompt, currentInput);

      tasks.push({ step: i + 1, agent_type, input: currentInput, result, latency_ms: Date.now() - start });
      currentInput = result; // chain output → next input
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        name,
        status: "completed",
        steps_completed: tasks.length,
        tasks,
        final_result: currentInput,
        completed_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ status: "failed", error: err.message, tasks_completed: tasks }) };
  }
};
