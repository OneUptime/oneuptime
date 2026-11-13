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
import { DiscoveredDeviceItem } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems";
import { NetworkTopologyNode } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TOPOLOGY MAP'S WAY TO THE DISCOVERED DEVICES (OneUptime issue #5775).
 *
 * The live view, real, with the canvas, the node panel and the two add
 * dialogs as recorders, and the API answering by route:
 *
 *   - a header button to the list, saying how many discovered devices are
 *     not monitored, for whoever may read them - on a site's map, that
 *     site's list and count;
 *   - "Show them" shows every hidden node again in one request;
 *   - a discovered device's panel offers Add to monitoring, through the
 *     discovery import's dialog, and the map and the count are read again
 *     once it has run.
 */

const postMock: MockFunction = getJestMockFunction();

// "Model:action" pairs the reader may do.
const mockAllowed: Set<string> = new Set<string>();

interface PanelProps {
  node: NetworkTopologyNode;
  onAddToMonitoring?: ((node: NetworkTopologyNode) => void) | undefined;
  onClose: () => void;
  readMapAgain?: (() => Promise<void>) | undefined;
}

interface DialogProps {
  devices: Array<DiscoveredDeviceItem>;
  onClose: () => void;
  onImportsChanged: () => void;
}

const mockPanels: Array<PanelProps> = [];
const mockDialogs: Array<DialogProps> = [];
const mockAdoptions: Array<{ node: NetworkTopologyNode }> = [];
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
      create: () => {
        return Promise.resolve({});
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: (model: { constructor: { name: string } }, action: string) => {
        return {
          isAllowed: mockAllowed.has(`${model.constructor.name}:${action}`),
        };
      },
    },
    ModelAction: { Create: "create", Read: "read" },
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
        return { name: "Example project" };
      },
    },
  };
});

// The gate is mocked above: the models only name what is checked.
jest.mock("../../../Models/DatabaseModels/NetworkDevice", () => {
  return { __esModule: true, default: class NetworkDevice {} };
});

jest.mock("../../../Models/DatabaseModels/NetworkDeviceDiagnostic", () => {
  return { __esModule: true, default: class NetworkDeviceDiagnostic {} };
});

jest.mock("../../../Models/DatabaseModels/NetworkTopologySuppression", () => {
  return { __esModule: true, default: class NetworkTopologySuppression {} };
});

