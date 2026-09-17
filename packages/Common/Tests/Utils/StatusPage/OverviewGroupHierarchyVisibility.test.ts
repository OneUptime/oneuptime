import StatusPageGroupNestingLayoutUtil, {
  StatusPageGroupRollupKind,
} from "../../../Utils/StatusPage/GroupNestingLayout";
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "../../../Utils/StatusPage/GroupTree";
import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { Green } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression suite for the reported failure: an operator built a complete
 * status page hierarchy - Corporate Unit -> Region -> Market -> Site, over
 * fifteen hundred groups, every one of them with its parent set and every one
 * of them visible in the dashboard's Groups list - and the public overview
 * page rendered nothing. It stayed empty until the first monitor was attached
 * to one of the groups.
 *
 * The page was gating its entire resources-and-groups block on there being at
 * least one status page resource, so with no monitors yet there was nothing to
 * pass the gate and the hierarchy never got drawn. The "all clear" empty state
 * underneath it was reading the same count, so the visitor was told the page
 * had nothing on it.
 *
 * These tests drive the decisions the page makes rather than the page itself -
 * the page component lives in the status page frontend, which has no DOM test
 * environment, so the decisions were moved into StatusPageGroupNestingLayoutUtil
 * where they can be pinned down. Each one is exercised at the size the bug was
 * filed at, because "renders three groups" is not the claim that failed.
 */

const CORPORATE_UNITS: number = 6;
const REGIONS_PER_UNIT: number = 5;
const MARKETS_PER_REGION: number = 5;
const SITES_PER_MARKET: number = 10;

interface Hierarchy {
  groups: Array<StatusPageGroup>;
  units: Array<StatusPageGroup>;
  regions: Array<StatusPageGroup>;
  markets: Array<StatusPageGroup>;
  sites: Array<StatusPageGroup>;
}

function makeGroup(data: {
  id: string;
  name: string;
  parentId?: string | undefined;
  order: number;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = new ObjectID(data.id).toString();
  group.name = data.name;
  group.order = data.order;
  group.showCurrentStatus = true;
  group.showUptimePercent = true;
  group.uptimePercentPrecision = UptimePrecision.ONE_DECIMAL;

  if (data.parentId) {
    group.parentStatusPageGroupId = new ObjectID(data.parentId);
  }

  return group;
}

/*
 * The shape from the report: four levels, every group parented, nothing
 * orphaned. Built once per test so a test that mutates a group cannot leak
 * into the next one.
 */
function makeHierarchy(): Hierarchy {
  const groups: Array<StatusPageGroup> = [];
  const units: Array<StatusPageGroup> = [];
  const regions: Array<StatusPageGroup> = [];
  const markets: Array<StatusPageGroup> = [];
  const sites: Array<StatusPageGroup> = [];

  let order: number = 0;

  for (let u: number = 0; u < CORPORATE_UNITS; u++) {
    const unitId: string = `unit-${u}`;
    const unit: StatusPageGroup = makeGroup({
      id: unitId,
      name: `Corporate Unit ${u}`,
      order: order++,
    });
    units.push(unit);
    groups.push(unit);

    for (let r: number = 0; r < REGIONS_PER_UNIT; r++) {
      const regionId: string = `${unitId}-region-${r}`;
      const region: StatusPageGroup = makeGroup({
        id: regionId,
        name: `Region ${u}-${r}`,
        parentId: unitId,
        order: order++,
      });
      regions.push(region);
      groups.push(region);

      for (let m: number = 0; m < MARKETS_PER_REGION; m++) {
        const marketId: string = `${regionId}-market-${m}`;
        const market: StatusPageGroup = makeGroup({
          id: marketId,
          name: `Market ${u}-${r}-${m}`,
          parentId: regionId,
          order: order++,
        });
        markets.push(market);
        groups.push(market);

        for (let s: number = 0; s < SITES_PER_MARKET; s++) {
          const site: StatusPageGroup = makeGroup({
            id: `${marketId}-site-${s}`,
            name: `Site ${u}-${r}-${m}-${s}`,
            parentId: marketId,
            order: order++,
          });
          sites.push(site);
          groups.push(site);
        }
      }
    }
  }

  return { groups, units, regions, markets, sites };
}

function operationalStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = new ObjectID("status-operational").toString();
  status.name = "Operational";
  status.priority = 1;
  status.color = Green;
  return status;
}

