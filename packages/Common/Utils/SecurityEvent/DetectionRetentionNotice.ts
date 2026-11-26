import {
  DetectionRuleDefinition,
  SigmaCorrelationType,
} from "../../Types/SecurityEvent/SigmaCorrelation";
import {
  SECONDS_IN_A_DAY,
  doesLookbackReachPastRetention,
  getDetectionRuleLookbackInSeconds,
  getRetentionInDaysNeededFor,
} from "../../Types/SecurityEvent/SecurityEventRetention";
import { describeSigmaTimespan } from "./Sigma/SigmaRuleSetParser";

/*
 * The note a rule's run leaves when the rule reads further back than the
 * project keeps security events (#10432): its Last Error, which its row's
 * Status shows as Needs attention and View Error says in full. It opens as
 * every note a run leaves about its own work does ("This run ",
 * isDetectionRunNotice), so it is never read as a failure, and it is there
 * for as long as the rule and the retention disagree - the first run after
 * either changes clears it.
 *
 * A First seen rule tells a value is new by the history that is kept, so a
 * value last seen before then reads as new; a count or a sequence counts
 * only what is kept. Either way it says what to change: keep the events
 * longer, or shorten the rule's timespan.
 */
export const DATA_RETENTION_PLACE: string =
  "Project Settings > Telemetry & APM > Data Retention";

export function describeDetectionRetentionNotice(data: {
  definition: DetectionRuleDefinition;
  retentionInDays: number;
}): string | null {
  const lookbackInSeconds: number = getDetectionRuleLookbackInSeconds(
    data.definition,
  );

  if (
    !doesLookbackReachPastRetention({
      lookbackInSeconds,
      retentionInDays: data.retentionInDays,
    })
  ) {
    return null;
  }

  const kept: string = describeSigmaTimespan(
    data.retentionInDays * SECONDS_IN_A_DAY,
  );
  const lookback: string = describeSigmaTimespan(lookbackInSeconds);
  const needed: string = describeSigmaTimespan(
    getRetentionInDaysNeededFor(lookbackInSeconds) * SECONDS_IN_A_DAY,
  );

  const isFirstSeen: boolean =
    data.definition.kind === "correlation" &&
    data.definition.correlation.type === SigmaCorrelationType.NewValue;

  if (isFirstSeen) {
    return `This run looked back ${kept}, not the ${lookback} this rule asks for: security events are kept for ${kept}, so a value last seen before then reads as new. Keep them for at least ${needed} under ${DATA_RETENTION_PLACE}, or shorten the rule's timespan to ${kept}.`;
  }

  return `This run read ${kept} of events, not the ${lookback} this rule's window needs: security events are kept for ${kept}, so it counts only those. Keep them for at least ${needed} under ${DATA_RETENTION_PLACE}, or shorten the rule's timespan.`;
}

// Notes a run leaves about its own work, in one Last Error: each a sentence of its own.
export function joinDetectionRunNotices(
  notices: Array<string | null | undefined>,
): string | null {
  const present: Array<string> = notices.filter(
    (notice: string | null | undefined): notice is string => {
      return Boolean(notice && notice.trim());
    },
  );

  return present.length > 0 ? present.join(" ") : null;
}
