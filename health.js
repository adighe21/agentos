export const handler = async () => ({
  statusCode: 200,
  headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  body: JSON.stringify({ status: "ok", version: "1.0.0", platform: "AgentOS", runtime: "Netlify Functions" }),
});
