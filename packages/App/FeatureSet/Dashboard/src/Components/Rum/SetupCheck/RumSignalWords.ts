import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { RecordingHealthState } from "Common/Types/Rum/SessionReplayHealth";
import { RECORDING_HEALTH_ROW_WORDS } from "../../../Pages/Rum/View/OverviewHelpers";
import { SessionReplayHealthError } from "../../SessionReplay/SessionReplayHealthError";
import {
  RUM_MOBILE_SETUP_DOCS_URL,
  RUM_WEB_VITALS_DOCS_URL,
} from "../RumSetupGuide";
import { RUM_EMPTY_SIGNALS_DOCS_URL } from "../RumSignalSetupGuide";
import { RumSignalDiagnosis } from "./RumSignalDiagnosis";
import { RumKindRefusal } from "./RumIngestRefusals";
import {
  INGEST_REFUSAL_FIXES,
  INGEST_REFUSAL_FIX_LABELS,
  IngestRefusalFix,
  getIngestRefusalReasonText,
} from "../../Telemetry/IngestRefusalWords";

/*
 * What a RUM application's empty Exceptions and Logs charts, its Logs page
 * and the setup check on its Documentation tab say (issue #5770), for each
 * answer RumSignalDiagnosis gives - React-free, so a node test reads every
 * sentence in any locale.
 *
 * Each sentence is a key of its own, written whole for its signal ("The
 * last log arrived {{time}}."): a noun dropped into a shared sentence
 * would read wrong in every language that inflects it. Dates go in as
 * values of the looked-up sentence, so they follow its language.
 */

export type RumClientKind = "browser" | "mobile";

// The two charts (and the Logs page) that explain why they are empty.
export type RumPanelSignal = "exceptions" | "logs";

// The setup check's rows, in the order it draws them.
export type RumSetupCheckSignal =
  | "traces"
  | "exceptions"
  | "logs"
  | "webVitals"
  | "sessionReplay";

export type RumSetupCheckTone = "ok" | "warning" | "error" | "waiting" | "off";

export type RumSignalAction =
  // Opens the signal's setup dialog (RumSignalSetupModal).
  | { kind: "set-up"; label: string; signal: RumPanelSignal }
  // The application's Documentation tab, where its SDK is set up.
  | { kind: "documentation"; label: string }
  // A docs page, in a new tab.
  | { kind: "docs"; label: string; url: string }
  // The application's Recording Health page.
  | { kind: "recording-health"; label: string }
  | { kind: "set-range"; label: string; range: RangeStartAndEndDateTime }
  | { kind: "retry"; label: string }
  /*
   * A refusal's fix (issue #6378): send with another key (the setup guide
   * in a dialog, its first step the key), the refused key's own page, the
   * project's budgets, or Billing.
   */
  | { kind: "pick-key"; label: string }
  | { kind: "open-key"; label: string; keyId: string }
  | { kind: "budgets"; label: string }
  | { kind: "billing"; label: string };

// An empty chart's (or the Logs page's) block.
export interface RumSignalEmptyCopy {
  title: string;
  detail: string;
  // A fact that backs the answer up: recordings with errors.
  evidence?: string | undefined;
  action?: RumSignalAction | undefined;
  // "Why nothing arrives": the troubleshooting page.
  helpLink?: { text: string; url: string } | undefined;
}

// One row's status in the setup check.
export interface RumSetupCheckLine {
  tone: RumSetupCheckTone;
  text: string;
  detail?: string | undefined;
  action?: RumSignalAction | undefined;
}

/* ------------------------------------------------------- Empty charts */

export const EXCEPTIONS_QUIET_TITLE: string = translationKey(
  "No exceptions in this time range",
);
export const EXCEPTIONS_QUIET_DETAIL: string = translationKey(
  "The last exception arrived {{time}}.",
);
export const LOGS_QUIET_TITLE: string = translationKey(
  "No logs in this time range",
);
export const LOGS_QUIET_DETAIL: string = translationKey(
  "The last log arrived {{time}}.",
);
// The app as a whole is silent: nothing of any kind since {{date}}.
export const APP_SILENT_DETAIL: string = translationKey(
  "Nothing has arrived from this app since {{date}}.",
);

