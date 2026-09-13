import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Resource pages scope the shared telemetry viewers, and the viewers turn
 * that scope into locked filter chips. A chip used to read the raw scope:
 * "Service: <RumApplication uuid>" on a RUM page, "resource.host.name:
 * ip-10-0-0-12" on a host page, "networkDevice.id: <uuid>" on a network
 * device page.
 *
 * These tests render the real pages with each viewer replaced by a prop
 * recorder and assert what the page actually hands the viewer at runtime —
 * the entity type for id-scoped pages, the friendly name for
 * attribute-scoped pages — and that the FILTER props still carry the id /
 * identifier. How the viewer turns those props into chips is covered by the
 * viewers' own suites.
 */

const MODEL_ID_STRING: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";
const CONTAINER_NAME: string = "checkout-api";
const CONTAINER_ID: string =
  "3f2a9c1be0d4a8f7c6b5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0f9";

const getItemMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const logsViewerMock: MockFunction = getJestMockFunction();
const metricsViewerMock: MockFunction = getJestMockFunction();
const tracesViewerMock: MockFunction = getJestMockFunction();
const exceptionsViewerMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
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
      getLastParamAsString: () => {
        return "checkout-api";
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

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock("../../../UI/Components/InfoCard/InfoCard", () => {
  return {
    __esModule: true,
    default: (props: { title: string; value: React.ReactNode }) => {
      return <div data-testid={`info-card-${props.title}`}>{props.value}</div>;
    },
  };
});

// Render every tab's content so the Logs tab's viewer mounts.
jest.mock("../../../UI/Components/Tabs/Tabs", () => {
  return {
    __esModule: true,
    default: (props: {
      tabs: Array<{ name: string; children: React.ReactNode }>;
    }) => {
      return (
        <div>
          {props.tabs.map(
            (tab: { name: string; children: React.ReactNode }) => {
              return <div key={tab.name}>{tab.children}</div>;
            },
          )}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="embedded-metric-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/TelemetryImprovementCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="telemetry-improvement-card" />;
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
      default: (props: unknown) => {
        metricsViewerMock(props);
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
      default: (props: unknown) => {
        tracesViewerMock(props);
        return <div data-testid="traces-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        exceptionsViewerMock(props);
        return <div data-testid="exceptions-viewer" />;
      },
    };
  },
);

import RumMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Metrics";
import RumLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Logs";
import RumTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Traces";
import ServiceLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Logs";
import ServiceTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Traces";
import ServiceExceptions from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Exceptions";
import HostLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Logs";
import HostMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Metrics";
import HostTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Traces";
import DockerLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Logs";
import DockerTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Traces";
import DockerContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/ContainerDetail";
import PodmanLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Logs";
import PodmanTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Traces";
import PodmanContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/ContainerDetail";
import NetworkDeviceLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { keyForHost } from "../../../Utils/Telemetry/EntityKey";

type PageComponent = React.FunctionComponent<PageComponentProps>;

type ViewerProps = Record<string, any>;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type RenderPageFunction = (Page: PageComponent) => void;

const renderPage: RenderPageFunction = (Page: PageComponent): void => {
  render(<Page {...PAGE_PROPS} />);
};

type LastPropsFunction = (viewerMock: MockFunction) => ViewerProps;

// The props the viewer received on its most recent render.
const lastProps: LastPropsFunction = (
  viewerMock: MockFunction,
): ViewerProps => {
  const calls: Array<Array<unknown>> = viewerMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
};

type WaitForViewerFunction = (viewerMock: MockFunction) => Promise<ViewerProps>;

const waitForViewer: WaitForViewerFunction = async (
  viewerMock: MockFunction,
): Promise<ViewerProps> => {
  await waitFor(() => {
    expect(viewerMock).toHaveBeenCalled();
  });
  return lastProps(viewerMock);
};

type IdStringsFunction = (ids: unknown) => Array<string>;

const idStrings: IdStringsFunction = (ids: unknown): Array<string> => {
  return (ids as Array<ObjectID>).map((id: ObjectID) => {
    return id.toString();
  });
};

beforeEach(() => {
  getItemMock.mockReset();
  analyticsGetListMock.mockReset();
  logsViewerMock.mockReset();
  metricsViewerMock.mockReset();
  tracesViewerMock.mockReset();
  exceptionsViewerMock.mockReset();
  analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });
});

afterEach(() => {
  cleanup();
});

describe("RUM application pages hand the viewer the RumApplication type", () => {
  beforeEach(() => {
    getItemMock.mockResolvedValue({
      appIdentifier: "checkout-web-key",
      name: "Checkout Web",
    });
  });

  test("Metrics: serviceIds is the RUM app id, scopeEntityType RealUserMonitor", async () => {
    renderPage(RumMetrics);
    const props: ViewerProps = await waitForViewer(metricsViewerMock);

    expect(idStrings(props["serviceIds"])).toEqual([MODEL_ID_STRING]);
    expect(props["scopeEntityType"]).toBe(ServiceType.RealUserMonitor);
  });

  test("Traces: primaryEntityId is the RUM app id, scopeEntityType RealUserMonitor", async () => {
    renderPage(RumTraces);
    const props: ViewerProps = await waitForViewer(tracesViewerMock);

    expect((props["primaryEntityId"] as ObjectID).toString()).toBe(
      MODEL_ID_STRING,
    );
    expect(props["scopeEntityType"]).toBe(ServiceType.RealUserMonitor);
  });

  test("Logs: serviceIds is the RUM app id, scopeEntityType RealUserMonitor", async () => {
    renderPage(RumLogs);
    const props: ViewerProps = await waitForViewer(logsViewerMock);

    expect(idStrings(props["serviceIds"])).toEqual([MODEL_ID_STRING]);
    expect(props["scopeEntityType"]).toBe(ServiceType.RealUserMonitor);
  });

  test("the RUM app lookup only happens once per page (no name fan-out in the page)", async () => {
    renderPage(RumMetrics);
    await waitForViewer(metricsViewerMock);

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("Service pages hand the viewer the Service type", () => {
  test("Logs", () => {
    renderPage(ServiceLogs);
    const props: ViewerProps = lastProps(logsViewerMock);

    expect(idStrings(props["serviceIds"])).toEqual([MODEL_ID_STRING]);
    expect(props["scopeEntityType"]).toBe(ServiceType.OpenTelemetry);
  });

  test("Traces", () => {
    renderPage(ServiceTraces);
    const props: ViewerProps = lastProps(tracesViewerMock);

    expect((props["primaryEntityId"] as ObjectID).toString()).toBe(
      MODEL_ID_STRING,
    );
    expect(props["scopeEntityType"]).toBe(ServiceType.OpenTelemetry);
  });

  test("Exceptions", () => {
    renderPage(ServiceExceptions);
    const props: ViewerProps = lastProps(exceptionsViewerMock);

    expect((props["primaryEntityId"] as ObjectID).toString()).toBe(
      MODEL_ID_STRING,
    );
    expect(props["scopeEntityType"]).toBe(ServiceType.OpenTelemetry);
  });
});

describe("Host pages show the host's name on the host.name chip", () => {
  test("Logs: display key Host, display value the name, filter the identifier", async () => {
    getItemMock.mockResolvedValue({
      hostIdentifier: "ip-10-0-0-12",
      name: "Payments DB",
    });

    renderPage(HostLogs);
    const props: ViewerProps = await waitForViewer(logsViewerMock);

    expect(props["attributeFilterDisplayKeys"]).toEqual({
      "resource.host.name": "Host",
    });
    expect(props["attributeFilterDisplayValues"]).toEqual({
      "resource.host.name": "Payments DB",
    });
    expect(props["logQuery"]).toEqual({
      attributes: { "resource.host.name": "ip-10-0-0-12" },
    });
    expect(props["entityScope"]["attributeValue"]).toBe("ip-10-0-0-12");
    expect(props["entityScope"]["attributeKey"]).toBe("resource.host.name");
  });

  test("Logs: a host without a name falls back to its identifier", async () => {
    getItemMock.mockResolvedValue({
      hostIdentifier: "ip-10-0-0-12",
    });

    renderPage(HostLogs);
    const props: ViewerProps = await waitForViewer(logsViewerMock);

    expect(props["attributeFilterDisplayValues"]).toEqual({
      "resource.host.name": "ip-10-0-0-12",
    });
  });

  test.each([
    ["Metrics", HostMetrics, metricsViewerMock],
    ["Traces", HostTraces, tracesViewerMock],
  ] as Array<[string, PageComponent, MockFunction]>)(
    "%s: display value the name, attributeFilters the identifier",
    async (_name: string, Page: PageComponent, viewerMock: MockFunction) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "ip-10-0-0-12",
        name: "Payments DB",
      });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(viewerMock);

      expect(props["attributeFilters"]).toEqual({
        "resource.host.name": "ip-10-0-0-12",
      });
      expect(props["attributeFilterDisplayKeys"]).toEqual({
        "resource.host.name": "Host",
      });
      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "Payments DB",
      });
      expect(props["entityScope"]["attributeValue"]).toBe("ip-10-0-0-12");
    },
  );

  test.each([
    ["Metrics", HostMetrics, metricsViewerMock],
    ["Traces", HostTraces, tracesViewerMock],
  ] as Array<[string, PageComponent, MockFunction]>)(
    "%s: an unnamed host shows its identifier",
    async (_name: string, Page: PageComponent, viewerMock: MockFunction) => {
      getItemMock.mockResolvedValue({ hostIdentifier: "ip-10-0-0-12" });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(viewerMock);

      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "ip-10-0-0-12",
      });
    },
  );
});

