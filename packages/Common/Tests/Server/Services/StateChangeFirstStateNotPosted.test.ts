import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import WorkspaceStateChangePosting from "../../../Server/Utils/Workspace/WorkspaceStateChangePosting";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

/*
 * A RECORD'S FIRST STATE IS NOT POSTED UNDER THE MESSAGE THAT ANNOUNCED IT.
 *
 * The maintainer's screenshot of an incident channel: "Incident INC-8
 * Created" says "Incident State: Identified", and the very next line says
 * "Changed Incident INC-8 State to Identified". The first state of an
 * incident, an alert, an episode or a scheduled maintenance event is now
 * kept to its feed; every state after it is posted, as before.
 */

type Hook = (...args: Array<unknown>) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const STARTS_AT: Date = new Date("2026-10-08T17:15:00.000Z");

describe("WorkspaceStateChangePosting", () => {
  const row: Record<string, unknown> = { id: "row" };

  test("the record's first state - nothing before it, nothing after it - is not posted", () => {
    expect(
      WorkspaceStateChangePosting.isFirstStateOfRecord({
        stateBeforeThis: null,
        stateAfterThis: null,
      }),
    ).toBe(true);
    expect(
      WorkspaceStateChangePosting.postsToWorkspace({
        stateBeforeThis: null,
        stateAfterThis: undefined,
      }),
    ).toBe(false);
  });

  test("every later state is posted", () => {
    expect(
      WorkspaceStateChangePosting.postsToWorkspace({
        stateBeforeThis: row,
        stateAfterThis: null,
      }),
    ).toBe(true);
  });

  test("a state written before or between existing states is a correction, posted like any change", () => {
    expect(
      WorkspaceStateChangePosting.postsToWorkspace({
        stateBeforeThis: null,
        stateAfterThis: row,
      }),
    ).toBe(true);
    expect(
      WorkspaceStateChangePosting.postsToWorkspace({
        stateBeforeThis: row,
        stateAfterThis: row,
      }),
    ).toBe(true);
  });
});

interface WorkspaceFlag {
  sendWorkspaceNotification: boolean;
}

