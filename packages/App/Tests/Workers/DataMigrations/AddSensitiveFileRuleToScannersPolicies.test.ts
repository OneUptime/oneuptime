import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityAutomaticResponsePolicy from "Common/Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import DetectionRuleService from "Common/Server/Services/DetectionRuleService";
import SecurityAutomaticResponsePolicyService from "Common/Server/Services/SecurityAutomaticResponsePolicyService";
import logger from "Common/Server/Utils/Logger";
import { getSecurityAutomaticResponseLibraryEntries } from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  DetectionRuleLibraryEntry,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import AddSensitiveFileRuleToScannersPolicies, {
  SCANNERS_POLICIES_PAGE_SIZE,
  SENSITIVE_FILE_RULE_LOCK_NAMESPACE,
} from "../../../FeatureSet/Workers/DataMigrations/AddSensitiveFileRuleToScannersPolicies";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AddSensitiveFileRuleToScannersPolicies (#10745): Scanning for sensitive
 * files is a rule the Scanners policy acts on now, and turning the policy
 * on adds its rules in real time - so a project that turned it on before
 * gets that one rule, as turning it on would have added it, and nothing
 * else of the policy's. End to end with the real runInRealTime, over a
 * store of each project's rules:
 *
 *   - registered once, before the two slots kept last;
 *   - reads only Scanners policies in their trial run or on, as OneUptime,
 *     oldest first, a page at a time;
 *   - each project gets the rule once, in real time, under its own lock -
 *     a rule of the policy's it deleted stays deleted, one it turned off
 *     stays off, and past 50 real-time rules it waits on its schedule;
 *   - run twice, the second adds nothing; a lock it cannot take or give
 *     back does not stop it; rollback changes nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const MIGRATION_NAME: string = "AddSensitiveFileRuleToScannersPolicies";

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function projectId(index: number): ObjectID {
  return new ObjectID(
    `10745000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

function policyOf(
  project: ObjectID | undefined,
): SecurityAutomaticResponsePolicy {
  const policy: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy(ObjectID.generate());

  if (project) {
    policy.projectId = project;
  }

  return policy;
}

function scannersEntry(title: string): DetectionRuleLibraryEntry {
  return getSecurityAutomaticResponseLibraryEntries(
    SecurityAutomaticResponsePolicyKind.Scanners,
  ).find((entry: DetectionRuleLibraryEntry): boolean => {
    return entry.title === title;
  })!;
}

// A rule a project made from the library, as it stands.
function projectRule(
  project: ObjectID,
  entry: DetectionRuleLibraryEntry,
  state: { isEnabled: boolean; isRealTime: boolean },
): DetectionRule {
  const rule: DetectionRule = new DetectionRule(ObjectID.generate());
  rule.projectId = project;
  rule.name = entry.title;
  rule.sigmaRuleYaml = entry.sigmaRuleYaml;
  rule.isEnabled = state.isEnabled;
  rule.isRealTime = state.isRealTime;
  return rule;
}

let policies: Array<SecurityAutomaticResponsePolicy>;
let policyReads: Array<JSONObject>;
// Each project's rules, by project id.
let store: Map<string, Array<DetectionRule>>;
let created: Array<DetectionRule>;
let locks: Array<JSONObject>;
let released: number;

function rulesOf(project: ObjectID): Array<DetectionRule> {
  const key: string = project.toString();

  if (!store.has(key)) {
    store.set(key, []);
  }

  return store.get(key)!;
}

beforeEach(() => {
  policies = [];
  policyReads = [];
  store = new Map<string, Array<DetectionRule>>();
  created = [];
  locks = [];
  released = 0;

  jest
    .spyOn(SecurityAutomaticResponsePolicyService, "findBy")
    .mockImplementation((async (data: JSONObject) => {
      policyReads.push(data);

      const skip: number = Number(data["skip"]);
      const limit: number = Number(data["limit"]);

      return policies.slice(skip, skip + limit);
    }) as never);
  jest.spyOn(DetectionRuleService, "findBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }) => {
    return [...rulesOf(data.query.projectId)];
  }) as never);
  jest.spyOn(DetectionRuleService, "countBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }) => {
    const count: number = rulesOf(data.query.projectId).filter(
      (rule: DetectionRule): boolean => {
        return rule.isRealTime === true;
      },
    ).length;

    return {
      toNumber: (): number => {
        return count;
      },
    };
  }) as never);
  jest.spyOn(DetectionRuleService, "create").mockImplementation((async (data: {
    data: DetectionRule;
  }) => {
    created.push(data.data);
    rulesOf(data.data.projectId!).push(data.data);
    return data.data;
  }) as never);
  jest
    .spyOn(DetectionRuleService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      for (const rules of store.values()) {
        for (const rule of rules) {
          if (rule.id?.toString() === data.id.toString()) {
            rule.isRealTime = data.data["isRealTime"] as boolean;
          }
        }
      }

      return 1;
    }) as never);
  jest.spyOn(Semaphore, "lock").mockImplementation((async (
    data: JSONObject,
  ) => {
    locks.push(data);
    return { key: data["key"] };
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation((async () => {
    released++;
  }) as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sensitiveRulesOf(project: ObjectID): Array<DetectionRule> {
  return rulesOf(project).filter((rule: DetectionRule): boolean => {
    return rule.name === "Scanning for sensitive files";
  });
}

describe("AddSensitiveFileRuleToScannersPolicies", () => {
  test("is registered once, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(new AddSensitiveFileRuleToScannersPolicies().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("reads only the Scanners policies in their trial run or on, as OneUptime, oldest first", async () => {
    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(policyReads).toHaveLength(1);

    const read: JSONObject = policyReads[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(query["kind"]).toBe(SecurityAutomaticResponsePolicyKind.Scanners);
    expect(query["mode"]).toBeInstanceOf(Includes);
    expect((query["mode"] as Includes).values).toEqual([
      SecurityAutomaticResponseMode.TrialRun,
      SecurityAutomaticResponseMode.On,
    ]);
    expect(read["select"]).toEqual({ _id: true, projectId: true });
    expect(read["sort"]).toEqual({ createdAt: SortOrder.Ascending });
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["limit"]).toBe(SCANNERS_POLICIES_PAGE_SIZE);
  });

  test("each project gets the rule, in real time, and nothing else of the policy's", async () => {
    const first: ObjectID = projectId(1);
    const second: ObjectID = projectId(2);
    // The first project deleted SQL injection attempts, and runs path traversal on its schedule.
    const pathTraversal: DetectionRule = projectRule(
      first,
      scannersEntry("Path traversal attempts"),
      { isEnabled: true, isRealTime: false },
    );
    rulesOf(first).push(pathTraversal);
    policies = [policyOf(first), policyOf(second)];

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    for (const project of [first, second]) {
      const rules: Array<DetectionRule> = sensitiveRulesOf(project);

      expect(rules).toHaveLength(1);
      expect(rules[0]!.isRealTime).toBe(true);
      expect(rules[0]!.isEnabled).toBe(true);
      expect(rules[0]!.sigmaRuleYaml).toContain(
        `id: ${SCANNING_FOR_SENSITIVE_FILES_RULE_ID}`,
      );
    }

    // Nothing else: no SQL injection rule back, path traversal still on its schedule.
    expect(created).toHaveLength(2);
    expect(pathTraversal.isRealTime).toBe(false);
    expect(
      rulesOf(first).map((rule: DetectionRule): string => {
        return rule.name || "";
      }),
    ).toEqual(["Path traversal attempts", "Scanning for sensitive files"]);
  });

  test("a rule the project has and turned off stays off; one on its schedule runs in real time", async () => {
    const off: ObjectID = projectId(3);
    const scheduled: ObjectID = projectId(4);
    const offRule: DetectionRule = projectRule(
      off,
      scannersEntry("Scanning for sensitive files"),
      { isEnabled: false, isRealTime: false },
    );
    const scheduledRule: DetectionRule = projectRule(
      scheduled,
      scannersEntry("Scanning for sensitive files"),
      { isEnabled: true, isRealTime: false },
    );
    rulesOf(off).push(offRule);
    rulesOf(scheduled).push(scheduledRule);
    policies = [policyOf(off), policyOf(scheduled)];

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(created).toEqual([]);
    expect(offRule.isEnabled).toBe(false);
    expect(offRule.isRealTime).toBe(false);
    expect(scheduledRule.isRealTime).toBe(true);
  });

  test("a project already running 50 rules in real time gets nothing yet: the policy's card says so", async () => {
    const busy: ObjectID = projectId(5);

    for (let index: number = 0; index < 50; index++) {
      const rule: DetectionRule = new DetectionRule(ObjectID.generate());
      rule.projectId = busy;
      rule.name = `Our rule ${index}`;
      rule.isEnabled = true;
      rule.isRealTime = true;
      rulesOf(busy).push(rule);
    }

    policies = [policyOf(busy)];

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(created).toEqual([]);
  });

  test("run twice, the rule is added once", async () => {
    const project: ObjectID = projectId(6);
    policies = [policyOf(project)];

    await new AddSensitiveFileRuleToScannersPolicies().migrate();
    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(sensitiveRulesOf(project)).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  test("each project's turn is taken under its own lock, and the lock is given back", async () => {
    const first: ObjectID = projectId(7);
    const second: ObjectID = projectId(8);
    policies = [policyOf(first), policyOf(second)];

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(
      locks.map((lock: JSONObject): unknown => {
        return [lock["key"], lock["namespace"]];
      }),
    ).toEqual([
      [first.toString(), SENSITIVE_FILE_RULE_LOCK_NAMESPACE],
      [second.toString(), SENSITIVE_FILE_RULE_LOCK_NAMESPACE],
    ]);
    expect(released).toBe(2);
  });

  test("a lock it cannot take, or give back, does not keep the rule from the project", async () => {
    const project: ObjectID = projectId(9);
    policies = [policyOf(project)];
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("Redis down"));

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(sensitiveRulesOf(project)).toHaveLength(1);

    const other: ObjectID = projectId(10);
    policies = [policyOf(other)];
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockRejectedValue(new Error("Redis down"));

    await expect(
      new AddSensitiveFileRuleToScannersPolicies().migrate(),
    ).resolves.toBeUndefined();
    expect(sensitiveRulesOf(other)).toHaveLength(1);
  });

  test("reads every page, however many projects turned the policy on, and skips a policy with no project", async () => {
    policies = Array.from(
      { length: SCANNERS_POLICIES_PAGE_SIZE + 2 },
      (_value: unknown, index: number): SecurityAutomaticResponsePolicy => {
        return policyOf(projectId(100 + index));
      },
    );
    policies.push(policyOf(undefined));

    await new AddSensitiveFileRuleToScannersPolicies().migrate();

    expect(
      policyReads.map((read: JSONObject): number => {
        return Number(read["skip"]);
      }),
    ).toEqual([0, SCANNERS_POLICIES_PAGE_SIZE]);
    expect(created).toHaveLength(SCANNERS_POLICIES_PAGE_SIZE + 2);
  });

  test("rollback changes nothing", async () => {
    policies = [policyOf(projectId(11))];

    await new AddSensitiveFileRuleToScannersPolicies().rollback();

    expect(policyReads).toEqual([]);
    expect(created).toEqual([]);
  });
});
