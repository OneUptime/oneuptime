import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import logger from "../../../../Server/Utils/Logger";
import SecurityCaseIngest, {
  SECURITY_CASE_INGEST_KEPT_EVENTS_READ_SIZE,
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
  findRepeatedDetection,
  getRepeatedDetectionIdsToRead,
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
import {
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  buildSecurityDetectionMatchedEvent,
  keepSecurityDetectionMatchedEvents,
  readSecurityDetectionMatchedEvents,
} from "../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
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

/*
 * A read of what detections kept (#9943): by their ids, the column the
 * reads of fingerprints never select.
 */
function isKeptEventsRead(findBy: unknown): boolean {
  return (
    (findBy as { query: Record<string, unknown> }).query["_id"] instanceof
    Includes
  );
}

function install(data: {
  detections?: Array<SecurityDetection>;
  openCases?: Array<SecurityCase>;
  // What each stored detection kept, by id: what a read of the column returns.
  kept?: Map<string, SecurityDetectionMatchedEvents> | undefined;
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
    ).mockImplementation(async (findBy: unknown) => {
      if (!isKeptEventsRead(findBy)) {
        return (data.detections || []) as never;
      }

      const ids: Array<string> = (
        (findBy as { query: Record<string, unknown> }).query["_id"] as Includes
      ).values.map((value: unknown): string => {
        return String(value);
      });

      return ids
        .filter((id: string): boolean => {
          return Boolean(
            (data.detections || []).find((detection: SecurityDetection) => {
              return detection.id?.toString() === id;
            }),
          );
        })
        .map((id: string): SecurityDetection => {
          const row: SecurityDetection = new SecurityDetection();
          row._id = id;

          if (data.kept?.has(id)) {
            row.matchedEvents = JSON.parse(
              JSON.stringify(data.kept.get(id)),
            ) as never;
          }

          return row;
        }) as never;
    }),
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

/*
 * A detection keeps the events it matched when it fires (#9619): the first
 * firing's on the new detection, each firing after adds its own until it is
 * full, and the request outcomes add up over every firing.
 */
/*
 * EXACTLY ONCE (#10489). A detection rule's scheduled run judged again
 * after its worker stopped hands the same firings, each under the name its
 * first pass gave it. A detection keeps the names of the firings it took,
 * and takes one it has once: its counts go up once, and nothing else of it
 * is written. A signal that names no firing is taken every time, as before.
 */
describe("a firing handed again", () => {
  const FIRING: string = "run:1760432400000:each:0f3a5c7e9b1d2468";

  function storedDetection(
    securityCase: SecurityCase,
    firingKeys?: Array<string> | undefined,
  ): SecurityDetection {
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = ObjectID.generate().toString();
    detection.fingerprint = "detection-rule:r1:abc";
    detection.securityCaseId = securityCase.id!;
    detection.severity = OcsfSeverity.Medium;
    detection.entities = [];

    if (firingKeys) {
      detection.recentFiringKeys = firingKeys as never;
    }

    return detection;
  }

  test("a firing its detection took already adds nothing: no count, no write, no playbook", async () => {
    const securityCase: SecurityCase = storedCase();

    install({
      detections: [storedDetection(securityCase, [FIRING])],
      openCases: [securityCase],
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ eventCount: 5, firingKey: FIRING }),
      ]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
      detectionsAlreadyTaken: 1,
    });
    expect(stubs.addToDetection).not.toHaveBeenCalled();
    expect(stubs.writeCase).not.toHaveBeenCalled();
    expect(stubs.updateCase).not.toHaveBeenCalled();
    expect(stubs.createDetection).not.toHaveBeenCalled();
    expect(stubs.createCase).not.toHaveBeenCalled();
    expect(stubs.launch).not.toHaveBeenCalled();
  });

  test("a new firing is taken, its counts go up, and its name is kept with the ones before", async () => {
    const securityCase: SecurityCase = storedCase();

    install({
      detections: [storedDetection(securityCase, ["run:1:each:older"])],
      openCases: [securityCase],
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ eventCount: 5, firingKey: FIRING }),
      ]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 1,
    });
    expect(stubs.addToDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        add: { eventCount: 5, fireCount: 1 },
        set: expect.objectContaining({
          recentFiringKeys: ["run:1:each:older", FIRING],
        }),
      }),
    );
  });

  test("the detection a firing opens keeps its name, so the same firing handed again repeats nothing", async () => {
    install({});

    const first: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ firingKey: FIRING }),
      ]);
    const opened: SecurityDetection = (
      stubs.createDetection.mock.calls[0]![0] as { data: SecurityDetection }
    ).data;

    expect(first.casesOpened).toBe(1);
    expect(opened.recentFiringKeys).toEqual([FIRING]);

    // The run judged again: its detection is in the case it opened.
    install({
      detections: [opened],
      openCases: [
        storedCase({
          _id: opened.securityCaseId!.toString(),
        } as Partial<SecurityCase>),
      ],
    });

    const again: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ firingKey: FIRING }),
      ]);

    expect(again).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
      detectionsAlreadyTaken: 1,
    });
    expect(stubs.addToDetection).not.toHaveBeenCalled();
  });

  test("two firings of one detection in one batch are both taken, and the second sees the first's name", async () => {
    const securityCase: SecurityCase = storedCase();

    install({
      detections: [storedDetection(securityCase, [])],
      openCases: [securityCase],
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([
        signal({ firingKey: "run:1:100:aaa" }),
        signal({ firingKey: "run:1:200:aaa" }),
        // ...and the first handed a second time in the same batch: once.
        signal({ firingKey: "run:1:100:aaa" }),
      ]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 2,
      detectionsAlreadyTaken: 1,
    });
    expect(
      stubs.addToDetection.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { set: Record<string, unknown> }).set[
          "recentFiringKeys"
        ];
      }),
    ).toEqual([["run:1:100:aaa"], ["run:1:100:aaa", "run:1:200:aaa"]]);
  });

  test("a signal that names no firing is taken every time, as before", async () => {
    const securityCase: SecurityCase = storedCase();

    install({
      detections: [storedDetection(securityCase, [FIRING])],
      openCases: [securityCase],
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([signal(), signal()]);

    expect(result).toEqual({
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 2,
    });
    // Nothing about firings is written for it.
    for (const call of stubs.addToDetection.mock.calls) {
      expect(
        (call[0] as { set: Record<string, unknown> }).set["recentFiringKeys"],
      ).toBeUndefined();
    }
  });

  test("the names are read with the detections, and the column is OneUptime's alone", async () => {
    install({});

    await SecurityCaseIngest.recordDetections([signal({ firingKey: FIRING })]);

    const fingerprintRead: { select: Record<string, unknown> } = stubs
      .findDetections.mock.calls[0]![0] as {
      select: Record<string, unknown>;
    };

    expect(fingerprintRead.select["recentFiringKeys"]).toBe(true);

    const detection: SecurityDetection = new SecurityDetection();

    expect(detection.getColumnAccessControlFor("recentFiringKeys")).toEqual(
      expect.objectContaining({ create: [], read: [], update: [] }),
    );
  });
});

