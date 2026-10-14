import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The project a status page belongs to never changes, and every public
 * request for a page asks for it (BlockedProjectStatusPages), as does its
 * cached overview (StatusPageOverviewCache). So it is read once per page and
 * kept per process - but only for a page that was found: a page made a
 * moment ago is found at once, and ids nobody has cannot fill the cache.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-0000000000ff",
);

function storedPage(projectId: ObjectID): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = STATUS_PAGE_ID;
  page.projectId = projectId;
  return page;
}

let findOneById: jest.SpyInstance;

beforeEach(() => {
  StatusPageService.clearProjectIdOfStatusPageCache();

  findOneById = jest
    .spyOn(StatusPageService, "findOneById")
    .mockResolvedValue(storedPage(PROJECT_ID) as never);
});

afterEach(() => {
  StatusPageService.clearProjectIdOfStatusPageCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("StatusPageService.getProjectIdOfStatusPage", () => {
  test("reads the page's project column alone, as root", async () => {
    const projectId: ObjectID | null =
      await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

    expect(projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(findOneById).toHaveBeenCalledWith({
      id: STATUS_PAGE_ID,
      select: { projectId: true },
      props: { isRoot: true },
    });
  });

  test("reads it once per page, not on every request", async () => {
    for (let request: number = 0; request < 5; request++) {
      const projectId: ObjectID | null =
        await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

      expect(projectId?.toString()).toBe(PROJECT_ID.toString());
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps one entry per page, however its id is written", async () => {
    await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

    const projectId: ObjectID | null =
      await StatusPageService.getProjectIdOfStatusPage(
        new ObjectID(STATUS_PAGE_ID.toString().toUpperCase()),
      );

    expect(projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps a page for an hour, then reads it again", async () => {
    const start: number = new Date("2026-10-13T10:00:00.000Z").getTime();
    jest.useFakeTimers({ now: start });

    await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

    jest.setSystemTime(start + 60 * 60 * 1000 - 1);
    await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);
    expect(findOneById).toHaveBeenCalledTimes(1);

    jest.setSystemTime(start + 60 * 60 * 1000 + 1);
    await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("does not keep a page that was not found: one made a moment later is found at once", async () => {
    findOneById.mockResolvedValueOnce(null as never);

    await expect(
      StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID),
    ).resolves.toBeNull();

    const projectId: ObjectID | null =
      await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

    expect(projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("answers a value that is not a page id without a query", async () => {
    await expect(
      StatusPageService.getProjectIdOfStatusPage(new ObjectID("not-an-id")),
    ).resolves.toBeNull();

    expect(findOneById).not.toHaveBeenCalled();
  });

  test("does not keep a failed read", async () => {
    findOneById.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID),
    ).rejects.toThrow("database unavailable");

    const projectId: ObjectID | null =
      await StatusPageService.getProjectIdOfStatusPage(STATUS_PAGE_ID);

    expect(projectId?.toString()).toBe(PROJECT_ID.toString());
  });
});
