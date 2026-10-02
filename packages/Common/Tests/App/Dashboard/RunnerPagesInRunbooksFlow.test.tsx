import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import * as React from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  linksIn,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Runner pages, walked through the way a person uses them — with the real
 * Runbooks route group, the real Runbooks layout (side menu and breadcrumbs)
 * and the real Runners, Runner and Runner Credentials pages, in a router that
 * moves the address bar. Only the model API is stubbed.
 *
 * The other suites pin each piece on its own: the routes, the redirects, the
 * menu, the trail. What none of them can see is the joins between pages —
 * that the list's "View Runner" opens the Runner under Runbooks, that
 * deleting a Runner returns to the Runbooks list, that a credential's Runner
 * links to that Runner's page, and that somebody arriving on an old
 * Project Settings bookmark ends up on a page that works rather than on a
 * redirect to nothing.
 */

const WAIT_TIMEOUT: number = 20000;

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

/*
 * The runbook pages themselves are not what this is about, and the step
 * editor alone is thousands of lines: they are markers here. The layout, the
 * side menu and the three Runner pages are real.
 */
const MOCKED_RUNBOOK_PAGES: Array<string> = [
  "Runbooks",
  "Executions",
  "Secrets",
  "Settings/OwnerRules",
  "Settings/LabelRules",
  "View/Layout",
  "View/Index",
  "View/Steps",
  "View/Executions",
  "View/ExecutionView",
  "View/Owners",
  "View/AuditLogs",
  "View/Settings",
  "View/Delete",
];

