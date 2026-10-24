import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import SourceLocator, {
  LocatableRepository,
  LocatableRepositoryWithTree,
  SourceLink,
} from "../../CodeRepository/SourceLocator";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../CodeFix/OpenPullRequestCap";
import CodeTaskContextBuilder from "../CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import ProfileFixTaskTrigger from "../SRE/ProfileFixTaskTrigger";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { ProfileInsightEvidence } from "../../../../Types/AI/AIInsightEvidence";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../Types/AI/CodeTask";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiWork,
} from "../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeRepositoryAllowance,
  isCodeRepositoryAllowed,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE PULL REQUEST FOR SLOW CODE ONEUPTIME FOUND - a Code task OneUptime
 * starts on its own in the repository that holds the code, with the
 * profile as its evidence (Types/AI/TelemetryAi).
 *
 * The task is the one the Profiler's "Fix with AI" starts for a person
 * (ProfileFixTaskTrigger) - the same request, the same Profile context, the
 * same Runner - but written by OneUptime, stamped with the insight it came
 * from (CodeTaskRuns.startForOneUptime). It shows in Code with what
 * started it, and the pull request it opens says why. It is started only
 * when every one of these holds, cheapest first, and is otherwise left for
 * a later look, quietly:
 *
 *   1. fewer than TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY tasks OneUptime
 *      started on its own in the project today;
 *   2. no Code task for the same function of the same service on its way
 *      (a person's, from the Profiler) - that one is the insight's fix;
 *   3. a repository the rules allow, connected in Code, whose files
 *      OneUptime reads (SourceLocator), that holds the function's file - or
 *      the one such repository there is;
 *   4. what Code's own gate says for that repository: the plan, the bill,
 *      Enable AI, an LLM provider with credits, the project's daily AI
 *      limits and a Runner online to do the work (CodeTaskGate);
 *   5. room under the repository's cap on open AI pull requests.
 *
 * Never throws: the routing reads a null task as "not yet".
 */

// Why a fix was not started, in the words a debug log line ends with.
export enum ProfileInsightFixSkip {
  NoEvidence = "the insight holds no profile evidence",
  DailyLimit = "OneUptime already opened its daily share of pull requests for this project",
  NoRepository = "no repository the rules allow is connected in Code",
  RepositoryNotFound = "no repository the rules allow holds the function's file",
  Blocked = "Code cannot start a task in the repository",
  AtPullRequestCap = "the repository is at its cap of open AI pull requests",
  Failed = "the task could not be created",
}

export interface ProfileInsightFixResult {
  // The task started - or, already on its way, the one that is the fix.
  taskId?: ObjectID | undefined;
  skip?: ProfileInsightFixSkip | undefined;
  // Code's own words for a Blocked skip.
  detail?: string | undefined;
}

export default class ProfileInsightFix {
  @CaptureSpan()
  public static async start(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<ProfileInsightFixResult> {
    try {
      return await ProfileInsightFix.startOrSkip(data);
    } catch (error) {
      logger.error(
        `AI: could not start a fix for insight ${data.insight.id?.toString()}: ${error}`,
      );
      return { skip: ProfileInsightFixSkip.Failed };
    }
  }

  // The tasks OneUptime started on its own in the project since UTC midnight.
  @CaptureSpan()
  public static async countStartedToday(projectId: ObjectID): Promise<number> {
    return (
      await AIRunService.countBy({
        query: {
          projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.CodeRequest,
          userId: QueryHelper.isNull(),
          codeTaskId: QueryHelper.isNull(),
          triggeredByAiInsightId: QueryHelper.notNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate(), "UTC"),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * The repository the function's file is in, of the connected ones the
   * rules allow - or the only such repository, when its file is not found
   * in any (a profile can name a file by a path the repository does not
   * use). Null when there is no telling.
   */
  public static async pickRepository(data: {
    profile: ProfileInsightEvidence;
    repositories: Array<LocatableRepositoryWithTree>;
  }): Promise<LocatableRepository | null> {
    if (data.repositories.length === 0) {
      return null;
    }

    if (data.profile.fileName) {
      const links: Array<SourceLink> = await SourceLocator.matchFrames({
        frames: [
          {
            fileName: data.profile.fileName,
            lineNumber: data.profile.lineNumber,
          },
        ],
        repositories: data.repositories,
        // Each host's tree, as the Profiler's own Fix with AI reads it.
        getTreePaths: (
          repository: LocatableRepository,
        ): Promise<Array<string>> => {
          return SourceLocator.getTreePaths(
            repository as LocatableRepositoryWithTree,
          );
        },
      });

      const link: SourceLink | undefined = links[0];

      if (link) {
        const located: LocatableRepository | undefined = data.repositories.find(
          (repository: LocatableRepository): boolean => {
            return repository.id === link.repositoryId;
          },
        );

        if (located) {
          return located;
        }
      }
    }

    return data.repositories.length === 1 ? data.repositories[0]! : null;
  }

  private static async startOrSkip(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<ProfileInsightFixResult> {
    const insight: AIInsight = data.insight;
    const profile: ProfileInsightEvidence | undefined =
      insight.evidence?.profile;

    if (!insight.id || !insight.projectId || !profile || !profile.serviceId) {
      return { skip: ProfileInsightFixSkip.NoEvidence };
    }

    const projectId: ObjectID = insight.projectId;

    if (
      (await ProfileInsightFix.countStartedToday(projectId)) >=
      TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY
    ) {
      return { skip: ProfileInsightFixSkip.DailyLimit };
    }

    // A person's fix of the same function, from the Profiler, is this one.
    const activeTaskId: string | null =
      await ProfileFixTaskTrigger.findActiveTaskId({
        projectId,
        serviceId: new ObjectID(profile.serviceId),
        functionName: profile.functionName,
        fileName: profile.fileName,
      });

    if (activeTaskId) {
      return { taskId: new ObjectID(activeTaskId) };
    }

    const allowance: CodeRepositoryAllowance = data.work.repositories;

    const repositories: Array<LocatableRepositoryWithTree> = (
      await SourceLocator.getLocatableRepositories({
        projectId,
        props: { isRoot: true },
      })
    ).filter((repository: LocatableRepository): boolean => {
      return isCodeRepositoryAllowed(allowance, repository.id);
    });

    if (repositories.length === 0) {
      return { skip: ProfileInsightFixSkip.NoRepository };
    }

    const picked: LocatableRepository | null =
      await ProfileInsightFix.pickRepository({ profile, repositories });

    if (!picked) {
      return { skip: ProfileInsightFixSkip.RepositoryNotFound };
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: picked.id, projectId },
        select: {
          _id: true,
          name: true,
          organizationName: true,
          repositoryName: true,
          maxOpenFixPullRequests: true,
        },
        props: { isRoot: true },
      });

    if (!repository || !repository.id) {
      return { skip: ProfileInsightFixSkip.NoRepository };
    }

    /*
     * Code's gate, as a person asking in the repository would meet it - the
     * plan and the bill included, read for the project, since nobody here
     * carries them.
     */
    const plan: CurrentPlan = await ProjectService.getCurrentPlan(projectId);
    const props: DatabaseCommonInteractionProps = {
      isRoot: true,
      ...(plan.plan ? { currentPlan: plan.plan } : {}),
      isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
    };

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props,
      projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { skip: ProfileInsightFixSkip.Blocked, detail: blocker.message };
    }

    const cap: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id,
        configuredLimit: repository.maxOpenFixPullRequests ?? null,
      });

    if (!cap.allowed) {
      return { skip: ProfileInsightFixSkip.AtPullRequestCap };
    }

    const context: CodeTaskContextItem = await CodeTaskContextBuilder.buildItem(
      {
        type: CodeTaskContextType.Profile,
        serviceId: profile.serviceId,
        functionName: profile.functionName,
        fileName: profile.fileName,
        profileType: profile.profileType,
        startTime: profile.windowStartTime,
        endTime: profile.windowEndTime,
        ...(profile.baselineStartTime && profile.baselineEndTime
          ? {
              beforeStartTime: profile.baselineStartTime,
              beforeEndTime: profile.baselineEndTime,
            }
          : {}),
      },
      { projectId, props: { isRoot: true } },
    );

    const run: AIRun = await CodeTaskRuns.startForOneUptime({
      projectId,
      repository,
      message: ProfileFixTaskTrigger.buildRequestMessageForInsight({
        profile,
        serviceName: insight.serviceName,
      }),
      context: [context],
      triggeredByAiInsightId: insight.id,
      ...(data.work.llmProviderId
        ? { llmProviderId: new ObjectID(data.work.llmProviderId) }
        : {}),
    });

    return { taskId: run.id! };
  }
}
