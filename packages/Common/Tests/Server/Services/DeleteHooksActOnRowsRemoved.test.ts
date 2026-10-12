import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import MeasurementMetricWriter from "../../../Server/Utils/Measurement/MeasurementMetricWriter";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { idsNamedBy } from "../TestingUtils/QueryConditions";
import { stubRowsCallerMayDelete } from "../TestingUtils/RowsCallerMayWrite";

/*
 * WHAT A DELETE HOOK DOES, IT DOES TO THE ROWS THE DELETE REMOVES.
 *
 *   - A state timeline entry's neighbours close the gap it leaves: one entry
 *     at a time. A delete of several entries - a workflow's delete of many,
 *     say - has no one gap to close: it is left as it is, moves no
 *     neighbour, and is neither refused nor narrowed.
 *   - An on-call policy's workspace channels are archived when the policy's
 *     own delete names it by its id - and only then, and only for a policy
 *     the delete removes.
 *   - What a success hook does with the rows the delete hook read - metrics
 *     tombstoned, monitors given back - it does only for the rows the
 *     delete removed (DatabaseService.getRowsDeleted).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const PARENT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const ROW_A: string = "6b000000-0000-4000-8000-00000000000a";
const ROW_B: string = "6b000000-0000-4000-8000-00000000000b";

const TEAMMATE: JSONObject = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("6f000000-0000-4000-8000-000000000001"),
};

const MASTER_ADMIN: JSONObject = {
  isMasterAdmin: true,
  userId: new ObjectID("6f000000-0000-4000-8000-000000000002"),
};

function asService<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<DatabaseBaseModel> {
  return service as unknown as DatabaseService<DatabaseBaseModel>;
}

function rowOf(
  service: DatabaseService<DatabaseBaseModel>,
  id: string,
  fields: JSONObject,
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new service.modelType();

  Object.assign(row, { projectId: PROJECT_ID, ...fields });
  row._id = id;

  return row;
}

interface Read {
  query: JSONObject;
  skip: number;
  limit: number;
}

// The service's own reads: the rows of the pool a read names by `_id`, or all.
function stubReads(
  service: DatabaseService<DatabaseBaseModel>,
  pool: Array<DatabaseBaseModel>,
): jest.SpyInstance {
  return jest.spyOn(service, "findBy").mockImplementation((async (
    findBy: Read,
  ): Promise<Array<DatabaseBaseModel>> => {
    const named: unknown = findBy.query?.["_id"];

    if (named === undefined) {
      return pool.slice(0, findBy.limit);
    }

    const ids: Array<string> = idsNamedBy(named).map((id: string): string => {
      return id.toLowerCase();
    });

    return pool.filter((row: DatabaseBaseModel): boolean => {
      return ids.includes(String(row._id).toLowerCase());
    });
  }) as never);
}

function deleteOf(
  query: JSONObject,
  props: JSONObject,
  window: { skip: number; limit: number } = { skip: 0, limit: 100 },
): DeleteBy<DatabaseBaseModel> {
  return {
    query: query,
    props: props as unknown as DatabaseCommonInteractionProps,
    skip: window.skip,
    limit: window.limit,
  } as unknown as DeleteBy<DatabaseBaseModel>;
}

async function runHook(
  service: DatabaseService<DatabaseBaseModel>,
  deleteBy: DeleteBy<DatabaseBaseModel>,
): Promise<void> {
  await (
    service as unknown as {
      onBeforeDelete: (deleteBy: DeleteBy<DatabaseBaseModel>) => Promise<void>;
    }
  ).onBeforeDelete(deleteBy);
}

async function runSuccessHook(
  service: DatabaseService<DatabaseBaseModel>,
  carryForward: JSONObject,
  deletedIds: Array<ObjectID>,
): Promise<void> {
  await (
    service as unknown as {
      onDeleteSuccess: (
        onDelete: OnDelete<DatabaseBaseModel>,
        deletedIds: Array<ObjectID>,
      ) => Promise<void>;
    }
  ).onDeleteSuccess(
    {
      deleteBy: deleteOf({}, { isRoot: true }),
      carryForward: carryForward,
    } as unknown as OnDelete<DatabaseBaseModel>,
    deletedIds,
  );
}

function idsDeleted(deleteBy: DeleteBy<DatabaseBaseModel>): Array<string> {
  return idsNamedBy((deleteBy.query as JSONObject)["_id"])
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .sort();
}

interface TimelineCase {
  name: string;
  service: DatabaseService<DatabaseBaseModel>;
  // The column naming the record whose timeline an entry is part of.
  parentColumn: string;
}

const TIMELINES: Array<TimelineCase> = [
  {
    name: "IncidentStateTimelineService",
    service: asService(IncidentStateTimelineService),
    parentColumn: "incidentId",
  },
  {
    name: "AlertStateTimelineService",
    service: asService(AlertStateTimelineService),
    parentColumn: "alertId",
  },
  {
    name: "MonitorStatusTimelineService",
    service: asService(MonitorStatusTimelineService),
    parentColumn: "monitorId",
  },
  {
    name: "ScheduledMaintenanceStateTimelineService",
    service: asService(ScheduledMaintenanceStateTimelineService),
    parentColumn: "scheduledMaintenanceId",
  },
  {
    name: "IncidentEpisodeStateTimelineService",
    service: asService(IncidentEpisodeStateTimelineService),
    parentColumn: "incidentEpisodeId",
  },
  {
    name: "AlertEpisodeStateTimelineService",
    service: asService(AlertEpisodeStateTimelineService),
    parentColumn: "alertEpisodeId",
  },
];

describe.each(TIMELINES)(
  "$name: a delete of several entries is left as it is",
  (timeline: TimelineCase) => {
    const service: DatabaseService<DatabaseBaseModel> = timeline.service;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function entries(): Array<DatabaseBaseModel> {
      return [
        rowOf(service, ROW_A, {
          [timeline.parentColumn]: PARENT_ID,
          startsAt: new Date("2026-10-01T00:00:00.000Z"),
        }),
        rowOf(service, ROW_B, {
          [timeline.parentColumn]: PARENT_ID,
          startsAt: new Date("2026-10-02T00:00:00.000Z"),
        }),
      ];
    }

    // What moving a neighbour, or refusing the last entry, would call.
    function stubRepair(): Array<jest.SpyInstance> {
      return [
        jest
          .spyOn(service, "countBy")
          .mockResolvedValue(new PositiveNumber(5) as never),
        jest.spyOn(service, "findOneBy").mockResolvedValue(null as never),
        jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never),
        jest.spyOn(service, "updateBy").mockResolvedValue(1 as never),
      ];
    }

    it("for a teammate: no entry moves, and the delete is neither refused nor narrowed", async () => {
      const pool: Array<DatabaseBaseModel> = entries();

      stubRowsCallerMayDelete(service, () => {
        return pool;
      });
      const findBy: jest.SpyInstance = stubReads(service, pool);
      const repair: Array<jest.SpyInstance> = stubRepair();

      const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
        { [timeline.parentColumn]: PARENT_ID },
        TEAMMATE,
      );

      await runHook(service, deleteBy);

      // Two entries read are enough to tell the delete removes more than one.
      expect(findBy).toHaveBeenCalledTimes(1);
      expect((findBy.mock.calls[0]![0] as Read).limit).toBe(2);

      for (const spy of repair) {
        expect(spy).not.toHaveBeenCalled();
      }

      expect(deleteBy.query).toEqual({ [timeline.parentColumn]: PARENT_ID });
      expect(deleteBy.limit).toBe(100);
    });

    it("for a master admin: no entry moves, and the delete is neither refused nor narrowed", async () => {
      const findBy: jest.SpyInstance = stubReads(service, entries());
      const repair: Array<jest.SpyInstance> = stubRepair();

      const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
        { [timeline.parentColumn]: PARENT_ID },
        MASTER_ADMIN,
      );

      await runHook(service, deleteBy);

      expect(findBy).toHaveBeenCalledTimes(1);

      for (const spy of repair) {
        expect(spy).not.toHaveBeenCalled();
      }

      expect(deleteBy.query).toEqual({ [timeline.parentColumn]: PARENT_ID });
      expect(deleteBy.limit).toBe(100);
    });
  },
);

describe("OnCallDutyPolicyService: a policy's workspace channels are archived by its own delete", () => {
  const service: DatabaseService<DatabaseBaseModel> = asService(
    OnCallDutyPolicyService,
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubArchive(): jest.SpyInstance {
    return jest
      .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
      .mockResolvedValue(undefined as never);
  }

  it("archives the channels of the one policy the delete names by its id, and holds the delete to it", async () => {
    const policy: DatabaseBaseModel = rowOf(service, ROW_A, {});

    stubRowsCallerMayDelete(service, () => {
      return [policy];
    });
    stubReads(service, [policy]);
    const archive: jest.SpyInstance = stubArchive();

    const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
      { _id: ROW_A },
      TEAMMATE,
      { skip: 0, limit: 1 },
    );

    await runHook(service, deleteBy);

    expect(archive).toHaveBeenCalledTimes(1);

    const archived: {
      projectId: ObjectID;
      notificationFor: { onCallDutyPolicyId: ObjectID };
    } = archive.mock.calls[0]![0];

    expect(archived.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(archived.notificationFor.onCallDutyPolicyId.toString()).toBe(ROW_A);
    expect(idsDeleted(deleteBy)).toEqual([ROW_A]);
  });

  it("archives nothing, and removes nothing, when the policy named is outside the caller's reach", async () => {
    stubRowsCallerMayDelete(service, () => {
      return [];
    });
    const findBy: jest.SpyInstance = stubReads(service, [
      rowOf(service, ROW_A, {}),
    ]);
    const archive: jest.SpyInstance = stubArchive();

    const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
      { _id: ROW_A },
      TEAMMATE,
      { skip: 0, limit: 1 },
    );

    await runHook(service, deleteBy);

    expect(findBy).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
    expect(
      (
        (deleteBy.query as JSONObject)["_id"] as unknown as {
          getSql: (column: string) => string;
        }
      ).getSql("row._id"),
    ).toBe("TRUE = FALSE");
  });

  it.each([
    ["OneUptime's cleanup of a project's policies", { isRoot: true }],
    ["a teammate's delete of several policies", TEAMMATE],
  ])(
    "archives nothing for %s, which names no single policy, and leaves it as it is",
    async (_name: string, props: JSONObject) => {
      const pool: Array<DatabaseBaseModel> = [
        rowOf(service, ROW_A, {}),
        rowOf(service, ROW_B, {}),
      ];

      stubRowsCallerMayDelete(service, () => {
        return pool;
      });
      const findBy: jest.SpyInstance = stubReads(service, pool);
      const archive: jest.SpyInstance = stubArchive();

      const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
        { projectId: PROJECT_ID },
        props,
      );

      await runHook(service, deleteBy);

      expect(findBy).not.toHaveBeenCalled();
      expect(archive).not.toHaveBeenCalled();
      expect(deleteBy.query).toEqual({ projectId: PROJECT_ID });
      expect(deleteBy.limit).toBe(100);
    },
  );
});

describe("success hooks act on the rows the delete removed, of those its hook read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface Tombstones {
    // The measurement series tombstoned, one call per record.
    measurements: jest.SpyInstance;
    // The record's own metrics tombstoned, one call per record.
    metrics: jest.SpyInstance;
  }

  // What tombstoning a record's metrics calls.
  function stubTombstones(
    measurementService: { getMetricNamesForProject: unknown },
    service: DatabaseService<DatabaseBaseModel>,
  ): Tombstones {
    jest
      .spyOn(
        measurementService as {
          getMetricNamesForProject: () => Promise<Array<string>>;
        },
        "getMetricNamesForProject",
      )
      .mockResolvedValue([] as never);
    const metrics: jest.SpyInstance = jest
      .spyOn(MutableMetricService, "tombstoneEntityMetrics")
      .mockResolvedValue(undefined as never);

    if ("getMetricRetentionDays" in service) {
      jest
        .spyOn(
          service as unknown as {
            getMetricRetentionDays: () => Promise<number>;
          },
          "getMetricRetentionDays",
        )
        .mockResolvedValue(30 as never);
    }

    const measurements: jest.SpyInstance = jest
      .spyOn(MeasurementMetricWriter, "tombstoneAll")
      .mockResolvedValue(undefined as never);

    return { measurements: measurements, metrics: metrics };
  }

  function entityIdsOf(spy: jest.SpyInstance): Array<string> {
    return spy.mock.calls.map((call: Array<unknown>): string => {
      return String(
        (call[0] as { primaryEntityId: ObjectID }).primaryEntityId,
      ).toLowerCase();
    });
  }

  it("AlertService tombstones the metrics of the alerts removed only", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(AlertService);
    const tombstones: Tombstones = stubTombstones(
      AlertMeasurementService,
      service,
    );

    await runSuccessHook(
      service,
      { alerts: [rowOf(service, ROW_A, {}), rowOf(service, ROW_B, {})] },
      [new ObjectID(ROW_A)],
    );

    expect(entityIdsOf(tombstones.measurements)).toEqual([ROW_A]);
    expect(entityIdsOf(tombstones.metrics)).toEqual([ROW_A]);
  });

  it("IncidentService gives back the monitors and tombstones the metrics of the incidents removed only", async () => {
    const service: DatabaseService<DatabaseBaseModel> =
      asService(IncidentService);
    const tombstones: Tombstones = stubTombstones(
      IncidentMeasurementService,
      service,
    );
    const giveBack: jest.SpyInstance = jest
      .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
      .mockResolvedValue(undefined as never);

    const holdingMonitors: JSONObject = {
      monitors: [{ _id: "6d000000-0000-4000-8000-000000000001" }],
      holdsMonitors: true,
    };

    await runSuccessHook(
      service,
      {
        incidents: [
          rowOf(service, ROW_A, holdingMonitors),
          rowOf(service, ROW_B, holdingMonitors),
        ],
      },
      [new ObjectID(ROW_A)],
    );

    expect(giveBack).toHaveBeenCalledTimes(1);
    expect(entityIdsOf(tombstones.measurements)).toEqual([ROW_A]);
    expect(entityIdsOf(tombstones.metrics)).toEqual([ROW_A]);
  });

  it("ScheduledMaintenanceService gives back the monitors and tombstones the metrics of the events removed only", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(
      ScheduledMaintenanceService,
    );
    const tombstones: Tombstones = stubTombstones(
      ScheduledMaintenanceMeasurementService,
      service,
    );
    const giveBack: jest.SpyInstance = jest
      .spyOn(
        ScheduledMaintenanceStateTimelineService,
        "enableActiveMonitoringForMonitors",
      )
      .mockResolvedValue(undefined as never);

    await runSuccessHook(
      service,
      {
        scheduledMaintenanceEvents: [
          rowOf(service, ROW_A, {}),
          rowOf(service, ROW_B, {}),
        ],
      },
      [new ObjectID(ROW_A)],
    );

    expect(giveBack).toHaveBeenCalledTimes(1);
    expect(
      String(
        (giveBack.mock.calls[0]![0] as DatabaseBaseModel)._id,
      ).toLowerCase(),
    ).toBe(ROW_A);
    expect(entityIdsOf(tombstones.measurements)).toEqual([ROW_A]);
  });

  it("acts on none of them when the delete removed none", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(AlertService);
    const tombstones: Tombstones = stubTombstones(
      AlertMeasurementService,
      service,
    );

    await runSuccessHook(
      service,
      { alerts: [rowOf(service, ROW_A, {}), rowOf(service, ROW_B, {})] },
      [],
    );

    expect(tombstones.measurements).not.toHaveBeenCalled();
    expect(tombstones.metrics).not.toHaveBeenCalled();
  });
});

describe("DatabaseService.getRowsDeleted", () => {
  it("keeps the rows whose ids were deleted, whatever case either is written in, and no other", () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(AlertService);
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, {});
    const rowB: DatabaseBaseModel = rowOf(service, ROW_B.toUpperCase(), {});
    const rowWithoutId: DatabaseBaseModel = new service.modelType();

    expect(
      DatabaseService.getRowsDeleted({
        rows: [rowA, rowB, rowWithoutId],
        deletedIds: [new ObjectID(ROW_A.toUpperCase()), new ObjectID(ROW_B)],
      }),
    ).toEqual([rowA, rowB]);

    expect(
      DatabaseService.getRowsDeleted({
        rows: [rowA, rowB],
        deletedIds: [],
      }),
    ).toEqual([]);
  });
});