jest.mock("../../../Models/DatabaseModels/NetworkEndpoint", () => {
  return { __esModule: true, default: class NetworkEndpoint {} };
});

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport",
  () => {
    return {
      __esModule: true,
      exportNetworkTopologyAsPdf: () => {
        return Promise.resolve("network-topology.pdf");
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel",
  () => {
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: PanelProps): ReactElement => {
        mockPanels.push(props);

        return ReactModule.createElement(
          "div",
          { "data-testid": "panel-recorder", "data-node": props.node.id },
          props.onAddToMonitoring
            ? ReactModule.createElement(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    props.onAddToMonitoring!(props.node);
                  },
                },
                "Panel: Add to monitoring",
              )
            : null,
        );
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
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: { node: NetworkTopologyNode }): ReactElement => {
        mockAdoptions.push(props);

        return ReactModule.createElement(
          "div",
          { "data-testid": "adopt-recorder" },
          props.node.name,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/AddDiscoveredDevicesDialog",
  () => {
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: DialogProps): ReactElement => {
        mockDialogs.push(props);

        return ReactModule.createElement(
          "div",
          { "data-testid": "add-dialog-recorder" },
          ReactModule.createElement(
            "button",
            { type: "button", onClick: props.onImportsChanged },
            "Dialog: imports changed",
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph",
  () => {
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: GraphProps): ReactElement => {
        latestGraphProps = props;

        return ReactModule.createElement(
          "div",
          {
            "data-testid": "live-network-graph",
            "data-node-count": props.topology.nodes.length,
          },
          "Network canvas",
        );
      },
    };
  },
);

const SITE_ID: string = "20000000-0000-4000-8000-000000000001";
const CAMERA_ID: string = "10000000-0000-4000-8000-0000000000c1";

const CAMERA_NODE: Record<string, unknown> = {
  id: `endpoint:${CAMERA_ID}`,
  name: "Lobby camera",
  kind: "endpoint",
  isManaged: false,
  status: "up",
  ipAddress: "10.20.0.11",
  macAddress: "00:1a:2b:3c:4d:01",
  vendor: "Camera Vendor Inc",
  vlanId: 20,
};

const NO_ADDRESS_NODE: Record<string, unknown> = {
  id: "endpoint:10000000-0000-4000-8000-0000000000c2",
  name: "00:1a:2b:3c:4d:02",
  kind: "endpoint",
  isManaged: false,
  status: "up",
  macAddress: "00:1a:2b:3c:4d:02",
};

const NEIGHBOR_NODE: Record<string, unknown> = {
  id: "unmanaged:10.20.0.250",
  name: "Unmanaged neighbor",
  kind: "unmanaged",
  isManaged: false,
  status: "unknown",
  ipAddress: "10.20.0.250",
};

interface Answers {
  suppressedNodeCount: number;
  notMonitored: number;
  refuseCount: boolean;
}

const answers: Answers = {
  suppressedNodeCount: 0,
  notMonitored: 7,
  refuseCount: false,
};

function urlOf(call: Array<unknown>): string {
  return String((call[0] as { url: { toString: () => string } }).url);
}

function callsTo(route: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return urlOf(call).endsWith(route);
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return ((call[0] as { data?: Record<string, unknown> }).data ||
        {}) as Record<string, unknown>;
    });
}

let navigateSpy: SpyInstance<typeof Navigation.navigate>;

beforeEach(() => {
  mockAllowed.clear();
  mockPanels.length = 0;
  mockDialogs.length = 0;
  mockAdoptions.length = 0;
  latestGraphProps = null;
  answers.suppressedNodeCount = 0;
  answers.notMonitored = 7;
  answers.refuseCount = false;
  window.localStorage.clear();

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  postMock.mockReset();
  postMock.mockImplementation(async (...args: Array<unknown>) => {
    const url: string = urlOf(args);

    if (url.endsWith("/network-discovered-device/list")) {
      if (answers.refuseCount) {
        throw new Error("The list could not be read.");
      }

      return {
        data: {
          rows: [],
          count: answers.notMonitored,
          counts: {
            all: answers.notMonitored + 2,
            notMonitored: answers.notMonitored,
            monitored: 2,
            hidden: answers.suppressedNodeCount,
          },
        },
      };
    }

    if (url.endsWith("/network-discovered-device/show-everything-on-map")) {
      answers.suppressedNodeCount = 0;
      return { data: { changed: 3 } };
    }

    return {
      data: {
        nodes: [CAMERA_NODE, NO_ADDRESS_NODE, NEIGHBOR_NODE],
        edges: [],
        ...(answers.suppressedNodeCount > 0
          ? { suppressedNodeCount: answers.suppressedNodeCount }
          : {}),
      },
    };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderMap(props: { siteId?: string } = {}): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTopologyLiveView siteId={props.siteId} layoutMode="tiered" />
    </MemoryRouter>,
  );
  await screen.findByTestId("live-network-graph");
  await act(async () => {
    await Promise.resolve();
  });
}

async function selectNode(node: Record<string, unknown>): Promise<void> {
  await act(async () => {
    latestGraphProps!.onNodeClick!(node as unknown as NetworkTopologyNode);
  });
}

describe("the button to the Discovered Devices list", () => {
  test("says how many discovered devices of this site are not monitored, and opens the site's list", async () => {
    mockAllowed.add("NetworkEndpoint:read");

    await renderMap({ siteId: SITE_ID });

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Discovered Devices (7)",
    });

    // One small read: a page of one row carries the counts.
    expect(callsTo("/network-discovered-device/list")).toEqual([
      {
        search: "",
        show: "notMonitored",
        siteId: SITE_ID,
        sort: "lastSeen",
        sortOrder: "desc",
        limit: 1,
        skip: 0,
      },
    ]);

    fireEvent.click(button);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const route: string = String(navigateSpy.mock.calls[0]![0]);
    expect(route).toContain(`/network-sites/view/${SITE_ID}/endpoints`);
  });

  test("on the project's map, it counts every site and opens the project's list", async () => {
    mockAllowed.add("NetworkEndpoint:read");

    await renderMap();

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Discovered Devices (7)",
    });
    expect(callsTo("/network-discovered-device/list")[0]).not.toHaveProperty(
      "siteId",
    );

    fireEvent.click(button);

    const route: string = String(navigateSpy.mock.calls[0]![0]);
    expect(route).toContain("/network-devices/endpoints");
    expect(route).not.toContain("network-sites");
  });

  test("a count that could not be read leaves the button its name alone", async () => {
    mockAllowed.add("NetworkEndpoint:read");
    answers.refuseCount = true;

    await renderMap({ siteId: SITE_ID });

    await waitFor(() => {
      expect(callsTo("/network-discovered-device/list")).toHaveLength(1);
    });
    expect(
      screen.getByRole("button", { name: "Discovered Devices" }),
    ).toBeInTheDocument();
  });

  test("a reader who may not read discovered devices gets no button, and nothing is asked for", async () => {
    await renderMap({ siteId: SITE_ID });

    expect(
      screen.queryByRole("button", { name: /Discovered Devices/ }),
    ).not.toBeInTheDocument();
    expect(callsTo("/network-discovered-device/list")).toHaveLength(0);
  });
});

