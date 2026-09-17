import {
  FIXTURE_DATA_TYPES,
  FIXTURE_RESOURCES,
  fixtureNavigation,
} from "./ReferenceFixtures";
import { DataTypeDocumentation } from "../../../FeatureSet/APIReference/Utils/DataTypes";
import { makeT } from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  buildReferenceNavigation,
  buildSearchIndex,
  DATA_TYPES_SECTION_ID,
  findAdjacentPages,
  findNavLocation,
  flattenNavigation,
  GUIDES_SECTION_ID,
  ReferenceNavAdjacent,
  ReferenceNavItem,
  ReferenceNavLocation,
  ReferenceNavSection,
  ReferenceSearchEntry,
  RESOURCES_SECTION_ID,
} from "../../../FeatureSet/APIReference/Utils/Navigation";
import { ModelDocumentation } from "../../../FeatureSet/APIReference/Utils/Resources";
import { describe, expect, it } from "@jest/globals";

/*
 * The sidebar, the mobile drawer, the command palette and the previous/next
 * pager all read this one tree. Before it existed the sidebar built its list
 * inline in EJS and nothing else had a list at all, so these are the invariants
 * that keep the four in agreement.
 */

function slugsOf(sections: Array<ReferenceNavSection>): Array<string> {
  return flattenNavigation(sections).map((item: ReferenceNavItem) => {
    return item.slug;
  });
}

describe("buildReferenceNavigation", () => {
  it("puts guides first, then resources, then data types", () => {
    const sections: Array<ReferenceNavSection> = fixtureNavigation();

    expect(
      sections.map((section: ReferenceNavSection) => {
        return section.id;
      }),
    ).toEqual([GUIDES_SECTION_ID, RESOURCES_SECTION_ID, DATA_TYPES_SECTION_ID]);
  });

  it("lists the guides in reading order", () => {
    const sections: Array<ReferenceNavSection> = fixtureNavigation({
      showMasterAdminApis: false,
    });

    expect(
      sections[0]!.groups[0]!.items.map((item: ReferenceNavItem) => {
        return item.slug;
      }),
    ).toEqual([
      "introduction",
      "authentication",
      "pagination",
      "permissions",
      "data-types",
      "errors",
      "openapi",
    ]);
  });

  it("appends the master admin guide only on a self-hosted build", () => {
    expect(slugsOf(fixtureNavigation({ showMasterAdminApis: true }))).toContain(
      "master-admin-apis",
    );

    expect(
      slugsOf(fixtureNavigation({ showMasterAdminApis: false })),
    ).not.toContain("master-admin-apis");
  });

  it("titles the sections from the locale, not from hard-coded English", () => {
    const german: Array<ReferenceNavSection> = fixtureNavigation({
      lang: "de",
    });
    const english: Array<ReferenceNavSection> = fixtureNavigation({
      lang: "en",
    });

    expect(german[0]!.title).toBe(makeT("de")("ui.guides"));
    expect(german[0]!.title).not.toBe(english[0]!.title);
  });

  it("carries the resources through with their descriptions", () => {
    const sections: Array<ReferenceNavSection> = fixtureNavigation();
    const resources: ReferenceNavSection = sections[1]!;

    expect(resources.groups).toHaveLength(1);
    expect(resources.groups[0]!.title).toBeNull();
    expect(resources.groups[0]!.items).toEqual(
      FIXTURE_RESOURCES.map((resource: ModelDocumentation) => {
        return {
          name: resource.name,
          slug: resource.path,
          description: resource.description,
        };
      }),
    );
  });

  it("hangs uncategorised data types off the section and groups the rest", () => {
    const dataTypes: ReferenceNavSection = fixtureNavigation()[2]!;

    expect(dataTypes.groups[0]!.title).toBeNull();
    expect(
      dataTypes.groups[0]!.items.map((item: ReferenceNavItem) => {
        return item.slug;
      }),
    ).toEqual(["object-id", "decimal"]);

    expect(dataTypes.groups[1]!.title).toBe("Monitor");
    expect(
      dataTypes.groups[1]!.items.map((item: ReferenceNavItem) => {
        return item.slug;
      }),
    ).toEqual(["monitor-steps", "monitor-step"]);
  });

  it("keeps categories in the order they first appear", () => {
    const dataTypes: Array<DataTypeDocumentation> = [
      { name: "B", path: "b", description: "", category: "Second" },
      { name: "A", path: "a", description: "", category: "First" },
      { name: "C", path: "c", description: "", category: "Second" },
    ];

    const sections: Array<ReferenceNavSection> = buildReferenceNavigation({
      t: makeT("en"),
      resources: [],
      dataTypes: dataTypes,
      showMasterAdminApis: false,
    });

    expect(
      sections[2]!.groups.map((group: { title: string | null }) => {
        return group.title;
      }),
    ).toEqual(["Second", "First"]);
  });

  it("omits the data types section entirely when there are none", () => {
    const sections: Array<ReferenceNavSection> = buildReferenceNavigation({
      t: makeT("en"),
      resources: FIXTURE_RESOURCES,
      dataTypes: [],
      showMasterAdminApis: false,
    });

    expect(
      sections.map((section: ReferenceNavSection) => {
        return section.id;
      }),
    ).toEqual([GUIDES_SECTION_ID, RESOURCES_SECTION_ID]);
  });

  it("still renders a resources section when a build documents no models", () => {
    const sections: Array<ReferenceNavSection> = buildReferenceNavigation({
      t: makeT("en"),
      resources: [],
      dataTypes: FIXTURE_DATA_TYPES,
      showMasterAdminApis: false,
    });

    expect(sections[1]!.id).toBe(RESOURCES_SECTION_ID);
    expect(sections[1]!.groups[0]!.items).toEqual([]);
  });
});

