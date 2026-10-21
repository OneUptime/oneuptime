import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import { CONTAINMENT_ENTITY_LIMIT } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import { JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { ProtectedEntityRule } from "../../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The target rule: a step that acts on users or hosts acts on the attacker
 * side of the case - what its detections are grouped on, and what threat
 * intel knows - never on every user or host it names. The brute force of
 * the audit is the case to beat: grouped on the attacker's address, it also
 * names the account it tried and the VPN gateway it hit, and neither may be
 * contained.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const ATTACKER_IP: SecurityEntity = {
  type: SecurityEntityType.IpAddress,
  value: "203.0.113.7",
};
const VICTIM: SecurityEntity = {
  type: SecurityEntityType.User,
  value: "alice@acme.com",
};
const GATEWAY: SecurityEntity = {
  type: SecurityEntityType.Host,
  value: "vpn-gw-01",
};

function valuesOf(
  targets: Array<SecurityPlaybookTarget>,
  state: SecurityPlaybookTargetState = SecurityPlaybookTargetState.Proposed,
): Array<string> {
  return targets
    .filter((target: SecurityPlaybookTarget): boolean => {
      return target.state === state;
    })
    .map((target: SecurityPlaybookTarget): string => {
      return target.value;
    });
}

function choose(data: {
  entityType: SecurityEntityType;
  groupedOn?: Array<SecurityEntity>;
  caseEntities: Array<SecurityEntity>;
  threatIntelValues?: Array<string>;
  protectedRules?: Array<ProtectedEntityRule>;
}): Array<SecurityPlaybookTarget> {
  return SecurityPlaybookTargets.chooseTargets({
    entityType: data.entityType,
    groupedOn: data.groupedOn || [],
    caseEntities: data.caseEntities,
    threatIntelValues: new Set(data.threatIntelValues || []),
    protectedRules: data.protectedRules || [],
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the target rule", () => {
  test("a brute force grouped on the attacker's address contains neither the account it tried nor the gateway", () => {
    const caseEntities: Array<SecurityEntity> = [ATTACKER_IP, VICTIM, GATEWAY];

    for (const entityType of [
      SecurityEntityType.User,
      SecurityEntityType.Host,
    ]) {
      expect(
        choose({ entityType, groupedOn: [ATTACKER_IP], caseEntities }),
      ).toEqual([]);
    }
  });

  test("acts on the user a detection is grouped on, and on no other user of the case", () => {
    const targets: Array<SecurityPlaybookTarget> = choose({
      entityType: SecurityEntityType.User,
      groupedOn: [{ type: SecurityEntityType.User, value: "mallory@acme.com" }],
      caseEntities: [
        { type: SecurityEntityType.User, value: "mallory@acme.com" },
        VICTIM,
        GATEWAY,
      ],
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

  test("adds a user or host of the case that threat intel knows, after the grouped-on ones", () => {
    const targets: Array<SecurityPlaybookTarget> = choose({
      entityType: SecurityEntityType.Host,
      groupedOn: [{ type: SecurityEntityType.Host, value: "web-01" }],
      caseEntities: [
        { type: SecurityEntityType.Host, value: "web-01" },
        { type: SecurityEntityType.Host, value: "C2.Evil.example" },
        GATEWAY,
      ],
      threatIntelValues: ["c2.evil.example"],
    });

    expect(
      targets.map((target: SecurityPlaybookTarget): Array<string> => {
        return [target.value, target.reason];
      }),
    ).toEqual([
      ["web-01", SecurityPlaybookTargetReason.GroupedOn],
      ["C2.Evil.example", SecurityPlaybookTargetReason.ThreatIntel],
    ]);
  });

  test("only the step's kind: a host step never acts on a grouped-on user", () => {
    expect(
      choose({
        entityType: SecurityEntityType.Host,
        groupedOn: [VICTIM],
        caseEntities: [VICTIM, GATEWAY],
      }),
    ).toEqual([]);
  });

  test("keeps a protected target in the list, marked protected, with the entry that protects it", () => {
    const targets: Array<SecurityPlaybookTarget> = choose({
      entityType: SecurityEntityType.Host,
      groupedOn: [GATEWAY],
      caseEntities: [GATEWAY],
      protectedRules: [{ type: SecurityEntityType.Host, value: "VPN-GW-*" }],
    });

    expect(targets).toEqual([
      {
        type: SecurityEntityType.Host,
        value: "vpn-gw-01",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Protected,
        protectedBy: "VPN-GW-*",
      },
    ]);
  });

  test("a protected user is not a protected host", () => {
    expect(
      valuesOf(
        choose({
          entityType: SecurityEntityType.Host,
          groupedOn: [GATEWAY],
          caseEntities: [GATEWAY],
          protectedRules: [{ type: SecurityEntityType.User, value: "*" }],
        }),
      ),
    ).toEqual(["vpn-gw-01"]);
  });

  test("acts on at most the limit, and still reports the protected ones", () => {
    const many: Array<SecurityEntity> = Array.from(
      { length: CONTAINMENT_ENTITY_LIMIT + 5 },
      (_value: unknown, index: number): SecurityEntity => {
        return {
          type: SecurityEntityType.User,
          value: `user${index}@acme.com`,
        };
      },
    );

    const targets: Array<SecurityPlaybookTarget> = choose({
      entityType: SecurityEntityType.User,
      groupedOn: many,
      caseEntities: many,
      protectedRules: [
        { type: SecurityEntityType.User, value: "user14@acme.com" },
      ],
    });

    expect(valuesOf(targets)).toHaveLength(CONTAINMENT_ENTITY_LIMIT);
    expect(valuesOf(targets, SecurityPlaybookTargetState.Protected)).toEqual([
      "user14@acme.com",
    ]);
  });

  test("protect() marks a target protected after the fact, and leaves decided ones alone", () => {
    const targets: Array<SecurityPlaybookTarget> =
      SecurityPlaybookTargets.protect({
        targets: [
          {
            type: SecurityEntityType.User,
            value: "svc-backup",
            reason: SecurityPlaybookTargetReason.GroupedOn,
            state: SecurityPlaybookTargetState.Proposed,
          },
          {
            type: SecurityEntityType.User,
            value: "svc-ci",
            reason: SecurityPlaybookTargetReason.ThreatIntel,
            state: SecurityPlaybookTargetState.LeftOut,
          },
        ],
        rules: [{ type: SecurityEntityType.User, value: "svc-*" }],
      });

    expect(
      targets.map((target: SecurityPlaybookTarget): string => {
        return target.state;
      }),
    ).toEqual([
      SecurityPlaybookTargetState.Protected,
      SecurityPlaybookTargetState.LeftOut,
    ]);
  });
});

describe("what a case is grouped on", () => {
  test("types a detection's group value by the field it came from", () => {
    expect(
      SecurityPlaybookTargets.getGroupedOnEntities({
        detections: [
          {
            groupValue: "web-01",
            entities: [{ type: SecurityEntityType.Host, value: "web-01" }],
          },
        ],
        caseEntities: [],
      }),
    ).toEqual([{ type: SecurityEntityType.Host, value: "web-01" }]);
  });

  test("reads the case's own grouping key, with the case's spelling", () => {
    expect(
      SecurityPlaybookTargets.getGroupedOnEntities({
        groupingKey: "entity:mallory@acme.com",
        detections: [],
        caseEntities: [
          { type: SecurityEntityType.User, value: "Mallory@Acme.com" },
        ],
      }),
    ).toEqual([{ type: SecurityEntityType.User, value: "Mallory@Acme.com" }]);
  });

  test("a case about one detection's fingerprint, or a hashed value, is grouped on nothing", () => {
    expect(
      SecurityPlaybookTargets.getGroupedOnEntities({
        groupingKey: "detection:rule:abc",
        detections: [],
        caseEntities: [VICTIM],
      }),
    ).toEqual([]);
    expect(
      SecurityPlaybookTargets.getGroupedOnEntities({
        groupingKey: "entity:sha256:0123",
        detections: [],
        caseEntities: [VICTIM],
      }),
    ).toEqual([]);
  });
});

describe("SecurityPlaybookTargets.selectTargets", () => {
  test("reads the case's detections, threat intel and protected list", async () => {
    const detection: SecurityDetection = new SecurityDetection();
    detection.groupValue = "203.0.113.7";
    detection.entities = [ATTACKER_IP, VICTIM] as unknown as JSONArray;

    const detections: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionService,
      "findBy",
    ).mockResolvedValue([detection] as never);
    const indicators: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([
      {
        indicatorValue: "mallory@evil.example",
        feedId: "f",
        feedName: "Feed",
        stixId: "s",
        indicatorType: "email-addr",
        indicatorName: "Known phisher",
        confidence: 90,
      },
    ] as never);
    getJestSpyOn(SecurityProtectedEntityService, "getRules").mockResolvedValue(
      [] as never,
    );

    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.groupingKey = "entity:203.0.113.7";
    securityCase.entities = [
      ATTACKER_IP,
      VICTIM,
      { type: SecurityEntityType.User, value: "Mallory@Evil.example" },
      GATEWAY,
    ] as unknown as JSONArray;

    const targets: Array<SecurityPlaybookTarget> =
      await SecurityPlaybookTargets.selectTargets({
        projectId: PROJECT_ID,
        securityCase,
        entityType: SecurityEntityType.User,
      });

    // The victim is on the case, but the case is about the address: only intel's match is a target.
    expect(valuesOf(targets)).toEqual(["Mallory@Evil.example"]);
    expect(
      (detections.mock.calls[0]![0] as { query: { securityCaseId: ObjectID } })
        .query.securityCaseId,
    ).toEqual(CASE_ID);
    expect(
      (indicators.mock.calls[0]![0] as { values: Array<string> }).values,
    ).toEqual(["alice@acme.com", "mallory@evil.example"]);
  });
});
