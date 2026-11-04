import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import TabProject, {
  CURRENT_PROJECT_ID_STORAGE_KEY,
  LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
} from "../../../UI/Utils/TabProject";
import ProjectUtil, {
  CURRENT_PROJECT_ID_STORAGE_KEY as PROJECT_UTIL_CURRENT_KEY,
  LAST_ACCESSED_PROJECT_ID_STORAGE_KEY as PROJECT_UTIL_LAST_KEY,
} from "../../../UI/Utils/Project";

/*
 * THE PROJECT ONE DASHBOARD TAB SHOWS (UI/Utils/TabProject): the project
 * every request of the tab names in its tenantid header, through
 * ProjectUtil.getCurrentProjectId, and the project whose permission
 * snapshot the tab's buttons follow (UI/Utils/Permission). Both read it
 * here, so the two can never name different projects.
 *
 * It is read on the way of every request (the API client sends that
 * project's permission hash), so it stays light: importing the API client
 * brings neither the Project model nor telemetry.
 */

const URL_PROJECT_ID: string = "7a000000-0000-4000-8000-000000000001";
const SESSION_PROJECT_ID: string = "7a000000-0000-4000-8000-000000000002";
const LAST_PROJECT_ID: string = "7a000000-0000-4000-8000-000000000003";

type GoFunction = (path: string) => void;

const go: GoFunction = (path: string): void => {
  window.history.replaceState(null, "", path);
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  go("/");
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  go("/");
});

describe("the project a tab shows", () => {
  test("is the one its address names first, then the tab's own, then the one this browser opened last", () => {
    sessionStorage.setItem(CURRENT_PROJECT_ID_STORAGE_KEY, SESSION_PROJECT_ID);
    localStorage.setItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY, LAST_PROJECT_ID);

    go(`/dashboard/${URL_PROJECT_ID}/incidents`);
    expect(TabProject.getProjectId()?.toString()).toBe(URL_PROJECT_ID);

    go("/dashboard/user-settings/profile");
    expect(TabProject.getProjectId()?.toString()).toBe(SESSION_PROJECT_ID);

    sessionStorage.clear();
    expect(TabProject.getProjectId()?.toString()).toBe(LAST_PROJECT_ID);

    localStorage.clear();
    expect(TabProject.getProjectId()).toBeNull();
  });

  test("is never a route's placeholder, another app's address or what is not an id", () => {
    for (const path of [
      "/dashboard/:projectId/home",
      "/dashboard/welcome",
      "/dashboard",
      `/status-page/${URL_PROJECT_ID}`,
      `/admin/projects/${URL_PROJECT_ID}`,
      "/dashboard/project-1/home",
    ]) {
      go(path);
      expect([path, TabProject.getProjectIdFromUrl()]).toEqual([path, null]);
    }

    for (const stored of ["", "undefined", "null", "project-1", "{}"]) {
      sessionStorage.setItem(CURRENT_PROJECT_ID_STORAGE_KEY, stored);
      localStorage.setItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY, stored);
      expect([stored, TabProject.getProjectId()]).toEqual([stored, null]);
    }
  });

  test("is what ProjectUtil names to the API, in every case", () => {
    const cases: Array<[string, () => void]> = [
      [
        "a project's page",
        (): void => {
          go(`/dashboard/${URL_PROJECT_ID}/home`);
        },
      ],
      [
        "a page of no project, after the tab showed one",
        (): void => {
          go("/dashboard/user-settings");
          sessionStorage.setItem(
            CURRENT_PROJECT_ID_STORAGE_KEY,
            SESSION_PROJECT_ID,
          );
        },
      ],
      [
        "a new tab",
        (): void => {
          go("/dashboard");
          localStorage.setItem(
            LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
            LAST_PROJECT_ID,
          );
        },
      ],
      [
        "no project",
        (): void => {
          go("/dashboard/welcome");
        },
      ],
    ];

    for (const [where, open] of cases) {
      localStorage.clear();
      sessionStorage.clear();
      open();

      expect([where, TabProject.getProjectId()?.toString() || null]).toEqual([
        where,
        ProjectUtil.getCurrentProjectId()?.toString() || null,
      ]);
      expect([where, TabProject.getProjectIdFromUrl()?.toString()]).toEqual([
        where,
        ProjectUtil.getProjectIdFromUrl()?.toString(),
      ]);
      expect([
        where,
        TabProject.getLastAccessedProjectId()?.toString(),
      ]).toEqual([where, ProjectUtil.getLastAccessedProjectId()?.toString()]);
    }
  });

  test("keeps the names ProjectUtil has always used", () => {
    expect(CURRENT_PROJECT_ID_STORAGE_KEY).toBe("current_project_id");
    expect(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY).toBe(
      "last_accessed_project_id",
    );
    expect(PROJECT_UTIL_CURRENT_KEY).toBe(CURRENT_PROJECT_ID_STORAGE_KEY);
    expect(PROJECT_UTIL_LAST_KEY).toBe(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY);
  });

  test("a project ProjectUtil picks for the tab is the one it shows", () => {
    go("/dashboard");

    ProjectUtil.setCurrentProject({ _id: SESSION_PROJECT_ID, name: "Acme" });

    expect(TabProject.getProjectId()?.toString()).toBe(SESSION_PROJECT_ID);
    expect(TabProject.getLastAccessedProjectId()?.toString()).toBe(
      SESSION_PROJECT_ID,
    );
  });
});

describe("what reading it brings with it", () => {
  test("the API client, the permission snapshot and the tab's project load no telemetry and no Project model", () => {
    const loaded: Array<string> = [];

    jest.isolateModules(() => {
      jest.doMock("@opentelemetry/sdk-trace-web", () => {
        loaded.push("@opentelemetry/sdk-trace-web");
        return { WebTracerProvider: class {} };
      });
      jest.doMock("../../../UI/Utils/Telemetry/Telemetry", () => {
        loaded.push("UI/Utils/Telemetry/Telemetry");
        return { __esModule: true, default: {} };
      });
      jest.doMock("../../../Models/DatabaseModels/Project", () => {
        loaded.push("Models/DatabaseModels/Project");
        return { __esModule: true, default: class {} };
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../../../UI/Utils/API/API");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../../../UI/Utils/Permission");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../../../UI/Utils/TabProject");
    });

    expect(loaded).toEqual([]);
  });
});
