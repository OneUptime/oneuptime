/** @timezone UTC */

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
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The push-based monitors' setup and connection cards, and the manual
 * monitor's guide. The heartbeat URL, inbound address and agent install
 * command all contain the monitor's secret key: an editor gets them with a
 * copy button, and anyone else is told they are hidden - with the key
 * nowhere in the page.
 *
 * The inbound email domain and host come from the build's config, so they
 * are pinned here. The two existing setup components the cards reuse are
 * stubbed to record what they are handed.
 */

let mockInboundEmailDomain: string | undefined = "inbound.example.com";
const mockEmailLinkProps: Array<Record<string, unknown>> = [];
const mockServerDocsProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
  };

  /*
   * A getter, so a test can switch the domain off. Defined after the spread
   * on purpose: the compiled spread copies values, which would freeze a
   * getter declared in the literal at its first value.
   */
  Object.defineProperty(config, "INBOUND_EMAIL_DOMAIN", {
    enumerable: true,
    get: (): string | undefined => {
      return mockInboundEmailDomain;
    },
  });

  return config;
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockEmailLinkProps.push(props);
        const ReactModule: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return ReactModule.createElement(
          "div",
          { "data-testid": "incoming-email-link" },
          "Incoming email link",
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ServerMonitor/Documentation",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockServerDocsProps.push(props);
        const ReactModule: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return ReactModule.createElement(
          "div",
          { "data-testid": "server-monitor-documentation" },
          "Server documentation",
        );
      },
    };
  },
);

import MonitorConnectionCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorConnectionCard";
import MonitorManualGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorManualGuideCard";
import MonitorSetupCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSetupCard";
import { getIncomingEmailAddress } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink";
import { getHeartbeatUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { MonitorOverviewSetupKind } from "../../../Utils/Monitor/MonitorOverviewFamily";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SECRET: string = "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

const routeFor: (pageMap: PageMap) => string = (pageMap: PageMap): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: MONITOR_ID,
  }).toString();
};

// What an editor's read returns: every secret key is readable.
const editorMonitor: () => Monitor = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.incomingRequestSecretKey = new ObjectID(SECRET);
  monitor.incomingEmailSecretKey = new ObjectID(SECRET);
  monitor.serverMonitorSecretKey = new ObjectID(SECRET);
  return monitor;
};

// What a viewer's read returns: the secret-key columns are left out.
const viewerMonitor: () => Monitor = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  return monitor;
};

const renderInRouter: (element: ReactElement) => RenderResult = (
  element: ReactElement,
): RenderResult => {
  return render(<MemoryRouter>{element}</MemoryRouter>);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockInboundEmailDomain = "inbound.example.com";
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  mockEmailLinkProps.length = 0;
  mockServerDocsProps.length = 0;
});

