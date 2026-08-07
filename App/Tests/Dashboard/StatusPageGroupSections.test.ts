import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import {
  STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
  StatusPageGroupSection,
  StatusPageGroupSectionPage,
  buildStatusPageGroupSections,
  filterStatusPageGroupSections,
  getStatusPageGroupSectionPage,
  isStatusPageGroupSectionExpanded,
  shouldExpandStatusPageGroupSectionsByDefault,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupSections";

/*
 * Pins the windowing behind Status Page > Resources.
 *
 * The tab renders a resource table per group, and every one of those tables
 * fires a list and a count the moment it mounts. A status page with 1500
 * groups therefore used to fire ~3000 requests and build a DOM to match, which
 * is the "Network Error / high memory usage" crash it was reported as. So the
 * page now decides, up front and without mounting anything, which groups it is
 * allowed to render: this module is that decision.
 *
 * The two properties that matter most, and that a future change is most likely
 * to quietly break:
 *
 *   - a page never hands back more sections than it is allowed to mount, no
 *     matter what page number or search it is given, and
 *   - a status page small enough to fit on one page behaves exactly as it did
 *     before any of this existed - every group open, nothing to click.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_TWO: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MARKET: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const UNIT: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MISSING: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  if (data.order !== undefined) {
    group.order = data.order;
  }

  return group;
}

/*
 * Corporate
 *   Region 1000
 *     Market 1001
 *       Unit 0152
 *   Region 2000
 */
function makeHierarchy(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_ONE,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 2,
    }),
    makeGroup({
      id: MARKET,
      name: "Market 1001",
      parentId: REGION_ONE,
      order: 3,
    }),
    makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET, order: 4 }),
    makeGroup({
      id: REGION_TWO,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 5,
    }),
  ];
}

type MakeManyGroupsFunction = (count: number) => Array<StatusPageGroup>;

const makeManyGroups: MakeManyGroupsFunction = (
  count: number,
): Array<StatusPageGroup> => {
  const groups: Array<StatusPageGroup> = [];

  for (let index: number = 0; index < count; index++) {
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = `group-${index}`;
    group.name = `Group ${index}`;
    group.order = index;
    groups.push(group);
  }

  return groups;
};

type LabelsFunction = (
  sections: Array<StatusPageGroupSection>,
) => Array<string>;

const labels: LabelsFunction = (
  sections: Array<StatusPageGroupSection>,
): Array<string> => {
  return sections.map((section: StatusPageGroupSection) => {
    return section.pathLabel;
  });
};

describe("buildStatusPageGroupSections", () => {
  test("returns a section per group, in the order the status page renders them", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: makeHierarchy(),
      });

    expect(labels(sections)).toEqual([
      "Corporate",
      "Corporate › Region 1000",
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
      "Corporate › Region 2000",
    ]);
  });

  test("carries the group, its id and its depth", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: makeHierarchy(),
      });

    expect(sections[0]!.groupId).toBe(CORPORATE.toString());
    expect(sections[0]!.group.name).toBe("Corporate");
    expect(
      sections.map((section: StatusPageGroupSection) => {
        return section.depth;
      }),
    ).toEqual([0, 1, 2, 3, 1]);
  });

  test("sorts siblings by `order`, not by the order they were fetched in", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: [
          makeGroup({
            id: REGION_TWO,
            name: "Region 2000",
            parentId: CORPORATE,
            order: 5,
          }),
          makeGroup({
            id: REGION_ONE,
            name: "Region 1000",
            parentId: CORPORATE,
            order: 2,
          }),
          makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        ],
      });

    expect(labels(sections)).toEqual([
      "Corporate",
      "Corporate › Region 1000",
      "Corporate › Region 2000",
    ]);
  });

  test("a status page with no groups has no sections", () => {
    expect(buildStatusPageGroupSections({ statusPageGroups: [] })).toEqual([]);
  });

  test("never drops a group, whatever shape the data is in", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: [
          makeGroup({ id: CORPORATE, name: "Corporate", parentId: CORPORATE }),
          makeGroup({ id: REGION_ONE, name: "Region 1000", parentId: MISSING }),
          makeGroup({ id: MARKET, name: "Market 1001", parentId: UNIT }),
          makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET }),
        ],
      });

    expect(
      sections
        .map((section: StatusPageGroupSection) => {
          return section.group.name;
        })
        .sort(),
    ).toEqual(["Corporate", "Market 1001", "Region 1000", "Unit 0152"]);
  });

  test("labels the two groups that share a name differently", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: [
          makeGroup({ id: CORPORATE, name: "Region 1000", order: 1 }),
          makeGroup({
            id: REGION_ONE,
            name: "Region 1000",
            parentId: CORPORATE,
            order: 2,
          }),
        ],
      });

    expect(labels(sections)).toEqual([
      "Region 1000",
      "Region 1000 › Region 1000",
    ]);
  });

  /*
   * The quadratic that had to go: one label per group, each derived by
   * re-walking every group, is 1500 walks of 1500 groups on a page this size.
   */
  test("labels 1500 groups off a single walk of the tree", () => {
    const groups: Array<StatusPageGroup> = makeManyGroups(1500);
    const getParentId: typeof StatusPageGroupTreeUtil.getParentId =
      StatusPageGroupTreeUtil.getParentId;

    let parentPointerReads: number = 0;

    StatusPageGroupTreeUtil.getParentId = (
      statusPageGroup: StatusPageGroup,
    ): string | null => {
      parentPointerReads++;
      return getParentId.call(StatusPageGroupTreeUtil, statusPageGroup);
    };

    try {
      const sections: Array<StatusPageGroupSection> =
        buildStatusPageGroupSections({ statusPageGroups: groups });

      expect(sections).toHaveLength(1500);
      expect(parentPointerReads).toBeLessThanOrEqual(groups.length * 2);
    } finally {
      StatusPageGroupTreeUtil.getParentId = getParentId;
    }
  });
});

