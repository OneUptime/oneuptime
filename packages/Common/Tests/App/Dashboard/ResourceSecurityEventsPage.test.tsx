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
import DockerHostSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/SecurityEvents";
import PodmanHostSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/SecurityEvents";
import OpenStackCloudSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/SecurityEvents";
import ServiceViewSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/SecurityEvents";
import CloudResourceSecurityEvents, {
  CLOUD_RESOURCE_NO_SECURITY_EVENTS_DESCRIPTION,
  CLOUD_RESOURCE_NO_SECURITY_EVENTS_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/SecurityEvents";
import ServerlessFunctionSecurityEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/SecurityEvents";
import {
  CLOUD_RESOURCE_WITHOUT_ID_LANDS_HERE,
  FUNCTION_ACCOUNT_STEP,
  OPENSTACK_AUDIT_TRAIL_STEP,
  RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID,
  RESOURCE_SECURITY_EVENTS_WHAT_LANDS_HERE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsEmptyState";
import { FaasCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsScope";
import { RESOURCE_SECURITY_EVENTS_READ_FAILED } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsPage";
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

/*
 * A Docker or Podman host's, an OpenStack cloud's and a service's own
 * Security Events pages (#9628): the same page, handed each kind, with an
 * empty state that says where that kind's own events come from.
 */
const RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

/*
 * Your logs, Traces and Cloud audit logs, each on or off; null for a
 * project that never set it up.
 */
function stubSources(sources: {
  logs?: Partial<SecurityLogSource> | null;
  traces?: Partial<SecurityTelemetrySource> | null;
  cloudAudit?: Partial<SecurityTelemetrySource> | null;
}): void {
  modelListMock.mockImplementation(
    async (
      args: unknown,
    ): Promise<ListResult<SecurityLogSource | SecurityTelemetrySource>> => {
      const request: { modelType: unknown; query?: { kind?: unknown } } =
        args as { modelType: unknown; query?: { kind?: unknown } };
      const isTelemetry: boolean =
        request.modelType === SecurityTelemetrySource;
      const telemetry: Partial<SecurityTelemetrySource> | null | undefined =
        request.query?.kind === SecurityTelemetrySourceKind.CloudAudit
          ? sources.cloudAudit
          : sources.traces;
      const row: SecurityLogSource | SecurityTelemetrySource | null =
        isTelemetry
          ? telemetry
            ? Object.assign(new SecurityTelemetrySource(), telemetry)
            : null
          : sources.logs
            ? Object.assign(new SecurityLogSource(), sources.logs)
            : null;

      return { data: row ? [row] : [], count: row ? 1 : 0, skip: 0, limit: 1 };
    },
  );
}

// The project's telemetry sources the page read, by kind.
function telemetrySourceKindsRead(): Array<unknown> {
  return modelListMock.mock.calls
    .map((call: Array<unknown>): { modelType: unknown; query?: unknown } => {
      return call[0] as { modelType: unknown; query?: unknown };
    })
    .filter((args: { modelType: unknown }): boolean => {
      return args.modelType === SecurityTelemetrySource;
    })
    .map((args: { query?: unknown }): unknown => {
      return (args.query as { kind?: unknown } | undefined)?.kind;
    });
}

function stepIds(steps: Array<HTMLElement>): Array<string | null> {
  return steps.map((step: HTMLElement): string | null => {
    return step.getAttribute("data-testid");
  });
}

function stepId(id: string): string {
  return `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-${id}`;
}

interface RecordPage {
  kind: SecurityConnectionKind;
  chipKey: string;
  title: string;
  whatLandsHere: string;
  draw: () => ReactElement;
}

const RECORD_PAGES: Array<[string, RecordPage]> = [
  [
    "a Docker host",
    {
      kind: SecurityConnectionKind.DockerHost,
      chipKey: "Docker Host",
      title: "No security events about this host yet",
      whatLandsHere: "in the logs of this host's containers",
      draw: (): ReactElement => {
        return (
          <DockerHostSecurityEvents
            pageRoute={
              RouteMap[PageMap.DOCKER_HOST_VIEW_SECURITY_EVENTS] as Route
            }
            currentProject={project()}
            hasPaymentMethod={true}
          />
        );
      },
    },
  ],
  [
    "a Podman host",
    {
      kind: SecurityConnectionKind.PodmanHost,
      chipKey: "Podman Host",
      title: "No security events about this host yet",
      whatLandsHere: "in the logs of this host's containers",
      draw: (): ReactElement => {
        return (
          <PodmanHostSecurityEvents
            pageRoute={
              RouteMap[PageMap.PODMAN_HOST_VIEW_SECURITY_EVENTS] as Route
            }
            currentProject={project()}
            hasPaymentMethod={true}
          />
        );
      },
    },
  ],
  [
    "an OpenStack cloud",
    {
      kind: SecurityConnectionKind.OpenStackCloud,
      chipKey: "OpenStack Cloud",
      title: "No security events about this cloud yet",
      whatLandsHere: "in this cloud's own logs",
      draw: (): ReactElement => {
        return (
          <OpenStackCloudSecurityEvents
            pageRoute={
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SECURITY_EVENTS] as Route
            }
            currentProject={project()}
            hasPaymentMethod={true}
          />
        );
      },
    },
  ],
  [
    "a service",
    {
      kind: SecurityConnectionKind.Service,
      chipKey: "Service",
      title: "No security events about this service yet",
      whatLandsHere: "in this service's own logs and traces",
      draw: (): ReactElement => {
        return (
          <ServiceViewSecurityEvents
            pageRoute={RouteMap[PageMap.SERVICE_VIEW_SECURITY_EVENTS] as Route}
            currentProject={project()}
            hasPaymentMethod={true}
          />
        );
      },
    },
  ],
];

describe.each(RECORD_PAGES)(
  "%s's Security Events page",
  (_label: string, page: RecordPage) => {
    beforeEach(() => {
      jest
        .spyOn(Navigation, "getLastParamAsObjectID")
        .mockReturnValue(RECORD_ID);
      scopeMock.mockResolvedValue(
        scopeOf(page.kind, RECORD_ID, "prod", ["prod"]) as never,
      );
      stubSources({});
    });

    async function renderedEmptyState(): Promise<HTMLElement> {
      render(<MemoryRouter>{page.draw()}</MemoryRouter>);

      const viewer: HTMLElement = await screen.findByTestId(
        "security-events-viewer-stub",
      );

      return within(viewer).getByTestId(
        RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID,
      );
    }

    test("asks for its own scope, and names the record on the chip by its kind", async () => {
      render(<MemoryRouter>{page.draw()}</MemoryRouter>);

      const viewer: HTMLElement = await screen.findByTestId(
        "security-events-viewer-stub",
      );

      expect(scopeMock.mock.calls[0]![0]).toEqual({
        kind: page.kind,
        id: RECORD_ID,
      });
      expect(viewer).toHaveAttribute("data-chip-key", page.chipKey);
      expect(viewer).toHaveAttribute("data-chip-value", "prod");
      expect(viewer).toHaveAttribute("data-chip-read-only", "true");
    });

    test("its empty state names the kind of record and where its events come from", async () => {
      const empty: HTMLElement = await renderedEmptyState();

      expect(empty).toHaveAttribute("data-kind", page.kind);
      expect(empty).toHaveTextContent(page.title);
      expect(empty).toHaveTextContent(page.whatLandsHere);
      expect(
        within(empty).getByTestId(
          `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
        ),
      ).toBeInTheDocument();
      // A cluster's audit log is a cluster's alone.
      expect(
        within(empty).queryByTestId(
          `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-audit-log`,
        ),
      ).toBeNull();
    });
  },
);

describe("an OpenStack cloud's empty state", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
    scopeMock.mockResolvedValue(
      scopeOf(SecurityConnectionKind.OpenStackCloud, RECORD_ID, "prod", [
        "prod",
      ]) as never,
    );
    stubSources({});
  });

  test("starts with the cloud's audit trail, then Your logs", async () => {
    render(<MemoryRouter>{RECORD_PAGES[2]![1].draw()}</MemoryRouter>);

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );
    const steps: Array<HTMLElement> = within(viewer).getAllByRole("listitem");

    expect(
      steps.map((step: HTMLElement): string | null => {
        return step.getAttribute("data-testid");
      }),
    ).toEqual([
      `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-audit-trail`,
      `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
    ]);
    expect(steps[0]).toHaveTextContent(OPENSTACK_AUDIT_TRAIL_STEP);
  });
});

describe("a service's empty state", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
    scopeMock.mockResolvedValue({
      kind: SecurityConnectionKind.Service,
      id: RECORD_ID.toString(),
      name: "checkout",
      values: [],
      isSearchedByLogs: true,
      scope: {
        observables: [],
        attributeKey: "oneuptime.log.resource.id",
        attributeValues: [RECORD_ID.toString()],
      },
    } as never);
  });

  async function renderedSteps(): Promise<Array<HTMLElement>> {
    render(<MemoryRouter>{RECORD_PAGES[3]![1].draw()}</MemoryRouter>);

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    return within(viewer).getAllByRole("listitem");
  }

  test("asks for Your logs, then Traces, while neither is on", async () => {
    stubSources({});

    const steps: Array<HTMLElement> = await renderedSteps();

    expect(
      steps.map((step: HTMLElement): string | null => {
        return step.getAttribute("data-testid");
      }),
    ).toEqual([
      `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
      `${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-traces`,
    ]);
    expect(
      await within(steps[1]!).findByText("Turn on Traces", { exact: false }),
    ).toBeInTheDocument();
  });

  test("with Traces on already, it says so rather than asking for it", async () => {
    stubSources({ traces: { isEnabled: true } });

    const steps: Array<HTMLElement> = await renderedSteps();

    expect(
      await within(steps[1]!).findByText("Traces is on", { exact: false }),
    ).toBeInTheDocument();
    expect(steps[1]).toHaveAttribute("data-state", "on");
  });

  test("reads the project's Traces source, and only it, for the step", async () => {
    stubSources({});

    await renderedSteps();

    const tracesRead: unknown = modelListMock.mock.calls
      .map((call: Array<unknown>): unknown => {
        return call[0];
      })
      .find((args: unknown): boolean => {
        return (
          (args as { modelType: unknown }).modelType === SecurityTelemetrySource
        );
      });

    expect(tracesRead).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        kind: SecurityTelemetrySourceKind.Traces,
      },
      limit: 1,
    });
  });

  test("a Docker host's empty state reads no Traces source", async () => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
    scopeMock.mockResolvedValue(
      scopeOf(SecurityConnectionKind.DockerHost, RECORD_ID, "prod", [
        "prod",
      ]) as never,
    );
    stubSources({});

    render(<MemoryRouter>{RECORD_PAGES[0]![1].draw()}</MemoryRouter>);

    await screen.findByTestId("security-events-viewer-stub");

    expect(
      modelListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType ===
          SecurityTelemetrySource
        );
      }),
    ).toBe(false);
  });
});

/*
 * A CLOUD RESOURCE'S SECURITY EVENTS PAGE (#9779): the shared page, handed
 * the resource, once the resource itself is read - its cloud, its type and
 * its ID decide what its empty state asks for, and whether any event can
 * reach it at all.
 */
const BUCKET_ARN: string = "arn:aws:s3:::payments-bucket";
const VAULT_ID: string =
  "/subscriptions/00000000-0000-4000-8000-000000000000/resourceGroups/prod/providers/Microsoft.KeyVault/vaults/payments-vault";

let getItemMock: MockFunction;

function stubRecord(item: Record<string, unknown> | null): void {
  getItemMock = jest.spyOn(ModelAPI, "getItem") as unknown as MockFunction;
  getItemMock.mockResolvedValue(item as never);
}

describe("a cloud resource's Security Events page", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
    scopeMock.mockResolvedValue(
      scopeOf(SecurityConnectionKind.CloudResource, RECORD_ID, "payments", [
        BUCKET_ARN,
      ]) as never,
    );
    stubSources({});
    stubRecord({
      cloudProvider: "aws",
      cloudResourceType: "AWS::S3::Bucket",
      providerResourceId: BUCKET_ARN,
    });
  });

  function renderPage(): void {
    render(
      <MemoryRouter>
        <CloudResourceSecurityEvents
          pageRoute={
            RouteMap[PageMap.CLOUD_RESOURCE_VIEW_SECURITY_EVENTS] as Route
          }
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  async function renderedEmptyState(): Promise<HTMLElement> {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    return within(viewer).getByTestId(RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID);
  }

  test("reads the resource, then asks for its scope and names it on a locked chip", async () => {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(getItemMock.mock.calls[0]![0]).toMatchObject({
      id: RECORD_ID,
      select: {
        cloudProvider: true,
        cloudResourceType: true,
        providerResourceId: true,
        cloudEndpoints: true,
      },
    });
    expect(scopeMock.mock.calls[0]![0]).toEqual({
      kind: SecurityConnectionKind.CloudResource,
      id: RECORD_ID,
    });
    expect(viewer).toHaveAttribute("data-chip-key", "Cloud Resource");
    expect(viewer).toHaveAttribute("data-chip-value", "payments");
    expect(viewer).toHaveAttribute("data-chip-read-only", "true");
  });

  test("an S3 bucket's starts with its account's audit log, then its data events: it sends no logs of its own", async () => {
    const empty: HTMLElement = await renderedEmptyState();
    const steps: Array<HTMLElement> = within(empty).getAllByRole("listitem");

    expect(empty).toHaveAttribute(
      "data-kind",
      SecurityConnectionKind.CloudResource,
    );
    expect(empty).toHaveTextContent(
      "No security events about this cloud resource yet",
    );
    expect(empty).toHaveTextContent(
      RESOURCE_SECURITY_EVENTS_WHAT_LANDS_HERE[
        SecurityConnectionKind.CloudResource
      ]!,
    );
    expect(stepIds(steps)).toEqual([
      stepId("cloud-audit-logs"),
      stepId("cloudtrail-data-events"),
    ]);
    expect(
      await within(steps[0]!).findByText("Turn on Cloud audit logs", {
        exact: false,
      }),
    ).toBeInTheDocument();
    // Read, and off: asked for, not said to be on.
    await waitFor(() => {
      expect(
        within(empty).getByTestId(stepId("cloud-audit-logs")),
      ).toHaveAttribute("data-state", "off");
    });
    expect(steps[1]).toHaveTextContent(
      "deliver a CloudTrail trail to CloudWatch Logs",
    );
    // The data events' trail is set up on Cloud's Connect page.
    expect(within(steps[1]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("/cloud/connect"),
    );
  });

  test("with Cloud audit logs on already, it says so rather than asking for it", async () => {
    stubSources({ cloudAudit: { isEnabled: true } });

    const empty: HTMLElement = await renderedEmptyState();
    const step: HTMLElement = within(empty).getByTestId(
      stepId("cloud-audit-logs"),
    );

    expect(
      await within(step).findByText("Cloud audit logs is on", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(step).toHaveAttribute("data-state", "on");
  });

  test("reads the project's Cloud audit logs source for the step, and no Traces", async () => {
    await renderedEmptyState();

    expect(telemetrySourceKindsRead()).toEqual([
      SecurityTelemetrySourceKind.CloudAudit,
    ]);
  });

  test("an Azure key vault's: its Activity Log, then Your logs - and no CloudTrail step", async () => {
    stubRecord({
      cloudProvider: "azure",
      cloudResourceType: "Microsoft.KeyVault/vaults",
      providerResourceId: VAULT_ID,
    });

    const empty: HTMLElement = await renderedEmptyState();

    expect(stepIds(within(empty).getAllByRole("listitem"))).toEqual([
      stepId("cloud-audit-logs"),
      stepId("your-logs"),
    ]);
  });

  test("a Lambda function's resource: its audit log, Your logs, then its data events", async () => {
    stubRecord({
      cloudProvider: "aws",
      cloudResourceType: "AWS::Lambda::Function",
      providerResourceId:
        "arn:aws:lambda:us-east-1:111122223333:function:checkout",
    });

    const empty: HTMLElement = await renderedEmptyState();

    expect(stepIds(within(empty).getAllByRole("listitem"))).toEqual([
      stepId("cloud-audit-logs"),
      stepId("your-logs"),
      stepId("cloudtrail-data-events"),
    ]);
  });

  test("a resource kept by a stand-in no audit record names is read by its own logs: no audit-log step", async () => {
    stubRecord({
      cloudProvider: "aws",
      cloudResourceType: "AWS::DocDB::DBCluster",
      providerResourceId: "AWS/DocDB DBClusterIdentifier=orders",
    });

    const empty: HTMLElement = await renderedEmptyState();

    expect(empty).toHaveTextContent(CLOUD_RESOURCE_WITHOUT_ID_LANDS_HERE);
    expect(stepIds(within(empty).getAllByRole("listitem"))).toEqual([
      stepId("your-logs"),
    ]);
    expect(telemetrySourceKindsRead()).toEqual([]);
  });

  test("one reached only by the name it answers on lists no step: nothing is to be turned on", async () => {
    stubRecord({
      cloudProvider: "aws",
      cloudResourceType: "AWS::AmazonMQ::Broker",
      providerResourceId: "AWS/AmazonMQ Broker=orders",
      cloudEndpoints: ["b-1234.mq.us-east-1.amazonaws.com"],
    });

    const empty: HTMLElement = await renderedEmptyState();

    expect(empty).toHaveTextContent(CLOUD_RESOURCE_WITHOUT_ID_LANDS_HERE);
    expect(within(empty).queryAllByRole("listitem")).toEqual([]);
  });

  test("a resource no event can reach says why, and asks for no scope", async () => {
    stubRecord({
      cloudProvider: "aws",
      cloudResourceType: "AWS::AmazonMQ::Broker",
      providerResourceId: "AWS/AmazonMQ Broker=orders",
    });

    renderPage();

    expect(
      await screen.findByText(CLOUD_RESOURCE_NO_SECURITY_EVENTS_TITLE),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CLOUD_RESOURCE_NO_SECURITY_EVENTS_DESCRIPTION),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("security-events-viewer-stub")).toBeNull();
    expect(scopeMock).not.toHaveBeenCalled();
  });

  test("a resource that cannot be read says so, and asks for no scope", async () => {
    getItemMock.mockRejectedValue(
      new Error("You do not have permission to read this resource."),
    );

    renderPage();

    expect(
      await screen.findByText(
        "You do not have permission to read this resource.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("security-events-viewer-stub")).toBeNull();
    expect(scopeMock).not.toHaveBeenCalled();
  });
});

/*
 * A SERVERLESS FUNCTION'S SECURITY EVENTS PAGE (#9780): the shared page,
 * handed the function. Its own logs and traces bring its events; its
 * cloud's audit log does too once its telemetry says the account and the
 * Region its ID holds - and until then the page says what to set. An
 * Azure function's ID holds a resource group no telemetry reports: its
 * logs and traces alone.
 */
describe("a serverless function's Security Events page", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
    scopeMock.mockResolvedValue({
      kind: SecurityConnectionKind.ServerlessFunction,
      id: RECORD_ID.toString(),
      name: "checkout",
      values: ["arn:aws:lambda:us-east-1:111122223333:function:checkout"],
      isSearchedByLogs: false,
      scope: {
        observables: [
          "arn:aws:lambda:us-east-1:111122223333:function:checkout",
        ],
        attributeKey: "oneuptime.log.faas.name",
        attributeValues: ["checkout"],
      },
    } as never);
    stubSources({});
    stubRecord({
      functionIdentifier: "checkout",
      cloudProvider: "aws",
      cloudPlatform: FaasCloudPlatform.AwsLambda,
      cloudRegion: "us-east-1",
      cloudAccountId: "111122223333",
    });
  });

  function renderPage(): void {
    render(
      <MemoryRouter>
        <ServerlessFunctionSecurityEvents
          pageRoute={
            RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_SECURITY_EVENTS] as Route
          }
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  async function renderedEmptyState(): Promise<HTMLElement> {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    return within(viewer).getByTestId(RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID);
  }

  test("asks for the function's scope, and names it on a locked chip", async () => {
    renderPage();

    const viewer: HTMLElement = await screen.findByTestId(
      "security-events-viewer-stub",
    );

    expect(scopeMock.mock.calls[0]![0]).toEqual({
      kind: SecurityConnectionKind.ServerlessFunction,
      id: RECORD_ID,
    });
    expect(viewer).toHaveAttribute("data-chip-key", "Serverless Function");
    expect(viewer).toHaveAttribute("data-chip-value", "checkout");
    expect(viewer).toHaveAttribute(
      "data-chip-summary",
      "The security events about it: read from its own logs and traces, or naming it.",
    );
  });

  test("a Lambda function its telemetry names in full: Your logs, Traces, then its account's audit log", async () => {
    const empty: HTMLElement = await renderedEmptyState();
    const steps: Array<HTMLElement> = within(empty).getAllByRole("listitem");

    expect(empty).toHaveTextContent(
      "No security events about this function yet",
    );
    expect(empty).toHaveTextContent("whatever service they are filed under");
    expect(stepIds(steps)).toEqual([
      stepId("your-logs"),
      stepId("traces"),
      stepId("cloud-audit-logs"),
    ]);
    expect(
      await within(steps[1]!).findByText(
        "to read the requests this function answers",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(telemetrySourceKindsRead().sort()).toEqual(
      [
        SecurityTelemetrySourceKind.Traces,
        SecurityTelemetrySourceKind.CloudAudit,
      ].sort(),
    );
  });

  test("a Lambda function whose telemetry reports no account is told what to set", async () => {
    stubRecord({
      functionIdentifier: "checkout",
      cloudProvider: "aws",
      cloudPlatform: FaasCloudPlatform.AwsLambda,
      cloudRegion: "us-east-1",
    });

    const empty: HTMLElement = await renderedEmptyState();
    const steps: Array<HTMLElement> = within(empty).getAllByRole("listitem");

    expect(stepIds(steps)).toEqual([
      stepId("your-logs"),
      stepId("traces"),
      stepId("function-account"),
    ]);
    expect(steps[2]).toHaveTextContent(FUNCTION_ACCOUNT_STEP);
    // Its audit log cannot name it yet: Cloud audit logs is not read.
    expect(telemetrySourceKindsRead()).toEqual([
      SecurityTelemetrySourceKind.Traces,
    ]);
  });

  test("an Azure function's: its logs and traces alone, and nothing to set", async () => {
    stubRecord({
      functionIdentifier: "orders-func",
      cloudProvider: "azure",
      cloudPlatform: FaasCloudPlatform.AzureFunctions,
      cloudRegion: "westeurope",
      cloudAccountId: "00000000-0000-4000-8000-000000000000",
    });

    const empty: HTMLElement = await renderedEmptyState();

    expect(stepIds(within(empty).getAllByRole("listitem"))).toEqual([
      stepId("your-logs"),
      stepId("traces"),
    ]);
  });

  test("with Traces on already, it says so rather than asking for it", async () => {
    stubSources({ traces: { isEnabled: true } });

    const empty: HTMLElement = await renderedEmptyState();
    const step: HTMLElement = within(empty).getByTestId(stepId("traces"));

    expect(
      await within(step).findByText("Traces is on", { exact: false }),
    ).toBeInTheDocument();
    expect(step).toHaveAttribute("data-state", "on");
  });

  test("a function that cannot be read says so, and asks for no scope", async () => {
    getItemMock.mockResolvedValue(null as never);

    renderPage();

    expect(
      await screen.findByText(RESOURCE_SECURITY_EVENTS_READ_FAILED, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(scopeMock).not.toHaveBeenCalled();
  });
});
