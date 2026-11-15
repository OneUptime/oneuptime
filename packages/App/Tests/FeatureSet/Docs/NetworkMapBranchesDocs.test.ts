import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NETWORK_DEVICE_PAGE,
  drawnNetworkLabel,
  sectionInLanguage,
} from "./NetworkDocsLabels";

/*
 * Issue #6606: the network device guide tells readers how to find their way
 * around a large network map - the leaf grids, folding branches, one branch
 * on its own, the search that finds a device, and the original layout - in
 * every docs language. Markdown is not compiled, so these tests read the
 * labels from the dashboard's own sources and hold the guide to them: the
 * English guide by the English labels, a translation by the labels its
 * language's Dashboard draws.
 */

const GRAPH: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph.tsx",
  ),
  "utf8",
);
const DRAWER: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel.tsx",
  ),
  "utf8",
);
const TOOLBAR: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyToolbar.tsx",
  ),
  "utf8",
);

// The English sections; a translation's sections sit on their lines.
const TOPOLOGY_HEADING: string = "## Network Topology";
const LAYOUT_HEADING: string = "### Choose the layout the map opens on";
const BRANCHES_HEADING: string = "### Find your way around a large network";
const EXPORT_HEADING: string = "### Export the map as a PDF";

// Each label the section quotes, and where in the product it is drawn.
const LABELS_AND_SOURCES: ReadonlyArray<{ label: string; source: string }> = [
  { label: "Parent and child", source: TOOLBAR },
  { label: "Collapse all branches", source: GRAPH },
  { label: "Expand all branches", source: GRAPH },
  { label: "Show only this branch", source: DRAWER },
  { label: "Show whole map", source: GRAPH },
  { label: "Original layout", source: GRAPH },
  { label: "Reset layout", source: GRAPH },
];

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s network device guide on finding your way around a large network",
  (language: string) => {
    const topology: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      TOPOLOGY_HEADING,
    );
    const branches: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      BRANCHES_HEADING,
    );
    const layout: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      LAYOUT_HEADING,
    );
    const exportSection: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      EXPORT_HEADING,
    );

    test("has its own section inside the topology section, between the layouts and the export", () => {
      const heading: string = branches.split("\n")[0] as string;
      expect(heading.startsWith("### ")).toBe(true);
      expect(topology).toContain(`\n${heading}\n`);
      const layoutAt: number = topology.indexOf(
        layout.split("\n")[0] as string,
      );
      const branchesAt: number = topology.indexOf(heading);
      const exportAt: number = topology.indexOf(
        exportSection.split("\n")[0] as string,
      );
      expect(layoutAt).toBeLessThan(branchesAt);
      expect(branchesAt).toBeLessThan(exportAt);
    });

    test.each(LABELS_AND_SOURCES)(
      "names $label as the product draws it",
      ({ label, source }: { label: string; source: string }) => {
        expect(source).toContain(`"${label}"`);
        expect(branches).toContain(`**${drawnNetworkLabel(language, label)}**`);
      },
    );

    test("quotes the layout switch as the map draws it, two devices moved", () => {
      expect(GRAPH).toContain('"Custom layout · {{count}} moved"');
      expect(branches).toContain(
        `**${drawnNetworkLabel(language, "Custom layout · 2 moved")}**`,
      );
    });

    test("shows the fold control and a folded count exactly as drawn", () => {
      expect(branches).toContain("`−`");
      expect(branches).toContain("`+24`");
    });
  },
);

describe("the English guide promises what the map does", () => {
  const branches: string = sectionInLanguage(
    "en",
    NETWORK_DEVICE_PAGE,
    BRANCHES_HEADING,
  );

  test.each([
    "six or more devices that have nothing below them",
    "a compact grid under it instead of one long row",
    "right-angle lines that never cross a device or its name",
    "fits the whole map on screen at the largest size",
    "remembers collapsed branches for each site",
    "the path from the top of the network",
    "The search moves the map to the devices it finds",
    "Enter in the search box",
    "a match in a collapsed branch is counted too",
    "your custom layout is kept until you switch back",
  ])("says %s", (phrase: string) => {
    expect(branches).toContain(phrase);
  });
});
