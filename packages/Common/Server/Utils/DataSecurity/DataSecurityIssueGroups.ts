import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupFixStateJSON,
  DataSecurityIssueGroupJSON,
  DataSecurityIssueGroupsJSON,
  isDataSecurityIssueGroupCause,
  readDataSecurityIssueGroupFacts,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AIService from "../../Services/AIService";
import DataSecurityIssueGroupService from "../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSecurityIssueGroupFix from "./DataSecurityIssueGroupFix";

/*
 * THE GROUPS OF ISSUES ONE MISTAKE MADE, AS A READER SEES THEM (#10370):
 * what the Issues list's Group by cause draws.
 *
 * A group's name and facts come from many stores' tags and names - the
 * module, the stack, the identity, the pattern - so a group is answered
 * only to a reader of Data Security issues across the whole project. A
 * reader whose read is held to some labels sees no group, and every issue
 * they may read stays in the flat list, as before: a group would tell them
 * of stores they may not read.
 *
 * Each group says how many issues it holds, how many are open and how many
 * are fixed (their check passed, or a person marked them resolved), read
 * now; OneUptime AI's name for it while the project's AI is on (else its
 * cause's own words, which the Dashboard writes); and where its pull
 * request stands, as Code says it for this reader.
 */

// Who may read groups: who reads Data Security issues (DataSecurityIssue's read list).
export const ISSUE_GROUP_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  ...new DataSecurityIssue().readRecordPermissions,
];

// How long a group whose issues are all fixed stays in the list.
export const FIXED_GROUP_SHOWN_FOR_IN_DAYS: number = 7;

// The most groups one read answers.
export const MAX_GROUPS_LISTED: number = 200;

// The most of the listed groups' issues read to count them.
const MAX_ISSUES_COUNTED: number = 20000;

const ROOT: { isRoot: true } = { isRoot: true };

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

export default class DataSecurityIssueGroups {
  // Whether the reader may read groups: issues, across the whole project.
  public static canRead(props: DatabaseCommonInteractionProps): boolean {
    return (
      Boolean(props.isRoot) ||
      Boolean(props.isMasterAdmin) ||
      CallerPermission.holdsAnyOf(props, ISSUE_GROUP_READ_PERMISSIONS, {
        projectWideOnly: true,
        labelledBlocksRefuse: true,
      })
    );
  }

