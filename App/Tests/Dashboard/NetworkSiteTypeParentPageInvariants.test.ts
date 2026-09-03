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

  test("the help explains that parent types constrain site placement", () => {
    expect(source).toContain("Choose the type directly above this one");
    expect(source).toContain(
      "this relationship determines which parent sites are valid",
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
      expect(source).toContain("required: isParentSiteRequired");
      expect(source).toContain(
        "Only sites whose type is the configured parent",
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

  test("offers only configured direct child types", () => {
    expect(source).toContain("fetchChildNetworkSiteTypeOptions(modelId)");
    expect(source).toContain(
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

  test("filters candidate parent sites by the configured parent type", () => {
    expect(source).toContain("getConfiguredParentTypeId");
    expect(source).toContain(
      "networkSiteTypeId: new ObjectID(parentNetworkSiteTypeId)",
    );
  });

  test("does not offer the current site or one of its descendants", () => {
    expect(source).toContain("candidateId === normalizedCurrentId");
    expect(source).toContain("includes(`/${normalizedCurrentId}/`)");
  });

  test("pages through every eligible type and parent site", () => {
    expect(source).toContain("networkSiteTypes.push(...result.data)");
    expect(source).toContain("parentSites.push(...result.data)");
    expect(source).toContain("skip += result.data.length");
  });
});
