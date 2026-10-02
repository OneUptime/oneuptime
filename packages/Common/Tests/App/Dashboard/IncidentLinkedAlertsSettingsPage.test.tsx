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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IncidentLinkedAlertsSettings, {
  LINKED_ALERTS_FIELDS,
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
 * of their own, on for new projects. The real page is rendered here with the
 * model API and the permission snapshot stubbed: what it shows, what it
 * reads, what a save writes, and who gets a working Update button (the
 * switches take Project Owner or Project Admin, narrower than the Project
 * table's own update list).
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

// A detail row's title, as ModelDetail renders it.
function detailTitle(title: string): HTMLElement {
  return screen.getByText(title, { selector: "label > span" });
}

// The value a detail row shows, by its title.
function detailValue(title: string): string {
  const row: HTMLElement | null =
    detailTitle(title).closest("div.space-y-1")?.parentElement || null;
  return row?.textContent || "";
}

async function expectValues(
  acknowledge: string,
  resolve: string,
): Promise<void> {
  await waitFor(
    () => {
      expect(detailValue(ACKNOWLEDGE_SWITCH)).toContain(acknowledge);
      expect(detailValue(RESOLVE_SWITCH)).toContain(resolve);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

// The card's Update buttons, as buttons.
async function updateButtons(): Promise<Array<HTMLElement>> {
  const linkedAlertsCard: HTMLElement = await card();
  await within(linkedAlertsCard).findByText(
    "Update",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  return within(linkedAlertsCard)
    .getAllByText("Update")
    .map((text: HTMLElement): HTMLElement => {
      return text.closest("button") as HTMLElement;
    });
}

async function openEditModal(): Promise<HTMLElement> {
  const buttons: Array<HTMLElement> = await updateButtons();
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  return await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT });
}

/*
 * A form switch by its field title. The accessible name is the field label,
 * which also carries "(Optional)" for a field that is not required.
 */
function switchName(title: string): RegExp {
  return new RegExp(
    `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(Optional\\))?$`,
  );
}

async function waitForSwitch(
  dialog: HTMLElement,
  name: string,
  checked: boolean,
): Promise<HTMLElement> {
  const toggle: HTMLElement = await within(dialog).findByRole(
    "switch",
    { name: switchName(name) },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(toggle).toHaveAttribute("aria-checked", String(checked));
    },
    { timeout: WAIT_TIMEOUT },
  );
  return toggle;
}

async function save(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  await waitFor(
    () => {
      expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function postedProject(): Project {
  return (createOrUpdateSpy.mock.calls[0]![0] as { model: Project }).model;
}

/*
 * The Project columns a saved model carries a value for, sorted, leaving
 * out its id: the columns the save writes.
 */
function writtenColumns(model: Project): Array<string> {
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  return Object.keys(values)
    .filter((key: string): boolean => {
      return (
        key !== "_id" && model.isTableColumn(key) && values[key] !== undefined
      );
    })
    .sort();
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

  test("is not the More Settings page any more", () => {
    expect(
      (RouteMap[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS] as Route).toString(),
    ).not.toBe((RouteMap[PageMap.INCIDENTS_SETTINGS_MORE] as Route).toString());
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

    await expectValues("Yes", "Yes");
  });

  test("a project that turned them off shows No for each", async () => {
    project.acknowledgeLinkedAlertsWhenIncidentAcknowledged = false;
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    await expectValues("No", "No");
  });

  test("shows each switch's own value", async () => {
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    await expectValues("Yes", "No");
  });

  test("holds nothing but the two switches - the number prefixes stay where they were", async () => {
    openPage();

    await expectValues("Yes", "Yes");

    const linkedAlertsCard: HTMLElement = await card();
    expect(
      Array.from(linkedAlertsCard.querySelectorAll("label > span")).map(
        (title: Element): string => {
          return title.textContent || "";
        },
      ),
    ).toEqual([ACKNOWLEDGE_SWITCH, RESOLVE_SWITCH]);
    expect(linkedAlertsCard.textContent || "").not.toMatch(/Number Prefix/);
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

  test("the edit form holds the two switches, showing the project's values", async () => {
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    const dialog: HTMLElement = await openEditModal();

    await waitForSwitch(dialog, ACKNOWLEDGE_SWITCH, true);
    await waitForSwitch(dialog, RESOLVE_SWITCH, false);
    expect(within(dialog).getAllByRole("switch")).toHaveLength(2);

    // What each switch does, in the form.
    expect(
      within(dialog).getByText(
        /This stops those alerts' on-call escalations\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /except alerts that are still linked to another incident that is not resolved yet/,
      ),
    ).toBeInTheDocument();
  });

  test("a project owner turns the acknowledge switch off and saves exactly the two switches", async () => {
    openPage();

    const dialog: HTMLElement = await openEditModal();
    const acknowledge: HTMLElement = await waitForSwitch(
      dialog,
      ACKNOWLEDGE_SWITCH,
      true,
    );
    await waitForSwitch(dialog, RESOLVE_SWITCH, true);

    fireEvent.click(acknowledge);
    await save(dialog);

    const posted: Project = postedProject();
    expect(posted.acknowledgeLinkedAlertsWhenIncidentAcknowledged).toBe(false);
    expect(posted.resolveLinkedAlertsWhenIncidentResolved).toBe(true);
    // Nothing else on the project rides along - the number prefixes least of all.
    expect(writtenColumns(posted)).toEqual([...SWITCH_COLUMNS].sort());
    expect(posted.incidentNumberPrefix).toBeUndefined();
    expect(String(posted._id)).toBe(PROJECT_ID);
  });

  test("a project that turned them off turns them back on the same way", async () => {
    project.acknowledgeLinkedAlertsWhenIncidentAcknowledged = false;
    project.resolveLinkedAlertsWhenIncidentResolved = false;
    openPage();

    const dialog: HTMLElement = await openEditModal();
    fireEvent.click(await waitForSwitch(dialog, ACKNOWLEDGE_SWITCH, false));
    fireEvent.click(await waitForSwitch(dialog, RESOLVE_SWITCH, false));
    await save(dialog);

    const posted: Project = postedProject();
    expect(posted.acknowledgeLinkedAlertsWhenIncidentAcknowledged).toBe(true);
    expect(posted.resolveLinkedAlertsWhenIncidentResolved).toBe(true);
    expect(writtenColumns(posted)).toEqual([...SWITCH_COLUMNS].sort());
  });
});

describe("who may change the switches", () => {
  test("the card is gated on exactly the two columns it writes", () => {
    expect(LINKED_ALERTS_FIELDS).toEqual(SWITCH_COLUMNS);
    expect(getProjectColumnsUpdatePermissions(LINKED_ALERTS_FIELDS)).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test("is narrower than the Project table's update list", () => {
    // Why the card cannot rely on CardModelDetail's table-level gate.
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

  test("the locked button's reason names the permissions", () => {
    expect(getProjectColumnsPermissionMessage(LINKED_ALERTS_FIELDS)).toBe(
      "Changing these needs one of these permissions: Project Owner, Project Admin.",
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s gets a working Update button",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).not.toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(
        await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT }),
      ).toBeInTheDocument();
    },
  );

  test("a master admin gets a working Update button", async () => {
    grant([], true);
    openPage();

    const buttons: Array<HTMLElement> = await updateButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBeDisabled();
  });

  /*
   * The Project table's update list lets these two in, but the columns do
   * not: the card's own gate would give them a save the server refuses.
   */
  test.each([[Permission.EditProject], [Permission.ManageProjectBilling]])(
    "%s sees the Update button locked, and clicking it opens nothing",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();
    },
  );

  test.each([[Permission.ProjectMember], [Permission.Viewer]])(
    "%s reads the switches behind a locked button",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      await expectValues("Yes", "Yes");

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toBeDisabled();
    },
  );

  test("offers no button before the permission snapshot has landed", async () => {
    grant([]);
    openPage();

    const linkedAlertsCard: HTMLElement = await card();
    await findText(CARD_DESCRIPTION);
    expect(
      within(linkedAlertsCard).queryByText("Update"),
    ).not.toBeInTheDocument();
  });
});
