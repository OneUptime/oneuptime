import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import LIMIT_MAX, {
  LIMIT_PER_PROJECT,
} from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  ChangeEventFields,
  ChangeEventSource,
  readChangeEventFields,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import ChangeEventService from "../../../Services/ChangeEventService";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import GitHubUtil, {
  GitHubInstallationToken,
} from "../../CodeRepository/GitHub/GitHub";
import GitHubCommits, {
  GitHubCommitRange,
  GitHubRepositoryName,
} from "../../CodeRepository/GitHub/GitHubCommits";
import GitHubInstallationBinding from "../../CodeRepository/GitHub/GitHubInstallationBinding";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  decideDeployWait,
  decideWatchVerdict,
  deployContainsFix,
  describeDeploy,
} from "./FixProductionVerdict";

/*
 * Fix verified in production - the last step of an AI fix.
 *
 * A merged fix pull request has fixed nothing until it runs. Every merged
 * fix for an exception (FixException) is followed here until it is decided:
 *
 *   1. AwaitingDeploy: the deploys recorded since the merge for the
 *      exception's service, or for the whole project (change events:
 *      telemetry, Kubernetes, `oneuptime deploy`), are searched for one that
 *      contains the fix's merge commit - the same commit, or a later one by
 *      GitHub's compare. None within maxDeployWaitDays is Unverifiable.
 *   2. Watching: the exception is counted in the deployed fix - in the
 *      deploy's version when it reports one, else after the rollout grace -
 *      against how often it happened in the week before the merge
 *      (FixProductionVerdict.decideWatchVerdict).
 *   3. Verified, Regressed or Unverifiable is final. A verified fix resolves
 *      the exception; a regressed one reopens it.
 *
 * Runs on the Workers' schedule, as the system, every tenant's rows held to
 * their own project. Each fix is checked in isolation: one failing GitHub
 * call or query never stops the others, and a fix that could not be checked,
 * or that a run had no time left for, is checked again next time.
 */

/*
 * How long one run starts new checks for: inside the Workers' five-minute
 * job timeout. The fixes a run has no time left for are checked next run,
 * after the ones before them, which go faster by then: their compares are
 * known.
 */
export const RUN_TIME_BUDGET_MS: number = 4 * 60 * 1000;

/*
 * The most GitHub compares one check of one fix makes. Answers are
 * remembered, so the next check carries on past the deploys compared
 * before.
 */
export const MAX_GITHUB_COMPARES_PER_FIX: number = 10;

// The most compare answers remembered; past it, the oldest are forgotten.
export const MAX_KNOWN_COMPARES: number = 10000;

// The most change events read for one fix, from each scope it reads.
const MAX_CHANGES_READ: number = 200;

// AIAgentTaskPullRequest.deployedVersion is a short text column.
const MAX_DEPLOYED_VERSION_LENGTH: number = 100;

// Changes OneUptime made itself are not deploys of the fix.
const OWN_CHANGE_SOURCES: Array<string> = [
  ChangeEventSource.OneUptimeAi,
  ChangeEventSource.Runbook,
];

// How GitHub's compare relates two commits.
const COMPARE_STATUSES: Array<string> = [
  "ahead",
  "behind",
  "identical",
  "diverged",
];

/*
 * GitHub's answers about a fix's commit and a deploy's, by project,
 * repository and commits. Two commits' ancestry never changes, so an answer
 * holds for good: remembered across runs, a deploy is compared with a fix
 * once, not every run for two weeks. "" is GitHub knowing no such commit in
 * the repository, or no history the two share.
 */
const knownCompares: Map<string, string> = new Map<string, string>();

// A recorded deploy that contains the fix.
export interface FixDeploy {
  changeId: string;
  time: Date;
  version?: string | undefined;
  commitSha: string;
}

export interface VerifierRun {
  now: Date;
  // An installation's GitHub token, or null when it cannot be used.
  tokens: Map<string, string | null>;
  // Compares GitHub could not answer this run: asked again next run.
  failedCompares: Set<string>;
}

