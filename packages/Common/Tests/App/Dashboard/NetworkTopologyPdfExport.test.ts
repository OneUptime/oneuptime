import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OneUptimeDate from "../../../Types/Date";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  NetworkTopologyPdf,
  PdfLibrary,
  buildNetworkTopologyPdf,
  createPdfTextMeasure,
  exportNetworkTopologyAsPdf,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyPdfExport";
import { NetworkTopologyExportInput } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyExportDocument";
import { ALL_NODE_KINDS } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import { TextMeasure } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/Export/ExportText";

/*
 * Issue #4616: the Export PDF button's entry point. jsPDF is a dashboard
 * dependency Common does not install, and the entry point takes the library
 * as an argument for exactly that reason: here it is handed a stand-in that
 * records what it is asked to do. The real library is driven end to end by
 * the offline Topology suite (packages/E2E/Topology), which opens the file.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const mockDownloadFile: MockedFn = jest.fn();

jest.mock("../../../UI/Utils/DownloadFile", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/DownloadFile",
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    ...actual,
    default: (...args: Array<unknown>): unknown => {
      return mockDownloadFile(...args);
    },
  };
});

interface FakeFont {
  fontStyle: string;
}

type Call = [string, ...Array<unknown>];

// A stand-in for jsPDF: records every call, measures every character alike.
class FakeJsPdf {
  public static instances: Array<FakeJsPdf> = [];

  public readonly options: Record<string, unknown>;
  public readonly calls: Array<Call> = [];
  private fontStyle: string = "normal";

  public constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeJsPdf.instances.push(this);
  }

  private record(name: string, args: Array<unknown>): void {
    this.calls.push([name, ...args]);
  }

  public setFont(name: string, style: string): void {
    this.fontStyle = style;
    this.record("setFont", [name, style]);
  }

  public getFont(): FakeFont {
    return { fontStyle: this.fontStyle };
  }

  public getStringUnitWidth(
    text: string,
    options: { font: FakeFont; fontSize: number },
  ): number {
    this.record("getStringUnitWidth", [text, options]);
    return text.length * (options.font.fontStyle === "bold" ? 0.6 : 0.5);
  }

  public output(type: string): Blob {
    this.record("output", [type]);
    return new Blob(["%PDF-1.3 fake"], { type: "application/pdf" });
  }

  public names(): Array<string> {
    return this.calls.map((call: Call): string => {
      return call[0];
    });
  }
}

const DRAWING_METHODS: Array<string> = [
  "addPage",
  "setProperties",
  "setFillColor",
  "setDrawColor",
  "setTextColor",
  "setLineWidth",
  "setLineDashPattern",
  "setLineCap",
  "setLineJoin",
  "setFontSize",
  "text",
  "rect",
  "roundedRect",
  "circle",
  "line",
  "moveTo",
  "lineTo",
  "curveTo",
  "close",
  "fill",
  "stroke",
  "fillStroke",
  "setGState",
];
for (const method of DRAWING_METHODS) {
  (FakeJsPdf.prototype as unknown as Record<string, unknown>)[method] =
    function (this: FakeJsPdf, ...args: Array<unknown>): void {
      (this as unknown as { calls: Array<Call> }).calls.push([method, ...args]);
    };
}
// jsPDF's graphics-state constructor, reached through the document.
(FakeJsPdf.prototype as unknown as Record<string, unknown>)["GState"] = class {
  public readonly parameters: Record<string, number>;
  public constructor(parameters: Record<string, number>) {
    this.parameters = parameters;
  }
};

const library: PdfLibrary = {
  jsPDF: FakeJsPdf as unknown as PdfLibrary["jsPDF"],
};

const loadPdfLibrary: () => Promise<PdfLibrary> =
  async (): Promise<PdfLibrary> => {
    return library;
  };

const noPause: () => Promise<void> = async (): Promise<void> => {};

const NODES: Array<NetworkTopologyNode> = [
  {
    id: "r1",
    name: "Store edge router",
    kind: "device",
    isManaged: true,
    status: "up",
    role: "router",
  },
  {
    id: "s1",
    name: "Core switch",
    kind: "device",
    isManaged: true,
    status: "down",
    role: "switch",
  },
];

const EDGES: Array<NetworkTopologyEdge> = [
  { fromNodeId: "r1", toNodeId: "s1", protocols: ["lldp"] },
];

function request(): Omit<NetworkTopologyExportInput, "exportedAtText"> {
  return {
    topology: { nodes: NODES, edges: EDGES },
    layoutMode: "force",
    positionOverrides: new Map(),
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    projectName: "Acme Retail",
    scopeNames: ["Europe", "London office"],
  };
}

describe("buildNetworkTopologyPdf: the PDF of one map", () => {
  beforeEach(() => {
    FakeJsPdf.instances = [];
  });

  test("measures with one document, then draws on a second sized to the map page", async () => {
    const pdf: NetworkTopologyPdf = await buildNetworkTopologyPdf(
      { ...request(), exportedAtText: "Oct 10 2026, 14:32 UTC" },
      { loadPdfLibrary: loadPdfLibrary, yieldToBrowser: noPause },
    );
    expect(FakeJsPdf.instances).toHaveLength(2);
    const [measuring, document] = FakeJsPdf.instances as [FakeJsPdf, FakeJsPdf];
    expect(measuring.options).toEqual({
      unit: "pt",
      format: "a4",
      orientation: "landscape",
    });
    const firstPage: { width: number; height: number } = pdf.document.pages[0]!;
    expect(document.options).toEqual({
      unit: "pt",
      format: [firstPage.width, firstPage.height],
      orientation:
        firstPage.width > firstPage.height ? "landscape" : "portrait",
      compress: true,
      putOnlyUsedFonts: true,
    });
    // Nothing is drawn on the measuring document.
    expect(measuring.names()).not.toContain("text");
    expect(document.names()).toContain("text");
  });

  test("the PDF carries the map's title and every page after the first", async () => {
    const pdf: NetworkTopologyPdf = await buildNetworkTopologyPdf(
      { ...request(), exportedAtText: "Oct 10 2026, 14:32 UTC" },
      { loadPdfLibrary: loadPdfLibrary, yieldToBrowser: noPause },
    );
    const document: FakeJsPdf = FakeJsPdf.instances[1]!;
    const properties: Array<Call> = document.calls.filter((call: Call) => {
      return call[0] === "setProperties";
    });
    expect(properties).toEqual([
      [
        "setProperties",
        {
          title: "Network topology - London office",
          subject:
            "Network topology of Europe > London office, exported Oct 10 2026, 14:32 UTC",
          keywords: "network topology",
        },
      ],
    ]);
    const added: Array<Call> = document.calls.filter((call: Call) => {
      return call[0] === "addPage";
    });
    expect(added).toHaveLength(pdf.document.pages.length - 1);
  });

  test("hands back the file jsPDF wrote and the layout it was drawn from", async () => {
    const pdf: NetworkTopologyPdf = await buildNetworkTopologyPdf(
      { ...request(), exportedAtText: "now" },
      { loadPdfLibrary: loadPdfLibrary, yieldToBrowser: noPause },
    );
    expect(pdf.blob.type).toBe("application/pdf");
    expect(FakeJsPdf.instances[1]!.names()).toContain("output");
    expect(pdf.document.summary.drawnNodeCount).toBe(2);
    expect(pdf.document.summary.drawnEdgeCount).toBe(1);
  });

  test("hulls and faded devices are drawn see-through, through jsPDF's graphics state", async () => {
    await buildNetworkTopologyPdf(
      { ...request(), searchText: "switch", exportedAtText: "now" },
      { loadPdfLibrary: loadPdfLibrary, yieldToBrowser: noPause },
    );
    const states: Array<Call> = FakeJsPdf.instances[1]!.calls.filter(
      (call: Call) => {
        return call[0] === "setGState";
      },
    );
    expect(states.length).toBeGreaterThan(0);
    const faded: Array<Record<string, number>> = states.map((call: Call) => {
      return (call[1] as { parameters: Record<string, number> }).parameters;
    });
    // The router does not match the search: it is drawn at 20%, as on screen.
    expect(faded).toContainEqual({ opacity: 0.2, "stroke-opacity": 0.2 });
  });

  test("the browser gets a turn while the PDF is laid out and while it is drawn", async () => {
    let pauses: number = 0;
    await buildNetworkTopologyPdf(
      { ...request(), exportedAtText: "now" },
      {
        loadPdfLibrary: loadPdfLibrary,
        yieldToBrowser: async (): Promise<void> => {
          pauses++;
        },
      },
    );
    // The layout's steps, a page break, and the pause before the file is written.
    expect(pauses).toBeGreaterThanOrEqual(5);
  });

  test("a library that fails to load fails the export, so the button can say so", async () => {
    await expect(
      buildNetworkTopologyPdf(
        { ...request(), exportedAtText: "now" },
        {
          loadPdfLibrary: async (): Promise<PdfLibrary> => {
            throw new Error("Failed to fetch dynamically imported module");
          },
        },
      ),
    ).rejects.toThrow("Failed to fetch dynamically imported module");
  });
});

describe("createPdfTextMeasure: jsPDF's own Helvetica metrics", () => {
  test("measures regular and bold text with the font objects, at the size asked", () => {
    const doc: FakeJsPdf = new FakeJsPdf({});
    const measure: TextMeasure = createPdfTextMeasure(
      doc as unknown as Parameters<typeof createPdfTextMeasure>[0],
    );
    expect(measure("abcd", 10, false)).toBe(4 * 0.5 * 10);
    expect(measure("abcd", 10, true)).toBe(4 * 0.6 * 10);
    expect(measure("", 10, true)).toBe(0);
  });

  test("measuring never changes the document's font", () => {
    const doc: FakeJsPdf = new FakeJsPdf({});
    const measure: TextMeasure = createPdfTextMeasure(
      doc as unknown as Parameters<typeof createPdfTextMeasure>[0],
    );
    const fontChanges: number = doc.names().filter((name: string) => {
      return name === "setFont";
    }).length;
    measure("one", 8, true);
    measure("two", 8, false);
    expect(
      doc.names().filter((name: string) => {
        return name === "setFont";
      }).length,
    ).toBe(fontChanges);
    // Every width is asked of the unit font size and scaled here.
    const widths: Array<Call> = doc.calls.filter((call: Call) => {
      return call[0] === "getStringUnitWidth";
    });
    for (const call of widths) {
      expect((call[2] as { fontSize: number }).fontSize).toBe(1);
    }
  });
});

describe("exportNetworkTopologyAsPdf: the download", () => {
  let nowSpy: SpyInstance<typeof OneUptimeDate.getCurrentDate>;
  let formatSpy: SpyInstance<
    typeof OneUptimeDate.getDateAsUserFriendlyLocalFormattedString
  >;

  beforeEach(() => {
    FakeJsPdf.instances = [];
    mockDownloadFile.mockReset();
    nowSpy = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-10T12:32:05.000Z"));
    formatSpy = jest
      .spyOn(OneUptimeDate, "getDateAsUserFriendlyLocalFormattedString")
      .mockReturnValue("Oct 10 2026, 14:32 CEST");
  });

  afterEach(() => {
    nowSpy.mockRestore();
    formatSpy.mockRestore();
  });

  test("downloads one PDF named after the site and stamped with the export time", async () => {
    const filename: string = await exportNetworkTopologyAsPdf(request(), {
      loadPdfLibrary: loadPdfLibrary,
      yieldToBrowser: noPause,
    });
    expect(filename).toBe(
      "network-topology-london-office-2026-10-10T12-32-05.pdf",
    );
    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    const download: { content: Blob; filename: string } = mockDownloadFile.mock
      .calls[0]![0] as { content: Blob; filename: string };
    expect(download.filename).toBe(filename);
    expect(download.content).toBeInstanceOf(Blob);
    expect(download.content.type).toBe("application/pdf");
  });

  test("the export time printed in the PDF is the reader's own", async () => {
    await exportNetworkTopologyAsPdf(request(), {
      loadPdfLibrary: loadPdfLibrary,
      yieldToBrowser: noPause,
    });
    expect(formatSpy).toHaveBeenCalledWith(
      new Date("2026-10-10T12:32:05.000Z"),
    );
    const texts: Array<unknown> = FakeJsPdf.instances[1]!.calls.filter(
      (call: Call) => {
        return call[0] === "text";
      },
    ).map((call: Call) => {
      return call[1];
    });
    expect(texts.join(" ")).toContain("Exported Oct 10 2026, 14:32 CEST");
  });

  test("the map of every device is named after the project", async () => {
    const filename: string = await exportNetworkTopologyAsPdf(
      { ...request(), scopeNames: [] },
      { loadPdfLibrary: loadPdfLibrary, yieldToBrowser: noPause },
    );
    expect(filename).toBe(
      "network-topology-acme-retail-2026-10-10T12-32-05.pdf",
    );
  });

  test("nothing is downloaded when the PDF cannot be built", async () => {
    await expect(
      exportNetworkTopologyAsPdf(request(), {
        loadPdfLibrary: async (): Promise<PdfLibrary> => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});