describe("Docker and Podman host pages", () => {
  test.each([
    ["Docker", DockerLogs, "Docker Host", "docker"],
    ["Podman", PodmanLogs, "Podman Host", "podman"],
  ] as Array<[string, PageComponent, string, string]>)(
    "%s Logs: host and runtime chips get labels, host chip the host's name",
    async (
      _runtime: string,
      Page: PageComponent,
      hostLabel: string,
      runtimeSlug: string,
    ) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "docker-node-7f3a",
        name: "Edge Node 7",
      });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(logsViewerMock);

      expect(props["attributeFilterDisplayKeys"]).toEqual({
        "resource.host.name": hostLabel,
        "resource.container.runtime": "Runtime",
      });
      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "Edge Node 7",
      });
      expect(props["logQuery"]).toEqual({
        attributes: {
          "resource.host.name": "docker-node-7f3a",
          "resource.container.runtime": runtimeSlug,
        },
      });
    },
  );

  test.each([
    ["Docker", DockerTraces, "Docker Host"],
    ["Podman", PodmanTraces, "Podman Host"],
  ] as Array<[string, PageComponent, string]>)(
    "%s Traces: host chip shows the host's name, filter the identifier",
    async (_runtime: string, Page: PageComponent, hostLabel: string) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "docker-node-7f3a",
        name: "Edge Node 7",
      });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(tracesViewerMock);

      expect(props["attributeFilters"]).toEqual({
        "resource.host.name": "docker-node-7f3a",
      });
      expect(props["attributeFilterDisplayKeys"]).toEqual({
        "resource.host.name": hostLabel,
      });
      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "Edge Node 7",
      });
    },
  );

  test.each([
    ["Docker", DockerLogs],
    ["Podman", PodmanLogs],
  ] as Array<[string, PageComponent]>)(
    "%s Logs: an unnamed host shows its identifier",
    async (_runtime: string, Page: PageComponent) => {
      getItemMock.mockResolvedValue({ hostIdentifier: "docker-node-7f3a" });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(logsViewerMock);

      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "docker-node-7f3a",
      });
    },
  );
});

