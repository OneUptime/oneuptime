import StatusPageReportTreeUtil, {
  StatusPageReportResourceEntry,
  StatusPageReportStructure,
} from "../../../Utils/StatusPage/Report";
import ObjectID from "../../../Types/ObjectID";
import Dictionary from "../../../Types/Dictionary";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import {
  StatusPageReportGroup,
  StatusPageReportGroupMetrics,
  StatusPageReportItem,
  StatusPageReportRow,
} from "../../../Types/StatusPage/StatusPageReport";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the emailed uptime report has to carry the same group
 * hierarchy the live status page renders.
 *
 * Recipients of the report (vendors, leadership, external stakeholders) usually
 * have no OneUptime login, so the email is the whole product for them. A flat
 * list of monitor names is unusable for anyone running several regions or
 * units: it says nothing about which unit a monitor belongs to, and it drops
 * the rolled up availability every level of the page shows.
 *
 * So this pins:
 *   - render order matches the page: ungrouped resources first, then each group
 *     followed by its own resources and then its sub groups,
 *   - depth / indent survive any nesting level,
 *   - every resource row carries the group and full group path it sits under,
 *   - a group's totalResources covers its whole subtree,
 *   - and no shape of bad data (a resource pointing at a group that is not on
 *     the page, a group in a cycle, a group with no metrics) may silently drop
 *     a row from the report.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MARKET_ONE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const UNIT_0660: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const REGION_TWO: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const NOT_ON_PAGE: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

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

function makeEntry(data: {
  resourceName: string;
  groupId?: ObjectID | undefined;
  uptimePercent?: number | undefined;
  downtimeInHoursAndMinutes?: string | undefined;
  totalIncidentCount?: number | undefined;
}): StatusPageReportResourceEntry {
  const resource: StatusPageResource = new StatusPageResource();
  resource.displayName = data.resourceName;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  const uptimePercent: number =
    data.uptimePercent === undefined ? 100 : data.uptimePercent;

  return {
    statusPageResource: resource,
    reportItem: {
      resourceName: data.resourceName,
      totalIncidentCount: data.totalIncidentCount || 0,
      uptimePercent: uptimePercent,
      uptimePercentAsString: `${uptimePercent}%`,
      downtimeInHoursAndMinutes: data.downtimeInHoursAndMinutes || "0",
    },
  };
}

function makeMetrics(data: {
  uptimePercent: number;
  downtimeInHoursAndMinutes?: string | undefined;
  totalIncidentCount?: number | undefined;
}): StatusPageReportGroupMetrics {
  return {
    uptimePercent: data.uptimePercent,
    uptimePercentAsString: `${data.uptimePercent}%`,
    downtimeInHoursAndMinutes: data.downtimeInHoursAndMinutes || "0",
    totalIncidentCount: data.totalIncidentCount || 0,
  };
}

/*
 * The hierarchy from the bug report:
 *
 *   Corporate Unit's
 *     Region 001
 *       Market 001
 *         Unit 0660
 *           Router
 *           Switch 01
 *   (ungrouped) WBHQ website
 */
function makeNestedGroups(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate Unit's", order: 1 }),
    makeGroup({
      id: REGION_ONE,
      name: "Region 001",
      parentId: CORPORATE,
      order: 1,
    }),
    makeGroup({
      id: MARKET_ONE,
      name: "Market 001",
      parentId: REGION_ONE,
      order: 1,
    }),
    makeGroup({
      id: UNIT_0660,
      name: "Unit 0660",
      parentId: MARKET_ONE,
      order: 1,
    }),
  ];
}

function makeNestedEntries(): Array<StatusPageReportResourceEntry> {
  return [
    makeEntry({ resourceName: "Router", groupId: UNIT_0660 }),
    makeEntry({ resourceName: "WBHQ website" }),
    makeEntry({ resourceName: "Switch 01", groupId: UNIT_0660 }),
  ];
}

function rowNames(rows: Array<StatusPageReportRow>): Array<string> {
  return rows.map((row: StatusPageReportRow) => {
    return row.name;
  });
}