describe("the nodes hidden from the map", () => {
  test("Show them shows every hidden node again in one request, then reads the map and the count again", async () => {
    mockAllowed.add("NetworkEndpoint:read");
    answers.suppressedNodeCount = 3;

    await renderMap({ siteId: SITE_ID });

    const note: HTMLElement = await screen.findByTestId(
      "network-topology-suppressed-note",
    );
    expect(note).toHaveTextContent("3 nodes are hidden from this map.");

    const mapReads: number = callsTo("/network-device/topology").length;
    const countReads: number = callsTo(
      "/network-discovered-device/list",
    ).length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("network-topology-suppressed-note"),
      ).not.toBeInTheDocument();
    });

    expect(
      callsTo("/network-discovered-device/show-everything-on-map"),
    ).toEqual([{}]);
    expect(callsTo("/network-device/topology").length).toBe(mapReads + 1);
    expect(callsTo("/network-discovered-device/list").length).toBe(
      countReads + 1,
    );
  });
});

describe("a discovered device's panel", () => {
  test("offers Add to monitoring, through the discovery import's dialog, for that one device", async () => {
    mockAllowed.add("NetworkDevice:create");

    await renderMap({ siteId: SITE_ID });
    await selectNode(CAMERA_NODE);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Panel: Add to monitoring" }),
      );
    });

    // The panel closes first, so the dialog is the only surface.
    expect(screen.queryByTestId("panel-recorder")).not.toBeInTheDocument();
    expect(mockAdoptions).toHaveLength(0);

    const opened: DialogProps = mockDialogs[mockDialogs.length - 1]!;
    expect(opened.devices).toHaveLength(1);
    expect(opened.devices[0]).toMatchObject({
      id: CAMERA_ID,
      name: "Lobby camera",
      ipAddress: "10.20.0.11",
      macAddress: "00:1a:2b:3c:4d:01",
      vendor: "Camera Vendor Inc",
      isMonitored: false,
    });
  });

  test("once the import has run, the map is read again in the background", async () => {
    mockAllowed.add("NetworkDevice:create");
    mockAllowed.add("NetworkEndpoint:read");

    await renderMap({ siteId: SITE_ID });
    await selectNode(CAMERA_NODE);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Panel: Add to monitoring" }),
      );
    });

    const mapReads: number = callsTo("/network-device/topology").length;
    const countReads: number = callsTo(
      "/network-discovered-device/list",
    ).length;

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Dialog: imports changed" }),
      );
    });

    await waitFor(() => {
      expect(callsTo("/network-device/topology").length).toBe(mapReads + 1);
    });
    await waitFor(() => {
      expect(callsTo("/network-discovered-device/list").length).toBe(
        countReads + 1,
      );
    });
    // In the background: the map stays drawn.
    expect(screen.getByTestId("live-network-graph")).toBeInTheDocument();
  });

  test("a discovered device with no address yet, or a reader who may not add devices, gets no Add to monitoring", async () => {
    mockAllowed.add("NetworkDevice:create");

    await renderMap({ siteId: SITE_ID });
    await selectNode(NO_ADDRESS_NODE);

    expect(screen.getByTestId("panel-recorder")).toHaveAttribute(
      "data-node",
      NO_ADDRESS_NODE["id"],
    );
    expect(
      screen.queryByRole("button", { name: "Panel: Add to monitoring" }),
    ).not.toBeInTheDocument();

    cleanup();
    mockAllowed.clear();

    await renderMap({ siteId: SITE_ID });
    await selectNode(CAMERA_NODE);

    expect(screen.getByTestId("panel-recorder")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Panel: Add to monitoring" }),
    ).not.toBeInTheDocument();
  });

  test("an unmanaged neighbour is still adopted through its own dialog", async () => {
    mockAllowed.add("NetworkDevice:create");

    await renderMap({ siteId: SITE_ID });
    await selectNode(NEIGHBOR_NODE);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Panel: Add to monitoring" }),
      );
    });

    expect(screen.getByTestId("adopt-recorder")).toHaveTextContent(
      "Unmanaged neighbor",
    );
    expect(mockDialogs).toHaveLength(0);
  });
});

/*
 * Issue #7346: the device drawer's "Turn monitoring on" saves the device's
 * bound monitor, which stamps the device with the monitor's status before
 * the save answers. The map is read again right after it, so the node and
 * the drawer move from "unknown" to that status - in the background, the
 * map staying drawn and the drawer open.
 */
describe("the device drawer's way to read the map again", () => {
  test("is handed to the drawer, and reads the map again in the background", async () => {
    await renderMap({ siteId: SITE_ID });
    await selectNode(CAMERA_NODE);

    const panel: PanelProps = mockPanels[mockPanels.length - 1]!;
    expect(panel.readMapAgain).toBeDefined();

    const mapReads: number = callsTo("/network-device/topology").length;

    await act(async () => {
      await panel.readMapAgain!();
    });

    expect(callsTo("/network-device/topology").length).toBe(mapReads + 1);
    expect(callsTo("/network-device/topology")[mapReads]).toMatchObject({
      siteId: SITE_ID,
    });
    // In the background: the map stays drawn, and the drawer open.
    expect(screen.getByTestId("live-network-graph")).toBeInTheDocument();
    expect(screen.getByTestId("panel-recorder")).toHaveAttribute(
      "data-node",
      String(CAMERA_NODE["id"]),
    );
  });
});
