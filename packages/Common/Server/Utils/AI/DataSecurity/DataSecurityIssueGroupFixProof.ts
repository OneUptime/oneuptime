import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  IssueGroupFixProofIssue,
  IssueGroupFixProofStanding,
  getIssueGroupFixProofStanding,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import {
  DataSecurityIssueResolutionDetails,
  readDataSecurityIssueResolutionDetails,
} from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityFixTarget from "../CodeFix/DataSecurityFixTarget";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * A GROUP'S FIX, PROVEN BY ITS ISSUES' OWN CHECKS (#10738).
 *
 * A change OneUptime AI made for one issue is proven when that issue's
 * check passes after it, and AI Results counts it among the changes that
 * worked. A group's fix - one pull request to the code that declares its
 * stores, or one approval for the stores made in the console - is proven
 * the same way, once every issue it fixed was closed by it
 * (getIssueGroupFixProofStanding):
 *
 *   - the pull request fixed the issues its task lists
 *     (DataSecurityFixTarget), and each of them resolved as Fixed in
 *     infrastructure code by that task's pull request - the production
 *     check that followed it to the applied change writes it;
 *   - the one approval fixed the issues whose store it changed (kept on the
 *     proposal when it ran), and each resolved as Fixed from here, by the
 *     action it ran on that store, after it ran.
 *
 * An issue closed any other way - accepted, not an issue, marked resolved
 * by a person, no longer checked, its store archived, deleted, or its check
 * passing for no change OneUptime knows of - proves nothing, and the fix
 * stays unproven.
 *
 * Run after each grouping (DataSecurityIssueGrouper), for the project's
 * group fixes made in the last PROVE_APPLIED_WITHIN_DAYS that are not
 * proven yet - so a fix whose issues were upgraded to Fixed in
 * infrastructure code after their group closed is proven at the next run.
 * Read and written as OneUptime. Never throws.
 */

// How long after it was made a group's fix is still looked at.
export const PROVE_APPLIED_WITHIN_DAYS: number = 90;

// The most group fixes one run looks at, the newest first.
export const MAX_GROUP_FIXES_PROVEN_PER_RUN: number = 50;

// The most issues one fix is proven by: a group's fix covers at most this many.
const MAX_PROVING_ISSUES: number = 500;

const ROOT: { isRoot: true } = { isRoot: true };

function idText(value: unknown): string {
  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? value.toLowerCase()
    : "";
}

function readIds(value: unknown): Array<string> {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : []).map(idText).filter(Boolean),
    ),
  );
}

export interface GroupFixProof {
  standing: IssueGroupFixProofStanding;
  // The issues the fix fixed, that its proof read.
  issueIds: Array<string>;
}

