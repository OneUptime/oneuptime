import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepSecurityEventsMonitorUtil } from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_RULE_ID_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import { THREAT_FEED_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/ThreatIntelConstants";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";

/*
 * Initial values for the monitor create page when it is reached from a
 * detection rule's "Create Monitor" action: a Security Events monitor
 * scoped to the Detection Finding rows that rule writes.
 *
 * A pure function rather than logic inline in Create.tsx, because what it
 * builds is a contract with three other parties — the step form (which
 * renders these values), the evaluator (whose finding rows must match the
 * class and attribute filters), and MonitorSteps.fromJSON (which throws on
 * any envelope other than toJSON()'s) — and a pure function is the only
 * shape all of that can be pinned by tests without mounting the page.
 */

/*
 * One hour, not the type's 60-second default. Findings arrive on the
 * rule's evaluation cadence — minutes apart, in bursts — so a 60s window
 * would read zero between evaluations and flap the monitor. An hour
 * smooths the cadence while staying inside the step form's preset options.
 */
export const DETECTION_FINDING_MONITOR_WINDOW_SECONDS: number = 3600;

export function buildDetectionRuleMonitorPrefill(data: {
  ruleId: string;
  ruleName: string;
  operationalStatusId: ObjectID | null;
}): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  const monitorStep: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (monitorStep?.data) {
    /*
     * Spread the util's default first: plain `new MonitorStep()` leaves
     * securityEventsMonitor undefined (only the server-side factory seeds
     * it per type), and the spread keeps every key the step form expects
     * present when we override the three that scope to this rule.
     */
    monitorStep.data.securityEventsMonitor = {
      ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
      classNames: [DETECTION_FINDING_CLASS_NAME],
      /*
       * Filter on the rule's ID, never its NAME: findings carry both, but
       * the evaluator stamps the rule's CURRENT name on every finding
       * while a monitor's stored filter is frozen at creation — one
       * rename and a name-filtered monitor counts zero forever while
       * looking perfectly configured. The id is immutable.
       */
      attributes: {
        [DETECTION_RULE_ID_ATTRIBUTE]: data.ruleId,
      },
      lastXSecondsOfEvents: DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
    };
  }

  /*
   * A pre-seeded MonitorSteps must carry defaultMonitorStatusId itself:
   * the MonitorSteps form only auto-fills the operational status when it
   * bootstraps WITHOUT an initial value. Skipping this leaves the
   * criteria step failing validation with "Default Monitor Status is
   * required". Null is the caller saying the status fetch failed — the
   * user can still pick it in the form, so the prefill degrades rather
   * than dying.
   */
  if (data.operationalStatusId) {
    monitorSteps.setDefaultMonitorStatusId(data.operationalStatusId);
  }

  return {
    name: `${data.ruleName} — detection findings`,
    description: `Watches Detection Finding events written by the "${data.ruleName}" detection rule. Fires on the rate of detections, not just their occurrence.`,
    monitorType: MonitorType.SecurityEvents,
    monitorSteps: monitorSteps.toJSON(),
  };
}

/*
 * The threat-intel twin: initial values for the monitor create page when
 * reached from a threat intel feed's "Create Monitor" action — a Security
 * Events monitor scoped to the Threat Intel finding rows the matcher
 * writes for that feed. Same contract-and-pure-function rationale as the
 * detection-rule prefill above, and the same one-hour window (findings
 * arrive on the matcher's cadence, in bursts).
 */
export function buildThreatIntelFeedMonitorPrefill(data: {
  feedId: string;
  feedName: string;
  operationalStatusId: ObjectID | null;
}): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  const monitorStep: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (monitorStep?.data) {
    monitorStep.data.securityEventsMonitor = {
      ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
      classNames: [DETECTION_FINDING_CLASS_NAME],
      /*
       * Filter on the feed's ID, never its NAME — the detection-rule
       * prefill's rename rationale applies verbatim: findings carry the
       * feed's current name while a stored filter is frozen at creation.
       */
      attributes: {
        [THREAT_FEED_ID_ATTRIBUTE]: data.feedId,
      },
      lastXSecondsOfEvents: DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
    };
  }

  if (data.operationalStatusId) {
    monitorSteps.setDefaultMonitorStatusId(data.operationalStatusId);
  }

  return {
    name: `${data.feedName} — threat intel matches`,
    description: `Watches Threat Intel finding events written for the "${data.feedName}" feed. Fires on the rate of indicator matches, not just their occurrence.`,
    monitorType: MonitorType.SecurityEvents,
    monitorSteps: monitorSteps.toJSON(),
  };
}
