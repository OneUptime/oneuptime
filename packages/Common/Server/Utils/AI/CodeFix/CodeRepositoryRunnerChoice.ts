import AIAgentService from "../../../Services/AIAgentService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Services/RunnerService";
import GlobalRunnerChoice from "../../Runner/GlobalRunnerChoice";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../../Types/ObjectID";
import {
  CodeRepositoryRunnerChoiceKind,
  CodeRepositoryRunnerDecision,
  CodeWorker,
  decideCodeRepositoryRunner,
  followsProjectDefaultRunner,
  getRepositoryRunnerId,
  mayWorkInCodeRepository,
} from "../../../../Types/Runner/CodeRepositoryRunner";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
} from "../../../../Types/Runner/RunnerLiveStatus";

/*
 * Where AI works in a repository, on the server: the facts the repository's
 * rule needs (Types/Runner/CodeRepositoryRunner), read as OneUptime, then
 * the rule - for the repository token (only the repository's Runner gets
 * one), for whether a project's Runner takes code work at all (a repository
 * picks it, or follows it as the project's default Runner), and for who is
 * online to do a repository's work (Code's gate, the exception page's
 * checklist, the queue sweeper).
 *
 * The project's default Runner is read through GlobalRunnerChoice, the one
 * reader of it, so a repository that picks none runs on the same Runner a
 * runbook step that picks none runs on.
 */

// What a repository's AI work runs on now, and whether it is there to do it.
export interface CodeRepositoryRunnerStatus {
  decision: CodeRepositoryRunnerDecision;
  // Whether what the repository runs on is online to take its work now.
  isOnline: boolean;
  /*
   * The name of the Runner the repository picked, or of the project's
   * default Runner it follows, for the words that name it; absent for a
   * global Runner, and for a pick that is not one of the project's Runners
   * any more.
   */
  runnerName?: string | undefined;
}

/*
 * What the rule reads off a repository: its project, the Runner it picked
 * and whether it picked the Global Runner itself. Every key is asked for
 * (never optional), so a caller hands over a row it selected
 * isGlobalRunnerPicked on - a repository read without it would follow the
 * project's default Runner when it picked the Global Runner.
 */
export interface CodeRepositoryRunnerFactsRow {
  projectId: ObjectID | undefined;
  runnerId: ObjectID | string | null | undefined;
  isGlobalRunnerPicked: boolean | null | undefined;
}

// The facts row of a repository read with the rule's columns.
export function getCodeRepositoryRunnerFactsRow(
  repository: Pick<
    CodeRepository,
    "projectId" | "runnerId" | "isGlobalRunnerPicked"
  >,
): CodeRepositoryRunnerFactsRow {
  return {
    projectId: repository.projectId,
    runnerId: repository.runnerId,
    isGlobalRunnerPicked: repository.isGlobalRunnerPicked,
  };
}

// The columns the rule reads, for a read of the repository it decides for.
export const CODE_REPOSITORY_RUNNER_SELECT: {
  projectId: true;
  runnerId: true;
  isGlobalRunnerPicked: true;
} = {
  projectId: true,
  runnerId: true,
  isGlobalRunnerPicked: true,
};

