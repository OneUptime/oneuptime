import StatusPageResourceEditorTreeUtil, {
  StatusPageGroupSearchMatch,
  StatusPageGroupSearchResult,
  StatusPageResourceCountIndex,
  StatusPageResourceEditorNode,
} from "../../../Utils/StatusPage/ResourceEditorTree";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the Resources tab of a status page with a large group
 * hierarchy.
 *
 * The tab used to render one resource table per group, all at once, which at
 * fifteen hundred groups meant fifteen hundred simultaneous requests and a
 * browser that ran out of memory before it finished (issue #3042). The tab is
 * a closed tree now, and this is the part of it that decides what a row says
 * before anything inside it has been fetched:
 *
 *   - how many resources sit in a group, and in everything under it,
 *   - what a search over fifteen hundred names returns and in what order,
 *   - and the caps that stop any single render from being unbounded again.
 *
 * The counts drive a decision an operator makes ("which of these still needs
 * monitors?"), so the cases where the page does not actually know the answer
 * have to stay silent rather than guess.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_1000: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MARKET_1001: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const UNIT_0152: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const REGION_2000: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
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

function makeResource(data: {
  id: string;
  statusPageGroupId?: ObjectID | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;

  if (data.statusPageGroupId) {
    resource.statusPageGroupId = data.statusPageGroupId;
  }

  return resource;
}

/* Corporate > Region 1000 > Market 1001 > Unit 0152, plus a second region. */
function buildHierarchy(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_1000,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 1,
    }),
    makeGroup({
      id: MARKET_1001,
      name: "Market 1001",
      parentId: REGION_1000,
      order: 1,
    }),
    makeGroup({
      id: UNIT_0152,
      name: "Unit 0152",
      parentId: MARKET_1001,
      order: 1,
    }),
    makeGroup({
      id: REGION_2000,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 2,
    }),
  ];
}

function findNode(
  nodes: Array<StatusPageResourceEditorNode>,
  name: string,
): StatusPageResourceEditorNode {
  for (const node of nodes) {
    if (node.group.name === name) {
      return node;
    }

    const found: StatusPageResourceEditorNode | null = findNodeOrNull(
      node.children,
      name,
    );

    if (found) {
      return found;
    }
  }

  throw new Error(`No node called ${name} in the tree`);
}

function findNodeOrNull(
  nodes: Array<StatusPageResourceEditorNode>,
  name: string,
): StatusPageResourceEditorNode | null {
  for (const node of nodes) {
    if (node.group.name === name) {
      return node;
    }

    const found: StatusPageResourceEditorNode | null = findNodeOrNull(
      node.children,
      name,
    );

    if (found) {
      return found;
    }
  }

  return null;
}

