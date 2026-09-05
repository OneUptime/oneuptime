import { ReplayBackendSignalsSlot, ReplayRailTabId } from "./ReplaySignalTypes";

/*
 * What an empty rail tab says, and why. Every empty state names its cause
 * and, where one exists, the single action that changes it. A list with
 * no rows is a question ("did nothing happen, or did we not look?") and
 * the copy is the answer; "No events" would be the question again.
 *
 * Pure so the copy table is testable per tab and per cause without a DOM.
 */

export interface ReplayRailEmptyCopy {
  title: string;
  detail: string;
  /* A short code sample when the fix is an instrumentation change. */
  snippet?: string | undefined;
  /* The capability list on old recordings, rendered as a code chip row. */
  capabilities?: ReadonlyArray<string> | undefined;
}

export interface ReplayRailEmptyCopyArgs {
  tabId: ReplayRailTabId;
  /* True when a query, chip or +-30s scope is narrowing the list. */
  isFiltering: boolean;
  /* True when the tab had rows before the filter removed them all. */
  hadRowsBeforeFilter: boolean;
  /* The telemetry slot for Logs / Traces / Errors; null on recording tabs. */
  slot: ReplayBackendSignalsSlot | null;
  /* The stage is gone (retention) but telemetry still loads. */
  isExpiredFootage: boolean;
  /* header.recorderCapabilities; null when the recorder predates them. */
  recorderCapabilities: ReadonlyArray<string> | null | undefined;
  /* Whether any chunk has been decoded yet (rows fill in as chunks load). */
  hasLoadedFootage: boolean;
}

/*
 * The resource-attribute snippet: the one change that makes backend rows
 * carry the session id. Six lines so it fits the rail without a scroll.
 */
export const REPLAY_RAIL_SESSION_ID_SNIPPET: string = [
  "// Stamp every log and span with the replay session id",
  "OneUptimeReplay.onSessionChange((sessionId) => {",
  '  resource.attributes["session.id"] = sessionId;',
  "});",
  "// Server side: read the session.id baggage/header your",
  "// frontend forwards and set it on the request span.",
].join("\n");

const TAB_NOUNS: Record<ReplayRailTabId, string> = {
  all: "signals",
  console: "console output",
  network: "requests",
  navigation: "navigations",
  interactions: "interactions",
  performance: "performance measurements",
  errors: "errors",
  logs: "backend logs",
  traces: "backend traces",
};

function isTelemetryTab(tabId: ReplayRailTabId): boolean {
  return tabId === "logs" || tabId === "traces" || tabId === "errors";
}

function hasCapability(
  capabilities: ReadonlyArray<string> | null | undefined,
  name: string,
): boolean {
  return Array.isArray(capabilities) && capabilities.includes(name);
}

function filteredCopy(tabId: ReplayRailTabId): ReplayRailEmptyCopy {
  return {
    title: `No ${TAB_NOUNS[tabId]} match this filter`,
    detail:
      "Clear the search, the chips or the ±30s scope to see every row on this tab.",
  };
}

function slotCopy(
  tabId: ReplayRailTabId,
  slot: ReplayBackendSignalsSlot,
): ReplayRailEmptyCopy | null {
  const noun: string = TAB_NOUNS[tabId];

  switch (slot.status) {
    case "idle":
      return {
        title: `Loading ${noun}`,
        detail: "Fetching rows that carry this session's id.",
      };
    case "loading":
      return {
        title: `Loading ${noun}`,
        detail: "Fetching rows that carry this session's id.",
      };
    case "locked":
      return {
        title: `${capitalise(noun)} are locked`,
        detail: slot.lockedPermission
          ? `Your role lacks "${slot.lockedPermission}". Ask a project admin for that permission to see these rows.`
          : "Your role lacks the read permission for these rows. Ask a project admin to grant it.",
      };
    case "error":
      return {
        title: `${capitalise(noun)} did not load`,
        detail:
          slot.errorMessage ||
          "The request failed before the server answered. Retry.",
      };
    default:
      return null;
  }
}

