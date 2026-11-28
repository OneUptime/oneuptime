import AuditLogService from "../../../../Server/Services/AuditLogService";
import RuleEmptiedLimits, {
  EmptiedLimitsOfDelete,
} from "../../../../Server/Utils/Rules/RuleEmptiedLimits";
import {
  getRuleLimitListsHolding,
  getRuleLimitListsOf,
  RuleLimitList,
} from "../../../../Server/Utils/Rules/RuleLimitLists";
import RuleSetCache from "../../../../Server/Utils/Rules/RuleSetCache";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { RuleEmptiedLimit } from "../../../../Types/Rules/RuleEmptiedLimit";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What RuleEmptiedLimits sends Postgres and decides from what it reads
 * (#9066), against a database that answers as scripted. Its statements
 * running on Postgres - every list of every rule kind, the cascades, the
 * races - are RuleEmptiedLimitsPostgres.test's.
 */

type Row = Record<string, unknown>;

interface Sent {
  sql: string;
  parameters: Array<unknown>;
}

// A database that answers each statement by the first matching script.
class ScriptedDatabase {
  public sent: Array<Sent> = [];
  private scripts: Array<{
    match: RegExp;
    answer: (parameters: Array<unknown>) => Array<Row> | Error;
  }> = [];

  public on(
    match: RegExp,
    answer: Array<Row> | ((parameters: Array<unknown>) => Array<Row> | Error),
  ): this {
    this.scripts.push({
      match: match,
      answer:
        typeof answer === "function"
          ? answer
          : (): Array<Row> => {
              return answer;
            },
    });
    return this;
  }

  // A script asked before every one given so far.
  public first(
    match: RegExp,
    answer: (parameters: Array<unknown>) => Array<Row> | Error,
  ): this {
    this.scripts.unshift({ match: match, answer: answer });
    return this;
  }

  public query: (
    sql: string,
    parameters: Array<unknown>,
  ) => Promise<Array<Row>> = async (
    sql: string,
    parameters: Array<unknown>,
  ): Promise<Array<Row>> => {
    this.sent.push({ sql: sql, parameters: parameters });

    const script:
      | {
          match: RegExp;
          answer: (parameters: Array<unknown>) => Array<Row> | Error;
        }
      | undefined = this.scripts.find(
      (candidate: { match: RegExp }): boolean => {
        return candidate.match.test(sql);
      },
    );

    const answer: Array<Row> | Error = script ? script.answer(parameters) : [];

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  };

  public statements(match: RegExp): Array<Sent> {
    return this.sent.filter((sent: Sent): boolean => {
      return match.test(sent.sql);
    });
  }
}

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const RULE_ID: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const RUNBOOK_ID: string = "55555555-5555-4555-8555-555555555555";

// The candidates of IncidentOnCallRule.monitors, and nobody else's.
const HOLDING_ON_CALL_MONITORS: RegExp =
  /FROM "IncidentOnCallRuleMonitor"\s+WHERE "monitorId" = ANY/;
const LEFT_EMPTY_ON_CALL: RegExp =
  /FROM "IncidentOnCallRule" r\s+WHERE r\."_id" = ANY/;
const UPDATE_ON_CALL: RegExp =
  /^UPDATE "IncidentOnCallRule"\s+SET "isEnabled" = false/;

let database: ScriptedDatabase;

beforeEach(() => {
  database = new ScriptedDatabase();
  jest.spyOn(RuleEmptiedLimits, "getQuery").mockReturnValue(database.query);
  jest.spyOn(RuleSetCache, "forgetProjects").mockResolvedValue(undefined);
  jest.spyOn(RuleSetCache, "forgetEveryProject").mockResolvedValue(undefined);
  jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The on-call rule holds the deleted monitor alone, and is on.
function scriptRuleLimitedToTheMonitor(): void {
  database
    .on(HOLDING_ON_CALL_MONITORS, [{ ruleId: RULE_ID, recordId: MONITOR_ID }])
    .on(/^SELECT "_id"::text AS "recordId", "name"::text AS "name"/, [
      { recordId: MONITOR_ID, name: "Checkout" },
    ])
    .on(LEFT_EMPTY_ON_CALL, [
      {
        ruleId: RULE_ID,
        projectId: PROJECT_ID,
        isEnabled: true,
        emptiedLimits: null,
      },
    ])
    .on(UPDATE_ON_CALL, [{ _id: RULE_ID }]);
}

describe("RuleEmptiedLimits.beforeDelete", () => {
  test("reads nothing for a table no rule is limited to", async () => {
    expect(
      await RuleEmptiedLimits.beforeDelete({
        recordTable: "Incident",
        recordIds: [MONITOR_ID],
      }),
    ).toBeNull();
    expect(database.sent).toEqual([]);
  });

  test("reads nothing for a delete of no rows", async () => {
    expect(
      await RuleEmptiedLimits.beforeDelete({
        recordTable: "Monitor",
        recordIds: [null, undefined, ""],
      }),
    ).toBeNull();
    expect(database.sent).toEqual([]);
  });

  test("asks every list that can hold the records, once each, and writes nothing when no rule holds them", async () => {
    const of: EmptiedLimitsOfDelete | null =
      await RuleEmptiedLimits.beforeDelete({
        recordTable: "Monitor",
        recordIds: [new ObjectID(MONITOR_ID), MONITOR_ID.toUpperCase()],
      });

    expect(of?.candidates).toEqual([]);
    // The 17 kinds of rule limited to monitors, one read each.
    expect(database.sent).toHaveLength(17);
    expect(database.sent[0]!.parameters).toEqual([[MONITOR_ID]]);
    expect(database.statements(/^UPDATE/)).toEqual([]);
  });

  test("switches off and notes a rule left with no record in the list", async () => {
    scriptRuleLimitedToTheMonitor();

    const of: EmptiedLimitsOfDelete | null =
      await RuleEmptiedLimits.beforeDelete({
        recordTable: "Monitor",
        recordIds: [MONITOR_ID],
      });

    const updates: Array<Sent> = database.statements(UPDATE_ON_CALL);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.parameters[0]).toBe(RULE_ID);

    const note: Array<RuleEmptiedLimit> = JSON.parse(
      updates[0]!.parameters[1] as string,
    );
    expect(note).toEqual([
      {
        list: "monitors",
        names: ["Checkout"],
        count: 1,
        deletedAt: expect.any(String),
        switchedOff: true,
      },
    ]);
    // Only while the rule holds the note it was read with: none.
    expect(updates[0]!.parameters[2]).toBeNull();
    expect(updates[0]!.sql).toMatch(
      /"emptiedLimits" IS NOT DISTINCT FROM \$3::jsonb/,
    );

    expect(of?.noted).toEqual([
      {
        ruleTable: "IncidentOnCallRule",
        ruleId: RULE_ID,
        projectId: PROJECT_ID,
        wasEnabled: true,
        emptiedLimitsBefore: null,
        emptiedLimitsWritten: note,
      },
    ]);
  });

  test("a match list asks only rules with no conditions of their own; a scope list asks every rule", async () => {
    database.on(/FROM "IncidentOnCallRuleMonitor"/, [
      { ruleId: RULE_ID, recordId: MONITOR_ID },
    ]);
    await RuleEmptiedLimits.beforeDelete({
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
    });
    expect(database.statements(LEFT_EMPTY_ON_CALL)[0]!.sql).toMatch(
      /r\."criteria" IS NULL/,
    );

    database = new ScriptedDatabase();
    jest.spyOn(RuleEmptiedLimits, "getQuery").mockReturnValue(database.query);
    database.on(/FROM "AutoRemediationRuleRunbook"/, [
      { ruleId: RULE_ID, recordId: RUNBOOK_ID },
    ]);
    await RuleEmptiedLimits.beforeDelete({
      recordTable: "Runbook",
      recordIds: [RUNBOOK_ID],
    });
    const leftEmpty: Sent = database.statements(
      /FROM "AutoRemediationRule" r/,
    )[0]!;
    expect(leftEmpty.sql).not.toMatch(/criteria/);
    // A record soft deleted is no record, and the deleted ones are gone.
    expect(leftEmpty.sql).toMatch(/t\."deletedAt" IS NULL/);
    expect(leftEmpty.sql).toMatch(
      /NOT \(k\."runbookId" = ANY\(\$1::uuid\[\]\)\)/,
    );
  });

  test("notes a rule off already without switching it on, and says it did not switch it off", async () => {
    scriptRuleLimitedToTheMonitor();
    database.first(LEFT_EMPTY_ON_CALL, (): Array<Row> => {
      return [
        {
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          isEnabled: false,
          emptiedLimits: null,
        },
      ];
    });

    await RuleEmptiedLimits.beforeDelete({
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
    });

    const note: Array<RuleEmptiedLimit> = JSON.parse(
      database.statements(UPDATE_ON_CALL)[0]!.parameters[1] as string,
    );
    expect(note[0]!.switchedOff).toBe(false);
  });

  test("adds to a note the rule has, and writes again when another write got there first", async () => {
    const earlier: RuleEmptiedLimit = {
      list: "incidentSeverities",
      names: ["Sev 0"],
      count: 1,
      deletedAt: "2026-11-01T00:00:00.000Z",
      switchedOff: true,
    };
    const meanwhile: RuleEmptiedLimit = {
      ...earlier,
      list: "incidentLabels",
      names: ["Production"],
    };
    let attempts: number = 0;

    scriptRuleLimitedToTheMonitor();
    database
      .first(LEFT_EMPTY_ON_CALL, (): Array<Row> => {
        return [
          {
            ruleId: RULE_ID,
            projectId: PROJECT_ID,
            isEnabled: false,
            emptiedLimits: [earlier],
          },
        ];
      })
      .first(UPDATE_ON_CALL, (): Array<Row> => {
        attempts++;
        // The first write finds the note changed meanwhile.
        return attempts === 1 ? [] : [{ _id: RULE_ID }];
      })
      .first(
        /^SELECT "_id"::text AS "ruleId",\s+"projectId"::text/,
        (): Array<Row> => {
          return [
            {
              ruleId: RULE_ID,
              projectId: PROJECT_ID,
              isEnabled: false,
              emptiedLimits: [earlier, meanwhile],
            },
          ];
        },
      );

    await RuleEmptiedLimits.beforeDelete({
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
    });

    const updates: Array<Sent> = database.statements(UPDATE_ON_CALL);
    expect(updates).toHaveLength(2);
    expect(JSON.parse(updates[1]!.parameters[2] as string)).toEqual([
      earlier,
      meanwhile,
    ]);
    expect(
      (
        JSON.parse(
          updates[1]!.parameters[1] as string,
        ) as Array<RuleEmptiedLimit>
      ).map((entry: RuleEmptiedLimit): string => {
        return entry.list;
      }),
    ).toEqual(["incidentSeverities", "incidentLabels", "monitors"]);
  });

  test("a read that fails refuses the delete", async () => {
    database.on(HOLDING_ON_CALL_MONITORS, () => {
      return new Error("connection lost");
    });

    await expect(
      RuleEmptiedLimits.beforeDelete({
        recordTable: "Monitor",
        recordIds: [MONITOR_ID],
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("RuleEmptiedLimits.afterDelete", () => {
  test("switches off a rule that lost its other record before the DELETE, and has every process read the rules again", async () => {
    database
      .on(LEFT_EMPTY_ON_CALL, [
        {
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          isEnabled: true,
          emptiedLimits: null,
        },
      ])
      .on(UPDATE_ON_CALL, [{ _id: RULE_ID }]);

    const of: EmptiedLimitsOfDelete = {
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
      names: new Map<string, string>([[MONITOR_ID, "Checkout"]]),
      deletedAt: new Date("2026-11-16T10:00:00.000Z"),
      candidates: [
        {
          list: getRuleLimitListsOf("IncidentOnCallRule").find(
            (list: RuleLimitList): boolean => {
              return list.list === "monitors";
            },
          )!,
          recordIdsByRule: new Map<string, Array<string>>([
            [RULE_ID, [MONITOR_ID]],
          ]),
        },
      ],
      noted: [],
    };

    await RuleEmptiedLimits.afterDelete(of);

    expect(database.statements(UPDATE_ON_CALL)).toHaveLength(1);
    expect(of.noted).toHaveLength(1);
    expect(RuleSetCache.forgetProjects).toHaveBeenCalledWith([PROJECT_ID]);
  });

  test("never throws: the records are gone already", async () => {
    database.on(/./, () => {
      return new Error("connection lost");
    });

    await expect(
      RuleEmptiedLimits.afterDelete({
        recordTable: "Monitor",
        recordIds: [MONITOR_ID],
        names: new Map<string, string>(),
        deletedAt: new Date(),
        candidates: [
          {
            list: getRuleLimitListsHolding("Monitor")[0]!,
            recordIdsByRule: new Map<string, Array<string>>([
              [RULE_ID, [MONITOR_ID]],
            ]),
          },
        ],
        noted: [],
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("does nothing for a delete no rule held a record of", async () => {
    await RuleEmptiedLimits.afterDelete(null);
    await RuleEmptiedLimits.afterDelete({
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
      names: new Map<string, string>(),
      deletedAt: new Date(),
      candidates: [],
      noted: [],
    });

    expect(database.sent).toEqual([]);
    expect(RuleSetCache.forgetProjects).not.toHaveBeenCalled();
  });
});

describe("RuleEmptiedLimits.recordInAuditTrail", () => {
  const written: Array<RuleEmptiedLimit> = [
    {
      list: "monitors",
      names: ["Checkout"],
      count: 1,
      deletedAt: "2026-11-16T10:00:00.000Z",
      switchedOff: true,
    },
  ];

  test("records the switch and the note, changed by whoever deleted the records, in the rule's project", async () => {
    const userId: ObjectID = ObjectID.generate();
    const deletersProject: ObjectID = ObjectID.generate();

    await RuleEmptiedLimits.recordInAuditTrail({
      noted: [
        {
          ruleTable: "IncidentOnCallRule",
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          wasEnabled: true,
          emptiedLimitsBefore: null,
          emptiedLimitsWritten: written,
        },
      ],
      props: { userId: userId, tenantId: deletersProject },
    });

    expect(AuditLogService.recordUpdate).toHaveBeenCalledTimes(1);

    const recorded: Parameters<typeof AuditLogService.recordUpdate>[0] = (
      AuditLogService.recordUpdate as jest.Mock
    ).mock.calls[0]![0] as Parameters<typeof AuditLogService.recordUpdate>[0];

    expect(recorded.model.tableName).toBe("IncidentOnCallRule");
    expect(recorded.itemId.toString()).toBe(RULE_ID);
    expect(recorded.updatedFields).toEqual({
      isEnabled: false,
      emptiedLimits: written,
    });
    expect(recorded.includeColumns).toEqual(["isEnabled", "emptiedLimits"]);
    expect(
      (recorded.before as unknown as Record<string, unknown>)["isEnabled"],
    ).toBe(true);
    expect(
      (recorded.before as unknown as Record<string, unknown>)["emptiedLimits"],
    ).toBeNull();
    // The person who deleted the monitor, in the rule's own project.
    expect(recorded.props.userId).toEqual(userId);
    expect(recorded.props.tenantId?.toString()).toBe(PROJECT_ID);
  });

  test("is OneUptime's change when no person made the delete, and records nothing for no rule", async () => {
    await RuleEmptiedLimits.recordInAuditTrail({ noted: [] });
    expect(AuditLogService.recordUpdate).not.toHaveBeenCalled();

    await RuleEmptiedLimits.recordInAuditTrail({
      noted: [
        {
          ruleTable: "HostLabelRule",
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          wasEnabled: false,
          emptiedLimitsBefore: written,
          emptiedLimitsWritten: written,
        },
      ],
    });

    const recorded: Parameters<typeof AuditLogService.recordUpdate>[0] = (
      AuditLogService.recordUpdate as jest.Mock
    ).mock.calls[0]![0] as Parameters<typeof AuditLogService.recordUpdate>[0];
    expect(recorded.props.isRoot).toBe(true);
    expect(
      (recorded.before as unknown as Record<string, unknown>)["emptiedLimits"],
    ).toEqual(written);
  });

  test("never throws", async () => {
    (AuditLogService.recordUpdate as jest.Mock).mockImplementation(() => {
      throw new Error("ClickHouse is down");
    });

    await expect(
      RuleEmptiedLimits.recordInAuditTrail({
        noted: [
          {
            ruleTable: "IncidentOnCallRule",
            ruleId: RULE_ID,
            projectId: PROJECT_ID,
            wasEnabled: true,
            emptiedLimitsBefore: null,
            emptiedLimitsWritten: written,
          },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("RuleEmptiedLimits.afterDeleteFailed", () => {
  test("puts each rule back as it was, only while it still holds the note the delete wrote", async () => {
    const written: Array<RuleEmptiedLimit> = [
      {
        list: "monitors",
        names: ["Checkout"],
        count: 1,
        deletedAt: "2026-11-16T10:00:00.000Z",
        switchedOff: true,
      },
    ];

    await RuleEmptiedLimits.afterDeleteFailed({
      recordTable: "Monitor",
      recordIds: [MONITOR_ID],
      names: new Map<string, string>(),
      deletedAt: new Date(),
      candidates: [],
      noted: [
        {
          ruleTable: "IncidentOnCallRule",
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          wasEnabled: true,
          emptiedLimitsBefore: null,
          emptiedLimitsWritten: written,
        },
      ],
    });

    const restore: Sent = database.statements(
      /^UPDATE "IncidentOnCallRule"\s+SET "isEnabled" = \$2/,
    )[0]!;
    expect(restore.parameters).toEqual([
      RULE_ID,
      true,
      null,
      JSON.stringify(written),
    ]);
    expect(restore.sql).toMatch(/"emptiedLimits" = \$4::jsonb/);
    expect(RuleSetCache.forgetProjects).toHaveBeenCalledWith([PROJECT_ID]);
  });
});

describe("RuleEmptiedLimits.refuseSwitchOnWhileEmptied", () => {
  const noted: (data?: Partial<RuleEmptiedLimit>) => Row = (
    data: Partial<RuleEmptiedLimit> = {},
  ): Row => {
    return {
      ruleId: RULE_ID,
      hasCriteria: false,
      emptiedLimits: [
        {
          list: "monitors",
          names: ["Checkout"],
          count: 1,
          deletedAt: "2026-11-16T10:00:00.000Z",
          switchedOff: true,
          ...data,
        },
      ],
    };
  };

  test("reads nothing for a model with no lists", async () => {
    await RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
      ruleTable: "Monitor",
      ruleIds: [RULE_ID],
      written: { isEnabled: true },
    });

    expect(database.sent).toEqual([]);
  });

  test("lets a rule with no note through", async () => {
    database.on(/FROM "IncidentOnCallRule"/, []);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true },
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses while the list is still empty, naming the list, the records and the date", async () => {
    database.on(/FROM "IncidentOnCallRule"/, [noted()]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true },
      }),
    ).rejects.toThrow(
      new BadDataException(
        "This rule was switched off on 2026-11-16 because every record it was limited to in Monitors was deleted: Checkout. Switched on as it is, Monitors would not limit it at all. Choose what it applies to on its edit form first, or send monitors with the update that switches it on - an empty list makes it apply to every record.",
      ),
    );
  });

  test("lets it through when the same write says what the list holds", async () => {
    database.on(/FROM "IncidentOnCallRule"/, [noted()]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true, monitors: [] },
      }),
    ).resolves.toBeUndefined();
  });

  test("lets a match list through when the rule has conditions, or the write gives it some", async () => {
    database.on(/FROM "IncidentOnCallRule"/, [
      { ...noted(), hasCriteria: true },
    ]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true },
      }),
    ).resolves.toBeUndefined();

    database = new ScriptedDatabase();
    jest.spyOn(RuleEmptiedLimits, "getQuery").mockReturnValue(database.query);
    database.on(/FROM "IncidentOnCallRule"/, [noted()]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: {
          isEnabled: true,
          criteria: { schemaVersion: 1, filterCondition: "All", filters: [] },
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("conditions do not stand for a scope list: the AI rule's runbooks", async () => {
    database
      .on(/FROM "AutoRemediationRule"/, [
        {
          ...noted({ list: "runbooks", names: ["Restart the database"] }),
          hasCriteria: true,
        },
      ])
      .on(/FROM "AutoRemediationRuleRunbook" k/, []);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "AutoRemediationRule",
        ruleIds: [RULE_ID],
        written: {
          isEnabled: true,
          criteria: { schemaVersion: 1, filterCondition: "All", filters: [] },
        },
      }),
    ).rejects.toThrow(/in Runbooks was deleted: Restart the database/);
  });

  test("lets it through once the list holds a record that is not deleted", async () => {
    database
      .on(/FROM "IncidentOnCallRule"/, [noted()])
      .on(/FROM "IncidentOnCallRuleMonitor" k/, [{ "?column?": 1 }]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true },
      }),
    ).resolves.toBeUndefined();

    const held: Sent = database.statements(
      /FROM "IncidentOnCallRuleMonitor" k/,
    )[0]!;
    expect(held.sql).toMatch(/t\."deletedAt" IS NULL/);
    expect(held.parameters).toEqual([RULE_ID]);
  });

  test("an entry for a list that limits the rule no more is let through", async () => {
    database.on(/FROM "IncidentOnCallRule"/, [
      noted({ list: "noLongerAList" }),
    ]);

    await expect(
      RuleEmptiedLimits.refuseSwitchOnWhileEmptied({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
        written: { isEnabled: true },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("RuleEmptiedLimits.clearAfterSwitchOn", () => {
  test("clears the notes of the rules switched on", async () => {
    await RuleEmptiedLimits.clearAfterSwitchOn({
      ruleTable: "IncidentOnCallRule",
      ruleIds: [new ObjectID(RULE_ID), null],
    });

    const clear: Sent = database.statements(
      /^UPDATE "IncidentOnCallRule"\s+SET "emptiedLimits" = NULL/,
    )[0]!;
    expect(clear.parameters).toEqual([[RULE_ID]]);
  });

  test("reads nothing for a model with no lists, and never throws", async () => {
    await RuleEmptiedLimits.clearAfterSwitchOn({
      ruleTable: "Monitor",
      ruleIds: [RULE_ID],
    });
    expect(database.sent).toEqual([]);

    database.on(/./, () => {
      return new Error("connection lost");
    });
    await expect(
      RuleEmptiedLimits.clearAfterSwitchOn({
        ruleTable: "IncidentOnCallRule",
        ruleIds: [RULE_ID],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords", () => {
  test("asks every list, switches off what it finds, and skips a list a rule's note names already", async () => {
    database
      .on(/FROM "IncidentOnCallRule" r\s+JOIN "IncidentOnCallRuleMonitor"/, [
        {
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          isEnabled: true,
          emptiedLimits: null,
          names: ["Retired SNMP monitor"],
          deletedAt: new Date("2025-03-04T05:06:07.000Z"),
        },
      ])
      .on(/FROM "AlertOnCallRule" r\s+JOIN "AlertOnCallRuleMonitor"/, [
        {
          ruleId: OTHER_MONITOR_ID,
          projectId: PROJECT_ID,
          isEnabled: false,
          emptiedLimits: [
            {
              list: "monitors",
              names: ["Retired SNMP monitor"],
              count: 1,
              deletedAt: "2025-03-04T05:06:07.000Z",
              switchedOff: true,
            },
          ],
          names: ["Retired SNMP monitor"],
          deletedAt: new Date("2025-03-04T05:06:07.000Z"),
        },
      ])
      .on(/^UPDATE "IncidentOnCallRule"/, [{ _id: RULE_ID }]);

    expect(
      await RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords(),
    ).toBe(1);

    // One read a list, 158 of them (an XCP-ng pool's label and owner rules' pool labels, #11093, the latest).
    expect(database.statements(/GROUP BY r\."_id"/)).toHaveLength(158);
    expect(database.statements(/^UPDATE/)).toHaveLength(1);
    expect(
      JSON.parse(
        database.statements(/^UPDATE "IncidentOnCallRule"/)[0]!
          .parameters[1] as string,
      ),
    ).toEqual([
      {
        list: "monitors",
        names: ["Retired SNMP monitor"],
        count: 1,
        deletedAt: "2025-03-04T05:06:07.000Z",
        switchedOff: true,
      },
    ]);
    expect(RuleSetCache.forgetEveryProject).toHaveBeenCalled();
  });

  test("a match list asks rules with no conditions only, and a record is gone when it is soft deleted", async () => {
    await RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords();

    const onCall: Sent = database.statements(
      /FROM "IncidentOnCallRule" r\s+JOIN "IncidentOnCallRuleMonitor"/,
    )[0]!;
    expect(onCall.sql).toMatch(/r\."criteria" IS NULL AND/);
    expect(onCall.sql).toMatch(/u\."deletedAt" IS NULL/);

    const runbooks: Sent = database.statements(
      /FROM "AutoRemediationRule" r\s+JOIN "AutoRemediationRuleRunbook"/,
    )[0]!;
    expect(runbooks.sql).not.toMatch(/criteria/);
  });
});

describe("RuleEmptiedLimits.getListTitle", () => {
  test.each([
    ["IncidentOnCallRule", "monitors", "Monitors"],
    ["IncidentOnCallRule", "incidentSeverities", "Incident Severities"],
    ["HostLabelRule", "hostLabels", "Host Labels"],
    ["AutoRemediationRule", "runbooks", "Runbooks"],
    ["NoSuchRule", "monitors", "monitors"],
  ])("%s.%s is %s", (ruleTable: string, list: string, title: string) => {
    expect(RuleEmptiedLimits.getListTitle(ruleTable, list)).toBe(title);
  });
});