export const EXCEPTIONS_NOT_SET_UP_TITLE: string = translationKey(
  "Exceptions aren't set up",
);
export const EXCEPTIONS_NOT_SET_UP_DETAIL: string = translationKey(
  "No exception has arrived from this app. The OpenTelemetry browser SDK doesn't report errors on its own: a few lines in your telemetry file report them.",
);
export const EXCEPTIONS_NOT_SET_UP_DETAIL_MOBILE: string = translationKey(
  "No exception has arrived from this app. A mobile SDK reports exceptions only where your app or its crash instrumentation records them.",
);
export const EXCEPTIONS_SESSIONS_WITH_ERRORS: PluralTemplate = {
  one: translationKey(
    "Session Replay recorded {{count}} session with an error in this time range, so errors do happen.",
  ),
  other: translationKey(
    "Session Replay recorded {{count}} sessions with errors in this time range, so errors do happen.",
  ),
};

export const LOGS_NOT_SET_UP_TITLE: string =
  translationKey("Logs aren't set up");
export const LOGS_NOT_SET_UP_DETAIL: string = translationKey(
  "No logs have arrived from this app. The OpenTelemetry browser SDK sends page loads and requests on its own; logs need a log pipeline and code that writes log records.",
);
export const LOGS_NOT_SET_UP_DETAIL_SINCE: string = translationKey(
  "No logs have arrived from this app since {{date}}. The OpenTelemetry browser SDK sends page loads and requests on its own; logs need a log pipeline and code that writes log records.",
);
export const LOGS_NOT_SET_UP_DETAIL_MOBILE: string = translationKey(
  "No logs have arrived from this app. A mobile SDK sends logs only once a log exporter is set up and your app writes log records.",
);
export const LOGS_NOT_SET_UP_DETAIL_MOBILE_SINCE: string = translationKey(
  "No logs have arrived from this app since {{date}}. A mobile SDK sends logs only once a log exporter is set up and your app writes log records.",
);

export const SDK_MISSING_TITLE: string = translationKey(
  "The OpenTelemetry SDK isn't reporting",
);
export const EXCEPTIONS_SDK_MISSING_DETAIL: string = translationKey(
  "Recordings arrive from this app, but exceptions come through the OpenTelemetry browser SDK, which hasn't reported yet.",
);
export const LOGS_SDK_MISSING_DETAIL: string = translationKey(
  "Recordings arrive from this app, but logs come through the OpenTelemetry browser SDK, which hasn't reported yet.",
);

export const NOTHING_ARRIVED_TITLE: string = translationKey(
  "Nothing has arrived from this app yet",
);
export const EXCEPTIONS_NOTHING_ARRIVED_DETAIL: string = translationKey(
  "Once its OpenTelemetry SDK reports, page loads and requests come first. Exceptions need a few lines more.",
);
export const LOGS_NOTHING_ARRIVED_DETAIL: string = translationKey(
  "Once its OpenTelemetry SDK reports, page loads and requests come first. Logs need a log pipeline as well.",
);

export const EXCEPTIONS_UNKNOWN_TITLE: string = translationKey(
  "Couldn't check why there are no exceptions",
);
export const LOGS_UNKNOWN_TITLE: string = translationKey(
  "Couldn't check why there are no logs",
);
export const UNKNOWN_DETAIL: string = translationKey(
  "Part of the check didn't load. Try again in a moment.",
);
// The range's own count failed: whether any arrived is what is unknown.
export const EXCEPTIONS_LOAD_FAILED_TITLE: string = translationKey(
  "Couldn't load exceptions",
);
export const LOGS_LOAD_FAILED_TITLE: string =
  translationKey("Couldn't load logs");
export const LOAD_FAILED_DETAIL: string = translationKey(
  "Something went wrong. Try again in a moment.",
);

export const SET_UP_EXCEPTIONS: string = translationKey("Set up exceptions");
export const SET_UP_LOGS: string = translationKey("Set up logs");
export const SEE_SETUP_STEPS: string = translationKey("See the setup steps");
export const OPEN_MOBILE_SETUP: string = translationKey("Open Mobile Setup");
export const TRY_AGAIN: string = translationKey("Try again");
export const WHY_NOTHING_ARRIVES: string = translationKey(
  "Why nothing arrives",
);

