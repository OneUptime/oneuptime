import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncidentMeasurementAnchorType from "../../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../../Types/Incident/IncidentStateRole";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const IDENTIFIED_STATE_ID: ObjectID = new ObjectID(
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
    createBy: CreateBy<IncidentMeasurement>,
  ): Promise<OnCreate<IncidentMeasurement>>;
  onBeforeUpdate(
    updateBy: UpdateBy<IncidentMeasurement>,
  ): Promise<OnUpdate<IncidentMeasurement>>;
  onBeforeDelete(
    deleteBy: DeleteBy<IncidentMeasurement>,
  ): Promise<OnDelete<IncidentMeasurement>>;
}

const hooks: MeasurementHooks =
  IncidentMeasurementService as unknown as MeasurementHooks;

function buildCreateBy(input: {
  key?: string;
  name?: string;
  order?: number;
  startAnchorType?: IncidentMeasurementAnchorType;
  endAnchorType?: IncidentMeasurementAnchorType;
  startStateId?: ObjectID;
  endStateId?: ObjectID;
  endStateRole?: IncidentStateRole;
}): CreateBy<IncidentMeasurement> {
  const measurement: IncidentMeasurement = new IncidentMeasurement();

  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Time to Detect";
  measurement.key = input.key ?? "time-to-detect";
  measurement.startAnchorType =
    input.startAnchorType ?? IncidentMeasurementAnchorType.ImpactStartedAt;
  measurement.endAnchorType =
    input.endAnchorType ?? IncidentMeasurementAnchorType.StateRoleEntered;

  if (input.order !== undefined) {
    measurement.order = input.order;
  }

  if (input.startStateId) {
    measurement.startIncidentStateId = input.startStateId;
  }

  if (input.endStateId) {
    measurement.endIncidentStateId = input.endStateId;
  }

  if (
    measurement.endAnchorType === IncidentMeasurementAnchorType.StateRoleEntered
  ) {
    measurement.endIncidentStateRole =
      input.endStateRole ?? IncidentStateRole.Acknowledged;
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
}): IncidentMeasurement {
  const measurement: IncidentMeasurement = new IncidentMeasurement();

  measurement._id = MEASUREMENT_ID.toString();
  measurement.id = MEASUREMENT_ID;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name ?? "Time to Acknowledge";
  measurement.isSystemDefined = input.isSystemDefined ?? false;
  measurement.isEnabled = input.isEnabled ?? true;
  measurement.startAnchorType = IncidentMeasurementAnchorType.CreatedAt;
  measurement.endAnchorType = IncidentMeasurementAnchorType.StateRoleEntered;
  measurement.endIncidentStateRole = IncidentStateRole.Acknowledged;

  if (input.metricName) {
    measurement.metricName = input.metricName;
  }

  return measurement;
}

function buildIncidentState(input: {
  id: ObjectID;
  name: string;
  order: number;
}): IncidentState {
  const state: IncidentState = new IncidentState();

  state._id = input.id.toString();
  state.id = input.id;
  state.name = input.name;
  state.order = input.order;

  return state;
}

