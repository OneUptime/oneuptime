import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { TopologyLayoutModel } from "../../NetworkDevice/TopologyLayout";
import { TopologyPoint } from "../../NetworkDevice/TopologyGraphUtil";
import {
  TopologyNodeKind,
  TopologyViewModel,
  buildTopologyViewModel,
  kindOfNode,
} from "../NetworkTopologyViewModel";
import {
  NetworkLinkState,
  TopologyLegendEntry,
  buildTopologyLegend,
  edgeKeyForEdge,
} from "../NetworkTopologyMeta";
import {
  TopologyHealthFilterMode,
  isHealthFilterActive,
} from "../TopologyHealthFilter";
import {
  PositionOverrides,
  TopologyLayoutMode,
  mergePositionOverrides,
} from "../TopologyPositionOverrides";
import {
  TopologyHullView,
  buildTopologyHulls,
  computeTopologyLayoutModel,
} from "../NetworkTopologyDrawing";
import {
  HeaderContent,
  SummaryCounts,
  footerItems,
  layoutHeader,
  layoutLegend,
} from "./ExportChrome";
import {
  DrawnLabel,
  WorldBounds,
  buildDiagramItems,
  labelFontSizeFor,
  measureWorldBounds,
} from "./ExportDiagram";
import {
  A4_LONG_SIDE,
  A4_SHORT_SIDE,
  ExportBlock,
  ExportPage,
  PAGE_MARGIN,
  PDF_INK,
  textItem,
  transformExportItem,
} from "./ExportItems";
import { ExportTable, buildTopologyTables, layoutTables } from "./ExportTables";
import { PdfStringCollector, TextMeasure } from "./ExportText";

/*
 * The PDF export of the network topology map (issue #4616), laid out —
 * every page, every shape, every line of text and where it goes — by one
 * pure function.
 *
 * Network teams need the topology as a document for an assessment, a change
 * request or an incident review, and a screenshot only holds the part of the
 * map that happened to be on screen. The export draws the WHOLE map the
 * reader is looking at, as vectors, from the same decisions the live canvas
 * makes:
 *
 *   - the layout the canvas drew (handed over by the graph), with the
 *     devices the reader dragged where they left them;
 *   - the same filters: node types, the endpoint VLAN and the health filter
 *     remove nodes, a search fades the rest, exactly as on screen;
 *   - the same silhouettes, status colours, link colours and dashes, the
 *     same islands and the same "Not linked to anything" strip;
 *   - the same legend.
 *
 * What the screen has and the page does not: hover, selection and the
 * "moved by you" rings are about using the map, not reading it. What the
 * page has and the screen does not: every name at once (a printed map
 * cannot be zoomed into to reveal them), a header that says what this is,
 * whose network, which site, when, and what was filtered out — and a table
 * of every device and every connection, with ports.
 *
 * Light only: colours are resolved to their light-mode values whatever the
 * exporting dashboard's theme (see ExportColor).
 */

export type { ExportPage, ExportItem } from "./ExportItems";

export interface NetworkTopologyExportNotices {
  // The device query hit its per-project cap: the map is partial.
  isTruncated?: boolean | undefined;
  // Only the first 2,000 endpoints were returned.
  endpointsTruncated?: boolean | undefined;
  // Endpoints dropped because no switch they hang off is on the map.
  droppedEndpointCount?: number | undefined;
  // Nodes the project has hidden from the map.
  suppressedNodeCount?: number | undefined;
}

export interface NetworkTopologyExportInput {
  /*
   * What the map draws: the topology after the endpoint VLAN filter, which
   * (unlike the type and health filters) changes the layout's input.
   */
  topology: NetworkTopology;
  /*
   * The layout the live map drew. Computed from `layoutMode` when absent,
   * which only happens for an export from a map that never drew.
   */
  layoutModel?: TopologyLayoutModel | undefined;
  layoutMode: TopologyLayoutMode;
  positionOverrides: PositionOverrides;
  searchText: string;
  visibleKinds: ReadonlySet<TopologyNodeKind>;
  /*
   * The node types the network has at all, so the header only calls a type
   * "hidden" when there was something of it to hide. Defaults to the types
   * present in `topology`.
   */
  availableKinds?: ReadonlySet<TopologyNodeKind> | undefined;
  healthFilterMode: TopologyHealthFilterMode;
  // The endpoint VLAN the map is narrowed to, or null for all of them.
  vlanId?: number | null | undefined;
  projectName?: string | undefined;
  /*
   * The site the map is scoped to, as its breadcrumb from the top of the
   * hierarchy ("North America", "East", "Store 1042"). Empty for the map of
   * every device in the project.
   */
  scopeNames: Array<string>;
  // When the export was made, already formatted for the reader.
  exportedAtText: string;
  notices?: NetworkTopologyExportNotices | undefined;
}

