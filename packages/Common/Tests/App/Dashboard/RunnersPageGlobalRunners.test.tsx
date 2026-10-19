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
import GlobalRunnersCopy, {
  ADMIN_GLOBAL_RUNNERS_ROUTE,
  USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersCopy";
import { GLOBAL_RUNNERS_TABLE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersTable";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getColumnBooleanDefault } from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Runbooks -> Runners, with and without global Runners - the Runners
 * OneUptime runs for every project.
 *
 * Read like Monitors -> Settings -> Probes: the global Runners on top,
 * read-only; the project's own below as Custom Runners, with Create Runner;
 * then the project's one switch, "Use global Runners", on by default and
 * asking before it is turned off. A server with no global Runner shows the
 * project's own Runners only, as the page always did, and tells a master
 * admin where global Runners are added. With no Runner of its own, the page
 * says in one sentence why to add one - never "No Runners yet".
 *
 * The real page, tables, switch and dialog are rendered; only the model API
 * and the permission snapshot are stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

const GLOBAL_EU_ID: string = "77777777-0000-4000-8000-000000000001";
const GLOBAL_US_ID: string = "77777777-0000-4000-8000-000000000002";
const OWN_RUNNER_ID: string = "77777777-0000-4000-8000-000000000003";

function makeRunner(id: string, name: string, lastAlive?: Date): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: `${name} description`,
    key: "runner-key",
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
    ...(lastAlive ? { lastAlive } : {}),
  });
}

let globalRows: Array<Runner> = [];
let projectRows: Array<Runner> = [];
let globalReadFails: boolean = false;
let storedProject: Record<string, unknown> = {};

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  requestOptions?: { overrideRequestUrl?: unknown } | undefined;
}

let listCalls: Array<ListCall> = [];
let projectReads: Array<Record<string, unknown>> = [];
let projectWrites: Array<Record<string, unknown>> = [];

