import {
  DECLARED_CODE_STATE_TONES,
  DECLARED_CODE_STATE_WORDS,
  DeclaredCodeChangeTone,
} from "../AutoRemediation/DeclaredCodeChangeWords";
import {
  DataSecurityIssueCodeFixJSON,
  DataSecurityTelemetryFixPlanJSON,
  DataSecurityTelemetryFixRepositoryChoice,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  MAX_CALL_SITE_PLACES,
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
  getTelemetryLeakSignal,
} from "Common/Types/DataSecurity/TelemetryLeakFix";
import { DeclaredCodeChangeState } from "Common/Utils/AiRemediation/DeclaredCodeChange";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF A SERVICE'S TELEMETRY FIX (#10367): FIX WITH AI'S PLAN ON A
 * TELEMETRY ISSUE, AND WHERE AN ISSUE'S FIX IN CODE STANDS.
 *
 * Fix with AI on an issue in a service's telemetry asks for one pull
 * request that stops the service writing every leak OneUptime still sees
 * in its telemetry. Before it starts, the dialog (TelemetryFixModal) says
 * what the pull request does: how the code is changed - where each leak is
 * written, or one redaction step with a test - where each leak is written,
 * as its records say, the repository it goes to and why that one, and,
 * for a secret, that it must be rotated too.
 *
 * Once asked, the issue keeps its fix (IssueCodeFix): the pull request's
 * state - being written, open, merged or closed - and what production
 * showed once it merged; for a secret, where it was seen.
 *
 * Kept free of React, so a test reads every word and every rule without
 * drawing them.
 */

export const TELEMETRY_FIX_TEST_ID: string = "data-security-telemetry-fix";
export const ISSUE_CODE_FIX_TEST_ID: string = "data-security-issue-code-fix";

// ---- Which issues Fix with AI plans for --------------------------------------

/*
 * Whether Fix with AI on an issue is a service's telemetry fix: a
 * telemetry check's issue on one of the stores of a service's telemetry
 * the fix works on (logs, traces, exceptions, AI conversations, metrics).
 * The server decides the same way (TelemetryLeakFix.serviceOfIssue); an
 * issue whose store the reader cannot read is asked for as before, and the
 * server still plans it.
 */
export function isServiceTelemetryFix(data: {
  isTelemetryCheck: boolean;
  storeKind?: DataStoreKind | string | undefined;
  serviceId?: unknown;
}): boolean {
  return (
    data.isTelemetryCheck &&
    Boolean(data.serviceId) &&
    getTelemetryLeakSignal(data.storeKind) !== null
  );
}

// ---- The dialog ------------------------------------------------------------------

export const TELEMETRY_FIX_TITLE: string = translationKey("Fix with AI");
export const TELEMETRY_FIX_SUBMIT: string = translationKey("Open Pull Request");
export const TELEMETRY_FIX_DESCRIPTION: string = translationKey(
  "One pull request stops {{service}} writing sensitive data to its telemetry.",
);
// Said once the pull request fixes more of the service's issues than this one.
export const TELEMETRY_FIX_ISSUES: PluralTemplate = {
  one: "It fixes {{count}} issue of this service, this one among them.",
  other: "It fixes {{count}} issues of this service, this one among them.",
};
export const TELEMETRY_FIX_NOT_LOADED: string = translationKey(
  "What this fix would change could not be loaded.",
);

/*
 * How the code is changed (decideTelemetryLeakFix): where the data is
 * written, in a handful of places; else one redaction step and a test,
 * because it is written in more places than that, or because the scrub
 * rules hide it at ingest already; or both.
 */
export const CALL_SITES_SENTENCE: PluralTemplate = {
  one: "OneUptime AI changes the code where the data is written, in {{count}} place.",
  other:
    "OneUptime AI changes the code where the data is written, in {{count}} places.",
};
export const REDACTION_STEP_SENTENCE: string = translationKey(
  "OneUptime AI adds one redaction step, with a test, that removes the data before the service sends it.",
);
export const REDACTION_WHY_MANY_PLACES: PluralTemplate = {
  one: "It is written in {{count}} place, so one step fixes it everywhere.",
  other: "It is written in {{count}} places, so one step fixes it everywhere.",
};
export const REDACTION_WHY_SCRUB_RULES: string = translationKey(
  "Your scrub rules hide this data at ingest already: the step makes the code do the same.",
);
export const CALL_SITES_AND_REDACTION_SENTENCE: string = translationKey(
  "OneUptime AI changes the code where the data is written, and adds one redaction step, with a test, for the data your scrub rules hide at ingest.",
);
export const REDACTION_KEYS_LABEL: string = translationKey(
  "What the redaction step removes",
);