/* A monitor attached to a group - what the reporter had to add before anything appeared. */
function attachMonitor(data: {
  group: StatusPageGroup;
  monitorId: string;
  monitorStatusId: string;
}): StatusPageResource {
  const monitor: Monitor = new Monitor();
  monitor._id = new ObjectID(data.monitorId).toString();
  monitor.currentMonitorStatusId = new ObjectID(data.monitorStatusId);

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = new ObjectID(`resource-${data.monitorId}`).toString();
  resource.monitorId = new ObjectID(data.monitorId);
  resource.monitor = monitor;
  resource.statusPageGroupId = new ObjectID(data.group._id!);
  resource.displayName = `Monitor for ${data.group.name}`;
  resource.showUptimePercent = true;
  resource.showCurrentStatus = true;
  resource.uptimePercentPrecision = UptimePrecision.ONE_DECIMAL;

  return resource;
}

function flatten(
  nodes: Array<StatusPageGroupTreeNode>,
): Array<StatusPageGroupTreeNode> {
  return nodes.flatMap((node: StatusPageGroupTreeNode) => {
    return [node, ...flatten(node.children)];
  });
}

/* What the overview page decides, given a payload. */
function overviewDecisions(data: {
  statusPageResources: Array<StatusPageResource>;
  resourceGroups: Array<StatusPageGroup>;
}): { rendersHierarchy: boolean; rendersEmptyState: boolean } {
  return {
    rendersHierarchy:
      StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
        statusPageResourceCount: data.statusPageResources.length,
        statusPageGroupCount: data.resourceGroups.length,
      }),
    rendersEmptyState:
      StatusPageGroupNestingLayoutUtil.shouldRenderOverviewEmptyState({
        statusPageResourceCount: data.statusPageResources.length,
        statusPageGroupCount: data.resourceGroups.length,
        activeIncidentCount: 0,
        activeEpisodeCount: 0,
        activeScheduledMaintenanceCount: 0,
        activeAnnouncementCount: 0,
      }),
  };
}

