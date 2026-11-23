import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityAutomaticResponsePolicy from "../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import User from "../../../../Models/DatabaseModels/User";
import Queue from "../../../../Server/Infrastructure/Queue";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import OnCallPageService from "../../../../Server/Services/OnCallPageService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityAutomaticResponsePolicyService from "../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import { toRecordedDetection } from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityAutomaticResponse, {
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
  SecurityAutomaticResponseRecordedDetection,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";
import {
  describeSecurityAutomaticResponseDestinations,
  sortSecurityAutomaticResponsePolicies,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import SecurityAutomaticResponseOwners from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOwners";
import SecurityAutomaticResponseRules, {
  SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES,
  getSecurityAutomaticResponseLibraryEntries,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import {
  SecurityAutomaticResponseRule,
  SecurityAutomaticResponseRuleState,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import SecurityRepeatOffenders from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderRecord,
} from "../../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The pieces around a decision (#10350): the screen as detections are
 * recorded, the repeat-offender ladder's read of the blocklist, the ready
 * policies' rules in real time, the project's security owners, and the
 * order of the policies on their page.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADDRESS: string = "35.205.11.131";

function policy(
  kind: SecurityAutomaticResponsePolicyKind,
  index: number,
): SecurityAutomaticResponsePolicy {
  const made: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy(
      new ObjectID(
        `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      ),
    );
  made.projectId = PROJECT_ID;
  made.kind = kind;
  made.mode = SecurityAutomaticResponseMode.On;
  return made;
}

function recorded(
  overrides: Partial<SecurityAutomaticResponseRecordedDetection> = {},
): SecurityAutomaticResponseRecordedDetection {
  return {
    securityCaseId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    securityDetectionId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    source: SecurityDetectionSource.DetectionRule,
    mitreTechniques: ["T1190"],
    groupValue: ADDRESS,
    ...overrides,
  };
}

afterEach(() => {
  SecurityAutomaticResponse.clearCache();
  jest.restoreAllMocks();
});

describe("the screen, as detections are recorded", () => {
  let queued: Array<{ jobId: string; name: string; data: JSONObject }>;
  let policyReads: number;
  let policies: Array<SecurityAutomaticResponsePolicy>;

  beforeEach(() => {
    queued = [];
    policyReads = 0;
    policies = [
      policy(SecurityAutomaticResponsePolicyKind.Scanners, 1),
      policy(SecurityAutomaticResponsePolicyKind.PasswordGuessing, 2),
    ];
    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findActivePolicies")
      .mockImplementation(async () => {
        policyReads++;
        return policies;
      });
    jest.spyOn(Queue, "addJob").mockImplementation((async (
      _queue: unknown,
      jobId: string,
      name: string,
      data: JSONObject,
    ) => {
      queued.push({ jobId, name, data });
    }) as never);
  });

  test("queues a decision for each policy a detection may be for, at once", async () => {
    const count: number = await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [recorded()],
    });

    expect(count).toBe(1);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.name).toBe(SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB);
    expect(queued[0]!.data).toMatchObject({
      projectId: PROJECT_ID.toString(),
      securityAutomaticResponsePolicyId: policies[0]!.id!.toString(),
      address: ADDRESS,
    });
    // One decision per policy and address a minute, however many detections arrive.
    expect(queued[0]!.jobId).toMatch(
      new RegExp(
        `^security-automatic-response-${policies[0]!.id!.toString()}-35\\.205\\.11\\.131-\\d+$`,
      ),
    );
  });

  test("leaves what only the job can read - outcomes so far, the feeds - to the job", async () => {
    policies = [
      policy(SecurityAutomaticResponsePolicyKind.KnownBadAddresses, 3),
    ];

    await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [recorded({ mitreTechniques: [] })],
    });

    expect(queued).toHaveLength(1);
  });

  test("queues nothing for a setup test, a private address or a detection about a user", async () => {
    await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [
        recorded({ isSetupTest: true }),
        recorded({ groupValue: "10.0.0.4" }),
        recorded({ groupValue: "jane@example.com" }),
      ],
    });

    expect(queued).toHaveLength(0);
  });

  test("reads a project's policies once in half a minute, and again once one changes", async () => {
    await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [recorded()],
    });
    await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [recorded()],
    });

    expect(policyReads).toBe(1);

    SecurityAutomaticResponse.clearCache(PROJECT_ID);
    await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [recorded()],
    });

    expect(policyReads).toBe(2);
  });

  test("a project with no policy on reads nothing more", async () => {
    policies = [];

    expect(
      await SecurityAutomaticResponse.screen({
        projectId: PROJECT_ID,
        detections: [recorded()],
      }),
    ).toBe(0);
    expect(queued).toHaveLength(0);
  });

  test("never throws: a detection is recorded whatever a policy makes of it", async () => {
    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findActivePolicies")
      .mockRejectedValue(new Error("database unavailable"));

    expect(
      await SecurityAutomaticResponse.screen({
        projectId: PROJECT_ID,
        detections: [recorded()],
      }),
    ).toBe(0);
  });

  test("a signal is screened as it was recorded, its techniques as cases keep them", () => {
    expect(
      toRecordedDetection({
        signal: {
          projectId: PROJECT_ID,
          source: SecurityDetectionSource.DetectionRule,
          fingerprint: "f",
          title: "Brute force",
          severity: OcsfSeverity.High,
          eventCount: 12,
          groupValue: ADDRESS,
          entities: [],
          mitreTactics: [],
          mitreTechniques: ["t1110.001"],
          seenAt: new Date(),
        },
        securityCaseId: new ObjectID("33333333-3333-4333-8333-333333333333"),
        securityDetectionId: new ObjectID(
          "44444444-4444-4444-8444-444444444444",
        ),
      }),
    ).toMatchObject({
      source: SecurityDetectionSource.DetectionRule,
      mitreTechniques: ["T1110.001"],
      groupValue: ADDRESS,
      isSetupTest: false,
    });
  });
});

describe("the repeat-offender ladder's read", () => {
  let blocks: Array<SecurityBlock>;

  function block(data: {
    index: number;
    value: string;
    state?: SecurityBlockState;
    createdAt: Date;
    caseNumber?: string;
  }): SecurityBlock {
    const made: SecurityBlock = new SecurityBlock(
      new ObjectID(
        `bbbbbbbb-bbbb-4bbb-8bbb-${String(data.index).padStart(12, "0")}`,
      ),
    );
    made.value = data.value;
    made.action = SecurityBlockAction.Block;
    made.source = SecurityBlockSource.AutomaticResponse;
    made.state = data.state || SecurityBlockState.Expired;
    made.createdAt = data.createdAt;

    if (data.caseNumber) {
      const securityCase: SecurityCase = new SecurityCase();
      securityCase.caseNumberWithPrefix = data.caseNumber;
      made.securityCase = securityCase;
      made.securityCaseId = ObjectID.generate();
    }

    return made;
  }

  beforeEach(() => {
    blocks = [];
    jest.spyOn(SecurityBlockService, "findBy").mockImplementation((async () => {
      return blocks;
    }) as never);
  });

  test("counts the address's blocks, and a range's around it, never one lifted - with the latest and its case", async () => {
    blocks = [
      block({
        index: 1,
        value: ADDRESS,
        createdAt: new Date("2026-11-12T10:00:00.000Z"),
        caseNumber: "CASE-812",
      }),
      block({
        index: 2,
        value: "35.205.11.0/24",
        createdAt: new Date("2026-11-02T10:00:00.000Z"),
      }),
      block({
        index: 3,
        value: ADDRESS,
        state: SecurityBlockState.Lifted,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
      // Another address, and a range that does not hold it.
      block({
        index: 4,
        value: "35.205.11.132",
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
      }),
      block({
        index: 5,
        value: "35.205.12.0/24",
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord =
      await SecurityRepeatOffenders.read({
        projectId: PROJECT_ID,
        value: ADDRESS,
        now: new Date("2026-11-22T10:00:00.000Z"),
      });

    expect(
      record.blocks.map((made: SecurityRepeatOffenderBlock): string => {
        return made.value;
      }),
    ).toEqual([ADDRESS, ADDRESS, "35.205.11.0/24"]);
    expect(record.offenceCount).toBe(2);
    expect(record.last?.caseNumber).toBe("CASE-812");
    expect(record.last?.createdAt).toEqual(
      new Date("2026-11-12T10:00:00.000Z"),
    );
    expect(record.since).toEqual(new Date("2026-10-23T10:00:00.000Z"));
  });

  test("for a network, counts its addresses too (#10354)", async () => {
    blocks = [
      block({
        index: 1,
        value: "35.205.11.9",
        createdAt: new Date("2026-11-12T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord =
      await SecurityRepeatOffenders.read({
        projectId: PROJECT_ID,
        value: "35.205.11.0/24",
      });

    expect(record.offenceCount).toBe(1);
  });

  test("refuses what is no address or range", async () => {
    await expect(
      SecurityRepeatOffenders.read({ projectId: PROJECT_ID, value: "nope" }),
    ).rejects.toThrow("nope is not an IP address or range.");
  });
});

describe("the ready policies' rules, in real time", () => {
  let rules: Array<DetectionRule>;
  let created: Array<DetectionRule>;
  let turnedRealTime: Array<string>;
  let realTimeCount: number;

  beforeEach(() => {
    rules = [];
    created = [];
    turnedRealTime = [];
    realTimeCount = 0;
    jest.spyOn(DetectionRuleService, "findBy").mockImplementation((async () => {
      return rules;
    }) as never);
    jest
      .spyOn(DetectionRuleService, "countBy")
      .mockImplementation((async () => {
        return {
          toNumber: () => {
            return realTimeCount;
          },
        };
      }) as never);
    jest
      .spyOn(DetectionRuleService, "create")
      .mockImplementation((async (data: { data: DetectionRule }) => {
        created.push(data.data);
        return data.data;
      }) as never);
    jest
      .spyOn(DetectionRuleService, "updateOneById")
      .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
        if (data.data["isRealTime"] === true) {
          turnedRealTime.push(data.id.toString());
        }
      }) as never);
  });

  test("every library rule a ready policy acts on exists, groups on the client address and can run in real time", () => {
    for (const ids of Object.values(
      SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES,
    )) {
      for (const id of ids) {
        const entry: (typeof DETECTION_RULE_LIBRARY)[number] | undefined =
          DETECTION_RULE_LIBRARY.find(
            (candidate: DetectionRuleLibraryEntry): boolean => {
              return candidate.id === id;
            },
          );

        expect(entry).toBeDefined();
        expect(entry!.sigmaRuleYaml).not.toContain("|re");
      }
    }

    expect(
      getSecurityAutomaticResponseLibraryEntries(
        SecurityAutomaticResponsePolicyKind.Scanners,
      ).map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      }),
    ).toEqual([
      "SQL injection attempts",
      "Path traversal attempts",
      "Log4Shell exploit attempt",
      "Many Cloudflare managed rule hits from one address",
    ]);
    expect(
      getSecurityAutomaticResponseLibraryEntries(
        SecurityAutomaticResponsePolicyKind.Custom,
      ),
    ).toEqual([]);
  });

  test("adds the rules the project has not got, real-time, and turns its own real-time, leaving one it turned off off", async () => {
    const entries: Array<DetectionRuleLibraryEntry> =
      getSecurityAutomaticResponseLibraryEntries(
        SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      );
    const scheduled: DetectionRule = new DetectionRule(
      new ObjectID("cccccccc-cccc-4ccc-8ccc-000000000001"),
    );
    scheduled.name = entries[0]!.title;
    scheduled.sigmaRuleYaml = entries[0]!.sigmaRuleYaml;
    scheduled.isEnabled = true;
    scheduled.isRealTime = false;
    const off: DetectionRule = new DetectionRule(
      new ObjectID("cccccccc-cccc-4ccc-8ccc-000000000002"),
    );
    off.name = entries[1]!.title;
    off.sigmaRuleYaml = entries[1]!.sigmaRuleYaml;
    off.isEnabled = false;
    rules = [scheduled, off];

    await SecurityAutomaticResponseRules.runInRealTime({
      projectId: PROJECT_ID,
      kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
    });

    expect(turnedRealTime).toEqual([scheduled.id!.toString()]);
    expect(
      created.map((rule: DetectionRule): string => {
        return rule.name || "";
      }),
    ).toEqual([entries[2]!.title]);
    expect(created[0]!.isRealTime).toBe(true);
    expect(created[0]!.isEnabled).toBe(true);

    const read: Array<SecurityAutomaticResponseRule> =
      await SecurityAutomaticResponseRules.read({
        projectId: PROJECT_ID,
        kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      });

    expect(
      read.map(
        (
          rule: SecurityAutomaticResponseRule,
        ): SecurityAutomaticResponseRuleState => {
          return rule.state;
        },
      ),
    ).toEqual([
      SecurityAutomaticResponseRuleState.Scheduled,
      SecurityAutomaticResponseRuleState.Off,
      SecurityAutomaticResponseRuleState.Missing,
    ]);
  });

  test("leaves the rest on their schedule once the project runs 50 rules in real time", async () => {
    realTimeCount = 50;

    await SecurityAutomaticResponseRules.runInRealTime({
      projectId: PROJECT_ID,
      kind: SecurityAutomaticResponsePolicyKind.Scanners,
    });

    expect(created).toHaveLength(0);
    expect(turnedRealTime).toHaveLength(0);
  });

  test("never throws", async () => {
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      SecurityAutomaticResponseRules.runInRealTime({
        projectId: PROJECT_ID,
        kind: SecurityAutomaticResponsePolicyKind.Scanners,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the project's security owners", () => {
  function user(index: number, email: string): User {
    const made: User = new User(
      new ObjectID(
        `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`,
      ),
    );
    made.email = email as never;
    return made;
  }

  test("are its Security Admins, or its Project Owners when it has none", async () => {
    const asked: Array<Permission> = [];
    jest
      .spyOn(ProjectService, "getUsersHolding")
      .mockImplementation(
        async (_projectId: ObjectID, permission: Permission) => {
          asked.push(permission);
          return [];
        },
      );
    jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([user(1, "owner@example.com")]);

    const owners: Array<User> =
      await SecurityAutomaticResponseOwners.find(PROJECT_ID);

    expect(asked).toEqual([Permission.SecurityAdmin]);
    expect(
      owners.map((owner: User): string | undefined => {
        return owner.email?.toString();
      }),
    ).toEqual(["owner@example.com"]);
  });

  test("are paged about something new, as an alert, each through their own on-call rules", async () => {
    jest
      .spyOn(ProjectService, "getUsersHolding")
      .mockResolvedValue([user(2, "admin@example.com")]);
    const pages: Array<JSONObject> = [];
    jest.spyOn(OnCallPageService, "page").mockImplementation((async (
      request: JSONObject,
    ) => {
      pages.push(request);
      return { isAnyonePaged: true };
    }) as never);

    expect(
      await SecurityAutomaticResponseOwners.page({
        projectId: PROJECT_ID,
        title: "Automatic response stopped: 50 blocks in the last hour",
        descriptionInMarkdown: "An attack this large needs a person.",
      }),
    ).toBe(true);

    expect(pages[0]).toMatchObject({
      projectId: PROJECT_ID,
      targets: { userIds: [user(2, "admin@example.com").id] },
      about: {
        newAlert: {
          title: "Automatic response stopped: 50 blocks in the last hour",
        },
      },
      props: { isRoot: true },
    });
  });

  test("nobody to page: false, never a throw", async () => {
    jest.spyOn(ProjectService, "getUsersHolding").mockResolvedValue([]);
    jest.spyOn(ProjectService, "getOwners").mockResolvedValue([]);

    expect(
      await SecurityAutomaticResponseOwners.page({
        projectId: PROJECT_ID,
        title: "t",
        descriptionInMarkdown: "d",
      }),
    ).toBe(false);
  });
});

describe("the page's order", () => {
  test("the ready policies first, in their order, then the project's own, oldest first", () => {
    const custom: SecurityAutomaticResponsePolicy = policy(
      SecurityAutomaticResponsePolicyKind.Custom,
      9,
    );
    custom.createdAt = new Date("2026-11-01T00:00:00.000Z");
    const newer: SecurityAutomaticResponsePolicy = policy(
      SecurityAutomaticResponsePolicyKind.Custom,
      8,
    );
    newer.createdAt = new Date("2026-11-02T00:00:00.000Z");

    expect(
      sortSecurityAutomaticResponsePolicies([
        newer,
        policy(SecurityAutomaticResponsePolicyKind.KnownBadAddresses, 3),
        custom,
        policy(SecurityAutomaticResponsePolicyKind.Scanners, 1),
        policy(SecurityAutomaticResponsePolicyKind.PasswordGuessing, 2),
      ]).map((sorted: SecurityAutomaticResponsePolicy) => {
        return sorted.kind === SecurityAutomaticResponsePolicyKind.Custom
          ? sorted.createdAt!.toISOString()
          : sorted.kind;
      }),
    ).toEqual([
      SecurityAutomaticResponsePolicyKind.Scanners,
      SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
      "2026-11-01T00:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
    ]);
  });

  /*
   * A policy blocks an address at the edge, so the page names the edge's
   * destinations, and whether each can challenge; an endpoint product
   * holds an address only when it is blocked everywhere (#10346), which a
   * policy never asks, so it is not one of them.
   */
  test("the page names the destinations that hold a policy's blocks, and whether each can challenge", () => {
    expect(
      describeSecurityAutomaticResponseDestinations([
        {
          name: "Cloudflare",
          provider: SecurityBlockDestinationProvider.Cloudflare,
          canChallenge: true,
        },
        {
          name: "Palo Alto feed",
          provider: SecurityBlockDestinationProvider.Feed,
          canChallenge: false,
        },
        {
          name: "Microsoft Defender",
          provider: SecurityBlockDestinationProvider.MicrosoftDefender,
          enforcesOnEveryMachine: true,
        },
      ]),
    ).toEqual([
      {
        name: "Cloudflare",
        provider: SecurityBlockDestinationProvider.Cloudflare,
        canChallenge: true,
      },
      {
        name: "Palo Alto feed",
        provider: SecurityBlockDestinationProvider.Feed,
        canChallenge: false,
      },
    ]);
  });
});
