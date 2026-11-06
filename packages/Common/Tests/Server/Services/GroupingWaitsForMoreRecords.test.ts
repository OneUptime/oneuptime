import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import { getGroupingWaitKey } from "../../../Server/Utils/Rules/GroupingRuleEpisodeWait";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { MAX_RECORDS_TO_OPEN_EPISODE } from "../../../Utils/Episode/EpisodeOpeningThreshold";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/Logger");

/*
 * WAIT FOR MORE INCIDENTS (OR ALERTS) BEFORE OPENING AN EPISODE (issue #5374).
 *
 * "If the threshold is set to 3, the episode would only be created once at
 * least 3 matching incidents have occurred." With the rule's switch on, the
 * engines:
 *
 *   - join an open episode of the group, and reopen a recently resolved
 *     one, exactly as before - an episode that exists already waits for
 *     nothing;
 *   - otherwise leave a record of the group on its own, marked as waiting
 *     in its group, while fewer than the count are ongoing - it is not
 *     grouped and opens nothing;
 *   - open one episode with every waiting record and the one that made the
 *     count, named after the first of them, and end their waits;
 *   - count only the group's waiting records still ongoing, newest first,
 *     and with the time window on only those that arrived close together;
 *   - let a record that pages nobody wait with the others, but never open
 *     the episode;
 *   - with the switch off - every rule until someone turns it on - read
 *     and write nothing of it, and open an episode for the first record.
 *
 * The engines' own reads and writes are stand-ins; the decisions are theirs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-000000005374",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("0193c0de-5a7e-4abc-8def-0000000000c1");
const OPEN_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e1",
);
const RESOLVED_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e2",
);
const NEW_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e3",
);
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000f1",
);

const GROUPING_KEY: string = "default";
const MINUTE_MS: number = 60 * 1000;

type AnyFunction = (...args: Array<unknown>) => unknown;

type GroupedRecord = Incident | Alert;

interface GroupingResult {
  grouped: boolean;
  episodeId?: ObjectID;
  isNewEpisode?: boolean;
  wasReopened?: boolean;
  isWaitingForMore?: boolean;
}

interface RuleOptions {
  enabled?: boolean | undefined;
  count?: number | undefined;
  timeWindowMinutes?: number | null | undefined;
  reopenWindowMinutes?: number | undefined;
}

interface Kind {
  name: string;
  noun: string;
  engine: Record<string, AnyFunction>;
  ruleService: unknown;
  recordService: unknown;
  stateService: unknown;
  stateMethod: string;
  episodeService: unknown;
  memberService: unknown;
  batchMethod: string;
  batchIdsKey: string;
  episodeIdKey: string;
  matchMethod: string;
  addMethod: string;
  enabledColumn: string;
  countColumn: string;
  recordEpisodeColumn: string;
  stateColumn: string;
  newRecord: (id?: ObjectID, minutesAgo?: number) => GroupedRecord;
  newRule: (options: RuleOptions) => IncidentGroupingRule | AlertGroupingRule;
  group: (
    record: GroupedRecord,
    options?: { mayOpenEpisode?: boolean | undefined },
  ) => Promise<GroupingResult>;
}

function applyRuleOptions(
  rule: IncidentGroupingRule | AlertGroupingRule,
  options: RuleOptions,
): void {
  rule._id = RULE_ID.toString();
  rule.name = "Group incidents that happen together";

  if (options.timeWindowMinutes === null) {
    rule.enableTimeWindow = false;
  } else {
    rule.enableTimeWindow = true;
    rule.timeWindowMinutes = options.timeWindowMinutes ?? 10;
  }

  if (options.reopenWindowMinutes !== undefined) {
    rule.enableReopenWindow = true;
    rule.reopenWindowMinutes = options.reopenWindowMinutes;
  }
}

const KINDS: Array<Kind> = [
  {
    name: "incident",
    noun: "incidents",
    engine: IncidentGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: IncidentGroupingRuleService,
    recordService: IncidentService,
    stateService: IncidentStateService,
    stateMethod: "getUnresolvedIncidentStateIds",
    episodeService: IncidentEpisodeService,
    memberService: IncidentEpisodeMemberService,
    batchMethod: "addIncidentsGroupedByRule",
    batchIdsKey: "incidentIds",
    episodeIdKey: "incidentEpisodeId",
    matchMethod: "doesIncidentMatchRule",
    addMethod: "addIncidentToEpisode",
    enabledColumn: "enableMinimumIncidentCount",
    countColumn: "minimumIncidentCount",
    recordEpisodeColumn: "incidentEpisodeId",
    stateColumn: "currentIncidentStateId",
    newRecord: (id?: ObjectID, minutesAgo?: number): Incident => {
      const incident: Incident = new Incident();
      incident._id = (id || RECORD_ID).toString();
      incident.projectId = PROJECT_ID;
      incident.title = "Checkout is down";
      if (minutesAgo !== undefined) {
        incident.createdAt = new Date(Date.now() - minutesAgo * MINUTE_MS);
      }
      return incident;
    },
    newRule: (options: RuleOptions): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      applyRuleOptions(rule, options);
      rule.enableMinimumIncidentCount = options.enabled ?? true;
      rule.minimumIncidentCount = options.count ?? 3;
      return rule;
    },
    group: (
      record: GroupedRecord,
      options?: { mayOpenEpisode?: boolean | undefined },
    ): Promise<GroupingResult> => {
      return IncidentGroupingEngineService.processIncident(
        record as Incident,
        options || {},
      );
    },
  },
  {
    name: "alert",
    noun: "alerts",
    engine: AlertGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: AlertGroupingRuleService,
    recordService: AlertService,
    stateService: AlertStateService,
    stateMethod: "getUnresolvedAlertStateIds",
    episodeService: AlertEpisodeService,
    memberService: AlertEpisodeMemberService,
    batchMethod: "addAlertsGroupedByRule",
    batchIdsKey: "alertIds",
    episodeIdKey: "alertEpisodeId",
    matchMethod: "doesAlertMatchRule",
    addMethod: "addAlertToEpisode",
    enabledColumn: "enableMinimumAlertCount",
    countColumn: "minimumAlertCount",
    recordEpisodeColumn: "alertEpisodeId",
    stateColumn: "currentAlertStateId",
    newRecord: (id?: ObjectID, minutesAgo?: number): Alert => {
      const alert: Alert = new Alert();
      alert._id = (id || RECORD_ID).toString();
      alert.projectId = PROJECT_ID;
      alert.title = "Checkout is down";
      if (minutesAgo !== undefined) {
        alert.createdAt = new Date(Date.now() - minutesAgo * MINUTE_MS);
      }
      return alert;
    },
    newRule: (options: RuleOptions): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      applyRuleOptions(rule, options);
      rule.enableMinimumAlertCount = options.enabled ?? true;
      rule.minimumAlertCount = options.count ?? 3;
      return rule;
    },
    group: (
      record: GroupedRecord,
      options?: { mayOpenEpisode?: boolean | undefined },
    ): Promise<GroupingResult> => {
      return AlertGroupingEngineService.processAlert(
        record as Alert,
        options || {},
      );
    },
  },
];

interface Mark {
  id: string;
  groupingWaitKey: string | null;
}

interface Seen {
  ruleSelect: Record<string, unknown> | null;
  waitingQuery: Record<string, unknown> | null;
  waitingReads: number;
  stateReads: number;
  marks: Array<Mark>;
  openers: Array<string>;
  joined: Array<string>;
  reopened: Array<string>;
  batches: Array<{ episodeId: string; ids: Array<string>; ruleId: string }>;
}

let seen: Seen;

interface Setup {
  rule: RuleOptions;
  // The waiting records the read finds, newest first, as the database sorts.
  waiting?: Array<GroupedRecord> | undefined;
  open?: boolean | undefined;
  recentlyResolved?: boolean | undefined;
  groupingKey?: string | undefined;
  unresolvedStateIds?: Array<ObjectID> | undefined;
  // The ids the batch says it added; all of them by default.
  addedIds?: ((ids: Array<string>) => Array<string>) | undefined;
}

function stub(kind: Kind, setup: Setup): void {
  jest
    .spyOn(
      kind.memberService as Record<string, AnyFunction>,
      "findHoldingEpisodeId",
    )
    .mockResolvedValue(null as never);
  jest
    .spyOn(kind.ruleService as Record<string, AnyFunction>, "findBy")
    .mockImplementation((async (query: { select: Record<string, unknown> }) => {
      seen.ruleSelect = query.select;
      return [kind.newRule(setup.rule)];
    }) as never);
  jest.spyOn(kind.engine, kind.matchMethod).mockResolvedValue(true as never);
  jest
    .spyOn(kind.engine, "buildGroupingKey")
    .mockResolvedValue((setup.groupingKey || GROUPING_KEY) as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({ key: "lock" } as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  jest
    .spyOn(kind.engine, "findMatchingActiveEpisode")
    .mockImplementation((async () => {
      return setup.open ? { id: OPEN_EPISODE_ID } : null;
    }) as never);
  jest
    .spyOn(kind.engine, "findRecentlyResolvedEpisode")
    .mockImplementation((async () => {
      return setup.recentlyResolved ? { id: RESOLVED_EPISODE_ID } : null;
    }) as never);
  jest
    .spyOn(kind.episodeService as Record<string, AnyFunction>, "reopenEpisode")
    .mockImplementation((async (episodeId: unknown) => {
      seen.reopened.push(String(episodeId));
    }) as never);
  jest
    .spyOn(
      kind.episodeService as Record<string, AnyFunction>,
      "updateEpisodeSeverity",
    )
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(kind.stateService as Record<string, AnyFunction>, kind.stateMethod)
    .mockImplementation((async () => {
      seen.stateReads++;
      return setup.unresolvedStateIds || [ONGOING_STATE_ID];
    }) as never);
  jest
    .spyOn(kind.recordService as Record<string, AnyFunction>, "findBy")
    .mockImplementation((async (query: Record<string, unknown>) => {
      seen.waitingReads++;
      seen.waitingQuery = query;
      return setup.waiting || [];
    }) as never);
  jest
    .spyOn(
      kind.recordService as Record<string, AnyFunction>,
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (input: {
      id: ObjectID;
      data: { groupingWaitKey: string | null };
      skipUpdateDateColumn?: boolean;
    }) => {
      expect(input.skipUpdateDateColumn).toBe(true);
      expect(Object.keys(input.data)).toEqual(["groupingWaitKey"]);
      seen.marks.push({
        id: input.id.toString(),
        groupingWaitKey: input.data.groupingWaitKey,
      });
    }) as never);

  jest.spyOn(kind.engine, "createNewEpisode").mockImplementation((async (
    opener: GroupedRecord,
  ) => {
    seen.openers.push(String(opener.id));
    return { id: NEW_EPISODE_ID };
  }) as never);
  jest.spyOn(kind.engine, kind.addMethod).mockImplementation((async (
    record: GroupedRecord,
    episodeId: unknown,
  ) => {
    seen.joined.push(`${String(record.id)}->${String(episodeId)}`);
  }) as never);
  jest
    .spyOn(kind.memberService as Record<string, AnyFunction>, kind.batchMethod)
    .mockImplementation((async (data: Record<string, unknown>) => {
      const ids: Array<string> = (
        data[kind.batchIdsKey] as Array<ObjectID>
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      seen.batches.push({
        episodeId: String(data[kind.episodeIdKey]),
        ids: ids,
        ruleId: String(data["matchedRuleId"]),
      });

      const added: Array<string> = setup.addedIds ? setup.addedIds(ids) : ids;

      return added.map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    }) as never);
}

interface Condition {
  sql: string;
  parameters: Array<unknown>;
}

// A condition QueryHelper builds, as the SQL it writes for a column.
function readCondition(operator: unknown): Condition {
  const condition: FindOperator<unknown> = operator as FindOperator<unknown>;

  expect(condition).toBeInstanceOf(FindOperator);
  expect(condition.type).toBe("raw");

  return {
    sql: condition.getSql!('"column"'),
    parameters: Object.values(condition.objectLiteralParameters || {}),
  };
}

function waitingId(index: number): ObjectID {
  return new ObjectID(
    `0193c0de-5a7e-4abc-8def-${(0xb000 + index).toString(16).padStart(12, "0")}`,
  );
}

const WAIT_KEY: string = getGroupingWaitKey({
  ruleId: RULE_ID,
  groupingKey: GROUPING_KEY,
});

beforeEach(() => {
  seen = {
    ruleSelect: null,
    waitingQuery: null,
    waitingReads: 0,
    stateReads: 0,
    marks: [],
    openers: [],
    joined: [],
    reopened: [],
    batches: [],
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("the $name grouping engine", (kind: Kind) => {
  test("reads each rule's switch and count with it", async () => {
    stub(kind, { rule: { enabled: false } });

    await kind.group(kind.newRecord());

    expect(seen.ruleSelect).toMatchObject({
      [kind.enabledColumn]: true,
      [kind.countColumn]: true,
    });
  });

  describe("a rule that does not wait", () => {
    test.each([
      ["with the switch off", { enabled: false, count: 5 }],
      ["waiting for 1", { enabled: true, count: 1 }],
      ["with no count", { enabled: true, count: 0 }],
    ] as Array<[string, RuleOptions]>)(
      "%s opens an episode for the first record, and reads and marks nothing",
      async (_name: string, rule: RuleOptions) => {
        stub(kind, { rule: rule });

        const result: GroupingResult = await kind.group(kind.newRecord());

        expect(result).toEqual({
          grouped: true,
          episodeId: NEW_EPISODE_ID,
          isNewEpisode: true,
        });
        expect(seen.openers).toEqual([RECORD_ID.toString()]);
        expect(seen.joined).toEqual([
          `${RECORD_ID.toString()}->${NEW_EPISODE_ID.toString()}`,
        ]);
        expect(seen.batches).toEqual([]);
        expect(seen.waitingReads).toBe(0);
        expect(seen.stateReads).toBe(0);
        expect(seen.marks).toEqual([]);
      },
    );
  });

  describe("a rule that waits for 3", () => {
    test("the group's first record waits on its own: marked, not grouped, nothing opened", async () => {
      stub(kind, { rule: { count: 3 }, waiting: [] });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({ grouped: false, isWaitingForMore: true });
      expect(seen.marks).toEqual([
        { id: RECORD_ID.toString(), groupingWaitKey: WAIT_KEY },
      ]);
      expect(seen.openers).toEqual([]);
      expect(seen.joined).toEqual([]);
      expect(seen.batches).toEqual([]);
    });

    test("the second waits too", async () => {
      stub(kind, {
        rule: { count: 3 },
        waiting: [kind.newRecord(waitingId(1), 2)],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({ grouped: false, isWaitingForMore: true });
      expect(seen.marks).toEqual([
        { id: RECORD_ID.toString(), groupingWaitKey: WAIT_KEY },
      ]);
      expect(seen.openers).toEqual([]);
    });

    test("the third opens one episode with all three, named after the first, and their waits end", async () => {
      const newer: GroupedRecord = kind.newRecord(waitingId(2), 1);
      const older: GroupedRecord = kind.newRecord(waitingId(1), 4);

      stub(kind, { rule: { count: 3 }, waiting: [newer, older] });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({
        grouped: true,
        episodeId: NEW_EPISODE_ID,
        isNewEpisode: true,
      });

      // The oldest that waited opens it: its title, monitor and severity.
      expect(seen.openers).toEqual([waitingId(1).toString()]);

      // All of them, oldest first, then the one that made the count.
      expect(seen.batches).toEqual([
        {
          episodeId: NEW_EPISODE_ID.toString(),
          ids: [
            waitingId(1).toString(),
            waitingId(2).toString(),
            RECORD_ID.toString(),
          ],
          ruleId: RULE_ID.toString(),
        },
      ]);

      // Added together, not one by one.
      expect(seen.joined).toEqual([]);

      // The ones that waited wait no more; the last one never waited.
      expect(seen.marks).toEqual([
        { id: waitingId(1).toString(), groupingWaitKey: null },
        { id: waitingId(2).toString(), groupingWaitKey: null },
      ]);
    });

    test("more than enough waiting - some could not open one - all go in", async () => {
      const waiting: Array<GroupedRecord> = [5, 4, 3, 2, 1].map(
        (index: number): GroupedRecord => {
          return kind.newRecord(waitingId(index), 6 - index);
        },
      );

      stub(kind, { rule: { count: 3 }, waiting: waiting });

      await kind.group(kind.newRecord());

      expect(seen.batches[0]?.ids).toEqual([
        ...[1, 2, 3, 4, 5].map((index: number): string => {
          return waitingId(index).toString();
        }),
        RECORD_ID.toString(),
      ]);
      expect(seen.openers).toEqual([waitingId(1).toString()]);
    });

    test("only the ones the episode took stop waiting", async () => {
      stub(kind, {
        rule: { count: 3 },
        waiting: [
          kind.newRecord(waitingId(2), 1),
          kind.newRecord(waitingId(1), 2),
        ],
        // waitingId(2) went into another episode meanwhile.
        addedIds: (ids: Array<string>): Array<string> => {
          return ids.filter((id: string): boolean => {
            return id !== waitingId(2).toString();
          });
        },
      });

      await kind.group(kind.newRecord());

      expect(seen.marks).toEqual([
        { id: waitingId(1).toString(), groupingWaitKey: null },
      ]);
    });

    test("an open episode of the group takes the record as always: nothing waits", async () => {
      stub(kind, { rule: { count: 3 }, open: true });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({
        grouped: true,
        episodeId: OPEN_EPISODE_ID,
        isNewEpisode: false,
      });
      expect(seen.joined).toEqual([
        `${RECORD_ID.toString()}->${OPEN_EPISODE_ID.toString()}`,
      ]);
      expect(seen.waitingReads).toBe(0);
      expect(seen.marks).toEqual([]);
      expect(seen.openers).toEqual([]);
    });

    test("a recently resolved episode of the group is reopened for it, rather than waiting", async () => {
      stub(kind, {
        rule: { count: 3, reopenWindowMinutes: 30 },
        recentlyResolved: true,
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result.wasReopened).toBe(true);
      expect(seen.reopened).toEqual([RESOLVED_EPISODE_ID.toString()]);
      expect(seen.waitingReads).toBe(0);
      expect(seen.marks).toEqual([]);
      expect(seen.openers).toEqual([]);
    });

    test("reads only its own group's waiting records still ongoing, newest first, at most as many as an episode opens with", async () => {
      stub(kind, { rule: { count: 3 }, waiting: [] });

      await kind.group(kind.newRecord());

      const query: Record<string, unknown> = seen.waitingQuery || {};
      const where: Record<string, unknown> = query["query"] as Record<
        string,
        unknown
      >;

      expect(String(where["projectId"])).toBe(PROJECT_ID.toString());
      expect(where["groupingWaitKey"]).toBe(WAIT_KEY);

      // In no episode.
      expect(readCondition(where[kind.recordEpisodeColumn])).toEqual({
        sql: '("column" IS NULL)',
        parameters: [],
      });

      // Ongoing: in one of the project's states that is not resolved.
      const state: Condition = readCondition(where[kind.stateColumn]);
      expect(state.sql).toMatch(/^\("column" IN \(:\.\.\.\w+\)\)$/);
      expect(state.parameters).toEqual([[ONGOING_STATE_ID.toString()]]);

      // Never the record itself.
      const self: Condition = readCondition(where["_id"]);
      expect(self.sql).toMatch(/^\("column" != :\w+\)$/);
      expect(self.parameters).toEqual([RECORD_ID.toString()]);

      expect(query["sort"]).toEqual({ createdAt: SortOrder.Descending });
      expect(query["limit"]).toBe(MAX_RECORDS_TO_OPEN_EPISODE - 1);
      expect(query["props"]).toEqual({ isRoot: true });
      expect(query["select"]).toMatchObject({
        _id: true,
        createdAt: true,
        title: true,
        isPrivate: true,
      });
    });

    test("a project with no state that is not resolved has nothing ongoing: the record waits", async () => {
      stub(kind, {
        rule: { count: 2 },
        waiting: [kind.newRecord(waitingId(1), 1)],
        unresolvedStateIds: [],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({ grouped: false, isWaitingForMore: true });
      expect(seen.waitingReads).toBe(0);
      expect(seen.openers).toEqual([]);
    });

    test("the mark is the rule's and the group's", async () => {
      stub(kind, {
        rule: { count: 3 },
        waiting: [],
        groupingKey: "monitor:checkout-api",
      });

      await kind.group(kind.newRecord());

      const key: string = getGroupingWaitKey({
        ruleId: RULE_ID,
        groupingKey: "monitor:checkout-api",
      });

      expect(seen.marks).toEqual([
        { id: RECORD_ID.toString(), groupingWaitKey: key },
      ]);
      expect(
        (seen.waitingQuery?.["query"] as Record<string, unknown>)[
          "groupingWaitKey"
        ],
      ).toBe(key);
      expect(key).not.toBe(WAIT_KEY);
    });
  });

  describe("the time window", () => {
    test("on, records that arrived too long before the others do not count", async () => {
      stub(kind, {
        rule: { count: 3, timeWindowMinutes: 10 },
        // 5 minutes ago counts; 40 minutes ago is 35 minutes before it.
        waiting: [
          kind.newRecord(waitingId(2), 5),
          kind.newRecord(waitingId(1), 40),
        ],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result).toEqual({ grouped: false, isWaitingForMore: true });
      expect(seen.openers).toEqual([]);
    });

    test("on, records that arrived within it of each other open the episode", async () => {
      stub(kind, {
        rule: { count: 3, timeWindowMinutes: 10 },
        waiting: [
          kind.newRecord(waitingId(2), 8),
          kind.newRecord(waitingId(1), 16),
        ],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result.isNewEpisode).toBe(true);
      expect(seen.batches[0]?.ids).toEqual([
        waitingId(1).toString(),
        waitingId(2).toString(),
        RECORD_ID.toString(),
      ]);
    });

    test("on, only the run that arrived close together goes in", async () => {
      stub(kind, {
        rule: { count: 2, timeWindowMinutes: 10 },
        waiting: [
          kind.newRecord(waitingId(2), 3),
          kind.newRecord(waitingId(1), 60),
        ],
      });

      await kind.group(kind.newRecord());

      expect(seen.batches[0]?.ids).toEqual([
        waitingId(2).toString(),
        RECORD_ID.toString(),
      ]);
      expect(seen.openers).toEqual([waitingId(2).toString()]);
      expect(seen.marks).toEqual([
        { id: waitingId(2).toString(), groupingWaitKey: null },
      ]);
    });

    test("off, every waiting record still ongoing counts, however long ago it arrived", async () => {
      stub(kind, {
        rule: { count: 3, timeWindowMinutes: null },
        waiting: [
          kind.newRecord(waitingId(2), 60 * 24),
          kind.newRecord(waitingId(1), 60 * 24 * 7),
        ],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result.isNewEpisode).toBe(true);
      expect(seen.batches[0]?.ids).toHaveLength(3);
    });

    test("switched on with no minutes, counts within the hour the engine falls back to", async () => {
      stub(kind, {
        rule: { count: 2, timeWindowMinutes: 0 },
        waiting: [kind.newRecord(waitingId(1), 59)],
      });

      expect((await kind.group(kind.newRecord())).isNewEpisode).toBe(true);

      jest.restoreAllMocks();
      seen.batches = [];
      seen.marks = [];

      stub(kind, {
        rule: { count: 2, timeWindowMinutes: 0 },
        waiting: [kind.newRecord(waitingId(1), 61)],
      });

      expect(await kind.group(kind.newRecord())).toEqual({
        grouped: false,
        isWaitingForMore: true,
      });
    });
  });

  describe("the count", () => {
    test("above the most, waits for the most an episode opens with", async () => {
      const waiting: Array<GroupedRecord> = [];

      for (
        let index: number = 0;
        index < MAX_RECORDS_TO_OPEN_EPISODE - 2;
        index++
      ) {
        waiting.push(kind.newRecord(waitingId(index), 0));
      }

      stub(kind, {
        rule: { count: 500, timeWindowMinutes: null },
        waiting: waiting,
      });

      expect(await kind.group(kind.newRecord())).toEqual({
        grouped: false,
        isWaitingForMore: true,
      });

      jest.restoreAllMocks();

      stub(kind, {
        rule: { count: 500, timeWindowMinutes: null },
        waiting: [...waiting, kind.newRecord(waitingId(999), 0)],
      });

      const result: GroupingResult = await kind.group(kind.newRecord());

      expect(result.isNewEpisode).toBe(true);
      expect(seen.batches[seen.batches.length - 1]?.ids).toHaveLength(
        MAX_RECORDS_TO_OPEN_EPISODE,
      );
    });

    test.each([2, 4, 10])(
      "of %d opens the episode with the record that makes it, not one before",
      async (count: number) => {
        for (
          let waitingCount: number = 0;
          waitingCount < count;
          waitingCount++
        ) {
          jest.restoreAllMocks();
          seen.openers = [];
          seen.marks = [];

          const waiting: Array<GroupedRecord> = [];

          for (let index: number = 0; index < waitingCount; index++) {
            waiting.push(kind.newRecord(waitingId(index), 1));
          }

          stub(kind, { rule: { count: count }, waiting: waiting });

          const result: GroupingResult = await kind.group(kind.newRecord());

          if (waitingCount + 1 < count) {
            expect(result.isWaitingForMore).toBe(true);
            expect(seen.openers).toEqual([]);
          } else {
            expect(result.isNewEpisode).toBe(true);
            expect(seen.openers).toHaveLength(1);
          }
        }
      },
    );
  });

  describe(`one that pages nobody (mayOpenEpisode: false)`, () => {
    test("waits with the others, even when it makes the count, and never opens the episode", async () => {
      stub(kind, {
        rule: { count: 3 },
        waiting: [
          kind.newRecord(waitingId(2), 1),
          kind.newRecord(waitingId(1), 2),
        ],
      });

      const result: GroupingResult = await kind.group(kind.newRecord(), {
        mayOpenEpisode: false,
      });

      expect(result).toEqual({ grouped: false, isWaitingForMore: true });
      expect(seen.marks).toEqual([
        { id: RECORD_ID.toString(), groupingWaitKey: WAIT_KEY },
      ]);
      expect(seen.openers).toEqual([]);
      expect(seen.batches).toEqual([]);
    });

    test("with a rule that does not wait, stays on its own and is not marked, as before", async () => {
      stub(kind, { rule: { enabled: false } });

      const result: GroupingResult = await kind.group(kind.newRecord(), {
        mayOpenEpisode: false,
      });

      expect(result).toEqual({ grouped: false });
      expect(seen.marks).toEqual([]);
    });

    test("still joins an open episode of the group", async () => {
      stub(kind, { rule: { count: 3 }, open: true });

      const result: GroupingResult = await kind.group(kind.newRecord(), {
        mayOpenEpisode: false,
      });

      expect(result.episodeId).toEqual(OPEN_EPISODE_ID);
      expect(seen.marks).toEqual([]);
    });
  });

  test("an episode that could not be opened leaves the record waiting with the others, so the next one counts it", async () => {
    stub(kind, {
      rule: { count: 2 },
      waiting: [kind.newRecord(waitingId(1), 1)],
    });

    jest
      .spyOn(kind.engine, "createNewEpisode")
      .mockResolvedValue(null as never);

    const result: GroupingResult = await kind.group(kind.newRecord());

    expect(result).toEqual({ grouped: false, isWaitingForMore: true });
    expect(seen.marks).toEqual([
      { id: RECORD_ID.toString(), groupingWaitKey: WAIT_KEY },
    ]);
    expect(seen.batches).toEqual([]);
  });

  test("an episode that could not be opened by a rule that does not wait leaves nothing marked, as before", async () => {
    stub(kind, { rule: { enabled: false } });

    jest
      .spyOn(kind.engine, "createNewEpisode")
      .mockResolvedValue(null as never);

    expect(await kind.group(kind.newRecord())).toEqual({ grouped: false });
    expect(seen.marks).toEqual([]);
  });

  test("a failed mark leaves the record ungrouped rather than failing its create", async () => {
    stub(kind, { rule: { count: 3 }, waiting: [] });

    jest
      .spyOn(
        kind.recordService as Record<string, AnyFunction>,
        "updateColumnsByIdWithoutHooks",
      )
      .mockRejectedValue(new Error("connection lost") as never);

    await expect(kind.group(kind.newRecord())).resolves.toEqual({
      grouped: false,
    });
  });
});

/*
 * The episode the rule opens says, in its "Episode Created" entry, that it
 * waited - and one opened by a rule that does not wait says nothing of it.
 */
