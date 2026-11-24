import AIRun from "../../../Models/DatabaseModels/AIRun";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { readCloudTags } from "../../../Types/Cloud/CloudInventory";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupFixStateJSON,
  DataSecurityIssueGroupJSON,
  DataSecurityIssueGroupStore,
  DataSecurityIssueGroupsJSON,
  MIN_ISSUES_PER_GROUP,
  getIssueGroupFactsOfStores,
  isDataSecurityIssueGroupCause,
  readDataSecurityIssueGroupFacts,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AIService from "../../Services/AIService";
import DataSecurityIssueGroupService from "../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSecurityFixTarget from "../AI/CodeFix/DataSecurityFixTarget";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSecurityIssueGroupFix from "./DataSecurityIssueGroupFix";

/*
 * THE GROUPS OF ISSUES ONE MISTAKE MADE, AS A READER SEES THEM (#10370):
 * what the Issues list's Group by cause draws, an issue's analysis points
 * at, and Ask AI reads.
 *
 * A group's name and facts come from many stores' tags and names - the
 * module, the stack, the identity, the pattern - so each reader is answered
 * the group of the stores they may read (#10739):
 *
 *   - a reader of Data Security issues across the whole project gets every
 *     group whole, as it is kept;
 *   - a reader whose read is held to some labels (or to the issues they
 *     own, or a block with labels takes some away) gets each group as the
 *     issues they may read make it - read through the same rule the Issues
 *     list's rows are, so the two never disagree. A group they may read
 *     whole is the group as it is kept. One cut down to the stores they may
 *     read says only what those stores are: its counts are theirs, its
 *     facts are worked out again from their stores alone
 *     (getIssueGroupFactsOfStores), it has no OneUptime AI name - a name
 *     describes the whole group, and a plain word in it ("tables", "forty")
 *     could tell of a store they may not read - and it shows its pull
 *     request only when that pull request fixes one of their issues;
 *   - a group of which they may read fewer than two issues is none of
 *     theirs: a group of one would say there are others. Its issue stays in
 *     their flat list.
 *
 * Nothing says a group was cut down: that alone would tell of the stores
 * left out.
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

// The most stores read at once.
const STORE_PAGE_SIZE: number = 500;

const ROOT: { isRoot: true } = { isRoot: true };

export const ISSUE_GROUPS_NOT_READABLE_MESSAGE: string =
  "Groups of issues are for those who read Data Security issues.";

// How much of a project's groups a reader reads.
export enum IssueGroupReadScope {
  // Every group whole: a reader of Data Security issues across the whole project.
  Whole = "Whole",
  // Each group as the issues they may read make it: a read held to labels or owned issues.
  Held = "Held",
  // None: they read no Data Security issue.
  None = "None",
}

// One of a group's issues a reader may read.
export interface ReadableGroupMember {
  issueId: string;
  dataStoreId: string;
  status: string;
}

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

interface GroupCounts {
  all: number;
  open: number;
  fixed: number;
}

function countOf(statuses: ReadonlyArray<string>): GroupCounts {
  return {
    all: statuses.length,
    open: statuses.filter((status: string): boolean => {
      return status === DataSecurityIssueStatus.Open;
    }).length,
    fixed: statuses.filter((status: string): boolean => {
      return status === DataSecurityIssueStatus.Resolved;
    }).length,
  };
}

export default class DataSecurityIssueGroups {
  // How much of the project's groups the reader reads.
  public static getReadScope(
    props: DatabaseCommonInteractionProps,
  ): IssueGroupReadScope {
    if (
      props.isRoot ||
      props.isMasterAdmin ||
      CallerPermission.holdsAnyOf(props, ISSUE_GROUP_READ_PERMISSIONS, {
        projectWideOnly: true,
        labelledBlocksRefuse: true,
      })
    ) {
      return IssueGroupReadScope.Whole;
    }

    return CallerPermission.holdsAnyOf(props, ISSUE_GROUP_READ_PERMISSIONS)
      ? IssueGroupReadScope.Held
      : IssueGroupReadScope.None;
  }

  // Whether the reader reads every group whole: issues, across the whole project.
  public static canRead(props: DatabaseCommonInteractionProps): boolean {
    return (
      DataSecurityIssueGroups.getReadScope(props) === IssueGroupReadScope.Whole
    );
  }

  // Whether the reader reads any group: whole, or held to what they may read (#10739).
  public static canReadAny(props: DatabaseCommonInteractionProps): boolean {
    return (
      DataSecurityIssueGroups.getReadScope(props) !== IssueGroupReadScope.None
    );
  }

  /*
   * The project's groups with open issues, and those fixed in the last
   * FIXED_GROUP_SHOWN_FOR_IN_DAYS days - or, with `groupIds`, those groups
   * whatever they hold. The most issues first. Each as the reader may read
   * it (see the module comment).
   */
  @CaptureSpan()
  public static async list(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    groupIds?: unknown;
    now?: Date | undefined;
  }): Promise<DataSecurityIssueGroupsJSON> {
    const scope: IssueGroupReadScope = DataSecurityIssueGroups.getReadScope(
      data.props,
    );

    if (scope === IssueGroupReadScope.None) {
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
      groupKey: true;
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
      groupKey: true,
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
                // A length of time, the same in every zone (#8473).
                fixedAt: QueryHelper.greaterThanEqualTo(
                  OneUptimeDate.addRemoveDurationInDays(
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

    const groupIds: Array<string> = groups.map(
      (group: DataSecurityIssueGroup): string => {
        return idOf(group);
      },
    );
    const counts: Map<string, GroupCounts> =
      await DataSecurityIssueGroups.count(data.projectId, groupIds);
    // A reader held to labels: the issues of each group they may read.
    const readable: Map<string, Array<ReadableGroupMember>> | null =
      scope === IssueGroupReadScope.Held
        ? await DataSecurityIssueGroups.readReadableMembers({
            projectId: data.projectId,
            groupIds,
            props: data.props,
          })
        : null;
    const isAiOn: boolean = await AIService.isProjectAIEnabled(data.projectId);
    const listed: Array<DataSecurityIssueGroupJSON> = [];

    for (const group of groups) {
      const groupId: string = idOf(group);
      const facts: DataSecurityIssueGroupFacts | null =
        readDataSecurityIssueGroupFacts(group.facts);
      const count: GroupCounts = counts.get(groupId) || {
        all: 0,
        open: 0,
        fixed: 0,
      };

      if (!facts || count.all === 0) {
        continue;
      }

      const members: Array<ReadableGroupMember> | null = readable
        ? readable.get(groupId) || []
        : null;

      // A group of fewer than two of their issues is none of theirs.
      if (members && members.length < MIN_ISSUES_PER_GROUP) {
        continue;
      }

      const isCutDown: boolean = Boolean(members && members.length < count.all);

      if (isCutDown && members) {
        listed.push(
          await DataSecurityIssueGroups.toCutDownGroup({
            projectId: data.projectId,
            group,
            facts,
            members,
            props: data.props,
          }),
        );
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
        groupId,
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
   * at (#10370), and Ask AI says of it. None for an issue the reader may
   * not read, one in no group, a reader who reads no groups, or a group of
   * which they may read fewer than two issues.
   */
  @CaptureSpan()
  public static async forIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupJSON | null> {
    if (!DataSecurityIssueGroups.canReadAny(data.props)) {
      return null;
    }

    let issue: DataSecurityIssue | null = null;

    try {
      issue = await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true, dataSecurityIssueGroupId: true },
        props: data.props,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return null;
      }

      throw error;
    }

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

  /*
   * The groups an issue each is one of, for the reader, by issue id: what
   * Ask AI's list of issues says of each (#10739). Only the issues in a
   * group the reader may read.
   */
  @CaptureSpan()
  public static async forIssues(data: {
    projectId: ObjectID;
    issues: ReadonlyArray<
      Pick<DataSecurityIssue, "_id" | "id" | "dataSecurityIssueGroupId">
    >;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, DataSecurityIssueGroupJSON>> {
    const byIssue: Map<string, DataSecurityIssueGroupJSON> = new Map();
    const groupIds: Array<string> = Array.from(
      new Set(
        data.issues
          .map(
            (
              issue: Pick<DataSecurityIssue, "dataSecurityIssueGroupId">,
            ): string => {
              return (
                issue.dataSecurityIssueGroupId?.toString().toLowerCase() || ""
              );
            },
          )
          .filter(Boolean),
      ),
    );

    if (
      groupIds.length === 0 ||
      !DataSecurityIssueGroups.canReadAny(data.props)
    ) {
      return byIssue;
    }

    const listed: DataSecurityIssueGroupsJSON =
      await DataSecurityIssueGroups.list({
        projectId: data.projectId,
        props: data.props,
        groupIds,
      });
    const groups: Map<string, DataSecurityIssueGroupJSON> = new Map(
      listed.groups.map(
        (
          group: DataSecurityIssueGroupJSON,
        ): [string, DataSecurityIssueGroupJSON] => {
          return [group.groupId, group];
        },
      ),
    );

    for (const issue of data.issues) {
      const group: DataSecurityIssueGroupJSON | undefined = groups.get(
        issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "",
      );
      const issueId: string = idOf(issue);

      if (group && issueId) {
        byIssue.set(issueId, group);
      }
    }

    return byIssue;
  }

  /*
   * Of these groups, the issues the reader may read, by group: read through
   * the reader's own permissions, as the Issues list reads its rows - an
   * issue carries its store's labels, so a read held to labels reads the
   * issues of the stores that carry them. None, for a reader who may read
   * none.
   */
  public static async readReadableMembers(data: {
    projectId: ObjectID;
    groupIds: ReadonlyArray<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<ReadableGroupMember>>> {
    const members: Map<string, Array<ReadableGroupMember>> = new Map();

    if (data.groupIds.length === 0) {
      return members;
    }

    let issues: Array<DataSecurityIssue> = [];

    try {
      issues = await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataSecurityIssueGroupId: QueryHelper.any([...data.groupIds]),
        },
        select: {
          _id: true,
          status: true,
          dataStoreId: true,
          dataSecurityIssueGroupId: true,
        },
        skip: 0,
        limit: MAX_ISSUES_COUNTED,
        props: data.props,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return members;
      }

      throw error;
    }

    for (const issue of issues) {
      const groupId: string =
        issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "";
      const issueId: string = idOf(issue);

      if (!groupId || !issueId) {
        continue;
      }

      const list: Array<ReadableGroupMember> = members.get(groupId) || [];

      list.push({
        issueId,
        dataStoreId: issue.dataStoreId?.toString().toLowerCase() || "",
        status: issue.status || "",
      });
      members.set(groupId, list);
    }

    return members;
  }

  /*
   * A group's facts as the stores of these issues alone make them (#10739):
   * their stores read as grouping reads them, and the facts worked out
   * again from them (getIssueGroupFactsOfStores).
   */
  public static async getFactsOfMembers(data: {
    projectId: ObjectID;
    group: Pick<DataSecurityIssueGroup, "groupKey">;
    facts: DataSecurityIssueGroupFacts;
    members: ReadonlyArray<Pick<ReadableGroupMember, "dataStoreId">>;
  }): Promise<DataSecurityIssueGroupFacts> {
    const storeIds: Array<string> = Array.from(
      new Set(
        data.members
          .map((member: Pick<ReadableGroupMember, "dataStoreId">): string => {
            return member.dataStoreId;
          })
          .filter(Boolean),
      ),
    );
    const stores: Array<DataSecurityIssueGroupStore> = [];

    for (
      let start: number = 0;
      start < storeIds.length;
      start += STORE_PAGE_SIZE
    ) {
      const batch: Array<string> = storeIds.slice(
        start,
        start + STORE_PAGE_SIZE,
      );
      const page: Array<DataStore> = await DataStoreService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(batch) },
        select: {
          _id: true,
          name: true,
          kind: true,
          provider: true,
          region: true,
          cloudAccountNumber: true,
          cloudTags: true,
        },
        skip: 0,
        limit: batch.length,
        props: ROOT,
      });

      for (const store of page) {
        const tags: Dictionary<string> = readCloudTags(store.cloudTags);

        stores.push({
          id: idOf(store),
          name: store.name || "",
          kind: store.kind || undefined,
          provider: store.provider || undefined,
          region: store.region || undefined,
          accountNumber: store.cloudAccountNumber || undefined,
          tags,
          managedAsCode: CloudAiTargets.getManagedAsCode(tags),
        });
      }
    }

    return getIssueGroupFactsOfStores({
      facts: data.facts,
      groupKey: data.group.groupKey,
      stores: stores.sort(
        (
          left: DataSecurityIssueGroupStore,
          right: DataSecurityIssueGroupStore,
        ): number => {
          return (
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id)
          );
        },
      ),
    });
  }

  /*
   * Whether the group's pull request fixes one of these issues: its task
   * lists the issues it fixes (DataSecurityFixTarget). A reader held to
   * labels sees the pull request of a group cut down for them only then -
   * one opened for stores they may not read is none of theirs.
   */
  public static async isFixOfAnyOf(data: {
    taskId: ObjectID;
    issueIds: ReadonlyArray<string>;
  }): Promise<boolean> {
    try {
      const task: AIRun | null = await DataSecurityFixTarget.readTask(
        data.taskId,
      );
      const fixed: Set<string> = new Set(
        (task ? DataSecurityFixTarget.issueIdsOfTask(task) : []).map(
          (id: string): string => {
            return id.toLowerCase();
          },
        ),
      );

      return data.issueIds.some((issueId: string): boolean => {
        return fixed.has(issueId.toLowerCase());
      });
    } catch (error) {
      logger.debug(
        `DataSecurity groups: could not read task ${data.taskId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * A group cut down to the issues a reader held to labels may read
   * (#10739): their counts, the facts their stores alone make, no name,
   * and its pull request only when it fixes one of their issues.
   */
  private static async toCutDownGroup(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    facts: DataSecurityIssueGroupFacts;
    members: Array<ReadableGroupMember>;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupJSON> {
    const facts: DataSecurityIssueGroupFacts =
      await DataSecurityIssueGroups.getFactsOfMembers({
        projectId: data.projectId,
        group: data.group,
        facts: data.facts,
        members: data.members,
      });
    const count: GroupCounts = countOf(
      data.members.map((member: ReadableGroupMember): string => {
        return member.status;
      }),
    );
    const fix: DataSecurityIssueGroupFixStateJSON | null =
      data.group.codeTaskId &&
      (await DataSecurityIssueGroups.isFixOfAnyOf({
        taskId: data.group.codeTaskId,
        issueIds: data.members.map((member: ReadableGroupMember): string => {
          return member.issueId;
        }),
      }))
        ? await DataSecurityIssueGroupFix.readFixState({
            projectId: data.projectId,
            taskId: data.group.codeTaskId,
            props: data.props,
          })
        : null;

    return {
      groupId: idOf(data.group),
      checkId: data.group.checkId || facts.checkId,
      cause: facts.cause,
      facts,
      issueCount: count.all,
      openIssueCount: count.open,
      fixedIssueCount: count.fixed,
      ...(fix ? { fix } : {}),
    };
  }

  // How many issues each group holds, how many are open, how many are fixed - read now.
  private static async count(
    projectId: ObjectID,
    groupIds: Array<string>,
  ): Promise<Map<string, GroupCounts>> {
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
    const statuses: Map<string, Array<string>> = new Map();

    for (const issue of issues) {
      const groupId: string =
        issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "";
      const list: Array<string> = statuses.get(groupId) || [];

      list.push(issue.status || "");
      statuses.set(groupId, list);
    }

    const counts: Map<string, GroupCounts> = new Map();

    for (const [groupId, list] of statuses) {
      counts.set(groupId, countOf(list));
    }

    return counts;
  }
}
