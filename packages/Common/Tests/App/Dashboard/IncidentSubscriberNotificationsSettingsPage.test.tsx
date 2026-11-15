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
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IncidentSubscriberNotificationsSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSubscriberNotificationsSettings";
import {
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY,
  NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/NewIncidentNotifyDefaultCopy";
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
import { NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN } from "../../../Types/StatusPage/NewIncidentSubscriberNotificationDefault";
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
 * Incidents -> Settings -> Subscriber Notifications (#7606).
 *
 * The request: on Declare New Incident, "the 'Notify Status Page
 * Subscribers' checkbox is currently checked by default", so in the rush of
 * declaring a critical incident every status page subscriber can be told
 * before the team is ready. It offered two ways out: uncheck the box for
 * everyone, or "add a project or admin-level setting that allows
 * administrators to configure the default state of this checkbox". This is
 * the second: a project setting, so a team that wants the box ticked keeps
 * it, and one that does not turns it off once.
 *
 * The page is one card, "Subscriber Notifications", holding one switch -
 * "Notify status page subscribers by default" - that saves its Project
 * column the moment it is flipped. On for every project (the column
 * defaults to true, existing projects included), so nothing changes until a
 * project owner or admin turns it off. Each state says, in one sentence,
 * what subscribers get and what the person declaring does about it. Only a
 * project owner or admin may flip it. The real page is rendered with the
 * model API and the permission snapshot stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

const PATH: string = `/dashboard/${PROJECT_ID}/incidents/settings/subscriber-notifications`;
const ROUTE: string =
  "/dashboard/:projectId/incidents/settings/subscriber-notifications";
const COLUMN: string = NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN;
const SWITCH_TITLE: string = "Notify status page subscribers by default";
const CARD_DESCRIPTION: string =
  "Choose whether “Notify Status Page Subscribers” starts ticked when someone declares an incident.";
const ON_DESCRIPTION: string =
  "Status page subscribers are notified of a new incident unless whoever declares it unticks “Notify Status Page Subscribers”.";
const OFF_DESCRIPTION: string =
  "Status page subscribers are notified of a new incident only if whoever declares it ticks “Notify Status Page Subscribers”.";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
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
  goTo(PATH);

  render(
    <MemoryRouter initialEntries={[PATH]}>
      <IncidentSubscriberNotificationsSettings
        pageRoute={
          RouteMap[PageMap.INCIDENTS_SETTINGS_SUBSCRIBER_NOTIFICATIONS] as Route
        }
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function theSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

function theRow(): HTMLElement {
  return screen.getByTestId(
    `${NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID}-row`,
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

  // Every project, existing ones included: on, as the column default makes it.
  project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    [COLUMN]: true,
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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Incidents → Settings → Subscriber Notifications", () => {
  test("lives at settings/subscriber-notifications, with its own breadcrumb trail", () => {
    expect(
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SUBSCRIBER_NOTIFICATIONS],
    ).toBe("settings/subscriber-notifications");
    expect(
      (
        RouteMap[PageMap.INCIDENTS_SETTINGS_SUBSCRIBER_NOTIFICATIONS] as Route
      ).toString(),
    ).toBe(ROUTE);

    goTo(PATH);

    const trail: Array<Link> | undefined = getIncidentsBreadcrumbs(ROUTE);

    expect(
      (trail || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Incidents", "Settings", "Subscriber Notifications"]);
    expect(trail?.[trail.length - 1]?.to.toString()).toBe(PATH);
  });

  test("is one card, Subscriber Notifications, saying what it decides", async () => {
    openPage();

    expect(
      await screen.findByText(
        "Subscriber Notifications",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);

    // Once the project is read: the one switch.
    await theSwitch();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  test("the switch is on for a project that never changed it, and says what on means", async () => {
    openPage();

    const control: HTMLElement = await theSwitch();

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: SWITCH_TITLE })).toBe(control);
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
    expect(theRow()).not.toHaveTextContent(OFF_DESCRIPTION);
  });

  test("a project that holds no value yet reads as on, the column's default", async () => {
    project = Object.assign(new Project(), { _id: PROJECT_ID });
    openPage();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
  });

  test("a project that turned it off shows it off, and says what off means", async () => {
    (project as unknown as Record<string, unknown>)[COLUMN] = false;
    openPage();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(theRow()).toHaveTextContent(OFF_DESCRIPTION);
    expect(theRow()).not.toHaveTextContent(ON_DESCRIPTION);
  });

  test("reads the project it is on, and only its own column", async () => {
    openPage();
    await theSwitch();

    await waitFor(
      () => {
        expect(getItemSpy.mock.calls.length).toBeGreaterThan(0);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const call: {
      id?: unknown;
      modelType?: unknown;
      select?: Record<string, unknown>;
    } = getItemSpy.mock.calls[0]![0] as {
      id?: unknown;
      modelType?: unknown;
      select?: Record<string, unknown>;
    };

    expect(String(call.id)).toBe(PROJECT_ID);
    expect(call.modelType).toBe(Project);
    expect(call.select).toHaveProperty(COLUMN);
    for (const column of Object.keys(call.select || {})) {
      expect(["_id", COLUMN]).toContain(column);
    }
  });

  test("a project owner turns it off: exactly its column is saved, at once, with no dialog", async () => {
    openPage();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updates()).toEqual([{ [COLUMN]: false }]);
    expect(
      String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(PROJECT_ID);
    expect(
      (updateByIdSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Project);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId(
        `${NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID}-status`,
      ),
    ).toHaveTextContent("Saved");
    expect(theRow()).toHaveTextContent(OFF_DESCRIPTION);
  });

  test("and back on, the same way", async () => {
    (project as unknown as Record<string, unknown>)[COLUMN] = false;
    openPage();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(updates()).toEqual([{ [COLUMN]: true }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
  });

  test("a flip the server refuses moves the switch back, with why", async () => {
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("You do not have permission to update this Project.");
    });
    openPage();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(theRow()).toHaveTextContent(
      "You do not have permission to update this Project.",
    );
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
  });

  test("a project that cannot be read says why, and offers no switch", async () => {
    getItemSpy.mockImplementation(async (): Promise<Project> => {
      throw new Error("The project could not be loaded.");
    });
    openPage();

    expect(
      await screen.findByText(
        "The project could not be loaded.",
        { exact: false },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID),
    ).not.toBeInTheDocument();
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s may flip it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      const control: HTMLElement = await theSwitch();
      expect(control).not.toHaveAttribute("aria-disabled");

      await press(control);
      expect(updates()).toEqual([{ [COLUMN]: false }]);
    },
  );

  test.each([
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.EditProject],
    [Permission.CreateProjectIncident],
  ])(
    "%s sees it, locked, with the permissions it needs, and a press saves nothing",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage();

      const control: HTMLElement = await theSwitch();

      expect(control).toHaveAttribute("aria-disabled", "true");
      // Still says where the project stands.
      expect(control).toHaveAttribute("aria-checked", "true");
      expect(theRow()).toHaveTextContent("Project Owner, Project Admin");

      await press(control);
      expect(updateByIdSpy).not.toHaveBeenCalled();
      expect(control).toHaveAttribute("aria-checked", "true");
    },
  );

  test("the switch writes the column the Declare form reads, and needs a project owner or admin", () => {
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.column).toBe(
      "notifyStatusPageSubscribersOfNewIncidentsByDefault",
    );
    expect(
      getProjectColumnsUpdatePermissions([COLUMN as keyof Project & string]),
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(
      getProjectColumnsPermissionMessage([COLUMN as keyof Project & string]),
    ).toBe(
      "You do not have permission to change these settings. You need one of these roles: Project Owner, Project Admin.",
    );
  });

  test("its words are the page's own", () => {
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardTitle).toBe(
      "Subscriber Notifications",
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription).toBe(
      CARD_DESCRIPTION,
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchTitle).toBe(
      SWITCH_TITLE,
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription).toBe(
      ON_DESCRIPTION,
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription).toBe(
      OFF_DESCRIPTION,
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.dataTestId).toBe(
      NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
    );
    // No third line under the switch, whichever way it is set.
    expect(
      Object.keys(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY).sort(),
    ).toEqual(
      [
        "cardDescription",
        "cardTitle",
        "column",
        "dataTestId",
        "switchOffDescription",
        "switchOnDescription",
        "switchTitle",
      ].sort(),
    );
  });

  test("says each state in one short sentence, naming the box as the form names it", () => {
    for (const text of [
      NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription,
      NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription,
      NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription,
    ]) {
      expect([text, text.split(". ").length]).toEqual([text, 1]);
      expect([text, text.length <= 125]).toEqual([text, true]);
      expect(text).toContain("Notify Status Page Subscribers");
    }
  });
});
