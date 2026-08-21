import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ScheduledMaintenanceMeasurementAnchorType from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The scheduled maintenance twin of
 * Tests/Server/Services/IncidentMeasurementService.test.ts -- keep the three
 * suites symmetric, the services are line-for-line equivalents over a
 * different set of state columns and anchors.
 *
 * Maintenance is the domain that carries a PLANNED window, so this suite also
 * pins the anchors incidents and alerts do not have: scheduled starts / ends
 * against what actually happened.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SCHEDULED_STATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const COMPLETED_STATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

/*
 * The hooks are protected, as they are on every DatabaseService. Reaching them
 * through a cast is how the rest of this suite exercises them -- see
 * Tests/Server/Types/Database/Permissions/TenantPermission.test.ts.
 */
interface MeasurementHooks {
  onBeforeCreate(
    createBy: CreateBy<ScheduledMaintenanceMeasurement>,
  ): Promise<OnCreate<ScheduledMaintenanceMeasurement>>;
  onBeforeUpdate(
    updateBy: UpdateBy<ScheduledMaintenanceMeasurement>,
  ): Promise<OnUpdate<ScheduledMaintenanceMeasurement>>;
  onBeforeDelete(
    deleteBy: DeleteBy<ScheduledMaintenanceMeasurement>,
  ): Promise<OnDelete<ScheduledMaintenanceMeasurement>>;
}

const hooks: MeasurementHooks =
  ScheduledMaintenanceMeasurementService as unknown as MeasurementHooks;

function buildCreateBy(input: {
  key?: string;
  name?: string;
  order?: number;
  startAnchorType?: ScheduledMaintenanceMeasurementAnchorType;
  endAnchorType?: ScheduledMaintenanceMeasurementAnchorType;
  startStateId?: ObjectID;
  endStateId?: ObjectID;
  startStateRole?: ScheduledMaintenanceStateRole;
  endStateRole?: ScheduledMaintenanceStateRole;
}): CreateBy<ScheduledMaintenanceMeasurement> {
  const measurement: ScheduledMaintenanceMeasurement =
    new ScheduledMaintenanceMeasurement();

  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Start Delay";
  measurement.key = input.key ?? "start-delay";
  measurement.startAnchorType =
    input.startAnchorType ??
    ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt;
  measurement.endAnchorType =
    input.endAnchorType ??
    ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered;

  if (input.order !== undefined) {
    measurement.order = input.order;
  }

  if (input.startStateId) {
    measurement.startScheduledMaintenanceStateId = input.startStateId;
  }

  if (input.endStateId) {
    measurement.endScheduledMaintenanceStateId = input.endStateId;
  }

  if (input.startStateRole) {
    measurement.startScheduledMaintenanceStateRole = input.startStateRole;
  }

  if (
    measurement.endAnchorType ===
    ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered
  ) {
    measurement.endScheduledMaintenanceStateRole =
      input.endStateRole ?? ScheduledMaintenanceStateRole.Ongoing;
  } else if (input.endStateRole) {
    measurement.endScheduledMaintenanceStateRole = input.endStateRole;
  }

  return {
    data: measurement,
    props: { isRoot: true },
  };
}

function buildExistingMeasurement(input: {
  isSystemDefined?: boolean;
  name?: string;
  metricName?: string;
  isEnabled?: boolean;
}): ScheduledMaintenanceMeasurement {
  const measurement: ScheduledMaintenanceMeasurement =
    new ScheduledMaintenanceMeasurement();

  measurement._id = MEASUREMENT_ID.toString();
  measurement.id = MEASUREMENT_ID;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Start Delay";
  measurement.isSystemDefined = input.isSystemDefined ?? false;
  measurement.isEnabled = input.isEnabled ?? true;
  measurement.startAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt;
  measurement.endAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered;
  measurement.endScheduledMaintenanceStateRole =
    ScheduledMaintenanceStateRole.Ongoing;

  if (input.metricName) {
    measurement.metricName = input.metricName;
  }

  return measurement;
}

function buildScheduledMaintenanceState(input: {
  id: ObjectID;
  name: string;
  order: number;
}): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();

  state._id = input.id.toString();
  state.id = input.id;
  state.name = input.name;
  state.order = input.order;

  return state;
}

