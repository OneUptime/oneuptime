import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A resource's Logs tab (Kubernetes, Host, Inventory, ...) used to wrap its
 * logs viewer in a Card with a "Cluster Logs"-style heading, while the
 * Traces and Metrics tabs next to it render their viewer bare. The Logs tabs
 * now render bare too.
 *
 * These render the real pages with the viewers replaced by markers and Card
 * replaced by a labelled <section data-testid="card"> (the real Card carries
 * the same test id), then check the DOM: the viewer is the page's root
 * element, no card is rendered around it, the viewer's configuration
 * survived, and the loading / error / not-found states still render without
 * a card. App/Tests/Dashboard/ResourceTelemetryTabsBareLayout.test.ts pins the
 * same rule across every tab's source, including tabs added later.
 */

const MODEL_ID_STRING: string = "84858d6c-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const logsViewerMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: { title?: string; children?: React.ReactNode }) => {
      return (
        <section data-testid="card" aria-label={props.title}>
          {props.children}
        </section>
      );
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="component-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceConnectBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="cloud-connect-banner" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        logsViewerMock(props);
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="metrics-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="traces-viewer" />;
      },
    };
  },
);

import CephLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Logs";
import CephMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Metrics";
import CloudLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Logs";
import CloudMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Metrics";
import CloudTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Traces";
import DockerLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Logs";
import DockerTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Traces";
import DockerSwarmLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Logs";
import DockerSwarmMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Metrics";
import HostLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Logs";
import HostMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Metrics";
import HostTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Traces";
import InventoryLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/Logs";
import InventoryMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/Metrics";
import InventoryTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/Traces";
import IoTLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Logs";
import IoTMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Metrics";
import KubernetesLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Logs";
import KubernetesMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Metrics";
import KubernetesTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Traces";
import NetworkDeviceLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Logs";
import PodmanLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Logs";
import PodmanTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Traces";
import ProxmoxLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Logs";
import ProxmoxMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Metrics";
import RumLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Logs";
import RumMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Metrics";
import RumTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Traces";
import ServerlessLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Logs";
import ServerlessMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Metrics";
import ServerlessTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Traces";
import VMwareLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Logs";
import VMwareMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

type PageComponent = React.FunctionComponent<PageComponentProps>;

type ViewerProps = Record<string, unknown>;

type Fixture = Record<string, unknown>;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const CLUSTER: Fixture = { name: "prod-cluster" };
const IDENTIFIED_HOST: Fixture = {
  hostIdentifier: "ip-10-0-0-12",
  name: "Payments DB",
};
const KUBERNETES_CLUSTER: Fixture = {
  clusterIdentifier: "prod-eks-01",
  name: "Production EKS",
};
const CLOUD_ENVIRONMENT: Fixture = {
  resourceIdentifier: "aws_ecs:123456789012:us-east-1",
  name: "Production ECS",
  cloudPlatform: "aws_ecs",
  cloudAccountId: "123456789012",
  cloudRegion: "us-east-1",
};
const INVENTORY_ITEM: Fixture = {
  entityKey: "10000000-0000-4000-8000-000000000001:host:db-01",
  displayName: "db-01",
};
const RUM_APPLICATION: Fixture = {
  appIdentifier: "checkout-web-key",
  name: "Checkout Web",
};
const SERVERLESS_FUNCTION: Fixture = {
  functionIdentifier: "checkout-handler",
  name: "Checkout Handler",
};
const NETWORK_DEVICE: Fixture = { name: "core-sw-01" };

const NETWORK_DEVICE_GUIDE_TITLE: string = "Setting up device logging";

interface LogsTabCase {
  Page: PageComponent;
  item: Fixture;
  // The heading of the card the viewer used to sit in.
  removedCardTitle: string;
  viewerId: string;
  loaderTestId: string;
  // null: the page renders the logs even when its lookup fails.
  notFoundMessage: string | null;
  // Cards the page still renders on purpose, outside the viewer.
  remainingCardTitles: Array<string>;
}