export interface NetworkTopologyExportSummary {
  drawnNodeCount: number;
  drawnEdgeCount: number;
  // Points per layout unit on the map page.
  diagramScale: number;
  // How much the map page's header, legend and margins were enlarged.
  chromeScale: number;
  // True when the map page is larger than A4.
  isEnlargedPage: boolean;
  deviceRowCount: number;
  connectionRowCount: number;
  // True when a name had characters the PDF font cannot draw.
  isLossy: boolean;
}

export interface NetworkTopologyExportDocument {
  // The PDF's own title (shown by readers in the window title).
  title: string;
  subject: string;
  // What the file is named after, before the export time is added.
  fileLabel: string;
  pages: Array<ExportPage>;
  summary: NetworkTopologyExportSummary;
}

/*
 * ---------------------------------------------------------------------------
 * The map page's size
 * ---------------------------------------------------------------------------
 */

/*
 * The smallest the map is drawn. Device names are 12 layout units tall, so
 * this keeps them at 5.4pt — about the size the live map stops drawing names
 * at (LABEL_VISIBILITY_MIN_SCALE), which is where they stop being readable.
 */
export const MIN_LEGIBLE_DIAGRAM_SCALE: number = 0.45;

/*
 * The largest it is drawn: the live map's own 100%. A three-device site is
 * not blown up to fill a page with 30pt names.
 */
export const MAX_DIAGRAM_SCALE: number = 1;

/*
 * The longest side a page may have: PDF readers refuse pages past 200
 * inches, which is 14,400 points.
 */
export const MAX_PAGE_SIDE: number = 14400;

const FRAME_PADDING: number = 16;
const HEADER_TO_FRAME_GAP: number = 12;
const FRAME_TO_LEGEND_GAP: number = 10;
const LEGEND_TO_FOOTER_GAP: number = 8;
const FOOTER_HEIGHT: number = 12;

export type PageOrientation = "landscape" | "portrait";

/** The header and legend as laid out on one A4 orientation. */
export interface PageChrome {
  orientation: PageOrientation;
  width: number;
  height: number;
  // Laid out with its top-left corner at the page margins.
  header: ExportBlock;
  // Laid out with its top at 0; moved under the frame once that is placed.
  legend: ExportBlock;
}

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramPagePlan {
  orientation: PageOrientation;
  width: number;
  height: number;
  // Points per layout unit.
  diagramScale: number;
  // How much the header, legend, margins and footer were enlarged.
  chromeScale: number;
  // The rounded frame around the map.
  frame: PageBox;
  // The area inside the frame the map is centred in.
  box: PageBox;
  // Where the legend's top edge goes.
  legendTop: number;
}

/** The height of a page's chrome: everything but the map. */
function fixedHeightOf(chrome: PageChrome): number {
  return (
    PAGE_MARGIN * 2 +
    chrome.header.height +
    HEADER_TO_FRAME_GAP +
    FRAME_PADDING * 2 +
    FRAME_TO_LEGEND_GAP +
    chrome.legend.height +
    LEGEND_TO_FOOTER_GAP +
    FOOTER_HEIGHT
  );
}

function boxWidthOf(chrome: PageChrome): number {
  return chrome.width - PAGE_MARGIN * 2 - FRAME_PADDING * 2;
}

function fitScaleOn(
  chrome: PageChrome,
  world: { width: number; height: number },
): number {
  return Math.min(
    boxWidthOf(chrome) / Math.max(1, world.width),
    Math.max(1, chrome.height - fixedHeightOf(chrome)) /
      Math.max(1, world.height),
  );
}

