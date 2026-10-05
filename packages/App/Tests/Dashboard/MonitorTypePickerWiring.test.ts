import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every form that offers the whole monitor type catalog draws its Monitor
 * Type field from one helper, Utils/Form/Monitor/MonitorTypeFormField.ts:
 * the search box, and the catalog layout - the six common types first as
 * compact rows, the rest behind "More monitor types", a picked type shrunk to
 * one line with a Change button. A page that builds its own field instead is
 * the kind of one-line drift a refactor makes without breaking a type or a
 * render, and the picker would quietly go back to a wall of cards on that
 * page.
 *
 * The behaviour itself is exercised against the real catalog in
 * Common/Tests/App/Dashboard/MonitorTypePicker.test.tsx, and the component in
 * Common/Tests/UI/Components/CardSelect.test.tsx. Pinned against source here
 * rather than imported, for the same reason as PayAsYouGoWiring: react is a
 * dependency of the Dashboard package, not of App, so importing these pages
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

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

type ReadFunction = (...segments: Array<string>) => string;

const read: ReadFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

/*
 * Every page that offers the full monitor type catalog. All three had the same
 * wall of cards, so all three get the same picker.
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

const HELPER_SEGMENTS: Array<string> = [
  "Utils",
  "Form",
  "Monitor",
  "MonitorTypeFormField.ts",
];

type ListSourceFilesFunction = (directory: string) => Array<string>;

const listSourceFiles: ListSourceFilesFunction = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listSourceFiles(full));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

describe("monitor type picker wiring", () => {
  describe.each(PAGES_OFFERING_THE_FULL_CATALOG)(
    "$name page",
    ({ segments }: { name: string; segments: Array<string> }) => {
      const source: string = read(...segments);

      test("draws its Monitor Type field from the shared helper", () => {
        // A page two folders below src imports "../../Utils/...", and so on.
        const toSrc: string = "../".repeat(segments.length - 1);

        expect(source).toContain(
          `from "${toSrc}Utils/Form/Monitor/MonitorTypeFormField"`,
        );
        expect(source.match(/getMonitorTypeFormField</g) || []).toHaveLength(
          1,
        );
      });

      test("builds no monitor type picker of its own", () => {
        expect(source).not.toContain(
          "MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions()",
        );
        expect(source).not.toContain("cardSelectSearchable");
        expect(source).not.toContain("cardSelectCatalog");
        expect(source).not.toContain("cardSelectCollapsibleGroups");
      });
    },
  );

  describe("the shared helper", () => {
    const source: string = read(...HELPER_SEGMENTS);

    test("offers the categorised monitor type catalog", () => {
      expect(source).toContain(
        "MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions()",
      );
      expect(source).toContain("fieldType: FormFieldSchemaType.CardSelect");
      expect(source).toContain("field: { monitorType: true }");
      expect(source).toContain("required: true");
    });

    test("gives the picker a search box", () => {
      expect(source).toContain("cardSelectSearchable: true");
    });

    test("lays it out as a catalog, the common types first", () => {
      expect(source).toContain("cardSelectCatalog: MONITOR_TYPE_CATALOG");
      expect(source).toContain(
        "commonOptionValues: MonitorTypeHelper.getCommonMonitorTypes()",
      );
      expect(source).toMatch(
        /translationKey\(\s*"More monitor types",?\s*\)|translationKey\("More monitor types"\)/,
      );
    });

    /*
     * The placeholder is the only thing that tells a user the search knows
     * words that are not printed on any card. Kept in translationKey, so the
     * string extractor finds it.
     */
    test("tells the user the search understands their own vocabulary", () => {
      expect(source).toMatch(
        /MONITOR_TYPE_SEARCH_PLACEHOLDER: string = translationKey\(\s*"Search monitor types - try ping, ssl, k8s, postgres",?\s*\)/,
      );
      expect(source).toContain(
        "cardSelectSearchPlaceholder: MONITOR_TYPE_SEARCH_PLACEHOLDER",
      );
    });

    test("asks the question the picker answers", () => {
      expect(source).toMatch(
        /translationKey\(\s*"What do you want to monitor\?",?\s*\)/,
      );
    });
  });

  describe("Create Monitor asks what to monitor first", () => {
    const source: string = read("Pages", "Monitor", "Create.tsx");

    test("the picker comes before the name, on Monitor Info", () => {
      // The form's own field list, not the selects of the prefill reads above it.
      const fields: number = source.indexOf("fields={[");
      const picker: number = source.indexOf(
        "getMonitorTypeFormField<Monitor>({",
        fields,
      );
      const name: number = source.indexOf("name: true,", fields);

      expect(fields).toBeGreaterThan(-1);
      expect(picker).toBeGreaterThan(fields);
      expect(name).toBeGreaterThan(picker);
      expect(
        source.slice(picker, picker + 120),
      ).toContain('stepId: "monitor-info"');
    });

    test("the description folds under More fields with the labels", () => {
      const description: number = source.indexOf("description: true,");
      const labels: number = source.indexOf("getLabelsFormField<Monitor>({");

      expect(description).toBeGreaterThan(-1);
      expect(labels).toBeGreaterThan(description);
      expect(source.slice(description, labels)).toContain(
        "collapsibleSection: MONITOR_INFO_MORE_FIELDS",
      );
      expect(source.slice(labels, labels + 200)).toContain(
        "collapsibleSection: MONITOR_INFO_MORE_FIELDS",
      );
      expect(source).toContain(
        "const MONITOR_INFO_MORE_FIELDS: FormFieldCollapsibleSection<Monitor> =\n  getAdvancedFormSection<Monitor>();",
      );
    });

    test("the criteria step folds a new monitor's default criteria", () => {
      expect(source).toContain("foldDefaultCriteria={true}");
    });
  });

  describe("the monitor template form asks for the type first too", () => {
    const source: string = read(
      "Pages",
      "Monitor",
      "Settings",
      "MonitorTemplates.tsx",
    );

    test("the picker comes before the default name, on Monitor Defaults", () => {
      const picker: number = source.indexOf(
        "getMonitorTypeFormField<MonitorTemplate>({",
      );
      const name: number = source.indexOf("monitorName: true,");

      expect(picker).toBeGreaterThan(-1);
      expect(name).toBeGreaterThan(picker);
      expect(source.slice(picker, picker + 160)).toContain(
        'stepId: "monitor-defaults"',
      );
    });
  });

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
     * read fine as a plain grid; turning search or the catalog layout on there
     * would add chrome for nothing, and the opt-in default is what keeps them
     * as they were.
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
      expect(source).not.toContain("cardSelectCatalog");
    });
  });

  /*
   * The collapsible groups the monitor type picker used to fold its
   * categories behind - a heading and a count each - are gone from the
   * shared component, and nothing may ask for them again.
   */
  test("no source asks for collapsible card groups any more", () => {
    const offenders: Array<string> = [
      ...listSourceFiles(DASHBOARD_SRC),
      ...listSourceFiles(COMMON_UI),
    ].filter((file: string) => {
      const text: string = fs.readFileSync(file, "utf8");

      return (
        text.includes("cardSelectCollapsibleGroups") ||
        text.includes("collapsibleGroups=")
      );
    });

    expect(offenders).toEqual([]);
  });
});
