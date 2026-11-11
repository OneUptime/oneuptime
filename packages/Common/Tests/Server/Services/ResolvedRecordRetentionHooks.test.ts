import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalDelete,
} from "../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SCREENSHOTS_OMITTED_FIELD } from "../../../Utils/Monitor/StateChangeLogScreenshots";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * What issue #6903 changed in the services incidents and alerts are written
 * and deleted through:
 *
 *   - a state change keeps the check that caused it without a Synthetic
 *     monitor's screenshots (StateChangeLogScreenshots), for incidents and
 *     alerts alike - the rows that grew one installation's database to
 *     tens of gigabytes;
 *   - so does a new incident or alert, of the check that opened it
 *     (createdStateLog) - a megabyte a row of alerts at the same
 *     installation;
 *   - a hard delete - the retention purge's - of incidents and of incident
 *     episodes still tells Slack and Teams that their public notes' approval
 *     messages are for notes that are gone, as a person's delete does; it
 *     gives back no monitor and keeps the metrics the incidents wrote, as the
 *     history the incident charts draw until their own retention.
 *
 * The hooks run as the services run them: a state change's create stops at
 * its missing incident (alert), an incident's or alert's at its missing
 * project - after the log is cut, before anything is read.
 */

interface CreateHook<T extends DatabaseBaseModel> {
  onBeforeCreate(createBy: CreateBy<T>): Promise<unknown>;
}

