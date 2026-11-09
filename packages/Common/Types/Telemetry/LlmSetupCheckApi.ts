import { readNumber, readString } from "./LlmConversationApi";

/*
 * THE AI / LLM SETUP CHECK: what a project's AI is sending, way by way.
 *
 * AI reaches OneUptime three ways, and they fill different views:
 *
 *   - your apps' AI calls (GenAI spans) fill Conversations, Calls and Usage;
 *   - your provider accounts (OpenAI, Azure OpenAI and Microsoft Foundry,
 *     Anthropic, Bedrock, Vertex AI) bring what each account used and cost,
 *     by day - usage, never a prompt or an answer - and fill Usage under
 *     Provider accounts;
 *   - your company's AI tools (Claude Enterprise, Microsoft 365 Copilot)
 *     bring what people asked them, as conversations.
 *
 * Coding assistants (Claude Code, Codex, Gemini CLI, Cursor, Copilot) send
 * usage metrics, which fill Usage and nothing else.
 *
 * So a project whose provider accounts are connected and working still has
 * no conversations until its apps send their AI calls - and nothing said so.
 * POST /telemetry/llm/setup-check answers, for the project and the caller's
 * read scope: which apps sent AI calls and when, through which providers,
 * whether their prompts and answers were recorded (and where), which outgoing
 * calls look like AI calls no instrumentation recorded, which coding tools
 * send metrics, and how each connection is doing. Every read is capped
 * (LlmSetupCheckReader), so the check is cheap enough to run whenever a view
 * is empty.
 *
 * diagnoseEmptyLlmView turns an answer into the one finding an empty
 * Conversations or Calls view leads with, and its one next step.
 */

export const LLM_SETUP_CHECK_ROUTE: string = "/telemetry/llm/setup-check";

// "In the past week": the window every count but the view's own covers.
export const LLM_SETUP_CHECK_RECENT_DAYS: number = 7;

// Lists are cut to this many entries, most calls first.
export const LLM_SETUP_CHECK_MAX_LIST: number = 10;

