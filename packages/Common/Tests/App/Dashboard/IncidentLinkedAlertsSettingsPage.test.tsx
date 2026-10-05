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
import IncidentLinkedAlertsSettings, {
  LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID,
  LINKED_ALERTS_FIELDS,
  LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID,
  LINKED_ALERTS_SWITCHES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentLinkedAlertsSettings";
import {
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  IncidentsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * Incidents → Settings → Linked Alerts.
 *
 * The maintainer, looking at the "Linked Alerts" card on More Settings with
 * both switches showing No: "This should be true by default. Can you please
 * move it to a new page called Linked Alerts? That should be one of the
 * pages in Settings."
 *
 * So the two switches - acknowledge linked alerts when the incident is
 * acknowledged, resolve them when it is resolved - now have a Settings page
 * of their own, on for new projects. Each is a switch that saves the moment
 * it is flipped, as the AI behaviours beside it are (they used to sit behind
 * an Update button and a dialog). The real page is rendered here with the
 * model API and the permission snapshot stubbed: what it shows, what it
 * reads, what a flip writes, and who may flip them (the switches take
 * Project Owner or Project Admin, narrower than the Project table's own
 * update list).
 */

const WAIT_TIMEOUT: number = 20000;

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/incidents/settings/linked-alerts`;

const CARD_TITLE: string = "Linked Alerts";
const CARD_DESCRIPTION: string =
  "Choose whether the alerts linked to an incident follow it when the incident is acknowledged or resolved. Both are on for new projects. Alerts are never moved back to an earlier state, and reopening an incident does not reopen its alerts.";

const ACKNOWLEDGE_SWITCH: string =
  "Acknowledge Linked Alerts When Incident Is Acknowledged";
const RESOLVE_SWITCH: string =
  "Resolve Linked Alerts When Incident Is Resolved";

const SWITCH_COLUMNS: Array<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>, isMasterAdmin?: boolean): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(Boolean(isMasterAdmin));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
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
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function openPage(): void {
  goTo(PAGE_PATH);
  render(
    <MemoryRouter initialEntries={[PAGE_PATH]}>
      <IncidentLinkedAlertsSettings
        pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

async function card(): Promise<HTMLElement> {
  return (await findText(CARD_TITLE)).closest(
    '[data-testid="card"]',
  ) as HTMLElement;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function acknowledgeSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

async function resolveSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

// Where the two switches are, once the project is read.
async function expectSwitches(
  acknowledge: boolean,
  resolve: boolean,
): Promise<void> {
  expect(await acknowledgeSwitch()).toHaveAttribute(
    "aria-checked",
    String(acknowledge),
  );
  expect(await resolveSwitch()).toHaveAttribute(
    "aria-checked",
    String(resolve),
  );
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

// Every update a flip sent, as the columns and values it wrote.
function updates(): Array<Record<string, unknown>> {
  return updateByIdSpy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  // A new project: both switches on, as the column defaults now make them.
  project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    acknowledgeLinkedAlertsWhenIncidentAcknowledged: true,
    resolveLinkedAlertsWhenIncidentResolved: true,
    incidentNumberPrefix: "INC-",
  });

  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  updateByIdSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (): Promise<never> => {
      return {} as never;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("where the page lives", () => {
  test("is a Settings page at incidents/settings/linked-alerts", () => {
    expect(IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS]).toBe(
      "settings/linked-alerts",
    );
    expect(
      (RouteMap[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS] as Route).toString(),
    ).toBe("/dashboard/:projectId/incidents/settings/linked-alerts");
  });

  /*
   * The switches used to sit on More Settings, next to the number prefixes.
   * More Settings is gone: the prefixes have a Number Prefix page of their own.
   */
  test("is neither the old More Settings page nor the Number Prefix page", () => {
    const route: string = (
      RouteMap[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS] as Route
    ).toString();

    expect(route).not.toBe("/dashboard/:projectId/incidents/settings/more");
    expect(route).not.toBe(
      (RouteMap[PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX] as Route).toString(),
    );
  });

  test("has a breadcrumb trail naming Settings, then Linked Alerts", () => {
    goTo(PAGE_PATH);

    const trail: Array<Link> | undefined = getIncidentsBreadcrumbs(
      "/dashboard/:projectId/incidents/settings/linked-alerts",
    );

    expect(
      (trail || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Incidents", "Settings", "Linked Alerts"]);

    for (const link of trail || []) {
      expect(link.to.toString()).not.toContain(":");
    }
    expect(trail?.[trail.length - 1]?.to.toString()).toBe(PAGE_PATH);
  });
});

describe("Incidents → Settings → Linked Alerts", () => {
  test("shows one card, Linked Alerts, with what the switches do", async () => {
    openPage();

    expect(await findText(CARD_TITLE)).toBeInTheDocument();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  test("says both are on for new projects, never that they are off by default", async () => {
    openPage();

    const linkedAlertsCard: HTMLElement = await card();

    expect(linkedAlertsCard.textContent || "").toContain(
      "Both are on for new projects.",
    );
    expect(linkedAlertsCard.textContent || "").not.toMatch(/off by default/i);
  });

  test("a new project shows both switches on", async () => {
    openPage();

    await expectSwitches(true, true);
  });

  test("a project that turned them off shows each off", async () => {
    project.acknowledgeLinkedAlertsWhenIncidentAcknowledged = false;
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    await expectSwitches(false, false);
  });

  test("shows each switch's own value", async () => {
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    await expectSwitches(true, false);
  });

  test("holds nothing but the two switches - the number prefixes stay where they were", async () => {
    openPage();
    await expectSwitches(true, true);

    const linkedAlertsCard: HTMLElement = await card();

    expect(within(linkedAlertsCard).getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: ACKNOWLEDGE_SWITCH })).toBe(
      await acknowledgeSwitch(),
    );
    expect(screen.getByRole("switch", { name: RESOLVE_SWITCH })).toBe(
      await resolveSwitch(),
    );
    expect(
      within(screen.getByTestId(LINKED_ALERTS_SWITCHES_TEST_ID)).getAllByRole(
        "switch",
      ),
    ).toHaveLength(2);
    expect(linkedAlertsCard.textContent || "").not.toMatch(/Number Prefix/);
  });

  test("the switches are the setting: no Update button, no dialog", async () => {
    openPage();
    await expectSwitches(true, true);

    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("reads the project it is on, and only the two switches", async () => {
    openPage();
    await findText(CARD_TITLE);

    await waitFor(
      () => {
        expect(getItemSpy.mock.calls.length).toBeGreaterThan(0);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const call: { id?: unknown; select?: Record<string, unknown> } = getItemSpy
      .mock.calls[0]![0] as {
      id?: unknown;
      select?: Record<string, unknown>;
    };

    expect(String(call.id)).toBe(PROJECT_ID);
    for (const column of SWITCH_COLUMNS) {
      expect(call.select).toHaveProperty(column);
    }
    for (const column of Object.keys(call.select || {})) {
      expect(["_id", ...SWITCH_COLUMNS]).toContain(column);
    }
  });

  test("each switch says what it does", async () => {
    openPage();
    await expectSwitches(true, true);

    expect(
      screen.getByTestId(`${LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent(/This stops those alerts' on-call escalations\./);
    expect(
      screen.getByTestId(`${LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent(
      /except alerts that are still linked to another incident that is not resolved yet/,
    );
  });

  test("a project owner turns the acknowledge switch off, and exactly that column is saved", async () => {
    openPage();

    const acknowledge: HTMLElement = await acknowledgeSwitch();
    await press(acknowledge);

    expect(updates()).toEqual([
      { acknowledgeLinkedAlertsWhenIncidentAcknowledged: false },
    ]);
    expect(
      String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(PROJECT_ID);
    expect(
      (updateByIdSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Project);
    expect(acknowledge).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId(`${LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
    // Nothing else on the project rides along - the number prefixes least of all.
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
    expect(await resolveSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("a project that turned them off turns them back on, one flip each", async () => {
    project.acknowledgeLinkedAlertsWhenIncidentAcknowledged = false;
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    await press(await acknowledgeSwitch());
    await press(await resolveSwitch());

    expect(updates()).toEqual([
      { acknowledgeLinkedAlertsWhenIncidentAcknowledged: true },
      { resolveLinkedAlertsWhenIncidentResolved: true },
    ]);
  });

  test("a flip the server refuses moves the switch back, with why", async () => {
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("You do not have permission to update this Project.");
    });
    openPage();

    const resolve: HTMLElement = await resolveSwitch();
    await press(resolve);

    expect(resolve).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`${LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent("You do not have permission to update this Project.");
  });
});

describe("who may change the switches", () => {
  test("the switches are the two columns the page names", () => {
    expect(LINKED_ALERTS_FIELDS).toEqual(SWITCH_COLUMNS);
    expect(getProjectColumnsUpdatePermissions(LINKED_ALERTS_FIELDS)).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test("is narrower than the Project table's update list", () => {
    // Why each switch is gated on its column, not on the table.
    expect(new Project().getUpdatePermissions()).toEqual(
      expect.arrayContaining([
        Permission.EditProject,
        Permission.ManageProjectBilling,
      ]),
    );
    expect(
      getProjectColumnsUpdatePermissions(LINKED_ALERTS_FIELDS),
    ).not.toContain(Permission.EditProject);
    expect(
      getProjectColumnsUpdatePermissions(LINKED_ALERTS_FIELDS),
    ).not.toContain(Permission.ManageProjectBilling);
  });

  test("the permissions they need, named the way a locked card names them", () => {
    expect(getProjectColumnsPermissionMessage(LINKED_ALERTS_FIELDS)).toBe(
      "Changing these needs one of these permissions: Project Owner, Project Admin.",
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s may flip both",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      expect(await acknowledgeSwitch()).not.toHaveAttribute("aria-disabled");
      expect(await resolveSwitch()).not.toHaveAttribute("aria-disabled");

      await press(await resolveSwitch());
      expect(updates()).toEqual([
        { resolveLinkedAlertsWhenIncidentResolved: false },
      ]);
    },
  );

  test("a master admin may flip both", async () => {
    grant([], true);
    openPage();

    expect(await acknowledgeSwitch()).not.toHaveAttribute("aria-disabled");
    expect(await resolveSwitch()).not.toHaveAttribute("aria-disabled");
  });

  /*
   * The Project table's update list lets these two in, but the columns do
   * not: the switches are locked, and say which permissions they need.
   */
  test.each([[Permission.EditProject], [Permission.ManageProjectBilling]])(
    "%s sees both switches locked, with the reason, and a press saves nothing",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      const acknowledge: HTMLElement = await acknowledgeSwitch();

      expect(acknowledge).toHaveAttribute("aria-disabled", "true");
      expect(await resolveSwitch()).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.getByTestId(`${LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID}-row`),
      ).toHaveTextContent("Project Owner, Project Admin");

      await press(acknowledge);
      expect(updateByIdSpy).not.toHaveBeenCalled();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();
    },
  );

  test.each([[Permission.ProjectMember], [Permission.Viewer]])(
    "%s reads the switches, locked",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      await expectSwitches(true, true);
      expect(await acknowledgeSwitch()).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    },
  );

  test("before the permission snapshot has landed they are locked, accusing nobody", async () => {
    grant([]);
    openPage();

    const acknowledge: HTMLElement = await acknowledgeSwitch();

    expect(acknowledge).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId(`${LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID}-row`),
    ).not.toHaveTextContent("You do not have permission");
  });
});