const LOGS_TABS: Record<string, LogsTabCase> = {
  Ceph: {
    Page: CephLogs,
    item: CLUSTER,
    removedCardTitle: "Cluster Logs",
    viewerId: `ceph-cluster-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Cluster not found.",
    remainingCardTitles: [],
  },
  Cloud: {
    Page: CloudLogs,
    item: CLOUD_ENVIRONMENT,
    removedCardTitle: "Cloud Environment Logs",
    viewerId: `cloud-resource-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Cloud environment not found.",
    remainingCardTitles: [],
  },
  Docker: {
    Page: DockerLogs,
    item: IDENTIFIED_HOST,
    removedCardTitle: "Container Logs",
    viewerId: `docker-host-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Host not found.",
    remainingCardTitles: [],
  },
  DockerSwarm: {
    Page: DockerSwarmLogs,
    item: CLUSTER,
    removedCardTitle: "Cluster Logs",
    viewerId: `docker-swarm-cluster-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Cluster not found.",
    remainingCardTitles: [],
  },
  Host: {
    Page: HostLogs,
    item: IDENTIFIED_HOST,
    removedCardTitle: "Host Logs",
    viewerId: `host-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Host not found.",
    remainingCardTitles: [],
  },
  Inventory: {
    Page: InventoryLogs,
    item: INVENTORY_ITEM,
    removedCardTitle: "Logs",
    viewerId: `inventory-item-logs-${MODEL_ID_STRING}`,
    loaderTestId: "component-loader",
    notFoundMessage: "This inventory item could not be found.",
    remainingCardTitles: [],
  },
  IoT: {
    Page: IoTLogs,
    item: CLUSTER,
    removedCardTitle: "Fleet Logs",
    viewerId: `iot-fleet-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Fleet not found.",
    remainingCardTitles: [],
  },
  Kubernetes: {
    Page: KubernetesLogs,
    item: KUBERNETES_CLUSTER,
    removedCardTitle: "Cluster Logs",
    viewerId: `kubernetes-cluster-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Cluster not found.",
    remainingCardTitles: [],
  },
  NetworkDevice: {
    Page: NetworkDeviceLogs,
    item: NETWORK_DEVICE,
    removedCardTitle: "Device Logs",
    viewerId: `network-device-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: null,
    remainingCardTitles: [NETWORK_DEVICE_GUIDE_TITLE],
  },
  Podman: {
    Page: PodmanLogs,
    item: IDENTIFIED_HOST,
    removedCardTitle: "Container Logs",
    viewerId: `podman-host-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Host not found.",
    remainingCardTitles: [],
  },
  Proxmox: {
    Page: ProxmoxLogs,
    item: CLUSTER,
    removedCardTitle: "Cluster Logs",
    viewerId: `proxmox-cluster-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Cluster not found.",
    remainingCardTitles: [],
  },
  Rum: {
    Page: RumLogs,
    item: RUM_APPLICATION,
    removedCardTitle: "RUM Application Logs",
    viewerId: `rum-application-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "RUM application not found.",
    remainingCardTitles: [],
  },
  Serverless: {
    Page: ServerlessLogs,
    item: SERVERLESS_FUNCTION,
    removedCardTitle: "Function Logs",
    viewerId: `serverless-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "Serverless function not found.",
    remainingCardTitles: [],
  },
  VMware: {
    Page: VMwareLogs,
    item: CLUSTER,
    removedCardTitle: "vCenter Logs",
    viewerId: `vmware-vcenter-logs-${MODEL_ID_STRING}`,
    loaderTestId: "page-loader",
    notFoundMessage: "vCenter not found.",
    remainingCardTitles: [],
  },
};

const LOGS_TAB_TABLE: Array<[string, LogsTabCase]> = Object.entries(LOGS_TABS);

const LOOKUP_FAILURE_TABLE: Array<[string, LogsTabCase]> =
  LOGS_TAB_TABLE.filter((row: [string, LogsTabCase]) => {
    return row[1].notFoundMessage !== null;
  });

