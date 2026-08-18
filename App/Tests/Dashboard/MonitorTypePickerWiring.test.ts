import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The monitor type picker's search box and folded categories are two field
 * flags on a form definition. They are the kind of one-line call site that a
 * refactor drops without breaking a type or a render - and the picker would
 * quietly go back to listing all 29 monitor types at once, which is the
 * problem the flags exist to fix.
 *
 * The behaviour itself is exercised against the real catalog in
 * Common/Tests/App/Dashboard/MonitorTypePicker.test.tsx. Pinned against source
 * here rather than imported, for the same reason as PayAsYouGoWiring: react is
 * a dependency of the Dashboard package, not of App, so importing these pages
 * would not resolve, and App's jest runs in a node environment with no DOM.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadFunction = (...segments: Array<string>) => string;

const read: ReadFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

/*
 * Every page that offers the full monitor type catalog. All three had the same
 * wall of cards, so all three get the same treatment.
 */
const PAGES_OFFERING_THE_FULL_CATALOG: Array<{
  name: string;
  segments: Array<string>;
}> = [
  { name: "create monitor", segments: ["Pages", "Monitor", "Create.tsx"] },
  {
    name: "monitor templates list",
    segments: ["Pages", "Monitor", "Settings", "MonitorTemplates.tsx"],
  },
  {
    name: "monitor template view",
    segments: ["Pages", "Monitor", "Settings", "MonitorTemplatesView.tsx"],
  },
];

describe("monitor type picker wiring", () => {
  describe.each(PAGES_OFFERING_THE_FULL_CATALOG)(
    "$name page",
    ({ segments }: { name: string; segments: Array<string> }) => {
      const source: string = read(...segments);

      test("offers the categorised monitor type catalog", () => {
        expect(source).toContain(
          "MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions()",
        );
      });

      test("gives the picker a search box", () => {
        expect(source).toContain("cardSelectSearchable: true");
      });

      test("folds the categories away behind their headings", () => {
        expect(source).toContain("cardSelectCollapsibleGroups: true");
      });

      /*
       * The placeholder is the only thing that tells a user the search knows
       * words that are not printed on any card.
       */
      test("tells the user the search understands their own vocabulary", () => {
        expect(source).toContain("cardSelectSearchPlaceholder");
        expect(source).toMatch(/cardSelectSearchPlaceholder:[\s\S]{0,120}k8s/);
      });

      test("puts the flags on the monitor type field, not some other picker", () => {
        const optionsIndex: number = source.indexOf(
          "MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions()",
        );
        const searchableIndex: number = source.indexOf(
          "cardSelectSearchable: true",
        );
        const collapsibleIndex: number = source.indexOf(
          "cardSelectCollapsibleGroups: true",
        );

        expect(optionsIndex).toBeGreaterThan(-1);
        expect(searchableIndex).toBeGreaterThan(optionsIndex);
        expect(collapsibleIndex).toBeGreaterThan(optionsIndex);
        // Same field definition, not a picker further down the file.
        expect(collapsibleIndex - optionsIndex).toBeLessThan(400);
      });
    },
  );

  describe("the option adapter", () => {
    const source: string = read("Utils", "MonitorType.ts");

    /*
     * Without this line every search below the surface - "k8s", "postgres",
     * "heartbeat" - silently finds nothing, and the picker looks like it is
     * working.
     */
    test("carries keywords from the catalog onto the cards", () => {
      expect(source).toContain("keywords: typeProps.keywords");
      expect(source).toContain("keywords: props.keywords");
    });
  });

  describe("callers that did not ask for a search box", () => {
    /*
     * CardSelect is shared. These two pickers hold a handful of cards each and
     * read fine as a plain grid; turning search or folding on there would add
     * chrome for nothing, and the opt-in default is what keeps them as they
     * were.
     */
    test.each([
      [
        "team permission table",
        ["Components", "Team", "TeamPermissionTable.tsx"],
      ],
      [
        "metrics pipeline rules",
        ["Pages", "Metrics", "Settings", "PipelineRules.tsx"],
      ],
    ])("%s stays a plain grid", (_name: string, segments: Array<string>) => {
      const source: string = read(...segments);

      expect(source).toContain("FormFieldSchemaType.CardSelect");
      expect(source).not.toContain("cardSelectSearchable");
      expect(source).not.toContain("cardSelectCollapsibleGroups");
    });
  });
});
