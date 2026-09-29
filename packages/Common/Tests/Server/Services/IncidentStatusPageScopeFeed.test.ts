import Incident from "../../../Models/DatabaseModels/Incident";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import IncidentService from "../../../Server/Services/IncidentService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The incident feed renders its Markdown without safe mode, so a status page
 * name - free text a status page role can set - must not turn into a link or
 * an image in the feed items that record an incident's status page scope:
 * "Limited to Status Pages" on the created item, and "Status Pages Added" /
 * "Status Pages Removed" on an update.
 */

const projectId: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const incidentId: ObjectID = new ObjectID(
  "a1b2c3d4-0000-4000-8000-000000000001",
);
const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";

// A name that closes the link early, loads a tracking image and opens a new link.
const HOSTILE_NAME: string =
  "Site 3](https://evil.example/login) ![](https://tracker.example/p.png) [x";

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.id = new ObjectID(id);
  statusPage.name = name;
  return statusPage;
}

type PrivateFeedMarkdown = {
  getStatusPageScopeFeedMarkdown: (data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    change: {
      addedStatusPageIds: Array<string>;
      removedStatusPageIds: Array<string>;
      isScoped: boolean;
      notificationQueued: boolean;
      notificationAlreadyQueued: boolean;
    };
  }) => Promise<string>;
  getScopedStatusPagesMarkdown: (incident: Incident) => Promise<string>;
};

const service: PrivateFeedMarkdown =
  IncidentService as unknown as PrivateFeedMarkdown;

function mockDashboardLinks(): void {
  jest
    .spyOn(StatusPageService, "getStatusPageLinkInDashboard")
    .mockImplementation((async (
      _projectId: ObjectID,
      statusPageId: ObjectID,
    ): Promise<URL> => {
      return URL.fromString(
        `https://oneuptime.example/dashboard/status-pages/${statusPageId.toString()}`,
      );
    }) as never);
}

// No live link or image may come out of the page name: only the dashboard link.
function expectOnlyDashboardLinks(markdown: string): void {
  expect(markdown).not.toContain("](https://evil.example");
  expect(markdown).not.toContain("![](https://tracker.example");
  expect(markdown).toContain(
    "Site 3\\]\\(https://evil.example/login\\) \\!\\[\\]\\(https://tracker.example/p.png\\) \\[x",
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService: status page names in the scope feed items", () => {
  test("the pages added and removed are listed with their names escaped", async () => {
    mockDashboardLinks();
    jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([
        page(PAGE_A, HOSTILE_NAME),
        page(PAGE_B, "*Internal* _page_"),
      ] as never);

    const markdown: string = await service.getStatusPageScopeFeedMarkdown({
      projectId: projectId,
      incidentId: incidentId,
      change: {
        addedStatusPageIds: [PAGE_A],
        removedStatusPageIds: [PAGE_B],
        isScoped: true,
        notificationQueued: false,
        notificationAlreadyQueued: false,
      },
    });

    expect(markdown).toContain("Status Pages Added");
    expect(markdown).toContain("Status Pages Removed");
    expectOnlyDashboardLinks(markdown);
    expect(markdown).toContain(
      `- [\\*Internal\\* \\_page\\_](https://oneuptime.example/dashboard/status-pages/${PAGE_B})`,
    );
  });

  test("the pages a new incident is limited to are listed with their names escaped", async () => {
    mockDashboardLinks();

    const stored: Incident = new Incident();
    stored.statusPages = [page(PAGE_A, HOSTILE_NAME)];
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(stored);

    const incident: Incident = new Incident();
    incident.id = incidentId;
    incident.projectId = projectId;

    const markdown: string =
      await service.getScopedStatusPagesMarkdown(incident);

    expectOnlyDashboardLinks(markdown);
    expect(markdown).toContain(
      `](https://oneuptime.example/dashboard/status-pages/${PAGE_A})`,
    );
  });
});
