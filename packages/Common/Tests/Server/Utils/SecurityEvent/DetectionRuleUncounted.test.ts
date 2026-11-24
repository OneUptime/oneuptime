import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../Server/Utils/Logger";
import DetectionRuleExceptions, {
  LoadedDetectionRuleException,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleExceptions";
import DetectionRuleUncountedReader, {
  DETECTION_RULE_UNCOUNTED_CACHE_TTL_MS,
  UNCOUNTED_READ_PARAMETER_BUDGET,
  UncountedRuleRead,
  buildUncountedRulesStatement,
  getRulesThatLeaveOutEvents,
  getUncountedCacheKey,
  packUncountedRules,
  readUncountedRulesRow,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleUncounted";
import { MAX_DETECTION_READ_PARAMETERS } from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "../../../../Types/SecurityEvent/DetectionRuleException";
import {
  DetectionRulesUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
} from "../../../../Types/SecurityEvent/DetectionRuleUncounted";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * #10547: A DETECTION RULE SAYS, WHERE IT IS LISTED, WHAT IT COULD NOT
 * COUNT.
 *
 * A rule that counts per value leaves out the matching events that have no
 * value for its field (#10415); only Run on Past Events said so. Detection
 * Rules now asks, for the rules it lists, how many of the last day's
 * matching events each could not count, and how many of those a scrub rule
 * hid.
 *
 * The cost on that page is what these hold: only the enabled single rules
 * that leave events out, all in one read of the last day, each condition
 * written once, their exceptions in one read, and each answer kept five
 * minutes. The statement's validity on ClickHouse itself is held by
 * DetectionRuleUncountedClickhouse (App tests).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10547000-0000-4000-8000-000000000001",
);
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

const FAILED_SIGN_INS: string = `title: Brute force from one IP address
id: acf2a37e-301a-46de-87c7-d4343f3a8445
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

const SUDO: string = `title: Sudo by an unusual user
detection:
  selection:
    className: Process Activity
  condition: selection
`;

const CORRELATION: string = `title: Failed then succeeded
name: failed_then_succeeded
correlation:
  type: temporal_ordered
  rules:
    - failed
    - succeeded
  group-by:
    - principalIp
  timespan: 10m
---
title: Failed
name: failed
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Succeeded
name: succeeded
detection:
  selection:
    statusName: Success
  condition: selection
`;

function rule(data: {
  id: string;
  yaml?: string;
  groupByField?: string;
  distinctCountField?: string;
  matchCountThreshold?: number;
  isEnabled?: boolean;
}): DetectionRule {
  const saved: DetectionRule = new DetectionRule();

  Object.assign(saved, {
    _id: data.id,
    isEnabled: data.isEnabled ?? true,
    sigmaRuleYaml: data.yaml ?? FAILED_SIGN_INS,
    groupByField: data.groupByField ?? "principalIp",
    distinctCountField: data.distinctCountField ?? "",
    matchCountThreshold: data.matchCountThreshold ?? 10,
  });

  return saved;
}

const BRUTE_FORCE_ID: string = "10547000-0000-4000-8000-0000000000b1";
const SPRAYING_ID: string = "10547000-0000-4000-8000-0000000000b2";
const PER_EVENT_ID: string = "10547000-0000-4000-8000-0000000000b3";

function read(groupByField: string, index: number): UncountedRuleRead {
  return {
    detectionRuleId: `rule-${index}`,
    groupByField,
    ruleWhere: SQL`className = ${{
      type: TableColumnType.Text,
      value: "Authentication",
    }}`,
    skipped: null,
  };
}

function statementFor(
  rules: Array<UncountedRuleRead>,
  keptAt?: Date | undefined,
): Statement {
  return buildUncountedRulesStatement({
    projectId: PROJECT_ID,
    tableName: "oneuptime.SecurityEvent",
    rules,
    serviceFilter: {},
    startTime: new Date("2026-11-23T12:00:00.000Z"),
    endTime: NOW,
    keptAt,
  });
}

describe("the read", () => {
  test("each rule's condition written once, four counts a rule, only events some rule matched", () => {
    const statement: Statement = statementFor([
      read("principalIp", 0),
      read("principalUser", 1),
    ]);
    const query: string = statement.query;

    expect(query.startsWith("WITH (")).toBe(true);
    expect(query.match(/className = /g)).toHaveLength(2);

    for (const index of [0, 1]) {
      expect(query).toContain(`AS __matches_${index}`);
      expect(query).toContain(`AS __skipped_${index}`);
      expect(query).toContain(`AS __hasValue_${index}`);
      expect(query).toContain(`AS __hidden_${index}`);
      expect(query).toContain(`AS __inTraces_${index}`);
      expect(query).toContain(
        `countIf(__matches_${index} AND NOT __skipped_${index}) AS matched_${index}`,
      );
      expect(query).toContain(
        `countIf(__matches_${index} AND NOT __skipped_${index} AND NOT __hasValue_${index}) AS uncounted_${index}`,
      );
      expect(query).toContain(`AS hiddenInLogs_${index}`);
      expect(query).toContain(`AS hiddenInTraces_${index}`);
    }

    expect(query).toContain("AND (__matches_0 OR __matches_1)");
    expect(query).toContain("FROM oneuptime.SecurityEvent WHERE projectId =");
  });

  test("a rule with no exception skips nothing", () => {
    expect(statementFor([read("principalIp", 0)]).query).toContain(
      "(false) AS __skipped_0",
    );
  });

  test("a rule's exceptions are its own: written into its own counts", () => {
    const statement: Statement = statementFor([
      {
        ...read("principalIp", 0),
        skipped: SQL`principalIp = ${{
          type: TableColumnType.Text,
          value: "10.9.9.9",
        }}`,
      },
      read("principalIp", 1),
    ]);

    expect(statement.query).toMatch(/\(principalIp = .+\) AS __skipped_0/);
    expect(statement.query).toContain("(false) AS __skipped_1");
    expect(Object.values(statement.query_params)).toContain("10.9.9.9");
  });

  test("an address and a user are each told hidden by their own marker", () => {
    const params: Array<unknown> = Object.values(
      statementFor([read("principalIp", 0), read("principalUser", 1)])
        .query_params,
    );

    expect(params).toContain("oneuptime.request.client_address_hidden");
    expect(params).toContain("oneuptime.principal_user_hidden");
  });

  test("only the events still kept, stopped at the interactive time limit", () => {
    const query: string = statementFor([read("principalIp", 0)], NOW).query;

    expect(query).toContain("AND retentionDate >=");
    expect(query).toContain("SETTINGS");
    expect(query).toContain("max_execution_time");
  });
});

describe("packing rules into reads", () => {
  test("as many as fit go in one read", () => {
    const rules: Array<UncountedRuleRead> = [0, 1, 2, 3, 4].map(
      (index: number): UncountedRuleRead => {
        return read("principalIp", index);
      },
    );

    expect(packUncountedRules(rules)).toEqual([rules]);
  });

  test("more than one read's parameters: as few reads as they fit in, in order", () => {
    const rules: Array<UncountedRuleRead> = [0, 1, 2, 3, 4].map(
      (index: number): UncountedRuleRead => {
        return read("principalIp", index);
      },
    );

    const packs: Array<Array<UncountedRuleRead>> = packUncountedRules(
      rules,
      12,
    );

    expect(packs.length).toBeGreaterThan(1);
    expect(packs.flat()).toEqual(rules);

    for (const pack of packs) {
      expect(
        Object.keys(statementFor(pack).query_params).length,
      ).toBeLessThanOrEqual(MAX_DETECTION_READ_PARAMETERS);
    }
  });

  test("the budget leaves room for the read's own parameters", () => {
    expect(UNCOUNTED_READ_PARAMETER_BUDGET).toBeLessThan(
      MAX_DETECTION_READ_PARAMETERS,
    );
  });
});

describe("what a read's row says", () => {
  test("each rule that left events out, by its place in the read", () => {
    const row: JSONObject = {
      matched_0: "1210",
      uncounted_0: "1204",
      hiddenInLogs_0: "1180",
      hiddenInTraces_0: "4",
      matched_1: "37",
      uncounted_1: "0",
      hiddenInLogs_1: "0",
      hiddenInTraces_1: "0",
    };

    expect(
      readUncountedRulesRow({
        row,
        rules: [read("principalIp", 0), read("principalUser", 1)],
      }),
    ).toEqual([
      {
        detectionRuleId: "rule-0",
        field: "principalIp",
        matchedCount: 1210,
        uncountedCount: 1204,
        hiddenInLogsCount: 1180,
        hiddenInTracesCount: 4,
      },
    ]);
  });

  test("no row is nothing left out", () => {
    expect(
      readUncountedRulesRow({
        row: undefined,
        rules: [read("principalIp", 0)],
      }),
    ).toEqual([]);
  });
});

describe("which rules are counted", () => {
  test("only enabled rules that group by a field and need more than one event in a group", () => {
    expect(
      getRulesThatLeaveOutEvents([
        rule({ id: BRUTE_FORCE_ID, matchCountThreshold: 10 }),
        rule({
          id: SPRAYING_ID,
          distinctCountField: "principalUser",
          matchCountThreshold: 5,
        }),
        // Fires on each event: lumping events with no value changes nothing.
        rule({ id: PER_EVENT_ID, matchCountThreshold: 1 }),
        rule({
          id: "10547000-0000-4000-8000-0000000000b4",
          groupByField: "",
        }),
        rule({
          id: "10547000-0000-4000-8000-0000000000b5",
          isEnabled: false,
        }),
        rule({ id: "10547000-0000-4000-8000-0000000000b6", yaml: "" }),
      ]).map((counting: { id: string }): string => {
        return counting.id;
      }),
    ).toEqual([BRUTE_FORCE_ID, SPRAYING_ID]);
  });

  test("an answer is kept for the rules as they stand and the reader's sources", () => {
    const counting: ReturnType<typeof getRulesThatLeaveOutEvents> =
      getRulesThatLeaveOutEvents([rule({ id: BRUTE_FORCE_ID })]);
    const key: string = getUncountedCacheKey({
      projectId: PROJECT_ID,
      rules: counting,
      serviceFilter: {},
    });

    expect(
      getUncountedCacheKey({
        projectId: PROJECT_ID,
        rules: getRulesThatLeaveOutEvents([
          rule({ id: BRUTE_FORCE_ID, groupByField: "principalUser" }),
        ]),
        serviceFilter: {},
      }),
    ).not.toBe(key);
    expect(
      getUncountedCacheKey({
        projectId: PROJECT_ID,
        rules: counting,
        serviceFilter: { serviceIds: [new ObjectID(PER_EVENT_ID)] },
      }),
    ).not.toBe(key);
    expect(
      getUncountedCacheKey({
        projectId: PROJECT_ID,
        rules: getRulesThatLeaveOutEvents([
          rule({ id: BRUTE_FORCE_ID, yaml: SUDO }),
        ]),
        serviceFilter: {},
      }),
    ).not.toBe(key);
    expect(DETECTION_RULE_UNCOUNTED_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe("asking for a page of rules", () => {
  let findRules: SpyInstance;
  let loadExceptions: SpyInstance;
  let query: SpyInstance;

  function answerWith(row: JSONObject): void {
    query = getJestSpyOn(
      SecurityEventService,
      "executeQuery",
    ).mockResolvedValue({
      json: async (): Promise<JSONObject> => {
        return { data: [row] };
      },
    } as never);
  }

  async function ask(
    ids: Array<string> = [BRUTE_FORCE_ID, SPRAYING_ID, PER_EVENT_ID],
  ): Promise<DetectionRulesUncounted> {
    return DetectionRuleUncountedReader.read({
      projectId: PROJECT_ID,
      detectionRuleIds: ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      props: { isRoot: true },
      serviceFilter: {},
      now: NOW,
    });
  }

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    DetectionRuleUncountedReader.clearCache();

    findRules = getJestSpyOn(DetectionRuleService, "findBy").mockResolvedValue([
      rule({ id: BRUTE_FORCE_ID, matchCountThreshold: 10 }),
      rule({
        id: SPRAYING_ID,
        distinctCountField: "principalUser",
        matchCountThreshold: 5,
      }),
      rule({ id: PER_EVENT_ID, matchCountThreshold: 1 }),
    ] as never);

    loadExceptions = getJestSpyOn(
      DetectionRuleExceptions,
      "loadForProject",
    ).mockResolvedValue(new Map() as never);

    // The read's rules in id order: brute force (0), then spraying (1).
    answerWith({
      matched_0: 1210,
      uncounted_0: 1204,
      hiddenInLogs_0: 1180,
      hiddenInTraces_0: 0,
      matched_1: 40,
      uncounted_1: 40,
      hiddenInLogs_1: 40,
      hiddenInTraces_1: 0,
    });
  });

  afterEach(() => {
    DetectionRuleUncountedReader.clearCache();
    jest.restoreAllMocks();
  });

  test("the rules that left events out, with what a scrub rule hid", async () => {
    expect(await ask()).toEqual({
      periodInHours: 24,
      rules: [
        {
          detectionRuleId: BRUTE_FORCE_ID,
          field: "principalIp",
          matchedCount: 1210,
          uncountedCount: 1204,
          hiddenInLogsCount: 1180,
          hiddenInTracesCount: 0,
        },
        {
          detectionRuleId: SPRAYING_ID,
          field: "principalIp",
          matchedCount: 40,
          uncountedCount: 40,
          hiddenInLogsCount: 40,
          hiddenInTracesCount: 0,
        },
      ],
    });
  });

  test("one read of the events for every rule, and one read of their exceptions", async () => {
    await ask();

    expect(query).toHaveBeenCalledTimes(1);
    expect(loadExceptions).toHaveBeenCalledTimes(1);

    const asked: { ruleIds: Array<ObjectID>; from: Date; until: Date } =
      loadExceptions.mock.calls[0]![0] as never;

    expect(
      asked.ruleIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BRUTE_FORCE_ID, SPRAYING_ID]);
    expect(asked.until).toEqual(NOW);
    expect(asked.from).toEqual(new Date("2026-11-23T12:00:00.000Z"));
  });

  test("the rules are read as the caller reads them, at most a page of them", async () => {
    await DetectionRuleUncountedReader.read({
      projectId: PROJECT_ID,
      detectionRuleIds: Array.from(
        { length: MAX_DETECTION_RULES_UNCOUNTED_PER_ASK + 10 },
        (): ObjectID => {
          return ObjectID.generate();
        },
      ),
      props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
      serviceFilter: {},
      now: NOW,
    });

    const asked: { props: unknown; limit: number; query: JSONObject } =
      findRules.mock.calls[0]![0] as never;

    expect(asked.props).not.toEqual({ isRoot: true });
    expect(asked.limit).toBe(MAX_DETECTION_RULES_UNCOUNTED_PER_ASK);
    expect(asked.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("a page whose rules all fire on each event reads no events at all", async () => {
    findRules.mockResolvedValue([
      rule({ id: PER_EVENT_ID, matchCountThreshold: 1 }),
    ] as never);

    expect((await ask()).rules).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(loadExceptions).not.toHaveBeenCalled();
  });

  test("an ask naming no rule reads nothing", async () => {
    expect((await ask([])).rules).toEqual([]);
    expect(findRules).not.toHaveBeenCalled();
  });

  test("an answer is kept: a refresh of the page reads no events", async () => {
    await ask();
    await ask();

    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a rule's exceptions skip in its own counts", async () => {
    const exception: LoadedDetectionRuleException = {
      id: ObjectID.generate(),
      detectionRuleId: new ObjectID(BRUTE_FORCE_ID),
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.IpAddress,
      value: "10.9.9.9",
    } as unknown as LoadedDetectionRuleException;

    loadExceptions.mockResolvedValue(
      new Map([[BRUTE_FORCE_ID, [exception]]]) as never,
    );

    await ask();

    const statement: Statement = query.mock.calls[0]![0] as Statement;

    expect(statement.query).not.toContain("(false) AS __skipped_0");
    expect(statement.query).toContain("(false) AS __skipped_1");
    expect(Object.values(statement.query_params)).toContain("10.9.9.9");
  });

  test("a correlation, and a rule that no longer compiles, are not counted here", async () => {
    findRules.mockResolvedValue([
      rule({ id: BRUTE_FORCE_ID, yaml: CORRELATION }),
      rule({ id: SPRAYING_ID, yaml: "detection: [not, a, rule" }),
    ] as never);

    expect((await ask()).rules).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test("a read that fails is the caller's error: the page shows nothing, and the next ask reads again", async () => {
    query.mockRejectedValueOnce(new Error("Timeout exceeded"));

    await expect(ask()).rejects.toThrow("Timeout exceeded");
    expect((await ask()).rules).toHaveLength(2);
  });
});