export default class FixProductionVerifier {
  // Checks every merged fix that is not decided yet. Never throws.
  @CaptureSpan()
  public static async verifyAll(): Promise<void> {
    const run: VerifierRun = {
      now: OneUptimeDate.getCurrentDate(),
      tokens: new Map<string, string | null>(),
      failedCompares: new Set<string>(),
    };

    let fixes: Array<AIAgentTaskPullRequest> = [];

    try {
      fixes = await AIAgentTaskPullRequestService.findBy({
        query: {
          pullRequestState: PullRequestState.Merged,
          productionStatus: QueryHelper.any([
            FixProductionStatus.AwaitingDeploy,
            FixProductionStatus.Watching,
          ]),
        } as never,
        select: FixProductionVerifier.fixSelect(),
        sort: { productionStatusAt: SortOrder.Ascending } as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Fix verification: could not read the merged fixes to check: ${error}`,
      );
      return;
    }

    for (let index: number = 0; index < fixes.length; index++) {
      if (
        OneUptimeDate.getCurrentDate().getTime() - run.now.getTime() >=
        RUN_TIME_BUDGET_MS
      ) {
        logger.warn(
          `Fix verification: out of time with ${fixes.length - index} fix pull request(s) not checked; they are checked next time.`,
        );
        return;
      }

      const fix: AIAgentTaskPullRequest = fixes[index]!;

      try {
        await FixProductionVerifier.verifyFix(fix, run);
      } catch (error) {
        logger.error(
          `Fix verification: could not check fix pull request ${fix.id?.toString()}; it is checked again next time: ${error}`,
        );
      }
    }
  }

  // One fix's check: find its deploy, then watch its exception.
  public static async verifyFix(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const exception: TelemetryException | null =
      await FixProductionVerifier.readException(fix);

    if (!exception || !exception.fingerprint) {
      await FixProductionVerifier.settle(fix, run, {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The exception this fix was opened for no longer exists, so it cannot be watched.",
      });
      return;
    }

    const mergedAt: Date = fix.mergedAt
      ? new Date(fix.mergedAt)
      : fix.productionStatusAt
        ? new Date(fix.productionStatusAt)
        : new Date(fix.createdAt || run.now);

    let deployedAt: Date | undefined = fix.deployedAt
      ? new Date(fix.deployedAt)
      : undefined;
    let deployedVersion: string | undefined = fix.deployedVersion || undefined;
    let deployedCommitSha: string | undefined =
      fix.deployedCommitSha || undefined;
    let isNewDeploy: boolean = false;

    if (fix.productionStatus !== FixProductionStatus.Watching || !deployedAt) {
      if (!fix.mergeCommitSha) {
        await FixProductionVerifier.settle(fix, run, {
          status: FixProductionStatus.Unverifiable,
          summary:
            "GitHub did not say which commit the pull request merged as, so no deploy can be matched to the fix.",
        });
        return;
      }

      const deploy: FixDeploy | null =
        await FixProductionVerifier.findDeployContainingFix({
          fix,
          exception,
          mergedAt,
          run,
        });

      if (!deploy) {
        const waited: FixProductionVerdict | null = decideDeployWait({
          mergedAt,
          now: run.now,
        });

        if (waited) {
          await FixProductionVerifier.settle(fix, run, waited);
        }
        return;
      }

      deployedAt = deploy.time;
      deployedVersion = deploy.version;
      deployedCommitSha = deploy.commitSha;
      isNewDeploy = true;
    }

    const [occurrencesSinceDeploy, baselineOccurrences]: [number, number] =
      await Promise.all([
        FixProductionVerifier.countOccurrencesSinceDeploy({
          exception,
          deployedAt,
          deployedVersion,
          now: run.now,
        }),
        FixProductionVerifier.countOccurrences({
          exception,
          start: OneUptimeDate.addRemoveDays(
            mergedAt,
            -FIX_PRODUCTION_THRESHOLDS.baselineDays,
          ),
          end: mergedAt,
        }),
      ]);

    const verdict: FixProductionVerdict = decideWatchVerdict({
      deployedAt,
      now: run.now,
      occurrencesSinceDeploy,
      baselineOccurrences,
      // The same words every check, so an unchanged watch writes nothing.
      deployLabel: describeDeploy({
        version: deployedVersion,
        commitSha: deployedCommitSha,
      }),
    });

    await FixProductionVerifier.settle(
      fix,
      run,
      verdict,
      isNewDeploy
        ? { deployedAt, deployedVersion, deployedCommitSha }
        : undefined,
    );

    if (verdict.status === FixProductionStatus.Verified) {
      await FixProductionVerifier.markException(exception, true, run.now);
    } else if (verdict.status === FixProductionStatus.Regressed) {
      await FixProductionVerifier.markException(exception, false, run.now);
    }
  }

  /*
   * The first deploy of the exception's service (or a deploy of the whole
   * project) recorded since the merge that contains the fix's commit.
   */
  public static async findDeployContainingFix(data: {
    fix: AIAgentTaskPullRequest;
    exception: TelemetryException;
    mergedAt: Date;
    run: VerifierRun;
  }): Promise<FixDeploy | null> {
    const fixCommitSha: string = data.fix.mergeCommitSha!;
    const repository: GitHubRepositoryName | null =
      FixProductionVerifier.repositoryOf(data.fix);

    const rows: Array<ChangeEvent> =
      await FixProductionVerifier.readChangesSinceMerge({
        projectId: data.fix.projectId!,
        serviceId: data.exception.primaryEntityId,
        mergedAt: data.mergedAt,
        now: data.run.now,
      });

    let gitHubCompares: number = 0;

    for (const row of rows) {
      const fields: ChangeEventFields = readChangeEventFields(
        (row.attributes as Dictionary<unknown>) || {},
      );

      if (
        !fields.commitSha ||
        !GitHubCommits.isCommitSha(fields.commitSha) ||
        OWN_CHANGE_SOURCES.includes(fields.source || "") ||
        !FixProductionVerifier.isSameRepository(
          repository,
          fields.repositoryUrl,
        )
      ) {
        continue;
      }

      const deploy: FixDeploy = {
        changeId: row._id?.toString() || "",
        time: new Date(row.time!),
        // Held to its column's length.
        version: fields.version?.slice(0, MAX_DEPLOYED_VERSION_LENGTH),
        commitSha: fields.commitSha,
      };

      if (
        deployContainsFix({
          deployCommitSha: deploy.commitSha,
          fixCommitSha,
        })
      ) {
        return deploy;
      }

      if (!repository) {
        continue;
      }

      const key: string = FixProductionVerifier.compareKey({
        fix: data.fix,
        repository,
        fixCommitSha,
        deployCommitSha: deploy.commitSha,
      });
      let compareStatus: string | undefined =
        FixProductionVerifier.knownCompare(key);

      if (compareStatus === undefined) {
        if (
          gitHubCompares >= MAX_GITHUB_COMPARES_PER_FIX ||
          data.run.failedCompares.has(key)
        ) {
          continue;
        }

        gitHubCompares++;
        compareStatus = await FixProductionVerifier.compare({
          fix: data.fix,
          repository,
          fixCommitSha,
          deployCommitSha: deploy.commitSha,
          key,
          run: data.run,
        });
      }

      if (
        deployContainsFix({
          deployCommitSha: deploy.commitSha,
          fixCommitSha,
          compareStatus,
        })
      ) {
        return deploy;
      }
    }

    return null;
  }

  /*
   * Occurrences of the exception in the deployed fix: in its version when
   * the deploy reported one - so old pods still draining do not count - and
   * otherwise from the rollout grace after it on.
   */
  public static async countOccurrencesSinceDeploy(data: {
    exception: TelemetryException;
    deployedAt: Date;
    deployedVersion?: string | undefined;
    now: Date;
  }): Promise<number> {
    if (data.deployedVersion) {
      return FixProductionVerifier.countOccurrences({
        exception: data.exception,
        start: data.deployedAt,
        end: data.now,
        release: data.deployedVersion,
      });
    }

    return FixProductionVerifier.countOccurrences({
      exception: data.exception,
      start: OneUptimeDate.addRemoveMinutes(
        data.deployedAt,
        FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
      ),
      end: data.now,
    });
  }

  // A compare answer remembered from an earlier check, if any.
  public static knownCompare(key: string): string | undefined {
    return knownCompares.get(key);
  }

  // Remembers a compare answer for good, forgetting the oldest past the cap.
  public static rememberCompare(key: string, status: string): void {
    knownCompares.set(key, status);

    if (knownCompares.size > MAX_KNOWN_COMPARES) {
      const oldest: string | undefined = knownCompares.keys().next().value;

      if (oldest !== undefined) {
        knownCompares.delete(oldest);
      }
    }
  }

  // Forgets every compare answer, as a restarted worker would.
  public static forgetCompares(): void {
    knownCompares.clear();
  }

  /*
   * The changes recorded since the merge, oldest first: the exception's
   * service's and the whole project's, read apart so that a busy project's
   * other services cannot crowd the fix's deploy out of the read. An
   * exception with no service reads every change of the project.
   */
  private static async readChangesSinceMerge(data: {
    projectId: ObjectID;
    serviceId?: ObjectID | undefined;
    mergedAt: Date;
    now: Date;
  }): Promise<Array<ChangeEvent>> {
    const scopes: Array<Dictionary<ObjectID | IsNull>> = data.serviceId
      ? [{ primaryEntityId: data.serviceId }, { primaryEntityId: new IsNull() }]
      : [{}];

    const reads: Array<Array<ChangeEvent>> = await Promise.all(
      scopes.map(
        (scope: Dictionary<ObjectID | IsNull>): Promise<Array<ChangeEvent>> => {
          return ChangeEventService.findBy({
            query: {
              projectId: data.projectId,
              time: new InBetween(data.mergedAt, data.now),
              ...scope,
            } as never,
            select: {
              _id: true,
              time: true,
              primaryEntityId: true,
              attributes: true,
            } as never,
            sort: { time: SortOrder.Ascending } as never,
            limit: MAX_CHANGES_READ,
            skip: 0,
            props: { isRoot: true },
          });
        },
      ),
    );

    return reads
      .flat()
      .filter((row: ChangeEvent): boolean => {
        return Boolean(row.time);
      })
      .sort((a: ChangeEvent, b: ChangeEvent): number => {
        return new Date(a.time!).getTime() - new Date(b.time!).getTime();
      });
  }

  private static async countOccurrences(data: {
    exception: TelemetryException;
    start: Date;
    end: Date;
    release?: string | undefined;
  }): Promise<number> {
    if (data.end.getTime() <= data.start.getTime()) {
      return 0;
    }

    const count: PositiveNumber = await ExceptionInstanceService.countBy({
      query: {
        projectId: data.exception.projectId,
        fingerprint: data.exception.fingerprint,
        time: new InBetween(data.start, data.end),
        ...(data.release ? { release: data.release } : {}),
      } as never,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return count.toNumber();
  }

  private static async readException(
    fix: AIAgentTaskPullRequest,
  ): Promise<TelemetryException | null> {
    if (!fix.aiRunId) {
      return null;
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: fix.aiRunId,
      select: { _id: true, triggeredByTelemetryExceptionId: true },
      props: { isRoot: true },
    });

    if (!run?.triggeredByTelemetryExceptionId) {
      return null;
    }

    return await TelemetryExceptionService.findOneBy({
      query: {
        _id: run.triggeredByTelemetryExceptionId.toString(),
        projectId: fix.projectId!,
      },
      select: {
        _id: true,
        projectId: true,
        fingerprint: true,
        primaryEntityId: true,
        isResolved: true,
      },
      props: { isRoot: true },
    });
  }

  private static repositoryOf(
    fix: AIAgentTaskPullRequest,
  ): GitHubRepositoryName | null {
    const owner: string | undefined =
      fix.repoOrganizationName || fix.codeRepository?.organizationName;
    const name: string | undefined =
      fix.repoName || fix.codeRepository?.repositoryName;

    return owner && name ? { owner, name } : null;
  }

  // A deploy that names another repository is not a deploy of this fix.
  private static isSameRepository(
    repository: GitHubRepositoryName | null,
    repositoryUrl: string | undefined,
  ): boolean {
    if (!repository || !repositoryUrl) {
      return true;
    }

    const named: GitHubRepositoryName | null =
      GitHubCommits.parseRepositoryName(repositoryUrl);

    if (!named) {
      return true;
    }

    return (
      named.owner.toLowerCase() === repository.owner.toLowerCase() &&
      named.name.toLowerCase() === repository.name.toLowerCase()
    );
  }

  // The fix's own project, repository and commits: never shared between projects.
  private static compareKey(data: {
    fix: AIAgentTaskPullRequest;
    repository: GitHubRepositoryName;
    fixCommitSha: string;
    deployCommitSha: string;
  }): string {
    return `${data.fix.projectId?.toString()}:${data.repository.owner}/${data.repository.name}:${data.fixCommitSha}...${data.deployCommitSha}`.toLowerCase();
  }

  /*
   * GitHub's compare of the fix's commit with a deploy's. An answer is
   * remembered for good; a failure (no token, a rate limit, GitHub down) is
   * asked again next run.
   */
  private static async compare(data: {
    fix: AIAgentTaskPullRequest;
    repository: GitHubRepositoryName;
    fixCommitSha: string;
    deployCommitSha: string;
    key: string;
    run: VerifierRun;
  }): Promise<string | undefined> {
    const token: string | null = await FixProductionVerifier.tokenFor(
      data.fix,
      data.run,
    );

    if (token) {
      try {
        const range: GitHubCommitRange = await GitHubCommits.compare({
          token,
          owner: data.repository.owner,
          repository: data.repository.name,
          base: data.fixCommitSha,
          head: data.deployCommitSha,
        });

        if (COMPARE_STATUSES.includes(range.status)) {
          FixProductionVerifier.rememberCompare(data.key, range.status);
          return range.status;
        }
      } catch (error) {
        if (
          error instanceof HTTPErrorResponse &&
          (error.statusCode === 404 || error.statusCode === 422)
        ) {
          // No such commit in the repository, or no history the two share.
          FixProductionVerifier.rememberCompare(data.key, "");
          return undefined;
        }

        logger.debug(
          `Fix verification: could not compare ${data.fixCommitSha} with ${data.deployCommitSha}: ${error}`,
        );
      }
    }

    data.run.failedCompares.add(data.key);
    return undefined;
  }

  /*
   * A read-only token of the installation the fix's repository is bound
   * through - never one of another project's installation.
   */
  private static async tokenFor(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<string | null> {
    const installationId: string | undefined =
      fix.codeRepository?.gitHubAppInstallationId;

    if (!installationId) {
      return null;
    }

    if (run.tokens.has(installationId)) {
      return run.tokens.get(installationId) || null;
    }

    let token: string | null = null;

    try {
      if (
        await GitHubInstallationBinding.isRepositoryInstallationBound({
          projectId: fix.codeRepository?.projectId,
          gitHubAppInstallationId: installationId,
        })
      ) {
        const minted: GitHubInstallationToken =
          await GitHubUtil.getInstallationAccessToken(installationId, {
            permissions: { contents: "read", metadata: "read" },
          });
        token = minted.token;
      }
    } catch (error) {
      logger.debug(
        `Fix verification: no token for GitHub App installation ${installationId}: ${error}`,
      );
    }

    run.tokens.set(installationId, token);
    return token;
  }

  // Records a verdict on the fix; the status time moves only when the status does.
  private static async settle(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
    verdict: FixProductionVerdict,
    deploy?: {
      deployedAt: Date;
      deployedVersion?: string | undefined;
      deployedCommitSha?: string | undefined;
    },
  ): Promise<void> {
    const statusChanged: boolean = fix.productionStatus !== verdict.status;

    if (
      !statusChanged &&
      fix.productionSummary === verdict.summary &&
      !deploy
    ) {
      return;
    }

    await AIAgentTaskPullRequestService.updateOneById({
      id: fix.id!,
      data: {
        productionStatus: verdict.status,
        productionSummary: verdict.summary,
        ...(statusChanged ? { productionStatusAt: run.now } : {}),
        ...(deploy
          ? {
              deployedAt: deploy.deployedAt,
              ...(deploy.deployedVersion
                ? { deployedVersion: deploy.deployedVersion }
                : {}),
              ...(deploy.deployedCommitSha
                ? { deployedCommitSha: deploy.deployedCommitSha }
                : {}),
            }
          : {}),
      } as never,
      props: { isRoot: true },
    });
  }

  /*
   * A fix shown working in production resolves its exception; one that did
   * not reopens it.
   */
  private static async markException(
    exception: TelemetryException,
    isResolved: boolean,
    now: Date,
  ): Promise<void> {
    if (Boolean(exception.isResolved) === isResolved) {
      return;
    }

    await TelemetryExceptionService.updateOneById({
      id: exception.id!,
      data: isResolved
        ? { isResolved: true, markedAsResolvedAt: now }
        : { isResolved: false },
      props: { isRoot: true },
    });
  }

  private static fixSelect(): never {
    return {
      _id: true,
      projectId: true,
      aiRunId: true,
      createdAt: true,
      mergeCommitSha: true,
      mergedAt: true,
      productionStatus: true,
      productionStatusAt: true,
      productionSummary: true,
      deployedAt: true,
      deployedVersion: true,
      deployedCommitSha: true,
      repoOrganizationName: true,
      repoName: true,
      codeRepository: {
        _id: true,
        projectId: true,
        organizationName: true,
        repositoryName: true,
        gitHubAppInstallationId: true,
      },
    } as never;
  }
}
