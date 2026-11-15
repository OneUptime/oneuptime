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
import { ComponentProps as DrawerProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";
import { NetworkTopologyPdfRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport";
import { TopologyLayoutModel } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { computeTopologyLayoutModel } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import {
  collapsedBranchesStorageKey,
  parseCollapsedBranches,
  serializeCollapsedBranches,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyBranches";
import NetworkTopology, {
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6606: THE LIVE VIEW KEEPS THE MAP'S BRANCH, SEARCH AND LAYOUT STATE.
 *
 * The map draws folds, a branch in focus and the original layout; the live
 * view around it owns them. Folded branches are remembered on this browser
 * per site and forgotten for devices that left the network; the branch in
 * focus and the original layout are for this visit, and let go of when the
 * layout changes; Enter in the search box asks the map for the next match;
 * the drawer offers "Show only this branch" for a device with something
 * below it, in the layout that draws branches; and Export PDF is handed all
 * of it, so the PDF is the map on screen.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const SITE_ID: string = "branch-1";

const postMock: MockFunction = getJestMockFunction();
const exportMock: MockFunction = getJestMockFunction();

let latestGraphProps: GraphProps | null = null;
let latestDrawerProps: DrawerProps | null = null;

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDefaultLayout",
  () => {
    return {
      __esModule: true,
      fetchProjectDefaultLayout: () => {
        return Promise.resolve(null);
      },
      saveProjectDefaultLayout: () => {
        return Promise.resolve(undefined);
      },
      canChangeProjectDefaultLayout: () => {
        return false;
      },
    };
  },
);

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

jest.mock("../../../Models/DatabaseModels/NetworkDeviceDiagnostic", () => {
  return { __esModule: true, default: class NetworkDeviceDiagnostic {} };
});

jest.mock("../../../Models/DatabaseModels/NetworkTopologySuppression", () => {
  return { __esModule: true, default: class NetworkTopologySuppression {} };
});

// The drawer is represented by what it is handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: DrawerProps): ReactElement => {
        latestDrawerProps = props;
        return <div data-testid="device-drawer">{props.node.name}</div>;
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

// The canvas is represented by its inputs.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph",
  () => {
    return {
      __esModule: true,
      default: (props: GraphProps): ReactElement => {
        latestGraphProps = props;
        return (
          <div data-testid="live-network-graph" data-layout={props.layoutMode}>
            Network canvas
          </div>
        );
      },
    };
  },
);

const NODES: Array<NetworkTopologyNode> = [
  {
    id: "router-1",
    name: "Branch router",
    kind: "device",
    isManaged: true,
    status: "up",
    role: "router",
  },
  {
    id: "switch-1",
    name: "Access switch",
    kind: "device",
    isManaged: true,
    status: "up",
    role: "switch",
  },
  {
    id: "endpoint-1",
    name: "Workstation",
    kind: "endpoint",
    isManaged: false,
    status: "up",
  },
  {
    id: "endpoint-2",
    name: "Till",
    kind: "endpoint",
    isManaged: false,
    status: "up",
  },
];

const TOPOLOGY: NetworkTopology = {
  nodes: NODES,
  edges: [
    { fromNodeId: "router-1", toNodeId: "switch-1", protocols: ["lldp"] },
    { fromNodeId: "switch-1", toNodeId: "endpoint-1", protocols: ["fdb"] },
    { fromNodeId: "switch-1", toNodeId: "endpoint-2", protocols: ["fdb"] },
  ],
};

const COLLAPSED_KEY: string = collapsedBranchesStorageKey(PROJECT_ID, SITE_ID);

async function renderMap(
  layoutMode: "parentChild" | "tiered" = "parentChild",
): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTopologyLiveView siteId={SITE_ID} layoutMode={layoutMode} />
    </MemoryRouter>,
  );
  await screen.findByTestId("live-network-graph");
}

function graph(): GraphProps {
  expect(latestGraphProps).not.toBeNull();
  return latestGraphProps!;
}

// The map reports the layout it drew, hierarchy and all.
function reportLayout(): void {
  const model: TopologyLayoutModel = computeTopologyLayoutModel(
    "parentChild",
    TOPOLOGY.nodes,
    TOPOLOGY.edges,
  );
  act(() => {
    graph().onLayoutModelChange!(model);
  });
}

