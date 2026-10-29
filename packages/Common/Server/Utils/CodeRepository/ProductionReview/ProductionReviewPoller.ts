import GlobalCache from "../../../Infrastructure/GlobalCache";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CODE_HOST_REPOSITORY_SELECT } from "../CodeHost/CodeHostAccess";
import { CodeHostPullRequestDetails } from "../CodeHost/CodeHostTypes";
import ProductionReviewHosts, {
  AuthorWriteAccess,
  isBotLogin,
  PolledReviewHost,
  UpdatedPullRequests,
} from "./ProductionReviewHost";
import ProductionReviewQueue from "./ProductionReviewQueue";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  getProductionReviewTaskContext,
  ProductionReviewTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewTrigger } from "../../../../Types/CodeRepository/ProductionReview";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * FINDING THE PULL REQUESTS OF GITLAB, FORGEJO AND GITEA TO REVIEW.
 *
 * GitHub tells OneUptime of a pull request through the App's webhooks
 * (ProductionReviewGitHubTrigger). A GitLab, Forgejo or Gitea repository is
 * connected with an access token and sends nothing, so OneUptime asks:
 * every minute, each such repository with Production Review on is read for
 * its open pull (merge) requests that changed since its last poll - one
 * request for most - and a review is asked for each whose head is new,
 * under the rules GitHub's trigger keeps, cheapest first:
 *
 *   - it is open and not a draft;
 *   - it is not OneUptime's own (its connection's account, on a branch AI
 *     pushes) and not a bot's;
 *   - its branch is in the repository itself: whoever pushes to such a
 *     branch can write to the repository, where a fork's pushes come from
 *     whoever has the fork, and a head pushed with AGit (Forgejo's and
 *     Gitea's refs/for/main) from anyone who may read it;
 *   - its head is not one a review was already asked for;
 *   - its author can write to the repository - Developer or more on
 *     GitLab, write on Forgejo and Gitea - as the host says now. Forgejo
 *     and Gitea tell it only to the repository's administrators: with a
 *     token whose account only writes, the branch rule above is the rule.
 *
 * Anyone else's pull request - an outside contributor's, a fork's, a bot's
 * - is reviewed when someone who may ask AI in the repository presses
 * Review again in Code. Nothing is said on a pull request that is not
 * reviewed.
 *
 * Where a repository's poll got to is kept in the cache. Each poll reads
 * from a little before it (two servers' clocks differ), and after an outage
 * at most a day back; with no cache it starts a few minutes back. A head a
 * review was asked for is never asked for again, so reading too much costs
 * a request, never a review.
 */

// A poll reads from this long before where the last one got to.
export const POLL_OVERLAP_SECONDS: number = 5 * 60;

// The first poll of a repository, or one with no cache, starts this far back.
export const POLL_FIRST_LOOKBACK_SECONDS: number = 15 * 60;

// However long ago the last poll was, a poll reads at most this far back.
export const POLL_MAX_LOOKBACK_SECONDS: number = 24 * 60 * 60;

// The repositories one tick polls: the least recently polled first.
export const POLLED_REPOSITORIES_PER_TICK: number = 200;

// Repositories polled at once.
const POLL_CONCURRENCY: number = 5;

/*
 * A tick starts no more polls after this long, so a slow server cannot hold
 * the next minute's tick back: the repositories it did not reach go first
 * then.
 */
export const POLL_TICK_BUDGET_MS: number = 4 * 60 * 1000;

// A host's answer to whether an author may write, kept this long.
export const AUTHOR_TRUST_CACHE_SECONDS: number = 10 * 60;

const CURSOR_NAMESPACE: string = "production-review-poll";
const TRUST_NAMESPACE: string = "production-review-author-trust";

// The hosts whose pull requests are polled for.
export const POLLED_HOSTS: ReadonlyArray<CodeRepositoryType> = [
  CodeRepositoryType.GitLab,
  CodeRepositoryType.Forgejo,
];

// Why a pull request the poll read was, or was not, asked about.
export enum ProductionReviewPollOutcome {
  Asked = "Asked",
  NotOpen = "NotOpen",
  Draft = "Draft",
  OwnPullRequest = "OwnPullRequest",
  Bot = "Bot",
  // A fork's, or (Forgejo, Gitea) one whose head is no branch: AGit's.
  Fork = "Fork",
  AlreadyAsked = "AlreadyAsked",
  AuthorCannotWrite = "AuthorCannotWrite",
}

// How the cache keeps what a host said of an author.
const AUTHOR_WRITE_ACCESS_KEPT: Record<AuthorWriteAccess, string> = {
  [AuthorWriteAccess.CanWrite]: "1",
  [AuthorWriteAccess.CannotWrite]: "0",
  [AuthorWriteAccess.NotSaid]: "?",
};

export interface ProductionReviewPollResult {
  repositories: number;
  asked: number;
}

export default class ProductionReviewPoller {
  /*
   * Every GitLab, Forgejo and Gitea repository with Production Review on,
   * polled - a few at a time, the least recently polled first. Never
   * throws: one repository that cannot be read does not stop the rest.
   */
  @CaptureSpan()
  public static async pollAll(): Promise<ProductionReviewPollResult> {
    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          repositoryHostedAt: QueryHelper.any(
            POLLED_HOSTS.map((type: CodeRepositoryType): string => {
              return type.toString();
            }),
          ),
          isProductionReviewEnabled: true,
        } as never,
        select: {
          ...CODE_HOST_REPOSITORY_SELECT,
          isProductionReviewEnabled: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const ordered: Array<CodeRepository> =
      await ProductionReviewPoller.leastRecentlyPolledFirst(repositories);
    const now: Date = OneUptimeDate.getCurrentDate();
    const startedAt: number = Date.now();
    let asked: number = 0;
    let polled: number = 0;

    for (
      let start: number = 0;
      start < ordered.length &&
      polled < POLLED_REPOSITORIES_PER_TICK &&
      Date.now() - startedAt < POLL_TICK_BUDGET_MS;
      start += POLL_CONCURRENCY
    ) {
      const batch: Array<CodeRepository> = ordered.slice(
        start,
        Math.min(start + POLL_CONCURRENCY, ordered.length),
      );

      const counts: Array<number> = await Promise.all(
        batch.map(async (repository: CodeRepository): Promise<number> => {
          try {
            return await ProductionReviewPoller.pollRepository(repository, now);
          } catch (error) {
            logger.info(
              `Production review poll of repository ${repository.id?.toString()} failed; it is read again next minute: ${error instanceof Error ? error.message : String(error)}`,
            );
            return 0;
          }
        }),
      );

      polled += batch.length;
      asked += counts.reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0);
    }

    return { repositories: polled, asked };
  }

  /*
   * One repository: its open pull requests that changed since its last
   * poll, and a review asked for each that needs one. How many were asked
   * for. Throws when its host could not be read: the poll starts from the
   * same place next time.
   */
  @CaptureSpan()
  public static async pollRepository(
    repository: CodeRepository,
    now: Date,
  ): Promise<number> {
    if (!repository.id || !repository.projectId) {
      return 0;
    }

    if (repository.isProductionReviewEnabled !== true) {
      return 0;
    }

    const host: PolledReviewHost | null =
      await ProductionReviewHosts.openPolled(repository);

    if (!host) {
      // Not connected now: its repository's pages say why.
      return 0;
    }

    const since: Date = await ProductionReviewPoller.readStart(
      repository.id,
      now,
    );

    const updated: UpdatedPullRequests =
      await host.listUpdatedPullRequests(since);

    let asked: number = 0;

    for (const pullRequest of updated.pullRequests) {
      const outcome: ProductionReviewPollOutcome =
        await ProductionReviewPoller.consider({
          repository,
          host,
          pullRequest,
        });

      if (outcome === ProductionReviewPollOutcome.Asked) {
        asked++;
      }
    }

    await ProductionReviewPoller.writeCursor(
      repository.id,
      ProductionReviewPoller.getNextCursor({
        since,
        now,
        continueFrom: updated.continueFrom,
      }),
    );

    return asked;
  }

  /*
   * Where the next poll goes on from: now - or, when the host stopped at a
   * page short of the newest, the last pull request it listed (the next
   * poll starts there, the overlap taken back). A page that moved nothing
   * on - every one of them changed in the same moment - goes on from now,
   * so a poll never reads the same page forever.
   */
  public static getNextCursor(data: {
    since: Date;
    now: Date;
    continueFrom: Date | null;
  }): Date {
    if (
      !data.continueFrom ||
      data.continueFrom.getTime() <= data.since.getTime() ||
      data.continueFrom.getTime() >= data.now.getTime()
    ) {
      return data.now;
    }

    return OneUptimeDate.addRemoveSeconds(
      data.continueFrom,
      POLL_OVERLAP_SECONDS,
    );
  }

  // One pull request the poll read: a review asked for, or why not.
  public static async consider(data: {
    repository: CodeRepository;
    host: PolledReviewHost;
    pullRequest: CodeHostPullRequestDetails;
  }): Promise<ProductionReviewPollOutcome> {
    const pullRequest: CodeHostPullRequestDetails = data.pullRequest;

    if (!pullRequest.isOpen || !pullRequest.headSha) {
      return ProductionReviewPollOutcome.NotOpen;
    }

    if (pullRequest.isDraft) {
      return ProductionReviewPollOutcome.Draft;
    }

    if (data.host.isOwnPullRequest(pullRequest)) {
      return ProductionReviewPollOutcome.OwnPullRequest;
    }

    if (isBotLogin(pullRequest.authorLogin)) {
      return ProductionReviewPollOutcome.Bot;
    }

    if (pullRequest.isFromFork) {
      return ProductionReviewPollOutcome.Fork;
    }

    const task: AIRun | null = await ProductionReviewQueue.findTask({
      projectId: data.repository.projectId!,
      codeRepositoryId: data.repository.id!,
      pullRequestNumber: pullRequest.number,
      provider: data.host.provider,
    });

    const askedBefore: ProductionReviewTaskContext | null =
      getProductionReviewTaskContext(task?.taskContext);

    if (askedBefore && askedBefore.headSha === pullRequest.headSha) {
      return ProductionReviewPollOutcome.AlreadyAsked;
    }

    /*
     * A host that will not say goes by the branch, checked above: only
     * someone who can write pushes a branch of the repository itself.
     */
    if (
      (await ProductionReviewPoller.getAuthorWriteAccess({
        repositoryId: data.repository.id!,
        host: data.host,
        pullRequest,
      })) === AuthorWriteAccess.CannotWrite
    ) {
      return ProductionReviewPollOutcome.AuthorCannotWrite;
    }

    await ProductionReviewQueue.request({
      projectId: data.repository.projectId!,
      codeRepositoryId: data.repository.id!,
      provider: data.host.provider as
        | CodeRepositoryType.GitLab
        | CodeRepositoryType.Forgejo,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.htmlUrl || undefined,
      headSha: pullRequest.headSha,
      isFromFork: false,
      trigger: ProductionReviewTrigger.PullRequestChanged,
      isAuthorTrusted: true,
      requestedByLogin: pullRequest.authorLogin || undefined,
    });

    logger.debug(
      `Production review of repository ${data.repository.id!.toString()} ${data.host.pullRequestTerm} ${pullRequest.number} asked for (its head is ${pullRequest.headSha}).`,
    );

    return ProductionReviewPollOutcome.Asked;
  }

  /*
   * What a pull request's host says of whether its author may write to
   * the repository - kept a few minutes, so a busy repository asks once for
   * an author, not once a minute. A cache that cannot be reached asks the
   * host; a host that could not be read, or an author with no name, is
   * CannotWrite: nothing is reviewed on a guess.
   */
  public static async getAuthorWriteAccess(data: {
    repositoryId: ObjectID;
    host: PolledReviewHost;
    pullRequest: CodeHostPullRequestDetails;
  }): Promise<AuthorWriteAccess> {
    const author: string =
      data.pullRequest.authorId || data.pullRequest.authorLogin.toLowerCase();

    if (!author) {
      return AuthorWriteAccess.CannotWrite;
    }

    const key: string = `${data.repositoryId.toString()}:${author}`;

    try {
      const kept: string | null = await GlobalCache.getString(
        TRUST_NAMESPACE,
        key,
      );

      for (const access of Object.values(AuthorWriteAccess)) {
        if (kept === AUTHOR_WRITE_ACCESS_KEPT[access]) {
          return access;
        }
      }
    } catch (error) {
      logger.debug(error);
    }

    let access: AuthorWriteAccess = AuthorWriteAccess.CannotWrite;

    try {
      access = await data.host.getAuthorWriteAccess(data.pullRequest);
    } catch (error) {
      logger.debug(
        `Production review poll: could not read whether ${data.pullRequest.authorLogin} may write: ${error}`,
      );
      return AuthorWriteAccess.CannotWrite;
    }

    try {
      await GlobalCache.setString(
        TRUST_NAMESPACE,
        key,
        AUTHOR_WRITE_ACCESS_KEPT[access],
        { expiresInSeconds: AUTHOR_TRUST_CACHE_SECONDS },
      );
    } catch (error) {
      logger.debug(error);
    }

    return access;
  }

  /*
   * Where a repository's poll starts: a little before where its last one
   * got to - at most a day back - or, the first time, a few minutes back.
   */
  public static async readStart(
    repositoryId: ObjectID,
    now: Date,
  ): Promise<Date> {
    const earliest: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -POLL_MAX_LOOKBACK_SECONDS,
    );
    let last: Date | null = null;

    try {
      const kept: string | null = await GlobalCache.getString(
        CURSOR_NAMESPACE,
        repositoryId.toString(),
      );
      const time: number = kept ? Date.parse(kept) : NaN;

      if (Number.isFinite(time)) {
        last = new Date(time);
      }
    } catch (error) {
      logger.debug(error);
    }

    if (!last) {
      return OneUptimeDate.addRemoveSeconds(now, -POLL_FIRST_LOOKBACK_SECONDS);
    }

    const start: Date = OneUptimeDate.addRemoveSeconds(
      last,
      -POLL_OVERLAP_SECONDS,
    );

    return start.getTime() < earliest.getTime() ? earliest : start;
  }

  private static async writeCursor(
    repositoryId: ObjectID,
    now: Date,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        CURSOR_NAMESPACE,
        repositoryId.toString(),
        now.toISOString(),
        { expiresInSeconds: POLL_MAX_LOOKBACK_SECONDS * 2 },
      );
    } catch (error) {
      logger.debug(error);
    }
  }

  /*
   * The repositories in the order a tick polls them: the ones polled
   * longest ago - or never - first, so a tick that reaches its limit leaves
   * the most recently polled for the next one. A cache that cannot be read
   * keeps their order.
   */
  private static async leastRecentlyPolledFirst(
    repositories: Array<CodeRepository>,
  ): Promise<Array<CodeRepository>> {
    if (repositories.length <= POLLED_REPOSITORIES_PER_TICK) {
      return repositories;
    }

    let times: Array<string | null> = [];

    try {
      times = await GlobalCache.getStrings(
        CURSOR_NAMESPACE,
        repositories.map((repository: CodeRepository): string => {
          return repository.id?.toString() || "";
        }),
      );
    } catch (error) {
      logger.debug(error);
      return repositories;
    }

    return repositories
      .map((repository: CodeRepository, index: number) => {
        const time: number = Date.parse(times[index] || "");

        return {
          repository,
          polledAt: Number.isFinite(time) ? time : 0,
        };
      })
      .sort(
        (
          first: { polledAt: number },
          second: { polledAt: number },
        ): number => {
          return first.polledAt - second.polledAt;
        },
      )
      .map((entry: { repository: CodeRepository }): CodeRepository => {
        return entry.repository;
      });
  }
}
