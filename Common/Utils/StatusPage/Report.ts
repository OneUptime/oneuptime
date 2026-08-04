import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";
import {
  StatusPageReportGroup,
  StatusPageReportGroupMetrics,
  StatusPageReportItem,
  StatusPageReportRow,
} from "../../Types/StatusPage/StatusPageReport";
import StatusPageGroupTreeUtil, { StatusPageGroupTreeNode } from "./GroupTree";

/*
 * One resource on the status page paired with the numbers already computed for
 * it. Kept as a pair (rather than keyed by id) because the report is built from
 * the same array the resources were fetched in, and a resource row is not
 * guaranteed to have been selected with its `_id`.
 */
export interface StatusPageReportResourceEntry {
  statusPageResource: StatusPageResource;
  reportItem: Omit<StatusPageReportItem, "groupName" | "groupPath">;
}

export interface StatusPageReportStructure {
  // Every resource, flat, in the order it was supplied.
  resources: Array<StatusPageReportItem>;
  // The group tree, top level groups first.
  groups: Array<StatusPageReportGroup>;
  resourcesWithoutGroup: Array<StatusPageReportItem>;
  // The tree flattened into render order.
  rows: Array<StatusPageReportRow>;
}

/*
 * Turns the flat per-resource numbers of an uptime report into the same nested
 * shape the live status page renders: ungrouped resources first, then each top
 * level group with its own resources and then its sub groups, at any depth.
 *
 * Deliberately pure and synchronous. Anything that needs the database (rolled up
 * incident counts, downtime over a group's monitors) is computed by the caller
 * and handed in through `groupMetricsByGroupId`, which keeps the tree walk here
 * testable on its own and keeps the number of queries in the caller's hands.
 */
export default class StatusPageReportTreeUtil {
  // How far one level of nesting indents a row in the emailed report.
  public static readonly IndentInPixelsPerDepth: number = 16;

  public static readonly GroupPathSeparator: string = " / ";

