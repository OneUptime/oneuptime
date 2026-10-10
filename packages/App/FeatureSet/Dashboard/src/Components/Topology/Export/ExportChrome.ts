import { NetworkTopologyNodeStatus } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { geometryForShape } from "../../NetworkDevice/TopologyNodeShape";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
  NetworkLinkState,
  TopologyLegendEntry,
} from "../NetworkTopologyMeta";
import { PRINT_PAPER_COLOR, resolvePrintColor } from "./ExportColor";
import {
  ExportBlock,
  ExportItem,
  PAGE_MARGIN,
  PDF_INK,
  baselineFor,
  textItem,
} from "./ExportItems";
import { shapeItems } from "./ExportShapes";
import { TextMeasure, wrapTextToLines } from "./ExportText";

/*
 * The parts of the map page that are not the map: the header that says
 * what this is, whose network, which site, when, and whether anything was
 * filtered out; the legend; and the footer every page carries.
 *
 * Laid out at A4 size. A page enlarged for a large network scales these up
 * with it (see planDiagramPage), so they stay in proportion to the page.
 */

export const EXPORT_EYEBROW: string = "NETWORK TOPOLOGY";

export interface SummaryCounts {
  nodeTotal: number;
  byStatus: Record<NetworkTopologyNodeStatus, number>;
  edgeTotal: number;
  byLinkState: Record<NetworkLinkState, number>;
}

export interface HeaderContent {
  title: string;
  // Project, the path to the site, the export time — joined with dots.
  metaParts: Array<string>;
  counts: SummaryCounts;
  // "Filtered view: …", or empty when nothing is filtered.
  filterText: string;
  // Truncation and hidden-node warnings, one sentence each.
  notices: Array<string>;
  // The note that some characters could not be drawn, or empty.
  footnote: string;
}

const STATUS_ORDER: Array<NetworkTopologyNodeStatus> = ["up", "down", "unknown"];

const STATUS_WORDS: Record<NetworkTopologyNodeStatus, string> = {
  up: "up",
  down: "down",
  unknown: "unknown",
};

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/*
 * A line of tokens — a dot, a word, a swatch — laid left to right and
 * wrapped onto the next row when the next unit would not fit. A unit is kept
 * whole, so a legend group's name never ends a row on its own.
 */
interface FlowToken {
  width: number;
  // Draws the token with its left edge at x and its row's centre line at cy.
  draw: (x: number, cy: number) => Array<ExportItem>;
}

interface FlowUnit {
  tokens: Array<FlowToken>;
  gapBefore: number;
}

function flowUnits(
  units: Array<FlowUnit>,
  left: number,
  top: number,
  width: number,
  rowHeight: number,
  tokenGap: number,
): ExportBlock {
  const items: Array<ExportItem> = [];
  let x: number = left;
  let row: number = 0;
  let rowHasContent: boolean = false;

  for (const unit of units) {
    let unitWidth: number = 0;
    for (let index: number = 0; index < unit.tokens.length; index++) {
      unitWidth += unit.tokens[index]!.width + (index > 0 ? tokenGap : 0);
    }
    const gap: number = rowHasContent ? unit.gapBefore : 0;
    if (rowHasContent && x + gap + unitWidth > left + width) {
      row++;
      x = left;
      rowHasContent = false;
    } else {
      x += gap;
    }
    const cy: number = top + row * rowHeight + rowHeight / 2;
    for (let index: number = 0; index < unit.tokens.length; index++) {
      const token: FlowToken = unit.tokens[index]!;
      if (index > 0) {
        x += tokenGap;
      }
      items.push(...token.draw(x, cy));
      x += token.width;
    }
    rowHasContent = true;
  }

  return {
    items: items,
    height: units.length > 0 ? (row + 1) * rowHeight : 0,
  };
}

function wordToken(
  tag: string,
  text: string,
  fontSize: number,
  color: string,
  isBold: boolean,
  measure: TextMeasure,
): FlowToken {
  return {
    width: measure(text, fontSize, isBold),
    draw: (x: number, cy: number): Array<ExportItem> => {
      return [
        textItem(tag, text, x, cy + fontSize * 0.35, fontSize, color, {
          isBold: isBold,
        }),
      ];
    },
  };
}

function dotToken(tag: string, color: string, radius: number): FlowToken {
  return {
    width: radius * 2,
    draw: (x: number, cy: number): Array<ExportItem> => {
      return [
        {
          type: "circle",
          tag: tag,
          cx: x + radius,
          cy: cy,
          r: radius,
          fill: color,
        },
      ];
    },
  };
}