export interface LlmSetupCheckRequestBody {
  // The window of the view asking; the check counts its calls too.
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface LlmSetupCheckService {
  serviceId: string;
  calls: number;
  newestAt: string | null;
}

export interface LlmSetupCheckProvider {
  // The conventions' provider name (LlmProviders); "" when none was sent.
  name: string;
  calls: number;
}

/*
 * Outgoing calls to an AI provider's API that are not AI / LLM spans: an
 * HTTP client instrumentation saw the call, no GenAI instrumentation did.
 */
export interface LlmSetupCheckUninstrumentedCalls {
  serviceId: string;
  host: string;
  // The provider the host belongs to (LlmProviders).
  provider: string;
  calls: number;
}

export interface LlmSetupCheckApps {
  // AI calls of the asked window; null when no window was asked.
  callsInWindow: number | null;
  callsRecently: number;
  // The newest AI call within retention; null when there is none.
  newestCallAt: string | null;
  // The past week's apps and providers, most calls first.
  services: Array<LlmSetupCheckService>;
  providers: Array<LlmSetupCheckProvider>;
  // The past week's answers, and how many recorded what the person asked.
  answersRecently: number;
  answersWithContent: number;
  /*
   * GenAI events that carry what was said arrived on the logs signal in the
   * past week - where the OpenTelemetry instrumentations for JavaScript and
   * Java, and Python's with `true` or `event_only`, send prompts and
   * answers, and where conversations read them. Events of an instrumentation
   * with content capture off carry nothing, and do not count. Checked only
   * when no answer recorded its question on its span; null: not checked.
   */
  contentInLogs: boolean | null;
  /*
   * Checked only when no app sent an AI call in the past week, over the
   * past day; null when it was not checked or could not be read.
   */
  uninstrumented: Array<LlmSetupCheckUninstrumentedCalls> | null;
}

// Who sends GenAI metrics, by the metric names they use.
export enum LlmMetricSource {
  ClaudeCode = "claude-code",
  Codex = "codex",
  GeminiCli = "gemini-cli",
  Cursor = "cursor",
  Copilot = "copilot",
  // The conventions' own metrics, from an SDK or a tool not named above.
  GenAi = "genai",
}

export const LLM_METRIC_SOURCE_PREFIXES: Array<{
  prefix: string;
  source: LlmMetricSource;
}> = [
  { prefix: "claude_code.", source: LlmMetricSource.ClaudeCode },
  { prefix: "codex.", source: LlmMetricSource.Codex },
  { prefix: "gemini_cli.", source: LlmMetricSource.GeminiCli },
  { prefix: "cursor.", source: LlmMetricSource.Cursor },
  { prefix: "copilot_chat.", source: LlmMetricSource.Copilot },
];

export const LLM_METRIC_SOURCE_TITLES: Record<LlmMetricSource, string> = {
  [LlmMetricSource.ClaudeCode]: "Claude Code",
  [LlmMetricSource.Codex]: "Codex",
  [LlmMetricSource.GeminiCli]: "Gemini CLI",
  [LlmMetricSource.Cursor]: "Cursor",
  [LlmMetricSource.Copilot]: "GitHub Copilot",
  [LlmMetricSource.GenAi]: "GenAI metrics",
};

export function getLlmMetricSource(metricName: string): LlmMetricSource {
  const name: string = (metricName || "").trim().toLowerCase();

  for (const entry of LLM_METRIC_SOURCE_PREFIXES) {
    if (name.startsWith(entry.prefix)) {
      return entry.source;
    }
  }

  return LlmMetricSource.GenAi;
}

export interface LlmSetupCheckMetricSource {
  source: LlmMetricSource;
  points: number;
  newestAt: string | null;
}

export type LlmSetupCheckConnectionKind = "provider-account" | "company-tool";

export interface LlmSetupCheckConnection {
  connectionId: string;
  name: string;
  // LlmConnectionProvider.
  provider: string;
  kind: LlmSetupCheckConnectionKind;
  isEnabled: boolean;
  lastReadAt: string | null;
  lastSuccessfulReadAt: string | null;
  // The last read's error, secrets removed; "" when none.
  lastError: string;
  /*
   * What kind of failure the last read was (LlmConnectionFailureKind:
   * authentication, permission, ...), when it failed and said: the check
   * then says it in the product's words, the error itself kept for the
   * connection's own View error.
   */
  failureKind?: string | undefined;
  // A provider account's newest day with usage; null when none was read.
  newestUsageAt: string | null;
  // Resources the last read found (Azure); null when not counted.
  resources: number | null;
  // The first day read without usage found since; null when unknown.
  readSince: string | null;
  // A company AI tool's chats of the past week; null for provider accounts.
  callsRecently: number | null;
}

export interface LlmSetupCheckResponse {
  checkedAt: string;
  // null when the part could not be read for the caller.
  apps: LlmSetupCheckApps | null;
  metrics: Array<LlmSetupCheckMetricSource> | null;
  connections: Array<LlmSetupCheckConnection> | null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readList<T>(
  value: unknown,
  read: (item: Record<string, unknown>) => T,
  limit: number,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): boolean => {
      return Boolean(item) && typeof item === "object" && !Array.isArray(item);
    })
    .slice(0, limit)
    .map((item: unknown): T => {
      return read(item as Record<string, unknown>);
    });
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

function readCount(value: unknown): number {
  return Math.max(0, Math.round(readNumber(value)));
}

function readOptionalCount(value: unknown): number | null {
  return value === null || value === undefined ? null : readCount(value);
}

function readApps(value: unknown): LlmSetupCheckApps | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: Record<string, unknown> = readObject(value);