type CardTitlesFunction = () => Array<string | null>;

const renderedCardTitles: CardTitlesFunction = (): Array<string | null> => {
  return screen.queryAllByTestId("card").map((card: HTMLElement) => {
    return card.getAttribute("aria-label");
  });
};

type LastViewerPropsFunction = () => ViewerProps;

const lastViewerProps: LastViewerPropsFunction = (): ViewerProps => {
  const calls: Array<Array<unknown>> = logsViewerMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
};

type NeverSettlesFunction = () => Promise<unknown>;

const neverSettles: NeverSettlesFunction = (): Promise<unknown> => {
  return new Promise(() => {});
};

beforeEach(() => {
  getItemMock.mockReset();
  logsViewerMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("resource Logs tabs render the logs viewer bare", () => {
  test.each(LOGS_TAB_TABLE)(
    "%s: the viewer is the page's root element",
    async (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockResolvedValue(tab.item);

      const { container } = render(<tab.Page {...PAGE_PROPS} />);
      const viewer: HTMLElement = await screen.findByTestId("logs-viewer");

      expect(container.firstElementChild).toBe(viewer);
      expect(viewer.closest("[data-testid='card']")).toBeNull();
    },
  );

  test.each(LOGS_TAB_TABLE)(
    "%s: the old card heading is not rendered, and no other card is added",
    async (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockResolvedValue(tab.item);

      render(<tab.Page {...PAGE_PROPS} />);
      await screen.findByTestId("logs-viewer");

      expect(screen.queryByText(tab.removedCardTitle)).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText(tab.removedCardTitle),
      ).not.toBeInTheDocument();
      expect(renderedCardTitles()).toEqual(tab.remainingCardTitles);
    },
  );

  test.each(LOGS_TAB_TABLE)(
    "%s: exactly one viewer mounts, with its id, filter bar, live tail and empty state intact",
    async (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockResolvedValue(tab.item);

      render(<tab.Page {...PAGE_PROPS} />);
      await screen.findByTestId("logs-viewer");

      expect(screen.getAllByTestId("logs-viewer")).toHaveLength(1);

      const props: ViewerProps = lastViewerProps();

      expect(props["id"]).toBe(tab.viewerId);
      expect(props["showFilters"]).toBe(true);
      expect(props["enableRealtime"]).toBe(true);
      expect(typeof props["noLogsMessage"]).toBe("string");
      expect((props["noLogsMessage"] as string).length).toBeGreaterThan(0);
    },
  );

  test.each(LOGS_TAB_TABLE)(
    "%s: while the lookup is pending only the loader renders, with no card",
    (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockReturnValue(neverSettles());

      const { container } = render(<tab.Page {...PAGE_PROPS} />);

      expect(container.firstElementChild).toBe(
        screen.getByTestId(tab.loaderTestId),
      );
      expect(renderedCardTitles()).toEqual([]);
      expect(logsViewerMock).not.toHaveBeenCalled();
    },
  );

  test.each(LOOKUP_FAILURE_TABLE)(
    "%s: a failed lookup renders only the error, with no card",
    async (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockRejectedValue(new Error("Could not reach the API"));

      const { container } = render(<tab.Page {...PAGE_PROPS} />);
      const error: HTMLElement = await screen.findByTestId("error-message");

      expect(error).toHaveTextContent("Could not reach the API");
      expect(container.firstElementChild).toBe(error);
      expect(renderedCardTitles()).toEqual([]);
      expect(logsViewerMock).not.toHaveBeenCalled();
    },
  );

  test.each(LOOKUP_FAILURE_TABLE)(
    "%s: a missing resource renders only the not-found message, with no card",
    async (_resource: string, tab: LogsTabCase) => {
      getItemMock.mockResolvedValue(null);

      const { container } = render(<tab.Page {...PAGE_PROPS} />);
      const error: HTMLElement = await screen.findByTestId("error-message");

      expect(error).toHaveTextContent(tab.notFoundMessage!);
      expect(container.firstElementChild).toBe(error);
      expect(renderedCardTitles()).toEqual([]);
      expect(logsViewerMock).not.toHaveBeenCalled();
    },
  );
});

describe("NetworkDevice Logs keeps its setup guide below the bare viewer", () => {
  test("the guide card follows the viewer as a spaced sibling, not a wrapper", async () => {
    getItemMock.mockResolvedValue(NETWORK_DEVICE);

    const { container } = render(<NetworkDeviceLogs {...PAGE_PROPS} />);
    const viewer: HTMLElement = await screen.findByTestId("logs-viewer");
    const guide: HTMLElement = screen.getByLabelText(
      NETWORK_DEVICE_GUIDE_TITLE,
    );

    expect(container.firstElementChild).toBe(viewer);
    expect(guide.contains(viewer)).toBe(false);
    expect(guide.parentElement).toHaveClass("mt-4");
    expect(guide.parentElement!.previousElementSibling).toBe(viewer);
    expect(guide.parentElement!.parentElement).toBe(container);
  });

  test("the guide still explains how device logs reach the probe", async () => {
    getItemMock.mockResolvedValue(NETWORK_DEVICE);

    render(<NetworkDeviceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    const guide: HTMLElement = screen.getByLabelText(
      NETWORK_DEVICE_GUIDE_TITLE,
    );

    expect(guide).toHaveTextContent("PROBE_SYSLOG_RECEIVER_ENABLED=true");
    expect(guide).toHaveTextContent("UDP port 162");
    expect(guide).toHaveTextContent("UDP port 5140");
  });

  test("a failed name lookup still renders the bare viewer and the guide", async () => {
    getItemMock.mockRejectedValue(new Error("Network error"));

    const { container } = render(<NetworkDeviceLogs {...PAGE_PROPS} />);
    const viewer: HTMLElement = await screen.findByTestId("logs-viewer");

    expect(container.firstElementChild).toBe(viewer);
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
    expect(renderedCardTitles()).toEqual([NETWORK_DEVICE_GUIDE_TITLE]);
  });
});

describe("Cloud Logs for an environment without a platform", () => {
  test("shows the connect banner alone: no viewer, no card", async () => {
    getItemMock.mockResolvedValue({
      resourceIdentifier: "unscoped-environment",
      name: "Unscoped",
    });

    const { container } = render(<CloudLogs {...PAGE_PROPS} />);
    const banner: HTMLElement = await screen.findByTestId(
      "cloud-connect-banner",
    );

    expect(container.firstElementChild).toBe(banner);
    expect(logsViewerMock).not.toHaveBeenCalled();
    expect(renderedCardTitles()).toEqual([]);
  });
});

/*
 * The shape the Logs tabs now share with their sibling tabs: for each
 * resource, every signal tab's first rendered element is that tab's viewer.
 */
const SIGNAL_TAB_TABLE: Array<
  [string, string, PageComponent, string, Fixture]
> = [
  ["Ceph", "Logs", CephLogs, "logs-viewer", CLUSTER],
  ["Ceph", "Metrics", CephMetrics, "metrics-viewer", CLUSTER],
  ["Cloud", "Logs", CloudLogs, "logs-viewer", CLOUD_ENVIRONMENT],
  ["Cloud", "Traces", CloudTraces, "traces-viewer", CLOUD_ENVIRONMENT],
  ["Cloud", "Metrics", CloudMetrics, "metrics-viewer", CLOUD_ENVIRONMENT],
  ["Docker", "Logs", DockerLogs, "logs-viewer", IDENTIFIED_HOST],
  ["Docker", "Traces", DockerTraces, "traces-viewer", IDENTIFIED_HOST],
  ["DockerSwarm", "Logs", DockerSwarmLogs, "logs-viewer", CLUSTER],
  ["DockerSwarm", "Metrics", DockerSwarmMetrics, "metrics-viewer", CLUSTER],
  ["Host", "Logs", HostLogs, "logs-viewer", IDENTIFIED_HOST],
  ["Host", "Traces", HostTraces, "traces-viewer", IDENTIFIED_HOST],
  ["Host", "Metrics", HostMetrics, "metrics-viewer", IDENTIFIED_HOST],
  ["Inventory", "Logs", InventoryLogs, "logs-viewer", INVENTORY_ITEM],
  ["Inventory", "Traces", InventoryTraces, "traces-viewer", INVENTORY_ITEM],
  ["Inventory", "Metrics", InventoryMetrics, "metrics-viewer", INVENTORY_ITEM],
  ["IoT", "Logs", IoTLogs, "logs-viewer", CLUSTER],
  ["IoT", "Metrics", IoTMetrics, "metrics-viewer", CLUSTER],
  ["Kubernetes", "Logs", KubernetesLogs, "logs-viewer", KUBERNETES_CLUSTER],
  [
    "Kubernetes",
    "Traces",
    KubernetesTraces,
    "traces-viewer",
    KUBERNETES_CLUSTER,
  ],
  [
    "Kubernetes",
    "Metrics",
    KubernetesMetrics,
    "metrics-viewer",
    KUBERNETES_CLUSTER,
  ],
  ["Podman", "Logs", PodmanLogs, "logs-viewer", IDENTIFIED_HOST],
  ["Podman", "Traces", PodmanTraces, "traces-viewer", IDENTIFIED_HOST],
  ["Proxmox", "Logs", ProxmoxLogs, "logs-viewer", CLUSTER],
  ["Proxmox", "Metrics", ProxmoxMetrics, "metrics-viewer", CLUSTER],
  ["Rum", "Logs", RumLogs, "logs-viewer", RUM_APPLICATION],
  ["Rum", "Traces", RumTraces, "traces-viewer", RUM_APPLICATION],
  ["Rum", "Metrics", RumMetrics, "metrics-viewer", RUM_APPLICATION],
  ["Serverless", "Logs", ServerlessLogs, "logs-viewer", SERVERLESS_FUNCTION],
  [
    "Serverless",
    "Traces",
    ServerlessTraces,
    "traces-viewer",
    SERVERLESS_FUNCTION,
  ],
  [
    "Serverless",
    "Metrics",
    ServerlessMetrics,
    "metrics-viewer",
    SERVERLESS_FUNCTION,
  ],
  ["VMware", "Logs", VMwareLogs, "logs-viewer", CLUSTER],
  ["VMware", "Metrics", VMwareMetrics, "metrics-viewer", CLUSTER],
];

describe("a resource's Logs tab has the same bare shape as its Traces and Metrics tabs", () => {
  test.each(SIGNAL_TAB_TABLE)(
    "%s %s: the first rendered element is the viewer",
    async (
      _resource: string,
      _signal: string,
      Page: PageComponent,
      viewerTestId: string,
      item: Fixture,
    ) => {
      getItemMock.mockResolvedValue(item);

      const { container } = render(<Page {...PAGE_PROPS} />);
      const viewer: HTMLElement = await screen.findByTestId(viewerTestId);

      expect(container.firstElementChild).toBe(viewer);
      expect(viewer.closest("[data-testid='card']")).toBeNull();
    },
  );

  test("every resource in the table has a Logs tab and at least one sibling tab", () => {
    const signalsByResource: Record<string, Array<string>> = {};

    for (const [resource, signal] of SIGNAL_TAB_TABLE) {
      signalsByResource[resource] = [
        ...(signalsByResource[resource] || []),
        signal,
      ];
    }

    for (const [resource, signals] of Object.entries(signalsByResource)) {
      expect({ resource, hasLogs: signals.includes("Logs") }).toEqual({
        resource,
        hasLogs: true,
      });
      expect({ resource, siblings: signals.length > 1 }).toEqual({
        resource,
        siblings: true,
      });
    }
  });
});