describe("flattenNavigation", () => {
  it("reads the tree in the order the sidebar renders it", () => {
    expect(slugsOf(fixtureNavigation({ showMasterAdminApis: false }))).toEqual([
      "introduction",
      "authentication",
      "pagination",
      "permissions",
      "data-types",
      "errors",
      "openapi",
      "incident",
      "monitor",
      "on-call-duty-policy",
      "status-page",
      "object-id",
      "decimal",
      "monitor-steps",
      "monitor-step",
    ]);
  });

  it("returns nothing for an empty tree", () => {
    expect(flattenNavigation([])).toEqual([]);
  });
});

describe("findAdjacentPages", () => {
  const sections: Array<ReferenceNavSection> = fixtureNavigation({
    showMasterAdminApis: false,
  });

  it("gives both neighbours in the middle of a section", () => {
    const adjacent: ReferenceNavAdjacent = findAdjacentPages(
      sections,
      "pagination",
    );

    expect(adjacent.previous?.slug).toBe("authentication");
    expect(adjacent.next?.slug).toBe("permissions");
  });

  it("crosses a section boundary rather than stopping at it", () => {
    const adjacent: ReferenceNavAdjacent = findAdjacentPages(
      sections,
      "incident",
    );

    expect(adjacent.previous?.slug).toBe("openapi");
    expect(adjacent.next?.slug).toBe("monitor");
  });

  it("caps both ends instead of wrapping around", () => {
    expect(findAdjacentPages(sections, "introduction").previous).toBeNull();
    expect(findAdjacentPages(sections, "introduction").next?.slug).toBe(
      "authentication",
    );

    expect(findAdjacentPages(sections, "monitor-step").next).toBeNull();
    expect(findAdjacentPages(sections, "monitor-step").previous?.slug).toBe(
      "monitor-steps",
    );
  });

  it("gives no pager at all for a page outside the navigation", () => {
    expect(findAdjacentPages(sections, "page-not-found")).toEqual({
      previous: null,
      next: null,
    });
    expect(findAdjacentPages(sections, "")).toEqual({
      previous: null,
      next: null,
    });
  });

  it("carries the display name, so the pager needs no second lookup", () => {
    expect(findAdjacentPages(sections, "monitor").previous?.name).toBe(
      "Incident",
    );
  });
});

describe("findNavLocation", () => {
  const sections: Array<ReferenceNavSection> = fixtureNavigation();

  it("reports the section a resource sits in", () => {
    const location: ReferenceNavLocation | null = findNavLocation(
      sections,
      "monitor",
    );

    expect(location?.section.id).toBe(RESOURCES_SECTION_ID);
    expect(location?.group.title).toBeNull();
    expect(location?.item.name).toBe("Monitor");
  });

  it("reports the group for a categorised data type", () => {
    const location: ReferenceNavLocation | null = findNavLocation(
      sections,
      "monitor-step",
    );

    expect(location?.section.id).toBe(DATA_TYPES_SECTION_ID);
    expect(location?.group.title).toBe("Monitor");
  });

  it("returns null for a page that is not in the tree", () => {
    expect(findNavLocation(sections, "page-not-found")).toBeNull();
  });
});

describe("buildSearchIndex", () => {
  const entries: Array<ReferenceSearchEntry> = buildSearchIndex(
    fixtureNavigation({ showMasterAdminApis: false }),
  );

  it("has one entry per navigable page", () => {
    expect(entries).toHaveLength(
      flattenNavigation(fixtureNavigation({ showMasterAdminApis: false }))
        .length,
    );
  });

  it("labels an entry with its section", () => {
    const monitor: ReferenceSearchEntry | undefined = entries.find(
      (entry: ReferenceSearchEntry) => {
        return entry.slug === "monitor";
      },
    );

    expect(monitor?.section).toBe("Resources");
    expect(monitor?.description).toBe(
      "Monitor is anything that monitors your API or website.",
    );
  });

  it("qualifies the section with the group when a page has one", () => {
    const step: ReferenceSearchEntry | undefined = entries.find(
      (entry: ReferenceSearchEntry) => {
        return entry.slug === "monitor-step";
      },
    );

    expect(step?.section).toBe("Data Types · Monitor");
  });

  it("gives guides an empty description rather than undefined", () => {
    const introduction: ReferenceSearchEntry | undefined = entries.find(
      (entry: ReferenceSearchEntry) => {
        return entry.slug === "introduction";
      },
    );

    expect(introduction?.description).toBe("");
  });

  it("produces no duplicate slugs, which the palette would show twice", () => {
    const slugs: Array<string> = entries.map((entry: ReferenceSearchEntry) => {
      return entry.slug;
    });

    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