describe("Docker and Podman container detail", () => {
  const CASES: Array<[string, PageComponent, string, string]> = [
    ["Docker", DockerContainerDetail, "Docker Host", "docker"],
    ["Podman", PodmanContainerDetail, "Podman Host", "podman"],
  ];

  test.each(CASES)(
    "%s: container chip reads the container name, filter keeps the id",
    async (
      _runtime: string,
      Page: PageComponent,
      hostLabel: string,
      runtimeSlug: string,
    ) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "docker-node-7f3a",
        name: "Edge Node 7",
      });
      analyticsGetListMock.mockResolvedValue({
        data: [
          {
            attributes: {
              "resource.container.id": CONTAINER_ID,
              "resource.container.image.name": "checkout:1.2.3",
            },
          },
        ],
        count: 1,
      });

      renderPage(Page);

      await waitFor(() => {
        expect(
          lastProps(logsViewerMock)["logQuery"]["attributes"][
            "resource.container.id"
          ],
        ).toBe(CONTAINER_ID);
      });

      const props: ViewerProps = lastProps(logsViewerMock);

      expect(props["logQuery"]).toEqual({
        attributes: {
          "resource.host.name": "docker-node-7f3a",
          "resource.container.runtime": runtimeSlug,
          "resource.container.id": CONTAINER_ID,
        },
      });
      expect(props["attributeFilterDisplayKeys"]).toEqual({
        "resource.host.name": hostLabel,
        "resource.container.runtime": "Runtime",
        "resource.container.id": "Container",
      });
      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "Edge Node 7",
        "resource.container.id": CONTAINER_NAME,
      });
    },
  );

  test.each(CASES)(
    "%s: without a resolved container id there is no container chip override",
    async (_runtime: string, Page: PageComponent) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "docker-node-7f3a",
        name: "Edge Node 7",
      });
      analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });

      renderPage(Page);
      await waitForViewer(logsViewerMock);

      const props: ViewerProps = lastProps(logsViewerMock);

      expect(props["logQuery"]["attributes"]).not.toHaveProperty(
        "resource.container.id",
      );
      expect(props["attributeFilterDisplayValues"]).toEqual({
        "resource.host.name": "Edge Node 7",
      });
    },
  );

  test.each(CASES)(
    "%s: the overview Host card shows the host's name",
    async (_runtime: string, Page: PageComponent) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "docker-node-7f3a",
        name: "Edge Node 7",
      });

      renderPage(Page);

      expect(await screen.findByTestId("info-card-Host")).toHaveTextContent(
        "Edge Node 7",
      );
    },
  );

  test.each(CASES)(
    "%s: an unnamed host shows its identifier on the chip and the card",
    async (_runtime: string, Page: PageComponent) => {
      getItemMock.mockResolvedValue({ hostIdentifier: "docker-node-7f3a" });

      renderPage(Page);

      expect(await screen.findByTestId("info-card-Host")).toHaveTextContent(
        "docker-node-7f3a",
      );
      expect(lastProps(logsViewerMock)["attributeFilterDisplayValues"]).toEqual(
        {
          "resource.host.name": "docker-node-7f3a",
        },
      );
    },
  );
});