describe("status page overview, group hierarchy with no monitors yet", () => {
  test("the fixture is the hierarchy from the report", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    expect(hierarchy.groups.length).toBeGreaterThan(1500);
    expect(hierarchy.units).toHaveLength(CORPORATE_UNITS);
    expect(hierarchy.sites).toHaveLength(
      CORPORATE_UNITS *
        REGIONS_PER_UNIT *
        MARKETS_PER_REGION *
        SITES_PER_MARKET,
    );

    // every group below the top has its parent set, which is what the report said.
    for (const group of hierarchy.groups) {
      const isUnit: boolean = hierarchy.units.includes(group);
      expect(Boolean(group.parentStatusPageGroupId)).toBe(!isUnit);
    }
  });

  /* The bug, stated as directly as it can be. */
  test("the hierarchy renders with no status page resources at all", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    expect(
      overviewDecisions({
        statusPageResources: [],
        resourceGroups: hierarchy.groups,
      }),
    ).toEqual({ rendersHierarchy: true, rendersEmptyState: false });
  });

  test("every created group reaches the rendered tree", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    const nodes: Array<StatusPageGroupTreeNode> = flatten(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: hierarchy.groups,
      }),
    );

    expect(nodes).toHaveLength(hierarchy.groups.length);

    const renderedIds: Set<string> = new Set<string>(
      nodes.map((node: StatusPageGroupTreeNode) => {
        return node.group._id!;
      }),
    );

    for (const group of hierarchy.groups) {
      expect(renderedIds.has(group._id!)).toBe(true);
    }
  });

  test("the tree keeps the four levels the operator built", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    const depthById: Map<string, number> = new Map<string, number>();

    for (const node of flatten(
      StatusPageGroupTreeUtil.buildTree({ statusPageGroups: hierarchy.groups }),
    )) {
      depthById.set(node.group._id!, node.depth);
    }

    const depthsOf: (groups: Array<StatusPageGroup>) => Set<number> = (
      groups: Array<StatusPageGroup>,
    ): Set<number> => {
      return new Set<number>(
        groups.map((group: StatusPageGroup) => {
          return depthById.get(group._id!)!;
        }),
      );
    };

    expect(depthsOf(hierarchy.units)).toEqual(new Set([0]));
    expect(depthsOf(hierarchy.regions)).toEqual(new Set([1]));
    expect(depthsOf(hierarchy.markets)).toEqual(new Set([2]));
    expect(depthsOf(hierarchy.sites)).toEqual(new Set([3]));
  });

  /*
   * A group draws something at every level: the levels that hold other groups
   * draw their sub groups, and the leaves draw their (empty) resource list,
   * which is where the "no resources in this group" message belongs. What must
   * not happen is a level that draws nothing at all.
   */
  test("every level of the tree draws something", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    for (const node of flatten(
      StatusPageGroupTreeUtil.buildTree({ statusPageGroups: hierarchy.groups }),
    )) {
      const rendersOwnResources: boolean =
        StatusPageGroupNestingLayoutUtil.shouldRenderOwnResources({
          ownResourceCount: 0,
          subGroupCount: node.children.length,
        });

      expect(rendersOwnResources || node.children.length > 0).toBe(true);
    }
  });

  /*
   * A group with nothing under it must not claim a number it cannot compute.
   * The uptime rollup is what the group header shows, and 0% on an empty group
   * would read as an outage.
   */
  /*
   * The page publishes availability. A hierarchy with no monitors attached to
   * it yet knows nothing about availability, and every group claiming to be
   * Operational would be fifteen hundred false statements.
   */
  test("no group claims to be operational while the page has no monitors", () => {
    const hierarchy: Hierarchy = makeHierarchy();
    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    for (const group of hierarchy.groups) {
      const resourcesInSubtree: Array<StatusPageResource> =
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
          {
            statusPageGroup: group,
            statusPageResources: [],
            allStatusPageGroups: hierarchy.groups,
            statusPageGroupTreeIndex: index,
          },
        );

      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: Boolean(group.showUptimePercent),
          showCurrentStatus: Boolean(group.showCurrentStatus),
          isCurrentlyDown: false,
          uptimePercent: null,
          resourceCountInSubtree: resourcesInSubtree.length,
        }),
      ).toBe(StatusPageGroupRollupKind.None);
    }
  });

  test("an empty group reports no uptime percent rather than zero", () => {
    const hierarchy: Hierarchy = makeHierarchy();
    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    for (const group of [
      hierarchy.units[0]!,
      hierarchy.regions[0]!,
      hierarchy.sites[0]!,
    ]) {
      expect(
        StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
          {
            statusPageGroup: group,
            monitorStatusTimelines: [],
            precision: UptimePrecision.ONE_DECIMAL,
            downtimeMonitorStatuses: [],
            statusPageResources: [],
            monitorsInGroup: {},
            allStatusPageGroups: hierarchy.groups,
            statusPageGroupTreeIndex: index,
          },
        ),
      ).toBeNull();
    }
  });
});