describe("filterStatusPageGroupSections", () => {
  const sections: Array<StatusPageGroupSection> = buildStatusPageGroupSections({
    statusPageGroups: makeHierarchy(),
  });

  test("an empty search keeps every section", () => {
    expect(
      filterStatusPageGroupSections({ sections: sections, searchText: "" }),
    ).toBe(sections);
  });

  test("a search that is only whitespace keeps every section", () => {
    expect(
      filterStatusPageGroupSections({ sections: sections, searchText: "   " }),
    ).toBe(sections);
  });

  test("matches on a group's own name", () => {
    expect(
      labels(
        filterStatusPageGroupSections({
          sections: sections,
          searchText: "Unit 0152",
        }),
      ),
    ).toEqual(["Corporate › Region 1000 › Market 1001 › Unit 0152"]);
  });

  test("ignores case", () => {
    expect(
      labels(
        filterStatusPageGroupSections({
          sections: sections,
          searchText: "uNiT 0152",
        }),
      ),
    ).toEqual(["Corporate › Region 1000 › Market 1001 › Unit 0152"]);
  });

  /*
   * Searching a parent has to bring back what is under it - that is how you
   * find a group on a page too big to page through.
   */
  test("a parent's name brings back its whole subtree", () => {
    expect(
      labels(
        filterStatusPageGroupSections({
          sections: sections,
          searchText: "Region 1000",
        }),
      ),
    ).toEqual([
      "Corporate › Region 1000",
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
    ]);
  });

  /*
   * Terms are matched independently, which is the only way a path is
   * searchable: nothing in "Corporate › Region 1000 › Market 1001" contains
   * the substring "corporate market".
   */
  test("every term has to appear, but they need not be adjacent", () => {
    expect(
      labels(
        filterStatusPageGroupSections({
          sections: sections,
          searchText: "corporate market",
        }),
      ),
    ).toEqual([
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
    ]);
  });

  test("a term that matches nothing drops everything", () => {
    expect(
      filterStatusPageGroupSections({
        sections: sections,
        searchText: "corporate nonsense",
      }),
    ).toEqual([]);
  });

  test("collapses runs of whitespace between terms", () => {
    expect(
      labels(
        filterStatusPageGroupSections({
          sections: sections,
          searchText: "  corporate    market  ",
        }),
      ),
    ).toEqual([
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
    ]);
  });

  test("searching an empty list of sections is not an error", () => {
    expect(
      filterStatusPageGroupSections({ sections: [], searchText: "corporate" }),
    ).toEqual([]);
  });
});

