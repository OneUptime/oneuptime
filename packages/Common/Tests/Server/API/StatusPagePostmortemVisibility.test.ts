import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";
const INCIDENTS_ROUTE: string = "/status-page/incidents/:statusPageIdOrDomain";
const INCIDENT_DETAIL_ROUTE: string = `${INCIDENTS_ROUTE}/:incidentId`;
const VISIBILITY_VALUES: Array<boolean | null | undefined> = [
  false,
  undefined,
  null,
  true,
];

type Fixtures = {
  statusPageId: string;
  incidents: Array<Incident>;
  originalIncidentJSON: JSONArray;
  publicNote: IncidentPublicNote;
  pageReadSpy: jest.SpyInstance;
  incidentReadSpy: jest.SpyInstance;
};

function mockServices(data: { overview: boolean }): Fixtures {
  const page: StatusPage = new StatusPage();
  page._id = ObjectID.generate().toString();
  page.projectId = ObjectID.generate();
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage = true;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorId = ObjectID.generate();

  const incidents: Array<Incident> = VISIBILITY_VALUES.map(
    (visibility: boolean | null | undefined, index: number): Incident => {
      const attachment: File = new File();
      attachment._id = ObjectID.generate().toString();
      attachment.name = `postmortem-${index}-internal.pdf`;

      const incident: Incident = new Incident();
      incident._id = ObjectID.generate().toString();
      incident.title = `Public incident ${index}`;
      incident.description = `Public description ${index}`;
      incident.createdAt = new Date("2026-09-01T12:00:00.000Z");
      incident.postmortemNote = `Postmortem ${index}: confidential root cause`;
      incident.postmortemPostedAt = new Date("2026-09-02T12:00:00.000Z");
      incident.postmortemAttachments = [attachment];
      // Legacy rows may have a null or missing value instead of false.
      Object.assign(incident, { showPostmortemOnStatusPage: visibility });
      return incident;
    },
  );

  const publicNote: IncidentPublicNote = new IncidentPublicNote();
  publicNote._id = ObjectID.generate().toString();
  publicNote.incidentId = incidents[0]!.id!;
  publicNote.note = "Public update remains available";
  publicNote.postedAt = new Date("2026-09-01T13:00:00.000Z");

  (
    jest.spyOn(StatusPageService, "findOneById") as unknown as jest.SpyInstance
  ).mockResolvedValue(page as never);

  const pageReadSpy: jest.SpyInstance = (
    jest.spyOn(StatusPageService, "findOneBy") as unknown as jest.SpyInstance
  ).mockResolvedValue(page as never);

  (
    jest.spyOn(
      StatusPageService,
      "getStatusPageResources",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([resource] as never);

  (
    jest.spyOn(
      StatusPageService,
      "getMonitorIdsOnStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({
    monitorsOnStatusPage: [resource.monitorId],
    monitorsInGroup: {},
  } as never);

  (
    jest.spyOn(MonitorStatusService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(StatusPageGroupService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageResourceService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([resource] as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getMonitorGroupResourcesByGroupIds",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getCurrentStatusesForMonitorGroups",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  (
    jest.spyOn(
      StatusPageService,
      "getMonitorStatusTimelineForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageHistoryChartBarColorRuleService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      IncidentStateService,
      "getUnresolvedIncidentStates",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(IncidentStateService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      IncidentStateTimelineService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      IncidentPublicNoteService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([publicNote] as never);

  const incidentReadSpy: jest.SpyInstance = (
    jest.spyOn(IncidentService, "findBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query, select } = args as {
      query: JSONObject;
      select: JSONObject;
    };

    // The overview also fetches timeline summaries, which select no postmortem.
    if (!select["postmortemNote"]) {
      return Promise.resolve([]);
    }

    if (query["_id"]) {
      return Promise.resolve(
        incidents.filter((incident: Incident) => {
          return incident._id === query["_id"];
        }),
      );
    }

    if (data.overview) {
      return Promise.resolve(incidents);
    }

    // Include both active and recent incidents, with one overlapping row.
    return Promise.resolve(
      query["currentIncidentStateId"]
        ? [incidents[0], incidents[3]]
        : [incidents[0], incidents[1], incidents[2]],
    );
  });

  return {
    statusPageId: page._id,
    incidents,
    originalIncidentJSON: BaseModel.toJSONArray(incidents, Incident),
    publicNote,
    pageReadSpy,
    incidentReadSpy,
  };
}

async function invokeRoute(data: {
  route: string;
  method: "get" | "post";
  statusPageId: string;
  incidentId?: string;
}): Promise<JSONObject> {
  const req: ExpressRequest = {
    params: {
      statusPageIdOrDomain: data.statusPageId,
      incidentId: data.incidentId,
    },
    body: {},
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const responseMock: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const previousResponseCount: number = responseMock.mock.calls.length;

  await mockRouter
    .match(data.method, data.route)
    .handlerFunction(req, res, next);
  // Let the overview's detached cache-population chain settle before a hit.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  expect(next).not.toHaveBeenCalled();
  expect(responseMock).toHaveBeenCalledTimes(previousResponseCount + 1);
  return responseMock.mock.calls[previousResponseCount]![2] as JSONObject;
}

function expectVisibility(data: {
  payload: JSONObject;
  key: "activeIncidents" | "incidents";
  incidents: Array<Incident>;
}): void {
  const serializedIncidents: JSONArray = data.payload[data.key] as JSONArray;
  expect(serializedIncidents).toHaveLength(data.incidents.length);

  for (const incident of data.incidents) {
    const serializedIncident: JSONObject | undefined = serializedIncidents.find(
      (value: unknown) => {
        return (value as JSONObject)["_id"] === incident._id;
      },
    ) as JSONObject | undefined;
    expect(serializedIncident).toBeDefined();
    expect(serializedIncident!["title"]).toBe(incident.title);
    expect(serializedIncident!["description"]).toBe(incident.description);
    expect(serializedIncident!["createdAt"]).toEqual(
      BaseModel.toJSON(incident, Incident)["createdAt"],
    );

    if (incident.showPostmortemOnStatusPage === true) {
      // Published notes retain their full date and attachment serialization.
      expect(serializedIncident).toEqual(BaseModel.toJSON(incident, Incident));
      expect(serializedIncident!["postmortemNote"]).toBe(
        incident.postmortemNote,
      );
      expect(serializedIncident!["postmortemAttachments"]).toEqual([
        {
          _id: incident.postmortemAttachments![0]!._id,
          name: incident.postmortemAttachments![0]!.name,
        },
      ]);
    } else {
      expect(serializedIncident).not.toHaveProperty("postmortemNote");
      expect(serializedIncident).not.toHaveProperty("postmortemPostedAt");
      expect(serializedIncident).not.toHaveProperty("postmortemAttachments");
      // Check the complete payload, including the overview cache's contents.
      expect(JSON.stringify(data.payload)).not.toContain(
        incident.postmortemNote,
      );
      expect(JSON.stringify(data.payload)).not.toContain(
        incident.postmortemAttachments![0]!.name,
      );
    }
  }
}

function expectSourcesUnchanged(fixtures: Fixtures): void {
  expect(BaseModel.toJSONArray(fixtures.incidents, Incident)).toEqual(
    fixtures.originalIncidentJSON,
  );
}

describe("StatusPageAPI postmortem visibility", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
  });

  it.each(["get", "post"] as const)(
    "omits unpublished postmortems on a cold %s overview and the other method's warm cache",
    async (method: "get" | "post") => {
      const fixtures: Fixtures = mockServices({ overview: true });
      const cold: JSONObject = await invokeRoute({
        method,
        route: OVERVIEW_ROUTE,
        statusPageId: fixtures.statusPageId,
      });
      const warm: JSONObject = await invokeRoute({
        method: method === "get" ? "post" : "get",
        route: OVERVIEW_ROUTE,
        statusPageId: fixtures.statusPageId,
      });

      expect(fixtures.pageReadSpy).toHaveBeenCalledTimes(1);
      expect(warm).toBe(cold);
      for (const payload of [cold, warm]) {
        expectVisibility({
          payload,
          key: "activeIncidents",
          incidents: fixtures.incidents,
        });
        expect(payload["incidentPublicNotes"]).toEqual(
          BaseModel.toJSONArray([fixtures.publicNote], IncidentPublicNote),
        );
      }
      expectSourcesUnchanged(fixtures);
    },
  );

  it.each(["get", "post"] as const)(
    "omits unpublished postmortems from active and recent incidents on the %s list",
    async (method: "get" | "post") => {
      const fixtures: Fixtures = mockServices({ overview: false });
      const payload: JSONObject = await invokeRoute({
        method,
        route: INCIDENTS_ROUTE,
        statusPageId: fixtures.statusPageId,
      });

      expect(fixtures.incidentReadSpy).toHaveBeenCalledTimes(2);
      expectVisibility({
        payload,
        key: "incidents",
        incidents: fixtures.incidents,
      });
      expect(payload["incidentPublicNotes"]).toEqual(
        BaseModel.toJSONArray([fixtures.publicNote], IncidentPublicNote),
      );
      expectSourcesUnchanged(fixtures);
    },
  );

  it.each(VISIBILITY_VALUES)(
    "exposes a detail postmortem only when visibility is explicitly true (value: %s)",
    async (visibility: boolean | null | undefined) => {
      const fixtures: Fixtures = mockServices({ overview: false });
      const incident: Incident = fixtures.incidents.find((item: Incident) => {
        return item.showPostmortemOnStatusPage === visibility;
      })!;
      const payload: JSONObject = await invokeRoute({
        method: "post",
        route: INCIDENT_DETAIL_ROUTE,
        statusPageId: fixtures.statusPageId,
        incidentId: incident._id!,
      });

      expect(fixtures.incidentReadSpy).toHaveBeenCalledTimes(1);
      expectVisibility({ payload, key: "incidents", incidents: [incident] });
      expectSourcesUnchanged(fixtures);
    },
  );
});
