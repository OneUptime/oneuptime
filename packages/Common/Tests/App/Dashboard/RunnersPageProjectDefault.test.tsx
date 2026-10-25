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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

import RunnersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners";
import GlobalRunnersCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersCopy";
import ProjectDefaultRunnerCopy, {
  PROJECT_DEFAULT_NOT_CONNECTED_WARNING_TEST_ID,
  PROJECT_DEFAULT_REFUSAL_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/ProjectDefaultRunnerCopy";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ProjectDefaultRunnerRefusal } from "../../../Types/Runner/ProjectDefaultRunner";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * THE PROJECT'S DEFAULT RUNNER, ON RUNBOOKS -> RUNNERS.
 *
 * The maintainer: "by default select the global runner unless I have custom
 * runner set to default runner for the project ... just like we set twilio
 * credentials as default for the project". So, as the Twilio Config table:
 *
 *   - the default Runner says so beside its name ("Project default");
 *   - every other Runner's ⋯ menu has "Set as Project Default", the
 *     default's "Stop Using as Project Default" - each asking first, saying
 *     which steps move, and saying when the Runner is not connected;
 *   - the server takes the default from the others (ProjectDefaultRow): the
 *     page writes the one Runner's column and reads the list again;
 *   - a Runner that may not be the default (the Kubernetes agent chart's
 *     in-cluster Runner, Runs Runbooks off) keeps the action, locked, saying
 *     why; someone who may not edit Runners sees it locked;
 *   - the Global Runners card and the switch's lines say what the default
 *     changes, and the Custom Runners card says a default can be made while
 *     there is none.
 *
 * The real page, tables, menus and dialogs are rendered; only the model API
 * and the permission snapshot are stubbed.
 */

const WAIT: { timeout: number } = { timeout: 20000 };

const PROD_ID: string = "88888888-0000-4000-8000-000000000001";
const OFFICE_ID: string = "88888888-0000-4000-8000-000000000002";
const AGENT_ID: string = "88888888-0000-4000-8000-000000000003";
const GLOBAL_EU_ID: string = "88888888-0000-4000-8000-0000000000a1";

let permissions: Array<Permission> = [];
let projectRows: Array<Runner> = [];
let runnerWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
let defaultReads: number = 0;
let updateFails: boolean = false;

function makeRunner(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: `${name} description`,
    key: "runner-key",
    canRunRunbooks: true,
    lastAlive: new Date(),
    ...overrides,
  });
}

function allow(held: Array<Permission>): void {
  permissions = held;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();

  allow([
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectAdmin,
  ]);
  projectRows = [
    makeRunner(PROD_ID, "prod-eu-west-1", { isProjectDefault: true }),
    makeRunner(OFFICE_ID, "office-runner", { lastAlive: undefined }),
  ];
  runnerWrites = [];
  defaultReads = 0;
  updateFails = false;

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockImplementation(() => {
    return {
      projectId: new ObjectID(PROJECT_ID),
      userId: ObjectID.generate(),
      permissions: permissions.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      _type: "UserTenantAccessPermission",
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>;
  });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      const call: {
        modelType: unknown;
        query: Record<string, unknown>;
        requestOptions?: { overrideRequestUrl?: unknown } | undefined;
      } = args as {
        modelType: unknown;
        query: Record<string, unknown>;
        requestOptions?: { overrideRequestUrl?: unknown } | undefined;
      };

      let data: Array<Runner> = [];

      if (
        String(call.requestOptions?.overrideRequestUrl || "").endsWith(
          GLOBAL_RUNNERS_ROUTE,
        )
      ) {
        data = [makeRunner(GLOBAL_EU_ID, "Global Runner")];
      } else if (call.modelType === Runner) {
        if (call.query["isProjectDefault"] === true) {
          defaultReads++;
          data = projectRows.filter((runner: Runner): boolean => {
            return runner.isProjectDefault === true;
          });
        } else {
          data = projectRows;
        }
      }

      return {
        data: data as Array<never>,
        count: data.length,
        skip: 0,
        limit: 10,
      };
    });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (args: unknown): Promise<never> => {
      if ((args as { modelType: unknown }).modelType === Project) {
        const project: Project = new Project();
        project._id = PROJECT_ID;
        project.useGlobalRunners = true;
        return project as never;
      }

      return null as never;
    });

  // The server's half: the one Runner written, the default taken from the rest.
  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const call: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      } = args as {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      };

      if (updateFails) {
        throw new Error("You do not have permission to do this.");
      }

      if (call.modelType === Runner) {
        runnerWrites.push({ id: call.id.toString(), data: call.data });

        for (const runner of projectRows) {
          if (runner._id?.toString() === call.id.toString()) {
            Object.assign(runner, call.data);
          } else if (call.data["isProjectDefault"] === true) {
            runner.isProjectDefault = false;
          }
        }
      }

      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The page, once the project's own Runners are listed (`listed`: one of them).
