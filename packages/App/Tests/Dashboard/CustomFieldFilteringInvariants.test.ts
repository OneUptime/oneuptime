import { describe, expect, test } from "@jest/globals";
import {
  CUSTOM_FIELD_QUERY_FIELD,
  buildCustomFieldFacets,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import fs from "fs";
import path from "path";

/*
 * Custom field chips are wired into seven resource tables, and the wiring is
 * three lines each: load the definitions, append them to `extraFacets`, and
 * pass `areFacetsLoading` on. The App suite runs in a plain Node environment
 * with no renderer, so — like SummaryTileFilteringInvariants and
 * NetworkSitePageInvariants — these read the sources and assert the exact
 * expressions. Every assertion corresponds to a way the feature can be broken
 * while every other test in the repo stays green.
 *
 * The one that matters most is the last section. BaseModelTable builds its
 * request as `{...props.query, ...columnFilterQuery}`, where `props.query`
 * carries the facet-merged query — so a classic column filter over
 * `customFields` would replace every chip's constraint outright, silently,
 * while the chips carried on claiming to apply.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type SquashFunction = (text: string) => string;

const squash: SquashFunction = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
};

interface WiredTable {
  label: string;
  source: string;
  definitionModel: string;
  /** The variable its own facets are already in, when it has any. */
  existingFacetsVariable?: string | undefined;
}

const WIRED_TABLES: Array<WiredTable> = [
  {
    label: "Incidents",
    source: readSource("Components", "Incident", "IncidentsTable.tsx"),
    definitionModel: "IncidentCustomField",
    existingFacetsVariable: "incidentExtraFacets",
  },
  {
    label: "Alerts",
    source: readSource("Components", "Alert", "AlertsTable.tsx"),
    definitionModel: "AlertCustomField",
    existingFacetsVariable: "alertExtraFacets",
  },
  {
    label: "Monitors",
    source: readSource("Components", "Monitor", "MonitorTable.tsx"),
    definitionModel: "MonitorCustomField",
    existingFacetsVariable: "monitorExtraFacets",
  },
  {
    label: "Scheduled Maintenance",
    source: readSource(
      "Components",
      "ScheduledMaintenance",
      "ScheduledMaintenanceTable.tsx",
    ),
    definitionModel: "ScheduledMaintenanceCustomField",
    existingFacetsVariable: "scheduledMaintenanceExtraFacets",
  },
  {
    label: "On-Call Duty Policies",
    source: readSource("Pages", "OnCallDuty", "OnCallDutyPolicies.tsx"),
    definitionModel: "OnCallDutyPolicyCustomField",
  },
  {
    label: "Teams",
    source: readSource("Pages", "Teams", "Index.tsx"),
    definitionModel: "TeamCustomField",
    existingFacetsVariable: "teamExtraFacets",
  },
  {
    label: "Status Pages",
    source: readSource("Pages", "StatusPages", "StatusPages.tsx"),
    definitionModel: "StatusPageCustomField",
  },
];

describe("every table with custom fields offers chips for them", () => {
  for (const table of WIRED_TABLES) {
    describe(table.label, () => {
      test("loads its definitions with the right definition model", () => {
        /*
         * A regex rather than a literal: prettier wraps the longer model names
         * onto their own line, which adds a trailing comma. The wiring is what
         * this pins, not the line width it happens to fit in.
         */
        expect(table.source).toMatch(
          new RegExp(
            `useCustomFieldFacets\\(\\{ customFieldsModelType: ${table.definitionModel},? \\}\\)`,
          ),
        );
      });

      test("appends the chips to the facet bar", () => {
        /*
         * Appended, not replacing: a table's own chips (State, Severity,
         * Affected Resources) have to survive.
         */
        const expected: string = table.existingFacetsVariable
          ? `extraFacets: [...${table.existingFacetsVariable}, ...customFieldFacets],`
          : "extraFacets: customFieldFacets,";

        expect(table.source).toContain(expected);
      });

      test("tells the bar the chips are still loading", () => {
        /*
         * Without this the bar reads a link's restored chip as "the user
         * cleared it" on the first render and deletes the URL param before
         * the definitions have arrived.
         */
        expect(table.source).toContain(
          "areFacetsLoading: areCustomFieldFacetsLoading,",
        );
      });

      test("still declares its custom field columns", () => {
        // The chips and the columns read the same definitions; both or neither.
        expect(table.source).toContain(
          `customFieldsModelType={${table.definitionModel}}`,
        );
      });
    });
  }
});

describe("no table filters customFields from the column-filter popup", () => {
  /*
   * The popup's query is spread over the facet-merged query in
   * BaseModelTable.fetchItems, so a `customFields` entry in a `filters` array
   * would overwrite every chip on the bar. There is no way to see that
   * happening from the screen: the chips stay lit.
   */
  for (const table of WIRED_TABLES) {
    test(`${table.label} declares no customFields column filter`, () => {
      expect(table.source).not.toContain(`${CUSTOM_FIELD_QUERY_FIELD}: true`);
    });
  }
});

describe("the facet bar's merge rules are actually claimed by the chips", () => {
  /*
   * Pinned here rather than only in CustomFieldFacets.test because these two
   * flags are the difference between "several chips AND together over one
   * column" and "the last chip silently wins" — and between "this field is
   * unset" and "this resource has no custom fields at all".
   */
  const facets: Array<ResourceFacet> = buildCustomFieldFacets([
    { name: "Team" },
    { name: "Region" },
  ]);

  test("every chip writes the same column", () => {
    for (const facet of facets) {
      expect(facet.queryField).toBe(CUSTOM_FIELD_QUERY_FIELD);
    }
  });

  test("every chip declares how to share it", () => {
    for (const facet of facets) {
      expect(typeof facet.mergeQueryValue).toBe("function");
    }
  });

  test("every chip owns its own empty operators", () => {
    for (const facet of facets) {
      expect(facet.handlesValuelessOperators).toBe(true);
    }
  });

  test("no chip declares itself exclusive with another", () => {
    // They AND. Declaring a conflict would make picking one clear the rest.
    for (const facet of facets) {
      expect(facet.exclusiveWith).toBeUndefined();
    }
  });
});

describe("the hook that feeds the chips", () => {
  const hookSource: string = readSource(
    "Components",
    "CustomFields",
    "useCustomFieldFacets.ts",
  );

  test("reuses the definitions the columns already fetch", () => {
    /*
     * Two requests for the same definitions would drift the moment one was
     * edited, and would show the table a different set of custom fields than
     * the bar.
     */
    expect(hookSource).toContain("useCustomFieldColumns");
  });

  test("reports nothing to wait for when there is no definition model", () => {
    expect(hookSource).toContain(
      "isLoading: Boolean(data.customFieldsModelType) && definitionsResult.isLoading",
    );
  });
});
