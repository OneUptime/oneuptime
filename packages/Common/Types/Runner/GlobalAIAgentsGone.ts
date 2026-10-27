/*
 * GLOBAL AI AGENTS ARE GONE
 *
 * A global AI agent - an AI agent with no project - was either the shared
 * Runner's registration or one a master admin added on the Admin
 * Dashboard's Global AI Agents page and started a Runner with. Global
 * Runners took the work they did (OneUptime AI's code fixes), and the
 * shared Runner, the page and the agents' registration went with them.
 *
 * Their rows stay in the database, unused: a global AI agent's id and key
 * prove nothing on the code-fix routes (CodeFixAgentAuth), and its heartbeat
 * (/api/ai-agent/alive) is answered with this, which a Runner started with
 * them logs (RegisterRunner), so whoever runs it learns what to start
 * instead of watching every request fail.
 */
export const GLOBAL_AI_AGENT_GONE_MESSAGE: string =
  "This is a global AI agent, which OneUptime no longer uses: global Runners do its AI code fixes now. In the Admin Dashboard, open Settings > Global Runners, create a global Runner, and start this Runner with that Runner's ID and key instead.";
