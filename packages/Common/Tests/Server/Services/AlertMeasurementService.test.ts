import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import AlertMeasurementAnchorType from "../../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../../Types/Alerts/AlertStateRole";
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
 * The alert twin of Tests/Server/Services/IncidentMeasurementService.test.ts --
 * keep the two suites symmetric, the services are line-for-line equivalents
 * over a different set of state columns.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CREATED_STATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

/*
 * The hooks are protected, as they are on every DatabaseService. Reaching them
 * through a cast is how the rest of this suite exercises them -- see
 * Tests/Server/Types/Database/Permissions/TenantPermission.test.ts.
 */
interface MeasurementHooks {
  onBeforeCreate(
    createBy: CreateBy<AlertMeasurement>,
  ): Promise<OnCreate<AlertMeasurement>>;
  onBeforeUpdate(
    updateBy: UpdateBy<AlertMeasurement>,
  ): Promise<OnUpdate<AlertMeasurement>>;
  onBeforeDelete(
    deleteBy: DeleteBy<AlertMeasurement>,
  ): Promise<OnDelete<AlertMeasurement>>;
}

const hooks: MeasurementHooks =
  AlertMeasurementService as unknown as MeasurementHooks;

function buildCreateBy(input: {
  key?: string;
  name?: string;
  order?: number;
  startAnchorType?: AlertMeasurementAnchorType;
  endAnchorType?: AlertMeasurementAnchorType;
  startStateId?: ObjectID;
  endStateId?: ObjectID;
  startStateRole?: AlertStateRole;
  endStateRole?: AlertStateRole;
}): CreateBy<AlertMeasurement> {
  const measurement: AlertMeasurement = new AlertMeasurement();

  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Time to Acknowledge";
  measurement.key = input.key ?? "time-to-acknowledge";
  measurement.startAnchorType =
    input.startAnchorType ?? AlertMeasurementAnchorType.CreatedAt;
  measurement.endAnchorType =
    input.endAnchorType ?? AlertMeasurementAnchorType.StateRoleEntered;

  if (input.order !== undefined) {
    measurement.order = input.order;
  }

  if (input.startStateId) {
    measurement.startAlertStateId = input.startStateId;
  }

  if (input.endStateId) {
    measurement.endAlertStateId = input.endStateId;
  }

  if (input.startStateRole) {
    measurement.startAlertStateRole = input.startStateRole;
  }

  if (
    measurement.endAnchorType === AlertMeasurementAnchorType.StateRoleEntered
  ) {
    measurement.endAlertStateRole =
      input.endStateRole ?? AlertStateRole.Acknowledged;
  } else if (input.endStateRole) {
    measurement.endAlertStateRole = input.endStateRole;
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
}): AlertMeasurement {
  const measurement: AlertMeasurement = new AlertMeasurement();

  measurement._id = MEASUREMENT_ID.toString();
  measurement.id = MEASUREMENT_ID;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Time to Acknowledge";
  measurement.isSystemDefined = input.isSystemDefined ?? false;
  measurement.isEnabled = input.isEnabled ?? true;
  measurement.startAnchorType = AlertMeasurementAnchorType.CreatedAt;
  measurement.endAnchorType = AlertMeasurementAnchorType.StateRoleEntered;
  measurement.endAlertStateRole = AlertStateRole.Acknowledged;

  if (input.metricName) {
    measurement.metricName = input.metricName;
  }

  return measurement;
}

function buildAlertState(input: {
  id: ObjectID;
  name: string;
  order: number;
}): AlertState {
  const state: AlertState = new AlertState();

  state._id = input.id.toString();
  state.id = input.id;
  state.name = input.name;
  state.order = input.order;

  return state;
}

