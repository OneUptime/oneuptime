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
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * A NETWORK DEVICE'S SECURITY EVENTS PAGE (issue #5769), rendered.
 *
 * The page asks the server what the device's events are - read from the
 * syslog it sends the probe, or naming it - and hands that scope to the
 * Security Events explorer, with a locked chip naming the device and an
 * empty state of the device's own. Without the scope it reads nothing: a
 * failed read says so, and never falls back to the project's every event.
 *
 * The explorer itself is stubbed here, to read what it is handed; its
 * scoped reads are SecurityEventsViewerScope's.
 */

interface StubViewerProps {
  scope?: {
    query: unknown;
    chip: { displayKey: string; displayValue: string; readOnly?: boolean };
    emptyContent: ReactElement;
  };
}

/*
 * The explorer, stubbed: it writes what it was handed onto its element,
 * so each test reads what the page gave it from the page itself.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: StubViewerProps): ReactElement => {
        return react.createElement(
          "div",
          {
            "data-testid": "security-events-viewer-stub",
            "data-has-scope": props.scope ? "true" : "false",
            "data-scope": JSON.stringify(props.scope?.query ?? null),
            "data-chip-key": props.scope?.chip.displayKey ?? "",
            "data-chip-value": props.scope?.chip.displayValue ?? "",
            "data-chip-read-only": String(props.scope?.chip.readOnly === true),
          },
          props.scope?.emptyContent,
        );
      },
    };
  },
);

import NetworkDeviceSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/SecurityEvents";
import DeviceSecurityEventsEmptyState, {
  DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSecurityEventsEmptyState";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import {
  ResourceSecurityScopeJson,
  SecurityConnectionKind,
} from "../../../Types/SecurityCase/SecurityConnection";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const DEVICE_SCOPE: ResourceSecurityScopeJson = {
  kind: SecurityConnectionKind.NetworkDevice,
  id: DEVICE_ID.toString(),
  name: "HQ Firewall",
  values: ["hq firewall", "203.0.113.7"],
  isSearchedByLogs: false,
  scope: {
    observables: ["hq firewall", "HQ FIREWALL", "203.0.113.7"],
    attributeKey: "networkDevice.id",
    attributeValues: [DEVICE_ID.toString()],
  },
};

let scopeMock: MockFunction;
let modelListMock: MockFunction;

function project(enableTelemetryFeatures?: boolean): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;

  if (enableTelemetryFeatures !== undefined) {
    (value as unknown as Record<string, unknown>)["reseller"] = {
      enableTelemetryFeatures,
    };
  }

  return value;
}

function renderPage(currentProject: Project = project()): void {
  render(
    <MemoryRouter>
      <NetworkDeviceSecurityEvents
        pageRoute={
          RouteMap[PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS] as Route
        }
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function stubLogSource(source: Partial<SecurityLogSource> | null): void {
  modelListMock.mockImplementation(
    async (): Promise<ListResult<SecurityLogSource>> => {
      return {
        data: source ? [Object.assign(new SecurityLogSource(), source)] : [],
        count: source ? 1 : 0,
        skip: 0,
        limit: 1,
      };
    },
  );
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID.toString()}/network-devices/${DEVICE_ID.toString()}/security-events`,
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(DEVICE_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });

  scopeMock = jest.spyOn(
    SecurityCaseApi,
    "getResourceSecurityScope",
  ) as unknown as MockFunction;
  scopeMock.mockResolvedValue(DEVICE_SCOPE as never);

  modelListMock = jest.spyOn(ModelAPI, "getList") as unknown as MockFunction;
  stubLogSource(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the page", () => {
  test("asks for this device's scope, and hands it to the explorer", async () => {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(scopeMock).toHaveBeenCalledTimes(1);
    expect(scopeMock.mock.calls[0]![0]).toEqual({
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
    });
    expect(viewer).toHaveAttribute("data-has-scope", "true");
    expect(JSON.parse(viewer.getAttribute("data-scope") || "null")).toEqual(
      DEVICE_SCOPE.scope,
    );
  });

  test("the explorer's chip names the device, locked", async () => {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(viewer).toHaveAttribute("data-chip-key", "Network Device");
    expect(viewer).toHaveAttribute("data-chip-value", "HQ Firewall");
    expect(viewer).toHaveAttribute("data-chip-read-only", "true");
  });

  test("the explorer's empty state is the device's own", async () => {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(
      within(viewer).getByTestId(DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID),
    ).toBeInTheDocument();
  });

  test("a scope that could not be read is said, and nothing is read in its place", async () => {
    scopeMock.mockRejectedValue(
      new Error("This record could not be found.") as never,
    );

    renderPage();

    expect(
      await screen.findByText("This record could not be found."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("security-events-viewer-stub")).toBeNull();
  });

  test("a reader who may not read security events is told why, and nothing is asked", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You do not have permission to read this Security Event.",
    });

    renderPage();

    expect(
      await screen.findByText(
        "You do not have permission to read this Security Event.",
      ),
    ).toBeInTheDocument();
    expect(scopeMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("security-events-viewer-stub")).toBeNull();
  });

  test("permissions not known yet accuse nobody: the server decides", async () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false, disabledReason: undefined });

    renderPage();

    await screen.findByTestId("security-events-viewer-stub");
    expect(scopeMock).toHaveBeenCalledTimes(1);
  });

  test("a plan without telemetry says so, and reads nothing", async () => {
    renderPage(project(false));

    expect(
      await screen.findByText(/Telemetry features are disabled/),
    ).toBeInTheDocument();
    expect(scopeMock).not.toHaveBeenCalled();
  });
});

describe("the device's empty state", () => {
  function renderEmptyState(): void {
    render(
      <MemoryRouter>
        <DeviceSecurityEventsEmptyState modelId={DEVICE_ID} />
      </MemoryRouter>,
    );
  }

  function hrefOf(element: HTMLElement): string {
    const link: HTMLAnchorElement | null = element.closest("a");

    return link?.getAttribute("href") || "";
  }

  test("says why the device has none yet, in two steps", async () => {
    renderEmptyState();

    const state: HTMLElement = screen.getByTestId(
      DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID,
    );

    expect(state).toHaveTextContent("No security events for this device yet");
    expect(
      screen.getByTestId(`${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-syslog`),
    ).toHaveTextContent("Send this device's syslog to a probe.");
    expect(
      screen.getByTestId(`${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`),
    ).toBeInTheDocument();
  });

  test("the first step opens the device's Logs page, which says how to point it at the probe", async () => {
    renderEmptyState();

    const step: HTMLElement = screen.getByTestId(
      `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-syslog`,
    );

    expect(hrefOf(within(step).getByText("Logs"))).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_VIEW_LOGS] as Route,
        { modelId: DEVICE_ID },
      ).toString(),
    );
  });

  test("with Your logs off, the second step asks to turn it on, on Connections", async () => {
    stubLogSource({ isEnabled: false });
    renderEmptyState();

    const step: HTMLElement = screen.getByTestId(
      `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
    );

    await waitFor(() => {
      expect(step).toHaveAttribute("data-state", "off");
    });
    expect(step).toHaveTextContent("Turn on Your logs");
    expect(hrefOf(within(step).getByText("Connections"))).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
      ).toString(),
    );
  });

  test("with Your logs on, it says so - and asks nobody to turn on what is on", async () => {
    stubLogSource({ isEnabled: true });
    renderEmptyState();

    const step: HTMLElement = screen.getByTestId(
      `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
    );

    await waitFor(() => {
      expect(step).toHaveAttribute("data-state", "on");
    });
    expect(step).toHaveTextContent("Your logs is on");
    expect(step).not.toHaveTextContent("Turn on");
  });

  test("a project that never turned it on is asked to", async () => {
    stubLogSource(null);
    renderEmptyState();

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
        ),
      ).toHaveAttribute("data-state", "off");
    });
  });

  test("a read that failed still offers the switch", async () => {
    modelListMock.mockRejectedValue(new Error("network") as never);
    renderEmptyState();

    const step: HTMLElement = screen.getByTestId(
      `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
    );

    await waitFor(() => {
      expect(step).toHaveAttribute("data-state", "unknown");
    });
    expect(step).toHaveTextContent("Turn on Your logs");
  });

  test("names the security records read in a device's syslog", () => {
    renderEmptyState();

    const formats: HTMLElement = screen.getByTestId(
      `${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-formats`,
    );

    for (const name of [
      "CEF",
      "LEEF",
      "Palo Alto Networks",
      "Fortinet FortiGate",
      "Cisco ASA",
    ]) {
      expect(formats).toHaveTextContent(name);
    }
  });
});
