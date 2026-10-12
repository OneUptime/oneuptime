import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import NetworkTopologyLiveView from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView";
import { ComponentProps as GraphProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph";
import { NetworkTopologyPdfRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport";
import { TopologyLayoutModel } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

/*
 * Issue #4616: the PDF export itself is laid out and drawn by modules the App
 * suite tests on their own (NetworkTopologyExportDocument and friends) and
 * the offline Topology suite runs for real. Here it is a recorder, so these
 * tests can hold the live view to handing it exactly the map on screen.
 */
const exportMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport",
  () => {
    return {
      __esModule: true,
      exportNetworkTopologyAsPdf: (...args: Array<unknown>) => {
        return exportMock(...args);
      },
    };
  },
);

// The props the live view last handed the (stand-in) graph.
let latestGraphProps: GraphProps | null = null;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: () => {
        return { isAllowed: false };
      },
    },
    ModelAction: { Create: "create" },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "10000000-0000-4000-8000-000000000001";
      },
      getCurrentProject: () => {
        return { name: "Acme Retail" };
      },
    },
  };
});

jest.mock("../../../Models/DatabaseModels/NetworkDevice", () => {
  return { __esModule: true, default: class NetworkDevice {} };
});

// Stubbed for the same reason as NetworkDevice: the gate is mocked above.
jest.mock("../../../Models/DatabaseModels/NetworkDeviceDiagnostic", () => {
  return { __esModule: true, default: class NetworkDeviceDiagnostic {} };
});

jest.mock("../../../Models/DatabaseModels/NetworkTopologySuppression", () => {
  return { __esModule: true, default: class NetworkTopologySuppression {} };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkLinkDetailPanel",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/AddNeighborToMonitoringModal",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * Keep the live view, controls and state real; the canvas is represented by
 * its inputs so these tests do not need a browser graphics implementation.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph",
  () => {
    return {
      __esModule: true,
      default: (props: GraphProps): ReactElement => {
        latestGraphProps = props;
        return (
          <div
            data-testid="live-network-graph"
            data-search={props.searchText}
            data-layout={props.layoutMode}
            data-health={props.healthFilterMode}
            data-kinds={Array.from(props.visibleKinds || [])
              .sort()
              .join(",")}
            data-node-count={props.topology.nodes.length}
          >
            Network canvas
          </div>
        );
      },
    };
  },
);

const PAYLOAD: Record<string, unknown> = {
  data: {
    nodes: [
      {
        id: "router-1",
        name: "Branch router",
        kind: "device",
        isManaged: true,
        status: "down",
      },
      {
        id: "switch-1",
        name: "Access switch",
        kind: "device",
        isManaged: true,
        status: "up",
      },
      {
        id: "peer-1",
        name: "Discovered phone",
        kind: "unmanaged",
        isManaged: false,
        status: "unknown",
      },
      {
        id: "endpoint-1",
        name: "Workstation",
        kind: "endpoint",
        isManaged: false,
        status: "up",
        vlanId: 20,
      },
    ],
    edges: [],
  },
};

async function renderMap(): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTopologyLiveView siteId="branch-1" layoutMode="tiered" />
    </MemoryRouter>,
  );
  await screen.findByTestId("live-network-graph");
}