export default class DataSecurityIssueGroupFixProof {
  @CaptureSpan()
  public static async proveForProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<number> {
    try {
      const now: Date = data.now || OneUptimeDate.getCurrentDate();
      const proposals: Array<DataSecurityAiProposal> =
        await DataSecurityAiProposalService.findBy({
          query: {
            projectId: data.projectId,
            kind: QueryHelper.any([
              DataSecurityAiProposalKind.FixIssueGroupInCode,
              DataSecurityAiProposalKind.FixIssueGroupInCloud,
            ]),
            status: QueryHelper.any([
              DataSecurityAiProposalStatus.Applied,
              DataSecurityAiProposalStatus.AppliedWithoutAsking,
            ]),
            verifiedAt: QueryHelper.isNull(),
            // A length of time, the same in every zone (#8473).
            appliedAt: QueryHelper.greaterThanEqualTo(
              OneUptimeDate.addRemoveDurationInDays(
                now,
                -PROVE_APPLIED_WITHIN_DAYS,
              ),
            ),
          } as never,
          select: {
            _id: true,
            kind: true,
            plan: true,
            result: true,
            appliedAt: true,
            dataSecurityIssueGroupId: true,
          },
          sort: { appliedAt: SortOrder.Descending },
          skip: 0,
          limit: MAX_GROUP_FIXES_PROVEN_PER_RUN,
          props: ROOT,
        });
      let proven: number = 0;

      for (const proposal of proposals) {
        if (!proposal.id) {
          continue;
        }

        try {
          const proof: GroupFixProof = await DataSecurityIssueGroupFixProof.read(
            { projectId: data.projectId, proposal },
          );

          if (proof.standing === IssueGroupFixProofStanding.Proven) {
            proven += await DataSecurityAiProposalService.markGroupFixProven({
              proposalId: proposal.id,
              at: now,
            });
          }
        } catch (error) {
          logger.error(
            `DataSecurity AI: could not prove the group fix ${proposal.id.toString()} of project ${data.projectId.toString()}: ${error}`,
          );
        }
      }

      return proven;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not prove the group fixes of project ${data.projectId.toString()}: ${error}`,
      );
      return 0;
    }
  }

  // Where one applied group fix stands against the checks of the issues it fixed.
  public static async read(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
  }): Promise<GroupFixProof> {
    const proposal: DataSecurityAiProposal = data.proposal;

    if (proposal.kind === DataSecurityAiProposalKind.FixIssueGroupInCode) {
      return await DataSecurityIssueGroupFixProof.readPullRequestProof({
        projectId: data.projectId,
        proposal,
      });
    }

    if (proposal.kind === DataSecurityAiProposalKind.FixIssueGroupInCloud) {
      return await DataSecurityIssueGroupFixProof.readApprovalProof({
        projectId: data.projectId,
        proposal,
      });
    }

    return { standing: IssueGroupFixProofStanding.NothingToProve, issueIds: [] };
  }

  /*
   * The pull request: the issues its task lists, each resolved as Fixed in
   * infrastructure code by that very task's pull request.
   */
  private static async readPullRequestProof(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
  }): Promise<GroupFixProof> {
    const aiRunId: string = idText(data.proposal.result?.["aiRunId"]);
    const task: AIRun | null = aiRunId
      ? await DataSecurityFixTarget.readTask(new ObjectID(aiRunId))
      : null;

    if (
      !task?.id ||
      task.projectId?.toString().toLowerCase() !==
        data.projectId.toString().toLowerCase()
    ) {
      return {
        standing: IssueGroupFixProofStanding.NothingToProve,
        issueIds: [],
      };
    }

    const issueIds: Array<string> = readIds(
      DataSecurityFixTarget.issueIdsOfTask(task),
    );
    const issues: Array<IssueGroupFixProofIssue> =
      await DataSecurityIssueGroupFixProof.readIssues({
        projectId: data.projectId,
        issueIds,
      });

    return {
      standing: getIssueGroupFixProofStanding({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
        taskId: task.id.toString(),
        issues,
      }),
      issueIds,
    };
  }

  /*
   * The one approval: the issues whose store it changed, each resolved as
   * Fixed from here by the action it ran on that store, after it ran. A
   * proposal from before it kept them names the issues of the stores it
   * listed.
   */
  private static async readApprovalProof(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
  }): Promise<GroupFixProof> {
    const result: JSONObject | undefined = data.proposal.result || undefined;
    const plan: JSONObject | undefined = data.proposal.plan || undefined;
    const issueIds: Array<string> = Array.isArray(result?.["changedIssueIds"])
      ? readIds(result?.["changedIssueIds"])
      : await DataSecurityIssueGroupFixProof.readIssuesOfListedStores({
          projectId: data.projectId,
          proposal: data.proposal,
        });
    const expected: Map<string, string> =
      DataSecurityIssueGroupFixProof.readExpectedActions(plan);
    const issues: Array<IssueGroupFixProofIssue> = (
      await DataSecurityIssueGroupFixProof.readIssues({
        projectId: data.projectId,
        issueIds,
      })
    ).map((issue: IssueGroupFixProofIssue & { id?: string }) => {
      const action: string | undefined = issue.id
        ? expected.get(issue.id)
        : undefined;

      return action ? { ...issue, expectedAction: action } : issue;
    });

    return {
      standing: getIssueGroupFixProofStanding({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
        appliedAt: data.proposal.appliedAt,
        issues,
      }),
      issueIds,
    };
  }

  /*
   * The action each issue's store took, by issue id: each kind's own, from
   * the plan's actions (#10742) - or the plan's one action, for a proposal
   * from before it listed them.
   */
  public static readExpectedActions(
    plan: JSONObject | undefined,
  ): Map<string, string> {
    const expected: Map<string, string> = new Map();
    const actions: unknown = plan?.["actions"];

    if (Array.isArray(actions) && actions.length > 0) {
      for (const entry of actions) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const action: unknown = (entry as JSONObject)["action"];

        if (typeof action !== "string") {
          continue;
        }

        for (const issueId of readIds((entry as JSONObject)["issueIds"])) {
          expected.set(issueId, action);
        }
      }

      return expected;
    }

    const action: unknown = plan?.["action"];

    if (typeof action === "string") {
      for (const issueId of readIds(plan?.["issueIds"])) {
        expected.set(issueId, action);
      }
    }

    return expected;
  }

  // A proposal from before it kept the issues it changed: those of the stores it listed.
  private static async readIssuesOfListedStores(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
  }): Promise<Array<string>> {
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
        limit: MAX_PROVING_ISSUES,
        props: ROOT,
      });

    return readIds(
      issues.map((issue: DataSecurityIssue): string => {
        return issue.id?.toString() || "";
      }),
    );
  }

  /*
   * The issues a fix fixed, as its proof reads them. One gone since - a
   * person deleted it - reads as closed some other way: nothing proves it.
   */
  private static async readIssues(data: {
    projectId: ObjectID;
    issueIds: Array<string>;
  }): Promise<Array<IssueGroupFixProofIssue & { id?: string }>> {
    const ids: Array<string> = data.issueIds.slice(0, MAX_PROVING_ISSUES);

    if (ids.length === 0) {
      return [];
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(ids),
        } as never,
        select: {
          _id: true,
          status: true,
          resolution: true,
          resolutionDetails: true,
          resolvedAt: true,
        },
        skip: 0,
        limit: ids.length,
        props: ROOT,
      });
    const byId: Map<string, DataSecurityIssue> = new Map(
      issues.map((issue: DataSecurityIssue): [string, DataSecurityIssue] => {
        return [issue.id?.toString().toLowerCase() || "", issue];
      }),
    );

    return ids.map(
      (id: string): IssueGroupFixProofIssue & { id?: string } => {
        const issue: DataSecurityIssue | undefined = byId.get(id);

        if (!issue) {
          return { id, status: "Deleted" };
        }

        const details: DataSecurityIssueResolutionDetails =
          readDataSecurityIssueResolutionDetails(issue.resolutionDetails);

        return {
          id,
          status: issue.status,
          resolution: issue.resolution,
          resolvedAt: issue.resolvedAt,
          fixTaskId: details.fix?.taskId,
          responseAction: details.responseAction,
        };
      },
    );
  }
}
