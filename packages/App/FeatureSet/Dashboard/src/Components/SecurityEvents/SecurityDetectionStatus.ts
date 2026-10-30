import Color from "Common/Types/Color";
import { Green, LightGray, Red, Yellow } from "Common/Types/BrandColors";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { isDetectionRunNotice } from "Common/Utils/SecurityEvent/DetectionOverflow";

/*
 * WHETHER A THREAT INTEL FEED OR A DETECTION RULE IS WORKING, IN ITS STATUS.
 *
 * Both tables showed Enabled in green for anything switched on. A feed whose
 * every poll and every match failed (issue #5157: ClickHouse refused each
 * query) read Enabled, its error a long sentence in a column past the edge
 * of the card, so nothing on screen said that it brought in nothing. The
 * Status pill says it now: a failure in red, a run's note about its own work
 * in yellow, a new feed or rule waiting for its first poll or run in grey,
 * and Enabled in green only when the last poll and check came back clean.
 * The full message is a click away (View Error, SecurityDetectionErrorModal).
 *
 * React-free on purpose: App's tests read this without the pages.
 */

export interface SecurityDetectionStatus {
  // The pill's words, in English: the pill looks them up as it draws them.
  text: string;
  color: Color;
  tooltip?: string | undefined;
}

// A message the table can show in full, under the column it is stored in.
export interface SecurityDetectionMessage {
  label: string;
  message: string;
  // A run's note about its own work, not a failure (isDetectionRunNotice).
  isNotice: boolean;
}

export interface ThreatIntelFeedStatusFields {
  isEnabled?: boolean | undefined;
  lastPolledAt?: Date | undefined;
  lastError?: string | undefined;
  lastMatchError?: string | undefined;
}

export interface DetectionRuleStatusFields {
  isEnabled?: boolean | undefined;
  lastEvaluatedAt?: Date | undefined;
  lastError?: string | undefined;
  // Checks each event as it arrives: it has no run to wait for.
  isRealTime?: boolean | undefined;
}

export const SECURITY_DETECTION_ENABLED: SecurityDetectionStatus = {
  text: translationKey("Enabled"),
  color: Green,
};

export const SECURITY_DETECTION_DISABLED: SecurityDetectionStatus = {
  text: translationKey("Disabled"),
  color: Red,
};

export const THREAT_INTEL_FEED_POLL_FAILED: SecurityDetectionStatus = {
  text: translationKey("Poll failed"),
  color: Red,
  tooltip: translationKey(
    "The last poll failed. Open View Error for the full message.",
  ),
};

export const THREAT_INTEL_FEED_MATCHING_FAILED: SecurityDetectionStatus = {
  text: translationKey("Matching failed"),
  color: Red,
  tooltip: translationKey(
    "The last check against your security events failed. Open View Error for the full message.",
  ),
};

export const THREAT_INTEL_FEED_NEEDS_ATTENTION: SecurityDetectionStatus = {
  text: translationKey("Needs attention"),
  color: Yellow,
  tooltip: translationKey(
    "The last check left a message. Open View Error to read it.",
  ),
};

export const THREAT_INTEL_FEED_WAITING: SecurityDetectionStatus = {
  text: translationKey("Waiting for first poll"),
  color: LightGray,
  tooltip: translationKey("A new feed is polled within a minute."),
};

export const DETECTION_RULE_RUN_FAILED: SecurityDetectionStatus = {
  text: translationKey("Run failed"),
  color: Red,
  tooltip: translationKey(
    "The last run failed. Open View Error for the full message.",
  ),
};

export const DETECTION_RULE_NEEDS_ATTENTION: SecurityDetectionStatus = {
  text: translationKey("Needs attention"),
  color: Yellow,
  tooltip: translationKey(
    "The last run left a message. Open View Error to read it.",
  ),
};

export const DETECTION_RULE_WAITING: SecurityDetectionStatus = {
  text: translationKey("Waiting for first run"),
  color: LightGray,
  tooltip: translationKey("A new rule runs within a minute."),
};

/*
 * A real-time rule (Types/SecurityEvent/RealTimeDetection) runs on no
 * interval: it is never waiting for a run, so working is what it says.
 */
export const DETECTION_RULE_REAL_TIME: SecurityDetectionStatus = {
  text: translationKey("Real time"),
  color: Green,
  tooltip: translationKey(
    "Checks each event as it arrives, within seconds, instead of every interval.",
  ),
};

/*
 * The columns the messages live in, titled as the tables title them: the
 * dialog that shows a message in full names it the same way.
 */
export const LAST_ERROR_LABEL: string = translationKey("Last Error");
export const LAST_MATCH_ERROR_LABEL: string =
  translationKey("Last Match Error");

function hasText(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

/*
 * A feed: switched off, then its polling (a poll that failed), then its
 * matching (a check that failed, or one that left a note about its work),
 * then whether it has been polled at all.
 */
export function getThreatIntelFeedStatus(
  feed: ThreatIntelFeedStatusFields,
): SecurityDetectionStatus {
  if (!feed.isEnabled) {
    return SECURITY_DETECTION_DISABLED;
  }

  if (hasText(feed.lastError)) {
    return THREAT_INTEL_FEED_POLL_FAILED;
  }

  if (hasText(feed.lastMatchError)) {
    return isDetectionRunNotice(feed.lastMatchError)
      ? THREAT_INTEL_FEED_NEEDS_ATTENTION
      : THREAT_INTEL_FEED_MATCHING_FAILED;
  }

  if (!feed.lastPolledAt) {
    return THREAT_INTEL_FEED_WAITING;
  }

  return SECURITY_DETECTION_ENABLED;
}

/*
 * A rule: switched off, then its last run (one that failed, or one that left
 * a note about its work), then whether it has run at all.
 */
export function getDetectionRuleStatus(
  rule: DetectionRuleStatusFields,
): SecurityDetectionStatus {
  if (!rule.isEnabled) {
    return SECURITY_DETECTION_DISABLED;
  }

  if (hasText(rule.lastError)) {
    return isDetectionRunNotice(rule.lastError)
      ? DETECTION_RULE_NEEDS_ATTENTION
      : DETECTION_RULE_RUN_FAILED;
  }

  if (rule.isRealTime) {
    return DETECTION_RULE_REAL_TIME;
  }

  if (!rule.lastEvaluatedAt) {
    return DETECTION_RULE_WAITING;
  }

  return SECURITY_DETECTION_ENABLED;
}

// What View Error shows for a feed: its polling's message, then its matching's.
export function getThreatIntelFeedMessages(
  feed: ThreatIntelFeedStatusFields,
): Array<SecurityDetectionMessage> {
  const messages: Array<SecurityDetectionMessage> = [];

  // The poller writes only failures here; a successful poll clears it.
  if (hasText(feed.lastError)) {
    messages.push({
      label: LAST_ERROR_LABEL,
      message: feed.lastError,
      isNotice: false,
    });
  }

  if (hasText(feed.lastMatchError)) {
    messages.push({
      label: LAST_MATCH_ERROR_LABEL,
      message: feed.lastMatchError,
      isNotice: isDetectionRunNotice(feed.lastMatchError),
    });
  }

  return messages;
}

// What View Error shows for a rule: its last run's message.
export function getDetectionRuleMessages(
  rule: DetectionRuleStatusFields,
): Array<SecurityDetectionMessage> {
  if (!hasText(rule.lastError)) {
    return [];
  }

  return [
    {
      label: LAST_ERROR_LABEL,
      message: rule.lastError,
      isNotice: isDetectionRunNotice(rule.lastError),
    },
  ];
}
