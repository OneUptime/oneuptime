import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import logger from "../../../../Server/Utils/Logger";
import NewRecommendedRuleRollout, {
  NewRecommendedRuleOutcome,
  NewRecommendedRuleRolloutSummary,
  READ_ROLLOUT_CANDIDATES_SQL,
  ROLLOUT_FIRST_PROJECT_ID,
  ROLLOUT_PROJECTS_PAGE_SIZE,
  getRolloutCandidateValues,
  getRolloutSibling,
} from "../../../../Server/Utils/SecurityEvent/NewRecommendedRuleRollout";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { getDetectionRuleLibraryResponseSteps } from "../../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import { buildDetectionRuleFromLibrary } from "../../../../Utils/SecurityEvent/SecurityTemplateRecords";

/*
 * A NEW RECOMMENDED RULE, IN THE PROJECTS THAT RUN EVERY OTHER ONE (#11037),
 * with Postgres stood in for: which projects are read, which get the rule
 * and which are left as they chose, how the rule is added, and how a run
 * that meets a failure goes on. NewRecommendedRuleRolloutPostgres runs the
 * same against a migrated Postgres.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const SERVED: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SENSITIVE_FILE_SERVED_RULE_ID,
)!;

function projectId(index: number): ObjectID {
  return new ObjectID(
    `11037000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

// Each project's rules, by project id.
let store: Map<string, Array<DetectionRule>>;
let created: Array<DetectionRule>;
let queries: Array<{ sql: string; values: Array<unknown> }>;
let locks: Array<JSONObject>;
let released: number;

function rulesOf(project: ObjectID): Array<DetectionRule> {
  const key: string = project.toString();

  if (!store.has(key)) {
    store.set(key, []);
  }

  return store.get(key)!;
}

function give(
  project: ObjectID,
  entry: DetectionRuleLibraryEntry,
  state: { isEnabled?: boolean; name?: string } = {},
): DetectionRule {
  const rule: DetectionRule = buildDetectionRuleFromLibrary({
    projectId: project,
    entry,
  });
  rule.id = ObjectID.generate();
  rule.isEnabled = state.isEnabled === undefined ? true : state.isEnabled;

  if (state.name) {
    rule.name = state.name;
  }

  rulesOf(project).push(rule);

  return rule;
}

// Every recommended rule but Sensitive file served, on.
function giveEveryOther(project: ObjectID): void {
  for (const entry of getRecommendedDetectionRules()) {
    if (entry.id !== SERVED.id) {
      give(project, entry);
    }
  }
}

beforeEach(() => {
  store = new Map();
  created = [];
  queries = [];
  locks = [];
  released = 0;

  // The candidates: every project with a rule of the sibling, on, after the id asked, in id order.
  jest.spyOn(DetectionRuleService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        values: Array<unknown>,
      ): Promise<Array<JSONObject>> => {
        queries.push({ sql, values });

        const after: string = String(values[0]);
        const limit: number = Number(values[3]);
        const sibling: DetectionRuleLibraryEntry = getRolloutSibling(
          SERVED.id,
        )!;

        return Array.from(store.keys())
          .filter((key: string): boolean => {
            return (
              key > after &&
              store.get(key)!.some((rule: DetectionRule): boolean => {
                return (
                  rule.isEnabled === true &&
                  ((rule.sigmaRuleYaml || "").includes(`id: ${sibling.id}`) ||
                    (rule.name || "").trim().toLowerCase() ===
                      sibling.title.trim().toLowerCase())
                );
              })
            );
          })
          .sort()
          .slice(0, limit)
          .map((key: string): JSONObject => {
            return { projectId: key };
          });
      },
    },
  } as never);
  jest.spyOn(DetectionRuleService, "findBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }) => {
    return [...rulesOf(data.query.projectId)];
  }) as never);
  jest.spyOn(DetectionRuleService, "create").mockImplementation((async (data: {
    data: DetectionRule;
    props: JSONObject;
  }) => {
    expect(data.props).toEqual({ isRoot: true });
    created.push(data.data);
    rulesOf(data.data.projectId!).push(data.data);
    return data.data;
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

  for (const level of ["info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function rollOut(): Promise<NewRecommendedRuleRolloutSummary> {
  return NewRecommendedRuleRollout.addToProjectsRunningEveryOtherRecommendedRule(
    {
      libraryRuleId: SERVED.id,
      lockNamespace: "Test",
      now: NOW,
    },
  );
}

describe("a project that runs every other recommended rule", () => {
  test("gets Sensitive file served, on and opening cases, as Turn on recommended adds it - and said to be OneUptime's", async () => {
    giveEveryOther(projectId(1));

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(summary.outcomes[NewRecommendedRuleOutcome.Added]).toBe(1);
    expect(created).toHaveLength(1);

    const rule: DetectionRule = created[0]!;
    const asTurnOnAddsIt: DetectionRule = buildDetectionRuleFromLibrary({
      projectId: projectId(1),
      entry: SERVED,
    });

    expect(rule.projectId!.toString()).toBe(projectId(1).toString());
    expect(rule.name).toBe("Sensitive file served");
    expect(rule.sigmaRuleYaml).toBe(SERVED.sigmaRuleYaml);
    expect(rule.isEnabled).toBe(true);
    expect(rule.shouldCreateCase).toBe(true);
    expect(rule.shouldCreateAlert).toBe(false);
    expect(rule.shouldCreateIncident).toBe(false);
    expect(rule.matchCountThreshold).toBe(asTurnOnAddsIt.matchCountThreshold);
    expect(rule.groupByField).toBe("principalIp");
    expect(rule.responseSteps).toEqual(
      getDetectionRuleLibraryResponseSteps(SERVED.id),
    );
    // Never in real time: Turn on recommended adds it on its schedule.
    expect(rule.isRealTime).toBeUndefined();
    expect(rule.addedByOneUptimeAt).toEqual(NOW);
  });

  test("each project under its own lock, given back after", async () => {
    giveEveryOther(projectId(1));
    giveEveryOther(projectId(2));

    await rollOut();

    expect(
      locks.map((lock: JSONObject): unknown => {
        return lock["key"];
      }),
    ).toEqual([projectId(1).toString(), projectId(2).toString()]);
    expect(locks[0]!["namespace"]).toBe("Test");
    expect(released).toBe(2);
  });

  test("run twice, the second adds nothing", async () => {
    giveEveryOther(projectId(1));

    await rollOut();
    const second: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(created).toHaveLength(1);
    expect(second.outcomes[NewRecommendedRuleOutcome.Added]).toBe(0);
    expect(second.outcomes[NewRecommendedRuleOutcome.AlreadyHas]).toBe(1);
  });
});

describe("a project left as it chose", () => {
  test("one that turned a recommended rule off, or deleted one, chose its own set", async () => {
    giveEveryOther(projectId(1));
    rulesOf(projectId(1)).find((rule: DetectionRule): boolean => {
      return (rule.sigmaRuleYaml || "").includes(
        `id: ${SCANNING_FOR_SENSITIVE_FILES_RULE_ID}`,
      );
    })!.isEnabled = false;

    giveEveryOther(projectId(2));
    // Its last recommended rule deleted; the sibling kept, so it is read.
    store.set(projectId(2).toString(), rulesOf(projectId(2)).slice(0, -1));

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(created).toEqual([]);
    expect(summary.outcomes[NewRecommendedRuleOutcome.ChoseOwnSet]).toBe(2);
  });

  test("one with a rule of it already - on, off, or renamed - keeps it as it is", async () => {
    giveEveryOther(projectId(1));
    give(projectId(1), SERVED, { isEnabled: false });
    giveEveryOther(projectId(2));
    give(projectId(2), SERVED, { name: "Leaked secrets" });

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(created).toEqual([]);
    expect(summary.outcomes[NewRecommendedRuleOutcome.AlreadyHas]).toBe(2);
    expect(
      rulesOf(projectId(1)).filter((rule: DetectionRule): boolean => {
        return rule.name === "Sensitive file served";
      })[0]!.isEnabled,
    ).toBe(false);
  });

  test("a project with none of the recommended rules is never read at all", async () => {
    const own: DetectionRule = new DetectionRule(ObjectID.generate());
    own.projectId = projectId(1);
    own.name = "Our rule";
    own.sigmaRuleYaml = "title: ours";
    own.isEnabled = true;
    rulesOf(projectId(1)).push(own);

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(summary.candidates).toBe(0);
    expect(DetectionRuleService.findBy).not.toHaveBeenCalled();
  });
});

describe("which projects are read", () => {
  test("a page at a time, after the last project's id, with the sibling rule's id and name", async () => {
    for (
      let index: number = 1;
      index <= ROLLOUT_PROJECTS_PAGE_SIZE + 2;
      index++
    ) {
      give(projectId(index), getRolloutSibling(SERVED.id)!);
    }

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(summary.candidates).toBe(ROLLOUT_PROJECTS_PAGE_SIZE + 2);
    // They run only the sibling: every one chose its own set.
    expect(summary.outcomes[NewRecommendedRuleOutcome.ChoseOwnSet]).toBe(
      ROLLOUT_PROJECTS_PAGE_SIZE + 2,
    );
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toBe(READ_ROLLOUT_CANDIDATES_SQL);

    const sibling: DetectionRuleLibraryEntry = getRolloutSibling(SERVED.id)!;

    expect(queries[0]!.values).toEqual([
      ROLLOUT_FIRST_PROJECT_ID,
      `%id: ${sibling.id}%`,
      sibling.title.toLowerCase(),
      ROLLOUT_PROJECTS_PAGE_SIZE,
    ]);
    expect(queries[1]!.values[0]).toBe(
      projectId(ROLLOUT_PROJECTS_PAGE_SIZE).toString(),
    );
  });

  test("the sibling is the first other recommended rule, and the statement reads only rules that are on and not deleted", () => {
    const sibling: DetectionRuleLibraryEntry = getRolloutSibling(SERVED.id)!;

    expect(isRecommendedDetectionRule(sibling)).toBe(true);
    expect(sibling.id).not.toBe(SERVED.id);
    expect(sibling).toBe(getRecommendedDetectionRules()[0]);
    expect(getRolloutCandidateValues(sibling)).toEqual({
      yamlPattern: `%id: ${sibling.id}%`,
      name: sibling.title.trim().toLowerCase(),
    });
    // Nothing in the id a LIKE would read as a wildcard.
    expect(sibling.id).toMatch(/^[0-9a-f-]+$/);
    expect(READ_ROLLOUT_CANDIDATES_SQL).toContain(`"isEnabled" = true`);
    expect(READ_ROLLOUT_CANDIDATES_SQL).toContain(`"deletedAt" IS NULL`);
    expect(READ_ROLLOUT_CANDIDATES_SQL).toContain(`ORDER BY "projectId" ASC`);
  });

  test("an id that is no recommended rule is refused before anything is read", async () => {
    const notRecommended: DetectionRuleLibraryEntry =
      DETECTION_RULE_LIBRARY.find(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return !isRecommendedDetectionRule(entry);
        },
      )!;

    for (const libraryRuleId of [notRecommended.id, "not a rule"]) {
      await expect(
        NewRecommendedRuleRollout.addToProjectsRunningEveryOtherRecommendedRule(
          { libraryRuleId, lockNamespace: "Test" },
        ),
      ).rejects.toThrow("is no recommended rule");
    }

    expect(queries).toEqual([]);
  });
});

describe("a run that meets a failure goes on", () => {
  test("a project whose rule cannot be added is logged, and the next still gets it", async () => {
    giveEveryOther(projectId(1));
    giveEveryOther(projectId(2));

    jest
      .spyOn(DetectionRuleService, "create")
      .mockRejectedValueOnce(new Error("could not save"))
      .mockImplementation((async (data: { data: DetectionRule }) => {
        created.push(data.data);
        return data.data;
      }) as never);

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(summary.outcomes[NewRecommendedRuleOutcome.Failed]).toBe(1);
    expect(summary.outcomes[NewRecommendedRuleOutcome.Added]).toBe(1);
    expect(created[0]!.projectId!.toString()).toBe(projectId(2).toString());
    expect(logger.error).toHaveBeenCalled();
    // Its lock was given back all the same.
    expect(released).toBe(2);
  });

  test("a lock it cannot take, or give back, does not stop it", async () => {
    giveEveryOther(projectId(1));
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no Redis"));

    const summary: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(summary.outcomes[NewRecommendedRuleOutcome.Added]).toBe(1);
    expect(logger.warn).toHaveBeenCalled();

    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      return { key: "x" };
    }) as never);
    jest.spyOn(Semaphore, "release").mockRejectedValue(new Error("gone"));
    giveEveryOther(projectId(2));

    const again: NewRecommendedRuleRolloutSummary = await rollOut();

    expect(again.outcomes[NewRecommendedRuleOutcome.Added]).toBe(1);
  });

  test("a read of the candidates that fails fails the run: it is tried again on the next start", async () => {
    jest.spyOn(DetectionRuleService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<never> => {
          throw new Error("Postgres is away");
        },
      },
    } as never);

    await expect(rollOut()).rejects.toThrow("Postgres is away");
  });
});