for (const module of MOCKED_RUNBOOK_PAGES) {
  jest.doMock(`${DASHBOARD}/Pages/Runbook/${module}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="runbook-page">{module}</div>;
      },
    };
  });
}

/*
 * The Settings route group is real — it owns the redirects — but every
 * Settings page it imports is a marker, found by reading its source so a page
 * added later is covered too.
 */
const SETTINGS_PAGE_MODULES: Array<string> = Array.from(
  new Set(
    Array.from(
      fs
        .readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "..",
            "..",
            "App",
            "FeatureSet",
            "Dashboard",
            "src",
            "Routes",
            "SettingsRoutes.tsx",
          ),
          "utf8",
        )
        .matchAll(/"\.\.\/Pages\/(Settings\/[A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    }),
  ),
);

for (const module of SETTINGS_PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="settings-page">{module}</div>;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
type RouteGroup = React.FunctionComponent<Record<string, unknown>>;

const RunbookRoutes: RouteGroup = (
  jest.requireActual(`${DASHBOARD}/Routes/RunbookRoutes`) as {
    default: RouteGroup;
  }
).default;

const SettingsRoutes: RouteGroup = (
  jest.requireActual(`${DASHBOARD}/Routes/SettingsRoutes`) as {
    default: RouteGroup;
  }
).default;

const BASTION_ID: string = "aaaaaaaa-1111-4111-8111-000000000001";
const STAGING_ID: string = "aaaaaaaa-1111-4111-8111-000000000002";

const RUNBOOKS: string = `/dashboard/${PROJECT_ID}/runbooks`;
const SETTINGS: string = `/dashboard/${PROJECT_ID}/settings`;
const RUNNERS_PATH: string = `${RUNBOOKS}/runners`;
const CREDENTIALS_PATH: string = `${RUNBOOKS}/runner-credentials`;

function runnerPath(id: string): string {
  return `${RUNNERS_PATH}/${id}`;
}

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

function makeRunner(id: string, name: string): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: `${name} description`,
    key: "runner-key",
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
    lastAlive: new Date(),
  });
}

function makeCredential(
  id: string,
  name: string,
  runners: Array<Runner>,
): RunbookCredential {
  return Object.assign(new RunbookCredential(), {
    _id: id,
    name,
    description: "",
    credentialType: RunbookCredentialType.SSH,
    runners,
  });
}

let runners: Array<Runner> = [];
let deleteItemSpy: SpyInstance<typeof ModelAPI.deleteItem>;

// What App.tsx does on every render: hand the router's state to Navigation.
const Shell: React.FunctionComponent = (): React.ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <Routes>
      <RouterRoute
        path={RouteMap[PageMap.RUNBOOKS_ROOT]!.toString()}
        element={
          <RunbookRoutes
            pageRoute={new Route(RUNBOOKS)}
            currentProject={null}
            hasPaymentMethod={true}
          />
        }
      />
      <RouterRoute
        path={RouteMap[PageMap.SETTINGS_ROOT]!.toString()}
        element={
          <SettingsRoutes
            pageRoute={new Route(SETTINGS)}
            currentProject={null}
            hasPaymentMethod={true}
            onProjectDeleted={() => {}}
          />
        }
      />
    </Routes>
  );
};

function open(url: string): void {
  window.history.pushState({}, "", url);

  render(
    <BrowserRouter>
      <Shell />
    </BrowserRouter>,
  );
}

function breadcrumbs(): Array<string> {
  return within(screen.getByRole("navigation", { name: "Breadcrumb" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent ?? "").trim();
    });
}

function highlightedMenuEntries(): Array<string> {
  return Array.from(document.querySelectorAll("nav a"))
    .filter((anchor: Element): boolean => {
      return anchor.className.includes("bg-indigo-50");
    })
    .map((anchor: Element): string => {
      return (anchor.querySelector("span.truncate")?.textContent ?? "").trim();
    });
}

async function rowOf(name: string): Promise<HTMLElement> {
  const cell: HTMLElement = await screen.findByText(
    name,
    {},
    { timeout: WAIT_TIMEOUT },
  );
  const row: HTMLElement | null = cell.closest("tr");

  if (!row) {
    throw new Error(`"${name}" is not in a table row.`);
  }

  return row;
}

async function expectPath(expected: string): Promise<void> {
  await waitFor(
    () => {
      expect(window.location.pathname).toBe(expected);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

async function expectRunnerPage(name: string): Promise<void> {
  await screen.findByText("Runner Details", {}, { timeout: WAIT_TIMEOUT });
  await screen.findAllByText(name, {}, { timeout: WAIT_TIMEOUT });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);

  runners = [
    makeRunner(BASTION_ID, "prod-bastion"),
    makeRunner(STAGING_ID, "staging-runner"),
  ];

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(ADMIN_PERMISSIONS);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: ADMIN_PERMISSIONS.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (args: unknown): Promise<Runner | null> => {
      return (
        runners.find((runner: Runner): boolean => {
          return String(runner._id) === String((args as { id?: unknown }).id);
        }) || null
      );
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      const modelType: unknown = (args as { modelType?: unknown }).modelType;
      let data: Array<unknown> = [];

      if (modelType === Runner) {
        data = runners;
      } else if (modelType === RunbookCredential) {
        data = [
          makeCredential(
            "bbbbbbbb-1111-4111-8111-000000000001",
            "db-host-ssh",
            [runners[0]!],
          ),
        ];
      }

      return {
        data: data as Array<never>,
        count: data.length,
        skip: 0,
        limit: 10,
      };
    });

  deleteItemSpy = jest
    .spyOn(ModelAPI, "deleteItem")
    .mockImplementation(async (args: unknown): Promise<never> => {
      runners = runners.filter((runner: Runner): boolean => {
        return String(runner._id) !== String((args as { id?: unknown }).id);
      });
      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Runners list, inside Runbooks", () => {
  test("it renders under the Runbooks title, trail and menu, with the project's Runners", async () => {
    open(RUNNERS_PATH);

    await rowOf("prod-bastion");
    await rowOf("staging-runner");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Runbooks",
    );
    expect(breadcrumbs()).toEqual(["Project", "Runbooks", "Runners"]);
    expect(highlightedMenuEntries()).toEqual(["Runners"]);
    expect(
      linksIn("Runners").map((link: MenuLink): string => {
        return link.href;
      }),
    ).toEqual([RUNNERS_PATH, CREDENTIALS_PATH]);
  });

  test("View Runner opens that Runner's page under Runbooks", async () => {
    open(RUNNERS_PATH);

    const row: HTMLElement = await rowOf("staging-runner");
    fireEvent.click(within(row).getByText("View Runner"));

    await expectPath(runnerPath(STAGING_ID));
    await expectRunnerPage("staging-runner");
    expect(breadcrumbs()).toEqual([
      "Project",
      "Runbooks",
      "Runners",
      "View Runner",
    ]);
  });
});

describe("a Runner's page, inside Runbooks", () => {
  test("its Runners breadcrumb leads back to the list", async () => {
    open(runnerPath(BASTION_ID));
    await expectRunnerPage("prod-bastion");

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText(
        "Runners",
      ),
    );

    await expectPath(RUNNERS_PATH);
    await rowOf("staging-runner");
    expect(highlightedMenuEntries()).toEqual(["Runners"]);
  });

  test("its Runbooks breadcrumb leads to the runbooks, not to Settings", async () => {
    open(runnerPath(BASTION_ID));
    await expectRunnerPage("prod-bastion");

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText(
        "Runbooks",
      ),
    );

    await expectPath(RUNBOOKS);
    expect(await screen.findByTestId("runbook-page")).toHaveTextContent(
      "Runbooks",
    );
  });

  test("deleting the Runner returns to Runbooks → Runners, without it", async () => {
    open(runnerPath(BASTION_ID));
    await expectRunnerPage("prod-bastion");

    fireEvent.click(screen.getByRole("button", { name: "Delete Runner" }));
    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(deleteItemSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    const deleted: { modelType: unknown; id: ObjectID } = deleteItemSpy.mock
      .calls[0]![0] as { modelType: unknown; id: ObjectID };
    expect(deleted.modelType).toBe(Runner);
    expect(deleted.id.toString()).toBe(BASTION_ID);

    await expectPath(RUNNERS_PATH);
    await rowOf("staging-runner");
    expect(screen.queryByText("prod-bastion")).not.toBeInTheDocument();
    expect(breadcrumbs()).toEqual(["Project", "Runbooks", "Runners"]);
  });
});

describe("Runner Credentials, inside Runbooks", () => {
  test("the menu's Credentials entry opens it", async () => {
    open(RUNNERS_PATH);
    await rowOf("prod-bastion");

    const credentialsEntry: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>("nav a"),
    ).find((anchor: HTMLElement): boolean => {
      return anchor.getAttribute("href") === CREDENTIALS_PATH;
    });
    expect(credentialsEntry).toBeDefined();
    fireEvent.click(credentialsEntry!);

    await expectPath(CREDENTIALS_PATH);
    await rowOf("db-host-ssh");
    expect(breadcrumbs()).toEqual([
      "Project",
      "Runbooks",
      "Runner Credentials",
    ]);
    expect(highlightedMenuEntries()).toEqual(["Credentials"]);
  });

  test("a credential's Runner links to that Runner's page, and the link works", async () => {
    open(CREDENTIALS_PATH);

    const row: HTMLElement = await rowOf("db-host-ssh");
    const runnerLink: HTMLElement = within(row).getByRole("link", {
      name: /prod-bastion/,
    });
    expect(runnerLink).toHaveAttribute("href", runnerPath(BASTION_ID));

    fireEvent.click(runnerLink);

    await expectPath(runnerPath(BASTION_ID));
    await expectRunnerPage("prod-bastion");
  });
});

describe("arriving on an old Project Settings bookmark", () => {
  test("the Runners bookmark shows the list, and View Runner goes on from Runbooks", async () => {
    open(`${SETTINGS}/runners`);

    await expectPath(RUNNERS_PATH);
    const row: HTMLElement = await rowOf("prod-bastion");
    expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
    expect(breadcrumbs()).toEqual(["Project", "Runbooks", "Runners"]);

    fireEvent.click(within(row).getByText("View Runner"));

    await expectPath(runnerPath(BASTION_ID));
    await expectRunnerPage("prod-bastion");
  });

  test("a Runner's bookmark shows that Runner", async () => {
    open(`${SETTINGS}/runners/${STAGING_ID}`);

    await expectPath(runnerPath(STAGING_ID));
    await expectRunnerPage("staging-runner");
    expect(breadcrumbs()).toEqual([
      "Project",
      "Runbooks",
      "Runners",
      "View Runner",
    ]);
  });

  test("the Runner Credentials bookmark shows the credentials", async () => {
    open(`${SETTINGS}/runner-credentials`);

    await expectPath(CREDENTIALS_PATH);
    await rowOf("db-host-ssh");
    expect(highlightedMenuEntries()).toEqual(["Credentials"]);
  });

  test("Back does not bounce through the redirect", async () => {
    open(RUNBOOKS);
    await screen.findByTestId("runbook-page");
    const entriesBefore: number = window.history.length;

    Navigation.navigate(new Route(`${SETTINGS}/runners`));

    await expectPath(RUNNERS_PATH);
    await rowOf("prod-bastion");
    // One entry for the visit; the redirect replaced it rather than adding one.
    expect(window.history.length).toBe(entriesBefore + 1);
  });
});
