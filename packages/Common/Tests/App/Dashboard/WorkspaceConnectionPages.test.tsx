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
  within,
} from "@testing-library/react";
import type { Mock, SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The pages behind the Workspace menus.
 *
 * - A product's Workspace page, listed while nothing is connected: Slack,
 *   Microsoft Teams and Mattermost side by side, which is connected, and one
 *   step for each.
 * - A product's Slack, Microsoft Teams and Mattermost pages: the notification
 *   rules once the workspace is connected; while it is not, a button to the
 *   place that connects it instead of a path to retype ("Please go to
 *   Project Settings > Workspace Connections > Slack").
 *
 * All of them read the store the side menu reads, so a page and its menu
 * agree and the server is asked once.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceNotificationRulesTable",
  () => {
    return {
      __esModule: true,
      default: (props: {
        workspaceType: string;
        eventType: string;
      }): ReactElement => {
        return (
          <div
            data-testid="notification-rules"
            data-workspace-type={props.workspaceType}
            data-event-type={props.eventType}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="summary-table" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceReactionNotesTips",
  () => {
    return {
      __esModule: true,
      default: (props: {
        workspaceType: string;
        resourceName: string;
        supportsPublicNotes: boolean;
      }): ReactElement => {
        return (
          <div
            data-testid="reaction-notes-tips"
            data-workspace-type={props.workspaceType}
            data-resource-name={props.resourceName}
            data-public-notes={String(props.supportsPublicNotes)}
          />
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="markdown" />;
    },
  };
});

import WorkspaceConnectionGate, {
  WorkspaceNotConnected,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionGate";
import WorkspaceConnectionsOverview from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionsOverview";
import {
  WORKSPACE_CONNECTIONS_PAGE_COPY,
  WORKSPACE_CONNECTION_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionCopy";
import AlertsWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/WorkspaceConnectionMattermost";
import AlertsWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/WorkspaceConnectionMicrosoftTeams";
import AlertsWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/WorkspaceConnectionSlack";
import IncidentsWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/WorkspaceConnectionMattermost";
import IncidentsWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/WorkspaceConnectionMicrosoftTeams";
import IncidentsWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/WorkspaceConnectionSlack";
import MonitorWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/WorkspaceConnectionMattermost";
import MonitorWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/WorkspaceConnectionMicrosoftTeams";
import MonitorWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/WorkspaceConnectionSlack";
import OnCallDutyWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/WorkspaceConnectionMattermost";
import OnCallDutyWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/WorkspaceConnectionMicrosoftTeams";
import OnCallDutyWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/WorkspaceConnectionSlack";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenanceWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMattermost";
import ScheduledMaintenanceWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMicrosoftTeams";
import ScheduledMaintenanceWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionSlack";
import SecurityEventsWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WorkspaceConnectionMattermost";
import SecurityEventsWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WorkspaceConnectionMicrosoftTeams";
import SecurityEventsWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WorkspaceConnectionSlack";
import SloWorkspaceConnectionMattermost from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/WorkspaceConnectionMattermost";
import SloWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/WorkspaceConnectionMicrosoftTeams";
import SloWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/WorkspaceConnectionSlack";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ConnectedWorkspaces, {
  ConnectedWorkspacesFetcher,
  REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import Route from "../../../Types/API/Route";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Navigation from "../../../UI/Utils/Navigation";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

let fetcher: Mock<ConnectedWorkspacesFetcher>;
let navigate: SpyInstance<typeof Navigation.navigate>;

const pageProps: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

function connect(...types: Array<WorkspaceType>): void {
  ConnectedWorkspaces.setConnected(PROJECT_ID, types);
}

function waitForever(): Promise<Array<WorkspaceType>> {
  return new Promise<Array<WorkspaceType>>((): void => {});
}

function navigatedTo(): Array<string> {
  return navigate.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  fetcher = jest.fn<ConnectedWorkspacesFetcher>();
  fetcher.mockImplementation(waitForever);
  ConnectedWorkspaces.setFetcher(fetcher);
  goTo(`/dashboard/${PROJECT_ID}/incidents/workspace-connections`);
  navigate = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
  jest.restoreAllMocks();
});

describe("the Workspace page: which is connected, and the next step for each", () => {
  async function renderOverview(): Promise<void> {
    await act(async () => {
      render(
        <WorkspaceConnectionsOverview
          slackPage={PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK}
          microsoftTeamsPage={
            PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
          }
          mattermostPage={PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST}
        />,
      );
    });
  }

  function tile(workspaceType: WorkspaceType): HTMLElement {
    return screen.getByTestId(`workspace-connection-${workspaceType}`);
  }

  /*
   * Official logos audit: each tile shows its workspace's official logo
   * where a white glyph on a coloured square was - decorative, since the
   * tile's words name the workspace, and the same whether it is connected.
   */
  test.each([
    [WorkspaceType.Slack, "slack"],
    [WorkspaceType.MicrosoftTeams, "microsoft-teams"],
    [WorkspaceType.Mattermost, "mattermost"],
  ])(
    "%s's tile shows its official logo, connected or not",
    async (workspaceType: WorkspaceType, logo: string) => {
      connect(WorkspaceType.Slack);
      await renderOverview();

      const mark: Element | null = tile(workspaceType).querySelector(
        "[data-provider-logo]",
      );

      expect(mark).toHaveAttribute("data-provider-logo", logo);
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark).toHaveClass("bg-white", "h-10", "w-10");
      expect(tile(workspaceType)).toHaveTextContent(
        WORKSPACE_CONNECTION_COPY[workspaceType].name,
      );
      // No coloured square behind a glyph any more.
      expect(tile(workspaceType).querySelector(".bg-fuchsia-500")).toBeNull();
      expect(tile(workspaceType).querySelector(".bg-blue-500")).toBeNull();
    },
  );

  test("says what it is for", async () => {
    connect();
    await renderOverview();

    expect(
      screen.getByText(WORKSPACE_CONNECTIONS_PAGE_COPY.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(WORKSPACE_CONNECTIONS_PAGE_COPY.description),
    ).toBeInTheDocument();
  });

  test("shows Slack, then Microsoft Teams, then Mattermost, each with what it does", async () => {
    connect();
    await renderOverview();

    const tiles: Array<HTMLElement> = within(
      screen.getByTestId("workspace-connections"),
    ).getAllByRole("listitem");

    expect(
      tiles.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-testid");
      }),
    ).toEqual([
      "workspace-connection-Slack",
      "workspace-connection-MicrosoftTeams",
      "workspace-connection-Mattermost",
    ]);
    expect(
      within(tile(WorkspaceType.Slack)).getByText(
        WORKSPACE_CONNECTION_COPY[WorkspaceType.Slack].description,
      ),
    ).toBeInTheDocument();
    expect(
      within(tile(WorkspaceType.MicrosoftTeams)).getByText(
        WORKSPACE_CONNECTION_COPY[WorkspaceType.MicrosoftTeams].description,
      ),
    ).toBeInTheDocument();
    expect(
      within(tile(WorkspaceType.Mattermost)).getByText(
        WORKSPACE_CONNECTION_COPY[WorkspaceType.Mattermost].description,
      ),
    ).toBeInTheDocument();
  });

  test("nothing connected: each says Not connected and links to where it is connected", async () => {
    connect();
    await renderOverview();

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]) {
      expect(tile(workspaceType)).toHaveAttribute("data-connected", "false");
      expect(
        within(tile(workspaceType)).getByText("Not connected"),
      ).toBeInTheDocument();
    }

    expect(
      within(tile(WorkspaceType.Slack)).getByRole("link", {
        name: "Connect Slack →",
      }),
    ).toHaveAttribute("href", routeFor(PageMap.SETTINGS_SLACK_INTEGRATION));
    expect(
      within(tile(WorkspaceType.MicrosoftTeams)).getByRole("link", {
        name: "Connect Microsoft Teams →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION),
    );
    expect(
      within(tile(WorkspaceType.Mattermost)).getByRole("link", {
        name: "Connect Mattermost →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_MATTERMOST_INTEGRATION),
    );
  });

  test("Slack connected: Slack says Connected and links to this product's Slack page", async () => {
    connect(WorkspaceType.Slack);
    await renderOverview();

    expect(tile(WorkspaceType.Slack)).toHaveAttribute("data-connected", "true");
    expect(
      within(tile(WorkspaceType.Slack)).getByText("Connected"),
    ).toBeInTheDocument();
    expect(
      within(tile(WorkspaceType.Slack)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK),
    );

    expect(tile(WorkspaceType.MicrosoftTeams)).toHaveAttribute(
      "data-connected",
      "false",
    );
    expect(
      within(tile(WorkspaceType.MicrosoftTeams)).getByRole("link", {
        name: "Connect Microsoft Teams →",
      }),
    ).toBeInTheDocument();
  });

  test("Mattermost connected: Mattermost says Connected and links to this product's Mattermost page", async () => {
    connect(WorkspaceType.Mattermost);
    await renderOverview();

    expect(tile(WorkspaceType.Mattermost)).toHaveAttribute(
      "data-connected",
      "true",
    );
    expect(
      within(tile(WorkspaceType.Mattermost)).getByText("Connected"),
    ).toBeInTheDocument();
    expect(
      within(tile(WorkspaceType.Mattermost)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST),
    );

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      expect(tile(workspaceType)).toHaveAttribute("data-connected", "false");
    }
  });

  test("Slack and Microsoft Teams connected: Mattermost alone says Not connected", async () => {
    connect(WorkspaceType.Slack, WorkspaceType.MicrosoftTeams);
    await renderOverview();

    expect(
      within(tile(WorkspaceType.MicrosoftTeams)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS),
    );
    expect(screen.getAllByText("Not connected")).toHaveLength(1);
    expect(
      within(tile(WorkspaceType.Mattermost)).getByText("Not connected"),
    ).toBeInTheDocument();
  });

  test("all connected: each links to this product's own pages", async () => {
    connect(
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    );
    await renderOverview();

    const productPages: Array<[WorkspaceType, PageMap]> = [
      [WorkspaceType.Slack, PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK],
      [
        WorkspaceType.MicrosoftTeams,
        PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ],
      [
        WorkspaceType.Mattermost,
        PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
      ],
    ];

    for (const [workspaceType, page] of productPages) {
      expect(
        within(tile(workspaceType)).getByRole("link", {
          name: "Set up notifications →",
        }),
      ).toHaveAttribute("href", routeFor(page));
    }
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });

  // Security Events > Workspace, as its routes mount it.
  test("Security Events' page sends each connected workspace to the security cases' rules", async () => {
    connect(
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    );

    await act(async () => {
      render(
        <WorkspaceConnectionsOverview
          slackPage={PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK}
          microsoftTeamsPage={
            PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
          }
          mattermostPage={
            PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MATTERMOST
          }
        />,
      );
    });

    expect(
      within(tile(WorkspaceType.Slack)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK),
    );
    expect(
      within(tile(WorkspaceType.MicrosoftTeams)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS),
    );
    expect(
      within(tile(WorkspaceType.Mattermost)).getByRole("link", {
        name: "Set up notifications →",
      }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MATTERMOST),
    );
  });

  test("a click on a step goes there inside the app", async () => {
    connect();
    await renderOverview();

    fireEvent.click(
      within(tile(WorkspaceType.MicrosoftTeams)).getByRole("link", {
        name: "Connect Microsoft Teams →",
      }),
    );

    expect(navigatedTo()).toEqual([
      routeFor(PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION),
    ]);
  });

  test("the status pills are tinted green when connected and grey when not", async () => {
    connect(WorkspaceType.MicrosoftTeams);
    await renderOverview();

    expect(
      screen.getByTestId("workspace-connection-status-MicrosoftTeams"),
    ).toHaveClass("bg-emerald-50", "text-emerald-700");
    expect(screen.getByTestId("workspace-connection-status-Slack")).toHaveClass(
      "bg-gray-100",
      "text-gray-600",
    );
  });

  test("waits for this page load's answer, not the remembered one", async () => {
    window.localStorage.setItem(
      `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${PROJECT_ID}`,
      JSON.stringify([WorkspaceType.Slack]),
    );
    await renderOverview();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-connections"),
    ).not.toBeInTheDocument();
    // The card and its explanation are there at once.
    expect(
      screen.getByText(WORKSPACE_CONNECTIONS_PAGE_COPY.title),
    ).toBeInTheDocument();
  });

  test("a failed request says why and asks again on Refresh", async () => {
    fetcher.mockRejectedValueOnce(new Error("Could not reach the server."));
    await renderOverview();

    expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce([WorkspaceType.Slack]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("workspace-connection-Slack")).toHaveAttribute(
      "data-connected",
      "true",
    );
  });
});

describe("a product's Slack, Microsoft Teams or Mattermost page", () => {
  interface WorkspacePage {
    name: string;
    Page: FunctionComponent<PageComponentProps>;
    workspaceType: WorkspaceType;
    // The rules on the page's opening tab.
    firstEventType: NotificationRuleEventType;
  }

  const PAGES: Array<WorkspacePage> = [
    {
      name: "Incidents > Slack",
      Page: IncidentsWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.Incident,
    },
    {
      name: "Incidents > Microsoft Teams",
      Page: IncidentsWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.Incident,
    },
    {
      name: "Alerts > Slack",
      Page: AlertsWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.Alert,
    },
    {
      name: "Alerts > Microsoft Teams",
      Page: AlertsWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.Alert,
    },
    {
      name: "Scheduled Maintenance > Slack",
      Page: ScheduledMaintenanceWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.ScheduledMaintenance,
    },
    {
      name: "Scheduled Maintenance > Microsoft Teams",
      Page: ScheduledMaintenanceWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.ScheduledMaintenance,
    },
    {
      name: "Monitors > Slack",
      Page: MonitorWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.Monitor,
    },
    {
      name: "Monitors > Microsoft Teams",
      Page: MonitorWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.Monitor,
    },
    {
      name: "On-Call > Slack",
      Page: OnCallDutyWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.OnCallDutyPolicy,
    },
    {
      name: "On-Call > Microsoft Teams",
      Page: OnCallDutyWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.OnCallDutyPolicy,
    },
    // Security Events > Workspace: the rules that post security cases.
    {
      name: "Security Events > Slack",
      Page: SecurityEventsWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.SecurityCase,
    },
    {
      name: "Security Events > Microsoft Teams",
      Page: SecurityEventsWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.SecurityCase,
    },
    // Each product's Mattermost page: the same rules, for Mattermost.
    {
      name: "Incidents > Mattermost",
      Page: IncidentsWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.Incident,
    },
    {
      name: "Alerts > Mattermost",
      Page: AlertsWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.Alert,
    },
    {
      name: "Scheduled Maintenance > Mattermost",
      Page: ScheduledMaintenanceWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.ScheduledMaintenance,
    },
    {
      name: "Monitors > Mattermost",
      Page: MonitorWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.Monitor,
    },
    {
      name: "On-Call > Mattermost",
      Page: OnCallDutyWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.OnCallDutyPolicy,
    },
    {
      name: "Security Events > Mattermost",
      Page: SecurityEventsWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.SecurityCase,
    },
    // SLOs > Workspace: the rules that post SLOs' error budget policy changes.
    {
      name: "SLOs > Slack",
      Page: SloWorkspaceConnectionSlack,
      workspaceType: WorkspaceType.Slack,
      firstEventType: NotificationRuleEventType.ServiceLevelObjective,
    },
    {
      name: "SLOs > Microsoft Teams",
      Page: SloWorkspaceConnectionMicrosoftTeams,
      workspaceType: WorkspaceType.MicrosoftTeams,
      firstEventType: NotificationRuleEventType.ServiceLevelObjective,
    },
    {
      name: "SLOs > Mattermost",
      Page: SloWorkspaceConnectionMattermost,
      workspaceType: WorkspaceType.Mattermost,
      firstEventType: NotificationRuleEventType.ServiceLevelObjective,
    },
  ];

  const PAGE_CASES: Array<[string, WorkspacePage]> = PAGES.map(
    (page: WorkspacePage): [string, WorkspacePage] => {
      return [page.name, page];
    },
  );

  function other(workspaceType: WorkspaceType): WorkspaceType {
    return workspaceType === WorkspaceType.Slack
      ? WorkspaceType.MicrosoftTeams
      : WorkspaceType.Slack;
  }

  async function renderPage(page: WorkspacePage): Promise<void> {
    await act(async () => {
      render(<page.Page {...pageProps} />);
    });
  }

  test.each(PAGE_CASES)(
    "%s: connected, it shows the workspace's notification rules",
    async (_name: string, page: WorkspacePage) => {
      connect(page.workspaceType);
      await renderPage(page);

      // The first (Security Events holds a second under it, below).
      const rules: HTMLElement =
        screen.getAllByTestId("notification-rules")[0]!;

      expect(rules).toHaveAttribute("data-workspace-type", page.workspaceType);
      expect(rules).toHaveAttribute("data-event-type", page.firstEventType);
      expect(
        screen.queryByText(
          WORKSPACE_CONNECTION_COPY[page.workspaceType].notConnectedTitle,
        ),
      ).not.toBeInTheDocument();
    },
  );

  /*
   * Security Events' pages hold two kinds of rule, one card under the
   * other, not behind tabs: the rules that post security cases, then the
   * rules that post what hunts find - so a team that sets up one finds the
   * other.
   */
  test.each([
    [
      "Security Events > Slack",
      SecurityEventsWorkspaceConnectionSlack,
      WorkspaceType.Slack,
    ],
    [
      "Security Events > Microsoft Teams",
      SecurityEventsWorkspaceConnectionMicrosoftTeams,
      WorkspaceType.MicrosoftTeams,
    ],
    [
      "Security Events > Mattermost",
      SecurityEventsWorkspaceConnectionMattermost,
      WorkspaceType.Mattermost,
    ],
  ] as Array<[string, FunctionComponent<PageComponentProps>, WorkspaceType]>)(
    "%s: the security case rules, then the hunt rules, both in sight",
    async (
      _name: string,
      Page: FunctionComponent<PageComponentProps>,
      workspaceType: WorkspaceType,
    ) => {
      connect(workspaceType);
      await act(async () => {
        render(<Page {...pageProps} />);
      });

      const tables: Array<HTMLElement> =
        screen.getAllByTestId("notification-rules");

      expect(
        tables.map((table: HTMLElement): [string | null, string | null] => {
          return [
            table.getAttribute("data-event-type"),
            table.getAttribute("data-workspace-type"),
          ];
        }),
      ).toEqual([
        [NotificationRuleEventType.SecurityCase, workspaceType],
        [NotificationRuleEventType.SecurityHunt, workspaceType],
      ]);
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    },
  );

  test("no other product's page holds the hunt rules", async () => {
    for (const page of PAGES.filter((candidate: WorkspacePage): boolean => {
      return (
        candidate.firstEventType !== NotificationRuleEventType.SecurityCase
      );
    })) {
      connect(page.workspaceType);
      await renderPage(page);

      for (const table of screen.getAllByTestId("notification-rules")) {
        expect(table.getAttribute("data-event-type")).not.toBe(
          NotificationRuleEventType.SecurityHunt,
        );
      }

      cleanup();
    }
  });

  test.each(PAGE_CASES)(
    "%s: not connected (the other one is), it says so and offers the connect button",
    async (_name: string, page: WorkspacePage) => {
      connect(other(page.workspaceType));
      await renderPage(page);

      const copy: (typeof WORKSPACE_CONNECTION_COPY)[WorkspaceType] =
        WORKSPACE_CONNECTION_COPY[page.workspaceType];

      expect(
        screen.queryByTestId("notification-rules"),
      ).not.toBeInTheDocument();
      expect(screen.getByText(copy.notConnectedTitle)).toBeInTheDocument();
      expect(
        screen.getByText(copy.notConnectedDescription),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: copy.connectTitle }),
      ).toBeInTheDocument();
    },
  );

  test.each(PAGE_CASES)(
    "%s: while the answer is on its way, a loader, and never the 'not connected' state",
    async (_name: string, page: WorkspacePage) => {
      await renderPage(page);

      expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
      expect(
        screen.queryByText(
          WORKSPACE_CONNECTION_COPY[page.workspaceType].notConnectedTitle,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("notification-rules"),
      ).not.toBeInTheDocument();
    },
  );

  /*
   * Saving a chat message as a note works the same in both chats: each
   * record's Slack and Microsoft Teams pages show the one tips card, for
   * their own chat, with a public note only where the record has them.
   */
  test.each([
    ["Incidents > Slack", 0, WorkspaceType.Slack, "incident", "true"],
    [
      "Incidents > Microsoft Teams",
      1,
      WorkspaceType.MicrosoftTeams,
      "incident",
      "true",
    ],
    ["Alerts > Slack", 2, WorkspaceType.Slack, "alert", "false"],
    [
      "Alerts > Microsoft Teams",
      3,
      WorkspaceType.MicrosoftTeams,
      "alert",
      "false",
    ],
    [
      "Scheduled Maintenance > Slack",
      4,
      WorkspaceType.Slack,
      "maintenance event",
      "true",
    ],
    [
      "Scheduled Maintenance > Microsoft Teams",
      5,
      WorkspaceType.MicrosoftTeams,
      "maintenance event",
      "true",
    ],
  ])(
    "%s: the emoji reaction tips for its own chat",
    async (
      _name: string,
      index: number,
      workspaceType: WorkspaceType,
      resourceName: string,
      publicNotes: string,
    ) => {
      const page: WorkspacePage = PAGES[index]!;
      connect(page.workspaceType);
      await renderPage(page);

      const tips: HTMLElement = screen.getByTestId("reaction-notes-tips");

      expect(tips).toHaveAttribute("data-workspace-type", workspaceType);
      expect(tips).toHaveAttribute("data-resource-name", resourceName);
      expect(tips).toHaveAttribute("data-public-notes", publicNotes);
    },
  );

  test("the monitor, on-call and security case pages have no reaction tips: nothing there is saved as a note", async () => {
    for (const page of PAGES.slice(6, 12)) {
      connect(page.workspaceType);
      await renderPage(page);

      expect(screen.queryByTestId("reaction-notes-tips")).toBeNull();
      cleanup();
    }
  });

  // OneUptime does not read Mattermost reactions, so no page promises it does.
  test("the Mattermost pages have no reaction tips", async () => {
    const mattermostPages: Array<WorkspacePage> = PAGES.filter(
      (page: WorkspacePage): boolean => {
        return page.workspaceType === WorkspaceType.Mattermost;
      },
    );

    expect(mattermostPages).toHaveLength(7);

    for (const page of mattermostPages) {
      connect(page.workspaceType);
      await renderPage(page);

      // Security Events holds two kinds of rule, a card each.
      expect(
        screen.getAllByTestId("notification-rules").length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId("reaction-notes-tips")).toBeNull();
      cleanup();
    }
  });

  test("the remembered answer is not enough to draw the rules of a workspace", async () => {
    window.localStorage.setItem(
      `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${PROJECT_ID}`,
      JSON.stringify([WorkspaceType.Slack]),
    );
    await renderPage(PAGES[0]!);

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-rules")).not.toBeInTheDocument();
  });

  test("the rules appear once the answer arrives", async () => {
    let answer: (types: Array<WorkspaceType>) => void = (): void => {};
    fetcher.mockImplementation((): Promise<Array<WorkspaceType>> => {
      return new Promise<Array<WorkspaceType>>(
        (resolve: (types: Array<WorkspaceType>) => void): void => {
          answer = resolve;
        },
      );
    });

    await renderPage(PAGES[1]!);

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();

    await act(async () => {
      answer([WorkspaceType.MicrosoftTeams]);
    });

    expect(screen.getByTestId("notification-rules")).toHaveAttribute(
      "data-workspace-type",
      WorkspaceType.MicrosoftTeams,
    );
  });

  test("a failed request says why, and Refresh asks again", async () => {
    fetcher.mockRejectedValueOnce(new Error("Gateway timeout"));
    await renderPage(PAGES[0]!);

    expect(screen.getByText("Gateway timeout")).toBeInTheDocument();

    fetcher.mockResolvedValueOnce([WorkspaceType.Slack]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("notification-rules")).toBeInTheDocument();
  });
});

describe("the 'not connected' state", () => {
  test.each([
    [WorkspaceType.Slack, PageMap.SETTINGS_SLACK_INTEGRATION],
    [
      WorkspaceType.MicrosoftTeams,
      PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
    ],
    [WorkspaceType.Mattermost, PageMap.SETTINGS_MATTERMOST_INTEGRATION],
  ])(
    "%s: the button goes to its Project Settings page, where it is connected",
    (workspaceType: WorkspaceType, settingsPage: string) => {
      render(<WorkspaceNotConnected workspaceType={workspaceType} />);

      fireEvent.click(screen.getByTestId(`workspace-connect-${workspaceType}`));

      expect(navigatedTo()).toEqual([routeFor(settingsPage)]);
    },
  );

  test.each([
    [WorkspaceType.Slack, "slack"],
    [WorkspaceType.MicrosoftTeams, "microsoft-teams"],
    [WorkspaceType.Mattermost, "mattermost"],
  ])(
    "%s: shows the workspace's official logo above its title, not a grey glyph",
    (workspaceType: WorkspaceType, logo: string) => {
      render(<WorkspaceNotConnected workspaceType={workspaceType} />);

      const mark: Element | null = document.querySelector(
        "[data-provider-logo]",
      );

      expect(mark).toHaveAttribute("data-provider-logo", logo);
      // The title names it: the logo is not read out again.
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(
        document.querySelector(
          `#workspace-not-connected-${workspaceType} svg.text-gray-400`,
        ),
      ).toBeNull();
    },
  );

  test("no longer asks anybody to retype a path", () => {
    render(<WorkspaceNotConnected workspaceType={WorkspaceType.Slack} />);

    expect(document.body.textContent).not.toContain("Please go to");
    expect(document.body.textContent).not.toContain(">");
  });

  test("the gate shows its children only for the workspace it guards", async () => {
    connect(WorkspaceType.Slack);

    await act(async () => {
      render(
        <>
          <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
            <div data-testid="slack-body" />
          </WorkspaceConnectionGate>
          <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
            <div data-testid="teams-body" />
          </WorkspaceConnectionGate>
          <WorkspaceConnectionGate workspaceType={WorkspaceType.Mattermost}>
            <div data-testid="mattermost-body" />
          </WorkspaceConnectionGate>
        </>,
      );
    });

    expect(screen.getByTestId("slack-body")).toBeInTheDocument();
    expect(screen.queryByTestId("teams-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mattermost-body")).not.toBeInTheDocument();
    expect(
      screen.getByText("Microsoft Teams is not connected yet!"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mattermost is not connected yet!"),
    ).toBeInTheDocument();
  });
});

describe("one answer for the page and its menu", () => {
  test("the overview, the gate and another reader on the page ask the server once", async () => {
    fetcher.mockResolvedValue([WorkspaceType.MicrosoftTeams]);

    await act(async () => {
      render(
        <>
          <WorkspaceConnectionsOverview
            slackPage={PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK}
            microsoftTeamsPage={
              PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            }
            mattermostPage={PageMap.ALERTS_WORKSPACE_CONNECTION_MATTERMOST}
          />
          <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
            <div data-testid="teams-body" />
          </WorkspaceConnectionGate>
        </>,
      );
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("teams-body")).toBeInTheDocument();
  });
});
