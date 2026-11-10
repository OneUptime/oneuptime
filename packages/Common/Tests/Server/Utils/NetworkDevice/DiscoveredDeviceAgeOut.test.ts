import DiscoveredDeviceAgeOut, {
  AGE_OUT_BATCH_SIZE,
  AGE_OUT_PROJECTS_PER_PAGE,
  AGE_OUT_REPORTING_WINDOW_MS,
  AGE_OUT_TIME_BUDGET_MS,
  DiscoveredDeviceAgeOutResult,
  DiscoveredDeviceAgeOutSummary,
  DueDiscoveredDeviceProjectsPage,
  MAX_AGE_OUT_BATCHES_PER_PROJECT,
  buildAgeOutStatement,
  buildDueProjectsStatement,
  buildReportingDevicesStatement,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut";
import { DiscoveredDeviceStatement } from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceQuery";
import logger from "../../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Removing the discovered devices nothing sees any more (issue #6389), with
 * the statements' runner and the clock standing in for Postgres and time
 * (DiscoveredDeviceAgeOutPostgres runs the statements for real). Pinned
 * here: what each statement keeps - monitored, classified, edited and
 * person-added devices, and the devices of a switch that has gone quiet -
 * that only values travel as parameters, each project's own cut-off, the
 * batches and their cap, the paging of projects, the time budget, and that
 * one project's failure stops no other.
 */

jest.mock("../../../../Server/Services/NetworkEndpointService", () => {
  return {
    __esModule: true,
    default: {
      getRepository: () => {
        throw new Error("The runner is replaced in these tests.");
      },
    },
  };
});

const DAY: number = 24 * 60 * 60 * 1000;
const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");

const PROJECT_A: string = "a1000000-0000-4000-8000-000000000001";
const PROJECT_B: string = "a1000000-0000-4000-8000-000000000002";
const PROJECT_C: string = "a1000000-0000-4000-8000-000000000003";
const SWITCH_A: string = "b2000000-0000-4000-8000-000000000001";
const SWITCH_B: string = "b2000000-0000-4000-8000-000000000002";

interface Ran {
  sql: string;
  params: Array<unknown>;
}

type Kind = "due" | "reporting" | "ageOut" | "other";

function kindOf(sql: string): Kind {
  if (sql.includes(`FROM "Project" p`)) {
    return "due";
  }

  if (sql.includes(`SELECT DISTINCT e."attachedNetworkDeviceId"`)) {
    return "reporting";
  }

  if (sql.startsWith("WITH monitored AS")) {
    return "ageOut";
  }

  return "other";
}

let ran: Array<Ran>;
let clock: number;
let duePages: Array<Array<Record<string, unknown>>>;
let reportingRows: Array<Record<string, unknown>>;
// What each age-out statement answers, in turn; after the last, nothing.
let ageOutAnswers: Array<
  Array<Record<string, unknown>> | (() => Array<Record<string, unknown>>)
>;

function ranOf(kind: Kind): Array<Ran> {
  return ran.filter((statement: Ran): boolean => {
    return kindOf(statement.sql) === kind;
  });
}

function dueRow(
  projectId: string,
  retentionInDays: unknown = 30,
): Record<string, unknown> {
  return { projectId: projectId, retentionInDays: retentionInDays };
}

function projectIdOf(index: number): string {
  return `c3000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

beforeEach(() => {
  ran = [];
  clock = NOW.getTime();
  duePages = [];
  reportingRows = [];
  ageOutAnswers = [];

  DiscoveredDeviceAgeOut.now = (): Date => {
    return new Date(clock);
  };
  DiscoveredDeviceAgeOut.runQuery = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    ran.push({ sql: sql, params: params });

    switch (kindOf(sql)) {
      case "due":
        return duePages.shift() || [];
      case "reporting":
        return reportingRows;
      case "ageOut": {
        const answer:
          | Array<Record<string, unknown>>
          | (() => Array<Record<string, unknown>>)
          | undefined = ageOutAnswers.shift();

        if (typeof answer === "function") {
          return answer();
        }

        return answer || [{ removed: 0, unhidden: 0 }];
      }
      default:
        return [];
    }
  };

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildDueProjectsStatement", () => {
  test("finds live projects that remove devices and hold one past their own cut-off", () => {
    const statement: DiscoveredDeviceStatement = buildDueProjectsStatement({
      now: NOW,
      limit: 100,
    });

    expect(statement.params).toEqual([NOW, 7, 100]);
    expect(statement.sql).toContain(`p."deletedAt" IS NULL`);
    // Never (0) is not due, nor anything below the shortest choice.
    expect(statement.sql).toContain(
      `p."discoveredDeviceRetentionInDays" >= $2`,
    );
    // Each project by its own days, on live rows only.
    expect(statement.sql).toContain(
      `e."lastSeenAt" < $1::timestamptz - make_interval(days => p."discoveredDeviceRetentionInDays")`,
    );
    expect(statement.sql).toContain(`e."deletedAt" IS NULL`);
    expect(statement.sql).toContain(`e."projectId" = p."_id"`);
    expect(statement.sql).toContain(`ORDER BY p."_id" ASC`);
    expect(statement.sql).toContain("LIMIT $3");
    expect(statement.sql).not.toContain(`p."_id" >`);
  });

  test("the next page starts after the last project of the one before", () => {
    const statement: DiscoveredDeviceStatement = buildDueProjectsStatement({
      now: NOW,
      afterProjectId: PROJECT_B,
      limit: 100,
    });

    expect(statement.params).toEqual([NOW, 7, PROJECT_B, 100]);
    expect(statement.sql).toContain(`p."_id" > $3::uuid`);
    expect(statement.sql).toContain("LIMIT $4");
  });

  test("a limit is a whole number of at least one", () => {
    expect(
      buildDueProjectsStatement({ now: NOW, limit: 0 }).params.slice(-1),
    ).toEqual([1]);
    expect(
      buildDueProjectsStatement({ now: NOW, limit: 2.7 }).params.slice(-1),
    ).toEqual([2]);
  });
});

describe("buildReportingDevicesStatement", () => {
  test("lists the switches and controllers that saw any live device of the project since then", () => {
    const since: Date = new Date(NOW.getTime() - DAY);
    const statement: DiscoveredDeviceStatement = buildReportingDevicesStatement(
      { projectId: PROJECT_A, since: since },
    );

    expect(statement.params).toEqual([PROJECT_A, since]);
    expect(statement.sql).toContain(
      `SELECT DISTINCT e."attachedNetworkDeviceId"::text AS "deviceId"`,
    );
    expect(statement.sql).toContain(`e."projectId" = $1::uuid`);
    expect(statement.sql).toContain(`e."deletedAt" IS NULL`);
    expect(statement.sql).toContain(`e."lastSeenAt" >= $2::timestamptz`);
  });
});

describe("buildAgeOutStatement", () => {
  const seenBefore: Date = new Date(NOW.getTime() - 30 * DAY);

  function statementOf(
    fields: Partial<Parameters<typeof buildAgeOutStatement>[0]> = {},
  ): DiscoveredDeviceStatement {
    return buildAgeOutStatement({
      projectId: PROJECT_A,
      seenBefore: seenBefore,
      reportingDeviceIds: [SWITCH_A],
      limit: AGE_OUT_BATCH_SIZE,
      removedAt: NOW,
      ...fields,
    });
  }

  test("every value travels as a parameter, in order", () => {
    const statement: DiscoveredDeviceStatement = statementOf();

    expect(statement.params).toEqual([
      PROJECT_A,
      seenBefore,
      [SWITCH_A],
      AGE_OUT_BATCH_SIZE,
      NOW,
    ]);
  });

  test("text from outside never becomes SQL", () => {
    const statement: DiscoveredDeviceStatement = statementOf({
      projectId: `x'); DROP TABLE "Project"; --`,
      reportingDeviceIds: [`'); DELETE FROM "User"; --`],
    });

    expect(statement.sql).not.toContain("DROP TABLE");
    expect(statement.sql).not.toContain(`DELETE FROM "User"`);
  });

  test("a device a live, unarchived device of the project monitors by MAC is never due", () => {
    const sql: string = statementOf().sql;
    const macKey: (column: string) => string = (column: string): string => {
      return `regexp_replace(lower(COALESCE(${column}, '')), '[^0-9a-f]', '', 'g')`;
    };

    expect(sql).toContain(`d."projectId" = $1::uuid`);
    expect(sql).toContain(`d."deletedAt" IS NULL`);
    expect(sql).toContain(`COALESCE(d."isArchived", false) = false`);
    // Twelve hex digits, however either side wrote the MAC.
    expect(sql).toContain(`length(${macKey(`d."macAddress"`)}) = 12`);
    expect(sql).toContain(`WHERE m."macKey" = ${macKey(`e."macAddress"`)}`);
    expect(sql).toContain("AND NOT EXISTS (");
  });

  test("a classified, an edited and a person-added device is never due, nor one never seen", () => {
    const sql: string = statementOf().sql;
    const due: string = sql.slice(
      sql.indexOf("due AS ("),
      sql.indexOf("removed AS ("),
    );

    expect(due).toContain(`e."projectId" = $1::uuid`);
    expect(due).toContain(`e."deletedAt" IS NULL`);
    // lastSeenAt < cut-off is false for a device never seen (NULL).
    expect(due).toContain(`e."lastSeenAt" < $2::timestamptz`);
    expect(due).toContain(`COALESCE(btrim(e."classification"), '') = ''`);
    expect(due).toContain(`e."editedAt" IS NULL`);
    expect(due).toContain(`e."createdByUserId" IS NULL`);
  });

  test("a device waits while the switch that saw it reports nothing, unless that switch is gone", () => {
    const sql: string = statementOf().sql;

    expect(sql).toContain(
      `LEFT JOIN "NetworkDevice" o ON o."_id" = e."attachedNetworkDeviceId"`,
    );
    expect(sql).toContain(`o."_id" IS NULL`);
    expect(sql).toContain(`o."deletedAt" IS NOT NULL`);
    expect(sql).toContain(`COALESCE(o."isArchived", false) = true`);
    expect(sql).toContain(`e."attachedNetworkDeviceId" = ANY($3::uuid[])`);
  });

  test("the oldest go first, a batch at a time", () => {
    const sql: string = statementOf().sql;

    expect(sql).toContain(`ORDER BY e."lastSeenAt" ASC, e."_id" ASC`);
    expect(sql).toContain("LIMIT $4");
    expect(statementOf({ limit: 0 }).params[3]).toBe(1);
  });

  test("the write checks again what made each row due, so a walk or a person that got there first wins", () => {
    const sql: string = statementOf().sql;
    const write: string = sql.slice(
      sql.indexOf("removed AS ("),
      sql.indexOf("unhidden AS ("),
    );

    expect(write).toContain(`UPDATE "NetworkEndpoint" t`);
    expect(write).toContain(
      `SET "deletedAt" = $5::timestamptz, "updatedAt" = $5::timestamptz`,
    );
    expect(write).toContain(`t."deletedAt" IS NULL`);
    expect(write).toContain(`t."lastSeenAt" < $2::timestamptz`);
    expect(write).toContain(`COALESCE(btrim(t."classification"), '') = ''`);
    expect(write).toContain(`t."editedAt" IS NULL`);
    expect(write).toContain(`t."createdByUserId" IS NULL`);
    expect(write).toContain(`RETURNING t."_id"`);
    // Soft deleted, as a person's Delete is: nothing is erased.
    expect(sql).not.toContain(`DELETE FROM "NetworkEndpoint"`);
  });

  test("takes a removed device's Hide from map preference with it, and only its own", () => {
    const sql: string = statementOf().sql;

    expect(sql).toContain(`DELETE FROM "NetworkTopologySuppression" s`);
    expect(sql).toContain("USING removed r");
    expect(sql).toContain(`s."projectId" = $1::uuid`);
    expect(sql).toContain(`s."nodeKey" = 'endpoint:' || r."_id"::text`);
  });

  test("answers how many of each in one row", () => {
    const sql: string = statementOf().sql;

    expect(sql).toContain(`(SELECT COUNT(*) FROM removed)::int AS "removed"`);
    expect(sql).toContain(`(SELECT COUNT(*) FROM unhidden)::int AS "unhidden"`);
  });
});

