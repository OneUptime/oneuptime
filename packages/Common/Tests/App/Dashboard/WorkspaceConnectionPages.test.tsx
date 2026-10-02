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
 * - A product's Workspace page, listed while nothing is connected: Slack and
 *   Microsoft Teams side by side, which is connected, and one step for each.
 * - A product's Slack and Microsoft Teams pages: the notification rules once
 *   the workspace is connected; while it is not, a button to the place that
 *   connects it instead of a path to retype ("Please go to Project Settings >
 *   Workspace Connections > Slack").
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
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsReactionNotesTips",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="teams-tips" />;
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
import AlertsWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/WorkspaceConnectionMicrosoftTeams";
import AlertsWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/WorkspaceConnectionSlack";
import IncidentsWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/WorkspaceConnectionMicrosoftTeams";
import IncidentsWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/WorkspaceConnectionSlack";
import MonitorWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/WorkspaceConnectionMicrosoftTeams";
import MonitorWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/WorkspaceConnectionSlack";
import OnCallDutyWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/WorkspaceConnectionMicrosoftTeams";
import OnCallDutyWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/WorkspaceConnectionSlack";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenanceWorkspaceConnectionMicrosoftTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMicrosoftTeams";
import ScheduledMaintenanceWorkspaceConnectionSlack from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionSlack";
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
        />,
      );
    });
  }

  function tile(workspaceType: WorkspaceType): HTMLElement {
    return screen.getByTestId(`workspace-connection-${workspaceType}`);
  }

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

  test("shows Slack, then Microsoft Teams, each with what it does", async () => {
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
  });

  test("nothing connected: both say Not connected and link to where they are connected", async () => {
    connect();
    await renderOverview();

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
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

  test("both connected: both link to this product's own pages", async () => {
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
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
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

describe("a product's Slack or Microsoft Teams page", () => {
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

      const rules: HTMLElement = screen.getByTestId("notification-rules");

      expect(rules).toHaveAttribute("data-workspace-type", page.workspaceType);
      expect(rules).toHaveAttribute("data-event-type", page.firstEventType);
      expect(
        screen.queryByText(
          WORKSPACE_CONNECTION_COPY[page.workspaceType].notConnectedTitle,
        ),
      ).not.toBeInTheDocument();
    },
  );

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
  ])(
    "%s: the button goes to its Project Settings page, where it is connected",
    (workspaceType: WorkspaceType, settingsPage: string) => {
      render(<WorkspaceNotConnected workspaceType={workspaceType} />);

      fireEvent.click(screen.getByTestId(`workspace-connect-${workspaceType}`));

      expect(navigatedTo()).toEqual([routeFor(settingsPage)]);
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
        </>,
      );
    });

    expect(screen.getByTestId("slack-body")).toBeInTheDocument();
    expect(screen.queryByTestId("teams-body")).not.toBeInTheDocument();
    expect(
      screen.getByText("Microsoft Teams is not connected yet!"),
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
