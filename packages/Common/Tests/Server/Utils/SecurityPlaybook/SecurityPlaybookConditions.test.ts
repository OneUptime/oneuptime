import SecurityCasePriority from "../../../../Types/SecurityCase/SecurityCasePriority";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  PlaybookConditions,
  doesPlaybookMatch,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookConditions";
import { describe, expect, test } from "@jest/globals";

const ANY: PlaybookConditions = {
  isEnabled: true,
  trigger: SecurityPlaybookTrigger.CaseOpened,
};

const RULE_ID: string = "3a3c8f8e-6c1b-4a7a-9f0e-0d3b8e8b5c11";

describe("doesPlaybookMatch", () => {
  test("runs an enabled playbook on its own trigger only", () => {
    expect(
      doesPlaybookMatch(ANY, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.Low,
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(ANY, {
        trigger: SecurityPlaybookTrigger.DetectionAdded,
        casePriority: SecurityCasePriority.Low,
      }),
    ).toBe(false);
    expect(
      doesPlaybookMatch(
        { ...ANY, isEnabled: false },
        {
          trigger: SecurityPlaybookTrigger.CaseOpened,
          casePriority: SecurityCasePriority.Low,
        },
      ),
    ).toBe(false);
  });

  test("never runs a Manual playbook on its own", () => {
    expect(
      doesPlaybookMatch(
        { ...ANY, trigger: SecurityPlaybookTrigger.Manual },
        {
          trigger: SecurityPlaybookTrigger.Manual,
          casePriority: SecurityCasePriority.Critical,
        },
      ),
    ).toBe(false);
  });

  test("holds the case to the minimum priority", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      minimumPriority: SecurityCasePriority.High,
    };

    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.Critical,
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.Medium,
      }),
    ).toBe(false);
  });

  test("holds the detection to the source, and a case opened by hand has none", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      detectionSource: SecurityDetectionSource.ThreatIntel,
    };

    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.High,
        detection: { source: SecurityDetectionSource.ThreatIntel },
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.High,
        detection: { source: SecurityDetectionSource.DetectionRule },
      }),
    ).toBe(false);
    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.High,
      }),
    ).toBe(false);
  });

  test("holds the detection to the rules, an empty list meaning any", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      detectionRuleIds: [RULE_ID],
    };

    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.High,
        detection: {
          source: SecurityDetectionSource.DetectionRule,
          detectionRuleId: RULE_ID,
        },
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(playbook, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        casePriority: SecurityCasePriority.High,
        detection: {
          source: SecurityDetectionSource.DetectionRule,
          detectionRuleId: "another",
        },
      }),
    ).toBe(false);
    expect(
      doesPlaybookMatch(
        { ...ANY, detectionRuleIds: [] },
        {
          trigger: SecurityPlaybookTrigger.CaseOpened,
          casePriority: SecurityCasePriority.High,
        },
      ),
    ).toBe(true);
  });
});