/**
 * The header block, its top-left corner at (left, top), `width` wide.
 */
export function layoutHeader(
  content: HeaderContent,
  left: number,
  top: number,
  width: number,
  measure: TextMeasure,
): ExportBlock {
  const items: Array<ExportItem> = [];
  let y: number = top;

  // The eyebrow says what kind of document this is before the title says whose.
  const eyebrowSize: number = 7.5;
  items.push(
    textItem(
      "header:eyebrow",
      EXPORT_EYEBROW,
      left,
      baselineFor(y, eyebrowSize),
      eyebrowSize,
      PDF_INK.accent,
      { isBold: true },
    ),
  );
  y += 13;

  const titleSize: number = 17;
  for (const line of wrapTextToLines(
    content.title,
    width,
    2,
    measure,
    titleSize,
    true,
  )) {
    items.push(
      textItem(
        "header:title",
        line,
        left,
        baselineFor(y, titleSize),
        titleSize,
        PDF_INK.heading,
        { isBold: true },
      ),
    );
    y += 21;
  }
  y += 2;

  const metaSize: number = 8.5;
  for (const line of wrapTextToLines(
    content.metaParts.join(" · "),
    width,
    2,
    measure,
    metaSize,
    false,
  )) {
    items.push(
      textItem(
        "header:meta",
        line,
        left,
        baselineFor(y, metaSize),
        metaSize,
        PDF_INK.muted,
      ),
    );
    y += 11.5;
  }
  y += 5;

  /*
   * The status line: how many devices, how each is doing, and how the
   * connections between them are doing — what somebody reading a network
   * diagram looks for before anything else.
   */
  const size: number = 8.5;
  const counts: SummaryCounts = content.counts;
  const units: Array<FlowUnit> = [
    {
      gapBefore: 0,
      tokens: [
        wordToken(
          "header:device-count",
          pluralize(counts.nodeTotal, "device", "devices"),
          size,
          PDF_INK.heading,
          true,
          measure,
        ),
      ],
    },
  ];
  for (const status of STATUS_ORDER) {
    units.push({
      gapBefore: 10,
      tokens: [
        dotToken(
          `header:status-dot:${status}`,
          resolvePrintColor(NODE_STATUS_COLORS[status]),
          2.6,
        ),
        wordToken(
          `header:status:${status}`,
          `${formatCount(counts.byStatus[status])} ${STATUS_WORDS[status]}`,
          size,
          PDF_INK.text,
          false,
          measure,
        ),
      ],
    });
  }
  const linkProblems: Array<string> = [];
  if (counts.byLinkState.down > 0) {
    linkProblems.push(`${formatCount(counts.byLinkState.down)} down`);
  }
  if (counts.byLinkState.saturated > 0) {
    linkProblems.push(`${formatCount(counts.byLinkState.saturated)} busy`);
  }
  units.push({
    gapBefore: 18,
    tokens: [
      wordToken(
        "header:connection-count",
        pluralize(counts.edgeTotal, "connection", "connections"),
        size,
        PDF_INK.heading,
        true,
        measure,
      ),
      ...(linkProblems.length > 0
        ? [
            wordToken(
              "header:link-problems",
              `(${linkProblems.join(", ")})`,
              size,
              counts.byLinkState.down > 0
                ? resolvePrintColor(LINK_STATE_COLORS.down)
                : PDF_INK.warning,
              false,
              measure,
            ),
          ]
        : []),
    ],
  });
  const summary: ExportBlock = flowUnits(units, left, y, width, 12, 4);
  items.push(...summary.items);
  y += summary.height;

  const noteSize: number = 8;
  const addNote: (tag: string, text: string, color: string) => void = (
    tag: string,
    text: string,
    color: string,
  ): void => {
    y += 2;
    for (const line of wrapTextToLines(
      text,
      width,
      3,
      measure,
      noteSize,
      false,
    )) {
      items.push(
        textItem(tag, line, left, baselineFor(y, noteSize), noteSize, color),
      );
      y += 10.5;
    }
  };

  if (content.filterText) {
    addNote("header:filters", content.filterText, PDF_INK.secondary);
  }
  for (const notice of content.notices) {
    addNote("header:notice", notice, PDF_INK.warning);
  }
  if (content.footnote) {
    addNote("header:footnote", content.footnote, PDF_INK.muted);
  }

  return { items: items, height: y - top };
}

/*
 * A legend swatch in a 14 × 8 box: the same marks the live legend draws
 * (NetworkDeviceGraph's renderLegendSwatch), sized for paper.
 */