describe("the events a detection keeps", () => {
  function keptEvent(index: number): SecurityDetectionMatchedEvent {
    return buildSecurityDetectionMatchedEvent({
      time: `2026-10-14 08:${String(index).padStart(2, "0")}:00.000000000`,
      eventUid: `event-${index}`,
      primaryEntityId: "88888888-8888-4888-8888-888888888888",
      message: `Failed sign-in ${index}`,
      principalIp: "203.0.113.7",
      requestOutcome: "Rejected",
      retentionDate: "2026-10-21 09:00:00",
    })!;
  }

  function matched(
    indexes: Array<number>,
    outcomes: Record<string, number>,
  ): SecurityDetectionMatchedEvents {
    return {
      events: indexes.map((index: number): SecurityDetectionMatchedEvent => {
        return keptEvent(index);
      }),
      outcomes,
    };
  }

  test("a new detection keeps its first firing's events", async () => {
    await SecurityCaseIngest.recordDetections([
      signal({ matchedEvents: matched([2, 1], { Rejected: 12 }) }),
    ]);

    const detection: SecurityDetection = (
      stubs.createDetection.mock.calls[0]![0] as { data: SecurityDetection }
    ).data;
    const kept: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents(detection.matchedEvents);

    expect(
      kept!.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(["event-1", "event-2"]);
    expect(kept!.outcomes).toEqual({ Rejected: 12 });
  });

  test("a signal that kept nothing leaves a new detection keeping nothing, as before", async () => {
    await SecurityCaseIngest.recordDetections([signal()]);

    const detection: SecurityDetection = (
      stubs.createDetection.mock.calls[0]![0] as { data: SecurityDetection }
    ).data;

    expect(detection.matchedEvents).toBeUndefined();
  });

  test("a repeat adds its events to what the detection kept, and its outcomes to the ones counted", async () => {
    const securityCase: SecurityCase = storedCase();
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = ObjectID.generate().toString();
    detection.fingerprint = "detection-rule:r1:abc";
    detection.securityCaseId = securityCase.id!;
    detection.severity = OcsfSeverity.Medium;
    detection.entities = [];

    install({
      detections: [detection],
      openCases: [securityCase],
      kept: new Map([
        [detection.id!.toString(), matched([1, 2], { Rejected: 10 })],
      ]),
    });

    const readOne: Spy = getJestSpyOn(SecurityDetectionService, "findOneById");

    await SecurityCaseIngest.recordDetections([
      signal({
        eventCount: 3,
        matchedEvents: matched([2, 3], { Rejected: 2, "Reached App": 1 }),
      }),
    ]);

    // Read with the batch's other repeats (#9943), never on its own.
    expect(readOne).not.toHaveBeenCalled();
    expect(
      stubs.findDetections.mock.calls.filter((call: Array<unknown>) => {
        return isKeptEventsRead(call[0]);
      }),
    ).toHaveLength(1);

    const set: { matchedEvents?: unknown } = (
      stubs.addToDetection.mock.calls[0]![0] as {
        set: { matchedEvents?: unknown };
      }
    ).set;
    const kept: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents(set.matchedEvents);

    expect(
      kept!.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(["event-1", "event-2", "event-3"]);
    expect(kept!.outcomes).toEqual({ Rejected: 12, "Reached App": 1 });
  });

  test("a repeat whose source kept nothing reads and writes nothing of it", async () => {
    const securityCase: SecurityCase = storedCase();
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = ObjectID.generate().toString();
    detection.fingerprint = "detection-rule:r1:abc";
    detection.securityCaseId = securityCase.id!;
    detection.severity = OcsfSeverity.Medium;
    detection.entities = [];

    install({ detections: [detection], openCases: [securityCase] });

    const readKept: Spy = getJestSpyOn(
      SecurityDetectionService,
      "findOneById",
    ).mockResolvedValue(null as never);

    await SecurityCaseIngest.recordDetections([signal()]);

    expect(readKept).not.toHaveBeenCalled();
    expect(
      stubs.findDetections.mock.calls.filter((call: Array<unknown>) => {
        return isKeptEventsRead(call[0]);
      }),
    ).toHaveLength(0);
    expect(
      (
        stubs.addToDetection.mock.calls[0]![0] as {
          set: { matchedEvents?: unknown };
        }
      ).set.matchedEvents,
    ).toBeUndefined();
  });
});

/*
 * A firing that repeats many detections (#9943): what each of them kept
 * is read with the others', in reads of at most a hundred - one for any
 * rule's firing - where each was read on its own. What is written is what
 * the reads one by one wrote, read as OneUptime and only the project's.
 */
describe("what a batch's repeated detections kept, read at once", () => {
  const FIRING_SIZE: number = 100;

  function keptEvent(
    group: number,
    index: number,
  ): SecurityDetectionMatchedEvent {
    return buildSecurityDetectionMatchedEvent({
      time: `2026-10-14 08:${String(index % 60).padStart(2, "0")}:${String(
        group % 60,
      ).padStart(2, "0")}.000000000`,
      eventUid: `group-${group}-event-${index}`,
      primaryEntityId: "88888888-8888-4888-8888-888888888888",
      message: `Failed sign-in ${index} from 198.18.0.${group}`,
      principalIp: `198.18.0.${group}`,
      requestOutcome: index % 3 === 0 ? "Reached App" : "Rejected",
      retentionDate: "2026-10-21 09:00:00",
    })!;
  }

  function events(
    group: number,
    from: number,
    count: number,
  ): SecurityDetectionMatchedEvents {
    return {
      events: Array.from(
        { length: count },
        (_: unknown, index: number): SecurityDetectionMatchedEvent => {
          return keptEvent(group, from + index);
        },
      ),
      outcomes: { Rejected: count, "Reached App": 1 },
    };
  }

  interface Firing {
    securityCase: SecurityCase;
    detections: Array<SecurityDetection>;
    // What each detection kept before the firing, by id; none for some.
    kept: Map<string, SecurityDetectionMatchedEvents>;
    signals: Array<SecurityDetectionSignal>;
  }

  /*
   * A correlation firing again for `size` groups while its case is open:
   * the first third of its detections are full, the next third hold a few
   * events, the rest kept nothing; every group brings ten events.
   */
  function firing(size: number): Firing {
    const securityCase: SecurityCase = storedCase();
    const detections: Array<SecurityDetection> = [];
    const kept: Map<string, SecurityDetectionMatchedEvents> = new Map();
    const signals: Array<SecurityDetectionSignal> = [];

    for (let group: number = 0; group < size; group++) {
      const detection: SecurityDetection = new SecurityDetection();
      detection._id = ObjectID.generate().toString();
      detection.fingerprint = `detection-rule:r1:group-${group}`;
      detection.securityCaseId = securityCase.id!;
      detection.severity = OcsfSeverity.Medium;
      detection.entities = [];
      detections.push(detection);

      if (group % 3 === 0) {
        kept.set(detection.id!.toString(), events(group, 0, 25));
      } else if (group % 3 === 1) {
        kept.set(detection.id!.toString(), events(group, 0, 4));
      }

      signals.push(
        signal({
          fingerprint: `detection-rule:r1:group-${group}`,
          groupValue: "203.0.113.7",
          eventCount: 10,
          matchedEvents: events(group, 2, 10),
        }),
      );
    }

    return { securityCase, detections, kept, signals };
  }

  function keptEventsReads(): Array<{
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: Record<string, unknown>;
    limit: number;
  }> {
    return stubs.findDetections.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return isKeptEventsRead(call[0]);
      })
      .map((call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: Record<string, unknown>;
          limit: number;
        };
      });
  }

  function idsOf(read: { query: Record<string, unknown> }): Array<string> {
    return (read.query["_id"] as Includes).values.map(
      (value: unknown): string => {
        return String(value);
      },
    );
  }

  // What was written for each detection, by id.
  function written(): Map<string, SecurityDetectionMatchedEvents | null> {
    const writes: Map<string, SecurityDetectionMatchedEvents | null> =
      new Map();

    for (const call of stubs.addToDetection.mock.calls) {
      const update: { id: ObjectID; set: { matchedEvents?: unknown } } =
        call[0] as { id: ObjectID; set: { matchedEvents?: unknown } };

      writes.set(
        update.id.toString(),
        readSecurityDetectionMatchedEvents(update.set.matchedEvents),
      );
    }

    return writes;
  }

  /*
   * What the reads one by one wrote: each detection's row read again, and
   * the firing's events merged onto it (keepSecurityDetectionMatchedEvents).
   */
  function writtenOneByOne(
    data: Firing,
  ): Map<string, SecurityDetectionMatchedEvents | null> {
    const writes: Map<string, SecurityDetectionMatchedEvents | null> =
      new Map();
    const rows: Map<string, unknown> = new Map(
      Array.from(data.kept.entries()).map(
        ([id, kept]: [string, SecurityDetectionMatchedEvents]) => {
          return [id, JSON.parse(JSON.stringify(kept)) as unknown];
        },
      ),
    );

    data.signals.forEach(
      (repeat: SecurityDetectionSignal, index: number): void => {
        const id: string = data.detections[index]!.id!.toString();
        const merged: SecurityDetectionMatchedEvents =
          keepSecurityDetectionMatchedEvents({
            kept: readSecurityDetectionMatchedEvents(rows.get(id)),
            firing: repeat.matchedEvents!,
          });

        rows.set(id, JSON.parse(JSON.stringify(merged)) as unknown);
        writes.set(id, readSecurityDetectionMatchedEvents(rows.get(id)));
      },
    );

    return writes;
  }

  test("a firing that repeats a hundred detections reads what they kept in one read, never one each", async () => {
    const data: Firing = firing(FIRING_SIZE);

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: data.kept,
    });

    const readOne: Spy = getJestSpyOn(SecurityDetectionService, "findOneById");

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections(data.signals);

    expect(result.detectionsRepeated).toBe(FIRING_SIZE);
    // Before #9943: one findOneById a repeat, a hundred reads. Now one.
    expect(readOne).not.toHaveBeenCalled();
    expect(keptEventsReads()).toHaveLength(1);
    expect(idsOf(keptEventsReads()[0]!)).toEqual(
      data.detections.map((detection: SecurityDetection): string => {
        return detection.id!.toString();
      }),
    );
    expect(keptEventsReads()[0]!.limit).toBe(FIRING_SIZE);
    // Every detection is still written once, as before.
    expect(stubs.addToDetection).toHaveBeenCalledTimes(FIRING_SIZE);
  });

  test("writes exactly what the reads one by one wrote: full ones take only the outcomes, others top up", async () => {
    const data: Firing = firing(FIRING_SIZE);

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: data.kept,
    });

    await SecurityCaseIngest.recordDetections(data.signals);

    const writes: Map<string, SecurityDetectionMatchedEvents | null> =
      written();

    expect(writes).toEqual(writtenOneByOne(data));

    // A full detection keeps its 25 and adds the outcomes; one with four tops up; one with none starts.
    const full: SecurityDetectionMatchedEvents = writes.get(
      data.detections[0]!.id!.toString(),
    )!;
    const few: SecurityDetectionMatchedEvents = writes.get(
      data.detections[1]!.id!.toString(),
    )!;
    const none: SecurityDetectionMatchedEvents = writes.get(
      data.detections[2]!.id!.toString(),
    )!;

    expect(full.events).toHaveLength(25);
    expect(full.events[24]!.eventUid).toBe("group-0-event-24");
    expect(full.outcomes).toEqual({ Rejected: 35, "Reached App": 2 });
    expect(
      few.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(
      Array.from({ length: 12 }, (_: unknown, index: number): string => {
        return `group-1-event-${index}`;
      }),
    );
    expect(none.events).toHaveLength(10);
  });

  test("a batch larger than a firing is read a hundred at a time", async () => {
    const data: Firing = firing(250);

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: data.kept,
    });

    await SecurityCaseIngest.recordDetections(data.signals);

    expect(
      keptEventsReads().map(
        (read: { query: Record<string, unknown> }): number => {
          return idsOf(read).length;
        },
      ),
    ).toEqual([
      SECURITY_CASE_INGEST_KEPT_EVENTS_READ_SIZE,
      SECURITY_CASE_INGEST_KEPT_EVENTS_READ_SIZE,
      50,
    ]);
    expect(written()).toEqual(writtenOneByOne(data));
  });

  test("a detection the batch repeats twice is read once, and its second firing merges onto its first", async () => {
    const data: Firing = firing(1);
    const second: SecurityDetectionSignal = signal({
      fingerprint: data.signals[0]!.fingerprint,
      matchedEvents: events(0, 30, 3),
    });

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: new Map([[data.detections[0]!.id!.toString(), events(0, 0, 4)]]),
    });

    await SecurityCaseIngest.recordDetections([data.signals[0]!, second]);

    expect(keptEventsReads()).toHaveLength(1);
    expect(idsOf(keptEventsReads()[0]!)).toEqual([
      data.detections[0]!.id!.toString(),
    ]);

    const writes: Array<SecurityDetectionMatchedEvents | null> =
      stubs.addToDetection.mock.calls.map((call: Array<unknown>) => {
        return readSecurityDetectionMatchedEvents(
          (call[0] as { set: { matchedEvents?: unknown } }).set.matchedEvents,
        );
      });
    const first: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: events(0, 0, 4),
        firing: data.signals[0]!.matchedEvents!,
      });

    expect(writes).toEqual([
      readSecurityDetectionMatchedEvents(JSON.parse(JSON.stringify(first))),
      readSecurityDetectionMatchedEvents(
        JSON.parse(
          JSON.stringify(
            keepSecurityDetectionMatchedEvents({
              kept: first,
              firing: second.matchedEvents!,
            }),
          ),
        ),
      ),
    ]);
  });

  test("a detection the batch opens and then repeats merges onto what it opened with, and reads nothing", async () => {
    const opening: SecurityDetectionSignal = signal({
      matchedEvents: events(5, 0, 3),
    });
    const repeat: SecurityDetectionSignal = signal({
      matchedEvents: events(5, 3, 2),
    });

    const readOne: Spy = getJestSpyOn(SecurityDetectionService, "findOneById");

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections([opening, repeat]);

    expect(result).toEqual({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 1,
    });
    expect(readOne).not.toHaveBeenCalled();
    expect(keptEventsReads()).toHaveLength(0);

    const kept: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents(
        (
          stubs.addToDetection.mock.calls[0]![0] as {
            set: { matchedEvents?: unknown };
          }
        ).set.matchedEvents,
      );

    expect(
      kept!.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual([
      "group-5-event-0",
      "group-5-event-1",
      "group-5-event-2",
      "group-5-event-3",
      "group-5-event-4",
    ]);
  });

  test("when the read at once fails, each repeat reads its own, as before, and loses nothing it kept", async () => {
    const data: Firing = firing(6);

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: data.kept,
    });

    const fingerprints: Spy = stubs.findDetections;
    fingerprints.mockImplementation(async (findBy: unknown) => {
      if (isKeptEventsRead(findBy)) {
        throw new Error("statement timeout");
      }

      return data.detections as never;
    });

    const warn: Spy = getJestSpyOn(logger, "warn").mockImplementation(
      (): void => {},
    );
    const readOne: Spy = getJestSpyOn(
      SecurityDetectionService,
      "findOneById",
    ).mockImplementation(async (findOneById: unknown) => {
      const id: string = (findOneById as { id: ObjectID }).id.toString();
      const row: SecurityDetection = new SecurityDetection();

      if (data.kept.has(id)) {
        row.matchedEvents = JSON.parse(
          JSON.stringify(data.kept.get(id)),
        ) as never;
      }

      return row as never;
    });

    const result: SecurityCaseIngestResult =
      await SecurityCaseIngest.recordDetections(data.signals);

    expect(result.detectionsRepeated).toBe(6);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readOne).toHaveBeenCalledTimes(6);
    expect(written()).toEqual(writtenOneByOne(data));
  });

  test("reads as OneUptime, only the project's detections, only the ones the batch repeats, and only what they kept", async () => {
    const data: Firing = firing(3);
    // The same fingerprint in a closed case: a signal never repeats it.
    const closed: SecurityDetection = new SecurityDetection();
    closed._id = ObjectID.generate().toString();
    closed.fingerprint = data.signals[0]!.fingerprint;
    closed.securityCaseId = ObjectID.generate();
    // A repeat whose signal kept nothing: nothing of it is read.
    data.signals[2] = { ...data.signals[2]!, matchedEvents: undefined };

    install({
      detections: [closed, ...data.detections],
      openCases: [data.securityCase],
      kept: data.kept,
    });

    await SecurityCaseIngest.recordDetections(data.signals);

    expect(keptEventsReads()).toHaveLength(1);

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = keptEventsReads()[0]!;

    // No role reads the column (SecurityDetection.matchedEvents): only OneUptime does.
    expect(read.props).toEqual({ isRoot: true });
    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(idsOf(read)).toEqual([
      data.detections[0]!.id!.toString(),
      data.detections[1]!.id!.toString(),
    ]);
    expect(read.select).toEqual({ _id: true, matchedEvents: true });
  });

  test("the column it reads is one no role reads, writes or creates through the API", () => {
    const model: SecurityDetection = new SecurityDetection();

    expect(model.getColumnAccessControlFor("matchedEvents")?.read).toEqual([]);
    expect(model.getColumnAccessControlFor("matchedEvents")?.update).toEqual(
      [],
    );
    expect(model.getColumnAccessControlFor("matchedEvents")?.create).toEqual(
      [],
    );
  });

  test("a detection the read does not return kept nothing, as a read of it alone says", async () => {
    const data: Firing = firing(2);

    install({
      detections: data.detections,
      openCases: [data.securityCase],
      kept: data.kept,
    });

    const reads: Spy = stubs.findDetections;
    reads.mockImplementation(async (findBy: unknown) => {
      // Gone between the reads: the batch read returns no row for it.
      return (isKeptEventsRead(findBy) ? [] : data.detections) as never;
    });

    await SecurityCaseIngest.recordDetections(data.signals);

    expect(written()).toEqual(writtenOneByOne({ ...data, kept: new Map() }));
  });
});

