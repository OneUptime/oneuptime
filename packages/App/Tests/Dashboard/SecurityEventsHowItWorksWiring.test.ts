import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DocsNav, { NavGroup, NavLink } from "../../FeatureSet/Docs/Utils/Nav";
import DetectionRulesGuide from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import ThreatIntelGuide from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { SecurityEventsGuide } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";

/*
 * The Detection Rules and Threat Intel pages each lead with a "how it
 * works" card. The rendering is covered by Common's React suites
 * (Common/Tests/App/Dashboard/SecurityEventsHowItWorksCard.test.tsx and
 * the page suites); what is pinned here is the wiring App's React-free
 * suite can see:
 *
 *  - the guides are importable without React — they are plain data, so
 *    the content can be tested (and reused) outside a component;
 *  - each guide's "Full documentation" link lands on a docs page that
 *    exists and is in the docs navigation;
 *  - both pages render the card and feed the same guide to the table's
 *    help (?) modal, instead of carrying a second, drifting copy.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const DOCS_CONTENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

const HOW_IT_WORKS_DIR: Array<string> = [
  "Components",
  "SecurityEvents",
  "HowItWorks",
];

function readDashboardSource(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const GUIDES: Array<[string, SecurityEventsGuide]> = [
  ["Detection Rules", DetectionRulesGuide],
  ["Threat Intel", ThreatIntelGuide],
];

const PAGES: Array<[string, string, string, string]> = [
  [
    "DetectionRules.tsx",
    "DetectionRulesGuide",
    "ModelTable<DetectionRule>",
    "ruleCount",
  ],
  [
    "ThreatIntel.tsx",
    "ThreatIntelGuide",
    "ModelTable<ThreatIntelFeed>",
    "feedCount",
  ],
];

// The card's element, as written: from its tag to the end of its props.
function cardElementOf(source: string): { index: number; text: string } {
  const index: number = source.indexOf("<SecurityEventsHowItWorksCard");

  if (index === -1) {
    return { index, text: "" };
  }

  return { index, text: source.slice(index, source.indexOf("/>", index) + 2) };
}

describe("Security Events how-it-works guides", () => {
  test.each(GUIDES)(
    "the %s guide loads without React and has content",
    (_name: string, guide: SecurityEventsGuide) => {
      expect(guide.sections.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(0);
    },
  );

  test.each([
    "SecurityEventsGuide.ts",
    "DetectionRulesGuide.ts",
    "ThreatIntelGuide.ts",
  ])("%s stays React-free", (fileName: string) => {
    const source: string = readDashboardSource(...HOW_IT_WORKS_DIR, fileName);

    expect(source).not.toMatch(/from "react"/);
    expect(source).not.toMatch(/Common\/UI\//);
  });

  test.each(GUIDES)(
    "the %s guide's documentation page exists",
    (_name: string, guide: SecurityEventsGuide) => {
      expect(
        fs.existsSync(
          path.join(DOCS_CONTENT_DIR, `${guide.documentationPath}.md`),
        ),
      ).toBe(true);
    },
  );

  test.each(GUIDES)(
    "the %s guide's documentation page is in the docs navigation",
    (_name: string, guide: SecurityEventsGuide) => {
      const urls: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.url;
          });
        },
      );

      expect(urls).toContain(`/docs${guide.documentationPath}`);
    },
  );
});

describe("Security Events pages use the how-it-works card", () => {
  test.each(PAGES)(
    "%s renders the card with %s ahead of its table",
    (fileName: string, guideName: string, tableTag: string) => {
      const source: string = stripComments(
        readDashboardSource("Pages", "SecurityEvents", fileName),
      );

      const card: { index: number; text: string } = cardElementOf(source);
      const tableIndex: number = source.indexOf(`<${tableTag}`);

      expect(card.index).toBeGreaterThan(-1);
      expect(card.text).toContain(`guide={${guideName}}`);
      expect(tableIndex).toBeGreaterThan(card.index);
    },
  );

  /*
   * The card opens by itself only over an empty list: the page tells it
   * how many rows its table first read (onFetchSuccess), so a busy
   * project opens on its list rather than on the steps.
   */
  test.each(PAGES)(
    "%s tells the card how many rows its table read",
    (
      fileName: string,
      _guideName: string,
      _tableTag: string,
      countName: string,
    ) => {
      const source: string = stripComments(
        readDashboardSource("Pages", "SecurityEvents", fileName),
      );
      const setter: string = `set${countName.charAt(0).toUpperCase()}${countName.slice(1)}(`;

      expect(cardElementOf(source).text).toContain(
        `listItemCount={${countName}}`,
      );
      expect(source).toContain("onFetchSuccess=");
      expect(source.indexOf(setter)).toBeGreaterThan(-1);
    },
  );

  test.each(PAGES)(
    "%s feeds %s to the table's help modal instead of a local copy",
    (fileName: string, guideName: string) => {
      const source: string = stripComments(
        readDashboardSource("Pages", "SecurityEvents", fileName),
      );

      expect(source).toContain(`markdown: guideToMarkdown(${guideName})`);
      expect(source).toContain(`title: ${guideName}.guideTitle`);
      expect(source).not.toContain("const documentationMarkdown");
    },
  );
});
