import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import ScrubAction from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import { JSONArray } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  ONEUPTIME_PRINCIPAL,
  getWorkflowPrincipal,
} from "../../../../Types/SecurityEvent/OneUptimeActorPrincipal";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PLAYBOOK NEVER OFFERS TO SUSPEND A PLACEHOLDER, OR A WORKFLOW (#10435,
 * #10430).
 *
 * A rule grouped on the principal user made its group value the case's
 * user, and a playbook's Okta step offered it as the user to suspend. Once
 * a scrub rule hid user ids, that was "[REDACTED]" - everybody a rule hid at
 * once - or a mask several people share, or a Hash token no identity
 * provider knows; and once workflows had principals of their own, a
 * "workflow:<id>" or OneUptime itself. None is an account. The target rule
 * leaves them all out - from what it is given now, from what a case stored
 * before this holds, and from what a step that waited for approval since
 * then was handed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444445");
const WORKFLOW_ID: string = "0192f1a0-0000-7000-8000-00000000d001";

const REAL_USER: SecurityEntity = {
  type: SecurityEntityType.User,
  value: "mallory@acme.com",
};

// What each of a scrub rule's actions leaves of a user's email, as ingest runs it.
function scrubbed(action: LogScrubAction): string {
  return ScrubAction.apply({
    match: "mallory@acme.com",
    action,
    patternType: LogScrubPatternType.Email,
    projectId: PROJECT_ID,
  });
}

const PLACEHOLDERS: Array<string> = [
  scrubbed(LogScrubAction.Redact),
  scrubbed(LogScrubAction.Mask),
  scrubbed(LogScrubAction.Hash),
  `[HASHED:${"ab12".repeat(2)}]`,
  "auth0|[REDACTED]",
];

const OWN_ACTORS: Array<string> = [
  getWorkflowPrincipal(WORKFLOW_ID),
  ONEUPTIME_PRINCIPAL,
];

function asUser(value: string): SecurityEntity {
  return { type: SecurityEntityType.User, value };
}

function proposedValues(targets: Array<SecurityPlaybookTarget>): Array<string> {
  return targets
    .filter((target: SecurityPlaybookTarget): boolean => {
      return target.state === SecurityPlaybookTargetState.Proposed;
    })
    .map((target: SecurityPlaybookTarget): string => {
      return target.value;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the target rule leaves out what is no account", () => {
  test.each([...PLACEHOLDERS, ...OWN_ACTORS])(
    "grouped on %s, a user step has nothing to suspend",
    (value: string) => {
      const targets: Array<SecurityPlaybookTarget> =
        SecurityPlaybookTargets.chooseTargets({
          entityType: SecurityEntityType.User,
          groupedOn: [asUser(value)],
          caseEntities: [asUser(value)],
          // Even when threat intel names it.
          threatIntelValues: new Set<string>([value.toLowerCase()]),
          protectedRules: [],
        });

      expect(targets).toEqual([]);
    },
  );

  test("a real user grouped on beside them is still offered, alone", () => {
    const targets: Array<SecurityPlaybookTarget> =
      SecurityPlaybookTargets.chooseTargets({
        entityType: SecurityEntityType.User,
        groupedOn: [...PLACEHOLDERS, ...OWN_ACTORS]
          .map(asUser)
          .concat(REAL_USER),
        caseEntities: [REAL_USER],
        threatIntelValues: new Set<string>(),
        protectedRules: [],
      });

    expect(targets).toEqual([
      {
        type: SecurityEntityType.User,
        value: "mallory@acme.com",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      },
    ]);
  });

  test("a step that waited for approval since before this rule never acts on one it was handed", () => {
    const handed: Array<SecurityPlaybookTarget> = [
      ...PLACEHOLDERS,
      ...OWN_ACTORS,
      REAL_USER.value,
    ].map((value: string): SecurityPlaybookTarget => {
      return {
        type: SecurityEntityType.User,
        value,
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      };
    });
    const decided: SecurityPlaybookTarget = {
      type: SecurityEntityType.User,
      value: "[REDACTED]",
      reason: SecurityPlaybookTargetReason.GroupedOn,
      state: SecurityPlaybookTargetState.LeftOut,
    };

    const kept: Array<SecurityPlaybookTarget> = SecurityPlaybookTargets.protect(
      { targets: [...handed, decided], rules: [] },
    );

    expect(proposedValues(kept)).toEqual(["mallory@acme.com"]);
    // What the approver already decided stays as they left it.
    expect(kept).toContainEqual(decided);
  });
});

describe("SecurityPlaybookTargets.selectTargets, over a case stored before the rule", () => {
  test("a case grouped on [REDACTED], with its detection's user stored as one, offers nobody", async () => {
    const detection: SecurityDetection = new SecurityDetection();
    detection.groupValue = "[REDACTED]";
    detection.entities = [asUser("[REDACTED]")] as unknown as JSONArray;

    getJestSpyOn(SecurityDetectionService, "findBy").mockResolvedValue([
      detection,
    ] as never);
    getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([] as never);
    getJestSpyOn(SecurityProtectedEntityService, "getRules").mockResolvedValue(
      [] as never,
    );

    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.groupingKey = "entity:[redacted]";
    securityCase.entities = [asUser("[REDACTED]")] as unknown as JSONArray;

    expect(
      await SecurityPlaybookTargets.selectTargets({
        projectId: PROJECT_ID,
        securityCase,
        entityType: SecurityEntityType.User,
      }),
    ).toEqual([]);
  });

  test("a case about a workflow's mass delete offers no user to suspend", async () => {
    const principal: string = getWorkflowPrincipal(WORKFLOW_ID);
    const detection: SecurityDetection = new SecurityDetection();
    detection.groupValue = principal;
    detection.entities = [asUser(principal)] as unknown as JSONArray;

    getJestSpyOn(SecurityDetectionService, "findBy").mockResolvedValue([
      detection,
    ] as never);
    getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([] as never);
    getJestSpyOn(SecurityProtectedEntityService, "getRules").mockResolvedValue(
      [] as never,
    );

    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.groupingKey = `entity:${principal}`;
    securityCase.entities = [asUser(principal)] as unknown as JSONArray;

    expect(
      await SecurityPlaybookTargets.selectTargets({
        projectId: PROJECT_ID,
        securityCase,
        entityType: SecurityEntityType.User,
      }),
    ).toEqual([]);
  });

  test("a hashed user is what the case is about, but no step can name it to Okta", () => {
    const token: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "mallory@acme.com",
    });

    expect(
      SecurityPlaybookTargets.getGroupedOnEntities({
        groupingKey: undefined,
        detections: [{ groupValue: token, entities: [asUser(token)] }],
        caseEntities: [asUser(token)],
      }),
    ).toEqual([{ type: SecurityEntityType.Other, value: token }]);
  });
});