// A longer range (RUM_WIDER_RANGES), worded as the empty explorers word it.
export const SHOW_RANGE_ACTIONS: Readonly<Partial<Record<TimeRange, string>>> =
  {
    [TimeRange.PAST_ONE_DAY]: translationKey("Show the past day"),
    [TimeRange.PAST_ONE_WEEK]: translationKey("Show the past week"),
    [TimeRange.PAST_ONE_MONTH]: translationKey("Show the past month"),
    [TimeRange.PAST_THREE_MONTHS]: translationKey("Show the past 3 months"),
  };

/* ---------------------------------------------------------- Setup check */

export const SETUP_CHECK_TITLE: string = translationKey("Setup check");
export const SETUP_CHECK_DESCRIPTION: string = translationKey(
  "What arrives from this app, kind by kind, and what is not set up yet.",
);
export const SETUP_CHECK_AGAIN: string = translationKey("Check again");

export const SETUP_CHECK_LABELS: Readonly<Record<RumSetupCheckSignal, string>> =
  {
    traces: translationKey("Page loads and requests"),
    exceptions: translationKey("Exceptions"),
    logs: translationKey("Logs"),
    webVitals: translationKey("Web Vitals"),
    sessionReplay: translationKey("Session Replay"),
  };

// A mobile app's spans are app starts and requests, not page loads.
export const SETUP_CHECK_TRACES_LABEL_MOBILE: string = translationKey("Traces");

export const ROW_CHECKING: string = translationKey("Checking…");
export const ROW_RECEIVING: string = translationKey(
  "Arriving. The latest came in {{time}}.",
);
export const ROW_QUIET: string = translationKey(
  "Quiet. The latest came in {{time}}.",
);
export const ROW_APP_SILENT: string = translationKey(
  "Quiet. Nothing has arrived from this app since {{date}}.",
);
export const ROW_NOT_SET_UP: string = translationKey(
  "Not set up. Nothing has arrived yet.",
);
export const ROW_NOT_SET_UP_SINCE: string = translationKey(
  "Not set up. Nothing has arrived since {{date}}.",
);
export const ROW_SDK_MISSING: string = translationKey(
  "Not set up. Only Session Replay reports from this app.",
);
export const ROW_VITALS_OTHER_NAMES: string = translationKey(
  "Not found. Metrics arrive, but none in the past 30 days under a name the Web Vitals card reads.",
);
/*
 * Nothing at all has arrived from the app, so every row waits alike: each
 * says only that, short, and the hint under it says what sends that kind.
 * The application's status pill says the same (RumApplicationStatus).
 */
export const ROW_NOTHING_ARRIVED: string = translationKey("Waiting for data");
export const ROW_UNKNOWN: string = translationKey("Couldn't be checked.");

// Why a signal that never arrived is not set up, under its row.
export const ROW_HINTS: Readonly<
  Record<Exclude<RumSetupCheckSignal, "sessionReplay">, string>
> = {
  traces: translationKey(
    "Page loads and requests come from the OpenTelemetry browser SDK, which the steps below set up.",
  ),
  exceptions: translationKey(
    "The browser SDK doesn't report errors on its own.",
  ),
  logs: translationKey("The browser SDK sends no logs on its own."),
  webVitals: translationKey(
    "Web Vitals are metrics your app reports with the web-vitals library.",
  ),
};

export const ROW_HINTS_MOBILE: Readonly<
  Record<"traces" | "exceptions" | "logs", string>
> = {
  traces: translationKey(
    "App starts and requests come from the OpenTelemetry mobile SDK, which the steps below set up.",
  ),
  exceptions: translationKey(
    "A mobile SDK reports exceptions only where your app or its crash instrumentation records them.",
  ),
  logs: translationKey(
    "A mobile SDK sends logs only once a log exporter is set up.",
  ),
};

export const SET_UP_WEB_VITALS: string = translationKey("Set up Web Vitals");
export const OPEN_RECORDING_HEALTH: string = translationKey(
  "Open Recording Health",
);
export const REPLAY_LATEST_CHUNK: string = translationKey(
  "The latest recording came in {{time}}.",
);

