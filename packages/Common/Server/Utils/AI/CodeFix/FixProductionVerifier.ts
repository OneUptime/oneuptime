import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import FixProductionBaseline from "../../../../Types/AI/FixProductionBaseline";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
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
  CHANGE_EVENT_FIELD_KEYS,
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
import CodeHostAccess, {
  CodeHostReader,
} from "../../CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../CodeRepository/CodeHost/CodeHostHttp";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import FixProductionTelemetry from "./FixProductionTelemetry";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  decideDeployWait,
  decideWatchVerdict,
  deployContainsFix,
  describeDeploy,
  fitVerdict,
} from "./FixProductionVerdict";
import PerformanceFixWatch from "./PerformanceFixWatch";
import RecurrenceFixWatch from "./RecurrenceFixWatch";
import TelemetryFixWatch from "./TelemetryFixWatch";

/*
 * Fix verified in production - the last step of an AI fix.
 *
 * A merged fix pull request has fixed nothing until it runs. Every merged
 * fix whose effect production shows is followed here until it is decided,
 * with the check its recipe calls for (FixProductionCheck):
 *
 *   1. AwaitingDeploy: the deploys recorded since the merge for the fix's
 *      service, or for the whole project (change events: telemetry,
 *      Kubernetes, `oneuptime deploy`), are searched for one that contains
 *      the fix's merge commit - the same commit, or a later one by GitHub's
 *      compare. None within maxDeployWaitDays is Unverifiable.
 *   2. Watching: what the fix was for is measured in the deployed fix
 *      against the time before the merge:
 *        - Exception: the exception's occurrences - in the deploy's version
 *          when the service's telemetry names it, else after the rollout
 *          grace (FixProductionVerdict.decideWatchVerdict);
 *        - Performance: the p99 of the operation it names
 *          (PerformanceFixWatch);
 *        - Recurrence: the incidents or alerts its monitor raises
 *          (RecurrenceFixWatch);
 *        - Telemetry: the spans, attributes and log text it adds
 *          (TelemetryFixWatch).
 *   3. Verified, Regressed or Unverifiable is final. A verified exception
 *      fix resolves the exception and a regressed one reopens it; each check
 *      does the same for what it watched (an insight, an incident).
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

// The deploy that shipped a fix, as its row records it.
export interface ShippedFix {
  deployedAt: Date;
  deployedVersion?: string | undefined;
  deployedCommitSha?: string | undefined;
  // Found by this check: recorded with its verdict.
  isNew: boolean;
}

export interface VerifierRun {
  now: Date;
  // An installation's GitHub token, or null when it cannot be used.
  tokens: Map<string, string | null>;
  // Compares GitHub could not answer this run: asked again next run.
  failedCompares: Set<string>;
  /*
   * A GitLab, Forgejo or Gitea repository's reader, by repository id - or
   * null where it cannot be read (its token refused, its connection gone).
   */
  readers?: Map<string, CodeHostReader | null> | undefined;
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

  // One fix's check, by what its recipe is watched for.
  public static async verifyFix(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const check: FixProductionCheck | undefined =
      FixProductionCheckHelper.fromDatabaseValue(fix.productionCheck);

    switch (check) {
      case FixProductionCheck.Exception:
        return FixProductionVerifier.verifyExceptionFix(fix, run);
      case FixProductionCheck.Performance:
        return PerformanceFixWatch.verify(fix, run);
      case FixProductionCheck.Recurrence:
        return RecurrenceFixWatch.verify(fix, run);
      case FixProductionCheck.Telemetry:
        return TelemetryFixWatch.verify(fix, run);
      default:
        // A check a newer server wrote: left for that server.
        logger.debug(
          `Fix verification: fix pull request ${fix.id?.toString()} is watched with a check this server does not know (${String(fix.productionCheck)}).`,
        );
    }
  }

  // An exception fix's check: find its deploy, then watch its exception.
  public static async verifyExceptionFix(
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

    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);

    const shipped: ShippedFix | null = await FixProductionVerifier.awaitDeploy({
      fix,
      run,
      serviceId: exception.primaryEntityId,
      mergedAt,
    });

    if (!shipped) {
      return;
    }

    const [occurrencesSinceDeploy, baselineOccurrences]: [number, number] =
      await Promise.all([
        FixProductionVerifier.countOccurrencesSinceDeploy({
          exception,
          deployedAt: shipped.deployedAt,
          deployedVersion: shipped.deployedVersion,
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
      deployedAt: shipped.deployedAt,
      now: run.now,
      occurrencesSinceDeploy,
      baselineOccurrences,
      // The same words every check, so an unchanged watch writes nothing.
      deployLabel: FixProductionVerifier.deployLabelOf(shipped),
    });

    await FixProductionVerifier.settle(
      fix,
      run,
      verdict,
      shipped.isNew ? shipped : undefined,
    );

    if (verdict.status === FixProductionStatus.Verified) {
      await FixProductionVerifier.markException(exception, true, run.now);
    } else if (verdict.status === FixProductionStatus.Regressed) {
      await FixProductionVerifier.markException(exception, false, run.now);
    }
  }

  // When the fix merged: GitHub's time, else when its watch started.
  public static mergedAtOf(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Date {
    return fix.mergedAt
      ? new Date(fix.mergedAt)
      : fix.productionStatusAt
        ? new Date(fix.productionStatusAt)
        : new Date(fix.createdAt || run.now);
  }

  /*
   * The deploy that shipped the fix: the one its row records once it is
   * watched, else the first recorded deploy since the merge that contains
   * it. Null while there is none - and when none did in time, or GitHub
   * never said which commit the pull request merged as, the fix is settled
   * Unverifiable on the way.
   */
  public static async awaitDeploy(data: {
    fix: AIAgentTaskPullRequest;
    run: VerifierRun;
    // The service whose deploys ship it; none reads every change of the project.
    serviceId?: ObjectID | undefined;
    mergedAt: Date;
  }): Promise<ShippedFix | null> {
    const fix: AIAgentTaskPullRequest = data.fix;

    if (
      fix.productionStatus === FixProductionStatus.Watching &&
      fix.deployedAt
    ) {
      return {
        deployedAt: new Date(fix.deployedAt),
        deployedVersion: fix.deployedVersion || undefined,
        deployedCommitSha: fix.deployedCommitSha || undefined,
        isNew: false,
      };
    }

    if (!fix.mergeCommitSha) {
      await FixProductionVerifier.settle(fix, data.run, {
        status: FixProductionStatus.Unverifiable,
        summary:
          "GitHub did not say which commit the pull request merged as, so no deploy can be matched to the fix.",
      });
      return null;
    }

    const deploy: FixDeploy | null =
      await FixProductionVerifier.findDeployContainingFix({
        fix,
        serviceId: data.serviceId,
        mergedAt: data.mergedAt,
        run: data.run,
      });

    if (!deploy) {
      const waited: FixProductionVerdict | null = decideDeployWait({
        mergedAt: data.mergedAt,
        now: data.run.now,
      });

      if (waited) {
        await FixProductionVerifier.settle(fix, data.run, waited);
      }
      return null;
    }

    return {
      deployedAt: deploy.time,
      deployedVersion: deploy.version,
      deployedCommitSha: deploy.commitSha,
      isNew: true,
    };
  }

  // "version 2.3.2", "commit 1a2b3c4": the same words on every check.
  public static deployLabelOf(shipped: ShippedFix): string {
    return describeDeploy({
      version: shipped.deployedVersion,
      commitSha: shipped.deployedCommitSha,
    });
  }

  /*
   * The version to read a deployed fix's telemetry by: the deploy's, once
   * the service's own telemetry names it - else none, and the fix is read
   * from the rollout grace on (sinceDeployWindowStart).
   */
  public static async versionToRead(data: {
    projectId: ObjectID;
    serviceId?: ObjectID | undefined;
    shipped: ShippedFix;
    now: Date;
  }): Promise<string | undefined> {
    if (!data.shipped.deployedVersion || !data.serviceId) {
      return undefined;
    }

    return (await FixProductionTelemetry.reportsVersion({
      projectId: data.projectId,
      serviceId: data.serviceId,
      version: data.shipped.deployedVersion,
      from: data.shipped.deployedAt,
      to: data.now,
    }))
      ? data.shipped.deployedVersion
      : undefined;
  }

  /*
   * Where the deployed fix's telemetry starts: the deploy, when it is read
   * by its version; else the end of the rollout grace, so old pods still
   * draining do not count.
   */
  public static sinceDeployWindowStart(data: {
    shipped: ShippedFix;
    version?: string | undefined;
  }): Date {
    return data.version
      ? data.shipped.deployedAt
      : OneUptimeDate.addRemoveMinutes(
          data.shipped.deployedAt,
          FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
        );
  }

  /*
   * The run that opened the fix, held to the fix's project: its recipe, what
   * started it, and its context.
   */
  public static async readRun(
    fix: AIAgentTaskPullRequest,
  ): Promise<AIRun | null> {
    if (!fix.aiRunId) {
      return null;
    }

    const aiRun: AIRun | null = await AIRunService.findOneById({
      id: fix.aiRunId,
      select: {
        _id: true,
        projectId: true,
        codeFixTaskType: true,
        taskContext: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAiInsightId: true,
      },
      props: { isRoot: true },
    });

    if (
      !aiRun ||
      (aiRun.projectId &&
        fix.projectId &&
        aiRun.projectId.toString() !== fix.projectId.toString())
    ) {
      return null;
    }

    return aiRun;
  }

  // What the check measured before the merge, kept for every later check.
  public static async saveBaseline(
    fix: AIAgentTaskPullRequest,
    baseline: FixProductionBaseline,
  ): Promise<void> {
    await AIAgentTaskPullRequestService.updateOneById({
      id: fix.id!,
      data: { productionBaseline: baseline } as never,
      props: { isRoot: true },
    });

    fix.productionBaseline = baseline;
  }

  /*
   * A read a check depends on, that may fail - a telemetry query out of
   * time, say. While there is time left the failure is thrown, and the fix
   * is checked again next time; once the time to tell is over (isOver),
   * the fix is settled Unverifiable instead of being retried for good.
   */
  public static async readOrSettle<T>(data: {
    fix: AIAgentTaskPullRequest;
    run: VerifierRun;
    isOver: boolean;
    // Why it cannot be told, when it is over.
    summary: string;
    read: () => Promise<T>;
  }): Promise<T | null> {
    try {
      return await data.read();
    } catch (error) {
      if (!data.isOver) {
        throw error;
      }

      logger.debug(
        `Fix verification: fix pull request ${data.fix.id?.toString()} could not be read in time, and is not verified: ${error}`,
      );
      await FixProductionVerifier.settle(data.fix, data.run, {
        status: FixProductionStatus.Unverifiable,
        summary: data.summary,
      });
      return null;
    }
  }

  /*
   * The first deploy of the fix's service (or a deploy of the whole
   * project) recorded since the merge that contains the fix's commit.
   */
  public static async findDeployContainingFix(data: {
    fix: AIAgentTaskPullRequest;
    // None reads every change of the project.
    serviceId?: ObjectID | undefined;
    mergedAt: Date;
    run: VerifierRun;
  }): Promise<FixDeploy | null> {
    const fixCommitSha: string = data.fix.mergeCommitSha!;
    const repository: GitHubRepositoryName | null =
      FixProductionVerifier.repositoryOf(data.fix);

    const rows: Array<ChangeEvent> =
      await FixProductionVerifier.readChangesSinceMerge({
        projectId: data.fix.projectId!,
        serviceId: data.serviceId,
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
   * the deploy reported one the service's telemetry names too - so old pods
   * still draining do not count - and otherwise from the rollout grace after
   * it on. A version the telemetry never names (a pipeline's "2.3.2" beside
   * an SDK's "v2.3.2", or none at all) would find no occurrence, and verify
   * a fix that never stopped the exception.
   */
  public static async countOccurrencesSinceDeploy(data: {
    exception: TelemetryException;
    deployedAt: Date;
    deployedVersion?: string | undefined;
    now: Date;
  }): Promise<number> {
    const version: string | undefined =
      await FixProductionVerifier.versionToRead({
        projectId: data.exception.projectId!,
        serviceId: data.exception.primaryEntityId,
        shipped: {
          deployedAt: data.deployedAt,
          deployedVersion: data.deployedVersion,
          isNew: false,
        },
        now: data.now,
      });

    if (version) {
      return FixProductionVerifier.countOccurrences({
        exception: data.exception,
        start: data.deployedAt,
        end: data.now,
        release: version,
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
   * The changes recorded since the merge, oldest first: the fix's service's
   * and the whole project's, read apart so that a busy project's other
   * services cannot crowd the fix's deploy out of the read. A fix with no
   * service reads every change of the project. Only changes that name a
   * commit are read - the only ones a deploy of the fix can be - so a
   * cloud account's activity, project-wide and many, crowds nothing out.
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
              attributeKeys: new Includes([
                ...CHANGE_EVENT_FIELD_KEYS.commitSha,
              ]),
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

  public static repositoryOf(
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
   * GitHub's compare of the fix's commit with a deploy's - or, for a
   * repository on GitLab, Forgejo or Gitea, its server's (compareOnCodeHost).
   * An answer is remembered for good; a failure (no token, a rate limit,
   * the server down) is asked again next run.
   */
  private static async compare(data: {
    fix: AIAgentTaskPullRequest;
    repository: GitHubRepositoryName;
    fixCommitSha: string;
    deployCommitSha: string;
    key: string;
    run: VerifierRun;
  }): Promise<string | undefined> {
    if (
      CodeHost.readType(data.fix.codeRepository?.repositoryHostedAt) !==
      CodeRepositoryType.GitHub
    ) {
      return await FixProductionVerifier.compareOnCodeHost(data);
    }

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
   * Whether a deploy contains the fix, asked of the fix's repository's own
   * server - GitLab, Forgejo or Gitea - through its connection, as GitHub's
   * compare is asked: "ahead" when it does, "diverged" when it does not
   * (behind or diverged, the fix is not in it either way), "" for a commit
   * the repository does not have. A plain Git server has no API to ask:
   * only a deploy of the fix's own commit counts there (deployContainsFix).
   */
  private static async compareOnCodeHost(data: {
    fix: AIAgentTaskPullRequest;
    fixCommitSha: string;
    deployCommitSha: string;
    key: string;
    run: VerifierRun;
  }): Promise<string | undefined> {
    const reader: CodeHostReader | null = await FixProductionVerifier.readerFor(
      data.fix,
      data.run,
    );

    if (reader && reader.canCompareCommits) {
      try {
        const contains: boolean = await reader.containsCommit({
          commit: data.fixCommitSha,
          containing: data.deployCommitSha,
        });
        const status: string = contains ? "ahead" : "diverged";

        FixProductionVerifier.rememberCompare(data.key, status);
        return status;
      } catch (error) {
        if (
          error instanceof CodeHostHttpError &&
          error.kind === CodeHostHttpErrorKind.NotFound
        ) {
          // No such commit in the repository, or no history the two share.
          FixProductionVerifier.rememberCompare(data.key, "");
          return undefined;
        }

        logger.debug(
          `Fix verification: could not compare ${data.fixCommitSha} with ${data.deployCommitSha} on the repository's server: ${error}`,
        );
      }
    }

    data.run.failedCompares.add(data.key);
    return undefined;
  }

  // The fix's repository's reader, read once a run.
  private static async readerFor(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<CodeHostReader | null> {
    const repository: CodeRepository | undefined = fix.codeRepository;
    const repositoryId: string | undefined = repository?.id?.toString();

    if (!repository || !repositoryId) {
      return null;
    }

    if (!run.readers) {
      run.readers = new Map<string, CodeHostReader | null>();
    }

    if (run.readers.has(repositoryId)) {
      return run.readers.get(repositoryId) || null;
    }

    let reader: CodeHostReader | null = null;

    try {
      reader = await CodeHostAccess.getReaderForRepository(repository);
    } catch (error) {
      logger.debug(
        `Fix verification: no reader for repository ${repositoryId}: ${error}`,
      );
    }

    run.readers.set(repositoryId, reader);
    return reader;
  }

  /*
   * A read-only token of the installation the fix's repository is bound
   * through - never one of another project's installation. It reads
   * commits (compares) and pull requests (a fix's diff).
   */
  public static async tokenFor(
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
            permissions: {
              contents: "read",
              metadata: "read",
              pull_requests: "read",
            },
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
  public static async settle(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
    unfitVerdict: FixProductionVerdict,
    deploy?: {
      deployedAt: Date;
      deployedVersion?: string | undefined;
      deployedCommitSha?: string | undefined;
    },
  ): Promise<void> {
    // Held to its column, so a long name never fails the write.
    const verdict: FixProductionVerdict = fitVerdict(unfitVerdict);
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

    /*
     * A fix that did not hold in production is the exception coming back:
     * it reopens as Regressed, as an occurrence after a person's resolve
     * reopens it at ingest (ExceptionIssueState).
     */
    await TelemetryExceptionService.updateOneById({
      id: exception.id!,
      data: isResolved
        ? { isResolved: true, markedAsResolvedAt: now }
        : { isResolved: false, regressedAt: now },
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
      productionCheck: true,
      productionBaseline: true,
      pullRequestNumber: true,
      pullRequestUrl: true,
      deployedAt: true,
      deployedVersion: true,
      deployedCommitSha: true,
      repoOrganizationName: true,
      repoName: true,
      // What CodeHostAccess reads a repository by, on any host.
      codeRepository: {
        _id: true,
        projectId: true,
        repositoryHostedAt: true,
        organizationName: true,
        repositoryName: true,
        mainBranchName: true,
        repositoryUrl: true,
        gitLabProjectId: true,
        gitHubAppInstallationId: true,
        codeRepositoryConnectionId: true,
      },
    } as never;
  }
}
