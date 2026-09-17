import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test: what the probe/telemetry worker does when a monitor's
 * stored criteria names a monitor status that no longer exists.
 *
 * This is the second half of issue #3039. Rejecting the id on write stops NEW
 * monitors getting into this state, but monitorSteps is a JSON blob with no
 * foreign key behind it, so monitors saved before the guard existed still hold
 * dangling ids — deleting a monitor status never rewrote the criteria that name
 * it, and the 1785240000000 repair migration deliberately left behind the
 * cross-project ids it could not map to a local equivalent.
 *
 * Writing such an id raised
 *   insert or update on table "MonitorStatusTimeline" violates foreign key
 *   constraint
 * from inside the worker, which failed the WHOLE ingest run for that monitor:
 * no status change, and no monitor log or payload persisted either, because
 * those run after this. Skipping the status change and logging is what
 * MonitorIncident and MonitorAlert already do for an unusable severity.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b5fbbd0-8d1c-4a72-9a2b-4b8bd1cba0e9",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "1b7c5d3e-9a4f-4c2b-8e61-3d5a7f9b1c22",
);
const CURRENT_STATUS_ID: ObjectID = new ObjectID(
  "8ff02a3f-3f18-4c1d-9db1-6cf27bb2a4a1",
);
const DANGLING_STATUS_ID: ObjectID = new ObjectID(
  "b8a7d5d1-2f5a-45cf-8f2c-2f2b83d1d9aa",
);

const monitor: () => Monitor = (): Monitor => {
  const item: Monitor = new Monitor();
  item._id = MONITOR_ID.toString();
  item.projectId = PROJECT_ID;
  item.currentMonitorStatusId = CURRENT_STATUS_ID;
  return item;
};

const criteriaSwitchingTo: (statusId: ObjectID) => MonitorCriteriaInstance = (
  statusId: ObjectID,
): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = "Monitor is offline";
  instance.data!.monitorStatusId = statusId;
  instance.data!.changeMonitorStatus = true;
  return instance;
};

const updateStatus: () => Promise<MonitorStatusTimeline | null> =
  (): Promise<MonitorStatusTimeline | null> => {
    return MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
      criteriaInstance: criteriaSwitchingTo(DANGLING_STATUS_ID),
      monitor: monitor(),
      dataToProcess: {} as never,
      rootCause: "criteria met",
      props: {},
    });
  };

describe("MonitorStatusTimelineUtil with an unusable monitor status", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips the status change instead of failing the ingest run", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(false as never);

    const create: unknown = jest.spyOn(MonitorStatusTimelineService, "create");

    await expect(updateStatus()).resolves.toBeNull();

    expect(create).not.toHaveBeenCalled();
  });

  it("checks the status against the monitor's own project", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null as never);

    const isUsable: unknown = jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(false as never);

    await updateStatus();

    expect(isUsable).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        id: DANGLING_STATUS_ID,
      }),
    );
  });

  it("writes the timeline row as usual when the status is usable", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true as never);

    const created: MonitorStatusTimeline = new MonitorStatusTimeline();

    const create: unknown = jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockResolvedValue(created as never);

    await expect(updateStatus()).resolves.toBe(created);

    expect(create).toHaveBeenCalled();
  });

  it("costs no lookup on the steady-state fast path", async () => {
    /*
     * The criteria's target status is already the monitor's current status —
     * the standard "online criteria matched on a healthy check" case, i.e.
     * almost every probe result. It returns before anything is queried, and the
     * new guard must not add a round trip to it.
     */
    const isUsable: unknown = jest.spyOn(
      ProjectScopedReferenceValidator,
      "isUsableInProject",
    );

    const result: MonitorStatusTimeline | null =
      await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
        criteriaInstance: criteriaSwitchingTo(CURRENT_STATUS_ID),
        monitor: monitor(),
        dataToProcess: {} as never,
        rootCause: "criteria met",
        props: {},
      });

    expect(result).toBeNull();
    expect(isUsable).not.toHaveBeenCalled();
  });
});