  public static build(data: {
    entries: Array<StatusPageReportResourceEntry>;
    statusPageGroups: Array<StatusPageGroup>;
    /*
     * Rolled up numbers per group id, covering the group and every group nested
     * under it. A group with no entry here reports zeroes rather than
     * disappearing - a level missing from the report is worse than a level with
     * an empty number.
     */
    groupMetricsByGroupId: Dictionary<StatusPageReportGroupMetrics>;
  }): StatusPageReportStructure {
    const groupsById: Dictionary<StatusPageGroup> = {};

    for (const group of data.statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (groupId) {
        groupsById[groupId] = group;
      }
    }

    const pathByGroupId: Dictionary<string> = this.getPathByGroupId({
      statusPageGroups: data.statusPageGroups,
    });

    const resources: Array<StatusPageReportItem> = data.entries.map(
      (entry: StatusPageReportResourceEntry) => {
        const groupId: string | undefined =
          entry.statusPageResource.statusPageGroupId?.toString();

        const group: StatusPageGroup | undefined = groupId
          ? groupsById[groupId]
          : undefined;

        return {
          ...entry.reportItem,
          groupName: group?.name || "",
          groupPath: (groupId && pathByGroupId[groupId]) || "",
        };
      },
    );

    /*
     * Resources are keyed back to their group by index, so this has to stay in
     * step with `data.entries` above.
     */
    const resourcesByGroupId: Dictionary<Array<StatusPageReportItem>> = {};
    const resourcesWithoutGroup: Array<StatusPageReportItem> = [];

    data.entries.forEach(
      (entry: StatusPageReportResourceEntry, index: number) => {
        const reportItem: StatusPageReportItem = resources[index]!;

        const groupId: string | undefined =
          entry.statusPageResource.statusPageGroupId?.toString();

        /*
         * A resource pointing at a group that is not on this page has nowhere to
         * nest, so it renders at the top like any other ungrouped resource
         * instead of falling out of the report.
         */
        if (!groupId || !groupsById[groupId]) {
          resourcesWithoutGroup.push(reportItem);
          return;
        }

        resourcesByGroupId[groupId] = resourcesByGroupId[groupId] || [];
        resourcesByGroupId[groupId]!.push(reportItem);
      },
    );

    /*
     * buildTree rather than getRootGroups: a parent pointer written straight to
     * the database can put a group in a cycle, and a cycle has no root. buildTree
     * promotes those groups to the top level so they still appear.
     */
    const tree: Array<StatusPageGroupTreeNode> =
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
      });

    const groups: Array<StatusPageReportGroup> = tree.map(
      (node: StatusPageGroupTreeNode) => {
        return this.buildGroup({
          node: node,
          resourcesByGroupId: resourcesByGroupId,
          groupMetricsByGroupId: data.groupMetricsByGroupId,
          pathByGroupId: pathByGroupId,
        });
      },
    );

    return {
      resources: resources,
      groups: groups,
      resourcesWithoutGroup: resourcesWithoutGroup,
      rows: this.getRows({
        groups: groups,
        resourcesWithoutGroup: resourcesWithoutGroup,
      }),
    };
  }

  /*
   * "Region 001 / Market 001 / Unit 0660" for every group, so a resource row can
   * say where it sits without the reader having to reconstruct the tree.
   */
  public static getPathByGroupId(data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): Dictionary<string> {
    const pathByGroupId: Dictionary<string> = {};

    for (const group of data.statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (!groupId) {
        continue;
      }

      const ancestors: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getAncestorGroups({
          statusPageGroup: group,
          statusPageGroups: data.statusPageGroups,
        });

      const names: Array<string> = [...ancestors]
        .reverse()
        .concat([group])
        .map((groupInPath: StatusPageGroup) => {
          return groupInPath.name || "";
        })
        .filter((name: string) => {
          return Boolean(name);
        });

      pathByGroupId[groupId] = names.join(this.GroupPathSeparator);
    }

    return pathByGroupId;
  }

  private static buildGroup(data: {
    node: StatusPageGroupTreeNode;
    resourcesByGroupId: Dictionary<Array<StatusPageReportItem>>;
    groupMetricsByGroupId: Dictionary<StatusPageReportGroupMetrics>;
    pathByGroupId: Dictionary<string>;
  }): StatusPageReportGroup {
    const groupId: string = data.node.group._id?.toString() || "";

    const subGroups: Array<StatusPageReportGroup> = data.node.children.map(
      (child: StatusPageGroupTreeNode) => {
        return this.buildGroup({
          node: child,
          resourcesByGroupId: data.resourcesByGroupId,
          groupMetricsByGroupId: data.groupMetricsByGroupId,
          pathByGroupId: data.pathByGroupId,
        });
      },
    );

    const ownResources: Array<StatusPageReportItem> =
      data.resourcesByGroupId[groupId] || [];

    const metrics: StatusPageReportGroupMetrics = data.groupMetricsByGroupId[
      groupId
    ] || {
      uptimePercent: 0,
      uptimePercentAsString: "0%",
      downtimeInHoursAndMinutes: "0",
      totalIncidentCount: 0,
    };

    const totalResources: number = subGroups.reduce(
      (count: number, subGroup: StatusPageReportGroup) => {
        return count + subGroup.totalResources;
      },
      ownResources.length,
    );

    return {
      groupName: data.node.group.name || "",
      groupPath: data.pathByGroupId[groupId] || data.node.group.name || "",
      depth: data.node.depth,
      totalResources: totalResources,
      resources: ownResources,
      subGroups: subGroups,
      uptimePercent: metrics.uptimePercent,
      uptimePercentAsString: metrics.uptimePercentAsString,
      downtimeInHoursAndMinutes: metrics.downtimeInHoursAndMinutes,
      totalIncidentCount: metrics.totalIncidentCount,
    };
  }

  /*
   * Render order, matching the live page: resources with no group first, then
   * each group followed by its own resources and then its sub groups.
   */
  public static getRows(data: {
    groups: Array<StatusPageReportGroup>;
    resourcesWithoutGroup: Array<StatusPageReportItem>;
  }): Array<StatusPageReportRow> {
    const rows: Array<StatusPageReportRow> = [];

    for (const resource of data.resourcesWithoutGroup) {
      rows.push(this.toResourceRow({ resource: resource, depth: 0 }));
    }

    const walk: (groups: Array<StatusPageReportGroup>) => void = (
      groups: Array<StatusPageReportGroup>,
    ): void => {
      for (const group of groups) {
        rows.push({
          isGroup: true,
          name: group.groupName,
          depth: group.depth,
          indentInPixels: group.depth * this.IndentInPixelsPerDepth,
          uptimePercentAsString: group.uptimePercentAsString,
          downtimeInHoursAndMinutes: group.downtimeInHoursAndMinutes,
          totalIncidentCount: group.totalIncidentCount,
          totalResources: group.totalResources,
        });

        for (const resource of group.resources) {
          rows.push(
            this.toResourceRow({
              resource: resource,
              depth: group.depth + 1,
            }),
          );
        }

        walk(group.subGroups);
      }
    };

    walk(data.groups);

    return rows;
  }

  private static toResourceRow(data: {
    resource: StatusPageReportItem;
    depth: number;
  }): StatusPageReportRow {
    return {
      isGroup: false,
      name: data.resource.resourceName,
      depth: data.depth,
      indentInPixels: data.depth * this.IndentInPixelsPerDepth,
      uptimePercentAsString: data.resource.uptimePercentAsString,
      downtimeInHoursAndMinutes: data.resource.downtimeInHoursAndMinutes,
      totalIncidentCount: data.resource.totalIncidentCount,
      totalResources: 0,
    };
  }
}
