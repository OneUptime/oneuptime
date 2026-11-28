import OneUptimeDate from "../../../Types/Date";
import {
  isTelemetryIngestionQueueRefusalCurrent,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionQueueRefusalKind,
  TelemetryIngestionQueueRefusalStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import { translationKey } from "../../Utils/TranslateTemplate";
import { writeReaderMoment } from "../../Utils/ReaderMoments";
import { getTelemetryUsageSignalTitle } from "../TelemetryUsage/TelemetryUsageWords";

/*
 * WHAT ONEUPTIME REFUSED WHILE IT CAUGHT UP, IN WORDS (issue #11440).
 *
 * When too much of a project's telemetry of one signal is still waiting in
 * the telemetry queue to be stored, or the queue is nearly full for every
 * project, the ingest refuses that signal for a while and tells its
 * senders to retry (TelemetryIngestShedding). The project's members used
 * to see that only in their collectors' logs. Now the status API tells of
 * it (TelemetryIngestionBudgetStatus.queueRefusals), and this is what is
 * said of it: a card on the Usage page (TelemetryQueueRefusalsCard), and
 * the explorers' banner while it goes on. React-free, so a node test reads
 * every sentence in any locale.
 */

export const QUEUE_REFUSALS_CARD_TITLE: string = translationKey(
  "Refused While OneUptime Catches Up",
);
export const QUEUE_REFUSALS_CARD_DESCRIPTION: string = translationKey(
  "Telemetry refused in the past day because too much of it was waiting to be stored, not because of a budget. Senders retry what is refused, so it arrives late, unless a sender gives up first.",
);
// A line whose latest refusal says the signal is still refused.
export const QUEUE_REFUSING_NOW: string = translationKey("Refusing now");

/*
 * Why, as a sentence: the same words the RUM setup check and an ingestion
 * key's page say it in (the Dashboard's IngestRefusalWords), so each is
 * one translation.
 */
export const QUEUE_REFUSAL_REASON_WORDS: Readonly<
  Record<TelemetryIngestionQueueRefusalKind, string>
> = {
  [TelemetryIngestionBudgetRefusalKind.QueueBacklogged]: translationKey(
    "OneUptime is still storing what this project already sent, so it refuses more for now.",
  ),
  [TelemetryIngestionBudgetRefusalKind.QueueFull]: translationKey(
    "OneUptime's telemetry queue is nearly full, so it refuses telemetry from every project for now.",
  ),
};

/*
 * How many, and over what span: the same words as an ingestion key's own
 * Refused Telemetry card (IngestRefusalWords), one translation for both. A
 * single refusal has no span, so it is a sentence of its own.
 */
export const QUEUE_ONE_REQUEST_REFUSED: string = translationKey(
  "One request refused {{time}}.",
);
export const QUEUE_REFUSED_COUNT_WORDS: PluralTemplate = {
  one: "{{count}} request refused since {{date}}, the latest {{time}}.",
  other: "{{count}} requests refused since {{date}}, the latest {{time}}.",
};

/*
 * The explorers' banner (TelemetryIngestionBudgetBanner), while the
 * explorer's signal is refused still: the moment someone wonders why new
 * data stopped arriving, or arrives late.
 */
export const QUEUE_BACKLOGGED_NOTICE: string = translationKey(
  "{{signal}}: OneUptime is still storing the data this project already sent, so it is refusing new data for now. Senders retry what is refused, so it arrives late, unless a sender gives up first.",
);
export const QUEUE_FULL_NOTICE: string = translationKey(
  "{{signal}}: OneUptime's telemetry queue is nearly full, so it is refusing new data from every project for now. Senders retry what is refused, so it arrives late, unless a sender gives up first.",
);
export const SEE_WHAT_WAS_REFUSED: string = translationKey(
  "See what was refused",
);

const QUEUE_NOTICES: Readonly<
  Record<TelemetryIngestionQueueRefusalKind, string>
> = {
  [TelemetryIngestionBudgetRefusalKind.QueueBacklogged]:
    QUEUE_BACKLOGGED_NOTICE,
  [TelemetryIngestionBudgetRefusalKind.QueueFull]: QUEUE_FULL_NOTICE,
};

// One line of the Usage page's card: a signal, and what was refused of it.
export interface TelemetryQueueRefusalLine {
  // Unique among the lines: its signal and kind.
  id: string;
  signalTitle: string;
  reasonText: string;
  countText: string;
  // Whether the signal is refused still (isTelemetryIngestionQueueRefusalCurrent).
  isCurrent: boolean;
}

// "4,210 requests refused since Nov 28, 2026, 9:02 AM, the latest 3 minutes ago."
export function getTelemetryQueueRefusalCountText(
  refusal: TelemetryIngestionQueueRefusalStatus,
  translator: Translator,
  now: Date,
): string {
  const lastRefusedAt: Date = new Date(refusal.lastRefusedAt);

  if (refusal.refusedRequests <= 1) {
    return translator.translateTemplate(QUEUE_ONE_REQUEST_REFUSED, {
      time: OneUptimeDate.fromNow(lastRefusedAt, now),
    });
  }

  return translator.translatePlural(
    QUEUE_REFUSED_COUNT_WORDS,
    refusal.refusedRequests,
    {
      date: writeReaderMoment(new Date(refusal.firstRefusedAt)),
      time: OneUptimeDate.fromNow(lastRefusedAt, now),
    },
  );
}

// The card's lines, the latest refusal first, as the status lists them.
export function getTelemetryQueueRefusalLines(data: {
  refusals: ReadonlyArray<TelemetryIngestionQueueRefusalStatus>;
  translator: Translator;
  now: Date;
}): Array<TelemetryQueueRefusalLine> {
  return data.refusals.map(
    (
      refusal: TelemetryIngestionQueueRefusalStatus,
    ): TelemetryQueueRefusalLine => {
      return {
        id: `${refusal.signal}:${refusal.kind}`,
        signalTitle: getTelemetryUsageSignalTitle(
          refusal.signal,
          data.translator,
        ),
        reasonText:
          data.translator.translateText(
            QUEUE_REFUSAL_REASON_WORDS[refusal.kind],
          ) || QUEUE_REFUSAL_REASON_WORDS[refusal.kind],
        countText: getTelemetryQueueRefusalCountText(
          refusal,
          data.translator,
          data.now,
        ),
        isCurrent: isTelemetryIngestionQueueRefusalCurrent({
          refusal: refusal,
          now: data.now,
        }),
      };
    },
  );
}

/*
 * What the explorers' banner says of a signal the queue refuses still, or
 * null: the latest such refusal of the signal (the status lists the latest
 * first), in the banner's words.
 */
export function getTelemetryQueueRefusalNoticeText(data: {
  refusals: ReadonlyArray<TelemetryIngestionQueueRefusalStatus>;
  signal: TelemetryIngestionBudgetSignal;
  translator: Translator;
  now: Date;
}): string | null {
  const refusal: TelemetryIngestionQueueRefusalStatus | undefined =
    data.refusals.find(
      (candidate: TelemetryIngestionQueueRefusalStatus): boolean => {
        return (
          candidate.signal === data.signal &&
          isTelemetryIngestionQueueRefusalCurrent({
            refusal: candidate,
            now: data.now,
          })
        );
      },
    );

  if (!refusal) {
    return null;
  }

  return data.translator.translateTemplate(QUEUE_NOTICES[refusal.kind], {
    signal: getTelemetryUsageSignalTitle(data.signal, data.translator),
  });
}
