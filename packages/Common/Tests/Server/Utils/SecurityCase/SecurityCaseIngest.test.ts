import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
  securityCaseGroupingKey,
  worseSeverity,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityPlaybookLauncher from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getJestSpyOn } from "../../../Spy";
import {
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
  testPriorityId,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SEEN_AT: Date = new Date("2026-10-14T09:00:00Z");

function signal(
  overrides: Partial<SecurityDetectionSignal> = {},
): SecurityDetectionSignal {
  return {
    projectId: PROJECT_ID,
    source: SecurityDetectionSource.DetectionRule,
    fingerprint: "detection-rule:r1:abc",
    title: "Brute force — 203.0.113.7",
    description: "Many failures.",
    severity: OcsfSeverity.High,
    eventCount: 12,
    groupValue: "203.0.113.7",
    entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    ruleName: "Brute force",
    detectionRuleId: RULE_ID,
    sampleMessage: "failed logon",
    eventUid: "detection:r1:abc:1",
    seenAt: SEEN_AT,
    ...overrides,
  };
}

function storedCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = ObjectID.generate().toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Medium,
  );
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.groupingKey = "entity:203.0.113.7";
  securityCase.entities = [];
  securityCase.mitreTactics = [];
  securityCase.mitreTechniques = [];
  Object.assign(securityCase, overrides);
  return securityCase;
}

interface Stubs {
  lock: Spy;
  release: Spy;
  findDetections: Spy;
  createDetection: Spy;
  addToDetection: Spy;
  findCases: Spy;
  createCase: Spy;
  updateCase: Spy;
  addToCase: Spy;
  writeCase: Spy;
  feed: Spy;
  launch: Spy;
  order: Array<string>;
}

let stubs: Stubs;

