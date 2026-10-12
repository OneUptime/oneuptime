/*
 * The pages of the docs' AI Observability group, and the two Security
 * pages, by the paths their suites name them with.
 *
 * Docs overhaul task 24a rewrote the first five (AiObservabilityDocsFacts,
 * AiObservabilityDocsTranslations); task 24b the other three and the
 * Security pages (AiToolingDocsFacts, SecurityDocsFacts,
 * AiToolingAndSecurityDocsTranslations). A suite imports them from here,
 * never from another suite: importing a .test.ts file runs its tests.
 */

export interface DocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const LLM: string = "telemetry/ai-llm-observability";
export const ASSISTANTS: string = "telemetry/ai-coding-assistants";
export const CLAUDE_CODE: string = "telemetry/claude-code";
export const CURSOR: string = "telemetry/cursor";
export const CODEX: string = "telemetry/openai-codex";
export const GEMINI_COPILOT: string = "telemetry/gemini-cli-and-copilot";
export const AI_GATEWAYS: string = "telemetry/ai-gateways";
export const CIRCUIT_BREAKER: string = "telemetry/ai-agent-circuit-breaker";
export const SECURITY_EVENTS: string = "telemetry/security-events";
export const THREAT_INTELLIGENCE: string = "telemetry/threat-intelligence";

// The AI observability pages of task 24a.
export const AI_OBSERVABILITY_PAGES: ReadonlyArray<DocsPageEntry> = [
  { page: LLM, navTitle: "AI / LLM Observability" },
  { page: ASSISTANTS, navTitle: "AI Coding Assistants" },
  { page: CLAUDE_CODE, navTitle: "Claude Code" },
  { page: CURSOR, navTitle: "Cursor" },
  { page: CODEX, navTitle: "OpenAI Codex" },
];

// The AI tooling pages of task 24b, the rest of the AI Observability group.
export const AI_TOOLING_PAGES: ReadonlyArray<DocsPageEntry> = [
  { page: GEMINI_COPILOT, navTitle: "Gemini CLI & GitHub Copilot" },
  { page: AI_GATEWAYS, navTitle: "AI Gateways (LiteLLM, Portkey)" },
  { page: CIRCUIT_BREAKER, navTitle: "AI Agent Circuit Breakers" },
];

// The Security group's pages, also task 24b.
export const SECURITY_PAGES: ReadonlyArray<DocsPageEntry> = [
  { page: SECURITY_EVENTS, navTitle: "Security Events (SIEM)" },
  { page: THREAT_INTELLIGENCE, navTitle: "Threat Intelligence (STIX/TAXII)" },
];
