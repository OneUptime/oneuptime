import {
  HUNT_RANGE_PAST_RETENTION,
  RULE_FIRST_SEEN_PAST_RETENTION,
  RULE_WINDOW_PAST_RETENTION,
  SETTINGS_LISTED_RULES,
  SETTINGS_RULES_PAST_RETENTION_DESCRIPTION,
} from "./SecurityEventRetentionCopy";
import { DetectionRuleShape } from "../DetectionRuleShape";
import { formatTimespan } from "../Timespan";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import {
  DetectionRulePastRetention,
  SECONDS_IN_A_DAY,
  SecurityEventRetentionStatus,
  doesLookbackReachPastRetention,
  getLongestLookbackInSeconds,
  getRetentionInDaysNeededFor,
} from "Common/Types/SecurityEvent/SecurityEventRetention";
import { getSecurityHuntTimeRangeLengthInMinutes } from "Common/Types/SecurityEvent/SecurityHunt";
import { DetectionRuleType } from "Common/Types/SecurityEvent/SigmaCorrelation";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  TemplateValues,
  Translator,
  composedValue,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What is said where a person looks when something reads further back than
 * the project keeps its security events (#10432), worked out without React
 * so a plain test pins it. Each sentence is a key and the spans of time it
 * names, in seconds; writeRetentionSentence puts it into the reader's
 * words, each span in the sentence's language.
 */

export interface RetentionSentence {
  template: string;
  // {{name}} -> a span of time, in seconds.
  spans: Record<string, number>;
}

// The spans as a sentence's values: each written in the language the sentence comes out in.
export function getRetentionSentenceValues(
  sentence: RetentionSentence,
): TemplateValues {
  const values: TemplateValues = {};

  for (const name of Object.keys(sentence.spans)) {
    const seconds: number = sentence.spans[name]!;

    values[name] = composedValue((inSentence: Translator): string => {
      return formatTimespan(seconds, inSentence);
    });
  }

  return values;
}

// One of these sentences, in the reader's language.
export function writeRetentionSentence(
  translator: Translator,
  sentence: RetentionSentence,
): string {
  return translator.translateTemplate(
    sentence.template,
    getRetentionSentenceValues(sentence),
  );
}

/*
 * Under a rule - the form's YAML as it is typed, a rule of the Rule Library
 * - when it reads further back than security events are kept: what it
 * reads, what is kept, and what to change. Null while either is not known,
 * and for a rule the kept events cover.
 */
export function getRuleRetentionWarning(data: {
  shape: DetectionRuleShape | null;
  retentionInDays: number | null | undefined;
}): RetentionSentence | null {
  if (!data.shape || !data.retentionInDays) {
    return null;
  }

  if (
    !doesLookbackReachPastRetention({
      lookbackInSeconds: data.shape.lookbackInSeconds,
      retentionInDays: data.retentionInDays,
    })
  ) {
    return null;
  }

  return {
    template:
      data.shape.type === DetectionRuleType.NewValue
        ? RULE_FIRST_SEEN_PAST_RETENTION
        : RULE_WINDOW_PAST_RETENTION,
    spans: {
      lookback: data.shape.lookbackInSeconds,
      retention: data.retentionInDays * SECONDS_IN_A_DAY,
      needed:
        getRetentionInDaysNeededFor(data.shape.lookbackInSeconds) *
        SECONDS_IN_A_DAY,
    },
  };
}

/*
 * Under a hunt's time range, when it reaches further back than security
 * events are kept. Null otherwise, or while the retention is not known.
 */
export function getHuntRangeRetentionWarning(data: {
  timeRange: TimeRange | string | null | undefined;
  retentionInDays: number | null | undefined;
}): RetentionSentence | null {
  const minutes: number | null = getSecurityHuntTimeRangeLengthInMinutes(
    data.timeRange,
  );

  if (minutes === null || !data.retentionInDays) {
    return null;
  }

  if (minutes * 60 <= data.retentionInDays * SECONDS_IN_A_DAY) {
    return null;
  }

  return {
    template: HUNT_RANGE_PAST_RETENTION,
    spans: { retention: data.retentionInDays * SECONDS_IN_A_DAY },
  };
}

/*
 * Settings -> Telemetry, when enabled rules look back further than security
 * events are kept: how many, the first few by how far back they read, how
 * many more, and what the retention would have to be. Null when none does,
 * or when the person may not read detection rules.
 */
export interface SettingsRetentionWarning {
  count: number;
  listed: Array<DetectionRulePastRetention>;
  moreCount: number;
  description: RetentionSentence;
}

export function getSettingsRetentionWarning(
  status: SecurityEventRetentionStatus | null,
): SettingsRetentionWarning | null {
  const rules: Array<DetectionRulePastRetention> | null =
    status?.rulesPastRetention || null;

  if (!status || !rules || rules.length === 0) {
    return null;
  }

  const listed: Array<DetectionRulePastRetention> = rules.slice(
    0,
    SETTINGS_LISTED_RULES,
  );

  return {
    count: rules.length,
    listed,
    moreCount: rules.length - listed.length,
    description: {
      template: SETTINGS_RULES_PAST_RETENTION_DESCRIPTION,
      spans: {
        retention: status.retentionInDays * SECONDS_IN_A_DAY,
        needed:
          getRetentionInDaysNeededFor(getLongestLookbackInSeconds(rules)) *
          SECONDS_IN_A_DAY,
      },
    },
  };
}

// Where the retention is changed: Project Settings > Telemetry & APM > Data Retention.
export function getDataRetentionSettingsRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_TELEMETRY_SETTINGS] as Route,
  );
}