function buildUpdateBy(
  data: Record<string, unknown>,
): UpdateBy<ScheduledMaintenanceMeasurement> {
  return {
    id: MEASUREMENT_ID,
    query: { _id: MEASUREMENT_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ScheduledMaintenanceMeasurement>;
}

function dataOf(
  updateBy: UpdateBy<ScheduledMaintenanceMeasurement>,
): Record<string, unknown> {
  return updateBy.data as unknown as Record<string, unknown>;
}

describe("ScheduledMaintenanceMeasurementService", () => {
  beforeEach(() => {
    // No existing definitions unless a test says otherwise.
    jest
      .spyOn(ScheduledMaintenanceMeasurementService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
      .mockResolvedValue([] as Array<ScheduledMaintenanceMeasurement> as never);
    jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValue([] as Array<ScheduledMaintenanceState> as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeCreate", () => {
    test("rejects a key that could not survive as part of a metric name", async () => {
      /*
       * The key lands in the metric name, in ClickHouse and in the API, and is
       * immutable afterwards. This is the only moment it can still be fixed.
       */
      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "Start Delay" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "" })),
      ).rejects.toThrow(BadDataException);

      // Leading hyphen, and one character past the 50 the column allows.
      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "-start-delay" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "a".repeat(51) })),
      ).rejects.toThrow(BadDataException);
    });

    test("accepts a lowercase hyphenated key", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        { key: "maintenance-overrun" },
      );

      await expect(hooks.onBeforeCreate(createBy)).resolves.toBeDefined();
    });

    test("derives the metric name from the key, so a new definition is chartable with no dashboard change", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        { key: "start-delay" },
      );

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.metricName).toBe(
        "oneuptime.scheduled-maintenance.measurement.start-delay",
      );
    });

    test("puts a new definition after the project's last one, so the settings list has a stable order", async () => {
      const highest: ScheduledMaintenanceMeasurement =
        new ScheduledMaintenanceMeasurement();
      highest.order = 2;

      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findOneBy")
        .mockResolvedValue(highest as never);

      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {},
      );

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(3);
    });

    test("gives the first definition in a project order 1", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {},
      );

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(1);
    });

    test("keeps an order the caller supplied, so a reordered list is not overwritten on save", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        { order: 6 },
      );

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(6);
      expect(
        ScheduledMaintenanceMeasurementService.findOneBy,
      ).not.toHaveBeenCalled();
    });

    test("requests a backfill, or the definition would be blank on every maintenance event that already ran", async () => {
      const before: number = Date.now();

      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {},
      );

      await hooks.onBeforeCreate(createBy);

      const requestedAt: Date | undefined = createBy.data.backfillRequestedAt;

      expect(requestedAt).toBeInstanceOf(Date);
      expect(requestedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(requestedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test("leaves the backfill cursor and completion stamp unset on create, so the worker starts from the beginning", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {},
      );

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.backfillCursorCreatedAt).toBeUndefined();
      expect(createBy.data.backfillCompletedAt).toBeUndefined();
    });

    test("accepts the planned window as a measurement, which is the anchor pair only maintenance has", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {
          key: "planned-window-length",
          startAnchorType:
            ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
          endAnchorType:
            ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
        },
      );

      await expect(hooks.onBeforeCreate(createBy)).resolves.toBeDefined();
    });

    test("rejects a definition with no start or no end, which has nothing to measure between", async () => {
      const missingStart: CreateBy<ScheduledMaintenanceMeasurement> =
        buildCreateBy({});
      delete missingStart.data.startAnchorType;

      await expect(hooks.onBeforeCreate(missingStart)).rejects.toThrow(
        BadDataException,
      );

      const missingEnd: CreateBy<ScheduledMaintenanceMeasurement> =
        buildCreateBy({});
      delete missingEnd.data.endAnchorType;

      await expect(hooks.onBeforeCreate(missingEnd)).rejects.toThrow(
        BadDataException,
      );
    });

    test("rejects a state anchor with no state picked, which would never resolve to a timestamp", async () => {
      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
          }),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("rejects a state-role anchor with no role picked", async () => {
      const createBy: CreateBy<ScheduledMaintenanceMeasurement> = buildCreateBy(
        {
          startAnchorType:
            ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
          endAnchorType:
            ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
          endStateRole: ScheduledMaintenanceStateRole.Ended,
        },
      );

      // No start role, so the start of the duration has no timestamp to read.
      delete createBy.data.startScheduledMaintenanceStateRole;

      await expect(hooks.onBeforeCreate(createBy)).rejects.toThrow(
        BadDataException,
      );
    });

    test("rejects two anchors that read the same column, which would chart a constant zero", async () => {
      /*
       * Different enum values, one column: both Timeline Start and Created At
       * resolve to the event's createdAt.
       */
      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.TimelineStart,
            endAnchorType: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
          }),
        ),
      ).rejects.toThrow(/always be zero/);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
          }),
        ),
      ).rejects.toThrow(/always be zero/);
    });

    test("rejects the same state role at both ends, and allows two different ones", async () => {
      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
            startStateRole: ScheduledMaintenanceStateRole.Ongoing,
            endStateRole: ScheduledMaintenanceStateRole.Ongoing,
          }),
        ),
      ).rejects.toThrow(/always be zero/);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
            startStateRole: ScheduledMaintenanceStateRole.Ongoing,
            endStateRole: ScheduledMaintenanceStateRole.Ended,
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("rejects a definition that ends at a state the event reaches before it starts, which could never complete", async () => {
      jest.spyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue([
        buildScheduledMaintenanceState({
          id: SCHEDULED_STATE_ID,
          name: "Scheduled",
          order: 1,
        }),
        buildScheduledMaintenanceState({
          id: COMPLETED_STATE_ID,
          name: "Completed",
          order: 3,
        }),
      ] as never);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
            startStateId: COMPLETED_STATE_ID,
            endStateId: SCHEDULED_STATE_ID,
          }),
        ),
      ).rejects.toThrow(/Completed/);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
            endAnchorType:
              ScheduledMaintenanceMeasurementAnchorType.StateEntered,
            startStateId: SCHEDULED_STATE_ID,
            endStateId: COMPLETED_STATE_ID,
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("onBeforeUpdate", () => {
    test("restarts the backfill when the definition's meaning changes, so its stored history is rewritten", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([buildExistingMeasurement({})] as never);

      const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> = buildUpdateBy(
        { endStateOccurrence: "Last" },
      );

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = dataOf(updateBy);

      expect(data["backfillRequestedAt"]).toBeInstanceOf(Date);
      // Cleared, or the restarted backfill would resume mid-way through.
      expect(data["backfillCursorCreatedAt"]).toBeNull();
      expect(data["backfillCompletedAt"]).toBeNull();
    });

    test("restarts the backfill for every column that changes what the number means", async () => {
      const definitionKeys: Array<string> = [
        "startAnchorType",
        "endAnchorType",
        "startScheduledMaintenanceStateId",
        "endScheduledMaintenanceStateId",
        "startScheduledMaintenanceStateRole",
        "endScheduledMaintenanceStateRole",
        "startStateOccurrence",
        "endStateOccurrence",
        "isEnabled",
      ];

      for (const key of definitionKeys) {
        jest
          .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
          .mockResolvedValue(
            [] as Array<ScheduledMaintenanceMeasurement> as never,
          );

        const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> =
          buildUpdateBy({ [key]: undefined });

        await hooks.onBeforeUpdate(updateBy);

        expect(dataOf(updateBy)["backfillRequestedAt"]).toBeInstanceOf(Date);
      }
    });

    test("writes only timestamps into the backfill columns, never an id", async () => {
      /*
       * The hook reaches updateBy.data through a cast, so the compiler cannot
       * catch a measurement or state id assigned into one of these three
       * columns. Every one of them is a TIMESTAMP in Postgres: an ObjectID
       * landing here is a write error at runtime, and the cursor column would
       * take the whole backfill down with it.
       */
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([buildExistingMeasurement({})] as never);

      const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> = buildUpdateBy(
        { isEnabled: false },
      );

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = dataOf(updateBy);

      for (const column of [
        "backfillRequestedAt",
        "backfillCursorCreatedAt",
        "backfillCompletedAt",
      ]) {
        expect(data[column]).not.toBeInstanceOf(ObjectID);
        expect(typeof data[column]).not.toBe("string");
      }

      expect(data["backfillRequestedAt"]).toBeInstanceOf(Date);
    });

    test("leaves the backfill alone for a rename, so renaming a measurement does not recompute every event", async () => {
      const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> = buildUpdateBy(
        { name: "Start Delay (v2)" },
      );

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = dataOf(updateBy);

      expect(data["backfillRequestedAt"]).toBeUndefined();
      expect(
        ScheduledMaintenanceMeasurementService.findBy,
      ).not.toHaveBeenCalled();
    });

    test("leaves the backfill alone for the presentation-only columns", async () => {
      for (const key of [
        "description",
        "showOnScheduledMaintenanceView",
        "order",
        "unit",
        "aggregationType",
      ]) {
        const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> =
          buildUpdateBy({ [key]: undefined });

        await hooks.onBeforeUpdate(updateBy);

        expect(dataOf(updateBy)["backfillRequestedAt"]).toBeUndefined();
      }

      expect(
        ScheduledMaintenanceMeasurementService.findBy,
      ).not.toHaveBeenCalled();
    });

    test("validates the edit against the stored definition, so a half-specified change cannot become an unmeasurable one", async () => {
      /*
       * The update carries only the end anchor. Merged onto the stored row it
       * becomes "scheduled starts at -> scheduled starts at", which the create
       * path would have rejected outright.
       */
      const existing: ScheduledMaintenanceMeasurement =
        buildExistingMeasurement({});

      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([existing] as never);

      const updateBy: UpdateBy<ScheduledMaintenanceMeasurement> = buildUpdateBy(
        {
          endAnchorType:
            ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
        },
      );

      await expect(hooks.onBeforeUpdate(updateBy)).rejects.toThrow(
        /always be zero/,
      );
    });
  });

  describe("onBeforeDelete", () => {
    function deleteBy(): DeleteBy<ScheduledMaintenanceMeasurement> {
      return {
        query: { _id: MEASUREMENT_ID.toString() },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<ScheduledMaintenanceMeasurement>;
    }

    test("refuses to delete a built-in measurement and names it, because its metric series is referenced elsewhere", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({
            isSystemDefined: true,
            name: "Start Delay",
          }),
        ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        /Start Delay/,
      );
      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        BadDataException,
      );
    });

    test("allows a measurement the project defined itself to be deleted", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({ isSystemDefined: false }),
        ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).resolves.toBeDefined();
    });

    test("refuses a bulk delete that would sweep up a built-in measurement alongside custom ones", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({
            isSystemDefined: false,
            name: "Approval Lead Time",
          }),
          buildExistingMeasurement({
            isSystemDefined: true,
            name: "Maintenance Duration",
          }),
        ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        /Maintenance Duration/,
      );
    });
  });

  describe("getMetricNamesForProject", () => {
    test("includes disabled definitions, so disabling one tombstones its points instead of stranding them", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({
            isEnabled: true,
            metricName:
              "oneuptime.scheduled-maintenance.measurement.start-delay",
          }),
          buildExistingMeasurement({
            isEnabled: false,
            metricName:
              "oneuptime.scheduled-maintenance.measurement.maintenance-duration",
          }),
        ] as never);

      const names: Array<string> =
        await ScheduledMaintenanceMeasurementService.getMetricNamesForProject(
          PROJECT_ID,
        );

      expect(names).toEqual([
        "oneuptime.scheduled-maintenance.measurement.start-delay",
        "oneuptime.scheduled-maintenance.measurement.maintenance-duration",
      ]);
    });

    test("drops a row with no metric name rather than returning a hole the writer would compare against", async () => {
      jest
        .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({
            metricName:
              "oneuptime.scheduled-maintenance.measurement.start-delay",
          }),
          buildExistingMeasurement({}),
        ] as never);

      const names: Array<string> =
        await ScheduledMaintenanceMeasurementService.getMetricNamesForProject(
          PROJECT_ID,
        );

      expect(names).toEqual([
        "oneuptime.scheduled-maintenance.measurement.start-delay",
      ]);
    });

    test("returns an empty list for a project with no measurements, which stops the writer touching ClickHouse at all", async () => {
      const names: Array<string> =
        await ScheduledMaintenanceMeasurementService.getMetricNamesForProject(
          PROJECT_ID,
        );

      expect(names).toEqual([]);
    });
  });
});