  /*
   * The project's groups with open issues, and those fixed in the last
   * FIXED_GROUP_SHOWN_FOR_IN_DAYS days - or, with `groupIds`, those groups
   * whatever they hold. The most issues first.
   */
  @CaptureSpan()
  public static async list(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    groupIds?: unknown;
    now?: Date | undefined;
  }): Promise<DataSecurityIssueGroupsJSON> {
    if (!DataSecurityIssueGroups.canRead(data.props)) {
      return { groups: [], largestGroupSize: 0 };
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const asked: Array<string> = (
      Array.isArray(data.groupIds) ? (data.groupIds as Array<unknown>) : []
    )
      .filter((id: unknown): id is string => {
        return typeof id === "string" && ObjectID.isValidUUID(id);
      })
      .slice(0, MAX_GROUPS_LISTED);
    const select: {
      _id: true;
      checkId: true;
      cause: true;
      facts: true;
      name: true;
      issueCount: true;
      openIssueCount: true;
      fixedAt: true;
      codeTaskId: true;
    } = {
      _id: true,
      checkId: true,
      cause: true,
      facts: true,
      name: true,
      issueCount: true,
      openIssueCount: true,
      fixedAt: true,
      codeTaskId: true,
    };
    const groups: Array<DataSecurityIssueGroup> =
      asked.length > 0
        ? await DataSecurityIssueGroupService.findBy({
            query: { projectId: data.projectId, _id: QueryHelper.any(asked) },
            select,
            skip: 0,
            limit: asked.length,
            props: ROOT,
          })
        : [
            ...(await DataSecurityIssueGroupService.findBy({
              query: {
                projectId: data.projectId,
                openIssueCount: QueryHelper.greaterThan(0),
              },
              select,
              skip: 0,
              limit: MAX_GROUPS_LISTED,
              props: ROOT,
            })),
            ...(await DataSecurityIssueGroupService.findBy({
              query: {
                projectId: data.projectId,
                openIssueCount: 0,
                fixedAt: QueryHelper.greaterThanEqualTo(
                  OneUptimeDate.addRemoveDays(
                    now,
                    -FIXED_GROUP_SHOWN_FOR_IN_DAYS,
                  ),
                ),
              },
              select,
              skip: 0,
              limit: MAX_GROUPS_LISTED,
              props: ROOT,
            })),
          ];

    if (groups.length === 0) {
      return { groups: [], largestGroupSize: 0 };
    }

    const counts: Map<string, { all: number; open: number; fixed: number }> =
      await DataSecurityIssueGroups.count(
        data.projectId,
        groups.map((group: DataSecurityIssueGroup): string => {
          return idOf(group);
        }),
      );
    const isAiOn: boolean = await AIService.isProjectAIEnabled(data.projectId);
    const listed: Array<DataSecurityIssueGroupJSON> = [];

    for (const group of groups) {
      const facts: DataSecurityIssueGroupFacts | null =
        readDataSecurityIssueGroupFacts(group.facts);
      const count: { all: number; open: number; fixed: number } = counts.get(
        idOf(group),
      ) || { all: 0, open: 0, fixed: 0 };

      if (!facts || count.all === 0) {
        continue;
      }

      const fix: DataSecurityIssueGroupFixStateJSON | null = group.codeTaskId
        ? await DataSecurityIssueGroupFix.readFixState({
            projectId: data.projectId,
            taskId: group.codeTaskId,
            props: data.props,
          })
        : null;

      listed.push({
        groupId: idOf(group),
        checkId: group.checkId || facts.checkId,
        cause: isDataSecurityIssueGroupCause(group.cause)
          ? group.cause
          : (facts.cause as DataSecurityIssueGroupCause),
        facts,
        ...(isAiOn && group.name ? { name: group.name } : {}),
        issueCount: count.all,
        openIssueCount: count.open,
        fixedIssueCount: count.fixed,
        ...(fix ? { fix } : {}),
      });
    }

    listed.sort(
      (
        left: DataSecurityIssueGroupJSON,
        right: DataSecurityIssueGroupJSON,
      ): number => {
        return (
          right.openIssueCount - left.openIssueCount ||
          right.issueCount - left.issueCount ||
          left.groupId.localeCompare(right.groupId)
        );
      },
    );

    return {
      groups: listed,
      largestGroupSize: listed.reduce(
        (largest: number, group: DataSecurityIssueGroupJSON): number => {
          return group.openIssueCount > 0
            ? Math.max(largest, group.issueCount)
            : largest;
        },
        0,
      ),
    };
  }

  /*
   * The group an issue is one of, for the reader: what its analysis points
   * at (#10370). None for an issue the reader may not read, one in no
   * group, or a reader who reads no groups.
   */
  @CaptureSpan()
  public static async forIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupJSON | null> {
    if (!DataSecurityIssueGroups.canRead(data.props)) {
      return null;
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true, dataSecurityIssueGroupId: true },
        props: data.props,
      });
    const groupId: string = issue?.dataSecurityIssueGroupId?.toString() || "";

    if (!groupId) {
      return null;
    }

    const listed: DataSecurityIssueGroupsJSON =
      await DataSecurityIssueGroups.list({
        projectId: data.projectId,
        props: data.props,
        groupIds: [groupId],
      });

    return listed.groups[0] || null;
  }

  // How many issues each group holds, how many are open, how many are fixed - read now.
  private static async count(
    projectId: ObjectID,
    groupIds: Array<string>,
  ): Promise<Map<string, { all: number; open: number; fixed: number }>> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId,
          dataSecurityIssueGroupId: QueryHelper.any(groupIds),
        },
        select: { _id: true, status: true, dataSecurityIssueGroupId: true },
        skip: 0,
        limit: MAX_ISSUES_COUNTED,
        props: ROOT,
      });
    const counts: Map<string, { all: number; open: number; fixed: number }> =
      new Map();

    for (const issue of issues) {
      const groupId: string =
        issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "";
      const count: { all: number; open: number; fixed: number } = counts.get(
        groupId,
      ) || { all: 0, open: 0, fixed: 0 };

      count.all++;

      if (issue.status === DataSecurityIssueStatus.Open) {
        count.open++;
      } else if (issue.status === DataSecurityIssueStatus.Resolved) {
        count.fixed++;
      }

      counts.set(groupId, count);
    }

    return counts;
  }
}