describe("DiscoveredDeviceAgeOut.run", () => {
  test("with no project due, reads one page and writes nothing", async () => {
    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(summary).toEqual({
      projects: 0,
      failedProjects: 0,
      removed: 0,
      unhidden: 0,
      isCutShort: false,
    });
    expect(
      ran.map((statement: Ran): Kind => {
        return kindOf(statement.sql);
      }),
    ).toEqual(["due"]);
  });

  test("each project is cut off at its own days, and the switches that reported in the last day are asked", async () => {
    duePages = [[dueRow(PROJECT_A, 30), dueRow(PROJECT_B, 7)]];
    reportingRows = [{ deviceId: SWITCH_A }];
    ageOutAnswers = [
      [{ removed: 4, unhidden: 1 }],
      [{ removed: 2, unhidden: 0 }],
    ];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(summary).toEqual({
      projects: 2,
      failedProjects: 0,
      removed: 6,
      unhidden: 1,
      isCutShort: false,
    });

    const [first, second]: Array<Ran> = ranOf("ageOut");

    expect(first!.params).toEqual([
      PROJECT_A,
      new Date(NOW.getTime() - 30 * DAY),
      [SWITCH_A],
      AGE_OUT_BATCH_SIZE,
      NOW,
    ]);
    expect(second!.params[0]).toBe(PROJECT_B);
    expect(second!.params[1]).toEqual(new Date(NOW.getTime() - 7 * DAY));

    for (const reporting of ranOf("reporting")) {
      expect(reporting.params[1]).toEqual(
        new Date(NOW.getTime() - AGE_OUT_REPORTING_WINDOW_MS),
      );
    }
    expect(
      ranOf("reporting").map((statement: Ran): unknown => {
        return statement.params[0];
      }),
    ).toEqual([PROJECT_A, PROJECT_B]);
    expect(AGE_OUT_REPORTING_WINDOW_MS).toBe(DAY);
  });

  test("a project set to Never, or to anything not a choice, is not touched", async () => {
    duePages = [
      [
        dueRow(PROJECT_A, 0),
        dueRow(PROJECT_B, 45),
        dueRow(PROJECT_C, null),
        dueRow("not-a-project", 30),
        dueRow(projectIdOf(9), "abc"),
      ],
    ];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(summary.projects).toBe(0);
    expect(ranOf("reporting")).toHaveLength(0);
    expect(ranOf("ageOut")).toHaveLength(0);
  });

  test("a full page of projects is followed by the next, after the last project read", async () => {
    const firstPage: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < AGE_OUT_PROJECTS_PER_PAGE; index++) {
      // The page's last row is not a choice: paging still goes on after it.
      firstPage.push(
        dueRow(
          projectIdOf(index),
          index === AGE_OUT_PROJECTS_PER_PAGE - 1 ? 45 : 30,
        ),
      );
    }

    duePages = [firstPage, [dueRow(projectIdOf(500), 90)]];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    const due: Array<Ran> = ranOf("due");

    expect(due).toHaveLength(2);
    expect(due[0]!.params).toEqual([NOW, 7, AGE_OUT_PROJECTS_PER_PAGE]);
    expect(due[1]!.params).toEqual([
      NOW,
      7,
      projectIdOf(AGE_OUT_PROJECTS_PER_PAGE - 1),
      AGE_OUT_PROJECTS_PER_PAGE,
    ]);
    expect(summary.projects).toBe(AGE_OUT_PROJECTS_PER_PAGE);
  });

  test("a project's backlog goes a batch at a time and stops at the first batch short of full", async () => {
    duePages = [[dueRow(PROJECT_A)]];
    ageOutAnswers = [
      [{ removed: AGE_OUT_BATCH_SIZE, unhidden: 3 }],
      [{ removed: AGE_OUT_BATCH_SIZE, unhidden: 0 }],
      [{ removed: 250, unhidden: 2 }],
    ];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(ranOf("ageOut")).toHaveLength(3);
    expect(summary.removed).toBe(2 * AGE_OUT_BATCH_SIZE + 250);
    expect(summary.unhidden).toBe(5);
    // The switches are asked once per project, not once per batch.
    expect(ranOf("reporting")).toHaveLength(1);
  });

  test("one project gets no more than its batches a run, and the next project still gets its turn", async () => {
    duePages = [[dueRow(PROJECT_A), dueRow(PROJECT_B)]];

    for (
      let batch: number = 0;
      batch < MAX_AGE_OUT_BATCHES_PER_PROJECT;
      batch++
    ) {
      ageOutAnswers.push([{ removed: AGE_OUT_BATCH_SIZE, unhidden: 0 }]);
    }

    ageOutAnswers.push([{ removed: 7, unhidden: 0 }]);

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    const writes: Array<Ran> = ranOf("ageOut");

    expect(MAX_AGE_OUT_BATCHES_PER_PROJECT).toBe(20);
    expect(AGE_OUT_BATCH_SIZE).toBe(1000);
    expect(writes).toHaveLength(MAX_AGE_OUT_BATCHES_PER_PROJECT + 1);
    expect(
      writes.filter((statement: Ran): boolean => {
        return statement.params[0] === PROJECT_A;
      }),
    ).toHaveLength(MAX_AGE_OUT_BATCHES_PER_PROJECT);
    expect(writes[writes.length - 1]!.params[0]).toBe(PROJECT_B);
    expect(summary.removed).toBe(
      MAX_AGE_OUT_BATCHES_PER_PROJECT * AGE_OUT_BATCH_SIZE + 7,
    );
  });

  test("each batch is stamped with the clock's time when it runs", async () => {
    duePages = [[dueRow(PROJECT_A)]];
    ageOutAnswers = [
      () => {
        clock += MINUTE;
        return [{ removed: AGE_OUT_BATCH_SIZE, unhidden: 0 }];
      },
      [{ removed: 1, unhidden: 0 }],
    ];

    await DiscoveredDeviceAgeOut.run();

    const writes: Array<Ran> = ranOf("ageOut");

    expect(writes[0]!.params[4]).toEqual(NOW);
    expect(writes[1]!.params[4]).toEqual(new Date(NOW.getTime() + MINUTE));
    // The cut-off is the project's, fixed when its work starts.
    expect(writes[1]!.params[1]).toEqual(writes[0]!.params[1]);
  });

  test("once the time budget is spent, no new batch or project is started", async () => {
    duePages = [[dueRow(PROJECT_A), dueRow(PROJECT_B)]];

    // Ten full batches, each taking three minutes.
    const slowBatch: () => Array<Record<string, unknown>> = (): Array<
      Record<string, unknown>
    > => {
      clock += 3 * MINUTE;
      return [{ removed: AGE_OUT_BATCH_SIZE, unhidden: 0 }];
    };
    ageOutAnswers = new Array(10).fill(slowBatch);

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run({ timeBudgetMs: 8 * MINUTE });

    // 0, 3 and 6 minutes in: three batches start; at 9 the budget is spent.
    expect(ranOf("ageOut")).toHaveLength(3);
    expect(summary).toEqual({
      projects: 1,
      failedProjects: 0,
      removed: 3 * AGE_OUT_BATCH_SIZE,
      unhidden: 0,
      isCutShort: true,
    });
    expect(
      ranOf("reporting").map((statement: Ran): unknown => {
        return statement.params[0];
      }),
    ).toEqual([PROJECT_A]);
  });

  test("the budget is eight minutes unless the run says otherwise", async () => {
    expect(AGE_OUT_TIME_BUDGET_MS).toBe(8 * MINUTE);

    duePages = [[dueRow(PROJECT_A), dueRow(PROJECT_B)]];
    ageOutAnswers = [
      () => {
        clock += AGE_OUT_TIME_BUDGET_MS;
        return [{ removed: 1, unhidden: 0 }];
      },
    ];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(summary.projects).toBe(1);
    expect(summary.isCutShort).toBe(true);
  });

  test("one project's failure is logged, and the rest go on", async () => {
    duePages = [[dueRow(PROJECT_A), dueRow(PROJECT_B)]];
    ageOutAnswers = [
      () => {
        throw new Error("canceling statement due to statement timeout");
      },
      [{ removed: 3, unhidden: 1 }],
    ];

    const summary: DiscoveredDeviceAgeOutSummary =
      await DiscoveredDeviceAgeOut.run();

    expect(summary).toEqual({
      projects: 2,
      failedProjects: 1,
      removed: 3,
      unhidden: 1,
      isCutShort: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      `Discovered devices: removing the devices project ${PROJECT_A} no longer sees failed. It is tried again next run.`,
    );
  });
});

