import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ALL_DEVICES_SCOPE,
  EMPTY_DIAGRAM_TEXT,
  LOSSY_TEXT_NOTICE,
  MAX_DIAGRAM_SCALE,
  MAX_PAGE_SIDE,
  MIN_LEGIBLE_DIAGRAM_SCALE,
  NetworkTopologyExportDocument,
  NetworkTopologyExportInput,
  buildNetworkTopologyExportDocument,
  describeExportFilters,
  describeExportNotices,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyExportDocument";
import {
  A4_LONG_SIDE,
  A4_SHORT_SIDE,
  ExportCircleItem,
  ExportItem,
  ExportLineItem,
  ExportPage,
  ExportRectItem,
  ExportTextItem,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportItems";
import { TABLE_BOTTOM_LIMIT } from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportTables";
import { TextMeasure } from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportText";
import {
  blendWithPaper,
  resolvePrintColor,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportColor";
import {
  ALL_NODE_KINDS,
  TopologyNodeKind,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
  buildTopologyLegend,
  edgeKeyForEdge,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import { computeTopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import { HEALTH_STATE_COLORS } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyHealthFilter";

/*
 * Issue #4616: "Export PDF" on the network topology map. The whole PDF —
 * the map page, its header and legend, the device and connection tables —
 * is laid out by one pure function, so these tests can hold every promise
 * the feature makes: the whole map rather than the viewport, the reader's
 * own arrangement and filters, device names and types, Up/Down/Unknown,
 * link states, the legend, the devices with no links, a light document
 * whatever the theme, legible names however large the network, and a
 * table of every device and connection.
 */

// A stand-in for the font's metrics: every character the same width.
const measure: TextMeasure = (
  text: string,
  fontSize: number,
  isBold: boolean,
): number => {
  return Array.from(text).length * fontSize * (isBold ? 0.6 : 0.52);
};

const HEX: RegExp = /^#[0-9a-f]{6}$/;

function device(
  id: string,
  name: string,
  role: NetworkTopologyNode["role"],
  status: NetworkTopologyNode["status"],
  extra?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode {
  return {
    id: id,
    name: name,
    role: role,
    status: status,
    kind: "device",
    isManaged: true,
    ...extra,
  };
}

function link(
  from: string,
  to: string,
  extra?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge {
  return { fromNodeId: from, toNodeId: to, protocols: ["lldp"], ...extra };
}

/*
 * One store: a router, a firewall that is down behind a dead link, a core
 * switch running hot, an access switch with endpoints, a camera that is down,
 * a phone nobody monitors, two devices with no links at all, and a NAS on a
 * link somebody drew by hand.
 */
const STORE_NODES: Array<NetworkTopologyNode> = [
  device("r1", "Store edge router", "router", "up", {
    vendor: "Cisco",
    deviceModel: "ISR 4331",
    ipAddress: "10.42.0.1",
    interfacesUp: 4,
    interfacesDown: 0,
  }),
  device("fw1", "Perimeter firewall", "firewall", "down", {
    vendor: "Fortinet",
    interfacesUp: 0,
    interfacesDown: 4,
  }),
  device("sw1", "Core switch", "switch", "up", {
    vendor: "Cisco",
    deviceModel: "Catalyst 9300",
    interfacesUp: 22,
    interfacesDown: 2,
  }),
  device("sw2", "Back office switch", "switch", "up", {
    vendor: "Aruba",
    interfacesUp: 16,
    interfacesDown: 0,
  }),
  device("nas1", "Backup NAS", "storage", "up"),
  device("cam1", "Entrance camera", "camera", "down"),
  device("lb1", "Load balancer", "loadBalancer", "unknown"),
  device("spare1", "Spare switch", "switch", "unknown"),
  device("lab1", "Lab router", "router", "up"),
  {
    id: "unmanaged:phone",
    name: "Reception phone",
    kind: "unmanaged",
    isManaged: false,
    status: "unknown",
    role: "phone",
    ipAddress: "10.42.3.40",
  },
  {
    id: "ep1",
    name: "Till 1",
    kind: "endpoint",
    isManaged: false,
    status: "up",
    vlanId: 20,
    ipAddress: "10.42.20.11",
    macAddress: "00:1a:2b:3c:4d:5e",
  },
  {
    id: "ep2",
    name: "Menu board",
    kind: "endpoint",
    isManaged: false,
    status: "up",
    vlanId: 30,
  },
];

const STORE_EDGES: Array<NetworkTopologyEdge> = [
  link("r1", "fw1", {
    fromPort: "Gi0/0/1",
    toPort: "port1",
    fromInterface: { isOperationallyUp: false },
  }),
  link("r1", "sw1", {
    fromPort: "Gi0/0/2",
    toInterface: { interfaceName: "Te1/1/1", utilizationPercent: 91 },
  }),
  link("sw1", "sw2", {
    fromPort: "Gi1/0/48",
    toPort: "Gi1/0/1",
    protocols: ["lldp", "cdp"],
    fromInterface: { utilizationPercent: 12, isOperationallyUp: true },
  }),
  link("sw1", "lb1", { fromPort: "Gi1/0/11" }),
  link("sw2", "nas1", {
    fromPort: "Gi1/0/3",
    protocols: ["manual"],
    monitorState: "up",
  }),
  link("sw2", "cam1", { fromPort: "Gi1/0/5", protocols: ["fdb"] }),
  link("sw2", "unmanaged:phone", {
    fromPort: "Gi1/0/6",
    toPort: "SW PORT",
    protocols: ["cdp"],
  }),
  link("sw2", "ep1", { fromPort: "Gi1/0/7", protocols: ["fdb"] }),
  link("sw2", "ep2", { fromPort: "Gi1/0/8", protocols: ["fdb"] }),
];

function input(
  overrides?: Partial<NetworkTopologyExportInput>,
): NetworkTopologyExportInput {
  return {
    topology: { nodes: STORE_NODES, edges: STORE_EDGES },
    layoutMode: "force",
    positionOverrides: new Map<string, TopologyPoint>(),
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    projectName: "Acme Retail",
    scopeNames: ["North America", "East", "Store 1042"],
    exportedAtText: "Oct 10 2026, 14:32 CEST",
    ...overrides,
  };
}

function build(
  overrides?: Partial<NetworkTopologyExportInput>,
): NetworkTopologyExportDocument {
  return buildNetworkTopologyExportDocument(input(overrides), measure);
}

function items(page: ExportPage, tagPrefix: string): Array<ExportItem> {
  return page.items.filter((item: ExportItem): boolean => {
    return item.tag.startsWith(tagPrefix);
  });
}

function texts(page: ExportPage, tagPrefix: string = ""): Array<string> {
  return items(page, tagPrefix)
    .filter((item: ExportItem): item is ExportTextItem => {
      return item.type === "text";
    })
    .map((item: ExportTextItem): string => {
      return item.text;
    });
}

function allTexts(document: NetworkTopologyExportDocument): Array<string> {
  return document.pages.flatMap((page: ExportPage): Array<string> => {
    return texts(page);
  });
}

function mapPage(document: NetworkTopologyExportDocument): ExportPage {
  return document.pages[0]!;
}

function colorsOf(item: ExportItem): Array<string> {
  const colors: Array<string> = [];
  if (item.type === "text") {
    colors.push(item.color);
    if (item.halo) {
      colors.push(item.halo.color);
    }
    return colors;
  }
  if (item.type === "line") {
    return [item.stroke.color];
  }
  if (item.fill) {
    colors.push(item.fill);
  }
  if (item.stroke) {
    colors.push(item.stroke.color);
  }
  return colors;
}

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// The points an item occupies (text by its anchor; nothing here is rotated).
function extentOf(item: ExportItem): Extent {
  switch (item.type) {
    case "rect":
      return {
        minX: item.x,
        minY: item.y,
        maxX: item.x + item.width,
        maxY: item.y + item.height,
      };
    case "circle":
      return {
        minX: item.cx - item.r,
        minY: item.cy - item.r,
        maxX: item.cx + item.r,
        maxY: item.cy + item.r,
      };
    case "line":
      return {
        minX: Math.min(item.x1, item.x2),
        minY: Math.min(item.y1, item.y2),
        maxX: Math.max(item.x1, item.x2),
        maxY: Math.max(item.y1, item.y2),
      };
    case "path": {
      const xs: Array<number> = [];
      const ys: Array<number> = [];
      for (const command of item.commands) {
        command.points.forEach((value: number, index: number) => {
          (index % 2 === 0 ? xs : ys).push(value);
        });
      }
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    }
    default: {
      const width: number = measure(item.text, item.fontSize, item.isBold);
      const left: number =
        item.align === "center"
          ? item.x - width / 2
          : item.align === "right"
            ? item.x - width
            : item.x;
      return {
        minX: left,
        minY: item.y - item.fontSize,
        maxX: left + width,
        maxY: item.y,
      };
    }
  }
}

function frameOf(page: ExportPage): ExportRectItem {
  return items(page, "frame")[0] as ExportRectItem;
}

// Everything the map draws, as opposed to the page's header and legend.
const DIAGRAM_TAGS: Array<string> = [
  "hull",
  "edge:",
  "node-",
  "empty-diagram",
];

function diagramItems(page: ExportPage): Array<ExportItem> {
  return page.items.filter((item: ExportItem): boolean => {
    return DIAGRAM_TAGS.some((prefix: string): boolean => {
      return item.tag.startsWith(prefix);
    });
  });
}

function expectInside(inner: Extent, outer: Extent, slack: number = 0.01): void {
  expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - slack);
  expect(inner.minY).toBeGreaterThanOrEqual(outer.minY - slack);
  expect(inner.maxX).toBeLessThanOrEqual(outer.maxX + slack);
  expect(inner.maxY).toBeLessThanOrEqual(outer.maxY + slack);
}

function shapeOf(page: ExportPage, nodeId: string): ExportItem {
  return items(page, `node-shape:${nodeId}`)[0]!;
}

function fillOf(item: ExportItem): string | undefined {
  return item.type === "line" || item.type === "text" ? undefined : item.fill;
}

interface Estate {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
}

/*
 * A synthetic estate of `count` devices, every fifth one down, in islands
 * of `islandSize`: each device cabled to an earlier one in its island,
 * picked by a fixed pseudo-random sequence, so the islands are trees the way
 * real networks are — and the size can be dialled up to "large network".
 */
function estate(count: number, islandSize: number = 25): Estate {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  let seed: number = 12345;
  for (let index: number = 0; index < count; index++) {
    nodes.push(
      device(
        `d${index}`,
        `site-${Math.floor(index / islandSize)}-device-${index}`,
        index % 2 === 0 ? "switch" : "router",
        index % 5 === 0 ? "down" : "up",
      ),
    );
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const islandStart: number = index - (index % islandSize);
    if (index > islandStart) {
      const parent: number =
        islandStart + Math.floor((seed / 2147483648) * (index - islandStart));
      edges.push(link(`d${parent}`, `d${index}`));
    }
  }
  return { nodes: nodes, edges: edges };
}

/*
 * Islands that are long chains. The force layout draws each as a line and
 * stacks them into one very tall column — the extreme shape a page has to
 * stop growing for.
 */
function chains(count: number): Estate {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let index: number = 0; index < count; index++) {
    nodes.push(device(`c${index}`, `chain-${index}`, "switch", "up"));
    if (index % 25 !== 0) {
      edges.push(link(`c${index - 1}`, `c${index}`));
    }
  }
  return { nodes: nodes, edges: edges };
}

describe("the map page draws the whole map the reader is looking at", () => {
  const document: NetworkTopologyExportDocument = build();
  const page: ExportPage = mapPage(document);

  test("every device is drawn, named, and inside the frame — not just the viewport", () => {
    expect(document.summary.drawnNodeCount).toBe(STORE_NODES.length);
    const frame: ExportRectItem = frameOf(page);
    for (const node of STORE_NODES) {
      expect(items(page, `node-shape:${node.id}`).length).toBeGreaterThan(0);
      expect(texts(page, `node-label:${node.id}`).join(" ")).toBe(node.name);
    }
    for (const item of diagramItems(page)) {
      expectInside(extentOf(item), extentOf(frame));
    }
  });

  test("every link is drawn between its two devices", () => {
    expect(document.summary.drawnEdgeCount).toBe(STORE_EDGES.length);
    for (const edge of STORE_EDGES) {
      const line: ExportLineItem = items(
        page,
        `edge:${edgeKeyForEdge(edge)}`,
      )[0] as ExportLineItem;
      expect(line).toBeDefined();
      const from: Extent = extentOf(shapeOf(page, edge.fromNodeId));
      const to: Extent = extentOf(shapeOf(page, edge.toNodeId));
      const ends: Array<[number, number]> = [
        [line.x1, line.y1],
        [line.x2, line.y2],
      ];
      const centres: Array<[number, number]> = [from, to].map(
        (extent: Extent): [number, number] => {
          return [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2];
        },
      );
      for (const [x, y] of ends) {
        expect(
          centres.some(([cx, cy]: [number, number]): boolean => {
            return Math.abs(cx - x) < 0.5 && Math.abs(cy - y) < 0.5;
          }),
        ).toBe(true);
      }
    }
  });

  test("links are drawn under the nodes, and hulls under both", () => {
    const order: Array<string> = page.items.map((item: ExportItem): string => {
      return item.tag.split(":")[0]!;
    });
    const lastHull: number = order.lastIndexOf("hull");
    const firstEdge: number = order.indexOf("edge");
    const lastEdge: number = order.lastIndexOf("edge");
    const firstNode: number = order.findIndex((tag: string): boolean => {
      return tag.startsWith("node-");
    });
    expect(lastHull).toBeLessThan(firstEdge);
    expect(lastEdge).toBeLessThan(firstNode);
  });

  test("status is the fill: up green, down red, unknown slate", () => {
    expect(fillOf(shapeOf(page, "r1"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.up, 0.9),
    );
    expect(fillOf(shapeOf(page, "fw1"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.down, 0.9),
    );
    expect(fillOf(shapeOf(page, "lb1"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.unknown, 0.9),
    );
    expect(resolvePrintColor(NODE_STATUS_COLORS.up)).toBe("#16a34a");
  });

  test("an unmanaged peer is hollow with a dashed outline; an endpoint is violet", () => {
    const phone: ExportItem = shapeOf(page, "unmanaged:phone");
    expect(fillOf(phone)).toBe("#ffffff");
    expect(
      phone.type !== "text" && phone.type !== "line" && phone.stroke?.dash,
    ).toBeTruthy();
    expect(fillOf(shapeOf(page, "ep1"))).toBe(blendWithPaper("#a78bfa", 0.85));
  });

  test("the type is the silhouette: routers round, switches boxes, firewalls diamonds, storage a drum", () => {
    expect(shapeOf(page, "r1").type).toBe("circle");
    expect(shapeOf(page, "sw1").type).toBe("rect");
    expect(shapeOf(page, "fw1").type).toBe("path");
    expect(items(page, "node-shape:nas1:rim")).toHaveLength(1);
  });

  test("link state is the line: down red and dashed, busy amber, learned dashed grey", () => {
    const line: (from: string, to: string) => ExportLineItem = (
      from: string,
      to: string,
    ): ExportLineItem => {
      return items(
        page,
        `edge:${edgeKeyForEdge({ fromNodeId: from, toNodeId: to })}`,
      )[0] as ExportLineItem;
    };
    const s: number = document.summary.diagramScale;
    expect(line("r1", "fw1").stroke.color).toBe("#dc2626");
    expect(line("r1", "fw1").stroke.dash).toEqual([6 * s, 4 * s]);
    expect(line("r1", "sw1").stroke.color).toBe(
      resolvePrintColor(LINK_STATE_COLORS.saturated),
    );
    // Busier links are drawn thicker, as on screen.
    expect(line("r1", "sw1").stroke.width).toBeGreaterThan(
      line("sw1", "sw2").stroke.width,
    );
    expect(line("sw2", "ep1").stroke.dash).toEqual([3 * s, 3 * s]);
    expect(line("sw1", "sw2").stroke.color).toBe("#64748b");
  });

  test("the interface badge is printed inside the device", () => {
    expect(texts(page, "node-badge:sw1")).toEqual(["22/2"]);
    expect(texts(page, "node-badge:fw1")).toEqual(["0/4"]);
    expect(texts(page, "node-badge:nas1")).toEqual([]);
  });

  test("names keep a paper-coloured halo so they read across links", () => {
    for (const item of items(page, "node-label:")) {
      expect((item as ExportTextItem).halo?.color).toBe("#ffffff");
    }
  });

  test("devices with no links are grouped under 'Not linked to anything'", () => {
    const captions: Array<string> = texts(page, "hull-caption:");
    expect(captions).toEqual(["Not linked to anything (2)"]);
    const strip: ExportRectItem = items(
      page,
      "hull:component-unlinked",
    )[0] as ExportRectItem;
    expect(strip.stroke?.dash).toBeDefined();
    for (const nodeId of ["spare1", "lab1"]) {
      expectInside(extentOf(shapeOf(page, nodeId)), extentOf(strip));
    }
  });

  test("the legend is the map's own key: status, kind, link and the types on this map", () => {
    const legend: Array<string> = texts(page, "legend-text:");
    const expected: Array<string> = buildTopologyLegend(STORE_NODES).map(
      (entry: { label: string }): string => {
        return entry.label;
      },
    );
    expect(legend).toEqual(expected);
    for (const label of [
      "Up",
      "Down",
      "Unknown",
      "Managed device",
      "Unmanaged peer",
      "Discovered endpoint",
      "Healthy",
      "Busy (over 80%)",
      "An end is down",
      "Learned from FDB",
      "Router",
      "Switch",
      "Firewall",
      "Storage",
    ]) {
      expect(legend).toContain(label);
    }
    expect(texts(page, "legend-group:")).toEqual([
      "STATUS",
      "KIND",
      "LINK",
      "TYPE",
    ]);
  });

  test("the legend sits under the frame, inside the page", () => {
    const frame: Extent = extentOf(frameOf(page));
    for (const item of items(page, "legend-")) {
      const extent: Extent = extentOf(item);
      expect(extent.minY).toBeGreaterThan(frame.maxY);
      expect(extent.maxX).toBeLessThanOrEqual(page.width);
      expect(extent.maxY).toBeLessThan(page.height);
    }
  });
});

describe("the header says what this is, whose network, where and when", () => {
  test("a site's map is titled with the site, with the project and the path to it", () => {
    const page: ExportPage = mapPage(build());
    expect(texts(page, "header:eyebrow")).toEqual(["NETWORK TOPOLOGY"]);
    expect(texts(page, "header:title")).toEqual(["Store 1042"]);
    expect(texts(page, "header:meta").join(" ")).toBe(
      "Acme Retail · North America > East · Exported Oct 10 2026, 14:32 CEST",
    );
  });

  test("the map of every device is titled with the project", () => {
    const page: ExportPage = mapPage(build({ scopeNames: [] }));
    expect(texts(page, "header:title")).toEqual(["Acme Retail"]);
    expect(texts(page, "header:meta").join(" ")).toBe(
      `${ALL_DEVICES_SCOPE} · Exported Oct 10 2026, 14:32 CEST`,
    );
  });

  test("without a project name it is simply 'All devices'", () => {
    const page: ExportPage = mapPage(
      build({ scopeNames: [], projectName: undefined }),
    );
    expect(texts(page, "header:title")).toEqual(["All devices"]);
    expect(texts(page, "header:meta").join(" ")).toBe(
      "Exported Oct 10 2026, 14:32 CEST",
    );
  });

  test("the status line counts devices by status and links by trouble", () => {
    const page: ExportPage = mapPage(build());
    expect(texts(page, "header:device-count")).toEqual(["12 devices"]);
    expect(texts(page, "header:status:up")).toEqual(["7 up"]);
    expect(texts(page, "header:status:down")).toEqual(["2 down"]);
    expect(texts(page, "header:status:unknown")).toEqual(["3 unknown"]);
    expect(texts(page, "header:connection-count")).toEqual(["9 connections"]);
    expect(texts(page, "header:link-problems")).toEqual(["(1 down, 1 busy)"]);
    // Status dots in the map's own colours.
    const dot: ExportCircleItem = items(
      page,
      "header:status-dot:down",
    )[0] as ExportCircleItem;
    expect(dot.fill).toBe("#dc2626");
  });

  test("a map with nothing wrong says so by saying nothing about trouble", () => {
    const page: ExportPage = mapPage(
      build({
        topology: {
          nodes: [
            device("a", "A", "router", "up"),
            device("b", "B", "switch", "up"),
          ],
          edges: [link("a", "b")],
        },
      }),
    );
    expect(texts(page, "header:device-count")).toEqual(["2 devices"]);
    expect(texts(page, "header:connection-count")).toEqual(["1 connection"]);
    expect(texts(page, "header:link-problems")).toEqual([]);
    expect(texts(page, "header:filters")).toEqual([]);
  });

  test("an unfiltered map has no filter line", () => {
    expect(texts(mapPage(build()), "header:filters")).toEqual([]);
  });

  test("the file and the PDF are named after the map", () => {
    const document: NetworkTopologyExportDocument = build();
    expect(document.title).toBe("Network topology - Store 1042");
    expect(document.fileLabel).toBe("network-topology-Store 1042");
    expect(document.subject).toBe(
      "Network topology of North America > East > Store 1042, exported Oct 10 2026, 14:32 CEST",
    );
  });

  test("the partial-map warnings the live view shows are in the header too", () => {
    const page: ExportPage = mapPage(
      build({
        notices: {
          isTruncated: true,
          endpointsTruncated: true,
          droppedEndpointCount: 3,
          suppressedNodeCount: 1,
        },
      }),
    );
    expect(texts(page, "header:notice").join(" ")).toContain(
      "This map shows part of a large network.",
    );
    expect(texts(page, "header:notice").join(" ")).toContain(
      "Showing up to 2,000 endpoints",
    );
    expect(texts(page, "header:notice").join(" ")).toContain(
      "3 endpoints not shown",
    );
    expect(texts(page, "header:notice").join(" ")).toContain(
      "1 node is hidden from this map",
    );
  });
});

describe("the reader's own arrangement and filters", () => {
  test("a device the reader dragged is drawn where they left it", () => {
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "force",
      STORE_NODES,
      STORE_EDGES,
    );
    const r1: TopologyPoint = model.positions.get("r1")!;
    const plain: ExportPage = mapPage(build({ layoutModel: model }));
    const moved: ExportPage = mapPage(
      build({
        layoutModel: model,
        positionOverrides: new Map<string, TopologyPoint>([
          ["lab1", { x: r1.x + 40, y: r1.y }],
        ]),
      }),
    );
    const centre: (page: ExportPage, id: string) => [number, number] = (
      page: ExportPage,
      id: string,
    ): [number, number] => {
      const extent: Extent = extentOf(shapeOf(page, id));
      return [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2];
    };
    // Unmoved, the lab router sits in its strip, far from the edge router.
    const before: number = Math.hypot(
      centre(plain, "lab1")[0] - centre(plain, "r1")[0],
      centre(plain, "lab1")[1] - centre(plain, "r1")[1],
    );
    const after: number = Math.hypot(
      centre(moved, "lab1")[0] - centre(moved, "r1")[0],
      centre(moved, "lab1")[1] - centre(moved, "r1")[1],
    );
    expect(after).toBeLessThan(before);
    // Forty layout units to the right, at the page's scale.
    expect(centre(moved, "lab1")[0] - centre(moved, "r1")[0]).toBeCloseTo(
      40 * buildNetworkTopologyExportDocument(
        input({
          layoutModel: model,
          positionOverrides: new Map<string, TopologyPoint>([
            ["lab1", { x: r1.x + 40, y: r1.y }],
          ]),
        }),
        measure,
      ).summary.diagramScale,
      3,
    );
  });

  test("the layout the map drew is the layout the PDF draws", () => {
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "tiered",
      STORE_NODES,
      STORE_EDGES,
    );
    // A model the PDF could not have computed itself: everything on a line.
    const line: TopologyLayoutModel = {
      ...model,
      positions: new Map<string, TopologyPoint>(
        STORE_NODES.map(
          (node: NetworkTopologyNode, index: number): [string, TopologyPoint] => {
            return [node.id, { x: index * 200, y: 100 }];
          },
        ),
      ),
      componentBoxes: [],
      groups: [],
    };
    const page: ExportPage = mapPage(
      build({ layoutModel: line, layoutMode: "force" }),
    );
    const ys: Array<number> = STORE_NODES.map((node: NetworkTopologyNode) => {
      const extent: Extent = extentOf(shapeOf(page, node.id));
      return Math.round(((extent.minY + extent.maxY) / 2) * 1000) / 1000;
    });
    expect(new Set<number>(ys).size).toBe(1);
    const xs: Array<number> = STORE_NODES.map((node: NetworkTopologyNode) => {
      const extent: Extent = extentOf(shapeOf(page, node.id));
      return (extent.minX + extent.maxX) / 2;
    });
    expect([...xs].sort((a: number, b: number) => a - b)).toEqual(xs);
  });

  test("a hidden node type is left out of the map, the tables and the counts", () => {
    const document: NetworkTopologyExportDocument = build({
      visibleKinds: new Set<TopologyNodeKind>(["device", "unmanaged"]),
    });
    const page: ExportPage = mapPage(document);
    expect(items(page, "node-shape:ep1")).toHaveLength(0);
    expect(items(page, "node-shape:ep2")).toHaveLength(0);
    expect(allTexts(document)).not.toContain("Till 1");
    expect(texts(page, "header:device-count")).toEqual(["10 devices"]);
    expect(texts(page, "header:filters").join(" ")).toBe(
      "Filtered view: Hidden: Endpoints.",
    );
  });

  test("the health filter keeps what needs attention, its neighbours faded, and rings the matches", () => {
    const document: NetworkTopologyExportDocument = build({
      healthFilterMode: "attention",
    });
    const page: ExportPage = mapPage(document);
    /*
     * The matches: the two devices that are down, the core switch with dark
     * ports, and the edge router whose link to the firewall is dead.
     */
    for (const nodeId of ["fw1", "cam1", "sw1", "r1"]) {
      expect(items(page, `node-halo:${nodeId}`)).toHaveLength(1);
    }
    const downHalo: ExportCircleItem = items(
      page,
      "node-halo:fw1",
    )[0] as ExportCircleItem;
    expect(downHalo.fill).toBe(blendWithPaper(HEALTH_STATE_COLORS.down, 0.16));
    const degradedHalo: ExportCircleItem = items(
      page,
      "node-halo:sw1",
    )[0] as ExportCircleItem;
    expect(degradedHalo.fill).toBe(
      blendWithPaper(HEALTH_STATE_COLORS.degraded, 0.16),
    );
    // Healthy devices with no link to a match are gone...
    expect(items(page, "node-shape:lab1")).toHaveLength(0);
    expect(items(page, "node-shape:spare1")).toHaveLength(0);
    // ...and a healthy neighbour stays, faded, without a ring.
    expect(items(page, "node-shape:sw2")).toHaveLength(1);
    expect(items(page, "node-halo:sw2")).toHaveLength(0);
    expect(fillOf(shapeOf(page, "sw2"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.up, 0.9 * 0.2),
    );
    expect(texts(page, "header:filters").join(" ")).toBe(
      "Filtered view: Health: Needs attention. Faded devices are shown for context.",
    );
  });

  test("a search fades every device that does not match, as on screen", () => {
    const page: ExportPage = mapPage(build({ searchText: "switch" }));
    expect(fillOf(shapeOf(page, "sw1"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.up, 0.9),
    );
    expect(fillOf(shapeOf(page, "r1"))).toBe(
      blendWithPaper(NODE_STATUS_COLORS.up, 0.9 * 0.2),
    );
    const r1Label: ExportTextItem = items(
      page,
      "node-label:r1",
    )[0] as ExportTextItem;
    expect(r1Label.color).toBe(blendWithPaper("#374151", 0.2));
    expect(texts(page, "header:filters").join(" ")).toBe(
      'Filtered view: Search: "switch". Faded devices are shown for context.',
    );
  });

  test("the endpoint VLAN is named when the map is narrowed to one", () => {
    const page: ExportPage = mapPage(
      build({
        vlanId: 20,
        topology: {
          nodes: STORE_NODES.filter((node: NetworkTopologyNode): boolean => {
            return node.id !== "ep2";
          }),
          edges: STORE_EDGES.filter((edge: NetworkTopologyEdge): boolean => {
            return edge.toNodeId !== "ep2";
          }),
        },
      }),
    );
    expect(texts(page, "header:filters").join(" ")).toBe(
      "Filtered view: Endpoints in VLAN 20 only.",
    );
  });

  test("only node types the network has can be called hidden", () => {
    expect(
      describeExportFilters(
        {
          healthFilterMode: "all",
          visibleKinds: new Set<TopologyNodeKind>(["device"]),
          vlanId: null,
          searchText: "",
        },
        new Set<TopologyNodeKind>(["device", "endpoint"]),
      ),
    ).toBe("Filtered view: Hidden: Endpoints.");
    expect(
      describeExportFilters(
        {
          healthFilterMode: "all",
          visibleKinds: new Set<TopologyNodeKind>(["device"]),
          vlanId: null,
          searchText: "",
        },
        new Set<TopologyNodeKind>(["device"]),
      ),
    ).toBe("");
  });

  test("every filter at once is one sentence, in the toolbar's own words", () => {
    expect(
      describeExportFilters(
        {
          healthFilterMode: "down",
          visibleKinds: new Set<TopologyNodeKind>(["device"]),
          vlanId: 30,
          searchText: "  core ",
        },
        ALL_NODE_KINDS,
      ),
    ).toBe(
      'Filtered view: Health: Down; Hidden: Discovered neighbors, Endpoints; Endpoints in VLAN 30 only; Search: "core". Faded devices are shown for context.',
    );
  });

  test("no notices means no notice lines", () => {
    expect(describeExportNotices(undefined)).toEqual([]);
    expect(
      describeExportNotices({ droppedEndpointCount: 0, suppressedNodeCount: 0 }),
    ).toEqual([]);
    expect(describeExportNotices({ suppressedNodeCount: 2 })).toEqual([
      "2 nodes are hidden from this map by your project.",
    ]);
  });
});

describe("the PDF is light, whatever the dashboard's theme", () => {
  test("every colour in the document is plain hex, never a theme variable", () => {
    for (const document of [
      build(),
      build({ healthFilterMode: "attention", searchText: "e" }),
      build({ layoutMode: "tiered" }),
    ]) {
      for (const page of document.pages) {
        for (const item of page.items) {
          for (const color of colorsOf(item)) {
            expect(color).toMatch(HEX);
          }
        }
      }
    }
  });

  test("the page is white: no item paints a dark background", () => {
    const page: ExportPage = mapPage(build());
    expect(frameOf(page).fill).toBeUndefined();
    for (const item of items(page, "hull:")) {
      expect((item as ExportRectItem).fill).toBe(
        blendWithPaper("#f9fafb", (item as ExportRectItem).stroke?.dash ? 0.65 : 0.4),
      );
    }
  });

  test("the same map always lays out to the same document", () => {
    expect(build()).toEqual(build());
  });
});

describe("page size: legible names at any size, as vectors", () => {
  test("a small site fits one A4 page, drawn no larger than the live map's 100%", () => {
    const document: NetworkTopologyExportDocument = build();
    const page: ExportPage = mapPage(document);
    expect([page.width, page.height].sort()).toEqual(
      [A4_SHORT_SIDE, A4_LONG_SIDE].sort(),
    );
    expect(document.summary.diagramScale).toBeLessThanOrEqual(MAX_DIAGRAM_SCALE);
    expect(document.summary.diagramScale).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_DIAGRAM_SCALE,
    );
    expect(document.summary.isEnlargedPage).toBe(false);
    expect(document.summary.chromeScale).toBe(1);
  });

  test("three devices are not blown up to fill the page", () => {
    const nodes: Array<NetworkTopologyNode> = [
      device("a", "A", "router", "up"),
      device("b", "B", "switch", "up"),
      device("c", "C", "switch", "down"),
    ];
    const document: NetworkTopologyExportDocument = build({
      topology: { nodes: nodes, edges: [link("a", "b"), link("a", "c")] },
      // A compact site, as the tiered layout draws one.
      layoutModel: {
        positions: new Map<string, TopologyPoint>([
          ["a", { x: 100, y: 0 }],
          ["b", { x: 0, y: 120 }],
          ["c", { x: 200, y: 120 }],
        ]),
        componentBoxes: [],
        groups: [],
        contentWidth: 200,
        contentHeight: 120,
      },
    });
    expect(document.summary.diagramScale).toBe(MAX_DIAGRAM_SCALE);
    // Centred in the frame.
    const page: ExportPage = mapPage(document);
    const frame: Extent = extentOf(frameOf(page));
    const drawing: Array<Extent> = diagramItems(page).map(extentOf);
    const left: number = Math.min(
      ...drawing.map((extent: Extent): number => {
        return extent.minX;
      }),
    );
    const right: number = Math.max(
      ...drawing.map((extent: Extent): number => {
        return extent.maxX;
      }),
    );
    expect(Math.abs(left - frame.minX - (frame.maxX - right))).toBeLessThan(40);
  });

  test("a tall drawing gets a portrait page, a wide one landscape", () => {
    const tall: NetworkTopologyExportDocument = build({
      topology: { nodes: STORE_NODES, edges: STORE_EDGES },
      layoutModel: {
        positions: new Map<string, TopologyPoint>(
          STORE_NODES.map(
            (node: NetworkTopologyNode, index: number): [string, TopologyPoint] => {
              return [node.id, { x: 0, y: index * 60 }];
            },
          ),
        ),
        componentBoxes: [],
        groups: [],
        contentWidth: 100,
        contentHeight: 720,
      },
    });
    expect(mapPage(tall).height).toBeGreaterThan(mapPage(tall).width);
    const wide: NetworkTopologyExportDocument = build({
      layoutModel: {
        positions: new Map<string, TopologyPoint>(
          STORE_NODES.map(
            (node: NetworkTopologyNode, index: number): [string, TopologyPoint] => {
              return [node.id, { x: index * 70, y: 0 }];
            },
          ),
        ),
        componentBoxes: [],
        groups: [],
        contentWidth: 840,
        contentHeight: 100,
      },
    });
    expect(mapPage(wide).width).toBeGreaterThan(mapPage(wide).height);
  });

  test("a network too large for A4 gets a larger page instead of microscopic names", () => {
    // Six hundred devices on one site, cabled as one tree.
    const document: NetworkTopologyExportDocument = build({
      topology: estate(600, 600),
      scopeNames: [],
    });
    const page: ExportPage = mapPage(document);
    expect(document.summary.isEnlargedPage).toBe(true);
    expect(document.summary.diagramScale).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_DIAGRAM_SCALE - 1e-9,
    );
    expect(Math.max(page.width, page.height)).toBeGreaterThan(A4_LONG_SIDE);
    // Every device's name at least 5.4pt — the size the live map draws names down to.
    for (const item of items(page, "node-label:")) {
      expect((item as ExportTextItem).fontSize).toBeGreaterThanOrEqual(
        12 * MIN_LEGIBLE_DIAGRAM_SCALE - 1e-9,
      );
    }
    for (const item of diagramItems(page)) {
      expectInside(extentOf(item), extentOf(frameOf(page)));
    }
  });

  test("an enlarged page enlarges its header and legend with it", () => {
    const document: NetworkTopologyExportDocument = build({
      topology: estate(600),
      scopeNames: [],
    });
    const page: ExportPage = mapPage(document);
    const title: ExportTextItem = items(page, "header:title")[0] as ExportTextItem;
    if (document.summary.chromeScale > 1) {
      expect(title.fontSize).toBeCloseTo(17 * document.summary.chromeScale, 6);
    }
    const footer: ExportTextItem = items(page, "footer:page")[0] as ExportTextItem;
    expect(footer.fontSize).toBeCloseTo(7 * document.summary.chromeScale, 6);
    expect(footer.y).toBeLessThan(page.height);
  });

  test("the page never grows past what PDF readers open", () => {
    // Drawn as one column some 80,000 layout units tall.
    const document: NetworkTopologyExportDocument = build({
      topology: chains(600),
      scopeNames: [],
    });
    const page: ExportPage = mapPage(document);
    expect(Math.max(page.width, page.height)).toBeCloseTo(MAX_PAGE_SIDE, 3);
    expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(
      MAX_PAGE_SIDE + 1e-6,
    );
    // The map shrinks to fit the largest page instead of running off it.
    expect(document.summary.diagramScale).toBeLessThan(MIN_LEGIBLE_DIAGRAM_SCALE);
    for (const item of diagramItems(page)) {
      expectInside(extentOf(item), extentOf(frameOf(page)));
    }
  });

  test("hundreds of devices lay out quickly", () => {
    const large: { nodes: Array<NetworkTopologyNode>; edges: Array<NetworkTopologyEdge> } =
      estate(1500);
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "force",
      large.nodes,
      large.edges,
    );
    const started: bigint = process.hrtime.bigint();
    const document: NetworkTopologyExportDocument = build({
      topology: large,
      layoutModel: model,
    });
    const elapsedMs: number =
      Number(process.hrtime.bigint() - started) / 1000000;
    expect(document.summary.drawnNodeCount).toBe(1500);
    expect(document.summary.deviceRowCount).toBe(1500);
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe("the tables list every device and every connection", () => {
  const document: NetworkTopologyExportDocument = build();
  const tablePages: Array<ExportPage> = document.pages.slice(1);

  function cellsOfRow(
    table: "devices" | "connections",
    row: number,
  ): Array<string> {
    const cells: Array<string> = [];
    for (const page of tablePages) {
      for (const item of page.items) {
        const prefix: string = `table-cell:${table}:${row}:`;
        if (item.type === "text" && item.tag.startsWith(prefix)) {
          const column: number = Number(item.tag.slice(prefix.length));
          cells[column] = cells[column] ? `${cells[column]} ${item.text}` : item.text;
        }
      }
    }
    return cells;
  }

  function rowsOf(table: "devices" | "connections"): Array<Array<string>> {
    const rows: Array<Array<string>> = [];
    const count: number =
      table === "devices"
        ? document.summary.deviceRowCount
        : document.summary.connectionRowCount;
    for (let row: number = 0; row < count; row++) {
      rows.push(cellsOfRow(table, row));
    }
    return rows;
  }

  test("every device on the map has a row, managed first, then peers, then endpoints", () => {
    const rows: Array<Array<string>> = rowsOf("devices");
    expect(rows.map((row: Array<string>): string => row[0]!)).toEqual([
      "Back office switch",
      "Backup NAS",
      "Core switch",
      "Entrance camera",
      "Lab router",
      "Load balancer",
      "Perimeter firewall",
      "Spare switch",
      "Store edge router",
      "Reception phone",
      "Menu board",
      "Till 1",
    ]);
  });

  test("a device's row has its type, kind, status, vendor, address, interfaces and links", () => {
    const rows: Array<Array<string>> = rowsOf("devices");
    const row: (name: string) => Array<string> = (
      name: string,
    ): Array<string> => {
      return rows.find((candidate: Array<string>): boolean => {
        return candidate[0] === name;
      })!;
    };
    expect(row("Store edge router")).toEqual([
      "Store edge router",
      "Router",
      "Managed device",
      "Up",
      "Cisco ISR 4331",
      "10.42.0.1",
      "4 up, 0 down",
      "2",
    ]);
    expect(row("Perimeter firewall").slice(1, 4)).toEqual([
      "Firewall",
      "Managed device",
      "Down",
    ]);
    expect(row("Reception phone").slice(1, 6)).toEqual([
      "IP phone",
      "Unmanaged peer",
      "Unknown",
      "-",
      "10.42.3.40",
    ]);
    expect(row("Till 1")[2]).toBe("Endpoint");
    expect(row("Till 1")[5]).toBe("10.42.20.11 00:1a:2b:3c:4d:5e");
  });

  test("a device with no links says so, so unlinked devices can be found in the list", () => {
    const rows: Array<Array<string>> = rowsOf("devices");
    for (const name of ["Spare switch", "Lab router"]) {
      const row: Array<string> = rows.find((candidate: Array<string>) => {
        return candidate[0] === name;
      })!;
      expect(row[7]).toBe("None");
    }
  });

  test("each status cell carries a dot in the status colour", () => {
    const dots: Array<ExportCircleItem> = tablePages.flatMap(
      (page: ExportPage): Array<ExportCircleItem> => {
        return items(page, "table-dot:devices:") as Array<ExportCircleItem>;
      },
    );
    expect(dots).toHaveLength(STORE_NODES.length);
    const colors: Set<string> = new Set<string>(
      dots.map((dot: ExportCircleItem): string => {
        return dot.fill || "";
      }),
    );
    expect(colors).toEqual(new Set<string>(["#16a34a", "#dc2626", "#64748b"]));
  });

  test("every connection has a row with its ports, state, utilization and source", () => {
    const rows: Array<Array<string>> = rowsOf("connections");
    expect(rows).toHaveLength(STORE_EDGES.length);
    const row: (from: string, to: string) => Array<string> = (
      from: string,
      to: string,
    ): Array<string> => {
      return rows.find((candidate: Array<string>): boolean => {
        return candidate[0] === from && candidate[2] === to;
      })!;
    };
    expect(row("Store edge router", "Perimeter firewall")).toEqual([
      "Store edge router",
      "Gi0/0/1",
      "Perimeter firewall",
      "port1",
      "Down",
      "-",
      "LLDP",
    ]);
    // The interface's own name wins over the advertised port.
    expect(row("Store edge router", "Core switch").slice(1, 7)).toEqual([
      "Gi0/0/2",
      "Core switch",
      "Te1/1/1",
      "Busy",
      "91%",
      "LLDP",
    ]);
    expect(row("Core switch", "Back office switch").slice(4)).toEqual([
      "Healthy",
      "12%",
      "LLDP, CDP",
    ]);
    expect(row("Back office switch", "Backup NAS").slice(4)).toEqual([
      "Healthy",
      "-",
      "Drawn by hand",
    ]);
    expect(row("Back office switch", "Till 1").slice(4)).toEqual([
      "No data",
      "-",
      "Forwarding table",
    ]);
  });

  test("connections are ordered by the devices at their ends", () => {
    const rows: Array<Array<string>> = rowsOf("connections");
    const pairs: Array<string> = rows.map((row: Array<string>): string => {
      return `${row[0]} / ${row[2]}`;
    });
    expect(pairs).toEqual(
      [...pairs].sort((a: string, b: string): number => {
        return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
      }),
    );
  });

  test("the tables carry titles with counts and the column headings", () => {
    const tableTexts: Array<string> = tablePages.flatMap(
      (page: ExportPage): Array<string> => {
        return texts(page, "table-");
      },
    );
    expect(tableTexts).toContain("Devices (12)");
    expect(tableTexts).toContain("Connections (9)");
    for (const heading of [
      "DEVICE",
      "TYPE",
      "KIND",
      "STATUS",
      "VENDOR AND MODEL",
      "ADDRESS",
      "INTERFACES",
      "LINKS",
      "FROM",
      "PORT",
      "TO",
      "UTILIZATION",
      "SOURCE",
    ]) {
      expect(tableTexts).toContain(heading);
    }
  });

  test("long tables break across pages: no row past the foot, headings repeated", () => {
    const large: NetworkTopologyExportDocument = build({
      topology: estate(160),
      scopeNames: [],
    });
    const pages: Array<ExportPage> = large.pages.slice(1);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
      expect(page.kind).toBe("table");
      for (const item of page.items) {
        if (item.tag.startsWith("table-")) {
          expect(extentOf(item).maxY).toBeLessThanOrEqual(TABLE_BOTTOM_LIMIT + 0.01);
        }
      }
      // Every table page starts with a table's headings.
      expect(items(page, "table-header:").length).toBeGreaterThan(0);
    }
    const continued: Array<string> = pages.flatMap(
      (page: ExportPage): Array<string> => {
        return texts(page, "table-continued:");
      },
    );
    expect(continued).toContain("Devices (160), continued");
    expect(continued).toContain("Connections (153), continued");
    expect(large.summary.deviceRowCount).toBe(160);
    expect(large.summary.connectionRowCount).toBe(153);
  });

  test("every page is numbered, of the whole document", () => {
    const pageCount: number = document.pages.length;
    document.pages.forEach((page: ExportPage, index: number) => {
      expect(texts(page, "footer:page")).toEqual([
        `Page ${index + 1} of ${pageCount}`,
      ]);
      expect(texts(page, "footer:scope")).toEqual([
        "Network topology · North America > East > Store 1042",
      ]);
    });
  });
});

describe("edge cases", () => {
  test("a map filtered down to nothing says so, and its tables say they are empty", () => {
    const document: NetworkTopologyExportDocument = build({
      visibleKinds: new Set<TopologyNodeKind>(),
    });
    const page: ExportPage = mapPage(document);
    expect(texts(page, "empty-diagram")).toEqual([EMPTY_DIAGRAM_TEXT]);
    expect(allTexts(document)).toContain("No devices on this map.");
    expect(allTexts(document)).toContain("No connections on this map.");
    expect(document.summary.drawnNodeCount).toBe(0);
  });

  test("an empty topology still produces a valid document", () => {
    const document: NetworkTopologyExportDocument = build({
      topology: { nodes: [], edges: [] },
    });
    expect(document.pages.length).toBeGreaterThanOrEqual(2);
    expect(texts(mapPage(document), "empty-diagram")).toEqual([
      EMPTY_DIAGRAM_TEXT,
    ]);
  });

  test("names in scripts the PDF font cannot draw are replaced, and the page says why", () => {
    const document: NetworkTopologyExportDocument = build({
      topology: {
        nodes: [
          device("a", "東京コア", "router", "up"),
          device("b", "Zürich access", "switch", "up"),
        ],
        edges: [link("a", "b")],
      },
    });
    const page: ExportPage = mapPage(document);
    expect(document.summary.isLossy).toBe(true);
    expect(texts(page, "node-label:a").join("")).toBe("????");
    expect(texts(page, "node-label:b").join(" ")).toBe("Zürich access");
    expect(texts(page, "header:footnote").join(" ")).toBe(LOSSY_TEXT_NOTICE);
  });

  test("Latin names do not trigger the replacement note", () => {
    const document: NetworkTopologyExportDocument = build({
      projectName: "Équipe Réseau",
    });
    expect(document.summary.isLossy).toBe(false);
    expect(texts(mapPage(document), "header:footnote")).toEqual([]);
    expect(texts(mapPage(document), "header:meta").join(" ")).toContain(
      "Équipe Réseau",
    );
  });

  test("malformed rows in the payload are skipped, not drawn", () => {
    const document: NetworkTopologyExportDocument = build({
      topology: {
        nodes: [
          ...STORE_NODES,
          null as unknown as NetworkTopologyNode,
          { name: "no id" } as unknown as NetworkTopologyNode,
        ],
        edges: [
          ...STORE_EDGES,
          { fromNodeId: "r1" } as unknown as NetworkTopologyEdge,
        ],
      },
    });
    expect(document.summary.drawnNodeCount).toBe(STORE_NODES.length);
    expect(document.summary.drawnEdgeCount).toBe(STORE_EDGES.length);
  });
});
