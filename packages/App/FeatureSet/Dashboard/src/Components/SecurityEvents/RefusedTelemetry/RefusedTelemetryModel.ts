import {
  LOGS_BUDGET_USED_UP_BETWEEN,
  LOGS_BUDGET_USED_UP_SINCE,
  LOGS_KEY_BUDGET_USED_UP_BETWEEN,
  LOGS_KEY_BUDGET_USED_UP_SINCE,
  LOGS_KEY_RATE_LIMITED_BETWEEN,
  LOGS_KEY_RATE_LIMITED_SINCE,
  LOGS_LABEL_BUDGET_USED_UP_BETWEEN,
  LOGS_LABEL_BUDGET_USED_UP_SINCE,
  LOGS_RATE_LIMITED_BETWEEN,
  LOGS_RATE_LIMITED_SINCE,
  LOGS_TEAM_BUDGET_USED_UP_BETWEEN,
  LOGS_TEAM_BUDGET_USED_UP_SINCE,
  NOT_STORED_REQUESTS,
  NOT_STORED_SIZE,
  THROTTLED_REQUESTS,
  TRACES_BUDGET_USED_UP_BETWEEN,
  TRACES_BUDGET_USED_UP_SINCE,
  TRACES_KEY_BUDGET_USED_UP_BETWEEN,
  TRACES_KEY_BUDGET_USED_UP_SINCE,
  TRACES_KEY_RATE_LIMITED_BETWEEN,
  TRACES_KEY_RATE_LIMITED_SINCE,
  TRACES_LABEL_BUDGET_USED_UP_BETWEEN,
  TRACES_LABEL_BUDGET_USED_UP_SINCE,
  TRACES_RATE_LIMITED_BETWEEN,
  TRACES_RATE_LIMITED_SINCE,
  TRACES_SOURCE,
  TRACES_TEAM_BUDGET_USED_UP_BETWEEN,
  TRACES_TEAM_BUDGET_USED_UP_SINCE,
  YOUR_LOGS_SOURCE,
} from "./RefusedTelemetryCopy";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryIngestionBudgetScope } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { formatTelemetryIngestionBudgetBytes } from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetWords";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetrySignal,
  getRefusedTelemetryBetween,
  readRefusedTelemetryRecord,
  sortRefusedTelemetryForReading,
} from "Common/Utils/SecurityEvent/RefusedTelemetry";

/*
 * WHAT A BUDGET OR A RATE REFUSED, IN WORDS (#10431): for each stretch
 * Security Events kept (Common/Utils/SecurityEvent/RefusedTelemetry), the
 * source it belongs to, the sentence that says whose budget or rate
 * refused what and when, and how much was not stored. React-free, so the
 * choice of sentence and its values are pinned in a plain test; the
 * Overview, the sources, a retrohunt, a hunt and a case draw them
 * (RefusedTelemetryLines).
 */

// The name an ingestion key is shown by when it has none.
export const UNNAMED_KEY: string = translationKey("Unnamed Key");

// What the source of a signal is called, above its lines.
export const REFUSED_TELEMETRY_SOURCE_TITLES: Record<
  RefusedTelemetrySignal,
  string
> = {
  [ProductType.Logs]: YOUR_LOGS_SOURCE,
  [ProductType.Traces]: TRACES_SOURCE,
};

interface SentencePair {
  // While it goes on: since {{time}}.
  since: string;
  // Once it ended: from {{from}} to {{to}}.
  between: string;
}

type ScopeSentences = Partial<
  Record<TelemetryIngestionBudgetScope, SentencePair>
>;

/*
 * Every sentence, by signal, kind and whose budget. A team or a label has a
 * daily budget and no rate, so a rate's sentences are the project's and a
 * key's.
 */
export const REFUSED_TELEMETRY_SENTENCES: Record<
  RefusedTelemetrySignal,
  Record<RefusedTelemetryKind, ScopeSentences>