describe("StatusPageResourceEditorTreeUtil", () => {
  describe("buildResourceCountIndex", () => {
    test("counts the resources of each group", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: [
            makeResource({ id: "r1", statusPageGroupId: MARKET_1001 }),
            makeResource({ id: "r2", statusPageGroupId: MARKET_1001 }),
            makeResource({ id: "r3", statusPageGroupId: REGION_2000 }),
          ],
        });

      expect(index.ownCountByGroupId.get(MARKET_1001.toString())).toBe(2);
      expect(index.ownCountByGroupId.get(REGION_2000.toString())).toBe(1);
    });

    test("counts the resources that belong to no group separately", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: [
            makeResource({ id: "r1" }),
            makeResource({ id: "r2" }),
            makeResource({ id: "r3", statusPageGroupId: CORPORATE }),
          ],
        });

      expect(index.ungroupedCount).toBe(2);
      expect(index.ownCountByGroupId.get(CORPORATE.toString())).toBe(1);
    });

    test("a group with no resources is absent rather than zero", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: [],
        });

      expect(index.ownCountByGroupId.has(CORPORATE.toString())).toBe(false);
      expect(
        StatusPageResourceEditorTreeUtil.getOwnResourceCount({
          statusPageGroup: makeGroup({ id: CORPORATE, name: "Corporate" }),
          countIndex: index,
        }),
      ).toBe(0);
    });

    test("an untruncated list is complete", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: [makeResource({ id: "r1" })],
          totalCount: 1,
        });

      expect(index.isComplete).toBe(true);
      expect(index.totalCount).toBe(1);
    });

    /*
     * The hazard this guards: the resource list is fetched with the API's row
     * limit, and a status page big enough to hit that limit is exactly the kind
     * this rewrite is for. Counts derived from a truncated list are lower
     * bounds, and a lower bound rendered as "0 resources" tells an operator a
     * group is empty when it is not.
     */
    test("a list cut off by the row limit is not complete", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: [
            makeResource({ id: "r1" }),
            makeResource({ id: "r2" }),
          ],
          totalCount: 12000,
        });

      expect(index.isComplete).toBe(false);
    });

    test("the empty index knows it has no numbers", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.getEmptyResourceCountIndex();

      expect(index.isComplete).toBe(false);
      expect(index.totalCount).toBe(0);
      expect(index.ungroupedCount).toBe(0);
      expect(index.ownCountByGroupId.size).toBe(0);
    });
  });

  describe("buildTree", () => {
    test("nests groups the way the public status page renders them", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
        });

      expect(tree).toHaveLength(1);
      expect(tree[0]!.group.name).toBe("Corporate");
      expect(tree[0]!.depth).toBe(0);

      const children: Array<StatusPageResourceEditorNode> = tree[0]!.children;

      expect(
        children.map((node: StatusPageResourceEditorNode) => {
          return node.group.name;
        }),
      ).toEqual(["Region 1000", "Region 2000"]);
      expect(children[0]!.depth).toBe(1);
      expect(children[0]!.children[0]!.group.name).toBe("Market 1001");
      expect(children[0]!.children[0]!.depth).toBe(2);
    });

    test("counts a group's own resources", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
          countIndex: StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
            statusPageResources: [
              makeResource({ id: "r1", statusPageGroupId: MARKET_1001 }),
              makeResource({ id: "r2", statusPageGroupId: MARKET_1001 }),
            ],
          }),
        });

      expect(findNode(tree, "Market 1001").ownResourceCount).toBe(2);
      expect(findNode(tree, "Corporate").ownResourceCount).toBe(0);
    });

    /*
     * The number a closed row shows. A group that holds nothing itself but has
     * a hundred resources nested under it is not empty, and closing it hides
     * all hundred - so the row has to report the subtree, not the level.
     */
    test("rolls resource counts up through every level", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
          countIndex: StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
            statusPageResources: [
              makeResource({ id: "r1", statusPageGroupId: UNIT_0152 }),
              makeResource({ id: "r2", statusPageGroupId: MARKET_1001 }),
              makeResource({ id: "r3", statusPageGroupId: REGION_2000 }),
              makeResource({ id: "r4" }),
            ],
          }),
        });

      expect(findNode(tree, "Unit 0152").subtreeResourceCount).toBe(1);
      expect(findNode(tree, "Market 1001").subtreeResourceCount).toBe(2);
      expect(findNode(tree, "Region 1000").subtreeResourceCount).toBe(2);
      expect(findNode(tree, "Region 2000").subtreeResourceCount).toBe(1);
      // Not 4: the ungrouped resource belongs to no group in the tree.
      expect(findNode(tree, "Corporate").subtreeResourceCount).toBe(3);
    });

    test("counts direct sub groups and whole subtrees separately", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
        });

      const corporate: StatusPageResourceEditorNode = findNode(
        tree,
        "Corporate",
      );

      expect(corporate.subGroupCount).toBe(2);
      expect(corporate.descendantGroupCount).toBe(4);

      const market: StatusPageResourceEditorNode = findNode(
        tree,
        "Market 1001",
      );

      expect(market.subGroupCount).toBe(1);
      expect(market.descendantGroupCount).toBe(1);
      expect(findNode(tree, "Unit 0152").descendantGroupCount).toBe(0);
    });

    test("reports zero everywhere when the counts have not arrived", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
        });

      expect(findNode(tree, "Corporate").subtreeResourceCount).toBe(0);
    });

    /*
     * The parent pointer is a plain nullable column, so a row written straight
     * to the database can point at a group that was never fetched. A group that
     * disappears from this tree is a group an operator can no longer put
     * monitors into.
     */
    test("a group whose parent is missing is promoted to the top level", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
            makeGroup({
              id: REGION_1000,
              name: "Orphan",
              parentId: MISSING,
              order: 2,
            }),
          ],
        });

      expect(
        tree.map((node: StatusPageResourceEditorNode) => {
          return node.group.name;
        }),
      ).toEqual(["Corporate", "Orphan"]);
    });

    test("a cycle written straight to the database does not hang the tree", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "A", parentId: REGION_1000 }),
            makeGroup({ id: REGION_1000, name: "B", parentId: CORPORATE }),
          ],
        });

      expect(
        StatusPageResourceEditorTreeUtil.getGroupIdsInTreeOrder(tree).sort(),
      ).toEqual([CORPORATE.toString(), REGION_1000.toString()].sort());
    });

    test("holds up at the scale that broke the page", () => {
      const groups: Array<StatusPageGroup> = [];

      for (let i: number = 0; i < 1500; i++) {
        groups.push(
          makeGroup({
            id: new ObjectID(
              `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
            ),
            name: `Group ${i}`,
            order: i,
          }),
        );
      }

      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: groups,
        });

      expect(tree).toHaveLength(1500);
      expect(
        StatusPageResourceEditorTreeUtil.getGroupIdsInTreeOrder(tree),
      ).toHaveLength(1500);
    });
  });

  describe("getGroupIdsInTreeOrder", () => {
    test("returns every group, parents before their children", () => {
      const tree: Array<StatusPageResourceEditorNode> =
        StatusPageResourceEditorTreeUtil.buildTree({
          statusPageGroups: buildHierarchy(),
        });

      expect(
        StatusPageResourceEditorTreeUtil.getGroupIdsInTreeOrder(tree),
      ).toEqual([
        CORPORATE.toString(),
        REGION_1000.toString(),
        MARKET_1001.toString(),
        UNIT_0152.toString(),
        REGION_2000.toString(),
      ]);
    });
  });

  describe("searchGroups", () => {
    test("an empty search matches nothing at all", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "   ",
        });

      expect(result.matches).toHaveLength(0);
      expect(result.totalMatchCount).toBe(0);
      expect(result.isTruncated).toBe(false);
    });

    test("matches part of a name, ignoring case", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "market",
        });

      expect(
        result.matches.map((match: StatusPageGroupSearchMatch) => {
          return match.group.name;
        }),
      ).toEqual(["Market 1001"]);
    });

    test("every match carries the path that tells duplicates apart", () => {
      const groups: Array<StatusPageGroup> = [
        ...buildHierarchy(),
        makeGroup({
          id: MISSING,
          name: "Unit 0152",
          parentId: REGION_2000,
          order: 1,
        }),
      ];

      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: groups,
          searchText: "unit 0152",
        });

      expect(
        result.matches.map((match: StatusPageGroupSearchMatch) => {
          return match.path;
        }),
      ).toEqual([
        "Corporate › Region 1000 › Market 1001 › Unit 0152",
        "Corporate › Region 2000 › Unit 0152",
      ]);
    });

    /*
     * A page whose top level group is called "Corporate" would otherwise return
     * all fifteen hundred groups for the search "corp" - every one of them has
     * Corporate in its path.
     */
    test("matches the group's own name, not its ancestors", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "corporate",
        });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.group.name).toBe("Corporate");
    });

    test("results come back in tree order", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "region",
        });

      expect(
        result.matches.map((match: StatusPageGroupSearchMatch) => {
          return match.group.name;
        }),
      ).toEqual(["Region 1000", "Region 2000"]);
    });

    test("each match reports how deep it sits in the tree", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "unit",
        });

      expect(result.matches[0]!.depth).toBe(3);
    });

    /*
     * The cap is the whole reason search is a flat list. Without it, "e" over
     * fifteen hundred groups is the unbounded render this rewrite removed.
     */
    test("caps how many matches it returns and says so", () => {
      const groups: Array<StatusPageGroup> = [];

      for (let i: number = 0; i < 400; i++) {
        groups.push(
          makeGroup({
            id: new ObjectID(
              `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
            ),
            name: `Market ${i}`,
            order: i,
          }),
        );
      }

      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: groups,
          searchText: "market",
        });

      expect(result.matches).toHaveLength(
        StatusPageResourceEditorTreeUtil.MaxSearchResults,
      );
      expect(result.totalMatchCount).toBe(400);
      expect(result.isTruncated).toBe(true);
    });

    test("a search that fits under the cap is not reported as truncated", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "region",
        });

      expect(result.isTruncated).toBe(false);
      expect(result.totalMatchCount).toBe(2);
    });

    test("a search that matches nothing returns nothing", () => {
      const result: StatusPageGroupSearchResult =
        StatusPageResourceEditorTreeUtil.searchGroups({
          statusPageGroups: buildHierarchy(),
          searchText: "there is no such group",
        });

      expect(result.matches).toHaveLength(0);
      expect(result.totalMatchCount).toBe(0);
    });
  });

  describe("canExpandAll", () => {
    /*
     * "Expand all" mounts a table and fires a request per group. Past the cap
     * that convenience is the original bug, so the page must not offer it.
     */
    test("is offered for a small hierarchy", () => {
      expect(
        StatusPageResourceEditorTreeUtil.canExpandAll({ groupCount: 5 }),
      ).toBe(true);
    });

    test("is not offered when there is nothing to expand", () => {
      expect(
        StatusPageResourceEditorTreeUtil.canExpandAll({ groupCount: 0 }),
      ).toBe(false);
    });

    test("is not offered at the scale that broke the page", () => {
      expect(
        StatusPageResourceEditorTreeUtil.canExpandAll({ groupCount: 1506 }),
      ).toBe(false);
    });

    test("is offered right up to the cap and not past it", () => {
      expect(
        StatusPageResourceEditorTreeUtil.canExpandAll({
          groupCount: StatusPageResourceEditorTreeUtil.MaxGroupsToExpandAtOnce,
        }),
      ).toBe(true);
      expect(
        StatusPageResourceEditorTreeUtil.canExpandAll({
          groupCount:
            StatusPageResourceEditorTreeUtil.MaxGroupsToExpandAtOnce + 1,
        }),
      ).toBe(false);
    });
  });

  describe("indentation", () => {
    /*
     * Indentation here is structural: a sub group is drawn inside its parent's
     * open body, so what each level contributes is one step, and the offset a
     * row ends up at is the sum of the steps above it. A row that also set a
     * depth-proportional padding of its own would indent on top of an indent.
     */
    test("a level contributes one step", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({ depth: 0 }),
      ).toBe(StatusPageResourceEditorTreeUtil.IndentStepPixels);
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({ depth: 2 }),
      ).toBe(StatusPageResourceEditorTreeUtil.IndentStepPixels);
    });

    /*
     * Nesting is capped on write at ten levels, but rows written straight to
     * the database are not, and a tree that keeps indenting at full step runs
     * its deepest rows off the side of the card.
     */
    test("the step tightens past the cap", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({
          depth: StatusPageResourceEditorTreeUtil.MaxIndentedDepth,
        }),
      ).toBe(StatusPageResourceEditorTreeUtil.TightIndentStepPixels);
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({ depth: 12 }),
      ).toBe(StatusPageResourceEditorTreeUtil.TightIndentStepPixels);
    });

    test("a nonsense depth still gets a usable step", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({ depth: -3 }),
      ).toBe(StatusPageResourceEditorTreeUtil.IndentStepPixels);
      expect(
        StatusPageResourceEditorTreeUtil.getIndentStepPixels({ depth: NaN }),
      ).toBe(StatusPageResourceEditorTreeUtil.IndentStepPixels);
    });

    test("the top level sits flush", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getTotalIndentPixels({ depth: 0 }),
      ).toBe(0);
    });

    test("the total is the sum of the steps above the row", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getTotalIndentPixels({ depth: 2 }),
      ).toBe(StatusPageResourceEditorTreeUtil.IndentStepPixels * 2);
    });

    /*
     * The number that matters: the deepest legal group has to stay on a phone
     * screen. Ten levels at the full step would be 200px of the 375px the row
     * has to share with a name and its badges.
     */
    test("the deepest legal hierarchy stays inside a phone screen", () => {
      const deepest: number =
        StatusPageResourceEditorTreeUtil.getTotalIndentPixels({
          depth: 10,
        });

      expect(deepest).toBeLessThanOrEqual(150);
    });
  });

  describe("withGroupResourceCount", () => {
    type BuildIndexFunction = () => StatusPageResourceCountIndex;

    const buildIndex: BuildIndexFunction = (): StatusPageResourceCountIndex => {
      return StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
        statusPageResources: [
          makeResource({ id: "r1", statusPageGroupId: MARKET_1001 }),
          makeResource({ id: "r2", statusPageGroupId: MARKET_1001 }),
          makeResource({ id: "r3" }),
        ],
      });
    };

    /*
     * An open group reporting its own size is how the counts stay honest after
     * a create or a delete without the page re-reading every resource on the
     * status page.
     */
    test("replaces one group's count", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: buildIndex(),
          statusPageGroupId: MARKET_1001.toString(),
          count: 5,
        });

      expect(next.ownCountByGroupId.get(MARKET_1001.toString())).toBe(5);
    });

    test("moves the page wide total by the difference", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: buildIndex(),
          statusPageGroupId: MARKET_1001.toString(),
          count: 5,
        });

      // Was 3 in total with 2 in this group; now 5 in this group.
      expect(next.totalCount).toBe(6);
    });

    test("leaves every other group alone", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: buildIndex(),
          statusPageGroupId: MARKET_1001.toString(),
          count: 0,
        });

      expect(next.ungroupedCount).toBe(1);
    });

    test("a null group id updates the ungrouped bucket", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: buildIndex(),
          statusPageGroupId: null,
          count: 4,
        });

      expect(next.ungroupedCount).toBe(4);
      expect(next.totalCount).toBe(6);
      expect(next.ownCountByGroupId.get(MARKET_1001.toString())).toBe(2);
    });

    test("a group that had no count at all can gain one", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: buildIndex(),
          statusPageGroupId: REGION_2000.toString(),
          count: 3,
        });

      expect(next.ownCountByGroupId.get(REGION_2000.toString())).toBe(3);
      expect(next.totalCount).toBe(6);
    });

    /*
     * Every ordinary refetch reports the number the page already had. Handing
     * back a new object for those would re-render the whole tree on every
     * table refresh.
     */
    test("reporting an unchanged count returns the very same index", () => {
      const index: StatusPageResourceCountIndex = buildIndex();

      expect(
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: index,
          statusPageGroupId: MARKET_1001.toString(),
          count: 2,
        }),
      ).toBe(index);
    });

    test("never lets the page wide total go negative", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: {
            ownCountByGroupId: new Map<string, number>([
              [MARKET_1001.toString(), 50],
            ]),
            ungroupedCount: 0,
            totalCount: 1,
            isComplete: true,
          },
          statusPageGroupId: MARKET_1001.toString(),
          count: 0,
        });

      expect(next.totalCount).toBe(0);
    });

    /*
     * A truncated index has no numbers worth showing, and one group reporting
     * its own does not change that for the other fourteen hundred.
     */
    test("does not turn a truncated index into a complete one", () => {
      const next: StatusPageResourceCountIndex =
        StatusPageResourceEditorTreeUtil.withGroupResourceCount({
          countIndex: StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
            statusPageResources: [makeResource({ id: "r1" })],
            totalCount: 12000,
          }),
          statusPageGroupId: MARKET_1001.toString(),
          count: 3,
        });

      expect(next.isComplete).toBe(false);
    });
  });

  describe("getResourceCountLabel", () => {
    const completeIndex: StatusPageResourceCountIndex =
      StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
        statusPageResources: [],
        totalCount: 0,
      });

    test("pluralises", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getResourceCountLabel({
          count: 1,
          countIndex: completeIndex,
        }),
      ).toBe("1 resource");
      expect(
        StatusPageResourceEditorTreeUtil.getResourceCountLabel({
          count: 12,
          countIndex: completeIndex,
        }),
      ).toBe("12 resources");
    });

    test("says zero when it knows the group is empty", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getResourceCountLabel({
          count: 0,
          countIndex: completeIndex,
        }),
      ).toBe("0 resources");
    });

    /*
     * Silence, not "0 resources": before the counts land, and after they land
     * truncated, the page does not know - and an operator deciding which groups
     * still need monitors would read a guess as an answer.
     */
    test("says nothing while the counts have not arrived", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getResourceCountLabel({
          count: 0,
          countIndex:
            StatusPageResourceEditorTreeUtil.getEmptyResourceCountIndex(),
        }),
      ).toBeNull();
    });

    test("says nothing when the counts came back truncated", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getResourceCountLabel({
          count: 3,
          countIndex: StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
            statusPageResources: [makeResource({ id: "r1" })],
            totalCount: 12000,
          }),
        }),
      ).toBeNull();
    });
  });

  describe("getSubGroupCountLabel", () => {
    test("pluralises", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getSubGroupCountLabel({
          subGroupCount: 1,
        }),
      ).toBe("1 sub group");
      expect(
        StatusPageResourceEditorTreeUtil.getSubGroupCountLabel({
          subGroupCount: 4,
        }),
      ).toBe("4 sub groups");
    });

    test("says nothing for a group with no sub groups", () => {
      expect(
        StatusPageResourceEditorTreeUtil.getSubGroupCountLabel({
          subGroupCount: 0,
        }),
      ).toBeNull();
    });
  });
});