describe("MonitorSetupCard", () => {
  test("heartbeat setup for an editor shows the URL, a copy button and a curl example", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    const url: string = getHeartbeatUrl(new ObjectID(SECRET)).toString();
    expect(url).toContain(`/heartbeat/${SECRET}`);

    expect(
      screen.getByRole("heading", { name: "Send the first heartbeat" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-setup-heartbeat-url")).toHaveTextContent(
      url,
    );
    expect(
      within(screen.getByTestId("monitor-setup-heartbeat")).getAllByRole(
        "button",
        { name: /Copy/ },
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("monitor-setup-heartbeat")).toHaveTextContent(
      `curl -X POST "${url}"`,
    );
    expect(
      screen.getByText(
        "GET and POST both work. Headers and body are available to your criteria.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Full setup instructions" }),
    ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_DOCUMENTATION));
  });

  test.each([
    [
      MonitorOverviewSetupKind.HeartbeatUrl,
      "Waiting for the first heartbeat",
      "heartbeat URL",
    ],
    [
      MonitorOverviewSetupKind.InboundEmail,
      "Waiting for the first email",
      "email address",
    ],
    [
      MonitorOverviewSetupKind.ServerAgent,
      "Waiting for the agent to report",
      "install command",
    ],
  ])(
    "for a viewer (%s) the details are hidden and the secret is nowhere in the page",
    (kind: MonitorOverviewSetupKind, title: string, noun: string) => {
      const view: RenderResult = renderInRouter(
        <MonitorSetupCard
          monitorId={MONITOR_ID}
          kind={kind}
          monitor={viewerMonitor()}
        />,
      );

      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      const hidden: HTMLElement = screen.getByTestId("monitor-setup-hidden");
      expect(hidden).toHaveTextContent("Setup details are hidden");
      expect(hidden).toHaveTextContent(
        `The ${noun} contains this monitor's secret key, so only people who can edit monitors can see it. Ask one of them to set it up.`,
      );

      expect(view.container.innerHTML).not.toContain(SECRET);
      expect(view.container.innerHTML).not.toContain("/heartbeat/");
      expect(view.container.innerHTML).not.toContain("curl");
      expect(mockEmailLinkProps).toHaveLength(0);
      expect(mockServerDocsProps).toHaveLength(0);
    },
  );

  test("email setup reuses IncomingEmailMonitorLink with the monitor's key", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={editorMonitor()}
      />,
    );

    expect(screen.getByTestId("incoming-email-link")).toBeInTheDocument();
    expect(String(mockEmailLinkProps[0]!["secretKey"])).toBe(SECRET);
  });

  test("email setup hands IncomingEmailMonitorLink the custom address name", () => {
    const monitor: Monitor = editorMonitor();
    monitor.incomingEmailCustomLocalPart = "nightly-backups";

    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={monitor}
      />,
    );

    expect(mockEmailLinkProps[0]!["customLocalPart"]).toBe("nightly-backups");
  });

  test("email setup passes no custom name when the monitor has none", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={editorMonitor()}
      />,
    );

    expect(mockEmailLinkProps[0]!["customLocalPart"]).toBeUndefined();
  });

  test("server setup reuses the agent documentation cards", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.ServerAgent}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.getByTestId("server-monitor-documentation"),
    ).toBeInTheDocument();
    expect(String(mockServerDocsProps[0]!["secretKey"])).toBe(SECRET);
  });
});

