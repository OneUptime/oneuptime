import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Since #4269 an empty list's card description is what its empty state
 * explains, under "No X yet". These lists used to explain themselves with
 * "Here is a list of all the incident templates in this project." and the
 * like; each now says what its items are for. The real pages are rendered
 * here, for an empty project, as a project admin.
 *
 * The copy itself, its translations and the rule against the old openers
 * are pinned in App/Tests/Dashboard (CardDescriptionsSayWhatFor and
 * CardDescriptionBoilerplateGuard).
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["ProjectAdmin"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// An empty project: every list is empty, every count is zero.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import IncidentTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import ScheduledMaintenanceTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import AnnouncementTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates";
import IncidentEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Episodes";
import AlertEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Episodes";
import ProjectInvitationsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/ProjectInvitations";
import GlobalActiveIncidentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/ActiveIncidents";
import GlobalActiveAlertsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/ActiveAlerts";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

function propsFor(page: PageMap): PageComponentProps {
  return {
    pageRoute: RouteMap[page] as Route,
    hasPaymentMethod: true,
    currentProject: null,
  } as unknown as PageComponentProps;
}

interface EmptyList {
  name: string;
  render: () => ReactElement;
  description: string;
}

const EMPTY_LISTS: Array<EmptyList> = [
  {
    name: "Incident Templates",
    render: (): ReactElement => {
      return (
        <IncidentTemplatesPage
          {...propsFor(PageMap.INCIDENTS_SETTINGS_TEMPLATES)}
        />
      );
    },
    description:
      "Ready-made incidents for problems you expect, with the title, severity, monitors and on-call policy filled in. Use one with Create from Template on the Incidents page.",
  },
  {
    name: "Scheduled Maintenance Templates",
    render: (): ReactElement => {
      return (
        <ScheduledMaintenanceTemplatesPage
          {...propsFor(PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES)}
        />
      );
    },
    description:
      "Ready-made maintenance events for work you do often, with the title, monitors, status pages and notifications filled in. Use one with Create from Template, or make it recurring to schedule events automatically.",
  },
  {
    name: "Status Page Announcement Templates",
    render: (): ReactElement => {
      return (
        <AnnouncementTemplatesPage
          {...propsFor(PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES)}
        />
      );
    },
    description:
      "Ready-made announcements for news you post often, such as a planned upgrade. Use one with Create from Template on the Announcements page, and edit it before you publish.",
  },
  {
    name: "Incident Episodes",
    render: (): ReactElement => {
      return <IncidentEpisodesPage {...propsFor(PageMap.INCIDENT_EPISODES)} />;
    },
    description:
      "Episodes group related incidents so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
  },
  {
    name: "Alert Episodes",
    render: (): ReactElement => {
      return <AlertEpisodesPage {...propsFor(PageMap.ALERT_EPISODES)} />;
    },
    description:
      "Episodes group related alerts so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
  },
  {
    name: "Project Invitations",
    render: (): ReactElement => {
      return (
        <ProjectInvitationsPage {...propsFor(PageMap.PROJECT_INVITATIONS)} />
      );
    },
    description:
      "When someone invites you to a project or a team, the invitation waits here until you accept or reject it.",
  },
];

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/home`,
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function emptyStateDescription(): Promise<HTMLElement> {
  return await screen.findByTestId(
    "table-empty-state-description",
    {},
    { timeout: 10000 },
  );
}

describe.each(EMPTY_LISTS)("$name, empty", (list: EmptyList) => {
  test("explains what the list is for", async () => {
    render(list.render());

    const description: HTMLElement = await emptyStateDescription();

    expect(description).toHaveTextContent(list.description);
  });

  test("says it once, and never 'Here is a list of'", async () => {
    render(list.render());
    await emptyStateDescription();

    // The card's header leaves its description out while the state says it.
    expect(screen.queryByTestId("card-description")).toBeNull();
    expect(document.body.textContent || "").not.toMatch(/Here (is|are)\b/);
  });
});

describe("the cross-project Active lists say what they hold", () => {
  test.each([
    [
      "Active Incidents",
      (): ReactElement => {
        return (
          <GlobalActiveIncidentsPage {...propsFor(PageMap.ACTIVE_INCIDENTS)} />
        );
      },
      "Incidents nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
    ],
    [
      "Active Alerts",
      (): ReactElement => {
        return <GlobalActiveAlertsPage {...propsFor(PageMap.ACTIVE_ALERTS)} />;
      },
      "Alerts nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
    ],
  ])(
    "%s, in the header above its all-clear",
    async (_name: string, page: () => ReactElement, sentence: string) => {
      render(page());

      /*
       * Empty is good news here: the state is all clear, and the list's
       * description stays in the card's header above it.
       */
      await waitFor(
        () => {
          expect(screen.getByTestId("card-description")).toHaveTextContent(
            sentence,
          );
        },
        { timeout: 10000 },
      );
      expect(document.body.textContent || "").not.toMatch(/Here (is|are)\b/);
    },
  );
});