function switchLayout(name: string): void {
  if (!screen.queryByTestId("network-topology-options")) {
    fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
  }
  fireEvent.click(screen.getByRole("button", { name: name }));
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: TOPOLOGY });
  exportMock.mockReset();
  exportMock.mockResolvedValue("network-topology.pdf");
  latestGraphProps = null;
  latestDrawerProps = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("folded branches are remembered on this browser, per site", () => {
  test("the folds saved for this site are handed to the map", async () => {
    window.localStorage.setItem(
      COLLAPSED_KEY,
      serializeCollapsedBranches(new Set<string>(["switch-1"])),
    );
    await renderMap();
    expect([...graph().collapsedNodeIds!]).toEqual(["switch-1"]);
  });

  test("a fold from the map is kept, and written back as it happens", async () => {
    await renderMap();
    expect(graph().collapsedNodeIds!.size).toBe(0);
    act(() => {
      graph().onCollapsedNodeIdsChange!(new Set<string>(["router-1"]));
    });
    expect([...graph().collapsedNodeIds!]).toEqual(["router-1"]);
    expect(
      parseCollapsedBranches(window.localStorage.getItem(COLLAPSED_KEY)),
    ).toEqual(new Set<string>(["router-1"]));

    act(() => {
      graph().onCollapsedNodeIdsChange!(new Set<string>());
    });
    // Nothing folded: nothing kept.
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBeNull();
  });

  test("a fold for a device that left the network is forgotten", async () => {
    window.localStorage.setItem(
      COLLAPSED_KEY,
      serializeCollapsedBranches(new Set<string>(["switch-1", "gone-switch"])),
    );
    await renderMap();
    await waitFor(() => {
      expect([...graph().collapsedNodeIds!]).toEqual(["switch-1"]);
    });
    expect(
      parseCollapsedBranches(window.localStorage.getItem(COLLAPSED_KEY)),
    ).toEqual(new Set<string>(["switch-1"]));
  });

  test("a corrupt entry opens the map with nothing folded", async () => {
    window.localStorage.setItem(COLLAPSED_KEY, "{not json");
    await renderMap();
    expect(graph().collapsedNodeIds!.size).toBe(0);
  });
});

describe("one branch on its own", () => {
  test("the drawer offers it for a device with something below it, and narrows the map", async () => {
    await renderMap();
    reportLayout();
    act(() => {
      graph().onNodeClick!(NODES[1]!);
    });
    expect(screen.getByTestId("device-drawer")).toHaveTextContent(
      "Access switch",
    );
    expect(latestDrawerProps!.onShowOnlyBranch).toBeDefined();
    expect(latestDrawerProps!.branchDeviceCount).toBe(2);

    act(() => {
      latestDrawerProps!.onShowOnlyBranch!();
    });
    expect(graph().focusedBranchNodeId).toBe("switch-1");
    // The drawer closes, so it does not cover the branch it narrowed to.
    expect(screen.queryByTestId("device-drawer")).not.toBeInTheDocument();
  });

  test("a device with nothing below it is not offered it", async () => {
    await renderMap();
    reportLayout();
    act(() => {
      graph().onNodeClick!(NODES[2]!);
    });
    expect(latestDrawerProps!.onShowOnlyBranch).toBeUndefined();
  });

  test("the device already in focus is not offered it again", async () => {
    await renderMap();
    reportLayout();
    act(() => {
      graph().onFocusedBranchChange!("switch-1");
    });
    act(() => {
      graph().onNodeClick!(NODES[1]!);
    });
    expect(latestDrawerProps!.onShowOnlyBranch).toBeUndefined();
  });

  test("a layout that draws no branches is not offered it", async () => {
    await renderMap("tiered");
    reportLayout();
    act(() => {
      graph().onNodeClick!(NODES[1]!);
    });
    expect(latestDrawerProps!.onShowOnlyBranch).toBeUndefined();
  });

  test("the map's path control moves it or lets go of it", async () => {
    await renderMap();
    act(() => {
      graph().onFocusedBranchChange!("switch-1");
    });
    expect(graph().focusedBranchNodeId).toBe("switch-1");
    act(() => {
      graph().onFocusedBranchChange!("router-1");
    });
    expect(graph().focusedBranchNodeId).toBe("router-1");
    act(() => {
      graph().onFocusedBranchChange!(null);
    });
    expect(graph().focusedBranchNodeId).toBeNull();
  });

  test("switching to another layout lets go of it", async () => {
    await renderMap();
    act(() => {
      graph().onFocusedBranchChange!("switch-1");
    });
    switchLayout("By network layer");
    await waitFor(() => {
      expect(graph().layoutMode).toBe("tiered");
    });
    expect(graph().focusedBranchNodeId).toBeNull();
  });
});