export interface TelemetryFixStrategyWords {
  sentence: string | PluralTemplate;
  // The count a plural sentence takes.
  count?: number | undefined;
  // Why one redaction step, when it is one.
  why?: { sentence: string | PluralTemplate; count?: number | undefined };
}

// How the plan changes the code, in its words.
export function getTelemetryFixStrategyWords(
  plan: Pick<DataSecurityTelemetryFixPlanJSON, "strategy" | "placeCount">,
): TelemetryFixStrategyWords {
  if (plan.strategy === TelemetryLeakFixStrategy.CallSites) {
    return { sentence: CALL_SITES_SENTENCE, count: plan.placeCount };
  }

  if (plan.strategy === TelemetryLeakFixStrategy.CallSitesAndRedactionStep) {
    return { sentence: CALL_SITES_AND_REDACTION_SENTENCE };
  }

  return {
    sentence: REDACTION_STEP_SENTENCE,
    why:
      plan.placeCount > MAX_CALL_SITE_PLACES
        ? { sentence: REDACTION_WHY_MANY_PLACES, count: plan.placeCount }
        : { sentence: REDACTION_WHY_SCRUB_RULES },
  };
}

// ---- Where each leak is written ----------------------------------------------

export const LEAKS_TITLE: string = translationKey("Where It Is Written");
export const LEAK_HEADING: string = translationKey(
  "{{dataType}} in {{location}}",
);

// The signal a leak was seen in, by the name of its store's kind.
export const TELEMETRY_LEAK_SIGNAL_LABELS: Readonly<
  Record<TelemetryLeakSignal, string>
> = {
  [TelemetryLeakSignal.Logs]: DataStoreKind.TelemetryLogs,
  [TelemetryLeakSignal.Spans]: DataStoreKind.TelemetryTraces,
  [TelemetryLeakSignal.Exceptions]: DataStoreKind.TelemetryExceptions,
  [TelemetryLeakSignal.AiCalls]: DataStoreKind.TelemetryAiConversations,
  [TelemetryLeakSignal.Metrics]: DataStoreKind.TelemetryMetrics,
};

// Said of each leak only when the plan does both.
export const TELEMETRY_LEAK_HANDLING_WORDS: Readonly<
  Record<TelemetryLeakHandling, string>
> = {
  [TelemetryLeakHandling.CallSite]: translationKey(
    "Changed where it is written",
  ),
  [TelemetryLeakHandling.RedactionStep]: translationKey(
    "Removed by the redaction step",
  ),
};

/*
 * A place as the records name it: the file and line, when they do; else
 * the log line's template (each <...> a value), the span, the metric, the
 * exception or the logger - what OneUptime AI searches the code for. And,
 * for a leak whose records name no place, its key.
 */
export enum TelemetryLeakPlaceKind {
  File = "File",
  LogLine = "LogLine",
  Span = "Span",
  Metric = "Metric",
  Exception = "Exception",
  Logger = "Logger",
  Key = "Key",
}

export const TELEMETRY_LEAK_PLACE_WORDS: Readonly<
  Record<Exclude<TelemetryLeakPlaceKind, TelemetryLeakPlaceKind.File>, string>
> = {
  [TelemetryLeakPlaceKind.LogLine]: translationKey("Log line {{name}}"),
  [TelemetryLeakPlaceKind.Span]: translationKey("Span {{name}}"),
  [TelemetryLeakPlaceKind.Metric]: translationKey("Metric {{name}}"),
  [TelemetryLeakPlaceKind.Exception]: translationKey("Exception {{name}}"),
  [TelemetryLeakPlaceKind.Logger]: translationKey("Logger {{name}}"),
  [TelemetryLeakPlaceKind.Key]: translationKey("Found by its key {{name}}"),
};

export const PLACE_RECORDS: PluralTemplate = {
  one: "Seen in {{count}} record",
  other: "Seen in {{count}} records",
};
export const MORE_PLACES: PluralTemplate = {
  one: "And {{count}} more place",
  other: "And {{count}} more places",
};

// The most places a leak lists before it counts the rest.
export const MAX_PLACES_SHOWN: number = 3;

export interface TelemetryLeakPlaceShown {
  kind: TelemetryLeakPlaceKind;
  // The file and line ("src/signup.js:12"), or the name the words hold.
  name: string;
  // The function, beside a file and line.
  functionName?: string | undefined;
  recordCount: number;
}

// A file and its line as an editor writes them: "src/signup.js:12".
export function getTelemetryLeakFileLine(data: {
  filePath: string;
  lineNumber?: number | undefined;
}): string {
  return data.lineNumber !== undefined && data.lineNumber > 0
    ? `${data.filePath}:${data.lineNumber}`
    : data.filePath;
}

