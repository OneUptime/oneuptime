import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PUT /api/incident/:id, /api/alert/:id, /api/scheduled-maintenance/:id and
 * /api/status-page-announcement/:id: what an update sets off follows what it
 * really changes.
 *
 *   - A severity changed through the ID column - how the API, Terraform
 *     (incident_severity_id), workflows and the AI tools write it - records
 *     itself in the feed, recalculates the SLA deadlines, re-matches the
 *     reminder rule and counts as a severity change, once each. It used to do
 *     none of that: only the relation name the dashboard sends set them off.
 *   - The severity a record already holds, written back under either name,
 *     sets off none of them. It used to set them all off again on every save
 *     of the dashboard's Incident Details card.
 *   - "Notify status page subscribers" is decided when the record is created.
 *     A whole record written back - a master-key client, say - carries it as
 *     true, and that used to queue the 'created' message again (and, for an
 *     incident, forget which status pages were told, so every page heard it
 *     twice). The write now carries the flag and nothing else. No role may
 *     write the flag on update at all.
 *
 * The server's own permission layer and the services' own hooks run here;
 * only the database is a stand-in: the record every read finds, the
 * repository it writes to, which records the project has
 * (stubProjectDirectory), and the services the side effects call.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-a91e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-a91e-4aaa-8bbb-000000000002");
const RECORD_ID: string = "0193c0de-a91e-4aaa-8bbb-0000000000a1";
const PAGE_A: string = "0193c0de-a91e-4aaa-8bbb-0000000000d1";

// The severities of the record's project; the record holds MINOR.
const MINOR: string = "0193c0de-a91e-4aaa-8bbb-0000000000b1";
const CRITICAL: string = "0193c0de-a91e-4aaa-8bbb-0000000000b2";

const SEVERITY_NAMES: Record<string, string> = {
  [MINOR]: "Minor",
  [CRITICAL]: "Critical",
};

/*
 * A signed-in person holding exactly `permissions` in the project. Fresh
 * per call: the permission layer adds Public and Current User to the props
 * it is handed.
 */
function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

// A master admin: the master API key, or a master admin's session.
function masterAdmin(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
    tenantId: PROJECT_ID,
  };
}

// The members of a service these tests stub that its type keeps private.
interface StubbableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

let caller: DatabaseCommonInteractionProps;
let repositoryUpdate: MockFunction;

/*
 * The database behind a service: every read finds `stored`, and every write
 * reaches the stub repository.
 */
