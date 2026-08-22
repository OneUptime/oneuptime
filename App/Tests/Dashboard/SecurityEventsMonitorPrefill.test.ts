import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import {
  DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
  buildDetectionRuleMonitorPrefill,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsMonitorPrefill";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";

/*
 * buildDetectionRuleMonitorPrefill is a contract with three other parties,
 * none of which can fail loudly if it drifts:
 *
 *  - MonitorSteps.fromJSON throws on any envelope other than toJSON()'s —
 *    but only at page mount, in the browser;
 *  - the step form renders whatever securityEventsMonitor object it is
 *    given, and a missing key renders as an empty control, not an error;
 *  - the evaluator's Detection Finding rows must MATCH the class name and
 *    attribute key this prefill filters on, or the created monitor
 *    counts zero forever while looking perfectly configured.
 *
 * The last one is the silent killer, which is why the class/attribute
 * literals are pinned here against their exact string values: renaming
 * the shared constant would keep util and evaluator consistent with each
 * other while orphaning every monitor already stored with the old strings.
 */

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
);
const RULE_ID: string = "12121212-3434-4545-8567-787878787878";

function stepConfigOf(prefill: JSONObject): MonitorStepSecurityEventsMonitor {
  const steps: MonitorSteps = MonitorSteps.fromJSON(
    prefill["monitorSteps"] as JSONObject,
  );
  const step: MonitorStep | undefined =
    steps.data?.monitorStepsInstanceArray[0];

  expect(step?.data?.securityEventsMonitor).toBeDefined();

  return step!.data!.securityEventsMonitor!;
}

describe("buildDetectionRuleMonitorPrefill", () => {
  const prefill: JSONObject = buildDetectionRuleMonitorPrefill({
    ruleId: RULE_ID,
    ruleName: "Suspicious PowerShell",
    operationalStatusId: OPERATIONAL_STATUS_ID,
  });

  test("selects the Security Events monitor type", () => {
    expect(prefill["monitorType"]).toBe(MonitorType.SecurityEvents);
  });

  test("names the monitor after the rule", () => {
    expect(prefill["name"]).toBe("Suspicious PowerShell — detection findings");
    expect(String(prefill["description"])).toContain("Suspicious PowerShell");
  });

  test("serializes monitorSteps in the envelope fromJSON accepts", () => {
    const envelope: JSONObject = prefill["monitorSteps"] as JSONObject;

    expect(envelope["_type"]).toBe("MonitorSteps");
    // The real gate: fromJSON throws on any other shape.
    expect(() => {
      return MonitorSteps.fromJSON(envelope);
    }).not.toThrow();
  });

  test("scopes the step to Detection Finding events from this rule", () => {
    const config: MonitorStepSecurityEventsMonitor = stepConfigOf(prefill);

    expect(config.classNames).toEqual([DETECTION_FINDING_CLASS_NAME]);
    expect(config.attributes).toEqual({
      [DETECTION_RULE_ID_ATTRIBUTE]: RULE_ID,
    });
  });

  test("filters on the immutable rule ID, never the renameable name", () => {
    /*
     * Findings are stamped with the rule's CURRENT name on every
     * evaluation, but a monitor's stored filter is frozen at creation.
     * A name filter goes silently blind on the first rename; the id
     * cannot change. This is the review finding that moved the filter.
     */
    const config: MonitorStepSecurityEventsMonitor = stepConfigOf(prefill);

    expect(Object.keys(config.attributes)).toEqual([
      DETECTION_RULE_ID_ATTRIBUTE,
    ]);
    expect(Object.keys(config.attributes)).not.toContain(
      DETECTION_RULE_NAME_ATTRIBUTE,
    );
  });

  test("widens the window from the 60s default to the detection cadence", () => {
    const config: MonitorStepSecurityEventsMonitor = stepConfigOf(prefill);

    expect(config.lastXSecondsOfEvents).toBe(
      DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
    );
    expect(DETECTION_FINDING_MONITOR_WINDOW_SECONDS).toBe(3600);
  });

  test("the window is one of the step form's preset options", () => {
    /*
     * The form renders lastXSecondsOfEvents as a fixed-options dropdown.
     * A prefilled value outside the presets renders as an EMPTY dropdown,
     * silently discarding the value on the first save.
     */
    const formSource: string = fs.readFileSync(
      nodePath.join(
        __dirname,
        "../../FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
      ),
      "utf8",
    );

    expect(formSource).toContain(
      `value: ${DETECTION_FINDING_MONITOR_WINDOW_SECONDS}`,
    );
  });

  test("keeps every key of the step type's default present", () => {
    const config: MonitorStepSecurityEventsMonitor = stepConfigOf(prefill);
    const defaults: MonitorStepSecurityEventsMonitor =
      MonitorStepSecurityEventsMonitorUtil.getDefault();

    for (const key of Object.keys(defaults)) {
      expect(Object.keys(config)).toContain(key);
    }

    expect(config.messageContains).toBe("");
    expect(config.severityNames).toEqual([]);
    expect(config.telemetryServiceIds).toEqual([]);
  });

  test("carries the operational status as the steps' default", () => {
    const steps: MonitorSteps = MonitorSteps.fromJSON(
      prefill["monitorSteps"] as JSONObject,
    );

    expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
  });

  test("degrades to no default status when the fetch failed", () => {
    const withoutStatus: JSONObject = buildDetectionRuleMonitorPrefill({
      ruleId: RULE_ID,
      ruleName: "Suspicious PowerShell",
      operationalStatusId: null,
    });

    const steps: MonitorSteps = MonitorSteps.fromJSON(
      withoutStatus["monitorSteps"] as JSONObject,
    );

    expect(steps.data?.defaultMonitorStatusId).toBeFalsy();
  });

  /*
   * The stored-data pins. The shared constants keep the UI and the
   * evaluator consistent with EACH OTHER; these keep them consistent with
   * every finding row and monitor already written with today's strings.
   */
  test("the wire literals never change", () => {
    expect(DETECTION_FINDING_CLASS_NAME).toBe("Detection Finding");
    expect(DETECTION_RULE_ID_ATTRIBUTE).toBe("oneuptime.detection.rule_id");
    expect(DETECTION_RULE_NAME_ATTRIBUTE).toBe("oneuptime.detection.rule_name");
  });
});