describe("getStatusPageGroupSectionPage", () => {
  test("cuts the sections into pages of the given size", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(25),
      });

    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: sections,
      pageNumber: 2,
      pageSize: 10,
    });

    expect(labels(page.sections)).toEqual([
      "Group 10",
      "Group 11",
      "Group 12",
      "Group 13",
      "Group 14",
      "Group 15",
      "Group 16",
      "Group 17",
      "Group 18",
      "Group 19",
    ]);
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(page.totalSectionCount).toBe(25);
    expect(page.totalPageCount).toBe(3);
  });

  test("the last page is short when the count does not divide evenly", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(25),
      }),
      pageNumber: 3,
      pageSize: 10,
    });

    expect(labels(page.sections)).toEqual([
      "Group 20",
      "Group 21",
      "Group 22",
      "Group 23",
      "Group 24",
    ]);
  });

  test("a count that divides evenly does not add an empty trailing page", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(20),
      }),
      pageNumber: 1,
      pageSize: 10,
    });

    expect(page.totalPageCount).toBe(2);
  });

  /*
   * The page number outliving the list it indexes into is the everyday case:
   * you are on page 40 and then you type into the search box.
   */
  test("clamps a page number past the end onto the last page", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(25),
      }),
      pageNumber: 400,
      pageSize: 10,
    });

    expect(page.pageNumber).toBe(3);
    expect(page.sections).toHaveLength(5);
  });

  test("clamps a page number below the first page", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(25),
      }),
      pageNumber: 0,
      pageSize: 10,
    });

    expect(page.pageNumber).toBe(1);
    expect(labels(page.sections)[0]).toBe("Group 0");
  });

  test("clamps a negative page number", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(25),
      }),
      pageNumber: -7,
      pageSize: 10,
    });

    expect(page.pageNumber).toBe(1);
  });

  test("no sections still leaves a page to sit on", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: [],
      pageNumber: 5,
      pageSize: 10,
    });

    expect(page.sections).toEqual([]);
    expect(page.pageNumber).toBe(1);
    expect(page.totalPageCount).toBe(1);
    expect(page.totalSectionCount).toBe(0);
  });

  test("a page size of zero does not divide by zero", () => {
    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(3),
      }),
      pageNumber: 1,
      pageSize: 0,
    });

    expect(page.pageSize).toBe(1);
    expect(page.sections).toHaveLength(1);
    expect(page.totalPageCount).toBe(3);
  });

  test("every section is reachable by paging, exactly once", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(53),
      });

    const seen: Array<string> = [];
    const totalPageCount: number = getStatusPageGroupSectionPage({
      sections: sections,
      pageNumber: 1,
      pageSize: 10,
    }).totalPageCount;

    for (
      let pageNumber: number = 1;
      pageNumber <= totalPageCount;
      pageNumber++
    ) {
      seen.push(
        ...labels(
          getStatusPageGroupSectionPage({
            sections: sections,
            pageNumber: pageNumber,
            pageSize: 10,
          }).sections,
        ),
      );
    }

    expect(seen).toEqual(labels(sections));
  });

  /*
   * The ceiling that stops the crash. Whatever it is asked for, a page can
   * never hand the tab more tables than it is allowed to mount.
   */
  test("a 1500 group status page still yields one page of sections", () => {
    const sections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: makeManyGroups(1500),
      });

    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: sections,
      pageNumber: 1,
      pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
    });

    expect(page.sections).toHaveLength(STATUS_PAGE_GROUP_SECTIONS_PER_PAGE);
    expect(page.totalSectionCount).toBe(1500);
    expect(page.totalPageCount).toBe(
      1500 / STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
    );
  });
});

describe("shouldExpandStatusPageGroupSectionsByDefault", () => {
  test("a status page that fits on one page opens every section, as it always did", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: 5,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      }),
    ).toBe(true);
  });

  test("exactly one full page still opens", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      }),
    ).toBe(true);
  });

  test("one group past a page and the sections start closed", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE + 1,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      }),
    ).toBe(false);
  });

  test("the status page this was written for starts closed", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: 1500,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      }),
    ).toBe(false);
  });

  test("a status page with no groups is not a special case", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: 0,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      }),
    ).toBe(true);
  });

  test("a page size of zero does not open a thousand tables", () => {
    expect(
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: 1500,
        pageSize: 0,
      }),
    ).toBe(false);
  });
});