function buildUpdateBy(
  data: Record<string, unknown>,
): UpdateBy<AlertMeasurement> {
  return {
    id: MEASUREMENT_ID,
    query: { _id: MEASUREMENT_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<AlertMeasurement>;
}

function dataOf(updateBy: UpdateBy<AlertMeasurement>): Record<string, unknown> {
  return updateBy.data as unknown as Record<string, unknown>;
}

describe("AlertMeasurementService", () => {
  beforeEach(() => {
    // No existing definitions unless a test says otherwise.
    jest
      .spyOn(AlertMeasurementService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(AlertMeasurementService, "findBy")
      .mockResolvedValue([] as Array<AlertMeasurement> as never);
    jest
      .spyOn(AlertStateService, "findBy")
      .mockResolvedValue([] as Array<AlertState> as never);
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
        hooks.onBeforeCreate(buildCreateBy({ key: "Time To Acknowledge" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "" })),
      ).rejects.toThrow(BadDataException);

      // Leading hyphen, and one character past the 50 the column allows.
      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "-time-to-acknowledge" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "a".repeat(51) })),
      ).rejects.toThrow(BadDataException);
    });

    test("accepts a lowercase hyphenated key", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({
        key: "time-to-first-response",
      });

      await expect(hooks.onBeforeCreate(createBy)).resolves.toBeDefined();
    });

    test("derives the metric name from the key, so a new definition is chartable with no dashboard change", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({
        key: "time-to-acknowledge",
      });

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.metricName).toBe(
        "oneuptime.alert.measurement.time-to-acknowledge",
      );
    });

    test("puts a new definition after the project's last one, so the settings list has a stable order", async () => {
      const highest: AlertMeasurement = new AlertMeasurement();
      highest.order = 4;

      jest
        .spyOn(AlertMeasurementService, "findOneBy")
        .mockResolvedValue(highest as never);

      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(5);
    });

    test("gives the first definition in a project order 1", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(1);
    });

    test("keeps an order the caller supplied, so a reordered list is not overwritten on save", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({ order: 2 });

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(2);
      expect(AlertMeasurementService.findOneBy).not.toHaveBeenCalled();
    });

    test("requests a backfill, or the definition would be blank on every alert that already happened", async () => {
      const before: number = Date.now();

      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      const requestedAt: Date | undefined = createBy.data.backfillRequestedAt;

      expect(requestedAt).toBeInstanceOf(Date);
      expect(requestedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(requestedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test("leaves the backfill cursor and completion stamp unset on create, so the worker starts from the beginning", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.backfillCursorCreatedAt).toBeUndefined();
      expect(createBy.data.backfillCompletedAt).toBeUndefined();
    });

    test("rejects a definition with no start or no end, which has nothing to measure between", async () => {
      const missingStart: CreateBy<AlertMeasurement> = buildCreateBy({});
      delete missingStart.data.startAnchorType;

      await expect(hooks.onBeforeCreate(missingStart)).rejects.toThrow(
        BadDataException,
      );

      const missingEnd: CreateBy<AlertMeasurement> = buildCreateBy({});
      delete missingEnd.data.endAnchorType;

      await expect(hooks.onBeforeCreate(missingEnd)).rejects.toThrow(
        BadDataException,
      );
    });

    test("rejects a state anchor with no state picked, which would never resolve to a timestamp", async () => {
      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.StateEntered,
            endAnchorType: AlertMeasurementAnchorType.CreatedAt,
          }),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.CreatedAt,
            endAnchorType: AlertMeasurementAnchorType.StateEntered,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("rejects a state-role anchor with no role picked", async () => {
      const createBy: CreateBy<AlertMeasurement> = buildCreateBy({
        startAnchorType: AlertMeasurementAnchorType.StateRoleEntered,
        endAnchorType: AlertMeasurementAnchorType.StateRoleEntered,
        endStateRole: AlertStateRole.Resolved,
      });

      // No start role, so the start of the duration has no timestamp to read.
      delete createBy.data.startAlertStateRole;

      await expect(hooks.onBeforeCreate(createBy)).rejects.toThrow(
        BadDataException,
      );
    });

    test("rejects two anchors that read the same column, which would chart a constant zero", async () => {
      /*
       * Different enum values, one column: both Timeline Start and Created At
       * resolve to the alert's createdAt.
       */
      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.TimelineStart,
            endAnchorType: AlertMeasurementAnchorType.CreatedAt,
          }),
        ),
      ).rejects.toThrow(/always be zero/);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.CreatedAt,
            endAnchorType: AlertMeasurementAnchorType.CreatedAt,
          }),
        ),
      ).rejects.toThrow(/always be zero/);
    });

    test("rejects the same state at both ends, and allows two different ones", async () => {
      jest.spyOn(AlertStateService, "findBy").mockResolvedValue([
        buildAlertState({
          id: CREATED_STATE_ID,
          name: "Created",
          order: 1,
        }),
        buildAlertState({
          id: RESOLVED_STATE_ID,
          name: "Resolved",
          order: 3,
        }),
      ] as never);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.StateEntered,
            endAnchorType: AlertMeasurementAnchorType.StateEntered,
            startStateId: CREATED_STATE_ID,
            endStateId: CREATED_STATE_ID,
          }),
        ),
      ).rejects.toThrow(/always be zero/);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.StateEntered,
            endAnchorType: AlertMeasurementAnchorType.StateEntered,
            startStateId: CREATED_STATE_ID,
            endStateId: RESOLVED_STATE_ID,
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("rejects a definition that ends at a state the alert reaches before it starts, which could never complete", async () => {
      jest.spyOn(AlertStateService, "findBy").mockResolvedValue([
        buildAlertState({
          id: CREATED_STATE_ID,
          name: "Created",
          order: 1,
        }),
        buildAlertState({
          id: RESOLVED_STATE_ID,
          name: "Resolved",
          order: 3,
        }),
      ] as never);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: AlertMeasurementAnchorType.StateEntered,
            endAnchorType: AlertMeasurementAnchorType.StateEntered,
            startStateId: RESOLVED_STATE_ID,
            endStateId: CREATED_STATE_ID,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("onBeforeUpdate", () => {
    test("restarts the backfill when the definition's meaning changes, so its stored history is rewritten", async () => {
      jest
        .spyOn(AlertMeasurementService, "findBy")
        .mockResolvedValue([buildExistingMeasurement({})] as never);

      const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
        endStateOccurrence: "Last",
      });

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
        "startAlertStateId",
        "endAlertStateId",
        "startAlertStateRole",
        "endAlertStateRole",
        "startStateOccurrence",
        "endStateOccurrence",
        "isEnabled",
      ];

      for (const key of definitionKeys) {
        jest
          .spyOn(AlertMeasurementService, "findBy")
          .mockResolvedValue([] as Array<AlertMeasurement> as never);

        const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
          [key]: undefined,
        });

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
        .spyOn(AlertMeasurementService, "findBy")
        .mockResolvedValue([buildExistingMeasurement({})] as never);

      const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
        isEnabled: false,
      });

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

    test("leaves the backfill alone for a rename, so renaming a measurement does not recompute every alert", async () => {
      const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
        name: "Time to Acknowledge (v2)",
      });

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = dataOf(updateBy);

      expect(data["backfillRequestedAt"]).toBeUndefined();
      expect(AlertMeasurementService.findBy).not.toHaveBeenCalled();
    });

    test("leaves the backfill alone for the presentation-only columns", async () => {
      for (const key of [
        "description",
        "showOnAlertView",
        "order",
        "unit",
        "aggregationType",
      ]) {
        const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
          [key]: undefined,
        });

        await hooks.onBeforeUpdate(updateBy);

        expect(dataOf(updateBy)["backfillRequestedAt"]).toBeUndefined();
      }

      expect(AlertMeasurementService.findBy).not.toHaveBeenCalled();
    });

    test("validates the edit against the stored definition, so a half-specified change cannot become an unmeasurable one", async () => {
      /*
       * The update carries only the end anchor. Merged onto the stored row it
       * becomes "created at -> created at", which the create path would have
       * rejected outright.
       */
      const existing: AlertMeasurement = buildExistingMeasurement({});
      existing.startAnchorType = AlertMeasurementAnchorType.CreatedAt;

      jest
        .spyOn(AlertMeasurementService, "findBy")
        .mockResolvedValue([existing] as never);

      const updateBy: UpdateBy<AlertMeasurement> = buildUpdateBy({
        endAnchorType: AlertMeasurementAnchorType.CreatedAt,
      });

      await expect(hooks.onBeforeUpdate(updateBy)).rejects.toThrow(
        /always be zero/,
      );
    });
  });

  describe("onBeforeDelete", () => {
    function deleteBy(): DeleteBy<AlertMeasurement> {
      return {
        query: { _id: MEASUREMENT_ID.toString() },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<AlertMeasurement>;
    }

    test("refuses to delete a built-in measurement and names it, because its metric series is referenced elsewhere", async () => {
      jest.spyOn(AlertMeasurementService, "findBy").mockResolvedValue([
        buildExistingMeasurement({
          isSystemDefined: true,
          name: "Time to Acknowledge",
        }),
      ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        /Time to Acknowledge/,
      );
      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        BadDataException,
      );
    });

    test("allows a measurement the project defined itself to be deleted", async () => {
      jest
        .spyOn(AlertMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({ isSystemDefined: false }),
        ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).resolves.toBeDefined();
    });

    test("refuses a bulk delete that would sweep up a built-in measurement alongside custom ones", async () => {
      jest.spyOn(AlertMeasurementService, "findBy").mockResolvedValue([
        buildExistingMeasurement({
          isSystemDefined: false,
          name: "Time to Page",
        }),
        buildExistingMeasurement({
          isSystemDefined: true,
          name: "Time to Resolve",
        }),
      ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).rejects.toThrow(
        /Time to Resolve/,
      );
    });
  });

  describe("getMetricNamesForProject", () => {
    test("includes disabled definitions, so disabling one tombstones its points instead of stranding them", async () => {
      jest.spyOn(AlertMeasurementService, "findBy").mockResolvedValue([
        buildExistingMeasurement({
          isEnabled: true,
          metricName: "oneuptime.alert.measurement.time-to-acknowledge",
        }),
        buildExistingMeasurement({
          isEnabled: false,
          metricName: "oneuptime.alert.measurement.time-to-resolve",
        }),
      ] as never);

      const names: Array<string> =
        await AlertMeasurementService.getMetricNamesForProject(PROJECT_ID);

      expect(names).toEqual([
        "oneuptime.alert.measurement.time-to-acknowledge",
        "oneuptime.alert.measurement.time-to-resolve",
      ]);
    });

    test("drops a row with no metric name rather than returning a hole the writer would compare against", async () => {
      jest.spyOn(AlertMeasurementService, "findBy").mockResolvedValue([
        buildExistingMeasurement({
          metricName: "oneuptime.alert.measurement.time-to-acknowledge",
        }),
        buildExistingMeasurement({}),
      ] as never);

      const names: Array<string> =
        await AlertMeasurementService.getMetricNamesForProject(PROJECT_ID);

      expect(names).toEqual([
        "oneuptime.alert.measurement.time-to-acknowledge",
      ]);
    });

    test("returns an empty list for a project with no measurements, which stops the writer touching ClickHouse at all", async () => {
      const names: Array<string> =
        await AlertMeasurementService.getMetricNamesForProject(PROJECT_ID);

      expect(names).toEqual([]);
    });
  });
});