function capitalise(text: string): string {
  return text.length === 0
    ? text
    : text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * The copy for an empty tab. Precedence: a filter that removed rows that
 * exist > the telemetry slot's own state (loading / locked / error) >
 * "nothing was recorded" copy specific to the tab, which for telemetry
 * tabs explains the instrumentation change that would populate it.
 */
export function getRailEmptyCopy(
  args: ReplayRailEmptyCopyArgs,
): ReplayRailEmptyCopy {
  if (args.isFiltering && args.hadRowsBeforeFilter) {
    return filteredCopy(args.tabId);
  }

  if (args.slot && isTelemetryTab(args.tabId)) {
    const fromSlot: ReplayRailEmptyCopy | null = slotCopy(
      args.tabId,
      args.slot,
    );

    if (fromSlot) {
      return fromSlot;
    }
  }

  if (args.isFiltering) {
    return filteredCopy(args.tabId);
  }

  switch (args.tabId) {
    case "logs":
      return {
        title: "No backend logs carried this session's id",
        detail:
          "Add session.id to your OpenTelemetry resource via OneUptimeReplay.onSessionChange so every log this page causes lands here, on the session clock.",
        snippet: REPLAY_RAIL_SESSION_ID_SNIPPET,
      };
    case "traces":
      return {
        title: "No backend spans carried this session's id",
        detail:
          "Add session.id to your OpenTelemetry resource via OneUptimeReplay.onSessionChange. Requests to an origin get a traceparent header only when that origin is listed in Trace propagation origins.",
        snippet: REPLAY_RAIL_SESSION_ID_SNIPPET,
      };
    case "errors":
      if (args.isExpiredFootage) {
        return {
          title: "No server exceptions carried this session's id",
          detail:
            "The recording's own errors expired with the footage; exceptions your backend reports with this session id would still show here.",
        };
      }

      return {
        title: args.hasLoadedFootage
          ? "No errors in the loaded footage"
          : "No errors yet",
        detail:
          "Uncaught errors and rejections appear as their chunk loads; server exceptions carrying this session's id are merged in.",
      };
    default:
      break;
  }

  /* Recording-only tabs from here on. */

  if (args.isExpiredFootage) {
    return {
      title: `${capitalise(TAB_NOUNS[args.tabId])} expired with the footage`,
      detail:
        "Rows lifted from the recording are gone with its chunks per your retention. Logs, Traces and Errors still load from the backend.",
    };
  }

  if (
    args.tabId === "interactions" &&
    args.recorderCapabilities &&
    !hasCapability(args.recorderCapabilities, "click")
  ) {
    return {
      title: "This recording predates click labels",
      detail:
        "The recorder that captured it did not label clicks with a selector or text; only coordinate-only clicks can be lifted from the footage. Upgrade the recorder to get labelled interactions.",
      capabilities: args.recorderCapabilities,
    };
  }

  const noun: string = TAB_NOUNS[args.tabId];

  if (!args.hasLoadedFootage) {
    return {
      title: `No ${noun} yet`,
      detail: "Rows appear as the first chunk of footage decodes.",
    };
  }

  switch (args.tabId) {
    case "console":
      return {
        title: "No console output was recorded in the loaded footage",
        detail:
          "Rows fill in as chunks load. console.* calls are captured only when the recorder's console capture is on.",
      };
    case "network":
      return {
        title: "No requests were recorded in the loaded footage",
        detail:
          "Rows fill in as chunks load. fetch and XHR are captured; bodies and headers never are.",
      };
    case "navigation":
      return {
        title: "No navigations in the loaded footage",
        detail:
          "Route changes and full page loads appear as their chunk loads.",
      };
    case "interactions":
      return {
        title: "No clicks in the loaded footage",
        detail:
          "Clicks, inputs and frustration signals appear as their chunk loads.",
      };
    case "performance":
      return {
        title: "No performance measurements in the loaded footage",
        detail:
          "Web vitals and budget overruns are reported once per page as they settle; rows fill in as chunks load.",
      };
    default:
      return {
        title: "Nothing in the loaded footage yet",
        detail: "Rows fill in as chunks load and as backend tabs are opened.",
      };
  }
}