/* ------------------------------------------------------------ Refusals */

/*
 * What the application sends of a kind is refused at ingest (issue #6378,
 * RumIngestRefusals): the row says so and when, the reason under it
 * (IngestRefusalWords), and its fix as the row's action.
 */
export const ROW_REFUSED: string = translationKey(
  "Refused. The latest was refused {{time}}.",
);
export const ROW_PARTLY_REFUSED: string = translationKey(
  "Arriving, but some are refused. The latest was refused {{time}}.",
);
export const EXCEPTIONS_REFUSED_TITLE: string = translationKey(
  "Exceptions are being refused",
);
export const LOGS_REFUSED_TITLE: string = translationKey(
  "Logs are being refused",
);
export const REFUSED_LATEST: string = translationKey(
  "The latest was refused {{time}}.",
);

/* -------------------------------------------------------------- Helpers */

const TWO_DAYS_MS: number = 2 * 24 * 60 * 60 * 1000;

function translate(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

/*
 * A "since" date: the day, and the time too while it is recent - "since
 * Nov 08 2026, 10:02" right after an upgrade, "since Oct 02, 2026" later.
 */
export function formatSinceDate(date: Date, now: Date): string {
  const recent: boolean =
    Math.abs(now.getTime() - date.getTime()) < TWO_DAYS_MS;

  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, !recent);
}

function fromNow(date: Date, now: Date): string {
  return OneUptimeDate.fromNow(date, now);
}

function setUpAction(
  signal: RumPanelSignal,
  client: RumClientKind,
  translator: Translator,
): RumSignalAction {
  if (client === "mobile") {
    return {
      kind: "docs",
      label: translate(translator, OPEN_MOBILE_SETUP),
      url: RUM_MOBILE_SETUP_DOCS_URL,
    };
  }

  return {
    kind: "set-up",
    label: translate(
      translator,
      signal === "exceptions" ? SET_UP_EXCEPTIONS : SET_UP_LOGS,
    ),
    signal,
  };
}

// A refusal's fix, as an action; undefined when nothing here puts it right.
export function getRefusalAction(
  refusal: RumKindRefusal,
  translator: Translator,
): RumSignalAction | undefined {
  const fix: IngestRefusalFix | null =
    INGEST_REFUSAL_FIXES[refusal.refusal.reason];

  if (!fix) {
    return undefined;
  }

  const label: string = translate(translator, INGEST_REFUSAL_FIX_LABELS[fix]);

  if (fix === "open-key") {
    return { kind: "open-key", label, keyId: refusal.refusal.keyId };
  }

  return { kind: fix, label };
}

// A setup check row whose kind is refused.
function refusalLine(
  refusal: RumKindRefusal,
  translator: Translator,
  now: Date,
): RumSetupCheckLine {
  const isRefused: boolean = refusal.state === "refused";

  return {
    tone: isRefused ? "error" : "warning",
    text: translator.translateTemplate(
      isRefused ? ROW_REFUSED : ROW_PARTLY_REFUSED,
      { time: fromNow(refusal.refusal.lastRefusedAt, now) },
    ),
    detail: getIngestRefusalReasonText(refusal.refusal, translator),
    action: getRefusalAction(refusal, translator),
  };
}

function helpLink(
  translator: Translator,
): { text: string; url: string } | undefined {
  return {
    text: translate(translator, WHY_NOTHING_ARRIVES),
    url: RUM_EMPTY_SIGNALS_DOCS_URL,
  };
}

/* ------------------------------------------------------- Empty charts */

/*
 * What an empty Exceptions or Logs chart, or the empty Logs page, says;
 * null while it loads and when something arrived (the chart draws it).
 */