  return {
    callsInWindow: readOptionalCount(object["callsInWindow"]),
    callsRecently: readCount(object["callsRecently"]),
    newestCallAt: readDate(object["newestCallAt"]),
    services: readList(
      object["services"],
      (item: Record<string, unknown>): LlmSetupCheckService => {
        return {
          serviceId: readString(item["serviceId"]),
          calls: readCount(item["calls"]),
          newestAt: readDate(item["newestAt"]),
        };
      },
      LLM_SETUP_CHECK_MAX_LIST,
    ),
    providers: readList(
      object["providers"],
      (item: Record<string, unknown>): LlmSetupCheckProvider => {
        return {
          name: readString(item["name"]),
          calls: readCount(item["calls"]),
        };
      },
      LLM_SETUP_CHECK_MAX_LIST,
    ),
    answersRecently: readCount(object["answersRecently"]),
    answersWithContent: readCount(object["answersWithContent"]),
    contentInLogs:
      typeof object["contentInLogs"] === "boolean"
        ? object["contentInLogs"]
        : null,
    uninstrumented: Array.isArray(object["uninstrumented"])
      ? readList(
          object["uninstrumented"],
          (item: Record<string, unknown>): LlmSetupCheckUninstrumentedCalls => {
            return {
              serviceId: readString(item["serviceId"]),
              host: readString(item["host"]),
              provider: readString(item["provider"]),
              calls: readCount(item["calls"]),
            };
          },
          LLM_SETUP_CHECK_MAX_LIST,
        )
      : null,
  };
}

function readMetricSource(value: unknown): LlmMetricSource {
  return (
    Object.values(LlmMetricSource).find((source: LlmMetricSource): boolean => {
      return source === value;
    }) || LlmMetricSource.GenAi
  );
}

// The answer as the server sent it; never throws.
export function readLlmSetupCheckResponse(
  value: unknown,
): LlmSetupCheckResponse {
  const object: Record<string, unknown> = readObject(value);

  return {
    checkedAt: readDate(object["checkedAt"]) || new Date(0).toISOString(),
    apps: readApps(object["apps"]),
    metrics: Array.isArray(object["metrics"])
      ? readList(
          object["metrics"],
          (item: Record<string, unknown>): LlmSetupCheckMetricSource => {
            return {
              source: readMetricSource(item["source"]),
              points: readCount(item["points"]),
              newestAt: readDate(item["newestAt"]),
            };
          },
          LLM_SETUP_CHECK_MAX_LIST,
        )
      : null,
    connections: Array.isArray(object["connections"])
      ? readList(
          object["connections"],
          (item: Record<string, unknown>): LlmSetupCheckConnection => {
            const failureKind: string = readString(item["failureKind"]);

            return {
              connectionId: readString(item["connectionId"]),
              name: readString(item["name"]),
              provider: readString(item["provider"]),
              kind:
                item["kind"] === "company-tool"
                  ? "company-tool"
                  : "provider-account",
              isEnabled: item["isEnabled"] !== false,
              lastReadAt: readDate(item["lastReadAt"]),
              lastSuccessfulReadAt: readDate(item["lastSuccessfulReadAt"]),
              lastError: readString(item["lastError"]),
              ...(failureKind ? { failureKind: failureKind } : {}),
              newestUsageAt: readDate(item["newestUsageAt"]),
              resources: readOptionalCount(item["resources"]),
              readSince: readDate(item["readSince"]),
              callsRecently: readOptionalCount(item["callsRecently"]),
            };
          },
          100,
        )
      : null,
  };
}

/*
 * WHAT AN EMPTY CONVERSATIONS OR CALLS VIEW LEADS WITH.
 *
 * One finding, the most useful first:
 *
 *   1. calls-outside-window - your apps did send AI calls, just not in this
 *      time range: show the range that holds the newest one.
 *   2. uninstrumented - an app calls an AI provider's API, and no GenAI
 *      instrumentation records it: add one.
 *   3. company-tools-quiet - a company AI tool is connected, and none of
 *      its chats are in this range (it reads every 15 minutes), or its
 *      connection is not working.
 *   4. provider-accounts-only - provider accounts are connected: they bring
 *      usage and cost, not conversations, and no app sends AI calls.
 *   5. coding-tools-only - coding assistants send usage metrics, which
 *      show on Usage, and no app sends AI calls.
 *   6. nothing - nothing has arrived: how AI comes in.
 */
