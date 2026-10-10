import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4616: "Export PDF" on the network topology map. The export itself
 * is unit-tested (NetworkTopologyExportDocument, NetworkTopologyPdfPainter);
 * these tests pin the wiring around it, which no type can express and the
 * App suite cannot render (App/jest.config.json runs in plain Node):
 *
 *   - one Export PDF action, on the view every device map is drawn by;
 *   - every page that shows the device map draws it with that view;
 *   - the export is handed what the reader is looking at: the drawn layout,
 *     the dragged positions, every filter, the site;
 *   - the canvas and the PDF read the layout and the hulls from one module;
 *   - the PDF library stays out of the dashboard bundle and out of the
 *     modules App's own type check compiles.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function read(...parts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8"),
  );
}

function flatten(source: string): string {
  return source.replace(/\s+/g, " ");
}

const LIVE_VIEW: string = flatten(
  read("Components", "Topology", "NetworkTopologyLiveView.tsx"),
);
const GRAPH: string = flatten(
  read("Components", "Topology", "NetworkDeviceGraph.tsx"),
);
const EXPLORER: string = flatten(
  read("Components", "Topology", "NetworkTopologyExplorer.tsx"),
);
const NETWORK_MAP: string = flatten(
  read("Pages", "NetworkSite", "NetworkMap.tsx"),
);
const TOPOLOGY_PAGE: string = flatten(
  read("Pages", "Topology", "TopologyPage.tsx"),
);
const DEVICE_TOPOLOGY_PAGE: string = flatten(
  read("Pages", "NetworkDevice", "Topology.tsx"),
);

const EXPORT_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Topology",
  "Export",
);

function exportModules(): Array<string> {
  return fs
    .readdirSync(EXPORT_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".ts") || file.endsWith(".tsx");
    })
    .sort();
}

// The block of the live view's exportPdf handler.
function exportHandler(): string {
  const start: number = LIVE_VIEW.indexOf("const exportPdf");
  expect(start).toBeGreaterThan(-1);
  const end: number = LIVE_VIEW.indexOf(".catch(", start);
  expect(end).toBeGreaterThan(start);
  return LIVE_VIEW.slice(start, end);
}

describe("one Export PDF action, on the live map", () => {
  test("the live view's card offers Export PDF beside Refresh", () => {
    const buttons: number = LIVE_VIEW.indexOf("buttons={[");
    expect(buttons).toBeGreaterThan(-1);
    const exportButton: number = LIVE_VIEW.indexOf(
      'title: "Export PDF"',
      buttons,
    );
    const refreshButton: number = LIVE_VIEW.indexOf(
      'title: "Refresh"',
      buttons,
    );
    expect(exportButton).toBeGreaterThan(buttons);
    expect(refreshButton).toBeGreaterThan(exportButton);
    const button: string = LIVE_VIEW.slice(exportButton, refreshButton);
    expect(button).toContain("icon: IconProp.Download");
    expect(button).toContain("onClick: exportPdf");
    expect(button).toContain("isLoading: isExporting");
    // Never advertised over a map with nothing on it, nor twice at once.
    expect(button).toContain("disabled: !hasNodesToExport || isExporting");
    expect(button).toContain('"There is nothing on the map to export."');
  });

  test("it is the only export action on the map", () => {
    expect(LIVE_VIEW.match(/title: "Export PDF"/g) || []).toHaveLength(1);
    expect(GRAPH).not.toContain("Export PDF");
  });

  test("there is nothing to export when the filters leave nothing drawn", () => {
    expect(LIVE_VIEW).toContain(
      'const hasNodesToExport: boolean = healthSummary.total > 0 && (healthFilterMode === "all" || healthFilterMatchCount > 0);',
    );
  });

  test("a failed export is said in the card, and a second click waits for the first", () => {
    const handler: string = exportHandler();
    expect(handler).toContain("if (isExporting) { return; }");
    expect(LIVE_VIEW).toContain('"We couldn\'t create the PDF. Try again."');
    expect(LIVE_VIEW).toContain('data-testid="network-topology-export-error"');
    expect(LIVE_VIEW).toContain('role="alert"');
  });
});

describe("the export is handed what the reader is looking at", () => {
  const handler: string = (() => {
    try {
      return exportHandler();
    } catch {
      return "";
    }
  })();

  const expectedArguments: Array<string> = [
    // After the endpoint VLAN filter, which changes the layout's input.
    "topology: visibleTopology",
    // The layout the graph drew, not a recomputation.
    "layoutModel: layoutModelRef.current || undefined",
    "layoutMode: layoutMode",
    "positionOverrides: positionOverrides",
    "searchText: searchText",
    "visibleKinds: effectiveVisibleKinds",
    "availableKinds: availableKinds",
    "healthFilterMode: healthFilterMode",
    "vlanId: selectedVlan === ALL_VLANS ? null : Number(selectedVlan)",
    "projectName: ProjectUtil.getCurrentProject()?.name || undefined",
    "scopeNames: props.scopeNames || []",
    "isTruncated: topology.isTruncated",
    "endpointsTruncated: topology.endpointsTruncated",
    "droppedEndpointCount: topology.droppedEndpointCount",
    "suppressedNodeCount: topology.suppressedNodeCount",
  ];

  for (const argument of expectedArguments) {
    test(`exportNetworkTopologyAsPdf is given ${argument.split(":")[0]}`, () => {
      expect(handler).toContain("exportNetworkTopologyAsPdf({");
      expect(handler).toContain(argument);
    });
  }

  test("the graph reports the layout it draws, and the live view keeps it for the export", () => {
    expect(LIVE_VIEW).toContain(
      "onLayoutModelChange={(model: TopologyLayoutModel) => { layoutModelRef.current = model; }}",
    );
    expect(GRAPH).toContain(
      "useEffect(() => { onLayoutModelChangeRef.current?.(baseModel); }, [baseModel]);",
    );
  });

  test("the graph is drawn from the same VLAN-filtered topology the export is given", () => {
    expect(LIVE_VIEW).toContain("<NetworkDeviceGraph topology={visibleTopology}");
  });
});