describe("IncidentMeasurementService", () => {
  beforeEach(() => {
    // No existing definitions unless a test says otherwise.
    jest
      .spyOn(IncidentMeasurementService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentMeasurementService, "findBy")
      .mockResolvedValue([] as Array<IncidentMeasurement> as never);
    jest
      .spyOn(IncidentStateService, "findBy")
      .mockResolvedValue([] as Array<IncidentState> as never);
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
        hooks.onBeforeCreate(buildCreateBy({ key: "Time To Detect" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(buildCreateBy({ key: "" })),
      ).rejects.toThrow(BadDataException);
    });

    test("accepts a lowercase hyphenated key", async () => {
      const createBy: CreateBy<IncidentMeasurement> = buildCreateBy({
        key: "time-to-first-update",
      });

      await expect(hooks.onBeforeCreate(createBy)).resolves.toBeDefined();
    });

    test("derives the metric name from the key, so a new definition is chartable with no dashboard change", async () => {
      const createBy: CreateBy<IncidentMeasurement> = buildCreateBy({
        key: "time-to-detect",
      });

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.metricName).toBe(
        "oneuptime.incident.measurement.time-to-detect",
      );
    });

    test("puts a new definition after the project's last one, so the settings list has a stable order", async () => {
      const highest: IncidentMeasurement = new IncidentMeasurement();
      highest.order = 7;

      jest
        .spyOn(IncidentMeasurementService, "findOneBy")
        .mockResolvedValue(highest as never);

      const createBy: CreateBy<IncidentMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(8);
    });

    test("gives the first definition in a project order 1", async () => {
      const createBy: CreateBy<IncidentMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      expect(createBy.data.order).toBe(1);
    });

    test("requests a backfill, or the definition would be blank on every incident that already happened", async () => {
      const before: number = Date.now();

      const createBy: CreateBy<IncidentMeasurement> = buildCreateBy({});

      await hooks.onBeforeCreate(createBy);

      const requestedAt: Date | undefined = createBy.data.backfillRequestedAt;

      expect(requestedAt).toBeInstanceOf(Date);
      expect(requestedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(requestedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test("rejects a definition that ends at a state the incident reaches before it starts, which could never complete", async () => {
      jest.spyOn(IncidentStateService, "findBy").mockResolvedValue([
        buildIncidentState({
          id: IDENTIFIED_STATE_ID,
          name: "Identified",
          order: 1,
        }),
        buildIncidentState({
          id: RESOLVED_STATE_ID,
          name: "Resolved",
          order: 4,
        }),
      ] as never);

      await expect(
        hooks.onBeforeCreate(
          buildCreateBy({
            startAnchorType: IncidentMeasurementAnchorType.StateEntered,
            endAnchorType: IncidentMeasurementAnchorType.StateEntered,
            startStateId: RESOLVED_STATE_ID,
            endStateId: IDENTIFIED_STATE_ID,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("onBeforeUpdate", () => {
    test("restarts the backfill when the definition's meaning changes, so its stored history is rewritten", async () => {
      jest
        .spyOn(IncidentMeasurementService, "findBy")
        .mockResolvedValue([buildExistingMeasurement({})] as never);

      const updateBy: UpdateBy<IncidentMeasurement> = {
        id: MEASUREMENT_ID,
        query: { _id: MEASUREMENT_ID.toString() },
        data: { endStateOccurrence: "Last" },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<IncidentMeasurement>;

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = updateBy.data as unknown as Record<
        string,
        unknown
      >;

      expect(data["backfillRequestedAt"]).toBeInstanceOf(Date);
      // Cleared, or the restarted backfill would resume mid-way through.
      expect(data["backfillCursorCreatedAt"]).toBeNull();
      expect(data["backfillCompletedAt"]).toBeNull();
    });

    test("leaves the backfill alone for a rename, so renaming a measurement does not recompute every incident", async () => {
      const updateBy: UpdateBy<IncidentMeasurement> = {
        id: MEASUREMENT_ID,
        query: { _id: MEASUREMENT_ID.toString() },
        data: { name: "Time to Acknowledge (v2)" },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<IncidentMeasurement>;

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = updateBy.data as unknown as Record<
        string,
        unknown
      >;

      expect(data["backfillRequestedAt"]).toBeUndefined();
      expect(IncidentMeasurementService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("onBeforeDelete", () => {
    function deleteBy(): DeleteBy<IncidentMeasurement> {
      return {
        query: { _id: MEASUREMENT_ID.toString() },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<IncidentMeasurement>;
    }

    test("refuses to delete a built-in measurement and names it, because its metric series is referenced elsewhere", async () => {
      jest.spyOn(IncidentMeasurementService, "findBy").mockResolvedValue([
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
        .spyOn(IncidentMeasurementService, "findBy")
        .mockResolvedValue([
          buildExistingMeasurement({ isSystemDefined: false }),
        ] as never);

      await expect(hooks.onBeforeDelete(deleteBy())).resolves.toBeDefined();
    });

    test("refuses a bulk delete that would sweep up a built-in measurement alongside custom ones", async () => {
      jest.spyOn(IncidentMeasurementService, "findBy").mockResolvedValue([
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
      jest.spyOn(IncidentMeasurementService, "findBy").mockResolvedValue([
        buildExistingMeasurement({
          isEnabled: true,
          metricName: "oneuptime.incident.measurement.time-to-acknowledge",
        }),
        buildExistingMeasurement({
          isEnabled: false,
          metricName: "oneuptime.incident.measurement.time-to-mitigate",
        }),
      ] as never);

      const names: Array<string> =
        await IncidentMeasurementService.getMetricNamesForProject(PROJECT_ID);

      expect(names).toEqual([
        "oneuptime.incident.measurement.time-to-acknowledge",
        "oneuptime.incident.measurement.time-to-mitigate",
      ]);
    });

    test("returns an empty list for a project with no measurements, which stops the writer touching ClickHouse at all", async () => {
      const names: Array<string> =
        await IncidentMeasurementService.getMetricNamesForProject(PROJECT_ID);

      expect(names).toEqual([]);
    });
  });
});