// How one place reads: the most exact of what its records name.
export function getTelemetryLeakPlaceShown(
  place: TelemetryLeakPlace,
): TelemetryLeakPlaceShown {
  const recordCount: number = place.recordCount;
  const frame:
    | {
        filePath: string;
        lineNumber?: number | undefined;
        functionName?: string | undefined;
      }
    | undefined = place.filePath
    ? {
        filePath: place.filePath,
        lineNumber: place.lineNumber,
        functionName: place.functionName,
      }
    : place.frames && place.frames[0]
      ? place.frames[0]
      : undefined;

  if (frame) {
    return {
      kind: TelemetryLeakPlaceKind.File,
      name: getTelemetryLeakFileLine(frame),
      ...(frame.functionName ? { functionName: frame.functionName } : {}),
      recordCount,
    };
  }

  const named: Array<[TelemetryLeakPlaceKind, string | undefined]> = [
    [TelemetryLeakPlaceKind.LogLine, place.template],
    [TelemetryLeakPlaceKind.Span, place.spanName],
    [TelemetryLeakPlaceKind.Metric, place.metricName],
    [TelemetryLeakPlaceKind.Exception, place.exceptionType],
    [TelemetryLeakPlaceKind.Logger, place.scopeName],
  ];

  for (const [kind, name] of named) {
    if (name) {
      return { kind, name, recordCount };
    }
  }

  return { kind: TelemetryLeakPlaceKind.Key, name: "", recordCount };
}

/*
 * A leak's places as the dialog lists them: the first few, and how many
 * more - or, for a leak whose records name none, its key alone.
 */
export function getTelemetryLeakPlacesShown(
  leak: Pick<TelemetryLeakFixLeak, "places" | "key" | "location">,
): { shown: Array<TelemetryLeakPlaceShown>; more: number } {
  const shown: Array<TelemetryLeakPlaceShown> = leak.places
    .map(getTelemetryLeakPlaceShown)
    .filter((place: TelemetryLeakPlaceShown): boolean => {
      return place.kind !== TelemetryLeakPlaceKind.Key;
    });

  if (shown.length === 0) {
    return {
      shown: [
        {
          kind: TelemetryLeakPlaceKind.Key,
          name: leak.key || leak.location,
          recordCount: leak.places.reduce(
            (total: number, place: TelemetryLeakPlace): number => {
              return total + place.recordCount;
            },
            0,
          ),
        },
      ],
      more: 0,
    };
  }

  return {
    shown: shown.slice(0, MAX_PLACES_SHOWN),
    more: Math.max(0, shown.length - MAX_PLACES_SHOWN),
  };
}

// ---- Where the pull request goes ---------------------------------------------

export const REPOSITORY_LINE: string = translationKey(
  "OneUptime AI opens it in {{repository}}.",
);
export const REPOSITORY_LINE_IN_FOLDER: string = translationKey(
  "OneUptime AI opens it in {{repository}}, in the service's folder {{folder}}.",
);
// Why that repository (TelemetryLeakRepositories), when something decided it.
export const REPOSITORY_CHOICE_WORDS: Readonly<
  Record<DataSecurityTelemetryFixRepositoryChoice, string>
> = {
  [DataSecurityTelemetryFixRepositoryChoice.StackTrace]: translationKey(
    "Found from the files the leaks' records name.",
  ),
  [DataSecurityTelemetryFixRepositoryChoice.NameMatch]: translationKey(
    "Its name matches the service's.",
  ),
  [DataSecurityTelemetryFixRepositoryChoice.OnlyRepository]: translationKey(
    "It is the project's only repository.",
  ),
  [DataSecurityTelemetryFixRepositoryChoice.ServiceLeaks]: translationKey(
    "The service's other leaks are written there.",
  ),
  [DataSecurityTelemetryFixRepositoryChoice.Picked]: "",
};
export const PICK_REPOSITORY_LABEL: string = translationKey("Repository");
export const PICK_REPOSITORY_PLACEHOLDER: string = translationKey(
  "Choose a repository",
);
export const PICK_REPOSITORY_HINT: string = translationKey(
  "Pick the repository that holds this service's code. OneUptime AI opens a pull request there.",
);
export const START_FILES: string = translationKey(
  "OneUptime AI starts from {{files}}.",
);

// ---- A secret --------------------------------------------------------------------

export const ROTATE_SECRET: string = translationKey(
  "Rotate the secret too: a code fix stops new copies only.",
);

// ---- A fix already on its way ------------------------------------------------

export const FIX_ON_ITS_WAY: string = translationKey(
  "Its pull request is on its way, so no second one is opened.",
);