describe("Network device Logs page", () => {
  test("fetches only the device name, by the page's id", async () => {
    getItemMock.mockResolvedValue({ name: "core-sw-01" });

    renderPage(NetworkDeviceLogs);
    await waitForViewer(logsViewerMock);

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, boolean>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, boolean>;
    };

    expect(request.modelType).toBe(NetworkDevice);
    expect(request.id.toString()).toBe(MODEL_ID_STRING);
    expect(request.select).toEqual({ name: true });
  });

  test("shows a loader until the name lookup settles, then the logs", async () => {
    let resolveItem: (value: unknown) => void = (): void => {};
    getItemMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        resolveItem = resolve;
      }),
    );

    renderPage(NetworkDeviceLogs);

    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(logsViewerMock).not.toHaveBeenCalled();

    resolveItem({ name: "core-sw-01" });

    expect(await screen.findByTestId("logs-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
  });

  test("chip reads 'Network Device: <name>' while the filter keeps the id", async () => {
    getItemMock.mockResolvedValue({ name: "core-sw-01" });

    renderPage(NetworkDeviceLogs);
    const props: ViewerProps = await waitForViewer(logsViewerMock);

    expect(props["logQuery"]).toEqual({
      attributes: { "networkDevice.id": MODEL_ID_STRING },
    });
    expect(props["attributeFilterDisplayKeys"]).toEqual({
      "networkDevice.id": "Network Device",
    });
    expect(props["attributeFilterDisplayValues"]).toEqual({
      "networkDevice.id": "core-sw-01",
    });
    expect(props["id"]).toBe(`network-device-logs-${MODEL_ID_STRING}`);
  });

  test("a failed name lookup still renders the logs, with no value override", async () => {
    getItemMock.mockRejectedValue(new Error("Network error"));

    renderPage(NetworkDeviceLogs);
    const props: ViewerProps = await waitForViewer(logsViewerMock);

    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
    expect(props["logQuery"]).toEqual({
      attributes: { "networkDevice.id": MODEL_ID_STRING },
    });
    expect(props["attributeFilterDisplayKeys"]).toEqual({
      "networkDevice.id": "Network Device",
    });
    // No override: the chip falls back to the id instead of going blank.
    expect(props["attributeFilterDisplayValues"]).toBeUndefined();
  });

  test.each([
    ["a missing device", null],
    ["a device without a name", {}],
    ["a device with an empty name", { name: "" }],
  ] as Array<[string, unknown]>)(
    "%s still renders the logs with no value override",
    async (_label: string, item: unknown) => {
      getItemMock.mockResolvedValue(item);

      renderPage(NetworkDeviceLogs);
      const props: ViewerProps = await waitForViewer(logsViewerMock);

      expect(props["attributeFilterDisplayValues"]).toBeUndefined();
      expect(props["logQuery"]).toEqual({
        attributes: { "networkDevice.id": MODEL_ID_STRING },
      });
    },
  );
});

describe("the display name never leaks into the entity scope", () => {
  test.each([
    ["Metrics", HostMetrics, metricsViewerMock],
    ["Traces", HostTraces, tracesViewerMock],
    ["Logs", HostLogs, logsViewerMock],
  ] as Array<[string, PageComponent, MockFunction]>)(
    "Host %s: entity keys are computed from the identifier, not the name",
    async (_name: string, Page: PageComponent, viewerMock: MockFunction) => {
      getItemMock.mockResolvedValue({
        hostIdentifier: "ip-10-0-0-12",
        name: "Payments DB",
      });

      renderPage(Page);
      const props: ViewerProps = await waitForViewer(viewerMock);

      expect(props["entityScope"]["entityKeys"]).toEqual([
        keyForHost(PROJECT_ID_STRING, "ip-10-0-0-12"),
      ]);
      expect(props["entityScope"]["entityKeys"]).not.toContain(
        keyForHost(PROJECT_ID_STRING, "Payments DB"),
      );
    },
  );
});