describe("the original layout, with the custom one kept aside", () => {
  test("it is handed to the map, and the custom layout stays", async () => {
    await renderMap();
    act(() => {
      graph().onPositionOverridesChange!(
        new Map([["switch-1", { x: 40, y: 50 }]]),
      );
    });
    act(() => {
      graph().onShowOriginalLayoutChange!(true);
    });
    expect(graph().isShowingOriginalLayout).toBe(true);
    // Kept, not thrown away: the map still gets the custom positions.
    expect(graph().positionOverrides!.get("switch-1")).toEqual({
      x: 40,
      y: 50,
    });
    act(() => {
      graph().onShowOriginalLayoutChange!(false);
    });
    expect(graph().isShowingOriginalLayout).toBe(false);
  });

  test("another layout opens on its own custom layout again", async () => {
    await renderMap();
    act(() => {
      graph().onPositionOverridesChange!(
        new Map([["switch-1", { x: 40, y: 50 }]]),
      );
    });
    act(() => {
      graph().onShowOriginalLayoutChange!(true);
    });
    switchLayout("By network layer");
    await waitFor(() => {
      expect(graph().layoutMode).toBe("tiered");
    });
    expect(graph().isShowingOriginalLayout).toBe(false);
  });

  test("with nothing dragged there is nothing to set aside", async () => {
    await renderMap();
    act(() => {
      graph().onShowOriginalLayoutChange!(true);
    });
    expect(graph().isShowingOriginalLayout).toBe(false);
  });
});

describe("Enter in the search box finds the next match", () => {
  test("each Enter asks the map once more", async () => {
    await renderMap();
    const before: number = graph().locateNextMatchRequest || 0;
    const box: HTMLElement = screen.getByRole("textbox", {
      name: "Find a network device",
    });
    fireEvent.change(box, { target: { value: "till" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(graph().locateNextMatchRequest).toBe(before + 1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(graph().locateNextMatchRequest).toBe(before + 2);
    // Any other key is typing.
    fireEvent.keyDown(box, { key: "a" });
    expect(graph().locateNextMatchRequest).toBe(before + 2);
  });
});

describe("Export PDF is handed the map on screen", () => {
  test("the folds, the branch in focus and the original layout's empty positions", async () => {
    await renderMap();
    act(() => {
      graph().onCollapsedNodeIdsChange!(new Set<string>(["switch-1"]));
      graph().onFocusedBranchChange!("router-1");
      graph().onPositionOverridesChange!(
        new Map([["switch-1", { x: 40, y: 50 }]]),
      );
    });
    act(() => {
      graph().onShowOriginalLayoutChange!(true);
    });
    fireEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    const request: NetworkTopologyPdfRequest = exportMock.mock
      .calls[0]![0] as NetworkTopologyPdfRequest;
    expect([...request.collapsedNodeIds!]).toEqual(["switch-1"]);
    expect(request.focusedBranchNodeId).toBe("router-1");
    expect(request.positionOverrides.size).toBe(0);
  });

  test("the custom layout's positions, once it is back", async () => {
    await renderMap();
    act(() => {
      graph().onPositionOverridesChange!(
        new Map([["switch-1", { x: 40, y: 50 }]]),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledTimes(1);
    });
    const request: NetworkTopologyPdfRequest = exportMock.mock
      .calls[0]![0] as NetworkTopologyPdfRequest;
    expect(request.positionOverrides.get("switch-1")).toEqual({
      x: 40,
      y: 50,
    });
    expect(request.focusedBranchNodeId).toBeNull();
  });
});
