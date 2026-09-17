import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\s+/g, " ");
}

describe("Network Site Type settings use parent relationships", () => {
  const source: string = readSource(
    "Pages",
    "NetworkSite",
    "Settings",
    "SiteTypes.tsx",
  );

  test("the raw hierarchy order field is no longer exposed", () => {
    expect(source).not.toContain("field: { order: true }");
    expect(source).not.toContain('title: "Order"');
    expect(source).not.toContain("Lower numbers are higher up");
  });

  test("the table and form show the parent site type", () => {
    expect(source).toContain("parentNetworkSiteType: { name: true, }");
    expect(source).toContain('title: "Parent Site Type"');
    expect(source).toContain("fetchParentNetworkSiteTypeOptions");
    expect(source).toContain('placeholder: "No parent site type (top level)"');
    expect(source).toContain('sectionTitle: "Parent Relationship"');
    expect(source).not.toContain('sectionTitle: "Position in the Hierarchy"');
  });

  /*
   * The parent type shapes site placement without dictating it. Copy that
   * still calls it a validity rule is what sent operators looking for a way
   * around it in GitHub issue #3744.
   */
  test("the help presents parent types as guidance, not a placement rule", () => {
    expect(source).toContain("Choose the type directly above this one");
    expect(source).toContain(
      "this relationship decides which parent sites are suggested first",
    );
    expect(source).not.toContain(
      "this relationship determines which parent sites are valid",
    );
    expect(source).not.toContain(
      "a type that is already in use can move only when its sites already match",
    );
  });
});

describe.each([
  ["Sites page", ["Pages", "NetworkSite", "Sites.tsx"]],
  ["Site overview editor", ["Pages", "NetworkSite", "View", "Index.tsx"]],
  ["Site settings editor", ["Pages", "NetworkSite", "View", "Settings.tsx"]],
])(
  "%s follows the type-first hierarchy flow",
  (_name: string, sourcePath: string[]) => {
    const source: string = readSource(...sourcePath);
    const formSource: string = source.split("formFields={[")[1] || "";

    test("puts Site Type before Name", () => {
      expect(formSource.indexOf('title: "Site Type"')).toBeGreaterThan(-1);
      expect(formSource.indexOf('title: "Site Type"')).toBeLessThan(
        formSource.indexOf('title: "Name"'),
      );
    });

    test("loads breadcrumb type choices and clears a stale parent", () => {
      expect(source).toContain(
        "fetchDropdownOptions: fetchAllNetworkSiteTypeOptions",
      );
      expect(source).toContain("parentSite: null");
      expect(source).not.toContain("parentSiteId: undefined");
    });

    test("places Parent Site in its own hierarchy step", () => {
      expect(source).toContain('title: "Hierarchy", id: "hierarchy"');
      expect(source).toContain('title: "Parent Site"');
      expect(source).toContain('stepId: "hierarchy"');
      expect(source).toContain("fetchParentNetworkSiteOptions");
    });

    /*
     * A required parent site is the first half of GitHub issue #3744: a
     * project whose types were all top-level could not satisfy it, and a
     * project with the seeded five-level tree had to build four ancestors
     * before it could record one store.
     */
    test("never requires a parent site", () => {
      expect(source).not.toContain("isParentSiteRequired");
      expect(source).toContain('title: "Parent Site"');
    });

    test("describes the parent picker as a suggestion, not a filter", () => {
      expect(source).toContain(
        "Any site that is not below this one in your site type hierarchy can be the parent",
      );
      expect(source).not.toContain(
        "Only sites whose type is the configured parent",
      );
      expect(source).not.toContain(
        "A child site type requires one of the matching sites below",
      );
    });
  },
);

describe("Child Sites creation respects the known parent's type", () => {
  const source: string = readSource(
    "Pages",
    "NetworkSite",
    "View",
    "ChildSites.tsx",
  );

  test("keeps the current site as the new row's parent", () => {
    expect(source).toContain("item.parentSiteId = modelId");
  });

  test("offers every child type the hierarchy does not place above this site", () => {
    expect(source).toContain("fetchChildNetworkSiteTypeOptions(modelId)");
    expect(source).toContain(
      "Any type except the ones above this site's own type in the hierarchy",
    );
    expect(source).not.toContain(
      "Only types configured directly beneath this site's type are available",
    );
    expect(source).not.toContain("type: NetworkSiteType, labelField");
  });

  test("asks for the child type before the child name", () => {
    const formSource: string = source.split("formFields={[")[1] || "";
    expect(formSource.indexOf('title: "Site Type"')).toBeLessThan(
      formSource.indexOf('title: "Name"'),
    );
  });
});

describe("Network Site hierarchy option loading", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "NetworkSiteFormDropdownOptions.ts",
  );

  /*
   * Filtering the query by the configured parent type is what made the picker
   * come back empty for every type in the reporting project (GitHub issue
   * #3744). The narrowing that replaced it asks for the types the placement
   * rule allows, which is a superset that can never be empty while any
   * container type exists.
   */
  test("asks for every type the placement rule allows, not one configured type", () => {
    expect(source).toContain("getValidSiteParentTypes");
    expect(source).toContain(
      "networkSiteTypeId: new Includes(allowedParentTypeIds)",
    );
    expect(source).not.toContain(
      "networkSiteTypeId: new ObjectID(parentNetworkSiteTypeId)",
    );
  });

  test("reads each candidate's own type so the rule can be applied", () => {
    expect(source).toContain("networkSiteTypeId: true");
    expect(source).toContain("materializedPath: true");
  });

  test("no form field is gated on a required parent site any more", () => {
    expect(source).not.toContain("isParentSiteRequired");
  });

  test("pages through every eligible type and parent site", () => {
    expect(source).toContain("networkSiteTypes.push(...result.data)");
    expect(source).toContain("parentSites.push(...result.data)");
    expect(source).toContain("skip += result.data.length");
  });
});

describe("Network Site parent candidate filtering", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteTypeHierarchyFormUtil.ts",
  );

  test("does not offer the current site or one of its descendants", () => {
    expect(source).toContain("candidateId === normalizedCurrentId");
    expect(source).toContain("includes(`/${normalizedCurrentId}/`)");
  });

  test("routes every candidate through the shared placement rule", () => {
    expect(source).toContain("isTypeAllowedAsSiteParentOfType");
    expect(source).toContain("isParentSitePlacementAllowed");
  });

  test("labels the suggested group rather than relying on array order", () => {
    expect(source).toContain("Suggested —");
    expect(source).toContain('label: "Other sites"');
  });
});
