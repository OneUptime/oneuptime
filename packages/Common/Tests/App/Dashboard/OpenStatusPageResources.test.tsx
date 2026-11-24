import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import { matchRoutes } from "react-router-dom";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import OpenStatusPageResources, {
  STATUS_PAGE_NOT_IN_YOUR_PROJECTS,
  getStatusPageResourcesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/OpenStatusPageResources";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  STATUS_PAGE_RESOURCES_BY_ID_PATH,
  getStatusPageResourcesByIdPath,
} from "../../../Types/StatusPage/StatusPageResourcesLink";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { goTo } from "./SideMenuHarness";

/*
 * A STATUS PAGE'S RESOURCES, OPENED FROM ITS PREVIEW BY ITS ID ALONE (#9180).
 *
 * The preview's note for a page with nothing on it links its owner to
 * /dashboard/status-pages/<id>/resources: the preview knows the page's id
 * and no project. The Dashboard finds the page among the person's projects,
 * with one read across them, and passes the browser on to its Resources in
 * its project, in place of itself. A page they cannot read is answered the
 * same whatever the reason, with what to do next.
 */

const STATUS_PAGE_ID: string = "91800000-0000-4000-8000-0000000000a1";
const PROJECT_ID: string = "91800000-0000-4000-8000-0000000000b1";
const OTHER_PROJECT_ID: string = "91800000-0000-4000-8000-0000000000b2";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type GetList = typeof ModelAPI.getList;

let getList: jest.SpiedFunction<GetList>;
let navigate: jest.SpiedFunction<typeof Navigation.navigate>;

function answerWith(statusPages: Array<StatusPage>): void {
  getList.mockResolvedValue({
    data: statusPages,
    count: statusPages.length,
    skip: 0,
    limit: 1,
  } as unknown as ListResult<StatusPage>);
}

function statusPageIn(projectId: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.projectId = new ObjectID(projectId);
  return statusPage;
}

async function open(address: string): Promise<void> {
  goTo(address);

  await act(async () => {
    render(
      <OpenStatusPageResources
        pageRoute={RouteMap[PageMap.STATUS_PAGE_RESOURCES_BY_ID] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getList = jest.spyOn(ModelAPI, "getList") as jest.SpiedFunction<GetList>;
  navigate = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("the address the preview links to", () => {
  test("is the Dashboard's route for it, by the page's id alone", () => {
    expect(RouteMap[PageMap.STATUS_PAGE_RESOURCES_BY_ID]!.toString()).toBe(
      `/dashboard${STATUS_PAGE_RESOURCES_BY_ID_PATH}`,
    );
    expect(getStatusPageResourcesByIdPath(STATUS_PAGE_ID)).toBe(
      `/status-pages/${STATUS_PAGE_ID}/resources`,
    );
  });

  test("opens this page and no project's: no route of a project matches it", () => {
    const routes: Array<{ path: string; page: string }> = Object.entries(
      RouteMap,
    )
      .map(([page, route]: [string, Route | undefined]) => {
        return { path: route?.toString() || "", page: page };
      })
      .filter((route: { path: string }): boolean => {
        return Boolean(route.path);
      });

    const matched: ReturnType<typeof matchRoutes> = matchRoutes(
      routes,
      `/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`,
    );

    expect(
      (matched?.[matched.length - 1]?.route as { page: string } | undefined)
        ?.page,
    ).toBe(PageMap.STATUS_PAGE_RESOURCES_BY_ID);
    expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();
  });

  test("is a page of the Dashboard's", () => {
    const app: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/App.tsx",
      ),
      "utf8",
    );

    expect(app).toContain(
      'import("./Pages/StatusPages/OpenStatusPageResources")',
    );
    expect(app).toContain("RouteMap[PageMap.STATUS_PAGE_RESOURCES_BY_ID]");
    expect(app).toContain("<OpenStatusPageResources");
  });
});

describe("opening it", () => {
  test("asks across the person's projects for the page's project, and nothing more", async () => {
    answerWith([statusPageIn(PROJECT_ID)]);

    await open(`/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`);

    expect(getList).toHaveBeenCalledTimes(1);
    const request: Parameters<GetList>[0] = getList.mock
      .calls[0]![0] as Parameters<GetList>[0];

    expect(request.modelType).toBe(StatusPage);
    expect(String((request.query as { _id: unknown })._id)).toBe(
      STATUS_PAGE_ID,
    );
    expect(request.select).toEqual({ _id: true, projectId: true });
    expect(request.limit).toBe(1);
    expect(request.requestOptions?.isMultiTenantRequest).toBe(true);
  });

  test("passes the browser on to the page's Resources in its project, in place of itself", async () => {
    answerWith([statusPageIn(PROJECT_ID)]);

    await open(`/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`);

    expect(navigate).toHaveBeenCalledTimes(1);
    const [to, options] = navigate.mock.calls[0]!;

    expect(to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/resources`,
    );
    // The project open in this tab: inside the tab.
    expect(options).toEqual({ replace: true, forceNavigate: false });
  });

  test("a page of another project opens in full, so the Dashboard opens that project", async () => {
    answerWith([statusPageIn(OTHER_PROJECT_ID)]);

    await open(`/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`);

    const [to, options] = navigate.mock.calls[0]!;

    expect(to.toString()).toBe(
      `/dashboard/${OTHER_PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/resources`,
    );
    expect(options).toEqual({ replace: true, forceNavigate: true });
  });

  test("the route it passes on to is the Resources page's own", () => {
    const route: Route = getStatusPageResourcesRoute({
      projectId: new ObjectID(PROJECT_ID),
      statusPageId: new ObjectID(STATUS_PAGE_ID),
    });

    expect(
      matchRoutes(
        [
          {
            path: RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES]!.toString(),
          },
        ],
        route.toString(),
      ),
    ).not.toBeNull();
  });

  test("a page in none of their projects is said so, with what to do next", async () => {
    answerWith([]);

    await open(`/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`);

    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText(STATUS_PAGE_NOT_IN_YOUR_PROJECTS),
    ).toBeInTheDocument();
  });

  test("an id that is no id is answered the same, and nothing is asked", async () => {
    await open("/dashboard/status-pages/not-a-status-page/resources");

    expect(getList).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText(STATUS_PAGE_NOT_IN_YOUR_PROJECTS),
    ).toBeInTheDocument();
  });

  test("a read that fails says so, and passes the browser nowhere", async () => {
    getList.mockRejectedValue(new Error("The server did not answer."));

    await open(`/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`);

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText(STATUS_PAGE_NOT_IN_YOUR_PROJECTS)).toBeNull();
    expect(document.body.textContent?.trim()).not.toBe("");
  });
});

describe("its words", () => {
  test("are a sentence that says what happened and what to do next", () => {
    expect(STATUS_PAGE_NOT_IN_YOUR_PROJECTS).toBe(
      "This status page is not in any project you belong to. Check the link, or ask someone in its project to invite you.",
    );
  });

  test("are worded in every Dashboard language", () => {
    const languages: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(languages.length).toBe(18);

    for (const file of languages) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, unknown>;
      const words: unknown = locale[STATUS_PAGE_NOT_IN_YOUR_PROJECTS];

      expect({ file, type: typeof words }).toEqual({ file, type: "string" });

      if (file !== "en.json") {
        expect({
          file,
          same: words === STATUS_PAGE_NOT_IN_YOUR_PROJECTS,
        }).toEqual({ file, same: false });
      }
    }
  });
});