function planWithChrome(
  chrome: PageChrome,
  chromeScale: number,
  pageWidth: number,
  pageHeight: number,
  diagramScale: number,
): DiagramPagePlan {
  const frameTop: number =
    (PAGE_MARGIN + chrome.header.height + HEADER_TO_FRAME_GAP) * chromeScale;
  const frameBottom: number =
    pageHeight -
    (PAGE_MARGIN +
      FOOTER_HEIGHT +
      LEGEND_TO_FOOTER_GAP +
      chrome.legend.height +
      FRAME_TO_LEGEND_GAP) *
      chromeScale;
  const frame: PageBox = {
    x: PAGE_MARGIN * chromeScale,
    y: frameTop,
    width: pageWidth - PAGE_MARGIN * 2 * chromeScale,
    height: frameBottom - frameTop,
  };
  return {
    orientation: chrome.orientation,
    width: pageWidth,
    height: pageHeight,
    diagramScale: diagramScale,
    chromeScale: chromeScale,
    frame: frame,
    box: {
      x: frame.x + FRAME_PADDING * chromeScale,
      y: frame.y + FRAME_PADDING * chromeScale,
      width: frame.width - FRAME_PADDING * 2 * chromeScale,
      height: frame.height - FRAME_PADDING * 2 * chromeScale,
    },
    legendTop: frameBottom + FRAME_TO_LEGEND_GAP * chromeScale,
  };
}

/**
 * How big the map page is and how large the map is drawn on it.
 *
 * A map that fits A4 with its device names legible gets A4 — landscape or
 * portrait, whichever draws it larger — and is drawn as large as fits, up to
 * the live map's own 100%.
 *
 * A map that does not gets a page cut to its own size instead of shrinking
 * into illegibility: the names stay at the legible minimum and the page
 * grows around them. A map wider than A4 at that size widens the page, with
 * the header, legend and margins enlarged in proportion, so the page opens
 * looking like a normal page at any size; a map that is only taller gets a
 * longer page. Either way the page stops at the size PDF readers accept,
 * and the map shrinks to fit it after that. It is all vectors, so the reader
 * zooms in as far as they like, and a printer shrinks it onto paper.
 */
export function planDiagramPage(
  world: { width: number; height: number } | null,
  landscape: PageChrome,
  portrait: PageChrome,
): DiagramPagePlan {
  if (!world) {
    return planWithChrome(landscape, 1, landscape.width, landscape.height, 1);
  }

  const landscapeFit: number = fitScaleOn(landscape, world);
  const portraitFit: number = fitScaleOn(portrait, world);
  const a4: PageChrome =
    portraitFit > landscapeFit * 1.0001 ? portrait : landscape;
  const a4Fit: number = Math.max(landscapeFit, portraitFit);

  if (a4Fit >= MIN_LEGIBLE_DIAGRAM_SCALE) {
    return planWithChrome(
      a4,
      1,
      a4.width,
      a4.height,
      Math.min(a4Fit, MAX_DIAGRAM_SCALE),
    );
  }

  // Too large for A4: a page cut to the map.
  const chrome: PageChrome =
    world.width >= world.height ? landscape : portrait;
  const widthScale: number = boxWidthOf(chrome) / Math.max(1, world.width);
  let diagramScale: number;
  let chromeScale: number;
  if (widthScale >= MIN_LEGIBLE_DIAGRAM_SCALE) {
    // Only the height is the problem: a longer page, at the usual size.
    diagramScale = Math.min(widthScale, MAX_DIAGRAM_SCALE);
    chromeScale = 1;
  } else {
    diagramScale = MIN_LEGIBLE_DIAGRAM_SCALE;
    chromeScale =
      (world.width * MIN_LEGIBLE_DIAGRAM_SCALE) / boxWidthOf(chrome);
  }

  let pageWidth: number = chrome.width * chromeScale;
  let pageHeight: number =
    fixedHeightOf(chrome) * chromeScale + world.height * diagramScale;
  const longest: number = Math.max(pageWidth, pageHeight);
  if (longest > MAX_PAGE_SIDE) {
    const shrink: number = MAX_PAGE_SIDE / longest;
    pageWidth *= shrink;
    pageHeight *= shrink;
    chromeScale *= shrink;
    diagramScale *= shrink;
  }

  return planWithChrome(
    chrome,
    chromeScale,
    pageWidth,
    pageHeight,
    diagramScale,
  );
}

/*
 * ---------------------------------------------------------------------------
 * The header's words
 * ---------------------------------------------------------------------------
 */

export const ALL_DEVICES_SCOPE: string = "All devices";
export const EMPTY_DIAGRAM_TEXT: string =
  "Nothing on this map matches its filters.";
