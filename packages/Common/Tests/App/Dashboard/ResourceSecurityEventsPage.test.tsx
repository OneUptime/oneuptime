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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * A HOST'S AND A CLUSTER'S SECURITY EVENTS PAGES (#9547), rendered.
 *
 * Each asks the server for its record's scope - the events naming the host
 * or the cluster, or read from its own logs - and hands it to the Security
 * Events explorer with a locked chip naming the record, and an empty state
 * that says what lands here and what brings it: a cluster's audit log, Your
 * logs. Without the scope nothing is read.
 *
 * The explorer itself is stubbed, to read what it is handed.
 */

interface StubViewerProps {
  scope?: {
    query: unknown;
    chip: {
      displayKey: string;
      displayValue: string;
      readOnly?: boolean;
      lockedDetail?: { scopeSummary?: string };
    };
    emptyContent: ReactElement;
  };
}

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
            "data-scope": JSON.stringify(props.scope?.query ?? null),
            "data-chip-key": props.scope?.chip.displayKey ?? "",
            "data-chip-value": props.scope?.chip.displayValue ?? "",
            "data-chip-read-only": String(props.scope?.chip.readOnly === true),
            "data-chip-summary": props.scope?.chip.lockedDetail?.scopeSummary,
          },
          props.scope?.emptyContent,
        );
      },
    };
  },
);

import HostSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SecurityEvents";
import KubernetesClusterSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SecurityEvents";
import { RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsEmptyState";
import { RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsScope";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
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
const HOST_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function scopeOf(
  kind: SecurityConnectionKind,
  id: ObjectID,
  name: string,
  values: Array<string>,
): ResourceSecurityScopeJson {
  return {
    kind,
    id: id.toString(),
    name,
    values,
    isSearchedByLogs: false,
    scope: { observables: values },
  };
}

let scopeMock: MockFunction;
let modelListMock: MockFunction;

function project(): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  return value;
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
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  scopeMock = jest.spyOn(
    SecurityCaseApi,
    "getResourceSecurityScope",
  ) as unknown as MockFunction;
  modelListMock = jest.spyOn(ModelAPI, "getList") as unknown as MockFunction;
  stubLogSource(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a host's Security Events page", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(HOST_ID);
    scopeMock.mockResolvedValue(
      scopeOf(SecurityConnectionKind.Host, HOST_ID, "web-1", [
        "web-1",
        "203.0.113.20",
      ]) as never,
    );
  });

  function renderHostPage(): void {
    render(
      <MemoryRouter>
        <HostSecurityEvents
          pageRoute={RouteMap[PageMap.HOST_VIEW_SECURITY_EVENTS] as Route}
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  test("asks for the host's scope and hands it to the explorer, locked, naming the host", async () => {
    renderHostPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(scopeMock.mock.calls[0]![0]).toEqual({
      kind: SecurityConnectionKind.Host,
      id: HOST_ID,
    });
    expect(JSON.parse(viewer.getAttribute("data-scope") || "null")).toEqual({
      observables: ["web-1", "203.0.113.20"],
    });
    expect(viewer).toHaveAttribute("data-chip-key", "Host");
    expect(viewer).toHaveAttribute("data-chip-value", "web-1");
    expect(viewer).toHaveAttribute("data-chip-read-only", "true");
    expect(viewer).toHaveAttribute(
      "data-chip-summary",
      RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING,
    );
  });

  test("its empty state names the host, and the one step: Your logs", async () => {
    renderHostPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );
    const empty: HTMLElement = within(viewer).getByTestId(
      RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID,
    );

    expect(empty).toHaveAttribute("data-kind", SecurityConnectionKind.Host);
    expect(empty).toHaveTextContent("No security events about this host yet");
    expect(
      within(empty).queryByTestId(
        `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-audit-log`,
      ),
    ).toBeNull();
    expect(
      await within(empty).findByText("Turn on Your logs", { exact: false }),
    ).toBeInTheDocument();
  });

  test("with Your logs on already, it says so rather than asking for it", async () => {
    stubLogSource({ isEnabled: true });

    renderHostPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(
      await within(viewer).findByText("Your logs is on", { exact: false }),
    ).toBeInTheDocument();
  });

  test("a scope that could not be read is said, and nothing is read in its place", async () => {
    scopeMock.mockRejectedValue(
      new Error("This record could not be found.") as never,
    );

    renderHostPage();

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

    renderHostPage();

    expect(
      await screen.findByText(
        "You do not have permission to read this Security Event.",
      ),
    ).toBeInTheDocument();
    expect(scopeMock).not.toHaveBeenCalled();
  });
});

describe("a cluster's Security Events page", () => {
  beforeEach(() => {
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(CLUSTER_ID);
    scopeMock.mockResolvedValue(
      scopeOf(SecurityConnectionKind.KubernetesCluster, CLUSTER_ID, "prod-eu", [
        "prod-eu",
      ]) as never,
    );
  });

  function renderClusterPage(): void {
    render(
      <MemoryRouter>
        <KubernetesClusterSecurityEvents
          pageRoute={
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS] as Route
          }
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  test("asks for the cluster's scope, and names the cluster on the chip", async () => {
    renderClusterPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(scopeMock.mock.calls[0]![0]).toEqual({
      kind: SecurityConnectionKind.KubernetesCluster,
      id: CLUSTER_ID,
    });
    expect(viewer).toHaveAttribute("data-chip-key", "Kubernetes Cluster");
    expect(viewer).toHaveAttribute("data-chip-value", "prod-eu");
  });

  test("its empty state starts with the cluster's audit log, then Your logs", async () => {
    renderClusterPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );
    const empty: HTMLElement = within(viewer).getByTestId(
      RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID,
    );

    expect(empty).toHaveTextContent(
      "No security events about this cluster yet",
    );
    expect(
      within(empty).getByTestId(
        `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-audit-log`,
      ),
    ).toHaveTextContent("auditLogs.enabled");
    expect(
      within(empty).getByTestId(
        `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
      ),
    ).toBeInTheDocument();
  });
});
