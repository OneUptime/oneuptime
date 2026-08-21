import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the Measurement:Backfill cron, which fills in
 * measurement values for entities that already existed when a measurement was
 * defined.
 *
 * The job reaches every service through `as unknown as` casts -- the model
 * graph is too deep to instantiate Partial<Model> over -- so the compiler
 * checks almost nothing about the values it writes. These tests stand in for
 * the types that cannot be applied:
 *
 *   1. THE COLUMN CONTRACT. All three backfill columns are TIMESTAMPs. The
 *      progress patch must carry Dates into backfillCursorCreatedAt /
 *      backfillCompletedAt and the measurement id must travel as `id`, never
 *      into a date column: an ObjectID landing in the cursor is a write error
 *      that takes down the whole backfill for that project.
 *   2. THE RESUME SEMANTICS. Completed-at-or-after-requested is what stops a
 *      finished backfill from being redone every five minutes, and the cursor
 *      is what stops a restart from starting the project over.
 *   3. THE TWO NON-TERMINATION GUARDS: the same-timestamp stall bail-out and
 *      the per-run page cap, plus the isolation that keeps one unreadable
 *      entity, or one broken domain, from stalling everything behind it.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

function mockMeasurementService(): {
  __esModule: true;
  default: { findBy: jest.Mock; updateOneById: jest.Mock };
} {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
}