describe("IncidentStateTimelineService: the state change line in Slack and Microsoft Teams", () => {
  let feedFlags: Array<WorkspaceFlag | undefined>;

  beforeEach(() => {
    feedFlags = [];
    mockProjectStates();

    jest.spyOn(IncidentService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(IncidentStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockImplementation((async (data: {
        query: { _id: string };
      }): Promise<IncidentState> => {
        const state: IncidentState = new IncidentState();
        state._id = data.query._id;
        state.name =
          data.query._id === INCIDENT_STATE_IDS.created.toString()
            ? "Identified"
            : "Acknowledged";
        state.isCreatedState =
          data.query._id === INCIDENT_STATE_IDS.created.toString();
        return state;
      }) as never);
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 8,
      numberWithPrefix: "INC-8",
    } as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/inc-8"));
    jest
      .spyOn(IncidentService, "refreshIncidentMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
      .mockResolvedValue(undefined as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    const timelineService: Record<string, () => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        () => Promise<unknown>
      >;
    jest
      .spyOn(timelineService, "isLastIncidentState")
      .mockResolvedValue(false as never);
    jest
      .spyOn(timelineService, "autoAssignIncidentCommander")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(timelineService, "trackSlaStateChange")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        workspaceNotification?: WorkspaceFlag;
      }): Promise<void> => {
        feedFlags.push(data.workspaceNotification);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function row(stateId: ObjectID): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = stateId;
    timeline.startsAt = STARTS_AT;
    return timeline;
  }

  async function change(data: {
    to: ObjectID;
    before: IncidentStateTimeline | null;
    after: IncidentStateTimeline | null;
  }): Promise<void> {
    const created: IncidentStateTimeline = row(data.to);

    await hookOf(IncidentStateTimelineService, "onCreateSuccess")(
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: data.before,
          statusTimelineAfterThisStatus: data.after,
          mutex: null,
        },
      },
      created,
    );
  }

  test("REGRESSION (screenshot 5): the incident's first state goes to its feed, not to its channels", async () => {
    await change({ to: INCIDENT_STATE_IDS.created, before: null, after: null });

    expect(feedFlags).toHaveLength(1);
    expect(feedFlags[0]!.sendWorkspaceNotification).toBe(false);
  });

  test("a later state - acknowledged - is posted, as before", async () => {
    await change({
      to: INCIDENT_STATE_IDS.acknowledged,
      before: row(INCIDENT_STATE_IDS.created),
      after: null,
    });

    expect(feedFlags[0]!.sendWorkspaceNotification).toBe(true);
  });

  test("a state written before the first one is a correction, and is posted", async () => {
    await change({
      to: INCIDENT_STATE_IDS.acknowledged,
      before: null,
      after: row(INCIDENT_STATE_IDS.created),
    });

    expect(feedFlags[0]!.sendWorkspaceNotification).toBe(true);
  });
});

describe("AlertStateTimelineService: the state change line in Slack and Microsoft Teams", () => {
  let feedFlags: Array<WorkspaceFlag | undefined>;

  beforeEach(() => {
    feedFlags = [];
    mockProjectStates();

    jest.spyOn(AlertService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(AlertStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertStateService, "findOneBy")
      .mockImplementation((async (data: {
        query: { _id: string };
      }): Promise<AlertState> => {
        const state: AlertState = new AlertState();
        state._id = data.query._id;
        state.name = "Created";
        return state;
      }) as never);
    jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockResolvedValue(false);
    jest
      .spyOn(AlertStateService, "isAcknowledgedAlertState")
      .mockResolvedValue(false);
    jest.spyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 12,
      numberWithPrefix: "AL-12",
    } as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/al-12"));
    jest
      .spyOn(AlertService, "refreshAlertMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertMeasurementValueService, "recomputeForAlert")
      .mockResolvedValue(undefined as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    jest
      .spyOn(
        AlertStateTimelineService as unknown as Record<
          string,
          () => Promise<unknown>
        >,
        "isLastAlertState",
      )
      .mockResolvedValue(false as never);

    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: {
        workspaceNotification?: WorkspaceFlag;
      }): Promise<void> => {
        feedFlags.push(data.workspaceNotification);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function row(stateId: ObjectID): AlertStateTimeline {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.projectId = PROJECT_ID;
    timeline.alertId = ALERT_ID;
    timeline.alertStateId = stateId;
    timeline.startsAt = STARTS_AT;
    return timeline;
  }

  async function change(
    before: AlertStateTimeline | null,
    stateId: ObjectID,
  ): Promise<void> {
    const created: AlertStateTimeline = row(stateId);

    await hookOf(AlertStateTimelineService, "onCreateSuccess")(
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: before,
          statusTimelineAfterThisStatus: null,
          mutex: null,
        },
      },
      created,
    );
  }

  test("the alert's first state goes to its feed only", async () => {
    await change(null, ALERT_STATE_IDS.created);

    expect(feedFlags[0]!.sendWorkspaceNotification).toBe(false);
  });

  test("a later state is posted", async () => {
    await change(row(ALERT_STATE_IDS.created), ALERT_STATE_IDS.acknowledged);

    expect(feedFlags[0]!.sendWorkspaceNotification).toBe(true);
  });
});

// White space, which formatting may move: the guard reads the code without it.
const WHITE_SPACE: RegExp = /\s+/g;

describe("every state timeline holds its first state back from Slack and Microsoft Teams", () => {
  const SERVICES_DIR: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );

  test.each([
    [
      "IncidentStateTimelineService.ts",
      "IncidentFeedEventType.IncidentStateChanged",
    ],
    ["AlertStateTimelineService.ts", "AlertFeedEventType.AlertStateChanged"],
    [
      "IncidentEpisodeStateTimelineService.ts",
      "IncidentEpisodeFeedEventType.EpisodeStateChanged",
    ],
    [
      "AlertEpisodeStateTimelineService.ts",
      "AlertEpisodeFeedEventType.EpisodeStateChanged",
    ],
    [
      "ScheduledMaintenanceStateTimelineService.ts",
      "ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged",
    ],
  ])(
    "%s posts its state change line only when it is not the record's first state",
    (file: string, eventType: string) => {
      const source: string = fs.readFileSync(
        path.join(SERVICES_DIR, file),
        "utf8",
      );

      const at: number = source.indexOf(eventType);
      expect(at).toBeGreaterThan(-1);

      const call: string = source.slice(at, source.indexOf("});", at));
      const compact: string = call.replace(WHITE_SPACE, "");

      expect(compact).toContain(
        "sendWorkspaceNotification:WorkspaceStateChangePosting.postsToWorkspace({stateBeforeThis:onCreate.carryForward.statusTimelineBeforeThisStatus,stateAfterThis:onCreate.carryForward.statusTimelineAfterThisStatus,",
      );
      expect(compact).not.toContain("sendWorkspaceNotification:true");
    },
  );
});
