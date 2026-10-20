import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertMeasurementValueService from "../../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentMeasurementValueService from "../../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import FirstPagedAt, {
  FirstPagedAtBackfillResult,
  PAGE_WENT_OUT_STATUSES,
  PagingStep,
} from "../../../../Server/Utils/OnCall/FirstPagedAt";
import OnCallPolicyRunMessage from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import AlertMeasurementAnchorType from "../../../../Types/Alerts/AlertMeasurementAnchorType";
import IncidentMeasurementAnchorType from "../../../../Types/Incident/IncidentMeasurementAnchorType";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
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
 * FIRST PAGED AT: when somebody was first paged about an incident, an alert
 * or an episode - what "Time to acknowledge after paging" counts from.
 *
 * It is the first step of an on-call run (or a direct page) that names who
 * it paged and says the page went out; it is written once, while empty, and
 * never moved; and records paged before the upgrade get theirs from the
 * steps of their runs.
 */

interface CompareAndSetCall {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
  skipUpdateDateColumn?: boolean;
}

const PAGED_AT: Date = new Date("2026-10-20T08:00:00.000Z");
const ALERT_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-000000000001");
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);

// One step of a run that paged somebody about the alert.
function pageAboutAlert(
  status: OnCallDutyExecutionLogTimelineStatus,
): PagingStep {
  return {
    alertSentToUserId: ObjectID.generate(),
    status: status,
    createdAt: PAGED_AT,
    triggeredByAlertId: ALERT_ID,
  };
}

/*
 * Every service FirstPagedAt writes through, mocked: which records it set,
 * which it found already set, and which measurements it worked out again.
 */
interface World {
  writes: Record<string, Array<CompareAndSetCall>>;
  // Whether each table's record still has no First Paged At.
  isEmpty: Record<string, boolean>;
  recomputedAlerts: Array<string>;
  recomputedIncidents: Array<string>;
}

function mockWorld(): World {
  const world: World = {
    writes: { Alert: [], Incident: [], AlertEpisode: [], IncidentEpisode: [] },
    isEmpty: {
      Alert: true,
      Incident: true,
      AlertEpisode: true,
      IncidentEpisode: true,
    },
    recomputedAlerts: [],
    recomputedIncidents: [],
  };

  const services: Array<[string, unknown]> = [
    ["Alert", AlertService],
    ["Incident", IncidentService],
    ["AlertEpisode", AlertEpisodeService],
    ["IncidentEpisode", IncidentEpisodeService],
  ];

  for (const [table, service] of services) {
    jest
      .spyOn(
        service as typeof AlertService,
        "compareAndSetColumnsByIdWithoutHooks",
      )
      .mockImplementation((async (
        call: CompareAndSetCall,
      ): Promise<boolean> => {
        world.writes[table]!.push(call);

        // The statement checks the column is still empty, and fills it.
        if (!world.isEmpty[table]) {
          return false;
        }

        world.isEmpty[table] = false;
        return true;
      }) as never);
  }

  jest
    .spyOn(AlertMeasurementValueService, "recomputeForAlert")
    .mockImplementation((async (data: { alertId: ObjectID }): Promise<void> => {
      world.recomputedAlerts.push(data.alertId.toString());
    }) as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockImplementation((async (data: {
      incidentId: ObjectID;
    }): Promise<void> => {
      world.recomputedIncidents.push(data.incidentId.toString());
    }) as never);

  return world;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which steps of a run are a page that went out", () => {
  test("a page that reached somebody, that they acknowledged, or that they passed on", () => {
    expect(PAGE_WENT_OUT_STATUSES).toEqual([
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
    ]);

    for (const status of PAGE_WENT_OUT_STATUSES) {
      expect(FirstPagedAt.isPageThatWentOut(pageAboutAlert(status))).toBe(true);
    }
  });

  test("not a skipped step, a page that failed, or one still being sent", () => {
    for (const status of [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      OnCallDutyExecutionLogTimelineStatus.Error,
      OnCallDutyExecutionLogTimelineStatus.Started,
      OnCallDutyExecutionLogTimelineStatus.Executing,
    ]) {
      expect({
        status: status,
        isPage: FirstPagedAt.isPageThatWentOut(pageAboutAlert(status)),
      }).toEqual({ status: status, isPage: false });
    }
  });

  test("not a step that names nobody - a schedule with nobody on call, an empty rule", () => {
    expect(
      FirstPagedAt.isPageThatWentOut({
        ...pageAboutAlert(
          OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        ),
        alertSentToUserId: undefined,
      }),
    ).toBe(false);
    expect(FirstPagedAt.isPageThatWentOut({})).toBe(false);
  });
});