export const LOSSY_TEXT_NOTICE: string =
  "Some characters in names cannot be drawn in this PDF's font and were replaced.";

// The toolbar's own names for the node types it can hide.
const KIND_FILTER_LABELS: Record<TopologyNodeKind, string> = {
  device: "Monitored devices",
  unmanaged: "Discovered neighbors",
  endpoint: "Endpoints",
};

const KIND_ORDER: Array<TopologyNodeKind> = ["device", "unmanaged", "endpoint"];

// The health chips' own names.
const HEALTH_FILTER_LABELS: Record<TopologyHealthFilterMode, string> = {
  all: "All",
  attention: "Needs attention",
  down: "Down",
  degraded: "Degraded",
};

function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

/**
 * The header's "Filtered view" sentence, naming every filter that changes
 * what the map shows — or an empty string when the map is unfiltered.
 */
export function describeExportFilters(
  input: Pick<
    NetworkTopologyExportInput,
    "healthFilterMode" | "visibleKinds" | "vlanId" | "searchText"
  >,
  availableKinds: ReadonlySet<TopologyNodeKind>,
): string {
  const parts: Array<string> = [];
  if (isHealthFilterActive(input.healthFilterMode)) {
    parts.push(`Health: ${HEALTH_FILTER_LABELS[input.healthFilterMode]}`);
  }
  const hiddenKinds: Array<string> = KIND_ORDER.filter(
    (kind: TopologyNodeKind): boolean => {
      return availableKinds.has(kind) && !input.visibleKinds.has(kind);
    },
  ).map((kind: TopologyNodeKind): string => {
    return KIND_FILTER_LABELS[kind];
  });
  if (hiddenKinds.length > 0) {
    parts.push(`Hidden: ${hiddenKinds.join(", ")}`);
  }
  if (typeof input.vlanId === "number") {
    parts.push(`Endpoints in VLAN ${input.vlanId} only`);
  }
  const search: string = (input.searchText || "").trim();
  if (search) {
    parts.push(`Search: "${search}"`);
  }
  if (parts.length === 0) {
    return "";
  }
  const fades: boolean =
    Boolean(search) || isHealthFilterActive(input.healthFilterMode);
  return `Filtered view: ${parts.join("; ")}.${
    fades ? " Faded devices are shown for context." : ""
  }`;
}

/** The header's warnings about what the map leaves out. */
export function describeExportNotices(
  notices: NetworkTopologyExportNotices | undefined,
): Array<string> {
  const lines: Array<string> = [];
  if (notices?.isTruncated) {
    lines.push(
      "This map shows part of a large network. Open a specific site to export a smaller area in full.",
    );
  }
  if (notices?.endpointsTruncated) {
    lines.push("Showing up to 2,000 endpoints because this network is large.");
  }
  if (notices?.droppedEndpointCount && notices.droppedEndpointCount > 0) {
    lines.push(
      `${pluralize(notices.droppedEndpointCount, "endpoint", "endpoints")} not shown: no switch they connect to is on this map.`,
    );
  }
  if (notices?.suppressedNodeCount && notices.suppressedNodeCount > 0) {
    lines.push(
      `${pluralize(notices.suppressedNodeCount, "node is", "nodes are")} hidden from this map by your project.`,
    );
  }
  return lines;
}