jest.mock("Common/Server/Services/IncidentMeasurementService", () => {
  return mockMeasurementService();
});
jest.mock("Common/Server/Services/AlertMeasurementService", () => {
  return mockMeasurementService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementService",
  () => {
    return mockMeasurementService();
  },
);

jest.mock("Common/Server/Services/IncidentMeasurementValueService", () => {
  return {
    __esModule: true,
    default: { recomputeForIncident: jest.fn() },
  };
});
jest.mock("Common/Server/Services/AlertMeasurementValueService", () => {
  return {
    __esModule: true,
    default: { recomputeForAlert: jest.fn() },
  };
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementValueService",
  () => {
    return {
      __esModule: true,
      default: { recomputeForScheduledMaintenance: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import IncidentMeasurementService from "Common/Server/Services/IncidentMeasurementService";
import AlertMeasurementService from "Common/Server/Services/AlertMeasurementService";
import ScheduledMaintenanceMeasurementService from "Common/Server/Services/ScheduledMaintenanceMeasurementService";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import AlertMeasurementValueService from "Common/Server/Services/AlertMeasurementValueService";
import ScheduledMaintenanceMeasurementValueService from "Common/Server/Services/ScheduledMaintenanceMeasurementValueService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Measurement/BackfillMeasurements";

interface MeasurementServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
}

interface EntityServiceMock {
  findBy: jest.Mock;
}

const incidentMeasurements: MeasurementServiceMock =
  IncidentMeasurementService as unknown as MeasurementServiceMock;
const alertMeasurements: MeasurementServiceMock =
  AlertMeasurementService as unknown as MeasurementServiceMock;
const maintenanceMeasurements: MeasurementServiceMock =
  ScheduledMaintenanceMeasurementService as unknown as MeasurementServiceMock;

const incidents: EntityServiceMock =
  IncidentService as unknown as EntityServiceMock;
const alerts: EntityServiceMock = AlertService as unknown as EntityServiceMock;
const maintenanceEvents: EntityServiceMock =
  ScheduledMaintenanceService as unknown as EntityServiceMock;

const incidentValues: { recomputeForIncident: jest.Mock } =
  IncidentMeasurementValueService as unknown as {
    recomputeForIncident: jest.Mock;
  };
const alertValues: { recomputeForAlert: jest.Mock } =
  AlertMeasurementValueService as unknown as { recomputeForAlert: jest.Mock };
const maintenanceValues: { recomputeForScheduledMaintenance: jest.Mock } =
  ScheduledMaintenanceMeasurementValueService as unknown as {
    recomputeForScheduledMaintenance: jest.Mock;
  };

const mockedLogger: { error: jest.Mock; warn: jest.Mock } =
  logger as unknown as {
    error: jest.Mock;
    warn: jest.Mock;
  };

// Mirrors the constants in the job. A page shorter than this ends the run.
const PAGE_SIZE: number = 500;
const MAX_PAGES_PER_RUN: number = 10;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface MeasurementRow {
  _id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  backfillRequestedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
}

interface EntityRow {
  _id?: ObjectID | undefined;
  createdAt?: Date | undefined;
}

function measurementRow(input: {
  id?: ObjectID;
  projectId?: ObjectID | undefined;
  requestedAt?: Date | undefined;
  completedAt?: Date | undefined;
  cursorCreatedAt?: Date | undefined;
}): MeasurementRow {
  return {
    _id: input.id ?? MEASUREMENT_ID,
    projectId: input.projectId ?? PROJECT_ID,
    backfillRequestedAt:
      input.requestedAt ?? new Date("2026-07-01T00:00:00.000Z"),
    backfillCompletedAt: input.completedAt,
    backfillCursorCreatedAt: input.cursorCreatedAt,
  };
}

// A page of entities one second apart, oldest first, as the job sorts them.
function entityPage(input: {
  count: number;
  firstCreatedAt: Date;
  prefix?: string;
  sameTimestamp?: boolean;
}): Array<EntityRow> {
  const rows: Array<EntityRow> = [];

  for (let index: number = 0; index < input.count; index++) {
    rows.push({
      _id: new ObjectID(`${input.prefix || "entity"}-${index}`),
      createdAt: input.sameTimestamp
        ? input.firstCreatedAt
        : new Date(input.firstCreatedAt.getTime() + index * 1000),
    });
  }

  return rows;
}

/*
 * Reads the single value bound into one of QueryHelper's Raw predicates
 * (typeorm keeps the bound parameters on the FindOperator).
 */
function boundValueOf(predicate: unknown): unknown {
  if (!predicate) {
    return undefined;
  }

  const parameters: Record<string, unknown> | undefined = (
    predicate as {
      objectLiteralParameters?: Record<string, unknown> | undefined;
    }
  ).objectLiteralParameters;

  return Object.values(parameters || {})[0];
}

function entityQueryOf(call: Array<unknown>): Record<string, unknown> {
  return (call[0] as { query: Record<string, unknown> }).query;
}

function patchOf(call: Array<unknown>): Record<string, unknown> {
  return (call[0] as { data: Record<string, unknown> }).data;
}

function idOf(call: Array<unknown>): ObjectID {
  return (call[0] as { id: ObjectID }).id;
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["Measurement:Backfill"];

  if (!handler) {
    throw new Error("Measurement:Backfill did not register a cron handler");
  }

  await handler();
}

describe("Measurement:Backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Nothing to backfill in any domain unless a test says otherwise.
    for (const service of [
      incidentMeasurements,
      alertMeasurements,
      maintenanceMeasurements,
    ]) {
      service.findBy.mockResolvedValue([] as Array<MeasurementRow>);
      service.updateOneById.mockResolvedValue(undefined);
    }

    for (const service of [incidents, alerts, maintenanceEvents]) {
      service.findBy.mockResolvedValue([] as Array<EntityRow>);
    }

    incidentValues.recomputeForIncident.mockResolvedValue(undefined);
    alertValues.recomputeForAlert.mockResolvedValue(undefined);
    maintenanceValues.recomputeForScheduledMaintenance.mockResolvedValue(
      undefined,
    );
  });

  test("registers itself, so the tick under test is the one that ships", () => {
    expect(mockCapturedJobs["Measurement:Backfill"]).toBeDefined();
  });

  test("walks every domain on one tick, so a measurement is never left to a later run", async () => {
    await runTick();

    expect(incidentMeasurements.findBy).toHaveBeenCalledTimes(1);
    expect(alertMeasurements.findBy).toHaveBeenCalledTimes(1);
    expect(maintenanceMeasurements.findBy).toHaveBeenCalledTimes(1);
  });

  describe("deciding what still needs a backfill", () => {
    test("skips a measurement that finished after it was requested, so a done backfill is not redone every five minutes", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({
          requestedAt: new Date("2026-07-01T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:05:00.000Z"),
        }),
      ]);

      await runTick();

      expect(incidents.findBy).not.toHaveBeenCalled();
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });

    test("runs again when the definition was edited after the last completion, because its history has to be rewritten", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({
          completedAt: new Date("2026-07-01T00:05:00.000Z"),
          requestedAt: new Date("2026-07-02T00:00:00.000Z"),
        }),
      ]);

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
    });

    test("runs a measurement that has never completed", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ completedAt: undefined }),
      ]);

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
    });

    test("skips a row with no id or no project, which has nothing to scope a walk to", async () => {
      const requestedAt: Date = new Date("2026-07-01T00:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        { projectId: PROJECT_ID, backfillRequestedAt: requestedAt },
        { _id: MEASUREMENT_ID, backfillRequestedAt: requestedAt },
      ] as Array<MeasurementRow>);

      await runTick();

      expect(incidents.findBy).not.toHaveBeenCalled();
    });
  });

  describe("the progress patch", () => {
    test("writes timestamps into the backfill columns and carries the measurement id as the row id", async () => {
      /*
       * THE regression this suite exists for. Both columns are TIMESTAMPs, and
       * the only ObjectID in play addresses the row -- it must never be one of
       * the values.
       */
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({ count: 3, firstCreatedAt: created }),
      );

      await runTick();

      expect(incidentMeasurements.updateOneById).toHaveBeenCalledTimes(1);

      const call: Array<unknown> =
        incidentMeasurements.updateOneById.mock.calls[0]!;

      expect(idOf(call).toString()).toBe(MEASUREMENT_ID.toString());

      const patch: Record<string, unknown> = patchOf(call);

      expect(Object.keys(patch).sort()).toEqual([
        "backfillCompletedAt",
        "backfillCursorCreatedAt",
      ]);

      for (const column of Object.keys(patch)) {
        expect(patch[column]).toBeInstanceOf(Date);
        expect(patch[column]).not.toBeInstanceOf(ObjectID);
      }

      // The cursor is the last row of the page, not the first and not "now".
      expect((patch["backfillCursorCreatedAt"] as Date).toISOString()).toBe(
        new Date(created.getTime() + 2000).toISOString(),
      );
    });

    test("stamps completion on a short page, because a page under the limit is the end of the project", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: PAGE_SIZE - 1,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
      expect(
        patchOf(incidentMeasurements.updateOneById.mock.calls[0]!)[
          "backfillCompletedAt"
        ],
      ).toBeInstanceOf(Date);
    });

    test("stamps completion for a project with no entities at all, so an empty project stops being rescanned", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue([]);

      await runTick();

      const patch: Record<string, unknown> = patchOf(
        incidentMeasurements.updateOneById.mock.calls[0]!,
      );

      expect(patch["backfillCompletedAt"]).toBeInstanceOf(Date);
      // No rows, so there is no cursor to write -- and null would clear it.
      expect(patch["backfillCursorCreatedAt"]).toBeUndefined();
    });

    test("saves the cursor without a completion stamp mid-walk, so an interrupted run resumes instead of finishing early", async () => {
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({ count: PAGE_SIZE, firstCreatedAt: created }),
        )
        .mockResolvedValue([]);

      await runTick();

      const firstPatch: Record<string, unknown> = patchOf(
        incidentMeasurements.updateOneById.mock.calls[0]!,
      );

      expect(firstPatch["backfillCursorCreatedAt"]).toBeInstanceOf(Date);
      expect(firstPatch["backfillCompletedAt"]).toBeUndefined();
    });
  });

  describe("paging", () => {
    test("scopes the first page to the project with no cursor predicate", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: undefined }),
      ]);

      await runTick();

      const query: Record<string, unknown> = entityQueryOf(
        incidents.findBy.mock.calls[0]!,
      );

      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["createdAt"]).toBeUndefined();
    });

    test("resumes from the stored cursor rather than walking the project again", async () => {
      const cursor: Date = new Date("2026-06-15T12:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: cursor }),
      ]);

      await runTick();

      const query: Record<string, unknown> = entityQueryOf(
        incidents.findBy.mock.calls[0]!,
      );

      /*
       * Inclusive on purpose: rows sharing the boundary timestamp are
       * recomputed again rather than risking a skip, and the recompute is a
       * total function of current data.
       */
      expect(boundValueOf(query["createdAt"])).toEqual(cursor);
    });

    test("advances the cursor page by page until a short page ends the walk", async () => {
      const created: Date = new Date("2026-06-01T09:00:00.000Z");
      const secondPageStart: Date = new Date("2026-06-02T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({ count: PAGE_SIZE, firstCreatedAt: created }),
        )
        .mockResolvedValueOnce(
          entityPage({ count: 2, firstCreatedAt: secondPageStart }),
        );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(2);

      // The second page starts at the last row of the first.
      expect(
        boundValueOf(
          entityQueryOf(incidents.findBy.mock.calls[1]!)["createdAt"],
        ),
      ).toEqual(new Date(created.getTime() + (PAGE_SIZE - 1) * 1000));

      expect(incidentMeasurements.updateOneById).toHaveBeenCalledTimes(2);
      expect(
        patchOf(incidentMeasurements.updateOneById.mock.calls[1]!)[
          "backfillCompletedAt"
        ],
      ).toBeInstanceOf(Date);
    });

    test("stops after the per-run page cap, so one large project cannot starve the others", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockImplementation(
        (data: unknown): Promise<Array<EntityRow>> => {
          /*
           * Every page is full and strictly newer than the last, so only the
           * cap can end this walk.
           */
          const after: Date =
            (boundValueOf(
              (data as { query: Record<string, unknown> }).query["createdAt"],
            ) as Date) || new Date("2026-06-01T09:00:00.000Z");

          return Promise.resolve(
            entityPage({
              count: PAGE_SIZE,
              firstCreatedAt: new Date(after.getTime() + 1000),
            }),
          );
        },
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
      // Nothing is marked complete: the next tick picks the walk back up.
      for (const call of incidentMeasurements.updateOneById.mock.calls) {
        expect(patchOf(call)["backfillCompletedAt"]).toBeUndefined();
      }
    });

    test("bails out with a warning when a full page shares one timestamp, instead of paging the same rows for ever", async () => {
      const stuck: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: stuck }),
      ]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: PAGE_SIZE,
          firstCreatedAt: stuck,
          sameTimestamp: true,
        }),
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(String(mockedLogger.warn.mock.calls[0]![0])).toContain(
        MEASUREMENT_ID.toString(),
      );
      // Neither the cursor nor completion moves, so the next tick can retry.
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("recomputing", () => {
    test("recomputes every entity on the page, which is what actually fills the measurement in", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: 3,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );

      await runTick();

      expect(incidentValues.recomputeForIncident).toHaveBeenCalledTimes(3);
      expect(incidentValues.recomputeForIncident).toHaveBeenCalledWith({
        incidentId: expect.any(ObjectID),
      });
    });

    test("keeps going when one entity fails, so a single bad row cannot stall the cursor behind it", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: 3,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );
      incidentValues.recomputeForIncident
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("unreadable incident"))
        .mockResolvedValueOnce(undefined);

      await runTick();

      expect(incidentValues.recomputeForIncident).toHaveBeenCalledTimes(3);
      expect(mockedLogger.error).toHaveBeenCalled();
      // The page still completes, so the walk moves past the bad row.
      expect(incidentMeasurements.updateOneById).toHaveBeenCalledTimes(1);
    });

    test("routes each domain to its own value service and entity table", async () => {
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      alerts.findBy.mockResolvedValue(
        entityPage({ count: 1, firstCreatedAt: created }),
      );
      maintenanceMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      maintenanceEvents.findBy.mockResolvedValue(
        entityPage({ count: 1, firstCreatedAt: created }),
      );

      await runTick();

      expect(alertValues.recomputeForAlert).toHaveBeenCalledWith({
        alertId: expect.any(ObjectID),
      });
      expect(
        maintenanceValues.recomputeForScheduledMaintenance,
      ).toHaveBeenCalledWith({
        scheduledMaintenanceId: expect.any(ObjectID),
      });

      expect(incidentValues.recomputeForIncident).not.toHaveBeenCalled();
      expect(alertMeasurements.updateOneById).toHaveBeenCalledTimes(1);
      expect(maintenanceMeasurements.updateOneById).toHaveBeenCalledTimes(1);
    });
  });

  test("logs and moves on when a whole domain fails, so one broken table does not block the rest", async () => {
    incidentMeasurements.findBy.mockRejectedValue(
      new Error("incident measurements unavailable"),
    );
    alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
    alerts.findBy.mockResolvedValue(
      entityPage({
        count: 1,
        firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
      }),
    );

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(alertValues.recomputeForAlert).toHaveBeenCalledTimes(1);
    expect(maintenanceMeasurements.findBy).toHaveBeenCalledTimes(1);
  });
});