function readsGlobalRunners(call: ListCall): boolean {
  return String(call.requestOptions?.overrideRequestUrl || "").endsWith(
    GLOBAL_RUNNERS_ROUTE,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();

  globalRows = [
    makeRunner(GLOBAL_EU_ID, "global-eu", new Date()),
    makeRunner(GLOBAL_US_ID, "global-us"),
  ];
  projectRows = [makeRunner(OWN_RUNNER_ID, "bash-runner", new Date())];
  globalReadFails = false;
  storedProject = { useGlobalRunners: true };
  listCalls = [];
  projectReads = [];
  projectWrites = [];

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
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      const call: ListCall = args as ListCall;
      listCalls.push(call);

      let data: Array<Runner> = [];

      if (readsGlobalRunners(call)) {
        if (globalReadFails) {
          throw new Error("This server cannot list global Runners.");
        }

        data = globalRows;
      } else if (call.modelType === Runner) {
        data = projectRows;
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
      const call: {
        modelType: unknown;
        id: unknown;
        select: Record<string, unknown>;
      } = args as {
        modelType: unknown;
        id: unknown;
        select: Record<string, unknown>;
      };

      if (call.modelType === Project) {
        projectReads.push(call.select);
        const project: Project = new Project();
        project._id = PROJECT_ID;
        Object.assign(project, storedProject);
        return project as never;
      }

      return null as never;
    });

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const data: Record<string, unknown> = (
        args as { data: Record<string, unknown> }
      ).data;
      projectWrites.push(data);
      Object.assign(storedProject, data);
      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openRunnersPage(): void {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/runners`;
  goTo(path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <RunnersPage
        pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

// The card a heading belongs to.
function cardTitled(title: string): HTMLElement {
  const card: HTMLElement | null = screen
    .getByText(title, { exact: true })
    .closest('[data-testid="card"]');

  if (!card) {
    throw new Error(`"${title}" is not a card's title.`);
  }

  return card as HTMLElement;
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function pageText(): string {
  return document.body.textContent || "";
}

/*
 * An empty table is headed with its message's first sentence, without the
 * full stop; the rest of the message, or else the card's description, is
 * said under it, over the table's Create button.
 */
function headlineOf(message: string): string {
  return message.split(". ")[0]!.replace(/\.$/, "");
}

// The switch's line: what the position means, then the note.
function switchLine(isOn: boolean): string {
  return `${
    isOn
      ? GlobalRunnersCopy.switchOnDescription
      : GlobalRunnersCopy.switchOffDescription
  } ${GlobalRunnersCopy.switchNote}`;
}

describe("Runbooks -> Runners, on a server with global Runners", () => {
  test("lists the global Runners first, read-only, then the project's own as Custom Runners", async () => {
    openRunnersPage();

    await screen.findByText("global-eu", {}, { timeout: WAIT_TIMEOUT });
    await screen.findByText("bash-runner", {}, { timeout: WAIT_TIMEOUT });

    const globalCard: HTMLElement = cardTitled(
      GlobalRunnersCopy.globalCardTitle,
    );
    const customCard: HTMLElement = cardTitled(
      GlobalRunnersCopy.customCardTitle,
    );

    // The global ones, with how each is doing.
    expect(within(globalCard).getByText("global-eu")).toBeInTheDocument();
    expect(within(globalCard).getByText("global-us")).toBeInTheDocument();
    expect(within(globalCard).getByText("Connected")).toBeInTheDocument();
    expect(within(globalCard).getByText("Never connected")).toBeInTheDocument();
    expect(globalCard).toHaveTextContent(
      GlobalRunnersCopy.globalCardDescription,
    );

    // Nobody in a project creates, opens or deletes a global Runner.
    expect(within(globalCard).queryByText("Create Runner")).toBeNull();
    expect(
      within(globalCard).queryByTestId("row-actions-more-button"),
    ).toBeNull();
    expect(within(globalCard).queryByText("View")).toBeNull();
    expect(within(globalCard).queryByText("bash-runner")).toBeNull();

    // The project's own: what they are for, and Create Runner.
    expect(customCard).toHaveTextContent(
      GlobalRunnersCopy.customCardDescription,
    );
    expect(within(customCard).getByText("bash-runner")).toBeInTheDocument();
    expect(within(customCard).getByText("Create Runner")).toBeInTheDocument();
    expect(within(customCard).queryByText("global-eu")).toBeNull();

    // Global first, then custom, then the switch.
    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(isBefore(globalCard, customCard)).toBe(true);
    expect(isBefore(customCard, control)).toBe(true);
    expect(pageText()).not.toContain("No Runners yet");
  });

  test("reads the global Runners from their own route, and the project's own by the project", async () => {
    openRunnersPage();

    await screen.findByText("global-eu", {}, { timeout: WAIT_TIMEOUT });
    await screen.findByText("bash-runner", {}, { timeout: WAIT_TIMEOUT });

    const globalReads: Array<ListCall> = listCalls.filter(readsGlobalRunners);
    const ownReads: Array<ListCall> = listCalls.filter((call: ListCall) => {
      return call.modelType === Runner && !readsGlobalRunners(call);
    });

    expect(globalReads.length).toBeGreaterThan(0);
    expect(ownReads.length).toBeGreaterThan(0);

    for (const call of globalReads) {
      expect(call.modelType).toBe(Runner);
      expect(call.query["projectId"]).toBeUndefined();
    }

    for (const call of ownReads) {
      expect(String(call.query["projectId"])).toBe(PROJECT_ID);
    }
  });

  test("a project with no Runner of its own reads why to add one, never No Runners yet", async () => {
    projectRows = [];

    openRunnersPage();

    const empty: HTMLElement = await screen.findByTestId(
      "runbook-agents-table-no-items",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    // "Add a Runner of your own", over what one is for, and Create Runner.
    expect(empty).toHaveTextContent(
      headlineOf(GlobalRunnersCopy.customEmptyMessage),
    );
    expect(empty).toHaveTextContent(GlobalRunnersCopy.customCardDescription);
    expect(
      within(empty).getByTestId("empty-table-create-button"),
    ).toHaveTextContent("Create Runner");
    expect(screen.getByText("global-eu")).toBeInTheDocument();
    expect(pageText()).not.toContain("No Runners yet");
  });

  test("the switch starts on, as the project column does", async () => {
    // A project that never touched it: the column's default, on.
    storedProject = {};

    openRunnersPage();

    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(projectReads).toContainEqual({ useGlobalRunners: true });
    expect(
      screen.getByRole("switch", { name: GlobalRunnersCopy.switchTitle }),
    ).toBe(control);
    expect(cardTitled(GlobalRunnersCopy.switchCardTitle)).toHaveTextContent(
      switchLine(true),
    );
    expect(cardTitled(GlobalRunnersCopy.switchCardTitle)).toHaveTextContent(
      GlobalRunnersCopy.switchCardDescription,
    );
    // The column's own default, which a new project starts with.
    expect(getColumnBooleanDefault(new Project(), "useGlobalRunners")).toBe(
      true,
    );
  });

  test("turning it off asks first, with a red button, then saves and says so on the global card", async () => {
    openRunnersPage();

    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(control);
    await flush();

    expect(projectWrites).toEqual([]);

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName(GlobalRunnersCopy.turnOffTitle);
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(GlobalRunnersCopy.turnOffDescription);

    const confirm: HTMLElement = within(dialog).getByRole("button", {
      name: GlobalRunnersCopy.turnOffButton,
    });

    expect(confirm).toHaveClass("bg-red-600");

    fireEvent.click(confirm);
    await flush();

    expect(projectWrites).toEqual([{ useGlobalRunners: false }]);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(cardTitled(GlobalRunnersCopy.switchCardTitle)).toHaveTextContent(
      switchLine(false),
    );

    // The global card says the project does not use them any more.
    await waitFor(
      () => {
        expect(cardTitled(GlobalRunnersCopy.globalCardTitle)).toHaveTextContent(
          GlobalRunnersCopy.globalCardDescriptionWhenOff,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("cancelling keeps them on", async () => {
    openRunnersPage();

    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(control);
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(projectWrites).toEqual([]);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("a project that turned them off sees so, and turning them back on saves at once", async () => {
    storedProject = { useGlobalRunners: false };

    openRunnersPage();

    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-checked", "false");
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(cardTitled(GlobalRunnersCopy.globalCardTitle)).toHaveTextContent(
          GlobalRunnersCopy.globalCardDescriptionWhenOff,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(projectWrites).toEqual([{ useGlobalRunners: true }]);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("the switch is locked for someone who may not edit the project", async () => {
    // A member who may read Runners but not edit the project.
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.ProjectMember,
      ]);

    openRunnersPage();

    const control: HTMLElement = await screen.findByTestId(
      USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-disabled", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(projectWrites).toEqual([]);
  });
});

describe("Runbooks -> Runners, on a server with no global Runner", () => {
  beforeEach(() => {
    globalRows = [];
  });

  test("shows the project's own Runners only, as Runners, with no switch", async () => {
    openRunnersPage();

    await screen.findByText("bash-runner", {}, { timeout: WAIT_TIMEOUT });

    const card: HTMLElement = cardTitled(GlobalRunnersCopy.onlyCardTitle);

    expect(card).toHaveTextContent(GlobalRunnersCopy.onlyCardDescription);
    expect(within(card).getByText("Create Runner")).toBeInTheDocument();
    expect(
      screen.queryByText(GlobalRunnersCopy.globalCardTitle, { exact: true }),
    ).toBeNull();
    expect(
      screen.queryByText(GlobalRunnersCopy.customCardTitle, { exact: true }),
    ).toBeNull();
    expect(document.getElementById(GLOBAL_RUNNERS_TABLE_ID)).toBeNull();
    expect(screen.queryByTestId(USE_GLOBAL_RUNNERS_SWITCH_TEST_ID)).toBeNull();
    expect(screen.queryByTestId("add-global-runners-hint")).toBeNull();
    // Nothing reads the project's switch when there is nothing to switch.
    expect(projectReads).toEqual([]);
  });

  test("a project with no Runner reads why to add one, never No Runners yet", async () => {
    projectRows = [];

    openRunnersPage();

    const empty: HTMLElement = await screen.findByTestId(
      "runbook-agents-table-no-items",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    // "Add a Runner to run your runbook steps", then how.
    expect(empty).toHaveTextContent(
      headlineOf(GlobalRunnersCopy.onlyEmptyMessage),
    );
    expect(empty).toHaveTextContent(
      "Create one, then run the Docker command on a host inside your infrastructure.",
    );
    expect(
      within(empty).getByTestId("empty-table-create-button"),
    ).toHaveTextContent("Create Runner");
    expect(pageText()).not.toContain("No Runners yet");
  });

  test("a master admin is told where global Runners are added", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);

    openRunnersPage();

    const hint: HTMLElement = await screen.findByTestId(
      "add-global-runners-hint",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(hint).toHaveTextContent(GlobalRunnersCopy.addGlobalRunnersHint);

    const link: HTMLElement = within(hint).getByText(
      GlobalRunnersCopy.addGlobalRunnersLink,
    );
    const anchor: HTMLAnchorElement | null = link.closest("a");

    expect(anchor).not.toBeNull();
    const href: string = anchor!.getAttribute("href") || "";
    expect({
      href,
      endsWithRoute: href.endsWith(ADMIN_GLOBAL_RUNNERS_ROUTE),
    }).toEqual({ href, endsWithRoute: true });
    expect(anchor!.getAttribute("target")).toBe("_blank");
    expect(ADMIN_GLOBAL_RUNNERS_ROUTE).toBe("/settings/global-runners");
  });

  test("a server that cannot list global Runners shows the project's own all the same", async () => {
    globalRows = [makeRunner(GLOBAL_EU_ID, "global-eu", new Date())];
    globalReadFails = true;

    openRunnersPage();

    await screen.findByText("bash-runner", {}, { timeout: WAIT_TIMEOUT });

    expect(cardTitled(GlobalRunnersCopy.onlyCardTitle)).toBeInTheDocument();
    expect(screen.queryByText("global-eu")).toBeNull();
    expect(screen.queryByTestId(USE_GLOBAL_RUNNERS_SWITCH_TEST_ID)).toBeNull();
  });
});
