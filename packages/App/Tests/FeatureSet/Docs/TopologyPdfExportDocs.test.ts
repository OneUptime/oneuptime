import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { UNLINKED_HULL_CAPTION } from "../../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NETWORK_DEVICE_PAGE,
  drawnNetworkLabel,
  sectionInLanguage,
} from "./NetworkDocsLabels";

/*
 * Issue #4616: the network device guide tells readers about Export PDF on
 * the topology map, in every docs language. Markdown is not compiled, so
 * these tests read the labels from the dashboard's own sources and hold the
 * guide to them - the English guide by the English labels, a translation by
 * the labels its language's Dashboard draws - and hold the section to where
 * a reader of the topology section finds it.
 */

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

// The English sections; a translation's sections sit on their lines.
const TOPOLOGY_HEADING: string = "## Network Topology";
const EXPORT_HEADING: string = "### Export the map as a PDF";

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s network device guide on exporting the map",
  (language: string) => {
    const topology: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      TOPOLOGY_HEADING,
    );
    const exportSection: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      EXPORT_HEADING,
    );

    function drawn(label: string): string {
      return `**${drawnNetworkLabel(language, label)}**`;
    }

    test("the export has its own section inside the topology section", () => {
      const exportHeading: string = exportSection.split("\n")[0] as string;

      expect(exportHeading.startsWith("### ")).toBe(true);
      expect(topology).toContain(`\n${exportHeading}\n`);
    });

    test("names the button exactly as the map's header does", () => {
      const title: string = LIVE_VIEW.match(EXPORT_BUTTON_TITLE)![1]!;
      expect(exportSection).toContain(drawn(title));
    });

    test("names every view the button is on, by the names the menus use", () => {
      expect(NETWORK_SIDE_MENU).toContain('title: "Device Topology"');
      expect(NETWORK_SIDE_MENU).toContain('title: "Map"');
      for (const view of ["Device Topology", "Map", "Network", "Topology"]) {
        expect(exportSection).toContain(drawn(view));
      }
    });

    test("names the strip of devices with no links as the map captions it", () => {
      expect(exportSection).toContain(drawn(UNLINKED_HULL_CAPTION));
    });

    test("says what the PDF shows: statuses, the A4 page and its tables", () => {
      for (const word of ["Up", "Down", "Unknown", "A4", "PDF"]) {
        expect(exportSection).toContain(word);
      }
    });
  },
);

describe("the English guide promises what the export does", () => {
  const exportSection: string = sectionInLanguage(
    "en",
    NETWORK_DEVICE_PAGE,
    EXPORT_HEADING,
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