> = {
  [ProductType.Logs]: {
    [RefusedTelemetryKind.BudgetUsedUp]: {
      [TelemetryIngestionBudgetScope.Project]: {
        since: LOGS_BUDGET_USED_UP_SINCE,
        between: LOGS_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.IngestionKey]: {
        since: LOGS_KEY_BUDGET_USED_UP_SINCE,
        between: LOGS_KEY_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.Team]: {
        since: LOGS_TEAM_BUDGET_USED_UP_SINCE,
        between: LOGS_TEAM_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.Label]: {
        since: LOGS_LABEL_BUDGET_USED_UP_SINCE,
        between: LOGS_LABEL_BUDGET_USED_UP_BETWEEN,
      },
    },
    [RefusedTelemetryKind.RateLimited]: {
      [TelemetryIngestionBudgetScope.Project]: {
        since: LOGS_RATE_LIMITED_SINCE,
        between: LOGS_RATE_LIMITED_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.IngestionKey]: {
        since: LOGS_KEY_RATE_LIMITED_SINCE,
        between: LOGS_KEY_RATE_LIMITED_BETWEEN,
      },
    },
  },
  [ProductType.Traces]: {
    [RefusedTelemetryKind.BudgetUsedUp]: {
      [TelemetryIngestionBudgetScope.Project]: {
        since: TRACES_BUDGET_USED_UP_SINCE,
        between: TRACES_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.IngestionKey]: {
        since: TRACES_KEY_BUDGET_USED_UP_SINCE,
        between: TRACES_KEY_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.Team]: {
        since: TRACES_TEAM_BUDGET_USED_UP_SINCE,
        between: TRACES_TEAM_BUDGET_USED_UP_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.Label]: {
        since: TRACES_LABEL_BUDGET_USED_UP_SINCE,
        between: TRACES_LABEL_BUDGET_USED_UP_BETWEEN,
      },
    },
    [RefusedTelemetryKind.RateLimited]: {
      [TelemetryIngestionBudgetScope.Project]: {
        since: TRACES_RATE_LIMITED_SINCE,
        between: TRACES_RATE_LIMITED_BETWEEN,
      },
      [TelemetryIngestionBudgetScope.IngestionKey]: {
        since: TRACES_KEY_RATE_LIMITED_SINCE,
        between: TRACES_KEY_RATE_LIMITED_BETWEEN,
      },
    },
  },
};

/*
 * The sentence for a stretch: its signal's, its kind's and its budget's,
 * since when while it goes on, from when to when once it ended. A scope a
 * kind has no sentence for (a rate of a team, which none has) is said as
 * the project's.
 */
export function getRefusedTelemetrySentence(refusal: RefusedTelemetry): string {
  const byScope: ScopeSentences =
    REFUSED_TELEMETRY_SENTENCES[refusal.signal][refusal.kind];
  const pair: SentencePair =
    byScope[refusal.scope] || byScope[TelemetryIngestionBudgetScope.Project]!;

  return refusal.to === null ? pair.since : pair.between;
}

// The name a key, a team or a label is put into its sentence with.
function getScopeName(
  refusal: RefusedTelemetry,
  translator: Translator,
): string {
  if (refusal.scopeName.trim()) {
    return refusal.scopeName;
  }

  if (refusal.scope === TelemetryIngestionBudgetScope.IngestionKey) {
    return translator.translateText(UNNAMED_KEY) || UNNAMED_KEY;
  }

  return refusal.scopeId;
}

// A moment in a sentence, as the reader's clock and language write it.
export function formatRefusedTelemetryTime(value: string): string {
  return OneUptimeDate.getDateAsLocalFormattedString(new Date(value));
}

// What a line says, in the reader's language.
export interface RefusedTelemetryLine {
  // Unique among the lines drawn together.
  id: string;
  signal: RefusedTelemetrySignal;
  // A translation key: "Your logs", "Traces".
  sourceTitle: string;
  sentence: string;
  // How much was not stored, or "" when nothing was counted.
  amount: string;
  isOngoing: boolean;
}