export function getRumSignalEmptyCopy(data: {
  signal: RumPanelSignal;
  diagnosis: RumSignalDiagnosis;
  client: RumClientKind;
  // Recorded sessions with an error in the range, when they were counted.
  sessionsWithErrors?: number | null | undefined;
  /*
   * Whether what carries the signal is refused at ingest (traces carry
   * exceptions): a refusal nothing has arrived since says so instead of
   * the answer the arrivals alone would give.
   */
  refusal?: RumKindRefusal | null | undefined;
  translator: Translator;
  now: Date;
}): RumSignalEmptyCopy | null {
  const { signal, diagnosis, client, translator, now } = data;
  const isExceptions: boolean = signal === "exceptions";

  if (
    data.refusal?.state === "refused" &&
    diagnosis.state !== "loading" &&
    diagnosis.state !== "receiving" &&
    diagnosis.state !== "unknown"
  ) {
    return {
      title: translate(
        translator,
        isExceptions ? EXCEPTIONS_REFUSED_TITLE : LOGS_REFUSED_TITLE,
      ),
      detail: getIngestRefusalReasonText(data.refusal.refusal, translator),
      evidence: translator.translateTemplate(REFUSED_LATEST, {
        time: fromNow(data.refusal.refusal.lastRefusedAt, now),
      }),
      action: getRefusalAction(data.refusal, translator),
      helpLink: helpLink(translator),
    };
  }

  switch (diagnosis.state) {
    case "loading":
    case "receiving":
      return null;

    case "quiet": {
      // The whole app is silent: since when, and where to look.
      if (!diagnosis.lastArrivalAt && diagnosis.since) {
        return {
          title: translate(
            translator,
            isExceptions ? EXCEPTIONS_QUIET_TITLE : LOGS_QUIET_TITLE,
          ),
          detail: translator.translateTemplate(APP_SILENT_DETAIL, {
            date: formatSinceDate(diagnosis.since, now),
          }),
          action: {
            kind: "documentation",
            label: translate(translator, SEE_SETUP_STEPS),
          },
          helpLink: helpLink(translator),
        };
      }

      const range: RangeStartAndEndDateTime | null = diagnosis.widerRange;
      const rangeLabel: string | undefined = range
        ? SHOW_RANGE_ACTIONS[range.range]
        : undefined;

      return {
        title: translate(
          translator,
          isExceptions ? EXCEPTIONS_QUIET_TITLE : LOGS_QUIET_TITLE,
        ),
        detail: diagnosis.lastArrivalAt
          ? translator.translateTemplate(
              isExceptions ? EXCEPTIONS_QUIET_DETAIL : LOGS_QUIET_DETAIL,
              { time: fromNow(diagnosis.lastArrivalAt, now) },
            )
          : "",
        action:
          range && rangeLabel
            ? {
                kind: "set-range",
                label: translate(translator, rangeLabel),
                range,
              }
            : undefined,
      };
    }

    case "not-set-up": {
      if (diagnosis.cause === "sdk") {
        return {
          title: translate(translator, SDK_MISSING_TITLE),
          detail: translate(
            translator,
            isExceptions
              ? EXCEPTIONS_SDK_MISSING_DETAIL
              : LOGS_SDK_MISSING_DETAIL,
          ),
          action: {
            kind: "documentation",
            label: translate(translator, SEE_SETUP_STEPS),
          },
        };
      }

      if (isExceptions) {
        const sessions: number =
          typeof data.sessionsWithErrors === "number"
            ? data.sessionsWithErrors
            : 0;

        return {
          title: translate(translator, EXCEPTIONS_NOT_SET_UP_TITLE),
          detail: translate(
            translator,
            client === "mobile"
              ? EXCEPTIONS_NOT_SET_UP_DETAIL_MOBILE
              : EXCEPTIONS_NOT_SET_UP_DETAIL,
          ),
          evidence:
            sessions > 0
              ? translator.translatePlural(
                  EXCEPTIONS_SESSIONS_WITH_ERRORS,
                  sessions,
                )
              : undefined,
          action: setUpAction(signal, client, translator),
          helpLink: helpLink(translator),
        };
      }

      const since: Date | null = diagnosis.since;
      const detailKey: string =
        client === "mobile"
          ? since
            ? LOGS_NOT_SET_UP_DETAIL_MOBILE_SINCE
            : LOGS_NOT_SET_UP_DETAIL_MOBILE
          : since
            ? LOGS_NOT_SET_UP_DETAIL_SINCE
            : LOGS_NOT_SET_UP_DETAIL;

      return {
        title: translate(translator, LOGS_NOT_SET_UP_TITLE),
        detail: since
          ? translator.translateTemplate(detailKey, {
              date: formatSinceDate(since, now),
            })
          : translate(translator, detailKey),
        action: setUpAction(signal, client, translator),
        helpLink: helpLink(translator),
      };
    }

    case "not-arriving":
      return {
        title: translate(translator, NOTHING_ARRIVED_TITLE),
        detail: translate(
          translator,
          isExceptions
            ? EXCEPTIONS_NOTHING_ARRIVED_DETAIL
            : LOGS_NOTHING_ARRIVED_DETAIL,
        ),
        action: {
          kind: "documentation",
          label: translate(translator, SEE_SETUP_STEPS),
        },
        helpLink: helpLink(translator),
      };

    case "unknown":
    default:
      if (diagnosis.rangeFailed) {
        return {
          title: translate(
            translator,
            isExceptions
              ? EXCEPTIONS_LOAD_FAILED_TITLE
              : LOGS_LOAD_FAILED_TITLE,
          ),
          detail: translate(translator, LOAD_FAILED_DETAIL),
          action: { kind: "retry", label: translate(translator, TRY_AGAIN) },
        };
      }

      return {
        title: translate(
          translator,
          isExceptions ? EXCEPTIONS_UNKNOWN_TITLE : LOGS_UNKNOWN_TITLE,
        ),
        detail: translate(translator, UNKNOWN_DETAIL),
        action: { kind: "retry", label: translate(translator, TRY_AGAIN) },
      };
  }
}