describe("isStatusPageGroupSectionExpanded", () => {
  test("a section nobody has touched follows the default", () => {
    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "group-1",
        expandedOverrides: {},
        isExpandedByDefault: true,
      }),
    ).toBe(true);

    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "group-1",
        expandedOverrides: {},
        isExpandedByDefault: false,
      }),
    ).toBe(false);
  });

  test("opening a section beats a default of closed", () => {
    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "group-1",
        expandedOverrides: { "group-1": true },
        isExpandedByDefault: false,
      }),
    ).toBe(true);
  });

  test("closing a section beats a default of open", () => {
    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "group-1",
        expandedOverrides: { "group-1": false },
        isExpandedByDefault: true,
      }),
    ).toBe(false);
  });

  test("one section's state does not leak into another's", () => {
    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "group-2",
        expandedOverrides: { "group-1": true },
        isExpandedByDefault: false,
      }),
    ).toBe(false);
  });

  test("a group with no id falls back to the default rather than a stray key", () => {
    expect(
      isStatusPageGroupSectionExpanded({
        groupId: "",
        expandedOverrides: { "group-1": true },
        isExpandedByDefault: false,
      }),
    ).toBe(false);
  });
});

describe("the Resources tab, end to end", () => {
  /*
   * How many resource tables the tab would mount for a given status page -
   * which is the number the crash was really about, at two requests each.
   */
  type CountMountedTablesFunction = (data: {
    statusPageGroups: Array<StatusPageGroup>;
    searchText: string;
    pageNumber: number;
    expandedOverrides: Record<string, boolean>;
  }) => number;

  const countMountedTables: CountMountedTablesFunction = (data: {
    statusPageGroups: Array<StatusPageGroup>;
    searchText: string;
    pageNumber: number;
    expandedOverrides: Record<string, boolean>;
  }): number => {
    const allSections: Array<StatusPageGroupSection> =
      buildStatusPageGroupSections({
        statusPageGroups: data.statusPageGroups,
      });

    const isExpandedByDefault: boolean =
      shouldExpandStatusPageGroupSectionsByDefault({
        totalSectionCount: allSections.length,
        pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
      });

    const page: StatusPageGroupSectionPage = getStatusPageGroupSectionPage({
      sections: filterStatusPageGroupSections({
        sections: allSections,
        searchText: data.searchText,
      }),
      pageNumber: data.pageNumber,
      pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
    });

    return page.sections.filter((section: StatusPageGroupSection) => {
      return isStatusPageGroupSectionExpanded({
        groupId: section.groupId,
        expandedOverrides: data.expandedOverrides,
        isExpandedByDefault: isExpandedByDefault,
      });
    }).length;
  };

  test("a five group status page mounts all five tables, exactly as before", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeHierarchy(),
        searchText: "",
        pageNumber: 1,
        expandedOverrides: {},
      }),
    ).toBe(5);
  });

  /*
   * The regression test for the crash: 1500 groups used to mean 1500 tables
   * and ~3000 requests on mount. It now means none until the user opens one.
   */
  test("a 1500 group status page mounts no group tables until asked", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeManyGroups(1500),
        searchText: "",
        pageNumber: 1,
        expandedOverrides: {},
      }),
    ).toBe(0);
  });

  test("opening a group on a huge status page mounts that one table", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeManyGroups(1500),
        searchText: "",
        pageNumber: 1,
        expandedOverrides: { "group-3": true },
      }),
    ).toBe(1);
  });

  test("a group opened on another page mounts nothing on this one", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeManyGroups(1500),
        searchText: "",
        pageNumber: 2,
        expandedOverrides: { "group-3": true },
      }),
    ).toBe(0);
  });

  test("nothing the user can do mounts more tables than a page holds", () => {
    const statusPageGroups: Array<StatusPageGroup> = makeManyGroups(1500);
    const expandedOverrides: Record<string, boolean> = {};

    for (const group of statusPageGroups) {
      expandedOverrides[group._id!.toString()] = true;
    }

    for (const pageNumber of [1, 2, 75, 150, 9999]) {
      expect(
        countMountedTables({
          statusPageGroups: statusPageGroups,
          searchText: "",
          pageNumber: pageNumber,
          expandedOverrides: expandedOverrides,
        }),
      ).toBeLessThanOrEqual(STATUS_PAGE_GROUP_SECTIONS_PER_PAGE);
    }
  });

  test("a search that matches nothing mounts nothing", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeHierarchy(),
        searchText: "no such group",
        pageNumber: 1,
        expandedOverrides: {},
      }),
    ).toBe(0);
  });

  /*
   * Searching does not change the default, only what is on screen. A small
   * status page keeps its sections open while you filter them.
   */
  test("searching a small status page still shows the matches open", () => {
    expect(
      countMountedTables({
        statusPageGroups: makeHierarchy(),
        searchText: "Region 1000",
        pageNumber: 1,
        expandedOverrides: {},
      }),
    ).toBe(3);
  });
});