export function getRefusedTelemetryAmount(data: {
  refusal: RefusedTelemetry;
  translator: Translator;
}): string {
  const { refusal, translator } = data;

  if (refusal.refusedRequests <= 0) {
    return "";
  }

  if (refusal.kind === RefusedTelemetryKind.RateLimited) {
    return translator.translatePlural(
      THROTTLED_REQUESTS,
      refusal.refusedRequests,
    );
  }

  // A body refused before it was read (a deferred one, such as Loki's) has no size.
  if (refusal.refusedBytes <= 0) {
    return translator.translatePlural(
      NOT_STORED_REQUESTS,
      refusal.refusedRequests,
    );
  }

  return translator.translatePlural(NOT_STORED_SIZE, refusal.refusedRequests, {
    size: formatTelemetryIngestionBudgetBytes(refusal.refusedBytes, translator),
  });
}

export function describeRefusedTelemetry(data: {
  refusal: RefusedTelemetry;
  translator: Translator;
}): RefusedTelemetryLine {
  const { refusal, translator } = data;
  const name: string = getScopeName(refusal, translator);
  const sentence: string = getRefusedTelemetrySentence(refusal);

  return {
    id: `${refusal.signal}:${refusal.kind}:${refusal.scope}:${refusal.scopeId}:${refusal.from}`,
    signal: refusal.signal,
    sourceTitle: REFUSED_TELEMETRY_SOURCE_TITLES[refusal.signal],
    sentence:
      refusal.to === null
        ? translator.translateTemplate(sentence, {
            name,
            time: formatRefusedTelemetryTime(refusal.from),
          })
        : translator.translateTemplate(sentence, {
            name,
            from: formatRefusedTelemetryTime(refusal.from),
            to: formatRefusedTelemetryTime(refusal.to),
          }),
    amount: getRefusedTelemetryAmount({ refusal, translator }),
    isOngoing: refusal.to === null,
  };
}

/*
 * The lines for a set of stretches, what goes on first and then the
 * latest - the order the Overview and the sources read them in.
 */
export function describeRefusedTelemetryList(data: {
  refusals: ReadonlyArray<RefusedTelemetry>;
  translator: Translator;
}): Array<RefusedTelemetryLine> {
  return sortRefusedTelemetryForReading(data.refusals).map(
    (refusal: RefusedTelemetry): RefusedTelemetryLine => {
      return describeRefusedTelemetry({
        refusal,
        translator: data.translator,
      });
    },
  );
}

/*
 * Whether anything was refused in a period - a hunt's run window: what it
 * found, or that it found nothing, is then not all there was.
 */
export function isPeriodRefused(data: {
  refusals: ReadonlyArray<RefusedTelemetry>;
  from: Date | null;
  to: Date | null;
  now: Date;
}): boolean {
  if (!data.from || !data.to) {
    return false;
  }

  return (
    getRefusedTelemetryBetween({
      refusals: data.refusals,
      from: data.from,
      to: data.to,
      now: data.now,
    }).length > 0
  );
}

/*
 * What was refused while a case was open: from its first detection (or,
 * before one, its creation) to its close, or to now while it is open - the
 * detections it could have gathered then may be missing. Nothing for a
 * case with neither date.
 */
export function getRefusedTelemetryWhileCaseOpen(data: {
  refusals: ReadonlyArray<RefusedTelemetry>;
  firstDetectedAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  closedAt?: Date | string | null | undefined;
  now: Date;
}): Array<RefusedTelemetry> {
  const openedAt: Date | string | null | undefined =
    data.firstDetectedAt || data.createdAt;

  if (!openedAt) {
    return [];
  }

  return getRefusedTelemetryBetween({
    refusals: data.refusals,
    from: new Date(openedAt),
    to: data.closedAt ? new Date(data.closedAt) : data.now,
    now: data.now,
  });
}

/*
 * What a source's last scan result kept: every stretch, or only those that
 * overlap a period (a hunt's run, a case) when one is given.
 */
export function readSourceRefusedTelemetry(data: {
  lastScanResult: JSONObject | null | undefined;
  between?: { from: Date; to: Date; now: Date } | undefined;
}): Array<RefusedTelemetry> {
  const refusals: Array<RefusedTelemetry> = readRefusedTelemetryRecord(
    data.lastScanResult,
  ).refusals;

  if (!data.between) {
    return refusals;
  }

  return getRefusedTelemetryBetween({
    refusals,
    from: data.between.from,
    to: data.between.to,
    now: data.between.now,
  });
}
