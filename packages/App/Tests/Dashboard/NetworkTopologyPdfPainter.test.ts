import { describe, expect, test } from "@jest/globals";
import {
  CanvasState,
  DEFAULT_ITEMS_PER_SLICE,
  PDF_FONT_NAME,
  TopologyPdfCanvas,
  createCanvasState,
  paintExportItem,
  paintNetworkTopologyDocument,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfPainter";
import {
  ExportItem,
  ExportPage,
  textItem,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportItems";
import { NetworkTopologyExportDocument } from "../../FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyExportDocument";

/*
 * Issue #4616: the painter turns a laid-out page into PDF drawing calls. It
 * draws through a canvas interface — the handful of jsPDF methods it uses —
 * so it is tested here against a recorder, with no PDF library in sight.
 * The real library is exercised end to end by the offline Topology suite
 * (packages/E2E/Topology), which opens the downloaded file.
 */

type Call = [string, ...Array<unknown>];

class RecordingCanvas implements TopologyPdfCanvas {
  public calls: Array<Call> = [];

  private record(name: string, args: Array<unknown>): void {
    this.calls.push([name, ...args]);
  }

  public addPage = (...args: Array<unknown>): void => {
    this.record("addPage", args);
  };
  public setProperties = (...args: Array<unknown>): void => {
    this.record("setProperties", args);
  };
  public setFillColor = (...args: Array<unknown>): void => {
    this.record("setFillColor", args);
  };
  public setDrawColor = (...args: Array<unknown>): void => {
    this.record("setDrawColor", args);
  };
  public setTextColor = (...args: Array<unknown>): void => {
    this.record("setTextColor", args);
  };
  public setLineWidth = (...args: Array<unknown>): void => {
    this.record("setLineWidth", args);
  };
  public setLineDashPattern = (...args: Array<unknown>): void => {
    this.record("setLineDashPattern", args);
  };
  public setLineCap = (...args: Array<unknown>): void => {
    this.record("setLineCap", args);
  };
  public setLineJoin = (...args: Array<unknown>): void => {
    this.record("setLineJoin", args);
  };
  public setFont = (...args: Array<unknown>): void => {
    this.record("setFont", args);
  };
  public setFontSize = (...args: Array<unknown>): void => {
    this.record("setFontSize", args);
  };
  public text = (...args: Array<unknown>): void => {
    this.record("text", args);
  };
  public rect = (...args: Array<unknown>): void => {
    this.record("rect", args);
  };
  public roundedRect = (...args: Array<unknown>): void => {
    this.record("roundedRect", args);
  };
  public circle = (...args: Array<unknown>): void => {
    this.record("circle", args);
  };
  public line = (...args: Array<unknown>): void => {
    this.record("line", args);
  };
  public moveTo = (...args: Array<unknown>): void => {
    this.record("moveTo", args);
  };
  public lineTo = (...args: Array<unknown>): void => {
    this.record("lineTo", args);
  };
  public curveTo = (...args: Array<unknown>): void => {
    this.record("curveTo", args);
  };
  public close = (): void => {
    this.record("close", []);
  };
  public fill = (): void => {
    this.record("fill", []);
  };
  public stroke = (): void => {
    this.record("stroke", []);
  };
  public fillStroke = (): void => {
    this.record("fillStroke", []);
  };

  public named(name: string): Array<Call> {
    return this.calls.filter((call: Call): boolean => {
      return call[0] === name;
    });
  }

  public names(): Array<string> {
    return this.calls.map((call: Call): string => {
      return call[0];
    });
  }
}

function paint(itemsToPaint: Array<ExportItem>): RecordingCanvas {
  const canvas: RecordingCanvas = new RecordingCanvas();
  const state: CanvasState = createCanvasState(canvas);
  for (const item of itemsToPaint) {
    paintExportItem(canvas, state, item);
  }
  return canvas;
}

function documentOf(pages: Array<ExportPage>): NetworkTopologyExportDocument {
  return {
    title: "Network topology - Store 1042",
    subject: "Network topology of Store 1042, exported now",
    fileLabel: "network-topology-Store 1042",
    pages: pages,
    summary: {
      drawnNodeCount: 0,
      drawnEdgeCount: 0,
      diagramScale: 1,
      chromeScale: 1,
      isEnlargedPage: false,
      deviceRowCount: 0,
      connectionRowCount: 0,
      isLossy: false,
    },
  };
}

const RECT: ExportItem = {
  type: "rect",
  tag: "r",
  x: 1,
  y: 2,
  width: 30,
  height: 20,
  radius: 0,
  fill: "#16a34a",
};

describe("paintExportItem: one item, one drawing", () => {
  test("a filled box is a filled rect", () => {
    const canvas: RecordingCanvas = paint([RECT]);
    expect(canvas.named("setFillColor")).toEqual([["setFillColor", "#16a34a"]]);
    expect(canvas.named("rect")).toEqual([["rect", 1, 2, 30, 20, "F"]]);
  });

  test("a rounded, outlined box is a rounded rect filled and stroked", () => {
    const canvas: RecordingCanvas = paint([
      {
        ...RECT,
        radius: 4,
        stroke: { color: "#dc2626", width: 2, dash: [4, 3] },
      },
    ]);
    expect(canvas.named("roundedRect")).toEqual([
      ["roundedRect", 1, 2, 30, 20, 4, 4, "FD"],
    ]);
    expect(canvas.named("setDrawColor")).toEqual([["setDrawColor", "#dc2626"]]);
    expect(canvas.named("setLineWidth")).toEqual([["setLineWidth", 2]]);
    expect(canvas.named("setLineDashPattern")).toEqual([
      ["setLineDashPattern", [4, 3], 0],
    ]);
  });

  test("an outline-only shape is stroked, not filled", () => {
    const canvas: RecordingCanvas = paint([
      {
        type: "circle",
        tag: "c",
        cx: 5,
        cy: 6,
        r: 3,
        stroke: { color: "#64748b", width: 1 },
      },
    ]);
    expect(canvas.named("circle")).toEqual([["circle", 5, 6, 3, "S"]]);
    expect(canvas.named("setFillColor")).toEqual([]);
  });

  test("a shape with neither fill nor outline draws nothing", () => {
    const canvas: RecordingCanvas = paint([
      { ...RECT, fill: undefined },
      { type: "circle", tag: "c", cx: 1, cy: 1, r: 1 },
      {
        type: "path",
        tag: "p",
        commands: [{ op: "m", points: [0, 0] }],
        closed: true,
      },
    ]);
    expect(canvas.calls).toEqual([]);
  });

  test("a path is moved, lined and curved through, closed, then filled and stroked", () => {
    const canvas: RecordingCanvas = paint([
      {
        type: "path",
        tag: "p",
        commands: [
          { op: "m", points: [0, 0] },
          { op: "l", points: [10, 0] },
          { op: "c", points: [12, 0, 14, 2, 14, 4] },
        ],
        closed: true,
        fill: "#a78bfa",
        stroke: { color: "#7c3aed", width: 1.5 },
      },
    ]);
    const drawing: Array<string> = canvas
      .names()
      .filter((name: string): boolean => {
        return ["moveTo", "lineTo", "curveTo", "close", "fillStroke"].includes(
          name,
        );
      });
    expect(drawing).toEqual([
      "moveTo",
      "lineTo",
      "curveTo",
      "close",
      "fillStroke",
    ]);
    expect(canvas.named("curveTo")).toEqual([["curveTo", 12, 0, 14, 2, 14, 4]]);
  });

  test("an open path (a drum's rim) is stroked without closing it", () => {
    const canvas: RecordingCanvas = paint([
      {
        type: "path",
        tag: "rim",
        commands: [
          { op: "m", points: [0, 0] },
          { op: "c", points: [1, 1, 2, 2, 3, 3] },
        ],
        closed: false,
        stroke: { color: "#16a34a", width: 2 },
      },
    ]);
    expect(canvas.named("close")).toEqual([]);
    expect(canvas.named("stroke")).toHaveLength(1);
    expect(canvas.named("fill")).toEqual([]);
  });

  test("a line sets its cap and dash, and a solid line clears the dash", () => {
    const canvas: RecordingCanvas = paint([
      {
        type: "line",
        tag: "l1",
        x1: 0,
        y1: 0,
        x2: 10,
        y2: 10,
        stroke: { color: "#dc2626", width: 2, dash: [6, 4] },
        roundCaps: true,
      },
      {
        type: "line",
        tag: "l2",
        x1: 0,
        y1: 0,
        x2: 10,
        y2: 0,
        stroke: { color: "#dc2626", width: 2 },
        roundCaps: false,
      },
    ]);
    expect(canvas.named("setLineDashPattern")).toEqual([
      ["setLineDashPattern", [6, 4], 0],
      ["setLineDashPattern", [], 0],
    ]);
    expect(canvas.named("setLineCap")).toEqual([
      ["setLineCap", "round"],
      ["setLineCap", "butt"],
    ]);
    expect(canvas.named("line")).toEqual([
      ["line", 0, 0, 10, 10],
      ["line", 0, 0, 10, 0],
    ]);
  });

  test("text is set in Helvetica at its size and weight, on its baseline", () => {
    const canvas: RecordingCanvas = paint([
      textItem("t", "Core switch", 50, 60, 5.4, "#374151", {
        isBold: true,
        align: "center",
      }),
    ]);
    expect(PDF_FONT_NAME).toBe("helvetica");
    expect(canvas.named("setFont")).toEqual([["setFont", "helvetica", "bold"]]);
    expect(canvas.named("setFontSize")).toEqual([["setFontSize", 5.4]]);
    expect(canvas.named("setTextColor")).toEqual([["setTextColor", "#374151"]]);
    expect(canvas.named("text")).toEqual([
      [
        "text",
        "Core switch",
        50,
        60,
        { align: "center", baseline: "alphabetic" },
      ],
    ]);
  });

  test("a haloed name draws its paper outline first, then the glyphs over it", () => {
    const canvas: RecordingCanvas = paint([
      {
        ...textItem("t", "Core switch", 50, 60, 6, "#374151", {
          align: "center",
        }),
        halo: { color: "#ffffff", width: 1.35 },
      },
    ]);
    const texts: Array<Call> = canvas.named("text");
    expect(texts).toEqual([
      [
        "text",
        "Core switch",
        50,
        60,
        { align: "center", baseline: "alphabetic", renderingMode: "stroke" },
      ],
      [
        "text",
        "Core switch",
        50,
        60,
        { align: "center", baseline: "alphabetic" },
      ],
    ]);
    const order: Array<string> = canvas.names();
    expect(order.indexOf("setDrawColor")).toBeLessThan(order.indexOf("text"));
    expect(canvas.named("setDrawColor")).toEqual([["setDrawColor", "#ffffff"]]);
    expect(canvas.named("setLineWidth")).toEqual([["setLineWidth", 1.35]]);
    expect(canvas.named("setLineJoin")).toEqual([["setLineJoin", "round"]]);
  });

  test("empty text is not drawn", () => {
    expect(paint([textItem("t", "", 0, 0, 8, "#000000")]).calls).toEqual([]);
  });
});

describe("the painter writes each state once, and re-sets what text overwrites", () => {
  test("a run of shapes in one colour sets the colour once", () => {
    const canvas: RecordingCanvas = paint([RECT, { ...RECT, x: 40 }, RECT]);
    expect(canvas.named("setFillColor")).toHaveLength(1);
    expect(canvas.named("rect")).toHaveLength(3);
  });

  test("a shape after a label sets its fill again, because PDF text fills with the fill colour", () => {
    /*
     * The bug this pins: jsPDF writes a text's colour as the FILL colour, and
     * it stays set after the text. Without re-setting it, every node drawn
     * after a name was filled with the name's dark grey.
     */
    const canvas: RecordingCanvas = paint([
      RECT,
      textItem("t", "label", 0, 0, 8, "#374151"),
      RECT,
    ]);
    expect(canvas.named("setFillColor")).toEqual([
      ["setFillColor", "#16a34a"],
      ["setFillColor", "#16a34a"],
    ]);
  });

  test("a font is set again only when its weight or size changes", () => {
    const canvas: RecordingCanvas = paint([
      textItem("a", "one", 0, 0, 8, "#000000"),
      textItem("b", "two", 0, 0, 8, "#000000"),
      textItem("c", "three", 0, 0, 9, "#000000"),
      textItem("d", "four", 0, 0, 9, "#000000", { isBold: true }),
    ]);
    expect(canvas.named("setFontSize")).toEqual([
      ["setFontSize", 8],
      ["setFontSize", 9],
      ["setFontSize", 9],
    ]);
    expect(canvas.named("setTextColor")).toHaveLength(1);
  });
});

describe("paintNetworkTopologyDocument: the pages, in order", () => {
  const PAGES: Array<ExportPage> = [
    { kind: "diagram", width: 1683.78, height: 1190.56, items: [RECT] },
    {
      kind: "table",
      width: 841.89,
      height: 595.28,
      items: [textItem("t", "Devices (3)", 36, 50, 12, "#111827")],
    },
    {
      kind: "table",
      width: 595.28,
      height: 841.89,
      items: [RECT],
    },
  ];

  test("the PDF is titled, and every page after the first is added at its own size", async () => {
    const canvas: RecordingCanvas = new RecordingCanvas();
    await paintNetworkTopologyDocument(canvas, documentOf(PAGES), {
      yieldToBrowser: async (): Promise<void> => {},
    });
    expect(canvas.named("setProperties")).toEqual([
      [
        "setProperties",
        {
          title: "Network topology - Store 1042",
          subject: "Network topology of Store 1042, exported now",
          keywords: "network topology",
        },
      ],
    ]);
    // The first page is the one the PDF was created with.
    expect(canvas.named("addPage")).toEqual([
      ["addPage", [841.89, 595.28], "l"],
      ["addPage", [595.28, 841.89], "p"],
    ]);
  });

  test("each page starts from a clean state: colours are set again after a page break", async () => {
    const canvas: RecordingCanvas = new RecordingCanvas();
    await paintNetworkTopologyDocument(canvas, documentOf(PAGES), {
      yieldToBrowser: async (): Promise<void> => {},
    });
    // Same fill on page 1 and page 3, so it is set once on each.
    expect(canvas.named("setFillColor")).toEqual([
      ["setFillColor", "#16a34a"],
      ["setFillColor", "#16a34a"],
    ]);
    const order: Array<string> = canvas.names();
    expect(order.indexOf("addPage")).toBeLessThan(order.indexOf("text"));
  });

  test("a large map hands the browser back control while it draws", async () => {
    const manyItems: Array<ExportItem> = [];
    for (let index: number = 0; index < 25; index++) {
      manyItems.push({ ...RECT, x: index });
    }
    const pauses: Array<number> = [];
    const canvas: RecordingCanvas = new RecordingCanvas();
    await paintNetworkTopologyDocument(
      canvas,
      documentOf([
        { kind: "diagram", width: 100, height: 100, items: manyItems },
        { kind: "table", width: 100, height: 100, items: [RECT] },
      ]),
      {
        itemsPerSlice: 10,
        yieldToBrowser: async (): Promise<void> => {
          pauses.push(canvas.named("rect").length);
        },
      },
    );
    // After every ten items, and at the page break.
    expect(pauses).toEqual([10, 20, 25]);
    expect(canvas.named("rect")).toHaveLength(26);
  });

  test("by default it pauses every few thousand items, on a timer", async () => {
    expect(DEFAULT_ITEMS_PER_SLICE).toBeGreaterThanOrEqual(1000);
    expect(DEFAULT_ITEMS_PER_SLICE).toBeLessThanOrEqual(5000);
    const canvas: RecordingCanvas = new RecordingCanvas();
    await paintNetworkTopologyDocument(
      canvas,
      documentOf([{ kind: "diagram", width: 10, height: 10, items: [RECT] }]),
    );
    expect(canvas.named("rect")).toHaveLength(1);
  });
});
