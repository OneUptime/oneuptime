import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  PlaybookConditions,
  PlaybookTriggerEvent,
  doesPlaybookMatch,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookConditions";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
} from "../../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

const ANY: PlaybookConditions = {
  isEnabled: true,
  trigger: SecurityPlaybookTrigger.CaseOpened,
};

const RULE_ID: string = "3a3c8f8e-6c1b-4a7a-9f0e-0d3b8e8b5c11";
const EMERGENCY_ID: string = "c1000000-0000-4000-8000-0000000000e1";

const PRIORITIES: Array<SecurityCasePriority> = buildDefaultTestPriorities();

function event(
  trigger: SecurityPlaybookTrigger,
  level: SecurityCasePriorityLevel,
  extra: Partial<PlaybookTriggerEvent> = {},
): PlaybookTriggerEvent {
  return {
    trigger,
    priorities: PRIORITIES,
    casePriorityId: TEST_PRIORITY_IDS[level],
    ...extra,
  };
}

describe("doesPlaybookMatch", () => {
  test("runs an enabled playbook on its own trigger only", () => {
    expect(
      doesPlaybookMatch(
        ANY,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.Low,
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        ANY,
        event(
          SecurityPlaybookTrigger.DetectionAdded,
          SecurityCasePriorityLevel.Low,
        ),
      ),
    ).toBe(false);
    expect(
      doesPlaybookMatch(
        { ...ANY, isEnabled: false },
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.Low,
        ),
      ),
    ).toBe(false);
  });

  test("never runs a Manual playbook on its own", () => {
    expect(
      doesPlaybookMatch(
        { ...ANY, trigger: SecurityPlaybookTrigger.Manual },
        event(
          SecurityPlaybookTrigger.Manual,
          SecurityCasePriorityLevel.Critical,
        ),
      ),
    ).toBe(false);
  });

  test("holds the case to the minimum priority", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      minimumPriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
    };

    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.Critical,
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.Medium,
        ),
      ),
    ).toBe(false);
  });

  test("ranks the minimum by the project's order, its own priorities among them", () => {
    // An Emergency the project ranked above Critical.
    const priorities: Array<SecurityCasePriority> = [
      ...buildDefaultTestPriorities().map((priority: SecurityCasePriority) => {
        priority.order = (priority.order || 0) + 1;
        return priority;
      }),
      buildTestPriority({ id: EMERGENCY_ID, name: "Emergency", order: 1 }),
    ];

    const forCritical: PlaybookConditions = {
      ...ANY,
      minimumPriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    };
    const forEmergency: PlaybookConditions = {
      ...ANY,
      minimumPriorityId: EMERGENCY_ID,
    };

    expect(
      doesPlaybookMatch(forCritical, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        priorities,
        casePriorityId: EMERGENCY_ID,
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(forEmergency, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        priorities,
        casePriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      }),
    ).toBe(false);
  });

  test("a minimum the project no longer has holds every case; a case at none meets a minimum", () => {
    expect(
      doesPlaybookMatch(
        { ...ANY, minimumPriorityId: "c1000000-0000-4000-8000-0000000000ff" },
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.Low,
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        {
          ...ANY,
          minimumPriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
        },
        {
          trigger: SecurityPlaybookTrigger.CaseOpened,
          priorities: PRIORITIES,
          casePriorityId: undefined,
        },
      ),
    ).toBe(false);
  });

  test("holds the detection to the source, and a case opened by hand has none", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      detectionSource: SecurityDetectionSource.ThreatIntel,
    };

    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
          { detection: { source: SecurityDetectionSource.ThreatIntel } },
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
          { detection: { source: SecurityDetectionSource.DetectionRule } },
        ),
      ),
    ).toBe(false);
    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
        ),
      ),
    ).toBe(false);
  });

  test("holds the detection to the rules, an empty list meaning any", () => {
    const playbook: PlaybookConditions = {
      ...ANY,
      detectionRuleIds: [RULE_ID],
    };

    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
          {
            detection: {
              source: SecurityDetectionSource.DetectionRule,
              detectionRuleId: RULE_ID,
            },
          },
        ),
      ),
    ).toBe(true);
    expect(
      doesPlaybookMatch(
        playbook,
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
          {
            detection: {
              source: SecurityDetectionSource.DetectionRule,
              detectionRuleId: "another",
            },
          },
        ),
      ),
    ).toBe(false);
    expect(
      doesPlaybookMatch(
        { ...ANY, detectionRuleIds: [] },
        event(
          SecurityPlaybookTrigger.CaseOpened,
          SecurityCasePriorityLevel.High,
        ),
      ),
    ).toBe(true);
  });
});
