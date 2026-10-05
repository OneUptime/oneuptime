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
 * PUT /api/incident/:id and the postmortem: subscribers are told once, when
 * the postmortem is published.
 *
 *   - An API client that writes the whole incident back - as it read it, the
 *     postmortem's note, its Publish on Status Page switch and Notify
 *     Subscribers included - used to queue the postmortem notification
 *     again and add a "Postmortem Note updated" feed item (found in #4422).
 *     It now sets off nothing.
 *   - Switching publishing on over a written note - how the API and
 *     Terraform (show_postmortem_on_status_page) publish it - queues the
 *     notification, once.
 *   - Changing the note of a published postmortem is recorded in the feed
 *     and tells nobody.
 *   - The API's own way of sending it again - writing the status as Pending
 *     - still works, and is the only Pending written.
 *
 * The server's own permission layer and the incident service's own hooks
 * run here; only the database is a stand-in: the record every read finds,
 * the repository it writes to, which records the project has
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
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import IncidentPostmortemPublication from "../../../Types/StatusPage/IncidentPostmortemPublication";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a90-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5a90-4aaa-8bbb-000000000002");
const RECORD_ID: string = "0193c0de-5a90-4aaa-8bbb-0000000000a1";

const NOTE: string =
  "## What happened\n\nCheckout returned errors for 12 minutes after a bad deploy.";
const PUBLISHED_AT: string = "2026-10-05T09:30:00.000Z";

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

// The members of a service these tests stub that its type keeps private.
interface StubbableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

const incidentService: DatabaseService<BaseModel> =
  IncidentService as unknown as DatabaseService<BaseModel>;

let caller: DatabaseCommonInteractionProps;
let stored: Incident;
let repositoryUpdate: MockFunction;
let compareAndSet: MockFunction;
let feed: MockFunction;

// The incident as stored: its postmortem is published, and subscribers heard.
function publishedIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = RECORD_ID;
  incident.projectId = PROJECT_ID;
  incident.title = "Checkout errors";
  incident.incidentNumber = 12;
  incident.incidentNumberWithPrefix = "INC-12";
  incident.isVisibleOnStatusPage = true;
  incident.isPrivate = false;
  incident.postmortemNote = NOTE;
  incident.showPostmortemOnStatusPage = true;
  incident.notifySubscribersOnPostmortemPublished = true;
  incident.postmortemPostedAt = new Date(PUBLISHED_AT);
  incident.subscriberNotificationStatusOnPostmortemPublished =
    StatusPageSubscriberNotificationStatus.Success;
  return incident;
}

async function put(data: JSONObject): Promise<void> {
  const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI<
    BaseModel,
    DatabaseService<BaseModel>
  >(Incident, incidentService);

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

// Every write that puts the postmortem notification back to Pending.
function postmortemNotificationsQueued(): Array<{
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
}> {
  return compareAndSet.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      };
    })
    .filter(
      (input: {
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      }): boolean => {
        return (
          input.data["subscriberNotificationStatusOnPostmortemPublished"] ===
          StatusPageSubscriberNotificationStatus.Pending
        );
      },
    );
}

function postmortemFeedItems(): Array<string> {
  return feed.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      };
    })
    .filter(
      (input: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): boolean => {
        return (
          input.incidentFeedEventType === IncidentFeedEventType.PostmortemNote
        );
      },
    )
    .map(
      (input: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): string => {
        return input.feedInfoInMarkdown;
      },
    );
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
  stored = publishedIncident();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({ projectId: PROJECT_ID });

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  // The database behind the service: every read finds the stored incident.
  const stubbable: StubbableService =
    incidentService as unknown as StubbableService;

  jest.spyOn(stubbable, "_findBy").mockImplementation((async (): Promise<
    Array<BaseModel>
  > => {
    return [stored];
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

  compareAndSet = getJestMockFunction();
  compareAndSet.mockResolvedValue(true as never);
  jest
    .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(compareAndSet as never);

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(feed as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);

  // Published At moves the incident's metrics; none of that is looked at here.
  jest
    .spyOn(IncidentService, "refreshIncidentMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(ObjectID.generate() as never);
  jest
    .spyOn(IncidentStateTimelineService, "findOneBy")
    .mockResolvedValue(null as never);

  (Response.sendEmptySuccessResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT an incident's postmortem", () => {
  test("the whole incident written back as it was read sets off nothing", async () => {
    await put({
      title: "Checkout errors",
      isVisibleOnStatusPage: true,
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
      notifySubscribersOnPostmortemPublished: true,
      postmortemPostedAt: PUBLISHED_AT,
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(written()["postmortemNote"]).toBe(NOTE);
    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("switching publishing on over a written note, as the API and Terraform do, queues the notification once", async () => {
    stored.showPostmortemOnStatusPage = false;
    stored.subscriberNotificationStatusOnPostmortemPublished =
      StatusPageSubscriberNotificationStatus.Skipped;

    await put({ showPostmortemOnStatusPage: true });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(postmortemNotificationsQueued()).toEqual([
      expect.objectContaining({
        data: {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            IncidentPostmortemPublication.queuedMessage,
        },
        expectedData: {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
      }),
    ]);
    // The note did not change, and the write itself carries no status.
    expect(postmortemFeedItems()).toEqual([]);
    expect(written()).toEqual({ showPostmortemOnStatusPage: true });
  });

  test("changing the note of a published postmortem records it once and tells nobody", async () => {
    await put({ postmortemNote: `${NOTE}\n\nFollow-up: add a canary stage.` });

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
    expect(postmortemFeedItems()[0]).toContain("add a canary stage");
  });

  test("taking it off the status page tells nobody, and publishing it again tells them again", async () => {
    await put({ showPostmortemOnStatusPage: false });

    expect(postmortemNotificationsQueued()).toEqual([]);

    stored.showPostmortemOnStatusPage = false;
    repositoryUpdate.mockClear();

    await put({ showPostmortemOnStatusPage: true });

    expect(postmortemNotificationsQueued()).toHaveLength(1);
  });

  test("the API's own way of sending it again still works, and is the only Pending written", async () => {
    await put({
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    expect(written()["subscriberNotificationStatusOnPostmortemPublished"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(compareAndSet).not.toHaveBeenCalled();
  });

  test("someone who may only read incidents is refused, and nothing is written, recorded or queued", async () => {
    caller = personWith([Permission.IncidentViewer]);

    await expect(
      put({ postmortemNote: "Rewritten", showPostmortemOnStatusPage: true }),
    ).rejects.toThrow();

    expect(repositoryUpdate).not.toHaveBeenCalled();
    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });
});