function stubDatabase(
  service: DatabaseService<BaseModel>,
  stored: () => BaseModel,
): void {
  const stubbable: StubbableService = service as unknown as StubbableService;

  jest.spyOn(stubbable, "_findBy").mockImplementation((async (): Promise<
    Array<BaseModel>
  > => {
    return [stored()];
  }) as never);

  repositoryUpdate = getJestMockFunction();
  repositoryUpdate.mockResolvedValue({ affected: 1 } as never);

  jest.spyOn(stubbable, "getRepository").mockReturnValue({
    update: repositoryUpdate,
    save: repositoryUpdate,
  } as never);

  jest
    .spyOn(stubbable, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(stubbable, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
}

async function put(
  modelType: { new (): BaseModel },
  service: DatabaseService<BaseModel>,
  data: JSONObject,
): Promise<void> {
  const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI<
    BaseModel,
    DatabaseService<BaseModel>
  >(modelType, service);

  const request: ExpressRequest = {
    params: { id: RECORD_ID },
    body: { data: data },
    headers: {},
  } as unknown as ExpressRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await api.updateItem(request, response);
}

// The columns the one write set, without TypeORM's version bump.
function written(): Record<string, unknown> {
  expect(repositoryUpdate).toHaveBeenCalledTimes(1);

  const set: Record<string, unknown> = {
    ...(repositoryUpdate.mock.calls[0]![1] as Record<string, unknown>),
  };

  delete set["version"];

  return set;
}

beforeEach(() => {
  caller = personWith([Permission.ProjectAdmin]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      IncidentSeverity: [MINOR, CRITICAL],
      AlertSeverity: [MINOR, CRITICAL],
    },
  });

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  (Response.sendEmptySuccessResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT an incident", () => {
  const incidentService: DatabaseService<BaseModel> =
    IncidentService as unknown as DatabaseService<BaseModel>;

  let feed: MockFunction;
  let recalculate: MockFunction;
  let refreshReminders: MockFunction;
  let metrics: MockFunction;

  function storedIncident(): Incident {
    const incident: Incident = new Incident();
    incident._id = RECORD_ID;
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout errors";
    incident.incidentNumber = 12;
    incident.incidentNumberWithPrefix = "INC-12";
    incident.incidentSeverityId = new ObjectID(MINOR);
    incident.isVisibleOnStatusPage = true;
    incident.isPrivate = false;
    // Declared notifying subscribers, and the message went out to page A.
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;
    incident.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Success;
    incident.statusPagesNotifiedOnCreation = [PAGE_A];
    return incident;
  }

  beforeEach(() => {
    stubDatabase(incidentService, storedIncident);

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);

    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: { _id: unknown };
      }): Promise<IncidentSeverity> => {
        const id: string = String(findOneBy.query._id).toLowerCase();
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = id;
        severity.name = SEVERITY_NAMES[id] || "Unknown";
        return severity;
      }) as never);

    feed = getJestMockFunction();
    feed.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation(feed as never);

    recalculate = getJestMockFunction();
    recalculate.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentSlaService, "recalculateDeadlines")
      .mockImplementation(recalculate as never);

    refreshReminders = getJestMockFunction();
    refreshReminders.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "refreshReminderSchedule")
      .mockImplementation(refreshReminders as never);

    jest
      .spyOn(IncidentService, "getIncidentMetricContext")
      .mockResolvedValue({ baseMetricAttributes: {} } as never);
    jest
      .spyOn(
        IncidentService as unknown as {
          getMetricRetentionDays: () => Promise<number>;
        },
        "getMetricRetentionDays",
      )
      .mockResolvedValue(30 as never);

    metrics = getJestMockFunction();
    metrics.mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "createMutableMetrics")
      .mockImplementation(metrics as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
  });

  function severityChanges(): Array<MutableMetric> {
    return metrics.mock.calls
      .flatMap((call: Array<unknown>): Array<MutableMetric> => {
        return (call[0] as { metrics: Array<MutableMetric> }).metrics;
      })
      .filter((metric: MutableMetric): boolean => {
        return metric.name === IncidentMetricType.SeverityChange;
      });
  }

  function feedMarkdown(): Array<string> {
    return feed.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    });
  }

  test("a new severity by its ID column, as the API and Terraform write it, does everything a severity change does, once", async () => {
    await put(Incident, incidentService, { incidentSeverityId: CRITICAL });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(String(written()["incidentSeverityId"])).toBe(CRITICAL);

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Incident Severity");
    expect(feedMarkdown()[0]).toContain("Critical");
    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(severityChanges()).toHaveLength(1);
  });

  test("a new severity by the relation, as the dashboard sends it, does the same, once", async () => {
    await put(Incident, incidentService, {
      incidentSeverity: { _id: CRITICAL },
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Critical");
    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(severityChanges()).toHaveLength(1);
  });

  test.each([
    ["its ID column", { incidentSeverityId: MINOR }],
    ["the relation", { incidentSeverity: { _id: MINOR } }],
  ] as Array<[string, JSONObject]>)(
    "the severity the incident holds, written back by %s, sets off nothing",
    async (_label: string, data: JSONObject) => {
      await put(Incident, incidentService, data);

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(feed).not.toHaveBeenCalled();
      expect(recalculate).not.toHaveBeenCalled();
      expect(refreshReminders).not.toHaveBeenCalled();
      expect(severityChanges()).toHaveLength(0);
    },
  );

  test("the dashboard's Incident Details save of a new title records the title, and nothing about the unchanged severity", async () => {
    await put(Incident, incidentService, {
      title: "Checkout errors in EU",
      incidentSeverity: { _id: MINOR },
    });

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Checkout errors in EU");
    expect(feedMarkdown()[0]).not.toContain("Incident Severity");
    expect(recalculate).not.toHaveBeenCalled();
    expect(severityChanges()).toHaveLength(0);
  });

  test("a master admin writing the whole incident back, notify flag included, re-sends nothing", async () => {
    caller = masterAdmin();

    await put(Incident, incidentService, {
      title: "Checkout errors",
      description: "Payments fail for some customers.",
      incidentSeverityId: MINOR,
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);

    const set: Record<string, unknown> = written();

    expect(set["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"]).toBe(
      true,
    );
    // The 'created' message and its record of told pages are left alone.
    expect(set).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
    expect(set).not.toHaveProperty("subscriberNotificationStatusMessage");
    expect(set).not.toHaveProperty("statusPagesNotifiedOnCreation");
    // And the unchanged severity sets off nothing either.
    expect(recalculate).not.toHaveBeenCalled();
    expect(severityChanges()).toHaveLength(0);
  });

  test("a master admin turning the flag off writes the flag alone", async () => {
    caller = masterAdmin();

    await put(Incident, incidentService, {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
    });

    expect(written()).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
    });
  });

  test("no role may write the flag once the incident exists: refused, and nothing is written", async () => {
    caller = personWith([Permission.ProjectOwner]);

    await expect(
      put(Incident, incidentService, {
        title: "Checkout errors",
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      }),
    ).rejects.toThrow(
      "User is not allowed to update on shouldStatusPageSubscribersBeNotifiedOnIncidentCreated column of Incident",
    );

    expect(repositoryUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("the API's own way of sending the 'created' message again still works", async () => {
    await put(Incident, incidentService, {
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    const set: Record<string, unknown> = written();

    expect(set["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    // Sent to every page again, as documented.
    expect(set["statusPagesNotifiedOnCreation"]).toEqual([]);
  });
});

describe("PUT an alert", () => {
  const alertService: DatabaseService<BaseModel> =
    AlertService as unknown as DatabaseService<BaseModel>;

  let feed: MockFunction;
  let refreshReminders: MockFunction;

  function storedAlert(): Alert {
    const alert: Alert = new Alert();
    alert._id = RECORD_ID;
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 3;
    alert.alertNumberWithPrefix = "ALT-3";
    alert.alertSeverityId = new ObjectID(MINOR);
    return alert;
  }

  beforeEach(() => {
    stubDatabase(alertService, storedAlert);

    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/a") as never);

    jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: { _id: unknown };
      }): Promise<AlertSeverity> => {
        const id: string = String(findOneBy.query._id).toLowerCase();
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = id;
        severity.name = SEVERITY_NAMES[id] || "Unknown";
        return severity;
      }) as never);

    feed = getJestMockFunction();
    feed.mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation(feed as never);

    refreshReminders = getJestMockFunction();
    refreshReminders.mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertService, "refreshReminderSchedule")
      .mockImplementation(refreshReminders as never);
  });

  test("a new severity by its ID column is recorded in the feed and re-matches reminders, once", async () => {
    await put(Alert, alertService, { alertSeverityId: CRITICAL });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("Critical");
    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["its ID column", { alertSeverityId: MINOR }],
    ["the relation", { alertSeverity: { _id: MINOR } }],
  ] as Array<[string, JSONObject]>)(
    "the severity the alert holds, written back by %s, sets off nothing",
    async (_label: string, data: JSONObject) => {
      await put(Alert, alertService, data);

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(feed).not.toHaveBeenCalled();
      expect(refreshReminders).not.toHaveBeenCalled();
    },
  );
});

describe("PUT a scheduled maintenance event or an announcement as a master admin, notify flag included", () => {
  function storedEvent(): ScheduledMaintenance {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = RECORD_ID;
    event.projectId = PROJECT_ID;
    event.shouldStatusPageSubscribersBeNotifiedOnEventCreated = true;
    event.subscriberNotificationStatusOnEventScheduled =
      StatusPageSubscriberNotificationStatus.Success;
    return event;
  }

  function storedAnnouncement(): StatusPageAnnouncement {
    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement._id = RECORD_ID;
    announcement.projectId = PROJECT_ID;
    announcement.shouldStatusPageSubscribersBeNotified = true;
    announcement.subscriberNotificationStatus =
      StatusPageSubscriberNotificationStatus.Success;
    return announcement;
  }

  test.each([
    [
      "scheduled maintenance event",
      ScheduledMaintenance,
      ScheduledMaintenanceService,
      storedEvent,
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      "subscriberNotificationStatusOnEventScheduled",
    ],
    [
      "announcement",
      StatusPageAnnouncement,
      StatusPageAnnouncementService,
      storedAnnouncement,
      "shouldStatusPageSubscribersBeNotified",
      "subscriberNotificationStatus",
    ],
  ] as Array<
    [string, { new (): BaseModel }, unknown, () => BaseModel, string, string]
  >)(
    "%s: its 'created' message is not queued again",
    async (
      _kind: string,
      modelType: { new (): BaseModel },
      service: unknown,
      stored: () => BaseModel,
      flagColumn: string,
      statusColumn: string,
    ) => {
      caller = masterAdmin();
      stubDatabase(service as DatabaseService<BaseModel>, stored);

      await put(modelType, service as DatabaseService<BaseModel>, {
        [flagColumn]: true,
      });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(written()).toEqual({ [flagColumn]: true });
      expect(written()).not.toHaveProperty(statusColumn);
    },
  );
});