interface HardDeleteHook<T extends DatabaseBaseModel> {
  onHardDeleteSuccess(
    onDelete: OnDelete<T>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<T>>;
  markMonitorsActiveForMonitoring?: (...args: Array<unknown>) => unknown;
}

function syntheticCheck(): JSONObject {
  return {
    monitorId: "6f000000-0000-4000-8000-000000000001",
    syntheticMonitorResponse: [
      {
        browserType: "Chromium",
        screenSizeType: "Desktop",
        executionTimeInMS: 4200,
        logMessages: ["Opened the login page"],
        scriptError: "Timeout 30000ms exceeded.",
        result: null,
        capturedMetrics: [],
        screenshots: {
          "login-page": "iVBORw0KGgoAAAANSUhEUgAA".padEnd(4096, "A"),
        },
      },
    ],
  };
}

function cutRun(log: unknown): JSONObject {
  return (
    (log as JSONObject)["syntheticMonitorResponse"] as Array<JSONObject>
  )[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a state change keeps its check without a Synthetic monitor's screenshots", () => {
  test("incidents: the log written with the change has the run, not its screenshots", async () => {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = ObjectID.generate();
    timeline.stateChangeLog = syntheticCheck();

    const createBy: CreateBy<IncidentStateTimeline> = {
      data: timeline,
      props: { isRoot: true },
    };

    await expect(
      (
        IncidentStateTimelineService as unknown as CreateHook<IncidentStateTimeline>
      ).onBeforeCreate(createBy),
    ).rejects.toThrow("incidentId is null");

    const run: JSONObject = cutRun(createBy.data.stateChangeLog);

    expect(run).not.toHaveProperty("screenshots");
    expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    expect(run["scriptError"]).toBe("Timeout 30000ms exceeded.");
    expect(run["logMessages"]).toEqual(["Opened the login page"]);
  });

  test("alerts: the same", async () => {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.projectId = ObjectID.generate();
    timeline.stateChangeLog = syntheticCheck();

    const createBy: CreateBy<AlertStateTimeline> = {
      data: timeline,
      props: { isRoot: true },
    };

    await expect(
      (
        AlertStateTimelineService as unknown as CreateHook<AlertStateTimeline>
      ).onBeforeCreate(createBy),
    ).rejects.toThrow("alertId is null");

    const run: JSONObject = cutRun(createBy.data.stateChangeLog);

    expect(run).not.toHaveProperty("screenshots");
    expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
  });

  test("a check without screenshots is kept as it came, and a change without one gains none", async () => {
    const httpCheck: JSONObject = { responseCode: 500, responseTimeInMs: 91 };
    const withCheck: AlertStateTimeline = new AlertStateTimeline();
    withCheck.stateChangeLog = httpCheck;
    const withoutCheck: AlertStateTimeline = new AlertStateTimeline();

    for (const timeline of [withCheck, withoutCheck]) {
      await expect(
        (
          AlertStateTimelineService as unknown as CreateHook<AlertStateTimeline>
        ).onBeforeCreate({ data: timeline, props: { isRoot: true } }),
      ).rejects.toThrow("alertId is null");
    }

    expect(withCheck.stateChangeLog).toBe(httpCheck);
    expect(withoutCheck.stateChangeLog).toBeUndefined();
  });
});

describe("a new incident or alert keeps the check that opened it without a Synthetic monitor's screenshots", () => {
  test("incidents: the check is kept, its screenshots are not", async () => {
    const incident: Incident = new Incident();
    incident.createdStateLog = syntheticCheck();

    const createBy: CreateBy<Incident> = { data: incident, props: {} };

    // Stops at the missing project - after the log is cut, before anything is read.
    await expect(
      (IncidentService as unknown as CreateHook<Incident>).onBeforeCreate(
        createBy,
      ),
    ).rejects.toThrow("ProjectId required to create incident.");

    const run: JSONObject = cutRun(createBy.data.createdStateLog);

    expect(run).not.toHaveProperty("screenshots");
    expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    expect(run["scriptError"]).toBe("Timeout 30000ms exceeded.");
    expect(run["logMessages"]).toEqual(["Opened the login page"]);
    expect(createBy.data.createdStateLog!["monitorId"]).toBe(
      "6f000000-0000-4000-8000-000000000001",
    );
  });

  test("alerts: the same", async () => {
    const alert: Alert = new Alert();
    alert.createdStateLog = syntheticCheck();

    const createBy: CreateBy<Alert> = { data: alert, props: {} };

    await expect(
      (AlertService as unknown as CreateHook<Alert>).onBeforeCreate(createBy),
    ).rejects.toThrow("ProjectId required to create alert.");

    const run: JSONObject = cutRun(createBy.data.createdStateLog);

    expect(run).not.toHaveProperty("screenshots");
    expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    expect(run["scriptError"]).toBe("Timeout 30000ms exceeded.");
  });

  test("a check without screenshots is kept as it came, and one opened by hand gains none", async () => {
    const httpCheck: JSONObject = { responseCode: 500, responseTimeInMs: 91 };
    const fromMonitor: Incident = new Incident();
    fromMonitor.createdStateLog = httpCheck;
    const byHand: Alert = new Alert();

    await expect(
      (IncidentService as unknown as CreateHook<Incident>).onBeforeCreate({
        data: fromMonitor,
        props: {},
      }),
    ).rejects.toThrow("ProjectId required to create incident.");
    await expect(
      (AlertService as unknown as CreateHook<Alert>).onBeforeCreate({
        data: byHand,
        props: {},
      }),
    ).rejects.toThrow("ProjectId required to create alert.");

    expect(fromMonitor.createdStateLog).toBe(httpCheck);
    expect(byHand.createdStateLog).toBeUndefined();
  });
});

describe("a hard delete of incidents and incident episodes - the retention purge's", () => {
  const approval: PublicNoteApprovalDelete = {
    chatMessages: [],
  } as unknown as PublicNoteApprovalDelete;
  const deletedIds: Array<ObjectID> = [
    ObjectID.generate(),
    ObjectID.generate(),
  ];

  test("incidents: Slack and Teams are told the public notes awaiting approval are gone; no monitor is given back and the metrics stay", async () => {
    const after: SpyInstance<
      typeof PublicNoteApprovalEngine.afterRecordsDelete
    > = jest
      .spyOn(PublicNoteApprovalEngine, "afterRecordsDelete")
      .mockImplementation(() => {
        return undefined;
      });
    const tombstone: SpyInstance<
      typeof MutableMetricService.tombstoneEntityMetrics
    > = jest
      .spyOn(MutableMetricService, "tombstoneEntityMetrics")
      .mockResolvedValue(undefined as never);
    const hook: HardDeleteHook<Incident> =
      IncidentService as unknown as HardDeleteHook<Incident>;
    const giveBack: SpyInstance<(...args: Array<unknown>) => unknown> = jest
      .spyOn(
        hook as Required<HardDeleteHook<Incident>>,
        "markMonitorsActiveForMonitoring",
      )
      .mockResolvedValue(undefined as never);

    const incident: Incident = new Incident();
    incident.id = deletedIds[0]!;
    incident.projectId = ObjectID.generate();

    const onDelete: OnDelete<Incident> = {
      deleteBy: {
        query: {},
        props: { isRoot: true },
      } as unknown as DeleteBy<Incident>,
      carryForward: { incidents: [incident], publicNoteApproval: approval },
    };

    await expect(hook.onHardDeleteSuccess(onDelete, deletedIds)).resolves.toBe(
      onDelete,
    );

    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith({ delete: approval, deletedIds });
    expect(tombstone).not.toHaveBeenCalled();
    expect(giveBack).not.toHaveBeenCalled();
  });

  test("incidents: a delete that read no approvals tells nobody anything", async () => {
    const after: SpyInstance<
      typeof PublicNoteApprovalEngine.afterRecordsDelete
    > = jest.spyOn(PublicNoteApprovalEngine, "afterRecordsDelete");

    const onDelete: OnDelete<Incident> = {
      deleteBy: {
        query: {},
        props: { isRoot: true },
      } as unknown as DeleteBy<Incident>,
      carryForward: null,
    };

    await (
      IncidentService as unknown as HardDeleteHook<Incident>
    ).onHardDeleteSuccess(onDelete, deletedIds);

    expect(after).toHaveBeenCalledWith({ delete: undefined, deletedIds });
  });

  test("incident episodes: the same as a person's delete of an episode", async () => {
    const after: SpyInstance<
      typeof PublicNoteApprovalEngine.afterRecordsDelete
    > = jest
      .spyOn(PublicNoteApprovalEngine, "afterRecordsDelete")
      .mockImplementation(() => {
        return undefined;
      });

    const onDelete: OnDelete<IncidentEpisode> = {
      deleteBy: {
        query: {},
        props: { isRoot: true },
      } as unknown as DeleteBy<IncidentEpisode>,
      carryForward: { publicNoteApproval: approval },
    };

    await expect(
      (
        IncidentEpisodeService as unknown as HardDeleteHook<IncidentEpisode>
      ).onHardDeleteSuccess(onDelete, deletedIds),
    ).resolves.toBe(onDelete);

    expect(after).toHaveBeenCalledWith({ delete: approval, deletedIds });
  });
});
