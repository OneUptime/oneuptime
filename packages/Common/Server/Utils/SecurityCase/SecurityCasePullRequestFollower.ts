import SecurityCasePullRequest from "../../../Models/DatabaseModels/SecurityCasePullRequest";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Green500 } from "../../../Types/BrandColors";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import { getPullRequestLinkName } from "../../../Types/CodeRepository/PullRequestLink";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { pullRequestShippedMarkdown } from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCasePullRequestService from "../../Services/SecurityCasePullRequestService";
import { JSONObject } from "../../../Types/JSON";
import { FixDeploy, VerifierRun } from "../AI/CodeFix/FixProductionVerifier";
import {
  FIX_PRODUCTION_THRESHOLDS,
  describeDeploy,
} from "../AI/CodeFix/FixProductionVerdict";
import { CODE_HOST_REPOSITORY_SELECT } from "../CodeRepository/CodeHost/CodeHostAccess";
import LinkedPullRequestFollower, {
  LinkedPullRequestKind,
  PullRequestFollowed,
} from "../CodeRepository/LinkedPullRequests/LinkedPullRequestFollower";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseStepChecks from "./StepChecks/SecurityCaseStepChecks";

/*
 * FOLLOWING A PULL REQUEST A PERSON LINKED TO A SECURITY CASE (#10604), the
 * way OneUptime follows the ones it opens itself:
 *
 *   1. while it is open, its state is read through its repository's
 *      connection (SyncPullRequestStates reads OneUptime AI's): merged with
 *      the commit it merged as, or closed;
 *   2. once merged, the deploys recorded since are searched for one that
 *      contains its merge commit - the same commit or a later one, by the
 *      host's compare (FixProductionVerifier.findDeployContainingFix) - for
 *      as long as OneUptime waits for an AI fix's deploy;
 *   3. what it found goes on the pull request's row, the case's steps are
 *      checked at once, and the deploy that shipped it is on the case's
 *      timeline.
 *
 * The Fix step's check reads the row with Fix With AI's (FixChanges), and
 * proves the fix by the attack being turned away after that deploy. Each
 * link is followed in isolation: one host that does not answer never stops
 * the others, and is read again next time.
 *
 * The loop is the one follower of every linked pull request
 * (LinkedPullRequestFollower), which follows a Data Security issue's own
 * fixes too (#10831); a case's links are one kind of it.
 */

// The most links one run follows, of each kind: open ones, merged ones waiting for a deploy.
export const SECURITY_CASE_PULL_REQUEST_FOLLOW_BATCH: number = 100;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const FOLLOW_SELECT: {
  _id: true;
  projectId: true;
  securityCaseId: true;
  pullRequestUrl: true;
  pullRequestNumber: true;
  pullRequestState: true;
  repoOrganizationName: true;
  repoName: true;
  mergeCommitSha: true;
  mergedAt: true;
  deployedAt: true;
  codeRepository: typeof CODE_HOST_REPOSITORY_SELECT;
} = {
  _id: true,
  projectId: true,
  securityCaseId: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  pullRequestState: true,
  repoOrganizationName: true,
  repoName: true,
  mergeCommitSha: true,
  mergedAt: true,
  deployedAt: true,
  codeRepository: CODE_HOST_REPOSITORY_SELECT,
};

// What following one link changed: written on its row, said on the case.
export type { PullRequestFollowed };

/*
 * A case's links, as the one follower of linked pull requests follows them
 * (LinkedPullRequestFollower): open ones, and merged ones waiting for a
 * deploy as long as an AI fix's is waited for; the deploy found here; the
 * case's steps checked once anything changed.
 */