/* ---------------------------------------------------------- Setup check */

export function getRumSetupCheckLabel(
  signal: RumSetupCheckSignal,
  client: RumClientKind,
  translator: Translator,
): string {
  return translate(
    translator,
    signal === "traces" && client === "mobile"
      ? SETUP_CHECK_TRACES_LABEL_MOBILE
      : SETUP_CHECK_LABELS[signal],
  );
}

function rowHint(
  signal: Exclude<RumSetupCheckSignal, "sessionReplay">,
  client: RumClientKind,
  translator: Translator,
): string | undefined {
  if (client === "mobile") {
    return signal === "webVitals"
      ? undefined
      : translate(translator, ROW_HINTS_MOBILE[signal]);
  }

  return translate(translator, ROW_HINTS[signal]);
}

function rowSetUpAction(
  signal: Exclude<RumSetupCheckSignal, "sessionReplay">,
  client: RumClientKind,
  translator: Translator,
): RumSignalAction | undefined {
  if (signal === "exceptions" || signal === "logs") {
    return setUpAction(signal, client, translator);
  }

  if (signal === "webVitals") {
    return {
      kind: "docs",
      label: translate(translator, SET_UP_WEB_VITALS),
      url: RUM_WEB_VITALS_DOCS_URL,
    };
  }

  // Traces: the setup guide is right below the check.
  return undefined;
}

