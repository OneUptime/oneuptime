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
  /*
   * A React Native recording. Its SDK adds nothing to the app's requests,
   * so the web copy (own-origin requests, Trace propagation origins) would
   * be false; the manual onSessionChange step is its only link.
   */
  isMobileReplay?: boolean | undefined;
}

/*
 * How backend rows reach a web recording, for the empty Logs and Traces
 * tabs. There is no snippet any more, because there is no code to add:
 * while a session uploads, the recorder puts traceparent and a tracestate
 * member carrying the session id on the page's requests to its OWN origin,
 * span ingest stamps the session id on every span that inherits it, and
 * the rail joins logs and exceptions by trace id - unless the application
 * turned that off, which the copy says rather than promising a link the
 * switch removed. The one step left to a customer is the cross-origin one,
 * so that is the action the copy names.
 */
export const REPLAY_RAIL_CROSS_ORIGIN_STEP: string =
  "For an API on another origin, add it to Trace propagation origins on the Replay Policy page; it must allow traceparent in Access-Control-Allow-Headers, and its requests then match by trace id.";

export const REPLAY_RAIL_SAME_ORIGIN_SWITCH_CAVEAT: string =
  "unless Same-origin trace propagation is turned off in the Replay Policy";

/*
 * React Native: the SDK patches no fetch or XHR and ignores Trace
 * propagation origins, so nothing links on its own and the manual
 * onSessionChange step is the only action there is.
 */
export const REPLAY_RAIL_MOBILE_NO_AUTO_LINK: string =
  "The React Native SDK adds nothing to your app's requests, so nothing links on its own.";

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

/*
 * The capability a recorder announces when it labels clicks with a
 * selector and text. It MUST be a member of the closed vocabulary
 * SESSION_REPLAY_RECORDER_CAPABILITIES (a test pins that): this copy used
 * to compare against "click", which no recorder has ever sent, so every
 * current recording with an empty Interactions tab was told it "predates
 * click labels" while genuinely old ones got the right copy.
 */
export const REPLAY_CLICK_EVENTS_CAPABILITY: string = "click-events";

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
        detail: "Fetching the rows linked to this session.",
      };
    case "loading":
      return {
        title: `Loading ${noun}`,
        detail: "Fetching the rows linked to this session.",
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
 * tabs explains how backend rows reach a recording and the one step that
 * is still the customer's (an API on another origin on the web; the
 * onSessionChange wiring on React Native, where nothing is automatic).
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

  const isMobileReplay: boolean = args.isMobileReplay === true;

  switch (args.tabId) {
    case "logs":
      if (isMobileReplay) {
        return {
          title: "No backend logs matched this session",
          detail: `${REPLAY_RAIL_MOBILE_NO_AUTO_LINK} Stamp session.id on your OpenTelemetry logs and spans with OneUptimeReplay.onSessionChange() and update it whenever the session rotates; those rows then land here on the session clock.`,
        };
      }

      return {
        title: "No backend logs matched this session",
        detail: `Requests this page makes to its own origin carry the session's trace context automatically, ${REPLAY_RAIL_SAME_ORIGIN_SWITCH_CAVEAT}, so backend logs written inside those requests' traces land here by trace id, on the session clock. ${REPLAY_RAIL_CROSS_ORIGIN_STEP}`,
      };
    case "traces":
      if (isMobileReplay) {
        return {
          title: "No backend traces matched this session",
          detail: `${REPLAY_RAIL_MOBILE_NO_AUTO_LINK} Stamp session.id on your OpenTelemetry spans with OneUptimeReplay.onSessionChange() and update it whenever the session rotates; those spans then land here on the session clock.`,
        };
      }

      return {
        title: "No backend traces matched this session",
        detail: `Requests this page makes to its own origin carry a traceparent and this session's id in tracestate automatically, ${REPLAY_RAIL_SAME_ORIGIN_SWITCH_CAVEAT}, so spans from every backend service that continues W3C trace context are linked at ingest. ${REPLAY_RAIL_CROSS_ORIGIN_STEP}`,
      };
    case "errors":
      if (args.isExpiredFootage) {
        return {
          title: "No server exceptions matched this session",
          detail: isMobileReplay
            ? "The recording's own errors expired with the footage; server exceptions stamped with this session's id would still show here."
            : "The recording's own errors expired with the footage; exceptions your backend reported on this session's requests would still show here.",
        };
      }

      return {
        title: args.hasLoadedFootage
          ? "No errors in the loaded footage"
          : "No errors yet",
        detail:
          "Uncaught errors and rejections appear as their chunk loads; server exceptions linked to this session are merged in.",
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

  const noun: string = TAB_NOUNS[args.tabId];

  /*
   * Nothing has decoded yet, so nothing is known about what the recording
   * holds. This precedes the capability explanation: telling a viewer the
   * recorder is too old, in the second before the first chunk arrives, is
   * a guess dressed as a diagnosis.
   */
  if (!args.hasLoadedFootage) {
    return {
      title: `No ${noun} yet`,
      detail: "Rows appear as the first chunk of footage decodes.",
    };
  }

  if (
    args.tabId === "interactions" &&
    args.recorderCapabilities &&
    !hasCapability(args.recorderCapabilities, REPLAY_CLICK_EVENTS_CAPABILITY)
  ) {
    return {
      title: "This recording predates click labels",
      detail:
        "The recorder that captured it did not label clicks with a selector or text; only coordinate-only clicks can be lifted from the footage. Upgrade the recorder to get labelled interactions.",
      capabilities: args.recorderCapabilities,
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
