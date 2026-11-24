import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { Gray500, Purple500 } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { isDataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { getDataSecurityAiPageUrl } from "../../DataSecurity/DataSecurityIssueGroupFix";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * WHAT EACH ISSUE'S TIMELINE SAYS OF ITS GROUP'S FIX, AS ONEUPTIME AI
 * PROPOSES IT (#10741).
 *
 * A proposal OneUptime AI makes for one issue says "OneUptime AI proposes:
 * ..." on the issue's timeline (DataSecurityAiProposals.writeTimelines). A
 * group's fix has no issue of its own, so its issues heard nothing until a
 * person made it. Now each issue it is for says, on its own timeline:
 *
 *   - that OneUptime AI proposes to fix its cause - one pull request to the
 *     code that declares its store, or the change its store's own kind
 *     takes through its cloud connection (#10742) - and that it waits for a
 *     person in Data Security > AI, linked;
 *   - that a person dismissed it, and who;
 *   - that it expired: no longer needed once none of its issues is open, or
 *     the fix was asked for another way - from the Issues list, or by a
 *     security playbook.
 *
 * Quiet where saying it again would be noise: a newer proposal that
 * replaces one still waiting, of the same kind, writes only on the issues
 * the one it replaced was not for, and says nothing of the one it
 * replaced; and a proposal for more than MAX_TIMELINE_ISSUES open issues
 * (a large group) writes on none - the group says it on the Issues list and
 * in Data Security > AI. The lines are written MAX_TIMELINE_BATCH at a time.
 *
 * An issue's timeline is read by everyone who may read the issue - a reader
 * held to labels too (#10739) - so a line names nothing but the issue's own
 * store and its cause: never how many issues the group holds, another
 * store, the proposal's title (which counts them), or a dismissal's reason
 * (a person writes it about the whole group). It links to Data Security >
 * AI, where the proposal itself is read by those who read the whole group.
 * Never throws: a proposal stands whatever its issues' timelines say.
 */

// The most issues one proposal writes on: a proposal for more is quiet.
export const MAX_TIMELINE_ISSUES: number = 200;

// The most lines written at once.
export const MAX_TIMELINE_BATCH: number = 20;

const ROOT: { isRoot: true } = { isRoot: true };

// Why a group's proposal expired.
export enum GroupProposalExpiry {
  // None of the group's issues is open any more.
  NoLongerNeeded = "NoLongerNeeded",
  // The fix of that part was asked for from the Issues list, or by a security playbook.
  FixAskedForAnotherWay = "FixAskedForAnotherWay",
}

function idText(value: unknown): string {
  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? value.toLowerCase()
    : "";
}

function readIds(value: unknown): Array<string> {
  return Array.from(
    new Set((Array.isArray(value) ? value : []).map(idText).filter(Boolean)),
  );
}

/*
 * The response action each issue's store takes in a one-approval proposal
 * (#10742), by issue id: from the plan's actions. None for a pull request,
 * or a proposal from before it listed them.
 */
export function getProposalActionOfIssues(
  plan: JSONObject | null | undefined,
): Map<string, string> {
  const actions: Map<string, string> = new Map();
  const entries: unknown = plan?.["actions"];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const action: unknown = (entry as JSONObject)["action"];

    if (!isDataSecurityResponseAction(action)) {
      continue;
    }

    for (const issueId of readIds((entry as JSONObject)["issueIds"])) {
      actions.set(issueId, action);
    }
  }

  return actions;
}

/*
 * The line an issue's timeline says when OneUptime AI proposes its group's
 * fix: its own store's part of it, and where it waits.
 */
export function getGroupProposedLine(data: {
  kind: DataSecurityAiProposalKind | string | undefined;
  // The action the one approval runs on this issue's store, when it is one.
  action?: string | undefined;
  aiPageUrl: string;
}): MarkdownText {
  const where: MarkdownText = FeedMarkdown.link(
    "Data Security > AI",
    data.aiPageUrl,
  );

  if (data.kind === DataSecurityAiProposalKind.FixIssueGroupInCode) {
    return mdText`OneUptime AI proposes one pull request that fixes this issue's cause, in the code that declares its store. It waits for a person to approve or dismiss it in ${where}.`;
  }

  return data.action
    ? mdText`OneUptime AI proposes to fix this issue's cause through its store's cloud connection: **${data.action}**. It always waits for a person to approve or dismiss it in ${where}.`
    : mdText`OneUptime AI proposes to fix this issue's cause through its store's cloud connection. It always waits for a person to approve or dismiss it in ${where}.`;
}

// The line an issue's timeline says when a person dismissed its group's fix.
export function getGroupDismissedLine(data: {
  aiPageUrl: string;
}): MarkdownText {
  return mdText`Dismissed OneUptime AI's proposal to fix this issue's cause. Why is on the proposal, in ${FeedMarkdown.link(
    "Data Security > AI",
    data.aiPageUrl,
  )}.`;
}

// The line an issue's timeline says when its group's fix expired, and why.
export function getGroupExpiredLine(data: {
  why: GroupProposalExpiry;
  // Who asked for the fix another way: a person, or a security playbook.
  byPerson?: boolean | undefined;
  byPlaybook?: boolean | undefined;
}): MarkdownText {
  if (data.why === GroupProposalExpiry.NoLongerNeeded) {
    return mdText`OneUptime AI's proposal to fix this issue's cause expired: it is no longer needed.`;
  }

  if (data.byPlaybook) {
    return mdText`OneUptime AI's proposal to fix this issue's cause expired: a security playbook asked for the fix instead.`;
  }

  return data.byPerson
    ? mdText`OneUptime AI's proposal to fix this issue's cause expired: the fix was asked for from the Issues list instead.`
    : mdText`OneUptime AI's proposal to fix this issue's cause expired: the fix was asked for another way.`;
}

export default class DataSecurityIssueGroupTimelines {
  /*
   * The issues a group's proposal is for: those its plan lists - or, for a
   * one-approval proposal from before it listed them, the group's issues on
   * the stores it lists.
   */
  public static async readProposalIssueIds(data: {
    projectId: ObjectID;
    proposal: Pick<DataSecurityAiProposal, "plan" | "dataSecurityIssueGroupId">;
  }): Promise<Array<string>> {
    const listed: Array<string> = readIds(data.proposal.plan?.["issueIds"]);

    if (listed.length > 0) {
      return listed;
    }

    const storeIds: Array<string> = readIds(data.proposal.plan?.["storeIds"]);

    if (storeIds.length === 0 || !data.proposal.dataSecurityIssueGroupId) {
      return [];
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataSecurityIssueGroupId: data.proposal.dataSecurityIssueGroupId,
          dataStoreId: QueryHelper.any(storeIds),
        } as never,
        select: { _id: true },
        skip: 0,
        limit: MAX_TIMELINE_ISSUES + 1,
        props: ROOT,
      });

    return readIds(
      issues.map((issue: DataSecurityIssue): string => {
        return issue.id?.toString() || "";
      }),
    );
  }

  /*
   * The issues the group's proposals of a kind that still wait are for:
   * what a newer one that replaces them need not tell again.
   */
  public static async readWaitingIssueIds(data: {
    projectId: ObjectID;
    groupId: ObjectID;
    kind: DataSecurityAiProposalKind;
  }): Promise<Set<string>> {
    try {
      const waiting: Array<DataSecurityAiProposal> =
        await DataSecurityAiProposalService.findBy({
          query: {
            projectId: data.projectId,
            dataSecurityIssueGroupId: data.groupId,
            kind: data.kind,
            status: DataSecurityAiProposalStatus.Proposed,
          },
          select: { _id: true, plan: true, dataSecurityIssueGroupId: true },
          skip: 0,
          limit: 10,
          props: ROOT,
        });
      const issueIds: Set<string> = new Set();

      for (const proposal of waiting) {
        for (const issueId of await DataSecurityIssueGroupTimelines.readProposalIssueIds(
          { projectId: data.projectId, proposal },
        )) {
          issueIds.add(issueId);
        }
      }

      return issueIds;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not read what group ${data.groupId.toString()}'s waiting proposals are for: ${error}`,
      );
      return new Set();
    }
  }

  /*
   * OneUptime AI proposed a group's fix that waits for a person: each open
   * issue it is for says so - but those the waiting one it replaced was for
   * already did, and a proposal for more than MAX_TIMELINE_ISSUES is quiet.
   */
  @CaptureSpan()
  public static async onProposed(data: {
    projectId: ObjectID;
    proposalId: string;
    kind: DataSecurityAiProposalKind;
    plan: JSONObject;
    groupId: ObjectID;
    // The issues the waiting proposal it replaced was for: told already.
    toldAlready?: ReadonlySet<string> | undefined;
  }): Promise<number> {
    try {
      const issueIds: Array<string> =
        await DataSecurityIssueGroupTimelines.readProposalIssueIds({
          projectId: data.projectId,
          proposal: {
            plan: data.plan,
            dataSecurityIssueGroupId: data.groupId,
          },
        });
      const open: Array<string> =
        await DataSecurityIssueGroupTimelines.keepOpen({
          projectId: data.projectId,
          issueIds,
        });

      if (open.length > MAX_TIMELINE_ISSUES) {
        return 0;
      }

      const actions: Map<string, string> = getProposalActionOfIssues(data.plan);
      const aiPageUrl: string = getDataSecurityAiPageUrl(data.projectId);

      return await DataSecurityIssueGroupTimelines.writeLines({
        projectId: data.projectId,
        issueIds: open.filter((issueId: string): boolean => {
          return !data.toldAlready?.has(issueId);
        }),
        eventType: DataSecurityIssueFeedEventType.AiProposed,
        color: Purple500,
        proposalId: data.proposalId,
        lineOf: (issueId: string): MarkdownText => {
          return getGroupProposedLine({
            kind: data.kind,
            action: actions.get(issueId),
            aiPageUrl,
          });
        },
      });
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not tell the issues of group ${data.groupId.toString()} that its fix is proposed: ${error}`,
      );
      return 0;
    }
  }

  // A person dismissed a group's proposal: each issue it was for says so, and who.
  @CaptureSpan()
  public static async onDismissed(data: {
    projectId: ObjectID;
    proposal: Pick<
      DataSecurityAiProposal,
      "id" | "plan" | "dataSecurityIssueGroupId"
    >;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    try {
      const issueIds: Array<string> =
        await DataSecurityIssueGroupTimelines.readProposalIssueIds({
          projectId: data.projectId,
          proposal: data.proposal,
        });

      if (issueIds.length > MAX_TIMELINE_ISSUES) {
        return 0;
      }

      const aiPageUrl: string = getDataSecurityAiPageUrl(data.projectId);

      return await DataSecurityIssueGroupTimelines.writeLines({
        projectId: data.projectId,
        issueIds,
        eventType: DataSecurityIssueFeedEventType.AiProposalDismissed,
        color: Gray500,
        proposalId: data.proposal.id?.toString(),
        userId: data.userId,
        lineOf: (): MarkdownText => {
          return getGroupDismissedLine({ aiPageUrl });
        },
      });
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not tell the issues of a dismissed group proposal ${data.proposal.id?.toString()}: ${error}`,
      );
      return 0;
    }
  }

  /*
   * What a group's proposals of these kinds (or every kind) still wait for
   * is no longer needed: each expires - claimed one by one, so a person's
   * approval at the same moment wins or loses whole - and each issue it was
   * for says so, and why. Returns how many expired. Never throws.
   */
  @CaptureSpan()
  public static async expireWaitingForGroup(data: {
    projectId: ObjectID;
    groupId: ObjectID;
    kinds?: ReadonlyArray<DataSecurityAiProposalKind> | undefined;
    at: Date;
    why: GroupProposalExpiry;
    // Who asked for the fix another way, for FixAskedForAnotherWay.
    userId?: ObjectID | undefined;
    byPlaybook?: boolean | undefined;
  }): Promise<number> {
    if (data.kinds && data.kinds.length === 0) {
      return 0;
    }

    let expired: number = 0;

    try {
      const waiting: Array<DataSecurityAiProposal> =
        await DataSecurityAiProposalService.findBy({
          query: {
            projectId: data.projectId,
            dataSecurityIssueGroupId: data.groupId,
            status: DataSecurityAiProposalStatus.Proposed,
            ...(data.kinds ? { kind: QueryHelper.any([...data.kinds]) } : {}),
          } as never,
          select: {
            _id: true,
            kind: true,
            plan: true,
            dataSecurityIssueGroupId: true,
          },
          skip: 0,
          limit: 10,
          props: ROOT,
        });

      for (const proposal of waiting) {
        if (!proposal.id) {
          continue;
        }

        const claimed: number =
          await DataSecurityAiProposalService.attemptTransition({
            proposalId: proposal.id,
            fromStatuses: [DataSecurityAiProposalStatus.Proposed],
            set: {
              status: DataSecurityAiProposalStatus.Expired,
              expiredAt: data.at,
            },
          });

        if (claimed === 0) {
          continue;
        }

        expired++;

        const issueIds: Array<string> =
          await DataSecurityIssueGroupTimelines.readProposalIssueIds({
            projectId: data.projectId,
            proposal,
          });

        if (issueIds.length > MAX_TIMELINE_ISSUES) {
          continue;
        }

        await DataSecurityIssueGroupTimelines.writeLines({
          projectId: data.projectId,
          issueIds,
          eventType: DataSecurityIssueFeedEventType.AiProposalExpired,
          color: Gray500,
          proposalId: proposal.id.toString(),
          userId:
            data.why === GroupProposalExpiry.FixAskedForAnotherWay
              ? data.userId
              : undefined,
          lineOf: (): MarkdownText => {
            return getGroupExpiredLine({
              why: data.why,
              byPerson: Boolean(data.userId),
              byPlaybook: data.byPlaybook,
            });
          },
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not settle what group ${data.groupId.toString()}'s fix still waited for: ${error}`,
      );
    }

    return expired;
  }

  // Of these issues, those still open.
  private static async keepOpen(data: {
    projectId: ObjectID;
    issueIds: Array<string>;
  }): Promise<Array<string>> {
    if (data.issueIds.length === 0) {
      return [];
    }

    const open: Set<string> = new Set();

    for (
      let start: number = 0;
      start < data.issueIds.length;
      start += MAX_TIMELINE_ISSUES
    ) {
      const batch: Array<string> = data.issueIds.slice(
        start,
        start + MAX_TIMELINE_ISSUES,
      );
      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(batch),
            status: DataSecurityIssueStatus.Open,
          } as never,
          select: { _id: true },
          skip: 0,
          limit: batch.length,
          props: ROOT,
        });

      for (const issue of issues) {
        const id: string = issue.id?.toString().toLowerCase() || "";

        if (id) {
          open.add(id);
        }
      }
    }

    return data.issueIds.filter((issueId: string): boolean => {
      return open.has(issueId);
    });
  }

  // One line on each issue, MAX_TIMELINE_BATCH at a time. Returns how many were written.
  private static async writeLines(data: {
    projectId: ObjectID;
    issueIds: Array<string>;
    eventType: DataSecurityIssueFeedEventType;
    color: Color;
    lineOf: (issueId: string) => MarkdownText;
    proposalId?: string | undefined;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    const issueIds: Array<string> = data.issueIds.slice(0, MAX_TIMELINE_ISSUES);

    for (
      let start: number = 0;
      start < issueIds.length;
      start += MAX_TIMELINE_BATCH
    ) {
      await Promise.all(
        issueIds
          .slice(start, start + MAX_TIMELINE_BATCH)
          .map((issueId: string): Promise<void> => {
            return DataSecurityIssueFeedService.createDataSecurityIssueFeedItem(
              {
                projectId: data.projectId,
                dataSecurityIssueId: new ObjectID(issueId),
                eventType: data.eventType,
                displayColor: data.color,
                feedInfoInMarkdown: data.lineOf(issueId).toString(),
                ...(data.userId ? { userId: data.userId } : {}),
                ...(data.proposalId && ObjectID.isValidUUID(data.proposalId)
                  ? { dataSecurityAiProposalId: new ObjectID(data.proposalId) }
                  : {}),
              },
            );
          }),
      );
    }

    return issueIds.length;
  }
}