async function openRunnersPage(
  listed: string = "office-runner",
): Promise<void> {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/runners`;
  goTo(path);

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RunnersPage
          pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  await screen.findByText(listed, {}, WAIT);
}

// The project's own Runners' row of this Runner.
function row(name: string): HTMLElement {
  const cell: HTMLElement = within(
    document.getElementById("runbook-agents-table-body") as HTMLElement,
  ).getByText(name, { exact: true });

  return cell.closest("tr") as HTMLElement;
}

// The items of a row's ⋯ menu, once opened.
async function openMenu(name: string): Promise<HTMLElement> {
  fireEvent.click(within(row(name)).getByTestId("row-actions-more-button"));

  return (await screen.findAllByRole("menu", {}, WAIT))[0] as HTMLElement;
}

function menuItem(menu: HTMLElement, title: string): HTMLElement | null {
  return (
    within(menu)
      .queryAllByRole("menuitem")
      .find((item: HTMLElement): boolean => {
        return (item.textContent || "").includes(title);
      }) || null
  );
}

function cardTitled(title: string): HTMLElement {
  return screen
    .getByText(title, { exact: true })
    .closest('[data-testid="card"]') as HTMLElement;
}

describe("which Runner is the project's default", () => {
  test("says so beside its name, and nowhere else", async () => {
    await openRunnersPage();

    expect(
      within(row("prod-eu-west-1")).getByTestId("runner-project-default-pill"),
    ).toHaveTextContent("Project default");
    expect(
      within(row("office-runner")).queryByTestId("runner-project-default-pill"),
    ).toBeNull();
    expect(ProjectDefaultRunnerCopy.pillText).toBe("Project default");
  });

  test("the Global Runners card and the switch say what the default changes", async () => {
    await openRunnersPage();

    await waitFor(() => {
      expect(cardTitled(GlobalRunnersCopy.globalCardTitle)).toHaveTextContent(
        GlobalRunnersCopy.globalCardDescriptionWithDefault,
      );
    }, WAIT);
    await waitFor(() => {
      expect(cardTitled(GlobalRunnersCopy.switchCardTitle)).toHaveTextContent(
        GlobalRunnersCopy.switchOnDescriptionWithDefault,
      );
    }, WAIT);

    // One line across the card, as the line it stands for.
    expect(
      GlobalRunnersCopy.globalCardDescriptionWithDefault.length,
    ).toBeLessThanOrEqual(130);
    expect(screen.queryByTestId("project-default-runner-hint")).toBeNull();
  });

  test("with no default, the Custom Runners card says one can be made", async () => {
    projectRows = [makeRunner(OFFICE_ID, "office-runner")];

    await openRunnersPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("project-default-runner-hint"),
      ).toHaveTextContent(ProjectDefaultRunnerCopy.customCardSentence);
    }, WAIT);
    expect(cardTitled(GlobalRunnersCopy.customCardTitle)).toHaveTextContent(
      GlobalRunnersCopy.customCardDescription,
    );
    expect(cardTitled(GlobalRunnersCopy.globalCardTitle)).toHaveTextContent(
      GlobalRunnersCopy.globalCardDescription,
    );
  });

  test("a project with no Runner of its own is not told about a default yet", async () => {
    projectRows = [];

    const path: string = `/dashboard/${PROJECT_ID}/runbooks/runners`;
    goTo(path);
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <RunnersPage
            pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    await screen.findByTestId("runbook-agents-table-no-items", {}, WAIT);

    expect(screen.queryByTestId("project-default-runner-hint")).toBeNull();
  });
});

describe("Set as Project Default", () => {
  test("is in the ⋯ menu of every Runner but the default, whose menu stops using it instead", async () => {
    await openRunnersPage();

    const officeMenu: HTMLElement = await openMenu("office-runner");

    expect(
      menuItem(officeMenu, ProjectDefaultRunnerCopy.setDefaultTitle),
    ).not.toBeNull();
    expect(
      menuItem(officeMenu, ProjectDefaultRunnerCopy.stopDefaultTitle),
    ).toBeNull();

    fireEvent.keyDown(officeMenu, { key: "Escape" });
    cleanup();

    await openRunnersPage();

    const defaultMenu: HTMLElement = await openMenu("prod-eu-west-1");

    expect(
      menuItem(defaultMenu, ProjectDefaultRunnerCopy.setDefaultTitle),
    ).toBeNull();
    expect(
      menuItem(defaultMenu, ProjectDefaultRunnerCopy.stopDefaultTitle),
    ).not.toBeNull();
  });

  test("asks first, naming the Runner that is the default now and that this one is not connected, then writes the one Runner", async () => {
    await openRunnersPage();

    fireEvent.click(
      menuItem(
        await openMenu("office-runner"),
        ProjectDefaultRunnerCopy.setDefaultTitle,
      )!,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveAccessibleName(
      "Make office-runner the project default?",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description").textContent,
    ).toBe(
      "Runbook steps that pick no Runner, and AI in the code repositories that pick none, will run on it instead of prod-eu-west-1.",
    );
    /*
     * The Runner is not connected: said as a warning of its own, under what
     * moves - not run into its sentence.
     */
    const warning: HTMLElement = within(dialog).getByTestId(
      PROJECT_DEFAULT_NOT_CONNECTED_WARNING_TEST_ID,
    );
    expect(warning).toHaveTextContent(
      "office-runner is not connected right now, so the steps that run on it fail until it is.",
    );
    expect(warning).toHaveAttribute("role", "alert");
    expect(
      within(dialog).getByTestId("confirm-modal-description").contains(warning),
    ).toBe(false);
    // Nothing is written until it is confirmed.
    expect(runnerWrites).toEqual([]);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: ProjectDefaultRunnerCopy.makeDefaultConfirmButton,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);

    expect(runnerWrites).toEqual([
      { id: OFFICE_ID, data: { isProjectDefault: true } },
    ]);

    // The list is read again: the pill moved, as the server moved the default.
    await waitFor(() => {
      expect(
        within(row("office-runner")).queryByTestId(
          "runner-project-default-pill",
        ),
      ).not.toBeNull();
    }, WAIT);
    expect(
      within(row("prod-eu-west-1")).queryByTestId(
        "runner-project-default-pill",
      ),
    ).toBeNull();
  });

  test("with no default yet, the dialog says the steps on the Global Runner move", async () => {
    projectRows = [makeRunner(OFFICE_ID, "office-runner")];

    await openRunnersPage();

    fireEvent.click(
      menuItem(
        await openMenu("office-runner"),
        ProjectDefaultRunnerCopy.setDefaultTitle,
      )!,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    // Connected: nothing more to say.
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(ProjectDefaultRunnerCopy.makeDefaultConfirmDescription);
    expect(dialog).not.toHaveTextContent("not connected");
    expect(
      within(dialog).queryByTestId(
        PROJECT_DEFAULT_NOT_CONNECTED_WARNING_TEST_ID,
      ),
    ).toBeNull();
  });

  test("Cancel writes nothing", async () => {
    await openRunnersPage();

    fireEvent.click(
      menuItem(
        await openMenu("office-runner"),
        ProjectDefaultRunnerCopy.setDefaultTitle,
      )!,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    expect(runnerWrites).toEqual([]);
  });

  test("a refusal stays in the dialog, saying why, and nothing moves", async () => {
    updateFails = true;

    await openRunnersPage();

    fireEvent.click(
      menuItem(
        await openMenu("office-runner"),
        ProjectDefaultRunnerCopy.setDefaultTitle,
      )!,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: ProjectDefaultRunnerCopy.makeDefaultConfirmButton,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "You do not have permission to do this.",
      );
    }, WAIT);
    expect(
      within(row("prod-eu-west-1")).getByTestId("runner-project-default-pill"),
    ).toBeInTheDocument();
  });

  test.each([
    [
      "the Kubernetes agent chart's in-cluster Runner",
      { name: "kubernetes-agent/prod-us" },
      ProjectDefaultRunnerRefusal.KubernetesAgentRunner,
    ],
    [
      "a Runner with Runs Runbooks off",
      { name: "paused-runner", canRunRunbooks: false },
      ProjectDefaultRunnerRefusal.DoesNotRunRunbooks,
    ],
  ])(
    "is locked on %s, saying why",
    async (
      _label: string,
      overrides: Record<string, unknown>,
      refusal: ProjectDefaultRunnerRefusal,
    ) => {
      projectRows = [
        makeRunner(AGENT_ID, overrides["name"] as string, overrides),
      ];

      await openRunnersPage(overrides["name"] as string);

      const item: HTMLElement | null = menuItem(
        await openMenu(overrides["name"] as string),
        ProjectDefaultRunnerCopy.setDefaultTitle,
      );

      expect(item).not.toBeNull();
      expect(item).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(item!);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(PROJECT_DEFAULT_REFUSAL_TEXT[refusal].length).toBeGreaterThan(0);
    },
  );

  test("is locked for someone who may read Runners but not edit them", async () => {
    allow([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.RunbookViewer,
      Permission.ReadRunner,
    ]);

    await openRunnersPage();

    const menu: HTMLElement = await openMenu("office-runner");
    const item: HTMLElement | null = menuItem(
      menu,
      ProjectDefaultRunnerCopy.setDefaultTitle,
    );

    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Stop Using as Project Default", () => {
  test("asks first, saying where the steps go, then clears the one Runner's column", async () => {
    await openRunnersPage();

    fireEvent.click(
      menuItem(
        await openMenu("prod-eu-west-1"),
        ProjectDefaultRunnerCopy.stopDefaultTitle,
      )!,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveAccessibleName(
      "Stop using prod-eu-west-1 as the project default?",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(ProjectDefaultRunnerCopy.stopDefaultConfirmDescription);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: ProjectDefaultRunnerCopy.stopDefaultConfirmButton,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);

    expect(runnerWrites).toEqual([
      { id: PROD_ID, data: { isProjectDefault: false } },
    ]);

    // No default now: the card says one can be made, and the global card is back.
    await waitFor(() => {
      expect(screen.getByTestId("project-default-runner-hint")).toBeVisible();
    }, WAIT);
    expect(defaultReads).toBeGreaterThanOrEqual(2);
  });
});