// A fix whose pull request is on its way: no second one is asked for.
export function isTelemetryFixOnItsWay(
  existing: DataSecurityIssueCodeFixJSON | undefined,
): boolean {
  if (!existing) {
    return false;
  }

  if (
    existing.state === DeclaredCodeChangeState.Writing ||
    existing.state === DeclaredCodeChangeState.WaitingForYou
  ) {
    return true;
  }

  return (
    existing.state === DeclaredCodeChangeState.Opened &&
    (existing.pullRequest?.state || "open") === "open"
  );
}

/*
 * What the server answers Fix with AI and its plan with, worded here so the
 * reader reads it in their language: the Dashboard looks a message up by
 * its English, so each key is the server's sentence as it writes it
 * (TelemetryLeakFix, DataSecurityCodeTask).
 */
// The plan's repository is still the person's to pick, and none may be picked.
export const NO_REPOSITORY_TO_PICK: string = translationKey(
  "Connect the repository that holds this service's code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.",
);
export const TELEMETRY_FIX_STARTED: string = translationKey(
  "OneUptime AI is working on one pull request for the service's leaks. It will appear under Code, and on each issue it fixes.",
);
export const TELEMETRY_FIX_SERVER_SENTENCES: ReadonlyArray<string> = [
  translationKey(
    "This service writes no sensitive data to its telemetry that OneUptime still sees, so there is nothing to fix in its code.",
  ),
  translationKey(
    "This issue is not in a service's telemetry, so there is no service code to fix.",
  ),
  translationKey(
    "What this fix would change has changed since it was shown to you, so nothing was started. Look at it again before you ask.",
  ),
  translationKey(
    "OneUptime AI is already writing this fix. Follow it in Code.",
  ),
  translationKey("Choose the repository that holds this service's code."),
  NO_REPOSITORY_TO_PICK,
  TELEMETRY_FIX_STARTED,
];

// ---- Where the issue's fix in code stands ------------------------------------

/*
 * The pull request's state, once there is one: open, merged, or closed
 * without being merged - its number goes in its link ("View pull request
 * #482"). Before there is one, a Code task's words, as a fix in the code
 * beside a remediation step says them (DECLARED_CODE_STATE_WORDS).
 */
export const PULL_REQUEST_OPEN: string = translationKey(
  "Its pull request is open in {{repository}}: merging it fixes this issue.",
);
export const PULL_REQUEST_MERGED: string = translationKey(
  "Its pull request was merged in {{repository}}.",
);
export const PULL_REQUEST_CLOSED: string = translationKey(
  "Its pull request was closed without being merged, in {{repository}}. Fix with AI asks for another.",
);
export const CODE_FIX_ISSUES_OF_SERVICE: PluralTemplate = {
  one: "One pull request for {{count}} issue of {{service}}, this one among them.",
  other:
    "One pull request for {{count}} issues of {{service}}, this one among them.",
};
export const CODE_FIX_ISSUES: PluralTemplate = {
  one: "One pull request for {{count}} issue, this one among them.",
  other: "One pull request for {{count}} issues, this one among them.",
};

export interface IssueCodeFixWords {
  sentence: string;
  tone: DeclaredCodeChangeTone;
}

// How the issue's fix in code stands, in its words and its mark's tone.
export function getIssueCodeFixWords(
  fix: Pick<DataSecurityIssueCodeFixJSON, "state" | "pullRequest">,
): IssueCodeFixWords {
  const state: DeclaredCodeChangeState = Object.values(
    DeclaredCodeChangeState,
  ).includes(fix.state as DeclaredCodeChangeState)
    ? (fix.state as DeclaredCodeChangeState)
    : DeclaredCodeChangeState.Ended;

  if (state === DeclaredCodeChangeState.Opened && fix.pullRequest) {
    if (fix.pullRequest.state === "merged") {
      return { sentence: PULL_REQUEST_MERGED, tone: "done" };
    }

    if (fix.pullRequest.state === "closed") {
      return { sentence: PULL_REQUEST_CLOSED, tone: "idle" };
    }

    // Open, as a fix in the code beside a remediation step says it: done, for OneUptime AI.
    return { sentence: PULL_REQUEST_OPEN, tone: "done" };
  }

  return {
    sentence: DECLARED_CODE_STATE_WORDS[state],
    tone: DECLARED_CODE_STATE_TONES[state],
  };
}

// ---- A secret's issue: where it was seen ------------------------------------

export const SECRET_SIGHTINGS_TITLE: string =
  translationKey("Rotate the Secret");
export const SECRET_SIGHTINGS_SENTENCE: string = translationKey(
  "A code fix stops new copies only. Rotate the secret, then check where it was seen:",
);
export const SECRET_LAST_SEEN: string = translationKey("Last seen {{time}}");