describe("the repeats a batch reads", () => {
  test("are the detections of open cases its signals with events repeat, each once", () => {
    const open: SecurityCase = storedCase();
    const inOpen: SecurityDetection = new SecurityDetection();
    inOpen._id = ObjectID.generate().toString();
    inOpen.fingerprint = "f-open";
    inOpen.securityCaseId = open.id!;
    const inClosed: SecurityDetection = new SecurityDetection();
    inClosed._id = ObjectID.generate().toString();
    inClosed.fingerprint = "f-closed";
    inClosed.securityCaseId = ObjectID.generate();

    const openCases: Map<string, SecurityCase> = new Map([
      [open.id!.toString(), open],
    ]);
    const withEvents: SecurityDetectionMatchedEvents = {
      events: [],
      outcomes: { Rejected: 1 },
    };

    expect(
      getRepeatedDetectionIdsToRead({
        signals: [
          signal({ fingerprint: "f-open", matchedEvents: withEvents }),
          signal({ fingerprint: "f-open", matchedEvents: withEvents }),
          signal({ fingerprint: "f-closed", matchedEvents: withEvents }),
          signal({ fingerprint: "f-new", matchedEvents: withEvents }),
          signal({ fingerprint: "f-open" }),
        ],
        detections: [inOpen, inClosed],
        openCases,
      }),
    ).toEqual([inOpen.id!.toString()]);

    expect(
      findRepeatedDetection({
        detections: [inClosed, inOpen],
        fingerprint: "f-closed",
        openCases,
      }),
    ).toBeUndefined();
  });

  test("reads none at all for a batch that repeats nothing", async () => {
    expect(
      await SecurityCaseIngest.readKeptEventsOfDetections({
        projectId: PROJECT_ID,
        detectionIds: [],
      }),
    ).toEqual(new Map());
    expect(stubs.findDetections).not.toHaveBeenCalled();
  });
});