describe("StatusPageReportTreeUtil", () => {
  describe("a status page with no groups", () => {
    test("reports every resource flat, with no group rows", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({ resourceName: "Router" }),
            makeEntry({ resourceName: "WBHQ website" }),
          ],
          statusPageGroups: [],
          groupMetricsByGroupId: {},
        });

      expect(structure.groups).toEqual([]);
      expect(rowNames(structure.rows)).toEqual(["Router", "WBHQ website"]);
      expect(
        structure.rows.every((row: StatusPageReportRow) => {
          return row.isGroup === false && row.depth === 0;
        }),
      ).toBe(true);
      expect(structure.resourcesWithoutGroup).toHaveLength(2);
    });

    test("leaves groupName and groupPath empty on every resource", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [makeEntry({ resourceName: "Router" })],
          statusPageGroups: [],
          groupMetricsByGroupId: {},
        });

      expect(structure.resources[0]!.groupName).toBe("");
      expect(structure.resources[0]!.groupPath).toBe("");
    });
  });

  describe("the nested hierarchy from the bug report", () => {
    test("renders ungrouped resources first, then the group tree top down", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual([
        "WBHQ website",
        "Corporate Unit's",
        "Region 001",
        "Market 001",
        "Unit 0660",
        "Router",
        "Switch 01",
      ]);
    });

    test("marks group rows as groups and resource rows as resources", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const isGroupByName: Dictionary<boolean> = {};

      for (const row of structure.rows) {
        isGroupByName[row.name] = row.isGroup;
      }

      expect(isGroupByName["Corporate Unit's"]).toBe(true);
      expect(isGroupByName["Unit 0660"]).toBe(true);
      expect(isGroupByName["Router"]).toBe(false);
      expect(isGroupByName["WBHQ website"]).toBe(false);
    });

    test("nests four levels deep without losing a level", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const depthByName: Dictionary<number> = {};

      for (const row of structure.rows) {
        depthByName[row.name] = row.depth;
      }

      expect(depthByName["WBHQ website"]).toBe(0);
      expect(depthByName["Corporate Unit's"]).toBe(0);
      expect(depthByName["Region 001"]).toBe(1);
      expect(depthByName["Market 001"]).toBe(2);
      expect(depthByName["Unit 0660"]).toBe(3);
      // resources sit one level below the group they are attached to.
      expect(depthByName["Router"]).toBe(4);
      expect(depthByName["Switch 01"]).toBe(4);
    });

    test("indents each level by a fixed step so a template needs no arithmetic", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      for (const row of structure.rows) {
        expect(row.indentInPixels).toBe(
          row.depth * StatusPageReportTreeUtil.IndentInPixelsPerDepth,
        );
      }
    });

    test("tells each resource which group it belongs to, and the full path to it", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const router: StatusPageReportItem = structure.resources.find(
        (resource: StatusPageReportItem) => {
          return resource.resourceName === "Router";
        },
      )!;

      expect(router.groupName).toBe("Unit 0660");
      expect(router.groupPath).toBe(
        "Corporate Unit's / Region 001 / Market 001 / Unit 0660",
      );

      const website: StatusPageReportItem = structure.resources.find(
        (resource: StatusPageReportItem) => {
          return resource.resourceName === "WBHQ website";
        },
      )!;

      expect(website.groupName).toBe("");
      expect(website.groupPath).toBe("");
    });

    test("keeps the flat resource list, in the order the resources were supplied", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      /*
       * Templates written before groups existed loop over report.resources, so
       * this list stays flat and in page order.
       */
      expect(
        structure.resources.map((resource: StatusPageReportItem) => {
          return resource.resourceName;
        }),
      ).toEqual(["Router", "WBHQ website", "Switch 01"]);
    });

    test("rolls the resource count up through every level of the subtree", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const corporate: StatusPageReportGroup = structure.groups[0]!;
      const region: StatusPageReportGroup = corporate.subGroups[0]!;
      const market: StatusPageReportGroup = region.subGroups[0]!;
      const unit: StatusPageReportGroup = market.subGroups[0]!;

      expect(corporate.totalResources).toBe(2);
      expect(region.totalResources).toBe(2);
      expect(market.totalResources).toBe(2);
      expect(unit.totalResources).toBe(2);

      // only the unit holds the resources directly.
      expect(corporate.resources).toEqual([]);
      expect(
        unit.resources.map((resource: StatusPageReportItem) => {
          return resource.resourceName;
        }),
      ).toEqual(["Router", "Switch 01"]);
    });

    test("gives every group its own path", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const corporate: StatusPageReportGroup = structure.groups[0]!;

      expect(corporate.groupPath).toBe("Corporate Unit's");
      expect(corporate.subGroups[0]!.groupPath).toBe(
        "Corporate Unit's / Region 001",
      );
      expect(corporate.subGroups[0]!.subGroups[0]!.groupPath).toBe(
        "Corporate Unit's / Region 001 / Market 001",
      );
    });
  });

  describe("rolled up numbers on group rows", () => {
    test("uses the metrics supplied for each group", () => {
      const groupMetricsByGroupId: Dictionary<StatusPageReportGroupMetrics> = {
        [CORPORATE.toString()]: makeMetrics({
          uptimePercent: 99.1,
          downtimeInHoursAndMinutes: "3 hours",
          totalIncidentCount: 4,
        }),
        [UNIT_0660.toString()]: makeMetrics({
          uptimePercent: 98.5,
          downtimeInHoursAndMinutes: "5 hours",
          totalIncidentCount: 2,
        }),
      };

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: groupMetricsByGroupId,
        });

      const corporate: StatusPageReportGroup = structure.groups[0]!;

      expect(corporate.uptimePercentAsString).toBe("99.1%");
      expect(corporate.downtimeInHoursAndMinutes).toBe("3 hours");
      expect(corporate.totalIncidentCount).toBe(4);

      const unitRow: StatusPageReportRow = structure.rows.find(
        (row: StatusPageReportRow) => {
          return row.name === "Unit 0660";
        },
      )!;

      expect(unitRow.uptimePercentAsString).toBe("98.5%");
      expect(unitRow.downtimeInHoursAndMinutes).toBe("5 hours");
      expect(unitRow.totalIncidentCount).toBe(2);
      expect(unitRow.totalResources).toBe(2);
    });

    test("still renders a group whose metrics are missing, as zeroes", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: makeNestedEntries(),
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const corporate: StatusPageReportGroup = structure.groups[0]!;

      expect(corporate.uptimePercent).toBe(0);
      expect(corporate.uptimePercentAsString).toBe("0%");
      expect(corporate.downtimeInHoursAndMinutes).toBe("0");
      expect(corporate.totalIncidentCount).toBe(0);
      // the level is still on the report - a missing number beats a missing level.
      expect(rowNames(structure.rows)).toContain("Corporate Unit's");
    });

    test("carries the resource's own numbers onto its row", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({
              resourceName: "Router",
              groupId: UNIT_0660,
              uptimePercent: 97.25,
              downtimeInHoursAndMinutes: "9 hours 30 minutes",
              totalIncidentCount: 3,
            }),
          ],
          statusPageGroups: makeNestedGroups(),
          groupMetricsByGroupId: {},
        });

      const routerRow: StatusPageReportRow = structure.rows.find(
        (row: StatusPageReportRow) => {
          return row.name === "Router";
        },
      )!;

      expect(routerRow.uptimePercentAsString).toBe("97.25%");
      expect(routerRow.downtimeInHoursAndMinutes).toBe("9 hours 30 minutes");
      expect(routerRow.totalIncidentCount).toBe(3);
      // totalResources is a group concept only.
      expect(routerRow.totalResources).toBe(0);
    });
  });

  describe("sibling ordering", () => {
    test("renders sibling groups in their configured order", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: REGION_TWO, name: "Region 002", order: 2 }),
        makeGroup({ id: CORPORATE, name: "Region 001", order: 1 }),
      ];

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [],
          statusPageGroups: groups,
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual(["Region 001", "Region 002"]);
    });

    test("keeps a group's own resources in the order they were supplied", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({ resourceName: "Switch 01", groupId: CORPORATE }),
            makeEntry({ resourceName: "Router", groupId: CORPORATE }),
          ],
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
          ],
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual([
        "Corporate Unit's",
        "Switch 01",
        "Router",
      ]);
    });

    test("puts a group's own resources above its sub groups", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 001",
          parentId: CORPORATE,
        }),
      ];

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({
              resourceName: "Region 001 router",
              groupId: REGION_ONE,
            }),
            makeEntry({ resourceName: "Head office link", groupId: CORPORATE }),
          ],
          statusPageGroups: groups,
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual([
        "Corporate Unit's",
        "Head office link",
        "Region 001",
        "Region 001 router",
      ]);
    });
  });

  describe("groups without resources", () => {
    test("keeps an empty group on the report", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [],
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
          ],
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual(["Corporate Unit's"]);
      expect(structure.groups[0]!.totalResources).toBe(0);
      expect(structure.groups[0]!.resources).toEqual([]);
    });
  });

  describe("data that does not fit the tree", () => {
    test("renders a resource pointing at a group that is not on the page as ungrouped", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({ resourceName: "Orphan", groupId: NOT_ON_PAGE }),
            makeEntry({ resourceName: "Router", groupId: CORPORATE }),
          ],
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
          ],
          groupMetricsByGroupId: {},
        });

      // ungrouped resources render first, so the orphan is visible, not dropped.
      expect(rowNames(structure.rows)).toEqual([
        "Orphan",
        "Corporate Unit's",
        "Router",
      ]);
      expect(structure.resourcesWithoutGroup).toHaveLength(1);
      expect(structure.resources).toHaveLength(2);
      expect(structure.resources[0]!.groupName).toBe("");
    });

    test("treats a group that is its own parent as a top level group", () => {
      const selfParented: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate Unit's",
        parentId: CORPORATE,
      });

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [makeEntry({ resourceName: "Router", groupId: CORPORATE })],
          statusPageGroups: [selfParented],
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual(["Corporate Unit's", "Router"]);
      expect(structure.groups[0]!.depth).toBe(0);
      expect(structure.groups[0]!.groupPath).toBe("Corporate Unit's");
    });

    test("promotes a group whose parent is missing rather than hiding it", () => {
      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [makeEntry({ resourceName: "Router", groupId: REGION_ONE })],
          statusPageGroups: [
            makeGroup({
              id: REGION_ONE,
              name: "Region 001",
              parentId: NOT_ON_PAGE,
            }),
          ],
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toEqual(["Region 001", "Router"]);
      expect(structure.groups[0]!.depth).toBe(0);
      // the missing ancestor is simply not part of the path.
      expect(structure.resources[0]!.groupPath).toBe("Region 001");
    });

    test("still reports every group in a parent cycle, and terminates", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: REGION_ONE, name: "Region 001", parentId: MARKET_ONE }),
        makeGroup({ id: MARKET_ONE, name: "Market 001", parentId: REGION_ONE }),
      ];

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [
            makeEntry({ resourceName: "Router", groupId: REGION_ONE }),
            makeEntry({ resourceName: "Switch 01", groupId: MARKET_ONE }),
          ],
          statusPageGroups: groups,
          groupMetricsByGroupId: {},
        });

      expect(rowNames(structure.rows)).toContain("Region 001");
      expect(rowNames(structure.rows)).toContain("Market 001");
      expect(rowNames(structure.rows)).toContain("Router");
      expect(rowNames(structure.rows)).toContain("Switch 01");
    });

    test("tolerates a group with no name", () => {
      const unnamed: StatusPageGroup = new StatusPageGroup();
      unnamed._id = CORPORATE.toString();

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [makeEntry({ resourceName: "Router", groupId: CORPORATE })],
          statusPageGroups: [unnamed],
          groupMetricsByGroupId: {},
        });

      expect(structure.groups[0]!.groupName).toBe("");
      expect(rowNames(structure.rows)).toEqual(["", "Router"]);
    });

    test("ignores a group row that has no id", () => {
      const withoutId: StatusPageGroup = new StatusPageGroup();
      withoutId.name = "Ghost";

      const structure: StatusPageReportStructure =
        StatusPageReportTreeUtil.build({
          entries: [makeEntry({ resourceName: "Router" })],
          statusPageGroups: [withoutId],
          groupMetricsByGroupId: {},
        });

      // it cannot own resources, and the resource is still reported.
      expect(rowNames(structure.rows)).toContain("Router");
    });
  });

  describe("getPathByGroupId", () => {
    test("builds a top down path for every group", () => {
      const pathByGroupId: Dictionary<string> =
        StatusPageReportTreeUtil.getPathByGroupId({
          statusPageGroups: makeNestedGroups(),
        });

      expect(pathByGroupId[CORPORATE.toString()]).toBe("Corporate Unit's");
      expect(pathByGroupId[UNIT_0660.toString()]).toBe(
        "Corporate Unit's / Region 001 / Market 001 / Unit 0660",
      );
    });

    test("skips unnamed groups in the middle of a path", () => {
      const unnamedRegion: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "",
        parentId: CORPORATE,
      });

      const pathByGroupId: Dictionary<string> =
        StatusPageReportTreeUtil.getPathByGroupId({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
            unnamedRegion,
            makeGroup({
              id: MARKET_ONE,
              name: "Market 001",
              parentId: REGION_ONE,
            }),
          ],
        });

      expect(pathByGroupId[MARKET_ONE.toString()]).toBe(
        "Corporate Unit's / Market 001",
      );
    });
  });
});