describe("network topology live view integration", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(PAYLOAD);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("fetches only the requested site and preserves its initial layout", async () => {
    await renderMap();
    expect(postMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: "10000000-0000-4000-8000-000000000001",
          siteId: "branch-1",
        },
      }),
    );
    expect(screen.getByTestId("live-network-graph")).toHaveAttribute(
      "data-layout",
      "tiered",
    );
    expect(screen.getByText(/Updated \d/)).toBeVisible();
  });

  test("clear filters restores the map while preserving the chosen arrangement", async () => {
    await renderMap();
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Endpoints" }));
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a network device" }),
      { target: { value: "router" } },
    );
    const graph: HTMLElement = screen.getByTestId("live-network-graph");
    expect(graph).toHaveAttribute("data-health", "attention");
    expect(graph).toHaveAttribute("data-search", "router");
    expect(graph).toHaveAttribute("data-kinds", "device,unmanaged");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(graph).toHaveAttribute("data-health", "all");
    expect(graph).toHaveAttribute("data-search", "");
    expect(graph).toHaveAttribute("data-kinds", "device,endpoint,unmanaged");
    expect(graph).toHaveAttribute("data-layout", "star");
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  test("closing and reopening options keeps the selected filters", async () => {
    await renderMap();
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Discovered neighbors" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    expect(
      screen.getByRole("button", { name: /Map options/ }),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("live-network-graph")).toHaveAttribute(
      "data-kinds",
      "device,endpoint",
    );
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    expect(
      screen.getByRole("button", { name: "Discovered neighbors" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("an initial failure offers a working retry", async () => {
    postMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView />
      </MemoryRouter>,
    );
    await screen.findByText("Network unavailable");
    expect(screen.queryByTestId("live-network-graph")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("live-network-graph");
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("a manual refresh failure preserves the visible map and its filters", async () => {
    await renderMap();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a network device" }),
      { target: { value: "switch" } },
    );
    postMock.mockRejectedValueOnce(new Error("Refresh unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByTestId("network-topology-refresh-error");
    expect(screen.getByTestId("live-network-graph")).toHaveAttribute(
      "data-search",
      "switch",
    );
    expect(screen.getByText("Refresh failed")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(
        screen.queryByTestId("network-topology-refresh-error"),
      ).not.toBeInTheDocument();
    });
  });

  test("an automatic refresh failure is visible and recovers on the next successful poll", async () => {
    jest.useFakeTimers();
    await renderMap();
    postMock.mockRejectedValueOnce(new Error("Polling unavailable"));
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(
      screen.getByTestId("network-topology-refresh-error"),
    ).toHaveTextContent("Polling unavailable");
    expect(screen.getByTestId("live-network-graph")).toBeVisible();
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(
      screen.queryByTestId("network-topology-refresh-error"),
    ).not.toBeInTheDocument();
  });
});

/*
 * Issue #4616: one Export PDF action on the map, handed the map exactly as
 * the reader sees it.
 */
describe("network topology live view: Export PDF", () => {
  function exportButton(): HTMLElement {
    return screen.getByRole("button", { name: "Export PDF" });
  }

  function lastRequest(): NetworkTopologyPdfRequest {
    const calls: Array<Array<unknown>> = exportMock.mock.calls;
    return calls[calls.length - 1]![0] as NetworkTopologyPdfRequest;
  }

  async function renderSite(): Promise<void> {
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView
          siteId="branch-1"
          layoutMode="tiered"
          scopeNames={["Europe", "London office"]}
        />
      </MemoryRouter>,
    );
    await screen.findByTestId("live-network-graph");
  }

  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(PAYLOAD);
    exportMock.mockReset();
    exportMock.mockResolvedValue("network-topology-london-office.pdf");
    latestGraphProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  test("the map's card offers Export PDF beside Refresh", async () => {
    await renderSite();
    const buttons: Array<HTMLElement> = screen.getAllByTestId("card-button");
    const titles: Array<string> = buttons.map((button: HTMLElement): string => {
      return button.textContent || "";
    });
    expect(titles).toEqual(["Export PDF", "Refresh"]);
    expect(exportButton()).toBeEnabled();
  });

  test("exporting hands over the site, its layout and the whole topology", async () => {
    await renderSite();
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    const request: NetworkTopologyPdfRequest = lastRequest();
    expect(request.scopeNames).toEqual(["Europe", "London office"]);
    expect(request.projectName).toBe("Acme Retail");
    expect(request.layoutMode).toBe("tiered");
    expect(request.searchText).toBe("");
    expect(request.healthFilterMode).toBe("all");
    expect(request.vlanId).toBeNull();
    expect(
      request.topology.nodes.map((node: { id: string }): string => {
        return node.id;
      }),
    ).toEqual(["router-1", "switch-1", "peer-1", "endpoint-1"]);
    expect(Array.from(request.visibleKinds).sort()).toEqual([
      "device",
      "endpoint",
      "unmanaged",
    ]);
    expect(Array.from(request.availableKinds || []).sort()).toEqual([
      "device",
      "endpoint",
      "unmanaged",
    ]);
    expect(request.positionOverrides.size).toBe(0);
  });

  test("exporting hands over the filters and the arrangement the reader chose", async () => {
    await renderSite();
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Endpoints" }));
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a network device" }),
      { target: { value: "router" } },
    );
    act(() => {
      latestGraphProps!.onPositionOverridesChange!(
        new Map([["router-1", { x: 10, y: 20 }]]),
      );
    });
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    const request: NetworkTopologyPdfRequest = lastRequest();
    expect(request.layoutMode).toBe("star");
    expect(request.searchText).toBe("router");
    expect(request.healthFilterMode).toBe("attention");
    expect(Array.from(request.visibleKinds).sort()).toEqual([
      "device",
      "unmanaged",
    ]);
    expect(request.positionOverrides.get("router-1")).toEqual({ x: 10, y: 20 });
  });

  test("the export draws the layout the graph reported, not one of its own", async () => {
    await renderSite();
    const model: TopologyLayoutModel = {
      positions: new Map([["router-1", { x: 1, y: 2 }]]),
      componentBoxes: [],
      groups: [],
      contentWidth: 10,
      contentHeight: 10,
    };
    act(() => {
      latestGraphProps!.onLayoutModelChange!(model);
    });
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().layoutModel).toBe(model);
  });

  test("before the graph has drawn, the export lays the map out itself", async () => {
    await renderSite();
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().layoutModel).toBeUndefined();
  });

  test("the map of every device is exported without a site", async () => {
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView />
      </MemoryRouter>,
    );
    await screen.findByTestId("live-network-graph");
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().scopeNames).toEqual([]);
    expect(lastRequest().layoutMode).toBe("force");
  });

  test("the partial-map warnings travel with the export", async () => {
    postMock.mockResolvedValue({
      data: {
        ...(PAYLOAD["data"] as Record<string, unknown>),
        isTruncated: true,
        endpointsTruncated: true,
        droppedEndpointCount: 4,
        suppressedNodeCount: 2,
      },
    });
    await renderSite();
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    expect(lastRequest().notices).toEqual({
      isTruncated: true,
      endpointsTruncated: true,
      droppedEndpointCount: 4,
      suppressedNodeCount: 2,
    });
  });

  test("while the PDF is built the button is busy, and a second click starts nothing", async () => {
    let finish: (value: string) => void = (): void => {};
    exportMock.mockImplementation((): Promise<string> => {
      return new Promise<string>((resolve: (value: string) => void) => {
        finish = resolve;
      });
    });
    await renderSite();
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(exportButton()).toBeDisabled();
    });
    fireEvent.click(exportButton());
    expect(exportMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish("network-topology.pdf");
    });
    await waitFor(() => {
      expect(exportButton()).toBeEnabled();
    });
    expect(
      screen.queryByTestId("network-topology-export-error"),
    ).not.toBeInTheDocument();
  });

  test("a failed export says so in the card, and the next one clears it", async () => {
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});
    exportMock.mockRejectedValueOnce(new Error("Failed to fetch module"));
    await renderSite();
    fireEvent.click(exportButton());
    const alert: HTMLElement = await screen.findByTestId(
      "network-topology-export-error",
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("We couldn't create the PDF. Try again.");
    // The reason goes to the console, where it can be diagnosed.
    expect(consoleError).toHaveBeenCalledWith(
      "Could not export the network topology as a PDF: Failed to fetch module",
    );
    consoleError.mockRestore();
    // The map stays, and so does the way to try again.
    expect(screen.getByTestId("live-network-graph")).toBeVisible();
    await waitFor(() => {
      expect(exportButton()).toBeEnabled();
    });
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(
        screen.queryByTestId("network-topology-export-error"),
      ).not.toBeInTheDocument();
    });
    expect(exportMock).toHaveBeenCalledTimes(2);
  });

  test("a map with no devices has nothing to export", async () => {
    postMock.mockResolvedValue({ data: { nodes: [], edges: [] } });
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView />
      </MemoryRouter>,
    );
    await screen.findByTestId("live-network-graph");
    expect(exportButton()).toBeDisabled();
    fireEvent.click(exportButton());
    expect(exportMock).not.toHaveBeenCalled();
  });

  test("a health filter that leaves nothing on the map leaves nothing to export", async () => {
    postMock.mockResolvedValue({
      data: {
        nodes: [
          {
            id: "switch-1",
            name: "Access switch",
            kind: "device",
            isManaged: true,
            status: "up",
          },
        ],
        edges: [],
      },
    });
    await renderSite();
    expect(exportButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    await waitFor(() => {
      expect(exportButton()).toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    await waitFor(() => {
      expect(exportButton()).toBeEnabled();
    });
  });

  test("hiding every node type leaves nothing to export", async () => {
    await renderSite();
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
    for (const name of [
      "Monitored devices",
      "Discovered neighbors",
      "Endpoints",
    ]) {
      fireEvent.click(screen.getByRole("button", { name: name }));
    }
    await waitFor(() => {
      expect(exportButton()).toBeDisabled();
    });
  });
});