export enum LlmEmptyViewFindingKey {
  CallsOutsideWindow = "calls-outside-window",
  Uninstrumented = "uninstrumented",
  CompanyToolsQuiet = "company-tools-quiet",
  ProviderAccountsOnly = "provider-accounts-only",
  CodingToolsOnly = "coding-tools-only",
  Nothing = "nothing",
}

export interface LlmEmptyViewFinding {
  key: LlmEmptyViewFindingKey;
  // calls-outside-window: the newest call.
  newestCallAt?: string | undefined;
  // uninstrumented: the app with the most such calls.
  uninstrumented?: LlmSetupCheckUninstrumentedCalls | undefined;
  // company-tools-quiet / provider-accounts-only: the connections meant.
  connections?: Array<LlmSetupCheckConnection> | undefined;
  // coding-tools-only: the tools that send metrics.
  metricSources?: Array<LlmMetricSource> | undefined;
}

export function diagnoseEmptyLlmView(
  check: LlmSetupCheckResponse | null | undefined,
  options?: {
    /*
     * False for a view with no time range of its own (Calls lists every
     * call), where "outside this time range" cannot be the reason.
     */
    hasWindow?: boolean | undefined;
  },
): LlmEmptyViewFinding {
  if (!check) {
    return { key: LlmEmptyViewFindingKey.Nothing };
  }

  const apps: LlmSetupCheckApps | null = check.apps;

  if (
    options?.hasWindow !== false &&
    apps &&
    apps.newestCallAt &&
    (apps.callsInWindow ?? 0) === 0
  ) {
    return {
      key: LlmEmptyViewFindingKey.CallsOutsideWindow,
      newestCallAt: apps.newestCallAt,
    };
  }

  if (apps && apps.uninstrumented && apps.uninstrumented.length > 0) {
    return {
      key: LlmEmptyViewFindingKey.Uninstrumented,
      uninstrumented: apps.uninstrumented[0],
    };
  }

  const connections: Array<LlmSetupCheckConnection> = (
    check.connections || []
  ).filter((connection: LlmSetupCheckConnection): boolean => {
    return connection.isEnabled;
  });

  const tools: Array<LlmSetupCheckConnection> = connections.filter(
    (connection: LlmSetupCheckConnection): boolean => {
      return connection.kind === "company-tool";
    },
  );

  if (tools.length > 0) {
    return {
      key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
      connections: tools,
    };
  }

  /*
   * The last two say no app has sent an AI call in the past week: only when
   * the apps were read and sent none. A view empty for another reason (a
   * call that arrived since, a part that could not be read) says nothing it
   * does not know.
   */
  const appsSentNone: boolean = Boolean(
    apps && apps.callsRecently === 0 && (apps.callsInWindow ?? 0) === 0,
  );

  if (!appsSentNone) {
    return { key: LlmEmptyViewFindingKey.Nothing };
  }

  const accounts: Array<LlmSetupCheckConnection> = connections.filter(
    (connection: LlmSetupCheckConnection): boolean => {
      return connection.kind === "provider-account";
    },
  );

  if (accounts.length > 0) {
    return {
      key: LlmEmptyViewFindingKey.ProviderAccountsOnly,
      connections: accounts,
    };
  }

  const sources: Array<LlmMetricSource> = (check.metrics || [])
    .filter((metric: LlmSetupCheckMetricSource): boolean => {
      return metric.points > 0 && metric.source !== LlmMetricSource.GenAi;
    })
    .map((metric: LlmSetupCheckMetricSource): LlmMetricSource => {
      return metric.source;
    });

  if (sources.length > 0) {
    return {
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: Array.from(new Set<LlmMetricSource>(sources)),
    };
  }

  return { key: LlmEmptyViewFindingKey.Nothing };
}
