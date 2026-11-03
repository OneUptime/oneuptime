import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Project from "Common/Models/DatabaseModels/Project";
import { NETWORK_TOPOLOGY_LAYOUTS } from "Common/Types/NetworkDevice/NetworkTopologyLayout";
import Permission from "Common/Types/Permission";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NETWORK_DEVICE_PAGE,
  drawnNetworkLabel,
  drawnPath,
  sectionInLanguage,
} from "./NetworkDocsLabels";

/*
 * Issue #5378: the network device guide says which layout a topology map
 * opens on, and how a Project Owner or Admin chooses it for everyone, in
 * every docs language. Markdown is not compiled, so these tests read the
 * labels from the Dashboard's own sources and hold the guide to them - the
 * English guide by the English labels, a translation by the labels its
 * language's Dashboard draws - and hold the English guide to what the code
 * does: which layout each map opens on by itself, and who may choose.
 */

function readDashboard(file: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../../../FeatureSet/Dashboard/src", file),
    "utf8",
  );
}

const TOOLBAR: string = readDashboard(
  "Components/Topology/NetworkTopologyToolbar.tsx",
);
const EXPLORER: string = readDashboard(
  "Components/Topology/NetworkTopologyExplorer.tsx",
);
const LIVE_VIEW: string = readDashboard(
  "Components/Topology/NetworkTopologyLiveView.tsx",
);

// The English sections; a translation's sections sit on their lines.
const TOPOLOGY_HEADING: string = "## Network Topology";
const LAYOUT_HEADING: string = "### Choose the layout the map opens on";
const EXPORT_HEADING: string = "### Export the map as a PDF";

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

// The label the toolbar draws for a layout, read from its own list.
function layoutLabel(mode: string): string {
  const match: RegExpMatchArray | null = TOOLBAR.match(
    new RegExp(`mode: "${mode}",\\s*label: "([^"]+)"`),
  );

  if (!match) {
    throw new Error(`The toolbar offers no layout "${mode}"`);
  }

  return match[1] as string;
}

describe("the labels the guide is held to", () => {
  test("the toolbar offers every layout a project can choose", () => {
    for (const mode of NETWORK_TOPOLOGY_LAYOUTS) {
      expect(layoutLabel(mode).length).toBeGreaterThan(0);
    }
  });

  test.each(["Default", "Make default for everyone", "Clear default"])(
    "the toolbar draws %p",
    (label: string) => {
      expect(TOOLBAR).toContain(`translateString("${label}")`);
    },
  );
});

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s network device guide on the layout a map opens on",
  (language: string) => {
    const topology: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      TOPOLOGY_HEADING,
    );
    const section: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      LAYOUT_HEADING,
    );

    function drawn(label: string): string {
      return `**${drawnNetworkLabel(language, label)}**`;
    }

    test("has its own section in the topology section, before the PDF export", () => {
      const heading: string = section.split("\n")[0] as string;
      const exportHeading: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        EXPORT_HEADING,
      ).split("\n")[0] as string;

      expect(heading.startsWith("### ")).toBe(true);
      expect(topology.indexOf(`\n${heading}\n`)).toBeGreaterThan(-1);
      expect(topology.indexOf(`\n${heading}\n`)).toBeLessThan(
        topology.indexOf(`\n${exportHeading}\n`),
      );
    });

    test("finds the layouts where the map keeps them", () => {
      expect(section).toContain(
        drawnPath(language, ["Map options", "Arrange the map"]),
      );
    });

    test("names every layout the map offers, as the toolbar draws it", () => {
      for (const mode of NETWORK_TOPOLOGY_LAYOUTS) {
        expect(section).toContain(drawn(layoutLabel(mode)));
      }
    });

    test("names the tag and both controls as the toolbar draws them", () => {
      for (const label of [
        "Default",
        "Make default for everyone",
        "Clear default",
      ]) {
        expect(section).toContain(drawn(label));
      }
    });

    test("names every view the default applies to, as the menus do", () => {
      for (const view of ["Device Topology", "Map", "Network", "Topology"]) {
        expect(section).toContain(drawn(view));
      }
    });

    test("is two paragraphs under its heading", () => {
      const paragraphs: Array<string> = section
        .split("\n\n")
        .map((block: string): string => {
          return block.trim();
        })
        .filter((block: string): boolean => {
          return block.length > 0;
        });

      expect(paragraphs).toHaveLength(3);
      expect(paragraphs[0]!.startsWith("### ")).toBe(true);
    });
  },
);

describe("the English guide says what the code does", () => {
  const section: string = sectionInLanguage(
    "en",
    NETWORK_DEVICE_PAGE,
    LAYOUT_HEADING,
  );

  test("each map's own default is the layout it opens on with no project default", () => {
    expect(squash(EXPLORER)).toContain(
      'layoutMode={ currentSiteId ? props.siteLayoutMode || "tiered" : "force" }',
    );
    expect(section).toContain(
      `**${layoutLabel("force")}** for all devices and **${layoutLabel("tiered")}** for a site`,
    );
  });

  test("the project's default wins over each map's own", () => {
    expect(squash(LIVE_VIEW)).toContain(
      'projectDefaultLayout || props.layoutMode || "force"',
    );
    expect(section).toContain("unless your project has chosen a layout");
  });

  test("names who may choose it: the column's own update permissions", () => {
    expect(
      new Project().getColumnAccessControlFor("defaultNetworkTopologyLayout")
        ?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(section).toContain(
      "Project Owners and Project Admins choose the default",
    );
  });

  test("says a switch lasts for the visit, and the map opens on the default again", () => {
    expect(section).toContain(
      "Anyone can switch layouts while they look; the map opens on the default again next time.",
    );
  });

  test("says dragged positions are kept for each layout in the browser, as the toolbar does", () => {
    expect(TOOLBAR).toContain(
      "Dragged positions are saved for each layout on this browser.",
    );
    expect(section).toContain(
      "Dragged positions are saved for each layout in your browser",
    );
  });
});