function install(data: {
  detections?: Array<SecurityDetection>;
  openCases?: Array<SecurityCase>;
}): void {
  const order: Array<string> = [];

  stubs = {
    order,
    lock: getJestSpyOn(Semaphore, "lock").mockImplementation(async () => {
      order.push("lock");
      return { id: "mutex" } as never;
    }),
    release: getJestSpyOn(Semaphore, "release").mockImplementation(async () => {
      order.push("release");
    }),
    findDetections: getJestSpyOn(
      SecurityDetectionService,
      "findBy",
    ).mockResolvedValue((data.detections || []) as never),
    createDetection: getJestSpyOn(
      SecurityDetectionService,
      "create",
    ).mockImplementation(async (createBy: unknown) => {
      const detection: SecurityDetection = (
        createBy as { data: SecurityDetection }
      ).data;
      detection._id = ObjectID.generate().toString();
      return detection as never;
    }),
    addToDetection: getJestSpyOn(
      SecurityDetectionService,
      "atomicAddToColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never),
    findCases: getJestSpyOn(SecurityCaseService, "findBy").mockResolvedValue(
      (data.openCases || []) as never,
    ),
    createCase: getJestSpyOn(SecurityCaseService, "create").mockImplementation(
      async (createBy: unknown) => {
        const securityCase: SecurityCase = (createBy as { data: SecurityCase })
          .data;
        securityCase._id = ObjectID.generate().toString();
        return securityCase as never;
      },
    ),
    updateCase: getJestSpyOn(
      SecurityCaseService,
      "updateOneById",
    ).mockResolvedValue(undefined as never),
    addToCase: getJestSpyOn(
      SecurityCaseService,
      "atomicAddToColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never),
    writeCase: getJestSpyOn(
      SecurityCaseService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never),
    feed: getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never),
    launch: getJestSpyOn(
      SecurityPlaybookLauncher,
      "launchForCase",
    ).mockImplementation(async () => {
      order.push("launch");
      return 1 as never;
    }),
  };
}

beforeEach(() => {
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
  install({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("securityCaseGroupingKey", () => {
  test("groups on the entity, case-folded", () => {
    expect(
      securityCaseGroupingKey({ groupValue: " WEB-01 ", fingerprint: "f" }),
    ).toBe("entity:web-01");
  });

  test("hashes an entity too long to keep as it is", () => {
    const key: string = securityCaseGroupingKey({
      groupValue: "x".repeat(500),
      fingerprint: "f",
    });

    expect(key.startsWith("entity:sha256:")).toBe(true);
    expect(key.length).toBeLessThan(100);
  });

  test("falls back to the detection's own fingerprint", () => {
    expect(
      securityCaseGroupingKey({ fingerprint: "detection-rule:r1:x" }),
    ).toBe("detection:detection-rule:r1:x");
  });
});

describe("worseSeverity", () => {
  test("keeps the worse, reading Other and missing as the least", () => {
    expect(worseSeverity(OcsfSeverity.Low, OcsfSeverity.High)).toBe(
      OcsfSeverity.High,
    );
    expect(worseSeverity(OcsfSeverity.Critical, OcsfSeverity.High)).toBe(
      OcsfSeverity.Critical,
    );
    expect(worseSeverity(undefined, OcsfSeverity.Low)).toBe(OcsfSeverity.Low);
    expect(worseSeverity(OcsfSeverity.Other, OcsfSeverity.Low)).toBe(
      OcsfSeverity.Low,
    );
  });
});

describe("SecurityCaseIngest.recordDetections", () => {
  test("opens a case for a new signal, with its detection, and starts Case Opened playbooks after the lock", async () => {
    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([signal()]);

    expect(result).toEqual({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    });

    const created: SecurityCase = (
      stubs.createCase.mock.calls[0]![0] as {
        data: SecurityCase;
        miscDataProps: Record<string, unknown>;
      }
    ).data;

    // At the project's high priority, for a High detection, in its new status.
    expect(created.securityCasePriorityId?.toString()).toBe(
      testPriorityId(SecurityCasePriorityLevel.High).toString(),
    );
    expect(created.securityCaseStatusId?.toString()).toBe(
      testStatusId(SecurityCaseStage.New).toString(),
    );
    expect(created.source).toBe(SecurityDetectionSource.DetectionRule);
    expect(created.groupingKey).toBe("entity:203.0.113.7");
    expect(created.mitreTactics).toEqual(["TA0006"]);
    expect(created.firstDetectedAt).toEqual(SEEN_AT);
    expect(
      (
        stubs.createCase.mock.calls[0]![0] as {
          miscDataProps: Record<string, unknown>;
        }
      ).miscDataProps,
    ).toEqual({ openedByDetection: true });

    const detection: SecurityDetection = (
      stubs.createDetection.mock.calls[0]![0] as {
        data: SecurityDetection;
      }
    ).data;

    expect(detection.securityCaseId?.toString()).toBe(created.id?.toString());
    expect(detection.eventCount).toBe(12);
    expect(detection.fireCount).toBe(1);
    expect(detection.detectionRuleId?.toString()).toBe(RULE_ID.toString());
    expect(detection.eventUid).toBe("detection:r1:abc:1");

    expect(stubs.addToCase).toHaveBeenCalledWith(
      expect.objectContaining({ add: { detectionCount: 1 } }),
    );

    expect(stubs.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: SecurityPlaybookTrigger.CaseOpened,
        detection: {
          source: SecurityDetectionSource.DetectionRule,
          detectionRuleId: RULE_ID,
        },
      }),
    );
    expect(stubs.order).toEqual(["lock", "release", "launch"]);
  });

  test("folds a repeat into its detection while the case is open, and starts nothing", async () => {
    const securityCase: SecurityCase = storedCase();
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = ObjectID.generate().toString();
    detection.fingerprint = "detection-rule:r1:abc";
    detection.securityCaseId = securityCase.id!;
    detection.severity = OcsfSeverity.Medium;
    detection.entities = [];

    install({ detections: [detection], openCases: [securityCase] });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([signal({ eventCount: 5 })]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 1,
    });
    expect(stubs.createCase).not.toHaveBeenCalled();
    expect(stubs.createDetection).not.toHaveBeenCalled();
    expect(stubs.addToDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        add: { eventCount: 5, fireCount: 1 },
        set: expect.objectContaining({
          severity: OcsfSeverity.High,
          lastSeenAt: SEEN_AT,
        }),
      }),
    );
    expect(stubs.launch).not.toHaveBeenCalled();
  });

  test("joins a new signal about the same entity to its open case, raising the priority", async () => {
    const securityCase: SecurityCase = storedCase({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Low),
    });

    install({ openCases: [securityCase] });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({
          fingerprint: "threat-intel:feed:xyz",
          source: SecurityDetectionSource.ThreatIntel,
          severity: OcsfSeverity.Critical,
          detectionRuleId: undefined,
          mitreTactics: ["TA0011"],
        }),
      ]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    });
    expect(stubs.createCase).not.toHaveBeenCalled();
    expect(
      (
        stubs.createDetection.mock.calls[0]![0] as { data: SecurityDetection }
      ).data.securityCaseId?.toString(),
    ).toBe(securityCase.id?.toString());

    // The case widens: the new detection's tactic, and its Critical severity.
    expect(stubs.updateCase).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          securityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Critical,
          ),
          mitreTactics: ["TA0011"],
        }),
      }),
    );

    expect(stubs.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: SecurityPlaybookTrigger.DetectionAdded,
        securityCaseId: securityCase.id,
      }),
    );
  });

  test("never lowers a case's priority for a milder detection", async () => {
    install({
      openCases: [
        storedCase({
          securityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Critical,
          ),
        }),
      ],
    });

    await SecurityCaseIngest.recordDetections([
      signal({
        fingerprint: "other",
        severity: OcsfSeverity.Low,
        mitreTactics: [],
      }),
    ]);

    for (const call of stubs.updateCase.mock.calls) {
      expect(
        (call[0] as { data: Partial<SecurityCase> }).data
          .securityCasePriorityId,
      ).toBeUndefined();
    }
  });

  test("opens at the priority of the detection's level, whatever the project renamed it", async () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[1]!.name = "P2";
    stubSecurityCaseValues({ priorities });

    await SecurityCaseIngest.recordDetections([signal()]);

    const created: SecurityCase = (
      stubs.createCase.mock.calls[0]![0] as { data: SecurityCase }
    ).data;

    expect(created.securityCasePriorityId?.toString()).toBe(
      priorities[1]!.id?.toString(),
    );
  });

  test("looks for the open case among the project's open statuses only", async () => {
    await SecurityCaseIngest.recordDetections([signal()]);

    const query: Record<string, unknown> = (
      stubs.findCases.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["securityCaseStatusId"]).toBeInstanceOf(Includes);
    expect(
      (query["securityCaseStatusId"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
    ]);
  });

  test("never lowers a case at the project's own Emergency, above Critical", async () => {
    const emergency: SecurityCasePriority = buildTestPriority({
      id: "c1000000-0000-4000-8000-0000000000e1",
      name: "Emergency",
      order: 0,
    });
    stubSecurityCaseValues({
      priorities: [emergency, ...buildDefaultTestPriorities()],
    });
    install({
      openCases: [storedCase({ securityCasePriorityId: emergency.id! })],
    });

    await SecurityCaseIngest.recordDetections([
      signal({
        fingerprint: "other",
        severity: OcsfSeverity.Critical,
        mitreTactics: [],
      }),
    ]);

    for (const call of stubs.updateCase.mock.calls) {
      expect(
        (call[0] as { data: Partial<SecurityCase> }).data
          .securityCasePriorityId,
      ).toBeUndefined();
    }
  });

  test("opens a new case when the matching detection's case is closed", async () => {
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = ObjectID.generate().toString();
    detection.fingerprint = "detection-rule:r1:abc";
    // Its case is not among the open ones the ingest finds.
    detection.securityCaseId = ObjectID.generate();

    install({ detections: [detection], openCases: [] });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([signal()]);

    expect(result.casesOpened).toBe(1);
    expect(result.detectionsRepeated).toBe(0);
  });

  test("gathers a batch's signals about one entity into one case", async () => {
    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal(),
        signal({
          fingerprint: "detection-rule:r2:abc",
          title: "Password spray — 203.0.113.7",
        }),
      ]);

    expect(result).toEqual({
      casesOpened: 1,
      detectionsAdded: 2,
      detectionsRepeated: 0,
    });
    expect(stubs.createCase).toHaveBeenCalledTimes(1);
  });

  test("records one project's signals under that project's lock, each project apart", async () => {
    await SecurityCaseIngest.recordDetections([
      signal(),
      signal({ projectId: OTHER_PROJECT_ID }),
    ]);

    expect(
      stubs.lock.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { key: string; namespace: string }).key;
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
    expect(stubs.release).toHaveBeenCalledTimes(2);
  });

  test("a signal that fails to record does not stop the next", async () => {
    stubs.createCase.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ groupValue: "a", fingerprint: "fa" }),
        signal({ groupValue: "b", fingerprint: "fb" }),
      ]);

    expect(result.casesOpened).toBe(1);
    expect(stubs.release).toHaveBeenCalledTimes(1);
  });

  test("gives the lock back even when reading fails", async () => {
    stubs.findDetections.mockImplementation(async () => {
      throw new Error("down");
    });

    await expect(
      SecurityCaseIngest.recordDetections([signal()]),
    ).rejects.toThrow("down");
    expect(stubs.release).toHaveBeenCalledTimes(1);
  });
});
