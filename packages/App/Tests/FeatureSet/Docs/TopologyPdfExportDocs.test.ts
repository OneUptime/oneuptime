import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { UNLINKED_HULL_CAPTION } from "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";

/*
 * Issue #4616: the network device guide tells readers about Export PDF on
 * the topology map — in English and in Persian, the guide's one
 * translation, which keeps the dashboard's English labels. Markdown is not
 * compiled, so these tests read the labels from the dashboard's own sources
 * and hold the guide to them, and hold the section to where a reader of the
 * topology section finds it.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";
const LIVE_VIEW: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView.tsx",
  ),
  "utf8",
);
const NETWORK_SIDE_MENU: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu.tsx",
  ),
  "utf8",
);

const EXPORT_BUTTON_TITLE: RegExp = /title: "(Export PDF)"/;

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, DEVICE_GUIDE), "utf8");
}

// The section between `heading` and the next heading of the same level or higher.
function section(guide: string, heading: string): string {
  const lines: Array<string> = guide.split("\n");
  const start: number = lines.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const level: number = heading.indexOf(" ");
  const end: number = lines.findIndex((line: string, index: number) => {
    if (index <= start) {
      return false;
    }
    const match: RegExpMatchArray | null = line.match(/^(#+) /);
    return Boolean(match && match[1]!.length <= level);
  });
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

const SECTIONS: Record<string, { topology: string; exportSection: string }> = {
  en: {
    topology: "## Network Topology",
    exportSection: "### Export the map as a PDF",
  },
  fa: {
    topology: "## توپولوژی شبکه",
    exportSection: "### خروجی گرفتن از نقشه به‌صورت PDF",
  },
};

describe.each(Object.keys(SECTIONS))(
  "the %s network device guide on exporting the map",
  (language: string) => {
    const guide: string = readGuide(language);
    const headings: { topology: string; exportSection: string } =
      SECTIONS[language]!;
    const exportSection: string = section(guide, headings.exportSection);

    test("the export has its own section inside the topology section", () => {
      const topology: string = section(guide, headings.topology);
      expect(topology).toContain(headings.exportSection);
    });

    test("names the button exactly as the map's header does", () => {
      const title: string = LIVE_VIEW.match(EXPORT_BUTTON_TITLE)![1]!;
      expect(exportSection).toContain(`**${title}**`);
    });

    test("names every view the button is on, by the names the menus use", () => {
      expect(NETWORK_SIDE_MENU).toContain('title: "Device Topology"');
      expect(NETWORK_SIDE_MENU).toContain('title: "Map"');
      for (const view of ["Device Topology", "Map", "Network", "Topology"]) {
        expect(exportSection).toContain(`**${view}**`);
      }
    });

    test("names the strip of devices with no links as the map captions it", () => {
      expect(exportSection).toContain(`**${UNLINKED_HULL_CAPTION}**`);
    });

    test("says what the PDF shows: statuses, the A4 page and its tables", () => {
      for (const word of ["Up", "Down", "Unknown", "A4", "PDF"]) {
        expect(exportSection).toContain(word);
      }
    });
  },
);

describe("the English guide promises what the export does", () => {
  const exportSection: string = section(
    readGuide("en"),
    "### Export the map as a PDF",
  );

  test.each([
    "The whole map",
    "drawn as vectors",
    "the devices you dragged",
    "hidden node types, the endpoint VLAN, a health filter, or a search",
    "The legend",
    "every device (type, kind, status, vendor and model, address, interfaces and number of links)",
    "every connection (the port at each end, its state, its utilization and how it was found)",
    "The PDF is always light, whichever theme you use",
    "made in your browser from the map on screen",
    "Its text is in English",
  ])("says %s", (phrase: string) => {
    expect(exportSection).toContain(phrase);
  });
});