// One row of the setup check, for every signal but Session Replay.
export function getRumSetupCheckLine(data: {
  signal: Exclude<RumSetupCheckSignal, "sessionReplay">;
  diagnosis: RumSignalDiagnosis;
  client: RumClientKind;
  /*
   * Whether what carries the signal is refused at ingest: refused wins
   * over every answer but loading and unknown; partly refused only over
   * arriving (it does arrive, so the rest of the answers do not hold).
   */
  refusal?: RumKindRefusal | null | undefined;
  translator: Translator;
  now: Date;
}): RumSetupCheckLine {
  const { signal, diagnosis, client, translator, now } = data;

  if (
    data.refusal &&
    diagnosis.state !== "loading" &&
    diagnosis.state !== "unknown" &&
    (data.refusal.state === "refused" || diagnosis.state === "receiving")
  ) {
    return refusalLine(data.refusal, translator, now);
  }

  switch (diagnosis.state) {
    case "loading":
      return { tone: "waiting", text: translate(translator, ROW_CHECKING) };

    case "receiving":
      return {
        tone: "ok",
        text: diagnosis.lastArrivalAt
          ? translator.translateTemplate(ROW_RECEIVING, {
              time: fromNow(diagnosis.lastArrivalAt, now),
            })
          : translate(translator, ROW_CHECKING),
      };

    case "quiet":
      return {
        tone: "waiting",
        text: diagnosis.lastArrivalAt
          ? translator.translateTemplate(ROW_QUIET, {
              time: fromNow(diagnosis.lastArrivalAt, now),
            })
          : diagnosis.since
            ? translator.translateTemplate(ROW_APP_SILENT, {
                date: formatSinceDate(diagnosis.since, now),
              })
            : translate(translator, ROW_CHECKING),
      };

    case "not-set-up": {
      if (diagnosis.cause === "sdk") {
        return {
          tone: "warning",
          text: translate(translator, ROW_SDK_MISSING),
          detail: rowHint(signal, client, translator),
        };
      }

      if (diagnosis.cause === "names") {
        return {
          tone: "warning",
          text: translate(translator, ROW_VITALS_OTHER_NAMES),
          action: rowSetUpAction(signal, client, translator),
        };
      }

      return {
        tone: "warning",
        text: diagnosis.since
          ? translator.translateTemplate(ROW_NOT_SET_UP_SINCE, {
              date: formatSinceDate(diagnosis.since, now),
            })
          : translate(translator, ROW_NOT_SET_UP),
        detail: rowHint(signal, client, translator),
        action: rowSetUpAction(signal, client, translator),
      };
    }

    case "not-arriving":
      return {
        tone: "waiting",
        text: translate(translator, ROW_NOTHING_ARRIVED),
        detail: rowHint(signal, client, translator),
      };

    case "unknown":
    default:
      return { tone: "off", text: translate(translator, ROW_UNKNOWN) };
  }
}

/*
 * The Session Replay row, from the recorder's health (the one poller every
 * replay surface shares). Its words are the Overview's Recording Health
 * row's; its link, the Recording Health page that says the rest. A reader
 * without Session Replay - not in the plan, or no permission to read it -
 * gets no row: nothing here is theirs to act on.
 */
export function getSessionReplaySetupCheckLine(data: {
  isLoading: boolean;
  error: SessionReplayHealthError | null;
  state: RecordingHealthState;
  lastChunkReceivedAt: Date | null;
  // Whether recordings are refused at ingest, before the recorder's gates.
  refusal?: RumKindRefusal | null | undefined;
  translator: Translator;
  now: Date;
}): RumSetupCheckLine | null {
  const { translator, now } = data;

  if (data.isLoading) {
    return { tone: "waiting", text: translate(translator, ROW_CHECKING) };
  }

  if (data.error) {
    if (data.error.kind === "permission" || data.error.kind === "plan") {
      return null;
    }

    return { tone: "off", text: translate(translator, ROW_UNKNOWN) };
  }

  /*
   * A refused key turns recordings away before the recorder's own gates
   * count anything, so its health cannot tell: say so here. Partly refused
   * only beside recordings that do arrive. Recording turned off is still
   * the answer (nothing would be recorded with a good key either), and an
   * unknown health leaves the arrivals unknown too.
   */
  if (
    data.refusal &&
    data.state !== "disabled-project" &&
    data.state !== "disabled-app" &&
    data.state !== "unknown" &&
    (data.refusal.state === "refused" ||
      data.state === "healthy" ||
      data.state === "healthy-quiet")
  ) {
    return refusalLine(data.refusal, translator, now);
  }

  const tones: Record<RecordingHealthState, RumSetupCheckTone> = {
    "disabled-project": "off",
    "disabled-app": "off",
    "budget-paused": "error",
    refusing: "error",
    "never-loaded": "warning",
    "loaded-never-uploaded": "warning",
    stale: "warning",
    "healthy-quiet": "waiting",
    healthy: "ok",
    unknown: "off",
  };

  const words: string =
    RECORDING_HEALTH_ROW_WORDS[data.state] ||
    RECORDING_HEALTH_ROW_WORDS.unknown;

  return {
    tone: tones[data.state] || "off",
    text: translate(translator, words),
    detail: data.lastChunkReceivedAt
      ? translator.translateTemplate(REPLAY_LATEST_CHUNK, {
          time: fromNow(data.lastChunkReceivedAt, now),
        })
      : undefined,
    action:
      data.state === "healthy"
        ? undefined
        : {
            kind: "recording-health",
            label: translate(translator, OPEN_RECORDING_HEALTH),
          },
  };
}