export const LEGEND_SWATCH_WIDTH: number = 14;
const LEGEND_SHAPE_BASE_RADIUS: number = 3.6;

function legendSwatch(
  entry: TopologyLegendEntry,
  x: number,
  cy: number,
): Array<ExportItem> {
  const color: string = resolvePrintColor(entry.color);
  const cx: number = x + LEGEND_SWATCH_WIDTH / 2;
  const tag: string = `legend-swatch:${entry.group}:${entry.label}`;

  if (entry.swatch === "line" || entry.swatch === "dashed-line") {
    return [
      {
        type: "line",
        tag: tag,
        x1: x,
        y1: cy,
        x2: x + LEGEND_SWATCH_WIDTH,
        y2: cy,
        stroke: {
          color: color,
          width: 1.6,
          dash: entry.swatch === "dashed-line" ? [3, 2] : undefined,
        },
        roundCaps: false,
      },
    ];
  }
  if (entry.swatch === "square") {
    return [
      {
        type: "rect",
        tag: tag,
        x: cx - 4.5,
        y: cy - 3,
        width: 9,
        height: 6,
        radius: 1.5,
        fill: color,
      },
    ];
  }
  if (entry.swatch === "shape" && entry.shape) {
    return shapeItems(
      tag,
      geometryForShape(entry.shape, LEGEND_SHAPE_BASE_RADIUS),
      cx,
      cy,
      1,
      { fill: undefined, stroke: { color: color, width: 1 } },
    );
  }
  return [
    {
      type: "circle",
      tag: tag,
      cx: cx,
      cy: cy,
      r: 3,
      fill: entry.swatch === "hollow-dot" ? PRINT_PAPER_COLOR : color,
      stroke:
        entry.swatch === "hollow-dot"
          ? { color: color, width: 1, dash: [1.6, 1.2] }
          : undefined,
    },
  ];
}

/**
 * The legend, flowed into rows `width` wide. Each group's name ("STATUS",
 * "LINK"…) leads its entries and never ends a row alone.
 */
export function layoutLegend(
  entries: Array<TopologyLegendEntry>,
  left: number,
  top: number,
  width: number,
  measure: TextMeasure,
): ExportBlock {
  const labelSize: number = 7.5;
  const groupSize: number = 6.5;
  const units: Array<FlowUnit> = [];
  let previousGroup: string = "";

  for (const entry of entries) {
    const entryToken: FlowToken = {
      width: LEGEND_SWATCH_WIDTH + 4 + measure(entry.label, labelSize, false),
      draw: (x: number, cy: number): Array<ExportItem> => {
        return [
          ...legendSwatch(entry, x, cy),
          textItem(
            `legend-text:${entry.group}`,
            entry.label,
            x + LEGEND_SWATCH_WIDTH + 4,
            cy + labelSize * 0.35,
            labelSize,
            PDF_INK.secondary,
          ),
        ];
      },
    };
    if (entry.group !== previousGroup) {
      units.push({
        gapBefore: 16,
        tokens: [
          wordToken(
            `legend-group:${entry.group}`,
            entry.group.toUpperCase(),
            groupSize,
            PDF_INK.faint,
            true,
            measure,
          ),
          entryToken,
        ],
      });
      previousGroup = entry.group;
      continue;
    }
    units.push({ gapBefore: 10, tokens: [entryToken] });
  }

  return flowUnits(units, left, top, width, 13, 6);
}

// Where the footer's baseline sits, measured up from the page's bottom edge.
export const FOOTER_BASELINE_FROM_BOTTOM: number = 20;

/**
 * The line at the foot of every page: what this is, and which page of how
 * many. `factor` enlarges it along with an enlarged map page.
 */
export function footerItems(
  scopeLabel: string,
  pageNumber: number,
  pageCount: number,
  pageWidth: number,
  pageHeight: number,
  factor: number,
): Array<ExportItem> {
  const size: number = 7 * factor;
  const baseline: number = pageHeight - FOOTER_BASELINE_FROM_BOTTOM * factor;
  return [
    textItem(
      "footer:scope",
      `Network topology · ${scopeLabel}`,
      PAGE_MARGIN * factor,
      baseline,
      size,
      PDF_INK.faint,
    ),
    textItem(
      "footer:page",
      `Page ${pageNumber} of ${pageCount}`,
      pageWidth - PAGE_MARGIN * factor,
      baseline,
      size,
      PDF_INK.faint,
      { align: "right" },
    ),
  ];
}
