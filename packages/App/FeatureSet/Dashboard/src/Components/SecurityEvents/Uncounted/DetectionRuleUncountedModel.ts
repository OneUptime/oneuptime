import {
  RetrohuntSentence,
  RetrohuntUncounted,
  getRetrohuntUncounted,
} from "../Retrohunt/RetrohuntModel";
import {
  UNCOUNTED_NOTHING_CANT_FIRE,
  UNCOUNTED_ROW_LINE,
  UNCOUNTED_ROW_LINE_NOTHING,
  UNCOUNTED_WHY,
} from "./DetectionRuleUncountedCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DETECTION_RULE_UNCOUNTED_PATH,
  DetectionRuleUncounted,
  DetectionRulesUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
  didRuleCountNothing,
  readDetectionRulesUncounted,
} from "Common/Types/SecurityEvent/DetectionRuleUncounted";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { ScrubbedAddressSignal } from "Common/Utils/SecurityEvent/ScrubbedAddress";

/*
 * WHAT A DETECTION RULE COULD NOT COUNT, AS ITS ROW SAYS IT (#10547).
 * React-free: the page draws what these decide, and a plain test holds the
 * words to the counts.
 *
 *   - the line under the rule's name (getUncountedRowLine): how many of the
 *     last day's matches it could not count - or, when that is all of them,
 *     that it could count none;
 *   - the dialog that line opens (getUncountedDetail): Run on Past Events'
 *     own sentences for them (getRetrohuntUncounted) - "1,204 matching
 *     events had no IP address, so this rule couldn't count them." and how
 *     many a scrub rule hid, with where to find that rule - then, for a rule
 *     that counted none, that it cannot fire, and why such events are left
 *     out.
 */

export interface UncountedRowLine {
  template: { one: string; other: string };
  count: number;
  // It could count none of what it matched: the line reads as a warning.
  countsNothing: boolean;
}

export function getUncountedRowLine(
  uncounted: DetectionRuleUncounted,
): UncountedRowLine {
  const countsNothing: boolean = didRuleCountNothing(uncounted);

  return {
    template: countsNothing ? UNCOUNTED_ROW_LINE_NOTHING : UNCOUNTED_ROW_LINE,
    count: countsNothing ? uncounted.matchedCount : uncounted.uncountedCount,
    countsNothing,
  };
}

export interface UncountedDetail {
  lines: Array<RetrohuntSentence>;
  // Where the scrub rule that hid them is: the logs' or the traces' rules.
  scrubRulesSignal: ScrubbedAddressSignal | null;
  // Said after the lines: that it cannot fire (if so), then why.
  afterLines: Array<string>;
}

export function getUncountedDetail(
  uncounted: DetectionRuleUncounted,
): UncountedDetail {
  const said: RetrohuntUncounted | null = getRetrohuntUncounted({
    uncounted: {
      field: uncounted.field,
      eventCount: uncounted.uncountedCount,
      hiddenInLogsCount: uncounted.hiddenInLogsCount,
      hiddenInTracesCount: uncounted.hiddenInTracesCount,
    },
  });

  return {
    lines: said?.lines || [],
    scrubRulesSignal: said?.scrubRulesSignal || null,
    afterLines: [
      ...(didRuleCountNothing(uncounted) ? [UNCOUNTED_NOTHING_CANT_FIRE] : []),
      UNCOUNTED_WHY,
    ],
  };
}

/*
 * What the rules a page lists could not count in the last day, by rule id:
 * at most a page of ids asked at once, each id once.
 */
export async function fetchDetectionRulesUncounted(
  detectionRuleIds: ReadonlyArray<string>,
): Promise<Map<string, DetectionRuleUncounted>> {
  const ids: Array<string> = Array.from(new Set(detectionRuleIds)).slice(
    0,
    MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
  );
  const byRule: Map<string, DetectionRuleUncounted> = new Map();

  if (ids.length === 0) {
    return byRule;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(DETECTION_RULE_UNCOUNTED_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: { detectionRuleIds: ids },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const answer: DetectionRulesUncounted = readDetectionRulesUncounted(
    response.data,
  );

  for (const rule of answer.rules) {
    byRule.set(rule.detectionRuleId, rule);
  }

  return byRule;
}