describe("status page overview, once the first monitor is added", () => {
  /*
   * The reporter's workaround. Adding one monitor used to be what made the
   * whole page appear; it must now change nothing about whether the hierarchy
   * is drawn, only what the groups above that monitor report.
   */
  test("the hierarchy still renders, and still holds every group", () => {
    const hierarchy: Hierarchy = makeHierarchy();
    const deepestSite: StatusPageGroup = hierarchy.sites[0]!;

    const resources: Array<StatusPageResource> = [
      attachMonitor({
        group: deepestSite,
        monitorId: "monitor-1",
        monitorStatusId: "status-operational",
      }),
    ];

    expect(
      overviewDecisions({
        statusPageResources: resources,
        resourceGroups: hierarchy.groups,
      }),
    ).toEqual({ rendersHierarchy: true, rendersEmptyState: false });

    expect(
      flatten(
        StatusPageGroupTreeUtil.buildTree({
          statusPageGroups: hierarchy.groups,
        }),
      ),
    ).toHaveLength(hierarchy.groups.length);
  });

  /*
   * The point of nesting: a monitor on a site rolls all the way up to the
   * corporate unit that contains it, and does not leak into a sibling branch.
   */
  test("one monitor rolls up through its own branch only", () => {
    const hierarchy: Hierarchy = makeHierarchy();
    const site: StatusPageGroup = hierarchy.sites[0]!;

    const resource: StatusPageResource = attachMonitor({
      group: site,
      monitorId: "monitor-1",
      monitorStatusId: "status-operational",
    });

    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = new ObjectID("monitor-1");
    timeline.monitorStatusId = new ObjectID("status-operational");
    timeline.startsAt = new Date(Date.UTC(2024, 0, 1));
    timeline.endsAt = new Date(Date.UTC(2024, 0, 8));

    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    const ancestors: Array<StatusPageGroup> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: site,
        statusPageGroups: hierarchy.groups,
        index: index,
      });

    expect(ancestors).toHaveLength(3);

    for (const ancestor of [site, ...ancestors]) {
      expect(
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
          {
            statusPageGroup: ancestor,
            statusPageResources: [resource],
            allStatusPageGroups: hierarchy.groups,
            statusPageGroupTreeIndex: index,
          },
        ),
      ).toEqual([resource]);
    }

    // a sibling branch sees nothing.
    const otherUnit: StatusPageGroup = hierarchy.units[1]!;

    expect(
      StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants({
        statusPageGroup: otherUnit,
        statusPageResources: [resource],
        allStatusPageGroups: hierarchy.groups,
        statusPageGroupTreeIndex: index,
      }),
    ).toEqual([]);
  });

  test("the rolled up status of a branch is the status of the monitor under it", () => {
    const hierarchy: Hierarchy = makeHierarchy();
    const site: StatusPageGroup = hierarchy.sites[0]!;
    const unit: StatusPageGroup = hierarchy.units[0]!;

    const resource: StatusPageResource = attachMonitor({
      group: site,
      monitorId: "monitor-1",
      monitorStatusId: "status-operational",
    });

    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    expect(
      StatusPageResourceUptimeUtil.getCurrentStatusPageGroupStatus({
        statusPageGroup: unit,
        monitorStatusTimelines: [],
        statusPageResources: [resource],
        monitorStatuses: [operationalStatus()],
        monitorGroupCurrentStatuses: {},
        allStatusPageGroups: hierarchy.groups,
        statusPageGroupTreeIndex: index,
      }).name,
    ).toBe("Operational");
  });
});

describe("status page overview, pages that really are empty", () => {
  test("no groups and no resources still shows the empty state", () => {
    expect(
      overviewDecisions({ statusPageResources: [], resourceGroups: [] }),
    ).toEqual({ rendersHierarchy: false, rendersEmptyState: true });
  });

  test("resources with no groups renders the way it always did", () => {
    const resource: StatusPageResource = new StatusPageResource();
    resource._id = new ObjectID("resource-ungrouped").toString();

    expect(
      overviewDecisions({
        statusPageResources: [resource],
        resourceGroups: [],
      }),
    ).toEqual({ rendersHierarchy: true, rendersEmptyState: false });
  });
});

describe("the shared tree index is an optimisation, not a behaviour change", () => {
  test("subtree resources are the same with and without one", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    const resources: Array<StatusPageResource> = [
      attachMonitor({
        group: hierarchy.sites[0]!,
        monitorId: "monitor-1",
        monitorStatusId: "status-operational",
      }),
      attachMonitor({
        group: hierarchy.markets[0]!,
        monitorId: "monitor-2",
        monitorStatusId: "status-operational",
      }),
    ];

    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    for (const group of [
      hierarchy.units[0]!,
      hierarchy.regions[0]!,
      hierarchy.markets[0]!,
      hierarchy.sites[0]!,
      hierarchy.units[1]!,
    ]) {
      expect(
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
          {
            statusPageGroup: group,
            statusPageResources: resources,
            allStatusPageGroups: hierarchy.groups,
            statusPageGroupTreeIndex: index,
          },
        ),
      ).toEqual(
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
          {
            statusPageGroup: group,
            statusPageResources: resources,
            allStatusPageGroups: hierarchy.groups,
          },
        ),
      );
    }
  });

  /*
   * An index describes one list of groups. A caller that supplies one but no
   * group list is asking about a single group in isolation, and answering from
   * the index would pull in a subtree that caller never asked for.
   */
  test("an index is ignored when no group list is supplied", () => {
    const hierarchy: Hierarchy = makeHierarchy();

    const resourceOnSite: StatusPageResource = attachMonitor({
      group: hierarchy.sites[0]!,
      monitorId: "monitor-1",
      monitorStatusId: "status-operational",
    });

    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: hierarchy.groups,
    });

    expect(
      StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants({
        statusPageGroup: hierarchy.units[0]!,
        statusPageResources: [resourceOnSite],
        statusPageGroupTreeIndex: index,
      }),
    ).toEqual([]);
  });
});