describe("DiscoveredDeviceAgeOut.findDueProjects", () => {
  test("a page short of full is the last", async () => {
    duePages = [[dueRow(PROJECT_A, 60)]];

    const page: DueDiscoveredDeviceProjectsPage =
      await DiscoveredDeviceAgeOut.findDueProjects({ now: NOW });

    expect(page).toEqual({
      projects: [{ projectId: PROJECT_A, retentionInDays: 60 }],
      nextAfterProjectId: undefined,
    });
  });

  test("reads a retention written as text, as Postgres may answer a number", async () => {
    duePages = [[dueRow(PROJECT_A, "14")]];

    const page: DueDiscoveredDeviceProjectsPage =
      await DiscoveredDeviceAgeOut.findDueProjects({ now: NOW });

    expect(page.projects).toEqual([
      { projectId: PROJECT_A, retentionInDays: 14 },
    ]);
  });
});

describe("DiscoveredDeviceAgeOut.ageOutProject", () => {
  test("never removes anything with Never or a setting below the shortest choice", async () => {
    for (const retentionInDays of [0, 1, 6]) {
      const result: DiscoveredDeviceAgeOutResult =
        await DiscoveredDeviceAgeOut.ageOutProject({
          projectId: PROJECT_A,
          retentionInDays: retentionInDays,
        });

      expect(result).toEqual({ removed: 0, unhidden: 0 });
    }

    expect(ran).toHaveLength(0);
  });

  test("only real device ids are handed on as the switches that reported", async () => {
    reportingRows = [
      { deviceId: SWITCH_A },
      { deviceId: null },
      { deviceId: "" },
      { deviceId: "not-a-device" },
      { deviceId: SWITCH_B },
    ];

    await DiscoveredDeviceAgeOut.ageOutProject({
      projectId: PROJECT_A,
      retentionInDays: 30,
    });

    expect(ranOf("ageOut")[0]!.params[2]).toEqual([SWITCH_A, SWITCH_B]);
  });

  test("with no switch reporting, the list handed on is empty, not missing", async () => {
    await DiscoveredDeviceAgeOut.ageOutProject({
      projectId: PROJECT_A,
      retentionInDays: 30,
    });

    expect(ranOf("ageOut")[0]!.params[2]).toEqual([]);
  });

  test("an answer that is not a count reads as none, and ends the project's work", async () => {
    ageOutAnswers = [[{ removed: "12", unhidden: null }]];

    expect(
      await DiscoveredDeviceAgeOut.ageOutProject({
        projectId: PROJECT_A,
        retentionInDays: 30,
      }),
    ).toEqual({ removed: 12, unhidden: 0 });

    ran = [];
    ageOutAnswers = [[{ removed: -5, unhidden: "x" }]];

    expect(
      await DiscoveredDeviceAgeOut.ageOutProject({
        projectId: PROJECT_A,
        retentionInDays: 30,
      }),
    ).toEqual({ removed: 0, unhidden: 0 });
    expect(ranOf("ageOut")).toHaveLength(1);

    ran = [];
    ageOutAnswers = [[]];

    expect(
      await DiscoveredDeviceAgeOut.ageOutProject({
        projectId: PROJECT_A,
        retentionInDays: 30,
      }),
    ).toEqual({ removed: 0, unhidden: 0 });
    expect(ranOf("ageOut")).toHaveLength(1);
  });

  test("the first batch runs even when the time is spent: a project started is worked on", async () => {
    ageOutAnswers = [[{ removed: AGE_OUT_BATCH_SIZE, unhidden: 0 }]];

    const result: DiscoveredDeviceAgeOutResult =
      await DiscoveredDeviceAgeOut.ageOutProject({
        projectId: PROJECT_A,
        retentionInDays: 30,
        isOutOfTime: () => {
          return true;
        },
      });

    expect(result.removed).toBe(AGE_OUT_BATCH_SIZE);
    expect(ranOf("ageOut")).toHaveLength(1);
  });
});
