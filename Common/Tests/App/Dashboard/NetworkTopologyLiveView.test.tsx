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
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import NetworkTopologyLiveView from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView";
import { ComponentProps as GraphProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

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
    },
  };
});

jest.mock("../../../Models/DatabaseModels/NetworkDevice", () => {
  return { __esModule: true, default: class NetworkDevice {} };
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
