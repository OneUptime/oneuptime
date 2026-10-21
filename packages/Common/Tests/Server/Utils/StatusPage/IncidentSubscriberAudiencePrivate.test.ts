import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import IncidentService from "../../../../Server/Services/IncidentService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "../../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import IncidentSubscriberAudienceBuilder from "../../../../Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder";
import ObjectID from "../../../../Types/ObjectID";
import { IncidentSubscriberAudienceResult } from "../../../../Types/StatusPage/IncidentSubscriberAudience";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The "Will notify" summary of a private incident. A private incident is
 * hidden from every status page (StatusPageVisibility), and the summary says
 * so (isHiddenFromStatusPages). What it says of the pages is about the
 * incident's scope, as if it were not private: the subscriber jobs, which
 * send, leave a private incident out of every page; the summary, which sends
 * nothing, does not blame the pages it is limited to for listing none of its
 * monitors when they do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000001",
);
const INCIDENT_ID: string = "0193c0de-3333-4aaa-8bbb-0000000000a1";
const PAGE_ID: string = "0193c0de-3333-4aaa-8bbb-0000000000b1";
const MONITOR_ID: string = "0193c0de-3333-4aaa-8bbb-0000000000c1";

let resolvePages: MockFunction;

beforeEach(() => {
  const findOneBy: MockFunction = getJestMockFunction();
  findOneBy.mockImplementation((async (args: {
    select: Record<string, unknown>;
  }): Promise<Incident> => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID;

    if (args.select["isScopedToStatusPages"]) {
      // The scope, read as root: limited to the page.
      const page: StatusPage = new StatusPage();
      page._id = PAGE_ID;
      incident.isScopedToStatusPages = true;
      incident.statusPages = [page];
      return incident;
    }

    // The caller's own read: private, with Visible on Status Page on.
    incident.isVisibleOnStatusPage = true;
    incident.isPrivate = true;
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    incident.monitors = [monitor];
    return incident;
  }) as never);
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation(findOneBy as never);

  // The page lists the incident's monitor: the scope reaches it.
  resolvePages = getJestMockFunction();
  resolvePages.mockImplementation(
    (async (): Promise<ResolvedIncidentStatusPages> => {
      const page: StatusPage = new StatusPage();
      page._id = PAGE_ID;
      page.projectId = PROJECT_ID;
      page.showIncidentsOnStatusPage = true;

      return {
        statusPages: [page],
        statusPageToResources: {},
        isScoped: true,
        excludedStatusPages: [],
      } as unknown as ResolvedIncidentStatusPages;
    }) as never,
  );
  jest
    .spyOn(IncidentStatusPageScope, "resolvePagesForIncidents")
    .mockImplementation(resolvePages as never);

  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (): Promise<
    Array<StatusPage>
  > => {
    const page: StatusPage = new StatusPage();
    page._id = PAGE_ID;
    page.name = "Site A";
    return [page];
  }) as never);
  jest
    .spyOn(StatusPageSubscriberService, "countActiveSubscribersByChannel")
    .mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the subscriber audience of a private incident", () => {
  test("says the incident is hidden, and does not blame the page it is limited to", async () => {
    const audience: IncidentSubscriberAudienceResult =
      await IncidentSubscriberAudienceBuilder.build({
        projectId: PROJECT_ID,
        props: { isRoot: true, tenantId: PROJECT_ID },
        incidentId: new ObjectID(INCIDENT_ID),
      });

    expect(audience.isHiddenFromStatusPages).toBe(true);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([]);
  });

  test("works the pages out from the scope as if the incident were not private", async () => {
    await IncidentSubscriberAudienceBuilder.build({
      projectId: PROJECT_ID,
      props: { isRoot: true, tenantId: PROJECT_ID },
      incidentId: new ObjectID(INCIDENT_ID),
    });

    expect(resolvePages).toHaveBeenCalledTimes(1);
    expect(resolvePages.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ includePrivateIncidents: true }),
    );
  });
});