describe("MonitorConnectionCard", () => {
  test("heartbeat: the URL with a copy button, and the last request with its method", () => {
    const monitor: Monitor = editorMonitor();
    monitor.incomingMonitorRequest = {
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      monitorId: MONITOR_ID,
      requestMethod: HTTPMethod.POST,
      incomingRequestReceivedAt: minutesAgo(2),
      checkedAt: minutesAgo(1),
    } as IncomingMonitorRequest;

    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={monitor}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Heartbeat URL" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Where this monitor gets its data.",
    );
    expect(screen.getByTestId("monitor-connection-value")).toHaveTextContent(
      getHeartbeatUrl(new ObjectID(SECRET)).toString(),
    );
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last request 2 minutes ago · POST",
    );
    expect(
      screen.getByRole("link", { name: "Setup instructions" }),
    ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_DOCUMENTATION));
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  });

  test("heartbeat without the secret says why it is hidden and leaks nothing", () => {
    const monitor: Monitor = viewerMonitor();
    monitor.incomingMonitorRequest = {
      incomingRequestReceivedAt: minutesAgo(2),
    } as IncomingMonitorRequest;

    const view: RenderResult = renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={monitor}
      />,
    );

    expect(
      screen.getByText(
        "Only people who can edit monitors can see this, because it contains the monitor's secret key.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-connection-value")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(view.container.innerHTML).not.toContain("/heartbeat/");
    // The last request time is not a secret.
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last request 2 minutes ago",
    );
  });

  test("email: the inbound address with a copy button, and the last email", () => {
    const monitor: Monitor = editorMonitor();
    monitor.incomingEmailMonitorLastEmailReceivedAt = minutesAgo(5);

    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={monitor}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Inbound email address" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-value")).toHaveTextContent(
      `monitor-${SECRET}@inbound.example.com`,
    );
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last email 5 minutes ago",
    );
  });

  test("email with a custom address shows that address, not the generated one", () => {
    /*
     * The generated address stops working once a custom one is set, so
     * showing it here would send people to a dead address.
     */
    const monitor: Monitor = editorMonitor();
    monitor.incomingEmailCustomLocalPart = "nightly-backups";

    const view: RenderResult = renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={monitor}
      />,
    );

    expect(screen.getByTestId("monitor-connection-value")).toHaveTextContent(
      "nightly-backups@inbound.example.com",
    );
    expect(view.container.innerHTML).not.toContain(`monitor-${SECRET}`);
  });

  test("getIncomingEmailAddress prefers the custom name over the key", () => {
    expect(
      getIncomingEmailAddress(new ObjectID(SECRET), "nightly-backups"),
    ).toBe("nightly-backups@inbound.example.com");
    expect(getIncomingEmailAddress(new ObjectID(SECRET))).toBe(
      `monitor-${SECRET}@inbound.example.com`,
    );
    expect(getIncomingEmailAddress(undefined, "nightly-backups")).toBe(
      "nightly-backups@inbound.example.com",
    );
    expect(getIncomingEmailAddress(undefined)).toBeNull();
  });

  test("email on a server with no inbound domain says there is no address", () => {
    mockInboundEmailDomain = undefined;

    expect(getIncomingEmailAddress(new ObjectID(SECRET))).toBeNull();

    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.getByText(
        "Inbound email is not configured on this server, so this monitor has no address yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-connection-value")).toBeNull();
  });

  test("email without the secret hides the address", () => {
    const view: RenderResult = renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.InboundEmail}
        monitor={viewerMonitor()}
      />,
    );

    expect(
      screen.getByText(
        "Only people who can edit monitors can see this, because it contains the monitor's secret key.",
      ),
    ).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("inbound.example.com");
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last email: none yet",
    );
  });

  test("server: the reporting host and the last report, which need no secret", () => {
    const monitor: Monitor = viewerMonitor();
    monitor.serverMonitorRequestReceivedAt = minutesAgo(1);
    monitor.serverMonitorResponse = {
      hostname: "web-01.example.com",
      requestReceivedAt: minutesAgo(1),
    } as ServerMonitorResponse;

    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.ServerAgent}
        monitor={monitor}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Server agent" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-value")).toHaveTextContent(
      "web-01.example.com",
    );
    expect(screen.getByTestId("monitor-connection-value")).toHaveClass(
      "font-mono",
    );
    expect(screen.getByText(/^Host/)).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last report a minute ago",
    );
    expect(screen.queryByText(/Only people who can edit monitors/)).toBeNull();
  });

  test.each([
    ["a number", 12345],
    ["a boolean", true],
    ["an object", { name: "web-01" }],
  ])(
    "server whose agent sent %s as its hostname says it has none, rather than crashing",
    (_label: string, hostname: unknown) => {
      // The agent's report is stored unvalidated, so any JSON can arrive.
      const monitor: Monitor = viewerMonitor();
      monitor.serverMonitorRequestReceivedAt = minutesAgo(1);
      monitor.serverMonitorResponse = {
        hostname: hostname,
        requestReceivedAt: minutesAgo(1),
      } as unknown as ServerMonitorResponse;

      renderInRouter(
        <MonitorConnectionCard
          monitorId={MONITOR_ID}
          kind={MonitorOverviewSetupKind.ServerAgent}
          monitor={monitor}
        />,
      );

      expect(screen.getByText("not reported yet")).toBeInTheDocument();
      expect(screen.queryByTestId("monitor-connection-value")).toBeNull();
      expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
        "Last report a minute ago",
      );
    },
  );

  test("server whose hostname is only whitespace says it has none", () => {
    const monitor: Monitor = viewerMonitor();
    monitor.serverMonitorResponse = {
      hostname: "   ",
    } as ServerMonitorResponse;

    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.ServerAgent}
        monitor={monitor}
      />,
    );

    expect(screen.getByText("not reported yet")).toBeInTheDocument();
  });

  test("server with no hostname yet says so", () => {
    renderInRouter(
      <MonitorConnectionCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.ServerAgent}
        monitor={viewerMonitor()}
      />,
    );

    expect(screen.getByText("not reported yet")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-connection-meta")).toHaveTextContent(
      "Last report: none yet",
    );
  });
});

describe("MonitorManualGuideCard", () => {
  test("explains how the status changes and links to where to change it", () => {
    renderInRouter(<MonitorManualGuideCard monitorId={MONITOR_ID} />);

    expect(
      screen.getByRole("heading", { name: "Manual monitor" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Status is set by people, not by checks.",
    );
    expect(
      screen.getByText("Change the status from the status timeline."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Incidents and scheduled maintenance can change it too.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Uptime counts time spent in operational statuses."),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Open status timeline" }),
    ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_STATUS_TIMELINE));
    expect(
      screen.getByRole("link", { name: "View incidents" }),
    ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_INCIDENTS));
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  });
});