describe("FirstPagedAt.recordPage", () => {
  let world: World;

  beforeEach(() => {
    world = mockWorld();
  });

  test("sets the alert's First Paged At to when the person was paged, only while it is empty", async () => {
    await FirstPagedAt.recordPage(
      pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    );

    expect(world.writes["Alert"]).toEqual([
      {
        id: ALERT_ID,
        data: { firstPagedAt: PAGED_AT },
        // The statement writes only a row whose First Paged At is still empty.
        expectedData: { firstPagedAt: null },
        // Nobody edited the alert.
        skipUpdateDateColumn: true,
      },
    ]);
  });

  test("is set once: a later page, or a second run paging at the same time, does not move it", async () => {
    await FirstPagedAt.recordPage(
      pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    );

    const later: PagingStep = {
      ...pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
      createdAt: new Date("2026-10-20T08:30:00.000Z"),
    };

    await Promise.all([
      FirstPagedAt.recordPage(later),
      FirstPagedAt.recordPage(
        pageAboutAlert(
          OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        ),
      ),
    ]);

    // Each asked; only the first found it empty.
    expect(world.writes["Alert"]).toHaveLength(3);
    expect(world.recomputedAlerts).toEqual([ALERT_ID.toString()]);
  });

  test("works the alert's measurements out again when it set the first page, and only then", async () => {
    await FirstPagedAt.recordPage(
      pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    );

    expect(world.recomputedAlerts).toEqual([ALERT_ID.toString()]);

    world.recomputedAlerts = [];

    await FirstPagedAt.recordPage(
      pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.PassedOn),
    );

    expect(world.recomputedAlerts).toEqual([]);
  });

  test("records nothing for a skipped step or a page that failed", async () => {
    for (const status of [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      OnCallDutyExecutionLogTimelineStatus.Error,
      OnCallDutyExecutionLogTimelineStatus.Executing,
    ]) {
      await FirstPagedAt.recordPage(pageAboutAlert(status));
    }

    expect(world.writes["Alert"]).toEqual([]);
    expect(world.recomputedAlerts).toEqual([]);
  });

  test("records a direct page's step like a policy's: it names who it paged, with no policy or rule", async () => {
    const directPage: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    directPage.alertSentToUserId = ObjectID.generate();
    directPage.status = OnCallDutyExecutionLogTimelineStatus.NotificationSent;
    directPage.createdAt = PAGED_AT;
    directPage.triggeredByIncidentId = INCIDENT_ID;

    expect(directPage.onCallDutyPolicyId).toBeUndefined();

    await FirstPagedAt.recordPage(directPage);

    expect(world.writes["Incident"]).toEqual([
      {
        id: INCIDENT_ID,
        data: { firstPagedAt: PAGED_AT },
        expectedData: { firstPagedAt: null },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(world.recomputedIncidents).toEqual([INCIDENT_ID.toString()]);
  });

  test("records an episode's page on the episode, which has no measurements to work out", async () => {
    await FirstPagedAt.recordPage({
      alertSentToUserId: ObjectID.generate(),
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      createdAt: PAGED_AT,
      triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
    });
    await FirstPagedAt.recordPage({
      alertSentToUserId: ObjectID.generate(),
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      createdAt: PAGED_AT,
      triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
    });

    expect(
      world.writes["AlertEpisode"]!.map((call: CompareAndSetCall) => {
        return call.id.toString();
      }),
    ).toEqual([ALERT_EPISODE_ID.toString()]);
    expect(
      world.writes["IncidentEpisode"]!.map((call: CompareAndSetCall) => {
        return call.id.toString();
      }),
    ).toEqual([INCIDENT_EPISODE_ID.toString()]);
    expect(world.writes["Alert"]).toEqual([]);
    expect(world.writes["Incident"]).toEqual([]);
    expect(world.recomputedAlerts).toEqual([]);
    expect(world.recomputedIncidents).toEqual([]);
  });

  test("a step read without its creation time is being paged now", async () => {
    const before: number = Date.now();

    await FirstPagedAt.recordPage({
      ...pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
      createdAt: undefined,
    });

    const written: Date = world.writes["Alert"]![0]!.data[
      "firstPagedAt"
    ] as Date;

    expect(written.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("never throws on the paging path: a write that fails is logged and the page goes on", async () => {
    jest
      .spyOn(AlertService, "compareAndSetColumnsByIdWithoutHooks")
      .mockRejectedValue(new Error("connection reset") as never);

    await expect(
      FirstPagedAt.recordPage(
        pageAboutAlert(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
      ),
    ).resolves.toBeUndefined();
    expect(world.recomputedAlerts).toEqual([]);
  });
});

/*
 * The run's steps are written by the escalation as "Executing" and marked
 * once the page goes out (UserOnCallLogService); every write goes through the
 * timeline service's hooks, which record the first page.
 */
describe("the run's timeline records the first page as its status changes", () => {
  let world: World;

  type Hook = (...args: Array<unknown>) => Promise<unknown>;

  function hookOf(name: string): Hook {
    return (
      OnCallDutyPolicyExecutionLogTimelineService as unknown as Record<
        string,
        Hook
      >
    )[name]!.bind(OnCallDutyPolicyExecutionLogTimelineService);
  }

  function step(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): OnCallDutyPolicyExecutionLogTimeline {
    const row: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    row.id = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");
    row.onCallDutyPolicyExecutionLogId = ObjectID.generate();
    row.status = status;
    row.alertSentToUserId = ObjectID.generate();
    row.createdAt = PAGED_AT;
    row.triggeredByAlertId = ALERT_ID;
    return row;
  }

  async function update(data: {
    before: OnCallDutyExecutionLogTimelineStatus;
    after: OnCallDutyExecutionLogTimelineStatus;
  }): Promise<Record<string, unknown>> {
    const before: OnCallDutyPolicyExecutionLogTimeline = step(data.before);
    const after: OnCallDutyPolicyExecutionLogTimeline = step(data.after);

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([before]);

    let select: Record<string, unknown> = {};

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockImplementation((async (findBy: {
        select: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyExecutionLogTimeline>> => {
        select = findBy.select;
        return [after];
      }) as never);

    const onUpdate: unknown = await hookOf("onBeforeUpdate")({
      query: { _id: before.id!.toString() },
      data: { status: data.after },
      props: { isRoot: true },
    });

    await hookOf("onUpdateSuccess")(onUpdate, [before.id]);

    return select;
  }

  beforeEach(() => {
    world = mockWorld();

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "addToIncidentOrAlertFeed",
      )
      .mockResolvedValue(undefined as never);
    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
      return undefined;
    });
  });

  test("a page marked Notification Sent is the alert's first page, at the step's creation", async () => {
    const select: Record<string, unknown> = await update({
      before: OnCallDutyExecutionLogTimelineStatus.Executing,
      after: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    });

    // What the hook reads back of the step, for FirstPagedAt.
    expect(select).toMatchObject({
      alertSentToUserId: true,
      createdAt: true,
      triggeredByIncidentId: true,
      triggeredByAlertId: true,
      triggeredByAlertEpisodeId: true,
      triggeredByIncidentEpisodeId: true,
    });
    expect(world.writes["Alert"]).toEqual([
      {
        id: ALERT_ID,
        data: { firstPagedAt: PAGED_AT },
        expectedData: { firstPagedAt: null },
        skipUpdateDateColumn: true,
      },
    ]);
  });

  test("a page acknowledged before it was ever marked sent still went out", async () => {
    await update({
      before: OnCallDutyExecutionLogTimelineStatus.Executing,
      after: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    });

    expect(world.writes["Alert"]).toHaveLength(1);
  });

  test("a step skipped or failed records nothing", async () => {
    await update({
      before: OnCallDutyExecutionLogTimelineStatus.Executing,
      after: OnCallDutyExecutionLogTimelineStatus.Skipped,
    });
    await update({
      before: OnCallDutyExecutionLogTimelineStatus.Executing,
      after: OnCallDutyExecutionLogTimelineStatus.Error,
    });

    expect(world.writes["Alert"]).toEqual([]);
  });

  test("a status written again unchanged asks nothing", async () => {
    await update({
      before: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      after: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    });

    expect(world.writes["Alert"]).toEqual([]);
  });

  test("a new step written as Executing, as the escalation writes every page, records nothing yet", async () => {
    const created: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.Executing,
    );

    await hookOf("onCreateSuccess")(
      { createBy: { data: created, props: { isRoot: true } } },
      created,
    );

    expect(world.writes["Alert"]).toEqual([]);
  });

  test("a new step written already sent records it", async () => {
    const created: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );

    await hookOf("onCreateSuccess")(
      { createBy: { data: created, props: { isRoot: true } } },
      created,
    );

    expect(world.writes["Alert"]).toHaveLength(1);
  });
});

describe("FirstPagedAt.backfill", () => {
  interface Statement {
    table: string;
    sql: string;
    parameters: Array<unknown>;
  }

  /*
   * A database whose records still without a First Paged At are listed per
   * table (in primary key order), and whose fill statement fills the ids it
   * is told were paged.
   */
  function mockDatabase(data: {
    emptyIds: Record<string, Array<string>>;
    pagedIds: Record<string, Array<string>>;
    measurementIds?: Record<string, Array<string>>;
  }): Array<Statement> {
    const statements: Array<Statement> = [];

    const services: Array<[string, unknown]> = [
      ["Alert", AlertService],
      ["Incident", IncidentService],
      ["AlertEpisode", AlertEpisodeService],
      ["IncidentEpisode", IncidentEpisodeService],
    ];

    for (const [table, service] of services) {
      jest
        .spyOn(service as typeof AlertService, "getRepository")
        .mockReturnValue({
          manager: {
            query: async (
              sql: string,
              parameters: Array<unknown>,
            ): Promise<Array<{ _id: string }>> => {
              statements.push({ table, sql, parameters });

              if (sql.startsWith("SELECT")) {
                const limit: number = parameters[0] as number;
                const after: string | null = parameters[1] as string | null;

                return (data.emptyIds[table] || [])
                  .filter((id: string): boolean => {
                    return !after || id > after;
                  })
                  .slice(0, limit)
                  .map((id: string) => {
                    return { _id: id };
                  });
              }

              if (sql.includes('"filled"')) {
                const asked: Array<string> = parameters[0] as Array<string>;

                return asked
                  .filter((id: string): boolean => {
                    return (data.pagedIds[table] || []).includes(id);
                  })
                  .map((id: string) => {
                    return { _id: id };
                  });
              }

              // The measurements asked to be worked out again.
              return (
                data.measurementIds?.[
                  sql.includes('"IncidentMeasurement"')
                    ? "IncidentMeasurement"
                    : "AlertMeasurement"
                ] || []
              ).map((id: string) => {
                return { _id: id };
              });
            },
          },
        } as never);
    }

    return statements;
  }

  test("fills each table a batch at a time, from the earliest step that paged somebody", async () => {
    const statements: Array<Statement> = mockDatabase({
      emptyIds: {
        Alert: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
        ],
      },
      pagedIds: {
        Alert: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000003",
        ],
      },
    });

    const result: FirstPagedAtBackfillResult = await FirstPagedAt.backfill({
      batchSize: 2,
    });

    expect(result.filledByTable).toEqual({
      Incident: 0,
      Alert: 2,
      AlertEpisode: 0,
      IncidentEpisode: 0,
    });

    const alertStatements: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.table === "Alert";
      },
    );

    // Two pages of two, the second short: read, fill, read, fill.
    expect(
      alertStatements.map((statement: Statement): string => {
        return statement.sql.slice(0, 6);
      }),
    ).toEqual(["SELECT", 'WITH "', "SELECT", 'WITH "', 'WITH "']);
    expect(alertStatements[0]!.parameters).toEqual([2, null]);
    expect(alertStatements[2]!.parameters).toEqual([
      2,
      "00000000-0000-4000-8000-000000000002",
    ]);

    const fill: Statement = alertStatements[1]!;

    // Only records still empty, from the alert's own steps that paged somebody.
    expect(fill.sql).toContain('"triggeredByAlertId" = ANY($1::uuid[])');
    expect(fill.sql).toContain('"alertSentToUserId" IS NOT NULL');
    expect(fill.sql).toContain('"status" = ANY($2::text[])');
    expect(fill.sql).toContain('MIN("createdAt")');
    expect(fill.sql).toContain('"record"."firstPagedAt" IS NULL');
    expect(fill.parameters).toEqual([
      [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
      ["Notification Sent", "Successfully Acknowledged", "Passed On"],
    ]);

    // The read never asks for a record that already has one.
    expect(alertStatements[0]!.sql).toContain('"firstPagedAt" IS NULL');
  });

  test("reads every table by its own column of the step", async () => {
    const statements: Array<Statement> = mockDatabase({
      emptyIds: {
        Incident: ["10000000-0000-4000-8000-000000000001"],
        AlertEpisode: ["20000000-0000-4000-8000-000000000001"],
        IncidentEpisode: ["30000000-0000-4000-8000-000000000001"],
      },
      pagedIds: {},
    });

    await FirstPagedAt.backfill();

    const fillOf: (table: string) => string = (table: string): string => {
      return statements.find((statement: Statement): boolean => {
        return statement.table === table && statement.sql.includes('"filled"');
      })!.sql;
    };

    expect(fillOf("Incident")).toContain('UPDATE "Incident" AS "record"');
    expect(fillOf("Incident")).toContain('"triggeredByIncidentId"');
    expect(fillOf("AlertEpisode")).toContain('UPDATE "AlertEpisode"');
    expect(fillOf("AlertEpisode")).toContain('"triggeredByAlertEpisodeId"');
    expect(fillOf("IncidentEpisode")).toContain('UPDATE "IncidentEpisode"');
    expect(fillOf("IncidentEpisode")).toContain(
      '"triggeredByIncidentEpisodeId"',
    );
  });

  test("asks for the measurements that start or end at First Paged At to be worked out again, once their records are filled", async () => {
    expect(AlertMeasurementAnchorType.FirstPagedAt as string).toBe(
      IncidentMeasurementAnchorType.FirstPagedAt as string,
    );

    const statements: Array<Statement> = mockDatabase({
      emptyIds: {
        Alert: ["00000000-0000-4000-8000-000000000001"],
        Incident: ["10000000-0000-4000-8000-000000000001"],
      },
      pagedIds: { Alert: ["00000000-0000-4000-8000-000000000001"] },
      measurementIds: {
        AlertMeasurement: ["40000000-0000-4000-8000-000000000001"],
        IncidentMeasurement: ["50000000-0000-4000-8000-000000000001"],
      },
    });

    const result: FirstPagedAtBackfillResult = await FirstPagedAt.backfill();

    const requeues: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql.includes('"requeued"');
      },
    );

    // Alerts were filled; no incident was, so no incident measurement is redone.
    expect(requeues).toHaveLength(1);
    expect(requeues[0]!.sql).toContain('UPDATE "AlertMeasurement"');
    expect(requeues[0]!.sql).toContain(
      '"startAnchorType" = $1 OR "endAnchorType" = $1',
    );
    expect(requeues[0]!.sql).toContain('"backfillRequestedAt" = now()');
    expect(requeues[0]!.sql).toContain('"backfillCompletedAt" = NULL');
    expect(requeues[0]!.parameters).toEqual(["First Paged At"]);
    expect(result.measurementsRequeued).toBe(1);
  });

  test("does nothing on a database with nothing to fill", async () => {
    const statements: Array<Statement> = mockDatabase({
      emptyIds: {},
      pagedIds: {},
    });

    const result: FirstPagedAtBackfillResult = await FirstPagedAt.backfill();

    expect(result).toEqual({
      filledByTable: {
        Incident: 0,
        Alert: 0,
        AlertEpisode: 0,
        IncidentEpisode: 0,
      },
      measurementsRequeued: 0,
    });
    expect(
      statements.every((statement: Statement): boolean => {
        return statement.sql.startsWith("SELECT");
      }),
    ).toBe(true);
  });
});
