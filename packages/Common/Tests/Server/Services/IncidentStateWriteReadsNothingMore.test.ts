import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AiFirstResponder from "../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import InvestigationRuleWait from "../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import WaitingRunsOnRecordChange from "../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Utils/../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN INCIDENT'S STATE, WRITTEN BY ITS STATE CHANGE, IS NOT READ BACK FOR
 * FOLLOW-ONS THAT WILL NOT RUN (fu-bulk-actions, after #5309 did it for
 * alerts).
 *
 * Every state change writes the incident's current state once its timeline
 * row is saved (StateChangeFollowOn). IncidentService.onUpdateSuccess then
 * read the incident again - its number and project, its dashboard link -
 * and walked every follow-on of an edit, to find the update changed nothing
 * any of them acts on. A bulk Resolve of thousands of incidents read each
 * one again for nothing. Now an update that changes none of what follows
 * reads nothing more, and one that does is read and followed as before:
 * each follow-on below in a test of its own, with what it acts on written
 * back as it was (no change: nothing more) and really changed (read and
 * done once).
 *
 * onUpdateSuccess runs for real; the reads, the feed, the links and the
 * follow-ons are stubbed and watched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4bbb-8bbb-000000000001",
);
const INCIDENT_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000a1";
const OTHER_INCIDENT_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000a2";
const RESOLVED_STATE_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000b1";
const SEV1_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000c1";
const SEV3_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000c2";
const POSTMORTEM_DRAFT_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000d1";
const POSTMORTEM_DONE_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000d2";
const MONITOR_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000e1";
const OPERATIONAL_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000f1";
const DEGRADED_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000f2";
const USER_ID: ObjectID = new ObjectID("0193c0de-bbbb-4bbb-8bbb-0000000000ab");