interface FeedKind {
  name: string;
  engine: Record<string, AnyFunction>;
  episodeService: unknown;
  feedService: unknown;
  feedMethod: string;
  newRecord: () => GroupedRecord;
  newRule: (options: RuleOptions) => IncidentGroupingRule | AlertGroupingRule;
}

const FEED_KINDS: Array<FeedKind> = [
  {
    name: "incident",
    engine: KINDS[0]!.engine,
    episodeService: IncidentEpisodeService,
    feedService: IncidentEpisodeFeedService,
    feedMethod: "createIncidentEpisodeFeedItem",
    newRecord: (): GroupedRecord => {
      return KINDS[0]!.newRecord();
    },
    newRule: KINDS[0]!.newRule,
  },
  {
    name: "alert",
    engine: KINDS[1]!.engine,
    episodeService: AlertEpisodeService,
    feedService: AlertEpisodeFeedService,
    feedMethod: "createAlertEpisodeFeedItem",
    newRecord: (): GroupedRecord => {
      return KINDS[1]!.newRecord();
    },
    newRule: KINDS[1]!.newRule,
  },
];

describe.each(FEED_KINDS)(
  "the $name episode a waiting rule opens",
  (kind: FeedKind) => {
    let feed: Array<{ moreInformationInMarkdown?: string }> = [];

    beforeEach(() => {
      feed = [];

      jest
        .spyOn(kind.episodeService as Record<string, AnyFunction>, "create")
        .mockImplementation((async (data: { data: { id?: ObjectID } }) => {
          data.data.id = NEW_EPISODE_ID;
          return data.data;
        }) as never);
      jest
        .spyOn(kind.feedService as Record<string, AnyFunction>, kind.feedMethod)
        .mockImplementation((async (item: {
          moreInformationInMarkdown?: string;
        }) => {
          feed.push(item);
        }) as never);
    });

    test.each([
      ["waits for 3", { enabled: true, count: 3 }, 3],
      ["waits for 12", { enabled: true, count: 12 }, 12],
    ] as Array<[string, RuleOptions, number]>)(
      "says so in its created entry, when the rule %s",
      async (_name: string, rule: RuleOptions, count: number) => {
        await kind.engine["createNewEpisode"]!.call(
          kind.engine,
          kind.newRecord(),
          kind.newRule(rule),
          GROUPING_KEY,
        );

        expect(feed).toHaveLength(1);
        expect(feed[0]?.moreInformationInMarkdown).toContain(
          `**Opened once:** ${count} matching ${kind.name}s were ongoing`,
        );
      },
    );

    test.each([
      ["is off", { enabled: false, count: 3 }],
      ["waits for 1", { enabled: true, count: 1 }],
    ] as Array<[string, RuleOptions]>)(
      "says nothing of waiting when the switch %s",
      async (_name: string, rule: RuleOptions) => {
        await kind.engine["createNewEpisode"]!.call(
          kind.engine,
          kind.newRecord(),
          kind.newRule(rule),
          GROUPING_KEY,
        );

        expect(feed).toHaveLength(1);
        expect(feed[0]?.moreInformationInMarkdown).not.toContain("Opened once");
      },
    );
  },
);