/** How many devices and connections the map draws, by state. */
export function countDrawn(viewModel: TopologyViewModel): SummaryCounts {
  const byStatus: Record<NetworkTopologyNodeStatus, number> = {
    up: 0,
    down: 0,
    unknown: 0,
  };
  for (const nodeView of viewModel.nodes) {
    const status: NetworkTopologyNodeStatus =
      nodeView.status === "up" || nodeView.status === "down"
        ? nodeView.status
        : "unknown";
    byStatus[status]++;
  }
  const byLinkState: Record<NetworkLinkState, number> = {
    healthy: 0,
    saturated: 0,
    down: 0,
    unknown: 0,
  };
  for (const edgeView of viewModel.edges) {
    byLinkState[edgeView.state]++;
  }
  return {
    nodeTotal: viewModel.nodes.length,
    byStatus: byStatus,
    edgeTotal: viewModel.edges.length,
    byLinkState: byLinkState,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The document
 * ---------------------------------------------------------------------------
 */

function chromeFor(
  orientation: PageOrientation,
  header: HeaderContent,
  legend: Array<TopologyLegendEntry>,
  measure: TextMeasure,
): PageChrome {
  const width: number =
    orientation === "landscape" ? A4_LONG_SIDE : A4_SHORT_SIDE;
  const height: number =
    orientation === "landscape" ? A4_SHORT_SIDE : A4_LONG_SIDE;
  const contentWidth: number = width - PAGE_MARGIN * 2;
  return {
    orientation: orientation,
    width: width,
    height: height,
    header: layoutHeader(header, PAGE_MARGIN, PAGE_MARGIN, contentWidth, measure),
    legend: layoutLegend(legend, PAGE_MARGIN, 0, contentWidth, measure),
  };
}

/**
 * Lays out the whole PDF: the map page, then the device and connection
 * tables. Pure — the only outside knowledge it takes is how wide text is.
 */
export function buildNetworkTopologyExportDocument(
  input: NetworkTopologyExportInput,
  measure: TextMeasure,
): NetworkTopologyExportDocument {
  const strings: PdfStringCollector = new PdfStringCollector();
  const nodes: Array<NetworkTopologyNode> = (
    input.topology?.nodes || []
  ).filter((node: NetworkTopologyNode | null | undefined): boolean => {
    return Boolean(node && typeof node.id === "string");
  });
  const edges: Array<NetworkTopologyEdge> = (
    input.topology?.edges || []
  ).filter((edge: NetworkTopologyEdge | null | undefined): boolean => {
    return Boolean(edge && edge.fromNodeId && edge.toNodeId);
  });

  const model: TopologyLayoutModel =
    input.layoutModel ||
    computeTopologyLayoutModel(input.layoutMode, nodes, edges);
  const positions: Map<string, TopologyPoint> = mergePositionOverrides(
    model.positions,
    input.positionOverrides,
  );

  /*
   * The frame the live map draws, minus everything about USING it: no hover
   * focus, no selection, no "moved by you" rings.
   */
  const viewModel: TopologyViewModel = buildTopologyViewModel({
    nodes: nodes,
    edges: edges,
    positions: positions,
    searchText: input.searchText || "",
    visibleKinds: input.visibleKinds,
    healthFilterMode: input.healthFilterMode || "all",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
  });
  const hulls: Array<TopologyHullView> = buildTopologyHulls(
    model,
    viewModel.nodes,
  );

  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }
  const edgeByKey: Map<string, NetworkTopologyEdge> = new Map<
    string,
    NetworkTopologyEdge
  >();
  for (const edge of edges) {
    edgeByKey.set(edgeKeyForEdge(edge), edge);
  }

  // Device names, cleaned for the font, and measured for the map's extent.
  const labels: Map<string, DrawnLabel> = new Map<string, DrawnLabel>();
  for (const nodeView of viewModel.nodes) {
    const lines: Array<string> = nodeView.labelLines.map(
      (line: string): string => {
        return strings.clean(line);
      },
    );
    const fontSize: number = labelFontSizeFor(nodeView);
    let widestLine: number = 0;
    for (const line of lines) {
      widestLine = Math.max(widestLine, measure(line, fontSize, false));
    }
    labels.set(nodeView.id, { lines: lines, widestLine: widestLine });
  }
  const world: WorldBounds | null = measureWorldBounds(
    viewModel.nodes,
    labels,
    hulls,
    viewModel.isHealthFilterActive,
    measure,
  );

  // The tables read the same nodes and links, and clean their own strings.
  const tables: Array<ExportTable> = buildTopologyTables(
    viewModel,
    nodeById,
    edgeByKey,
    strings,
  );

  // Who, where and when.
  const scopeNames: Array<string> = (input.scopeNames || [])
    .map((name: string): string => {
      return strings.clean(name).trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
  const projectName: string = strings.clean(input.projectName || "").trim();
  const isScoped: boolean = scopeNames.length > 0;
  const title: string = isScoped
    ? scopeNames[scopeNames.length - 1]!
    : projectName || ALL_DEVICES_SCOPE;
  const metaParts: Array<string> = [];
  if (isScoped && projectName) {
    metaParts.push(projectName);
  }
  if (isScoped && scopeNames.length > 1) {
    metaParts.push(scopeNames.slice(0, -1).join(" > "));
  }
  if (!isScoped && projectName) {
    metaParts.push(ALL_DEVICES_SCOPE);
  }
  const exportedAt: string = strings.clean(input.exportedAtText);
  metaParts.push(`Exported ${exportedAt}`);

  const availableKinds: ReadonlySet<TopologyNodeKind> =
    input.availableKinds ||
    new Set<TopologyNodeKind>(
      nodes.map((node: NetworkTopologyNode): TopologyNodeKind => {
        return kindOfNode(node);
      }),
    );
  const filterText: string = strings.clean(
    describeExportFilters(input, availableKinds),
  );

  const legendEntries: Array<TopologyLegendEntry> = buildTopologyLegend(
    nodes,
  ).map((entry: TopologyLegendEntry): TopologyLegendEntry => {
    return { ...entry, label: strings.clean(entry.label) };
  });

  // Last, so it knows whether anything above had to be replaced.
  const headerContent: HeaderContent = {
    title: title,
    metaParts: metaParts,
    counts: countDrawn(viewModel),
    filterText: filterText,
    notices: describeExportNotices(input.notices),
    footnote: strings.isLossy ? LOSSY_TEXT_NOTICE : "",
  };

  const plan: DiagramPagePlan = planDiagramPage(
    world
      ? { width: world.maxX - world.minX, height: world.maxY - world.minY }
      : null,
    chromeFor("landscape", headerContent, legendEntries, measure),
    chromeFor("portrait", headerContent, legendEntries, measure),
  );
  const chrome: PageChrome = chromeFor(
    plan.orientation,
    headerContent,
    legendEntries,
    measure,
  );
  const c: number = plan.chromeScale;

  const diagramPage: ExportPage = {
    kind: "diagram",
    width: plan.width,
    height: plan.height,
    items: [],
  };
  for (const item of chrome.header.items) {
    diagramPage.items.push(transformExportItem(item, c));
  }
  diagramPage.items.push({
    type: "rect",
    tag: "frame",
    x: plan.frame.x,
    y: plan.frame.y,
    width: plan.frame.width,
    height: plan.frame.height,
    radius: 8 * c,
    stroke: { color: PDF_INK.rule, width: 0.75 * c },
  });

  if (world) {
    const s: number = plan.diagramScale;
    const drawnWidth: number = (world.maxX - world.minX) * s;
    const drawnHeight: number = (world.maxY - world.minY) * s;
    diagramPage.items.push(
      ...buildDiagramItems(viewModel, hulls, labels, {
        scale: s,
        offsetX: plan.box.x + (plan.box.width - drawnWidth) / 2 - world.minX * s,
        offsetY:
          plan.box.y + (plan.box.height - drawnHeight) / 2 - world.minY * s,
      }),
    );
  } else {
    diagramPage.items.push(
      textItem(
        "empty-diagram",
        EMPTY_DIAGRAM_TEXT,
        plan.box.x + plan.box.width / 2,
        plan.box.y + plan.box.height / 2,
        10 * c,
        PDF_INK.muted,
        { align: "center" },
      ),
    );
  }

  for (const item of chrome.legend.items) {
    diagramPage.items.push(transformExportItem(item, c, 0, plan.legendTop));
  }

  const pages: Array<ExportPage> = [
    diagramPage,
    ...layoutTables(tables, measure),
  ];

  const scopeLabel: string = isScoped
    ? scopeNames.join(" > ")
    : projectName
      ? `${projectName} > ${ALL_DEVICES_SCOPE}`
      : ALL_DEVICES_SCOPE;
  pages.forEach((page: ExportPage, index: number) => {
    page.items.push(
      ...footerItems(
        scopeLabel,
        index + 1,
        pages.length,
        page.width,
        page.height,
        page.kind === "diagram" ? c : 1,
      ),
    );
  });

  return {
    title: `Network topology - ${title}`,
    subject: `Network topology of ${scopeLabel}, exported ${exportedAt}`,
    fileLabel: `network-topology-${title}`,
    pages: pages,
    summary: {
      drawnNodeCount: viewModel.nodes.length,
      drawnEdgeCount: viewModel.edges.length,
      diagramScale: world ? plan.diagramScale : 0,
      chromeScale: c,
      isEnlargedPage:
        plan.width > A4_LONG_SIDE + 0.5 || plan.height > A4_LONG_SIDE + 0.5,
      deviceRowCount: tables[0]?.rows.length || 0,
      connectionRowCount: tables[1]?.rows.length || 0,
      isLossy: strings.isLossy,
    },
  };
}