describe("every view of the device map draws it with the live view", () => {
  test("the explorer (Device Topology, the Topology page's Network tab) renders it, named after the site", () => {
    expect(EXPLORER).toContain("<NetworkTopologyLiveView");
    expect(EXPLORER).toContain(
      "scopeNames={ currentSiteId ? breadcrumb.map((entry: SiteBreadcrumbEntry): string => { return entry.name; }) : [] }",
    );
  });

  test("the Network Map's site view renders it, named after the site", () => {
    expect(NETWORK_MAP).toContain("<NetworkTopologyLiveView siteId={currentSiteId}");
    expect(NETWORK_MAP).toContain(
      "scopeNames={(childrenData?.breadcrumb || []).map( (entry: SiteBreadcrumbEntry): string => { return entry.name; }, )}",
    );
  });

  test("the Network Map with no sites shows the explorer, and so the same map", () => {
    expect(NETWORK_MAP).toContain("return <NetworkTopologyExplorer />;");
  });

  test("Device Topology and the Topology page's Network tab show the explorer", () => {
    expect(DEVICE_TOPOLOGY_PAGE).toContain("<NetworkTopologyExplorer />");
    expect(TOPOLOGY_PAGE).toContain("return <NetworkTopologyExplorer />;");
  });

  test("no other component draws the device graph without the export", () => {
    const users: Array<string> = [];
    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx")) {
          continue;
        }
        if (stripComments(fs.readFileSync(full, "utf8")).includes("<NetworkDeviceGraph")) {
          users.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };
    walk(DASHBOARD_SRC);
    expect(users).toEqual([
      path.join("Components", "Topology", "NetworkTopologyLiveView.tsx"),
    ]);
  });
});

describe("the canvas and the PDF draw from one module", () => {
  test("the graph's layout and hulls come from NetworkTopologyDrawing", () => {
    expect(GRAPH).toContain('from "./NetworkTopologyDrawing"');
    expect(GRAPH).toContain(
      "return computeTopologyLayoutModel(layoutMode, nodes, edges);",
    );
    expect(GRAPH).toContain("return buildTopologyHulls(baseModel, viewModel.nodes);");
  });

  test("the graph keeps no layout dispatch of its own", () => {
    for (const layout of [
      "computeForceTopologyModel",
      "computeTieredTopologyLayoutModel",
      "computeRadialTopologyModel",
      "computeStarTopologyModel",
      "computeParentChildTopologyModel",
    ]) {
      expect(GRAPH).not.toContain(layout);
    }
    expect(GRAPH).not.toContain('"Not linked to anything"');
  });

  test("the export lays the map out with the same two functions", () => {
    const document: string = flatten(
      stripComments(
        fs.readFileSync(
          path.join(EXPORT_DIR, "NetworkTopologyExportDocument.ts"),
          "utf8",
        ),
      ),
    );
    expect(document).toContain("computeTopologyLayoutModel(input.layoutMode, nodes, edges)");
    expect(document).toContain("buildTopologyHulls( model, viewModel.nodes, )");
    expect(document).toContain("buildTopologyViewModel({");
    expect(document).toContain("buildTopologyLegend(");
  });
});

describe("the PDF library is loaded only when somebody exports", () => {
  test("jsPDF is imported dynamically, in the loader alone", () => {
    for (const file of exportModules()) {
      const source: string = fs.readFileSync(path.join(EXPORT_DIR, file), "utf8");
      // A static value import would put jsPDF in the dashboard's main bundle.
      expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+"jspdf"/m);
      expect(source).not.toMatch(/from\s+"jspdf-autotable"/);
      if (file === "NetworkTopologyPdfExport.ts") {
        expect(source).toContain('await import("jspdf")');
        continue;
      }
      // App's type check compiles these, and App does not install jsPDF.
      expect(source).not.toContain('"jspdf"');
    }
  });

  test("the loader is reached from the live view only", () => {
    expect(LIVE_VIEW).toContain(
      'import { exportNetworkTopologyAsPdf } from "./Export/NetworkTopologyPdfExport";',
    );
    for (const file of exportModules()) {
      if (file === "NetworkTopologyPdfExport.ts") {
        continue;
      }
      const source: string = fs.readFileSync(path.join(EXPORT_DIR, file), "utf8");
      expect(source).not.toContain("NetworkTopologyPdfExport");
    }
  });

  test("the export modules are plain TypeScript: no React, no DOM rendering", () => {
    for (const file of exportModules()) {
      expect(file.endsWith(".ts")).toBe(true);
      const source: string = fs.readFileSync(path.join(EXPORT_DIR, file), "utf8");
      expect(source).not.toMatch(/from\s+"react"/);
    }
  });
});