export const SECURITY_CASE_PULL_REQUESTS: LinkedPullRequestKind<SecurityCasePullRequest> =
  {
    name: "security case pull request",
    findsDeploy: true,
    readToFollow: async (
      now: Date,
    ): Promise<Array<SecurityCasePullRequest>> => {
      const [open, merged]: [
        Array<SecurityCasePullRequest>,
        Array<SecurityCasePullRequest>,
      ] = await Promise.all([
        SecurityCasePullRequestService.findBy({
          query: { pullRequestState: PullRequestState.Open },
          select: FOLLOW_SELECT,
          sort: { followedAt: SortOrder.Ascending },
          skip: 0,
          limit: SECURITY_CASE_PULL_REQUEST_FOLLOW_BATCH,
          props: { isRoot: true },
        }),
        // Merged, and no deploy of it seen yet: looked for as long as an AI fix's is.
        SecurityCasePullRequestService.findBy({
          query: {
            pullRequestState: PullRequestState.Merged,
            deployedAt: new IsNull(),
            mergedAt: new GreaterThan(
              new Date(
                now.getTime() -
                  FIX_PRODUCTION_THRESHOLDS.maxDeployWaitDays * DAY_IN_MS,
              ),
            ),
          } as never,
          select: FOLLOW_SELECT,
          sort: { followedAt: SortOrder.Ascending },
          skip: 0,
          limit: SECURITY_CASE_PULL_REQUEST_FOLLOW_BATCH,
          props: { isRoot: true },
        }),
      ]);

      return [...open, ...merged];
    },
    write: async (data: {
      row: SecurityCasePullRequest;
      update: JSONObject;
      isChanged: boolean;
    }): Promise<void> => {
      await SecurityCasePullRequestService.updateColumnsByIdWithoutHooks({
        id: data.row.id!,
        data: data.update as PartialEntity<SecurityCasePullRequest>,
        skipUpdateDateColumn: !data.isChanged,
      });
    },
    onShipped: async (data: {
      row: SecurityCasePullRequest;
      deploy: FixDeploy;
    }): Promise<void> => {
      await SecurityCasePullRequestFollower.sayShipped(data);
    },
    // The Fix step reads the case's fixes: OneUptime looks at it now.
    afterChange: async (data: {
      row: SecurityCasePullRequest;
    }): Promise<void> => {
      if (!data.row.projectId || !data.row.securityCaseId) {
        return;
      }

      await SecurityCaseStepChecks.requestCheck({
        projectId: data.row.projectId,
        securityCaseId: data.row.securityCaseId,
      });
    },
  };

export default class SecurityCasePullRequestFollower {
  // Every link still to follow, the longest-waiting first. Never throws.
  @CaptureSpan()
  public static async followAll(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    return await LinkedPullRequestFollower.followAll({
      kind: SECURITY_CASE_PULL_REQUESTS,
      now,
    });
  }

  // One link, now: one just linked that merged already. Never throws.
  @CaptureSpan()
  public static async followById(data: {
    projectId: ObjectID;
    id: ObjectID;
    now?: Date | undefined;
  }): Promise<PullRequestFollowed> {
    const row: SecurityCasePullRequest | null =
      await SecurityCasePullRequestService.findOneBy({
        query: { _id: data.id, projectId: data.projectId },
        select: FOLLOW_SELECT,
        props: { isRoot: true },
      });

    if (!row) {
      return { isChanged: false, isShipped: false };
    }

    return await SecurityCasePullRequestFollower.followOne({
      row,
      run: LinkedPullRequestFollower.newRun(data.now),
    });
  }

  /*
   * One link: its state while it is open, its deploy once merged. What
   * changed is written and said; a host that could not be read is read
   * again next time. Never throws.
   */
  public static async followOne(data: {
    row: SecurityCasePullRequest;
    run: VerifierRun;
  }): Promise<PullRequestFollowed> {
    if (!data.row.securityCaseId) {
      return { isChanged: false, isShipped: false };
    }

    const followed: PullRequestFollowed =
      await LinkedPullRequestFollower.followOne({
        kind: SECURITY_CASE_PULL_REQUESTS,
        row: data.row,
        run: data.run,
      });

    // What changed for the case: written, and shipped.
    return { isChanged: followed.isChanged, isShipped: followed.isShipped };
  }

  // The deploy that shipped it, on the case's timeline.
  public static async sayShipped(data: {
    row: SecurityCasePullRequest;
    deploy: FixDeploy;
  }): Promise<void> {
    const { row, deploy } = data;

    try {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: row.projectId!,
        securityCaseId: row.securityCaseId!,
        feedInfoInMarkdown: pullRequestShippedMarkdown({
          name: getPullRequestLinkName({
            owner: row.repoOrganizationName || "",
            repository: row.repoName || "",
            number: row.pullRequestNumber || 0,
          }),
          url: row.pullRequestUrl?.toString() || "",
          deploy: describeDeploy({
            version: deploy.version,
            commitSha: deploy.commitSha,
          }),
        }).toString(),
        eventType: SecurityCaseFeedEventType.ResponseAction,
        displayColor: Green500,
        postedAt: deploy.time,
      });
    } catch (error) {
      logger.error(
        `SecurityCasePullRequestFollower: could not say on its case that linked pull request ${row.id?.toString() || ""} shipped:`,
      );
      logger.error(error);
    }
  }
}