export default class CodeRepositoryRunnerChoice {
  /*
   * The rule's answer for a repository. Each fact is read only when the
   * order reaches it: nothing for a repository that picked a Runner (a pick
   * always wins), the project's default Runner for one that follows it, and
   * the project's switch only for one that ends up on a global Runner.
   */
  @CaptureSpan()
  public static async decideForRepository(
    repository: CodeRepositoryRunnerFactsRow,
  ): Promise<CodeRepositoryRunnerDecision> {
    if (getRepositoryRunnerId(repository.runnerId)) {
      return decideCodeRepositoryRunner({
        repositoryRunnerId: repository.runnerId,
        projectUsesGlobalRunners: false,
      });
    }

    const follows: boolean = followsProjectDefaultRunner({
      repositoryRunnerId: null,
      picksGlobalRunner: repository.isGlobalRunnerPicked,
    });

    const projectDefaultRunnerId: string =
      follows && repository.projectId
        ? await GlobalRunnerChoice.findProjectDefaultRunnerId(
            repository.projectId,
          )
        : "";

    if (projectDefaultRunnerId) {
      return decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        picksGlobalRunner: repository.isGlobalRunnerPicked,
        projectDefaultRunnerId,
        projectUsesGlobalRunners: false,
      });
    }

    const projectUsesGlobalRunners: boolean = repository.projectId
      ? await GlobalRunnerChoice.doesProjectUseGlobalRunners(
          repository.projectId,
        )
      : false;

    return decideCodeRepositoryRunner({
      repositoryRunnerId: null,
      picksGlobalRunner: repository.isGlobalRunnerPicked,
      projectUsesGlobalRunners,
    });
  }

  /*
   * Whether this worker may work in the repository: take its AI work and be
   * handed a token for it (mayWorkInCodeRepository).
   */
  @CaptureSpan()
  public static async mayWorkInRepository(data: {
    worker: CodeWorker;
    repository: CodeRepositoryRunnerFactsRow;
  }): Promise<boolean> {
    const decision: CodeRepositoryRunnerDecision =
      await CodeRepositoryRunnerChoice.decideForRepository(data.repository);

    return mayWorkInCodeRepository({ worker: data.worker, decision });
  }

  /*
   * Whether AI works in a repository of the Runner's project on it: a
   * repository picks it, or it is the project's default Runner and a
   * repository follows it (picks no Runner, and not the Global Runner).
   * That is what makes a project's Runner take code work at all - the
   * code-fix identity it authenticates with, and the capability its
   * heartbeat is told. A Runner no repository works on takes none, as one
   * whose "Runs AI Code Fixes" was off did.
   */
  @CaptureSpan()
  public static async doesRunnerWorkInARepository(runner: {
    id?: ObjectID | null | undefined;
    projectId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    if (!runner.id || !runner.projectId) {
      return false;
    }

    const picking: number = (
      await CodeRepositoryService.countBy({
        query: {
          projectId: runner.projectId,
          runnerId: runner.id,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (picking > 0) {
      return true;
    }

    const defaultRunnerId: string =
      await GlobalRunnerChoice.findProjectDefaultRunnerId(runner.projectId);

    if (
      !defaultRunnerId ||
      getRepositoryRunnerId(defaultRunnerId) !==
        getRepositoryRunnerId(runner.id)
    ) {
      return false;
    }

    return await CodeRepositoryRunnerChoice.hasRepositoryFollowingProjectDefault(
      runner.projectId,
    );
  }

  /*
   * Whether a repository of the project follows its default Runner: picks
   * no Runner, and did not pick the Global Runner (unset or false).
   */
  @CaptureSpan()
  public static async hasRepositoryFollowingProjectDefault(
    projectId: ObjectID,
  ): Promise<boolean> {
    for (const isGlobalRunnerPicked of [QueryHelper.isNull(), false]) {
      const count: number = (
        await CodeRepositoryService.countBy({
          query: {
            projectId: projectId,
            runnerId: QueryHelper.isNull(),
            isGlobalRunnerPicked: isGlobalRunnerPicked,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (count > 0) {
        return true;
      }
    }

    return false;
  }

  /*
   * The repositories of the Runner's project that pick it, by name: what
   * the Runner's own page lists, and what keeps it from being retired
   * without a word.
   */
  @CaptureSpan()
  public static async findRepositoriesPickingRunner(runner: {
    id: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<CodeRepository>> {
    return await CodeRepositoryService.findBy({
      query: {
        projectId: runner.projectId,
        runnerId: runner.id,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: 50,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * What a repository's AI work runs on now, and whether it is online to
   * do it:
   *
   *   - a Runner it picked, or the project's default Runner it follows:
   *     that Runner, online while it heartbeats (an in-cluster Runner the
   *     Kubernetes agent chart installed never takes code work, so it is
   *     never online for it) - or, for the default Runner, while an AI
   *     agent of the project's own is;
   *   - a global Runner, in a project that uses them: a global Runner, or
   *     an AI agent of the project's own;
   *   - none, in a project that does not: an AI agent of the project's own
   *     only.
   */
  @CaptureSpan()
  public static async getStatusForRepository(
    repository: CodeRepositoryRunnerFactsRow,
  ): Promise<CodeRepositoryRunnerStatus> {
    const decision: CodeRepositoryRunnerDecision =
      await CodeRepositoryRunnerChoice.decideForRepository(repository);

    if (
      decision.kind === CodeRepositoryRunnerChoiceKind.Custom ||
      decision.kind === CodeRepositoryRunnerChoiceKind.ProjectDefault
    ) {
      const runner: Runner | null = await RunnerService.findOneBy({
        query: {
          _id: decision.runnerId,
          ...(repository.projectId ? { projectId: repository.projectId } : {}),
        },
        select: {
          _id: true,
          name: true,
          lastAlive: true,
          hostInfo: true,
        },
        props: { isRoot: true },
      });

      const isRunnerOnline: boolean = Boolean(
        runner &&
          getRunnerLiveStatus(runner.lastAlive) ===
            RunnerLiveStatus.Connected &&
          !RunnerServiceClass.isKubernetesAgentRunnerRow(runner),
      );

      /*
       * A repository that follows the project's default Runner is served
       * by an AI agent of the project's own too, as one on a global Runner
       * is; a pick is served by the Runner it picked alone.
       */
      const isProjectAgentOnline: boolean =
        !isRunnerOnline &&
        decision.kind === CodeRepositoryRunnerChoiceKind.ProjectDefault &&
        Boolean(repository.projectId) &&
        Boolean(
          await AIAgentService.getOnlineProjectAIAgent(repository.projectId!),
        );

      return {
        decision,
        ...(runner?.name ? { runnerName: runner.name } : {}),
        isOnline: isRunnerOnline || isProjectAgentOnline,
      };
    }

    const projectAgent: AIAgent | null = repository.projectId
      ? await AIAgentService.getOnlineProjectAIAgent(repository.projectId)
      : null;

    if (projectAgent) {
      return { decision, isOnline: true };
    }

    if (decision.kind === CodeRepositoryRunnerChoiceKind.Global) {
      return {
        decision,
        isOnline: await RunnerService.hasOnlineGlobalRunner(),
      };
    }

    return { decision, isOnline: false };
  }

  /*
   * Whether anything is online to do the AI work of any of the project's
   * repositories: a global Runner while the project uses them, a Runner a
   * repository picks, the project's default Runner while a repository
   * follows it, or an AI agent of the project's own. What a project-wide
   * checklist asks before any repository is known.
   */
  @CaptureSpan()
  public static async isAnyRunnerOnlineForProject(
    projectId: ObjectID,
  ): Promise<boolean> {
    if (await AIAgentService.getOnlineProjectAIAgent(projectId)) {
      return true;
    }

    if (
      (await GlobalRunnerChoice.doesProjectUseGlobalRunners(projectId)) &&
      (await RunnerService.hasOnlineGlobalRunner())
    ) {
      return true;
    }

    const picked: Array<CodeRepository> = await CodeRepositoryService.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        runnerId: true,
      },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });

    const runnerIds: Array<string> = Array.from(
      new Set<string>(
        picked
          .map((repository: CodeRepository): string => {
            return getRepositoryRunnerId(repository.runnerId);
          })
          .filter((runnerId: string): boolean => {
            return Boolean(runnerId);
          }),
      ),
    );

    /*
     * The project's default Runner, while a repository follows it: read as
     * a repository that follows it would be.
     */
    if (
      await CodeRepositoryRunnerChoice.hasRepositoryFollowingProjectDefault(
        projectId,
      )
    ) {
      const defaultRunnerId: string =
        await GlobalRunnerChoice.findProjectDefaultRunnerId(projectId);

      if (defaultRunnerId && !runnerIds.includes(defaultRunnerId)) {
        runnerIds.push(getRepositoryRunnerId(defaultRunnerId));
      }
    }

    for (const runnerId of runnerIds) {
      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository({
          projectId,
          runnerId,
          isGlobalRunnerPicked: false,
        });

      if (status.isOnline) {
        return true;
      }
    }

    return false;
  }
}
