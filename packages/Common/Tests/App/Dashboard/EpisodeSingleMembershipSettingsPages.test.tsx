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
import React, { FunctionComponent } from "react";
import { MemoryRouter } from "react-router-dom";
import IncidentEpisodeMembershipSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentEpisodeMembershipSettings";
import AlertEpisodeMembershipSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertEpisodeMembershipSettings";
import {
  ALERT_EPISODE_SETTINGS_COPY,
  ALERT_SINGLE_EPISODE_SWITCH_TEST_ID,
  EpisodeSingleMembershipCopy,
  INCIDENT_EPISODE_SETTINGS_COPY,
  INCIDENT_SINGLE_EPISODE_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeSingleMembershipCopy";
import {
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  AlertsRoutePath,
  IncidentsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  ALERT_SINGLE_MEMBERSHIP_COLUMN,
  INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
} from "../../../Types/Episode/EpisodeSingleMembership";
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
 * Incidents → Settings → Episode Membership and Alerts → Settings →
 * Episode Membership.
 *
 * The maintainer: "Currently, we are able to add one incident to many
 * incident episodes and one alert to many alert episode. Some customers dont
 * want that, so can we create a setting in alert / incident settings to
 * allow alert to be in only one episode and same for incidents."
 *
 * Each page is one card, "Episode Membership", holding one switch - "An
 * incident can be in only one episode" / "An alert can be in only one
 * episode" - that saves its Project column the moment it is flipped. Off for
 * every project, as it always was; turning it on takes nothing out of an
 * episode, which the switch says once it is on. Each state is said in a
 * sentence or two, and nothing else sits under the switch (the UI review
 * dropped a third, always-on note: "Turning this on takes no incident out of
 * an episode: incidents already in several stay in them."). Only a project
 * owner or admin may flip it. The real pages are rendered with the model API
 * and the permission snapshot stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

interface PageCase {
  name: string;
  page: FunctionComponent<PageComponentProps>;
  pageKey: PageMap;
  routePath: string | undefined;
  path: string;
  route: string;
  breadcrumbs: (path: string) => Array<Link> | undefined;
  product: string;
  column: string;
  copy: EpisodeSingleMembershipCopy;
  switchTestId: string;
  switchTitle: string;
  cardDescription: string;
  onDescription: string;
  offDescription: string;
  // What on keeps as it was: those in several episodes stay in them.
  keptAsItWas: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "Incidents",
    page: IncidentEpisodeMembershipSettings,
    pageKey: PageMap.INCIDENTS_SETTINGS_EPISODE_MEMBERSHIP,
    routePath:
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_EPISODE_MEMBERSHIP],
    path: `/dashboard/${PROJECT_ID}/incidents/settings/episode-membership`,
    route: "/dashboard/:projectId/incidents/settings/episode-membership",
    breadcrumbs: getIncidentsBreadcrumbs,
    product: "Incidents",
    column: INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
    copy: INCIDENT_EPISODE_SETTINGS_COPY,
    switchTestId: INCIDENT_SINGLE_EPISODE_SWITCH_TEST_ID,
    switchTitle: "An incident can be in only one episode",
    cardDescription:
      "Choose whether an incident can be in more than one episode.",
    onDescription:
      "An incident in an episode can't be added to another. Incidents already in several episodes stay in them.",
    offDescription: "An incident can be in several episodes at once.",
    keptAsItWas: "Incidents already in several episodes stay in them.",
  },
  {
    name: "Alerts",
    page: AlertEpisodeMembershipSettings,
    pageKey: PageMap.ALERTS_SETTINGS_EPISODE_MEMBERSHIP,
    routePath: AlertsRoutePath[PageMap.ALERTS_SETTINGS_EPISODE_MEMBERSHIP],
    path: `/dashboard/${PROJECT_ID}/alerts/settings/episode-membership`,
    route: "/dashboard/:projectId/alerts/settings/episode-membership",
    breadcrumbs: getAlertsBreadcrumbs,
    product: "Alerts",
    column: ALERT_SINGLE_MEMBERSHIP_COLUMN,
    copy: ALERT_EPISODE_SETTINGS_COPY,
    switchTestId: ALERT_SINGLE_EPISODE_SWITCH_TEST_ID,
    switchTitle: "An alert can be in only one episode",
    cardDescription: "Choose whether an alert can be in more than one episode.",
    onDescription:
      "An alert in an episode can't be added to another. Alerts already in several episodes stay in them.",
    offDescription: "An alert can be in several episodes at once.",
    keptAsItWas: "Alerts already in several episodes stay in them.",
  },
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;

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

function openPage(pageCase: PageCase): void {
  goTo(pageCase.path);

  const Page: FunctionComponent<PageComponentProps> = pageCase.page;

  render(
    <MemoryRouter initialEntries={[pageCase.path]}>
      <Page
        pageRoute={RouteMap[pageCase.pageKey] as Route}
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

async function theSwitch(pageCase: PageCase): Promise<HTMLElement> {
  return await screen.findByTestId(
    pageCase.switchTestId,
    {},
    { timeout: WAIT_TIMEOUT },
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

  // Every project: off, as the column defaults make it.
  project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    limitIncidentsToOneEpisode: false,
    limitAlertsToOneEpisode: false,
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

describe.each(PAGES)(
  "$name → Settings → Episode Membership",
  (pageCase: PageCase) => {
    test("lives at settings/episode-membership, with its own breadcrumb trail", () => {
      expect(pageCase.routePath).toBe("settings/episode-membership");
      expect((RouteMap[pageCase.pageKey] as Route).toString()).toBe(
        pageCase.route,
      );

      goTo(pageCase.path);

      const trail: Array<Link> | undefined = pageCase.breadcrumbs(
        pageCase.route,
      );

      expect(
        (trail || []).map((link: Link): string => {
          return link.title;
        }),
      ).toEqual([
        "Project",
        pageCase.product,
        "Settings",
        "Episode Membership",
      ]);
      expect(trail?.[trail.length - 1]?.to.toString()).toBe(pageCase.path);
    });

    test("is one card, Episode Membership, saying what it decides", async () => {
      openPage(pageCase);

      expect(
        await screen.findByText(
          "Episode Membership",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(pageCase.cardDescription)).toBeInTheDocument();
      expect(screen.getAllByTestId("card")).toHaveLength(1);

      // Once the project is read: the one switch.
      await theSwitch(pageCase);
      expect(screen.getAllByRole("switch")).toHaveLength(1);
    });

    test("the switch is off for a project that never turned it on, and says what off means", async () => {
      openPage(pageCase);

      const control: HTMLElement = await theSwitch(pageCase);

      expect(control).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("switch", { name: pageCase.switchTitle })).toBe(
        control,
      );

      const row: HTMLElement = screen.getByTestId(
        `${pageCase.switchTestId}-row`,
      );
      expect(row).toHaveTextContent(pageCase.offDescription);
      // Off says what off means, and nothing more.
      expect(row).not.toHaveTextContent(pageCase.keptAsItWas);
      expect(row).not.toHaveTextContent("Turning this on");
    });

    test("a project that turned it on shows it on, and says what on means", async () => {
      (project as unknown as Record<string, unknown>)[pageCase.column] = true;
      openPage(pageCase);

      expect(await theSwitch(pageCase)).toHaveAttribute("aria-checked", "true");

      const row: HTMLElement = screen.getByTestId(
        `${pageCase.switchTestId}-row`,
      );
      expect(row).toHaveTextContent(pageCase.onDescription);
      // On takes nothing out: those in several episodes stay in them.
      expect(row).toHaveTextContent(pageCase.keptAsItWas);
      expect(row).not.toHaveTextContent(pageCase.offDescription);
    });

    test("reads the project it is on, and only its own column", async () => {
      openPage(pageCase);
      await theSwitch(pageCase);

      await waitFor(
        () => {
          expect(getItemSpy.mock.calls.length).toBeGreaterThan(0);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: { id?: unknown; select?: Record<string, unknown> } =
        getItemSpy.mock.calls[0]![0] as {
          id?: unknown;
          select?: Record<string, unknown>;
        };

      expect(String(call.id)).toBe(PROJECT_ID);
      expect(call.select).toHaveProperty(pageCase.column);
      for (const column of Object.keys(call.select || {})) {
        expect(["_id", pageCase.column]).toContain(column);
      }
    });

    test("a project owner turns it on: exactly its column is saved, at once, with no dialog", async () => {
      openPage(pageCase);

      const control: HTMLElement = await theSwitch(pageCase);
      await press(control);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updates()).toEqual([{ [pageCase.column]: true }]);
      expect(
        String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
      ).toBe(PROJECT_ID);
      expect(
        (updateByIdSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
      ).toBe(Project);
      expect(control).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByTestId(`${pageCase.switchTestId}-status`),
      ).toHaveTextContent("Saved");
      expect(
        screen.getByTestId(`${pageCase.switchTestId}-row`),
      ).toHaveTextContent(pageCase.onDescription);
    });

    test("and back off, the same way", async () => {
      (project as unknown as Record<string, unknown>)[pageCase.column] = true;
      openPage(pageCase);

      await press(await theSwitch(pageCase));

      expect(updates()).toEqual([{ [pageCase.column]: false }]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("a flip the server refuses moves the switch back, with why", async () => {
      updateByIdSpy.mockImplementation(async (): Promise<never> => {
        throw new Error("You do not have permission to update this Project.");
      });
      openPage(pageCase);

      const control: HTMLElement = await theSwitch(pageCase);
      await press(control);

      expect(control).toHaveAttribute("aria-checked", "false");
      expect(
        screen.getByTestId(`${pageCase.switchTestId}-row`),
      ).toHaveTextContent("You do not have permission to update this Project.");
    });

    test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
      "%s may flip it",
      async (permission: Permission) => {
        grant([...BASE_PERMISSIONS, permission]);
        openPage(pageCase);

        const control: HTMLElement = await theSwitch(pageCase);
        expect(control).not.toHaveAttribute("aria-disabled");

        await press(control);
        expect(updates()).toEqual([{ [pageCase.column]: true }]);
      },
    );

    test.each([
      [Permission.ProjectMember],
      [Permission.Viewer],
      [Permission.EditProject],
    ])(
      "%s sees it, locked, with the permissions it needs, and a press saves nothing",
      async (permission: Permission) => {
        grant([...BASE_PERMISSIONS, permission]);
        openPage(pageCase);

        const control: HTMLElement = await theSwitch(pageCase);

        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(
          screen.getByTestId(`${pageCase.switchTestId}-row`),
        ).toHaveTextContent("Project Owner, Project Admin");

        await press(control);
        expect(updateByIdSpy).not.toHaveBeenCalled();
      },
    );

    test("the switch writes the column the server reads, and needs a project owner or admin", () => {
      expect(pageCase.copy.column).toBe(pageCase.column);
      expect(
        getProjectColumnsUpdatePermissions([
          pageCase.column as keyof Project & string,
        ]),
      ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
      expect(
        getProjectColumnsPermissionMessage([
          pageCase.column as keyof Project & string,
        ]),
      ).toBe(
        "You do not have permission to change these settings. You need one of these roles: Project Owner, Project Admin.",
      );
    });

    test("its words are the page's own", () => {
      expect(pageCase.copy.cardTitle).toBe("Episode Membership");
      expect(pageCase.copy.cardDescription).toBe(pageCase.cardDescription);
      expect(pageCase.copy.switchTitle).toBe(pageCase.switchTitle);
      expect(pageCase.copy.switchOnDescription).toBe(pageCase.onDescription);
      expect(pageCase.copy.switchOffDescription).toBe(pageCase.offDescription);
      expect(pageCase.copy.dataTestId).toBe(pageCase.switchTestId);
      // No third line under the switch, whichever way it is set.
      expect(Object.keys(pageCase.copy).sort()).toEqual(
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

    test("says each state in two short sentences at most", () => {
      for (const text of [
        pageCase.copy.cardDescription,
        pageCase.copy.switchOnDescription,
        pageCase.copy.switchOffDescription,
      ]) {
        const sentences: Array<string> = text
          .split(". ")
          .filter((sentence: string): boolean => {
            return sentence.trim().length > 0;
          });

        expect([text, sentences.length <= 2]).toEqual([text, true]);
        expect([text, text.length <= 110]).toEqual([text, true]);
      }
    });
  },
);

describe("the two pages", () => {
  test("hold one card each, never the other kind's switch", async () => {
    openPage(PAGES[0]!);
    await theSwitch(PAGES[0]!);

    expect(
      screen.queryByTestId(ALERT_SINGLE_EPISODE_SWITCH_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("card")).getAllByRole("switch"),
    ).toHaveLength(1);
  });
});
