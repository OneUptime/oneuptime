import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import FixProductionVerifier, {
  FixCommitSource,
  FixDeploy,
  VerifierRun,
} from "../../AI/CodeFix/FixProductionVerifier";
import logger from "../../Logger";
import { CodeHostPullRequestState } from "../CodeHost/CodeHostTypes";
import LinkedPullRequestReader from "./LinkedPullRequestReader";

/*
 * FOLLOWING A PULL REQUEST A PERSON LINKED, WHATEVER IT IS LINKED TO: the
 * one follower of a security case's Fix step links (#10604) and a Data
 * Security issue's (#10831), the way OneUptime follows the pull requests
 * it opens itself:
 *
 *   1. while it is open, its state is read through its repository's
 *      connection (LinkedPullRequestReader; SyncPullRequestStates reads
 *      OneUptime AI's): merged with the commit it merged as, or closed;
 *   2. once merged, a kind of link that finds its own deploy - a case's -
 *      has the deploys recorded since searched for one that contains its
 *      merge commit (FixProductionVerifier.findDeployContainingFix), for as
 *      long as OneUptime waits for an AI fix's deploy; a Data Security
 *      fix's deploy is its production check's to find, with the service it
 *      watches;
 *   3. what changed is written on the link's row, and its kind says so
 *      where it belongs - a case's steps checked, an issue's production
 *      check started.
 *
 * Each kind of link (LinkedPullRequestKind) says where its rows are kept
 * and what it does once something changed. Each link is followed in
 * isolation: one host that does not answer never stops the others, and is
 * read again next time.
 */

// What every linked pull request's row holds, whatever it is linked to.
export interface FollowedLink {
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | undefined;
  pullRequestState?: PullRequestState | undefined;
  pullRequestNumber?: number | undefined;
  codeRepository?: CodeRepository | undefined;
  mergeCommitSha?: string | undefined;
  mergedAt?: Date | undefined;
  deployedAt?: Date | undefined;
  repoOrganizationName?: string | undefined;
  repoName?: string | undefined;
}

// What following one link changed: written on its row, said where it belongs.
export interface PullRequestFollowed {
  isChanged: boolean;
  isShipped: boolean;
  // Read merged, or closed without merging, this time.
  isMerged?: boolean | undefined;
  isClosed?: boolean | undefined;
}

export interface LinkedPullRequestKind<T extends FollowedLink> {
  // What its links are called in a log line: "security case pull request".
  name: string;
  // Whether a merged link is matched to its deploy here, rather than by a production check.
  findsDeploy: boolean;
  // Every link of the kind still to follow now, the longest-waiting first.
  readToFollow: (now: Date) => Promise<Array<T>>;
  // Writes what the follower found; with nothing changed, only when it was followed.
  write: (data: {
    row: T;
    update: JSONObject;
    isChanged: boolean;
  }) => Promise<void>;
  // What else a merge writes on the row (a Data Security fix's production status).
  fieldsWhenMerged?: ((data: { row: T; now: Date }) => JSONObject) | undefined;
  // The deploy that shipped it, said where it belongs, as soon as it is found.
  onShipped?:
    | ((data: { row: T; deploy: FixDeploy }) => Promise<void>)
    | undefined;
  // Done once what changed is written. Its errors are logged, never thrown.
  afterChange?:
    | ((data: {
        row: T;
        followed: PullRequestFollowed;
        run: VerifierRun;
      }) => Promise<void>)
    | undefined;
}

export default class LinkedPullRequestFollower {
  // A run's shared state: its time, the tokens and compares it read once.
  public static newRun(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): VerifierRun {
    return {
      now,
      tokens: new Map<string, string | null>(),
      failedCompares: new Set<string>(),
    };
  }

  // Every link of a kind still to follow, the longest-waiting first. Never throws.
  public static async followAll<T extends FollowedLink>(data: {
    kind: LinkedPullRequestKind<T>;
    now?: Date | undefined;
  }): Promise<number> {
    const run: VerifierRun = LinkedPullRequestFollower.newRun(data.now);
    let rows: Array<T> = [];

    try {
      rows = await data.kind.readToFollow(run.now);
    } catch (error) {
      logger.error(
        `LinkedPullRequestFollower: could not read the ${data.kind.name}s to follow:`,
      );
      logger.error(error);
      return 0;
    }

    for (const row of rows) {
      await LinkedPullRequestFollower.followOne({ kind: data.kind, row, run });
    }

    return rows.length;
  }

  /*
   * One link: its state while it is open, its deploy once merged (for a
   * kind that finds it). What changed is written and said; a host that
   * could not be read is read again next time. Never throws.
   */
  public static async followOne<T extends FollowedLink>(data: {
    kind: LinkedPullRequestKind<T>;
    row: T;
    run: VerifierRun;
  }): Promise<PullRequestFollowed> {
    const { kind, row, run } = data;
    const followed: PullRequestFollowed = {
      isChanged: false,
      isShipped: false,
    };

    if (!row.id || !row.projectId) {
      return followed;
    }

    const update: JSONObject = { followedAt: run.now };

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
          followed.isMerged = read.state === PullRequestState.Merged;
          followed.isClosed = read.state === PullRequestState.Closed;
        }

        if (read.state === PullRequestState.Merged) {
          const mergedAt: Date = read.mergedAt || run.now;

          Object.assign(update, {
            mergedAt,
            ...(read.mergeCommitSha
              ? { mergeCommitSha: read.mergeCommitSha }
              : {}),
            ...(kind.fieldsWhenMerged
              ? kind.fieldsWhenMerged({ row, now: run.now })
              : {}),
          });
          row.mergedAt = mergedAt;

          if (read.mergeCommitSha) {
            row.mergeCommitSha = read.mergeCommitSha;
          }
        }
      }

      if (
        kind.findsDeploy &&
        row.pullRequestState === PullRequestState.Merged &&
        !row.deployedAt &&
        row.mergeCommitSha
      ) {
        const deploy: FixDeploy | null =
          await FixProductionVerifier.findDeployContainingFix({
            // Its project, merge commit and repository: what a deploy is matched by.
            fix: row as FixCommitSource,
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

          if (kind.onShipped) {
            await kind.onShipped({ row, deploy });
          }
        }
      }
    } catch (error) {
      logger.debug(
        `LinkedPullRequestFollower: could not follow ${kind.name} ${row.id.toString()}; it is followed again next time: ${String(error)}`,
      );
    }

    try {
      await kind.write({ row, update, isChanged: followed.isChanged });

      if (followed.isChanged && kind.afterChange) {
        Object.assign(row, update);
        await kind.afterChange({ row, followed, run });
      }
    } catch (error) {
      logger.error(
        `LinkedPullRequestFollower: could not write what it found of ${kind.name} ${row.id.toString()}:`,
      );
      logger.error(error);
    }

    return followed;
  }
}