type OnUpdateSuccess = (
  onUpdate: OnUpdate<Incident>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Incident>>;

// What onBeforeUpdate carries forward for one incident, as the type holds it.
type IncidentCarryForward = Record<string, unknown>;

let findOneById: ReturnType<typeof jest.spyOn>;
let createFeedItem: ReturnType<typeof jest.spyOn>;
let refreshReminders: ReturnType<typeof jest.spyOn>;
let startWaitingRuns: ReturnType<typeof jest.spyOn>;
let tryFixAgain: ReturnType<typeof jest.spyOn>;
let investigationWait: ReturnType<typeof jest.spyOn>;
let recalculateSla: ReturnType<typeof jest.spyOn>;
let applyPostmortemUpdate: ReturnType<typeof jest.spyOn>;
let movePostmortemStatus: ReturnType<typeof jest.spyOn>;
let customFieldsFeed: ReturnType<typeof jest.spyOn>;
let statusPageScopeFeed: ReturnType<typeof jest.spyOn>;
let requeueCreatedNotification: ReturnType<typeof jest.spyOn>;
let updateMonitors: ReturnType<typeof jest.spyOn>;
let findMonitors: ReturnType<typeof jest.spyOn>;
let findMonitorStatus: ReturnType<typeof jest.spyOn>;
let findResolvedTimeline: ReturnType<typeof jest.spyOn>;
let changeIncidentState: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  findOneById = jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation(((args: { id: ObjectID }): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident._id = args.id.toString();
      incident.projectId = PROJECT_ID;
      incident.incidentNumber = 7;
      incident.incidentNumberWithPrefix = "INC-7";
      return Promise.resolve(incident);
    }) as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/incidents/7"));

  createFeedItem = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);

  refreshReminders = jest
    .spyOn(IncidentService, "refreshReminderSchedule")
    .mockResolvedValue(undefined as never);

  startWaitingRuns = jest
    .spyOn(WaitingRunsOnRecordChange, "startForIncident")
    .mockResolvedValue(0 as never);

  jest
    .spyOn(AiFirstResponder, "onRecordChanged")
    .mockResolvedValue(undefined as never);

  tryFixAgain = jest
    .spyOn(AutoRemediationRuleEngineService, "onSubjectUpdated")
    .mockResolvedValue(false as never);

  investigationWait = jest
    .spyOn(InvestigationRuleWait, "onSubjectChanged")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEV1_ID;
      severity.name = "SEV1";
      return severity;
    }) as never);

  recalculateSla = jest
    .spyOn(IncidentSlaService, "recalculateDeadlines")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(
      IncidentService as unknown as {
        getIncidentMetricContext: () => Promise<unknown>;
      },
      "getIncidentMetricContext",
    )
    .mockRejectedValue(new Error("no metric store in this test") as never);

  jest
    .spyOn(IncidentPostmortemStatusService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentPostmortemStatus> => {
      const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();
      status.name = "Completed";
      return status;
    }) as never);

  applyPostmortemUpdate = jest
    .spyOn(
      IncidentService as unknown as {
        applyPostmortemUpdate: () => Promise<void>;
      },
      "applyPostmortemUpdate",
    )
    .mockResolvedValue(undefined as never);

  movePostmortemStatus = jest
    .spyOn(
      IncidentService as unknown as {
        movePostmortemStatusAfterUpdate: () => Promise<void>;
      },
      "movePostmortemStatusAfterUpdate",
    )
    .mockResolvedValue(undefined as never);

  customFieldsFeed = jest
    .spyOn(
      IncidentService as unknown as {
        getCustomFieldsFeedMarkdown: () => Promise<unknown>;
      },
      "getCustomFieldsFeedMarkdown",
    )
    .mockImplementation((async (args: {
      written: unknown;
    }): Promise<unknown> => {
      // A line only for values the update wrote, as the real one.
      const line: string =
        args.written === undefined
          ? ""
          : "\n\n**Custom Fields**: Region: eu-west";
      return {
        isEmpty: (): boolean => {
          return line === "";
        },
        toString: (): string => {
          return line;
        },
      };
    }) as never);

  statusPageScopeFeed = jest
    .spyOn(
      IncidentService as unknown as {
        getStatusPageScopeFeedMarkdown: () => Promise<string>;
      },
      "getStatusPageScopeFeedMarkdown",
    )
    .mockResolvedValue("" as never);

  requeueCreatedNotification = jest
    .spyOn(
      IncidentService as unknown as {
        requeueCreatedNotificationIfAddedPagesWereMissed: () => Promise<void>;
      },
      "requeueCreatedNotificationIfAddedPagesWereMissed",
    )
    .mockResolvedValue(undefined as never);

  updateMonitors = jest
    .spyOn(
      IncidentService as unknown as {
        updateMonitorsForIncidentEdit: () => Promise<void>;
      },
      "updateMonitorsForIncidentEdit",
    )
    .mockResolvedValue(undefined as never);

  findMonitors = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (): Promise<Array<Monitor>> => {
      return [];
    }) as never);

  findMonitorStatus = jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status.name = "Degraded";
      return status;
    }) as never);

  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(new ObjectID(RESOLVED_STATE_ID) as never);

  findResolvedTimeline = jest
    .spyOn(IncidentStateTimelineService, "findOneBy")
    .mockResolvedValue(null as never);

  jest
    .spyOn(IncidentService, "refreshIncidentMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);

  changeIncidentState = jest
    .spyOn(IncidentService, "changeIncidentState")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What onBeforeUpdate carries for an incident whose monitors it compared.
function monitorsCarried(
  overrides: IncidentCarryForward = {},
): IncidentCarryForward {
  return {
    monitorsRemoved: [],
    monitorsAdded: [],
    oldChangeMonitorStatusIdTo: undefined,
    newMonitorChangeStatusIdTo: undefined,
    ...overrides,
  };
}

function runUpdateSuccess(data: {
  payload: JSONObject;
  props?: DatabaseCommonInteractionProps;
  carryForward?: Record<string, IncidentCarryForward>;
  incidentIds?: Array<string>;
}): Promise<OnUpdate<Incident>> {
  return (
    IncidentService as unknown as { onUpdateSuccess: OnUpdateSuccess }
  ).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: INCIDENT_ID },
        data: data.payload,
        // A state change's own write: OneUptime's, carrying no project.
        props: data.props || { isRoot: true, userId: USER_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Incident>,
      carryForward: data.carryForward ?? {},
    },
    (data.incidentIds || [INCIDENT_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// Every follow-on of an edit, none of which a state write alone runs.
function expectNoFollowOn(): void {
  expect(findOneById).not.toHaveBeenCalled();
  expect(createFeedItem).not.toHaveBeenCalled();
  expect(refreshReminders).not.toHaveBeenCalled();
  expect(startWaitingRuns).not.toHaveBeenCalled();
  expect(tryFixAgain).not.toHaveBeenCalled();
  expect(investigationWait).not.toHaveBeenCalled();
  expect(recalculateSla).not.toHaveBeenCalled();
  expect(applyPostmortemUpdate).not.toHaveBeenCalled();
  expect(movePostmortemStatus).not.toHaveBeenCalled();
  expect(customFieldsFeed).not.toHaveBeenCalled();
  expect(statusPageScopeFeed).not.toHaveBeenCalled();
  expect(requeueCreatedNotification).not.toHaveBeenCalled();
  expect(updateMonitors).not.toHaveBeenCalled();
  expect(findMonitors).not.toHaveBeenCalled();
  expect(findMonitorStatus).not.toHaveBeenCalled();
  expect(findResolvedTimeline).not.toHaveBeenCalled();
}

function feedMarkdown(): string {
  return (createFeedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

describe("IncidentService.onUpdateSuccess after a state change", () => {
  test("writing the state alone reads the incident no more, and runs no follow-on", async () => {
    await runUpdateSuccess({
      payload: { currentIncidentStateId: RESOLVED_STATE_ID },
    });

    expectNoFollowOn();
  });

  test("the state change itself still runs, once an incident, for a write in a project", async () => {
    await runUpdateSuccess({
      payload: { currentIncidentStateId: RESOLVED_STATE_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      incidentIds: [INCIDENT_ID, OTHER_INCIDENT_ID],
    });

    expect(changeIncidentState).toHaveBeenCalledTimes(2);
    expect(
      changeIncidentState.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { incidentId: ObjectID }).incidentId.toString();
      }),
    ).toEqual([INCIDENT_ID, OTHER_INCIDENT_ID]);
    // And nothing more for either of them.
    expectNoFollowOn();
  });

  test("writing back the title, labels and severity the incident holds changes nothing either", async () => {
    await runUpdateSuccess({
      payload: {
        currentIncidentStateId: RESOLVED_STATE_ID,
        title: "Checkout down",
        incidentSeverityId: SEV3_ID,
      },
      carryForward: {
        [INCIDENT_ID]: {
          ...monitorsCarried(),
          severityIdBeforeUpdate: SEV3_ID,
          valuesBeforeUpdate: { title: "Checkout down" },
        },
      },
    });

    expectNoFollowOn();
  });

  test("a title that really changed is read and recorded as before", async () => {
    await runUpdateSuccess({
      payload: { title: "Checkout down in eu-west" },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: {
          ...monitorsCarried(),
          valuesBeforeUpdate: { title: "Checkout down" },
        },
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    // Written to follow the editor's name: "Valeria updated Incident INC-7."
    expect(feedMarkdown()).toContain("✏️ Updated [Incident INC-7]");
    expect(feedMarkdown()).toContain("Checkout down in eu-west");
    // A title is what the investigation rules read: their wait follows it.
    expect(investigationWait).toHaveBeenCalledTimes(1);
  });

  test("a severity that really changed is read, recorded, its SLA recalculated and matched against the rules again", async () => {
    await runUpdateSuccess({
      payload: { incidentSeverityId: SEV1_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: {
          ...monitorsCarried(),
          severityIdBeforeUpdate: SEV3_ID,
        },
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("SEV1");
    expect(recalculateSla).toHaveBeenCalledTimes(1);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(startWaitingRuns).toHaveBeenCalledTimes(1);
  });

  test("a severity the read before the write did not see counts as changed", async () => {
    await runUpdateSuccess({
      payload: { incidentSeverityId: SEV1_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(recalculateSla).toHaveBeenCalledTimes(1);
  });
});

/*
 * AN UPDATE THAT LINKS THE INCIDENT TO WHAT IT IS ABOUT STILL MAKES ONEUPTIME
 * AI TRY A FIX AGAIN (#5293): its project is read and it is handed to the
 * engine, though no feed line follows.
 */
describe("IncidentService.onUpdateSuccess after the incident is linked to what it is about", () => {
  const CLUSTER_ID: string = "0193c0de-bbbb-4bbb-8bbb-0000000000e2";

  test.each([
    ["a Kubernetes cluster", { kubernetesClusters: [{ _id: CLUSTER_ID }] }],
    ["its monitors, as it holds them", { monitors: [{ _id: MONITOR_ID }] }],
  ])(
    "linking it to %s hands it to OneUptime AI to try a fix again",
    async (_name: string, payload: JSONObject) => {
      await runUpdateSuccess({
        payload: payload,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
        // The monitor list written back as it was: no monitor change.
        carryForward: { [INCIDENT_ID]: monitorsCarried() },
      });

      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(tryFixAgain).toHaveBeenCalledTimes(1);

      const handed: { projectId: ObjectID; incidentId: ObjectID } = tryFixAgain
        .mock.calls[0]![0] as { projectId: ObjectID; incidentId: ObjectID };

      expect(handed.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(handed.incidentId.toString()).toBe(INCIDENT_ID);
      // A link is no feed entry, and no rule the incident matches changed.
      expect(createFeedItem).not.toHaveBeenCalled();
      expect(refreshReminders).not.toHaveBeenCalled();
      expect(startWaitingRuns).not.toHaveBeenCalled();
    },
  );

  test("a link written as undefined is no link, and reads nothing more", async () => {
    await runUpdateSuccess({
      payload: {
        currentIncidentStateId: RESOLVED_STATE_ID,
        kubernetesClusters: undefined,
      } as unknown as JSONObject,
    });

    expectNoFollowOn();
  });
});

/*
 * THE POSTMORTEM'S FOLLOW-ONS: its note or switch (subscribers told once,
 * its status moved), its posted time (a metric) and a status picked that
 * really changed (a feed line). Each still reads the incident.
 */
describe("IncidentService.onUpdateSuccess after a postmortem edit", () => {
  test("a note written is compared and moves the postmortem's status", async () => {
    await runUpdateSuccess({
      payload: { postmortemNote: "The checkout pods ran out of memory." },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(applyPostmortemUpdate).toHaveBeenCalledTimes(1);
    expect(movePostmortemStatus).toHaveBeenCalledTimes(1);
  });

  test("its posted time looks for the resolution it is measured from", async () => {
    await runUpdateSuccess({
      payload: { postmortemPostedAt: new Date("2026-11-03T12:00:00.000Z") },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findResolvedTimeline).toHaveBeenCalledTimes(1);
  });

  test("a status picked that really changed is a feed line", async () => {
    await runUpdateSuccess({
      payload: { postmortemStatusId: POSTMORTEM_DONE_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: {
          ...monitorsCarried(),
          postmortemStatusIdBeforeUpdate: POSTMORTEM_DRAFT_ID,
        },
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Postmortem Status");
  });

  test("the status the postmortem holds, written back, reads nothing more", async () => {
    await runUpdateSuccess({
      payload: {
        currentIncidentStateId: RESOLVED_STATE_ID,
        postmortemStatusId: POSTMORTEM_DONE_ID,
      },
      carryForward: {
        [INCIDENT_ID]: {
          ...monitorsCarried(),
          postmortemStatusIdBeforeUpdate: POSTMORTEM_DONE_ID,
        },
      },
    });

    expectNoFollowOn();
  });
});

describe("IncidentService.onUpdateSuccess after custom field values are written", () => {
  test("they are read for their feed lines", async () => {
    await runUpdateSuccess({
      payload: { customFields: { region: "eu-west" } },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(customFieldsFeed).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
  });
});

/*
 * MONITORS AND STATUS PAGES: what onBeforeUpdate carried forward decides.
 * A list or a status written back as it was carries no change, and reads
 * nothing more.
 */
describe("IncidentService.onUpdateSuccess after its monitors or status pages change", () => {
  test("a monitor put on the incident is read, named in the feed and applied to the monitors", async () => {
    await runUpdateSuccess({
      payload: { monitors: [{ _id: MONITOR_ID }] },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: monitorsCarried({
          monitorsAdded: [new Monitor(new ObjectID(MONITOR_ID))],
        }),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findMonitors).toHaveBeenCalledTimes(1);
    expect(updateMonitors).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Monitors Added");
  });

  test("a monitor taken off is read and restored", async () => {
    await runUpdateSuccess({
      payload: { monitors: [] },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: monitorsCarried({
          monitorsRemoved: [new Monitor(new ObjectID(MONITOR_ID))],
          isResolvedBeforeUpdate: false,
        }),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(updateMonitors).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Monitors Removed");
  });

  test("a monitor status that really changed is read and recorded", async () => {
    await runUpdateSuccess({
      payload: { changeMonitorStatusToId: DEGRADED_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: monitorsCarried({
          oldChangeMonitorStatusIdTo: new ObjectID(OPERATIONAL_ID),
          newMonitorChangeStatusIdTo: new ObjectID(DEGRADED_ID),
        }),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findMonitorStatus).toHaveBeenCalledTimes(2);
    expect(updateMonitors).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Monitor Status Changed");
  });

  test("the monitor status the incident holds, written back with a state, reads nothing more", async () => {
    await runUpdateSuccess({
      payload: {
        currentIncidentStateId: RESOLVED_STATE_ID,
        changeMonitorStatusToId: OPERATIONAL_ID,
      },
      carryForward: {
        [INCIDENT_ID]: monitorsCarried({
          oldChangeMonitorStatusIdTo: new ObjectID(OPERATIONAL_ID),
          newMonitorChangeStatusIdTo: new ObjectID(OPERATIONAL_ID),
        }),
      },
    });

    expectNoFollowOn();
  });

  test("a status page scope change is read for its feed line and its 'created' notification", async () => {
    await runUpdateSuccess({
      payload: { statusPages: [] },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        [INCIDENT_ID]: monitorsCarried({
          statusPageScopeChange: {
            isScoped: true,
            notificationQueued: false,
          },
        }),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(statusPageScopeFeed).toHaveBeenCalledTimes(1);
    expect(requeueCreatedNotification).toHaveBeenCalledTimes(1);
  });
});

/*
 * A BULK UPDATE: one payload for every incident, a carry forward each. Only
 * the incidents something follows for are read.
 */
describe("IncidentService.onUpdateSuccess for many incidents at once", () => {
  test("only the incident whose monitor status changed is read", async () => {
    await runUpdateSuccess({
      payload: { changeMonitorStatusToId: DEGRADED_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      incidentIds: [INCIDENT_ID, OTHER_INCIDENT_ID],
      carryForward: {
        // It puts its monitors in that status already: nothing changes.
        [INCIDENT_ID]: monitorsCarried({
          oldChangeMonitorStatusIdTo: new ObjectID(DEGRADED_ID),
          newMonitorChangeStatusIdTo: new ObjectID(DEGRADED_ID),
        }),
        [OTHER_INCIDENT_ID]: monitorsCarried({
          oldChangeMonitorStatusIdTo: new ObjectID(OPERATIONAL_ID),
          newMonitorChangeStatusIdTo: new ObjectID(DEGRADED_ID),
        }),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(
      (findOneById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(OTHER_INCIDENT_ID);
    expect(updateMonitors).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(
      (
        createFeedItem.mock.calls[0]![0] as { incidentId: ObjectID }
      ).incidentId.toString(),
    ).toBe(OTHER_INCIDENT_ID);
  });

  test("a monitor list written to many incidents is a link on each, and a feed line only where it changed", async () => {
    await runUpdateSuccess({
      payload: { monitors: [{ _id: MONITOR_ID }] },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      incidentIds: [INCIDENT_ID, OTHER_INCIDENT_ID],
      carryForward: {
        // It had the monitor already: nothing changes for it.
        [INCIDENT_ID]: monitorsCarried(),
        [OTHER_INCIDENT_ID]: monitorsCarried({
          monitorsAdded: [new Monitor(new ObjectID(MONITOR_ID))],
        }),
      },
    });

    // OneUptime AI may fix through the list, so both are read and handed over.
    expect(findOneById).toHaveBeenCalledTimes(2);
    expect(tryFixAgain).toHaveBeenCalledTimes(2);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(
      (
        createFeedItem.mock.calls[0]![0] as { incidentId: ObjectID }
      ).incidentId.toString(),
    ).toBe(OTHER_INCIDENT_ID);
  });

  test("a state written to many incidents reads none of them", async () => {
    await runUpdateSuccess({
      payload: { currentIncidentStateId: RESOLVED_STATE_ID },
      incidentIds: [INCIDENT_ID, OTHER_INCIDENT_ID],
    });

    expectNoFollowOn();
  });
});
