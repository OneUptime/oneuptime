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
import FixProductionVerifier, {
  FixDeploy,
  VerifierRun,
} from "../AI/CodeFix/FixProductionVerifier";
import {
  FIX_PRODUCTION_THRESHOLDS,
  describeDeploy,
} from "../AI/CodeFix/FixProductionVerdict";
import { CODE_HOST_REPOSITORY_SELECT } from "../CodeRepository/CodeHost/CodeHostAccess";
import { CodeHostPullRequestState } from "../CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestReader from "../CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
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
export interface PullRequestFollowed {
  isChanged: boolean;
  isShipped: boolean;
}

export default class SecurityCasePullRequestFollower {
  // Every link still to follow, the longest-waiting first. Never throws.
  @CaptureSpan()
  public static async followAll(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const run: VerifierRun = {
      now,
      tokens: new Map<string, string | null>(),
      failedCompares: new Set<string>(),
    };
    let rows: Array<SecurityCasePullRequest> = [];

    try {
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

      rows = [...open, ...merged];
    } catch (error) {
      logger.error(
        "SecurityCasePullRequestFollower: could not read the linked pull requests to follow:",
      );
      logger.error(error);
      return 0;
    }

    for (const row of rows) {
      await SecurityCasePullRequestFollower.followOne({ row, run });
    }

    return rows.length;
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
      run: {
        now: data.now || OneUptimeDate.getCurrentDate(),
        tokens: new Map<string, string | null>(),
        failedCompares: new Set<string>(),
      },
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
    const { row, run } = data;
    const followed: PullRequestFollowed = {
      isChanged: false,
      isShipped: false,
    };

    if (!row.id || !row.projectId || !row.securityCaseId) {
      return followed;
    }

    const update: PartialEntity<SecurityCasePullRequest> = {
      followedAt: run.now,
    } as PartialEntity<SecurityCasePullRequest>;

    try {
      if (
        row.pullRequestState === PullRequestState.Open &&
        row.codeRepository &&
        row.pullRequestNumber
      ) {
        const read: CodeHostPullRequestState =
          await LinkedPullRequestReader.readState({
            repository: row.codeRepository,
            number: row.pullRequestNumber,
          });

        if (read.state !== PullRequestState.Open) {
          Object.assign(update, { pullRequestState: read.state });
          row.pullRequestState = read.state;
          followed.isChanged = true;
        }

        if (read.state === PullRequestState.Merged) {
          const mergedAt: Date = read.mergedAt || run.now;

          Object.assign(update, {
            mergedAt,
            ...(read.mergeCommitSha
              ? { mergeCommitSha: read.mergeCommitSha }
              : {}),
          });
          row.mergedAt = mergedAt;

          if (read.mergeCommitSha) {
            row.mergeCommitSha = read.mergeCommitSha;
          }
        }
      }

      if (
        row.pullRequestState === PullRequestState.Merged &&
        !row.deployedAt &&
        row.mergeCommitSha
      ) {
        const deploy: FixDeploy | null =
          await FixProductionVerifier.findDeployContainingFix({
            fix: row,
            mergedAt: row.mergedAt ? new Date(row.mergedAt) : run.now,
            run,
          });

        if (deploy) {
          Object.assign(update, {
            deployedAt: deploy.time,
            ...(deploy.version ? { deployedVersion: deploy.version } : {}),
            deployedCommitSha: deploy.commitSha,
          });
          followed.isChanged = true;
          followed.isShipped = true;

          await SecurityCasePullRequestFollower.sayShipped({ row, deploy });
        }
      }
    } catch (error) {
      logger.debug(
        `SecurityCasePullRequestFollower: could not follow linked pull request ${row.id.toString()}; it is followed again next time: ${String(error)}`,
      );
    }

    try {
      await SecurityCasePullRequestService.updateColumnsByIdWithoutHooks({
        id: row.id,
        data: update,
        skipUpdateDateColumn: !followed.isChanged,
      });

      // The Fix step reads the case's fixes: OneUptime looks at it now.
      if (followed.isChanged) {
        await SecurityCaseStepChecks.requestCheck({
          projectId: row.projectId,
          securityCaseId: row.securityCaseId,
        });
      }
    } catch (error) {
      logger.error(
        `SecurityCasePullRequestFollower: could not write what it found of linked pull request ${row.id.toString()}:`,
      );
      logger.error(error);
    }

    return followed;
  }

  // The deploy that shipped it, on the case's timeline.
  private static async sayShipped(data: {
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
