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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import NetworkTopologyLiveView from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView";
import { ComponentProps as GraphProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph";
import { NetworkTopologyPdfRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport";
import { TopologyLayoutModel } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import {
  parsePersistedOverrides,
  positionOverridesStorageKey,
  serializePersistedOverrides,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyPositionOverrides";
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

/*
 * Issue #5378: the project's default layout. Read and saved by a module of
 * its own (tested in NetworkTopologyDefaultLayout.test.ts); here it is a
 * recorder, so these tests decide what the project chose and whether the
 * reader may change it.
 */
const fetchDefaultLayoutMock: MockFunction = getJestMockFunction();
const saveDefaultLayoutMock: MockFunction = getJestMockFunction();
let canChangeDefaultLayout: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDefaultLayout",
  () => {
    return {
      __esModule: true,
      fetchProjectDefaultLayout: (...args: Array<unknown>) => {
        return fetchDefaultLayoutMock(...args);
      },
      saveProjectDefaultLayout: (...args: Array<unknown>) => {
        return saveDefaultLayoutMock(...args);
      },
      canChangeProjectDefaultLayout: () => {
        return canChangeDefaultLayout;
      },
    };
  },
);

// The props the live view last handed the (stand-in) graph.
let latestGraphProps: GraphProps | null = null;
// Every layout the graph was ever drawn in, in order.
let graphLayoutHistory: Array<string | undefined> = [];

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
        graphLayoutHistory.push(props.layoutMode);
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

/*
 * Every test starts on a project that has chosen no default layout, read by
 * a reader who may not change it - the map as it always was - unless the
 * test says otherwise.
 */
beforeEach(() => {
  fetchDefaultLayoutMock.mockReset();
  fetchDefaultLayoutMock.mockResolvedValue(null);
  saveDefaultLayoutMock.mockReset();
  saveDefaultLayoutMock.mockResolvedValue(undefined);
  canChangeDefaultLayout = false;
  graphLayoutHistory = [];
});

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

  /*
   * A network with no device on it has no map to read, filter or export: the
   * card says what would put something on it instead of drawing an empty
   * canvas under a toolbar.
   */
  test("a map with no devices has nothing to export, and says how to put devices on it", async () => {
    postMock.mockResolvedValue({ data: { nodes: [], edges: [] } });
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView />
      </MemoryRouter>,
    );
    const emptyState: HTMLElement = await screen.findByTestId(
      "network-topology-empty-state",
    );

    /*
     * Drawn as every empty list in the product is (TableEmptyState): the
     * illustration, the heading - without its full stop - what puts
     * devices on the map, and the way to add one.
     */
    expect(
      within(emptyState).getByTestId("network-topology-empty-illustration"),
    ).toBeInTheDocument();
    expect(
      within(emptyState).getByTestId("network-topology-empty-title"),
    ).toHaveTextContent(/^No network topology discovered yet$/);
    expect(
      within(emptyState).getByTestId("network-topology-empty-description"),
    ).toHaveTextContent(
      "Add your devices and they appear here. Devices read over SNMP are linked to the neighbours they report.",
    );
    const addDevice: HTMLElement = within(emptyState).getByRole("link", {
      name: "Add a device",
    });
    expect(addDevice.getAttribute("href")).toContain(
      "network-devices?open=add-device",
    );
    expect(screen.queryByTestId("live-network-graph")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
    expect(screen.queryByText("Read the map:")).toBeNull();
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

/*
 * Issue #5378: the layout a map opens on is the project's, so the whole
 * team reads the network the same way. A reader still switches layouts
 * while they look, and a Project Owner or Admin changes the default from
 * the map itself.
 */
describe("network topology live view: the project's default layout", () => {
  const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }

  function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = (): void => {};
    const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
      resolve = done;
    });
    return { promise: promise, resolve: resolve };
  }

  async function renderSite(): Promise<void> {
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView siteId="branch-1" layoutMode="tiered" />
      </MemoryRouter>,
    );
    await screen.findByTestId("live-network-graph");
  }

  async function renderWholeProject(): Promise<void> {
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView />
      </MemoryRouter>,
    );
    await screen.findByTestId("live-network-graph");
  }

  function graph(): HTMLElement {
    return screen.getByTestId("live-network-graph");
  }

  function openOptions(): void {
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
  }

  // The layout whose button carries the Default tag.
  function taggedLayout(): string {
    const tags: Array<HTMLElement> = screen.getAllByTestId(
      "network-topology-layout-default-tag",
    );
    expect(tags).toHaveLength(1);
    return (
      tags[0]!.closest("button")?.getAttribute("data-testid") || ""
    ).replace("network-topology-layout-mode-", "");
  }

  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(PAYLOAD);
    exportMock.mockReset();
    exportMock.mockResolvedValue("network-topology.pdf");
    latestGraphProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("a site's map opens on the project's default, not on its own", async () => {
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");
    await renderSite();
    expect(graph()).toHaveAttribute("data-layout", "parentChild");
    openOptions();
    expect(taggedLayout()).toBe("parentChild");
    expect(
      screen.getByRole("button", { name: "Parent and child Default" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("the map of every device opens on the project's default too", async () => {
    fetchDefaultLayoutMock.mockResolvedValue("star");
    await renderWholeProject();
    expect(graph()).toHaveAttribute("data-layout", "star");
  });

  test("a project with no default opens each map on its own, as it always did", async () => {
    await renderSite();
    expect(graph()).toHaveAttribute("data-layout", "tiered");
    openOptions();
    expect(taggedLayout()).toBe("tiered");
    cleanup();
    await renderWholeProject();
    expect(graph()).toHaveAttribute("data-layout", "force");
    openOptions();
    expect(taggedLayout()).toBe("force");
  });

  test("a default that cannot be read does not keep the map from opening: it opens on its own", async () => {
    fetchDefaultLayoutMock.mockRejectedValue(new Error("Project unavailable"));
    await renderSite();
    expect(graph()).toHaveAttribute("data-layout", "tiered");
    expect(screen.queryByText(/Project unavailable/)).not.toBeInTheDocument();
  });

  test("waits for the default rather than drawing its own layout and jumping", async () => {
    const pending: Deferred<string | null> = deferred<string | null>();
    fetchDefaultLayoutMock.mockReturnValue(pending.promise);
    render(
      <MemoryRouter>
        <NetworkTopologyLiveView siteId="branch-1" layoutMode="tiered" />
      </MemoryRouter>,
    );
    // The topology arrives first...
    await act(async () => {
      await new Promise((done: (value: unknown) => void) => {
        setTimeout(done, 20);
      });
    });
    expect(postMock).toHaveBeenCalledTimes(1);
    // ...and the map is not drawn until it is known which layout to draw.
    expect(screen.queryByTestId("live-network-graph")).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve("radial");
      await pending.promise;
    });
    expect(await screen.findByTestId("live-network-graph")).toHaveAttribute(
      "data-layout",
      "radial",
    );
    expect(graphLayoutHistory.length).toBeGreaterThan(0);
    expect(
      graphLayoutHistory.every((layout: string | undefined): boolean => {
        return layout === "radial";
      }),
    ).toBe(true);
  });

  test("the default is read once, when the map opens - not on every refresh", async () => {
    jest.useFakeTimers();
    await renderSite();
    expect(fetchDefaultLayoutMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(postMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetchDefaultLayoutMock).toHaveBeenCalledTimes(1);
  });

  test("a reader switches layouts while they look, and the next visit opens on the default again", async () => {
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");
    await renderSite();
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    expect(graph()).toHaveAttribute("data-layout", "star");
    expect(taggedLayout()).toBe("parentChild");
    expect(saveDefaultLayoutMock).not.toHaveBeenCalled();

    cleanup();
    await renderSite();
    expect(graph()).toHaveAttribute("data-layout", "parentChild");
  });

  test("a reader who may not change the default sees which layout it is, and no controls", async () => {
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");
    await renderSite();
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    expect(
      screen.queryByRole("button", { name: "Make default for everyone" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Parent and child Default" }),
    );
    expect(
      screen.queryByRole("button", { name: "Clear default" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-default-status"),
    ).not.toBeInTheDocument();
  });

  test("an admin makes the layout on screen everyone's default", async () => {
    canChangeDefaultLayout = true;
    await renderSite();
    openOptions();
    // On the map's own default there is nothing to do yet.
    expect(
      screen.queryByRole("button", { name: "Make default for everyone" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Parent and child" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Make default for everyone" }),
    );

    expect(
      await screen.findByTestId("network-topology-default-status"),
    ).toHaveTextContent(
      "Everyone in this project opens network maps on this layout.",
    );
    expect(saveDefaultLayoutMock).toHaveBeenCalledTimes(1);
    expect(saveDefaultLayoutMock).toHaveBeenCalledWith("parentChild");
    expect(taggedLayout()).toBe("parentChild");
    expect(
      screen.queryByRole("button", { name: "Make default for everyone" }),
    ).not.toBeInTheDocument();
    expect(graph()).toHaveAttribute("data-layout", "parentChild");
  });

  test("while the default saves, the button says so and a second press saves nothing more", async () => {
    canChangeDefaultLayout = true;
    const pending: Deferred<void> = deferred<void>();
    saveDefaultLayoutMock.mockReturnValue(pending.promise);
    await renderSite();
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Concentric" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Make default for everyone" }),
    );

    const button: HTMLElement = screen.getByTestId(
      "network-topology-make-default",
    );
    expect(button).toHaveTextContent("Saving…");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(saveDefaultLayoutMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    expect(taggedLayout()).toBe("radial");
    expect(graph()).toHaveAttribute("data-layout", "radial");
  });

  test("a default that does not save is said, and nothing moves", async () => {
    canChangeDefaultLayout = true;
    saveDefaultLayoutMock.mockRejectedValue(
      new Error("You do not have permission to update this Project."),
    );
    await renderSite();
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Make default for everyone" }),
    );

    expect(
      await screen.findByTestId("network-topology-default-error"),
    ).toHaveTextContent("We couldn't change the default layout. Try again.");
    expect(taggedLayout()).toBe("tiered");
    expect(graph()).toHaveAttribute("data-layout", "star");
    expect(
      screen.getByRole("button", { name: "Make default for everyone" }),
    ).toBeEnabled();

    // Picking another layout leaves the failure behind.
    fireEvent.click(screen.getByRole("button", { name: "Concentric" }));
    expect(
      screen.queryByTestId("network-topology-default-error"),
    ).not.toBeInTheDocument();
  });

  test("an admin clears the project's default: the map stays where it is, and its own default is tagged again", async () => {
    canChangeDefaultLayout = true;
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");
    await renderSite();
    openOptions();
    expect(screen.getByTestId("network-topology-default-status")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear default" }));

    await waitFor(() => {
      expect(taggedLayout()).toBe("tiered");
    });
    expect(saveDefaultLayoutMock).toHaveBeenCalledTimes(1);
    expect(saveDefaultLayoutMock).toHaveBeenCalledWith(null);
    expect(graph()).toHaveAttribute("data-layout", "parentChild");
    expect(
      screen.getByRole("button", { name: "Parent and child" }),
    ).toHaveAttribute("aria-pressed", "true");
    // No longer anyone's default, so it can be made one again.
    expect(
      screen.getByRole("button", { name: "Make default for everyone" }),
    ).toBeVisible();
    expect(
      screen.queryByTestId("network-topology-default-status"),
    ).not.toBeInTheDocument();
  });

  test("a clear that does not save leaves the default where it was", async () => {
    canChangeDefaultLayout = true;
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");
    saveDefaultLayoutMock.mockRejectedValue(new Error("Server unavailable"));
    await renderSite();
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Clear default" }));

    expect(
      await screen.findByTestId("network-topology-default-error"),
    ).toHaveTextContent("We couldn't change the default layout. Try again.");
    expect(taggedLayout()).toBe("parentChild");
    expect(screen.getByTestId("network-topology-default-status")).toBeVisible();
    expect(graph()).toHaveAttribute("data-layout", "parentChild");
  });

  test("Export PDF draws the layout the map opened on", async () => {
    fetchDefaultLayoutMock.mockResolvedValue("radial");
    await renderSite();
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (exportMock.mock.calls[0]![0] as NetworkTopologyPdfRequest).layoutMode,
    ).toBe("radial");
  });

  test("opens with what was dragged in the default layout, and keeps every other layout's arrangement", async () => {
    const parentChildKey: string = positionOverridesStorageKey(
      PROJECT_ID,
      "branch-1",
      "parentChild",
    );
    const tieredKey: string = positionOverridesStorageKey(
      PROJECT_ID,
      "branch-1",
      "tiered",
    );
    const parentChildArrangement: string = serializePersistedOverrides(
      new Map([["router-1", { x: 120, y: 40 }]]),
    );
    const tieredArrangement: string = serializePersistedOverrides(
      new Map([["switch-1", { x: -300, y: 500 }]]),
    );
    window.localStorage.setItem(parentChildKey, parentChildArrangement);
    window.localStorage.setItem(tieredKey, tieredArrangement);
    fetchDefaultLayoutMock.mockResolvedValue("parentChild");

    await renderSite();

    await waitFor(() => {
      expect(latestGraphProps?.positionOverrides?.get("router-1")).toEqual({
        x: 120,
        y: 40,
      });
    });
    expect(latestGraphProps?.positionOverrides?.has("switch-1")).toBe(false);

    // Past the half-second debounce of the arrangement's save.
    await act(async () => {
      await new Promise((done: (value: unknown) => void) => {
        setTimeout(done, 700);
      });
    });
    expect(window.localStorage.getItem(parentChildKey)).toBe(
      parentChildArrangement,
    );
    expect(
      parsePersistedOverrides(window.localStorage.getItem(tieredKey)),
    ).toEqual(new Map([["switch-1", { x: -300, y: 500 }]]));
  });
});
