import AIAgentService from "../../../Services/AIAgentService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Services/RunnerService";
import GlobalRunnerChoice from "../../Runner/GlobalRunnerChoice";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../../Types/ObjectID";
import {
  CodeRepositoryRunnerChoiceKind,
  CodeRepositoryRunnerDecision,
  CodeWorker,
  decideCodeRepositoryRunner,
  getRepositoryRunnerId,
  mayWorkInCodeRepository,
} from "../../../../Types/Runner/CodeRepositoryRunner";
import { getRunnerLiveStatus } from "../../../../Types/Runner/RunnerLiveStatus";
import RunnerLiveStatus from "../../../../Types/Runner/RunnerLiveStatus";

/*
 * Where AI works in a repository, on the server: the facts the repository's
 * rule needs (Types/Runner/CodeRepositoryRunner), read as OneUptime, then
 * the rule - for the repository token (only the repository's Runner gets
 * one), for whether a project's Runner takes code work at all (a repository
 * picks it), and for who is online to do a repository's work (Code's gate,
 * the exception page's checklist, the queue sweeper).
 */

// What a repository's AI work runs on now, and whether it is there to do it.
export interface CodeRepositoryRunnerStatus {
  decision: CodeRepositoryRunnerDecision;
  // Whether what the repository runs on is online to take its work now.
  isOnline: boolean;
  /*
   * The name of the Runner the repository picked, for the words that name
   * it; absent for a global Runner, and for a pick that is not one of the
   * project's Runners any more.
   */
  runnerName?: string | undefined;
}

export interface CodeRepositoryRunnerFactsRow {
  projectId?: ObjectID | undefined;
  runnerId?: ObjectID | string | null | undefined;
}

export default class CodeRepositoryRunnerChoice {
  /*
   * The rule's answer for a repository. The project's switch is read only
   * for a repository that picked no Runner: a pick always wins.
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

    const projectUsesGlobalRunners: boolean = repository.projectId
      ? await GlobalRunnerChoice.doesProjectUseGlobalRunners(
          repository.projectId,
        )
      : false;

    return decideCodeRepositoryRunner({
      repositoryRunnerId: null,
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
   * Whether a repository of the Runner's project picks it: what makes a
   * project's Runner take code work at all - the code-fix identity it
   * authenticates with, and the capability its heartbeat is told. A Runner
   * no repository picks takes none, as one whose "Runs AI Code Fixes" was
   * off did.
   */
  @CaptureSpan()
  public static async isRunnerPickedByARepository(runner: {
    id?: ObjectID | null | undefined;
    projectId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    if (!runner.id || !runner.projectId) {
      return false;
    }

    const count: number = (
      await CodeRepositoryService.countBy({
        query: {
          projectId: runner.projectId,
          runnerId: runner.id,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return count > 0;
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
   *   - a Runner it picked: that Runner, online while it heartbeats (an
   *     in-cluster Runner the Kubernetes agent chart installed never takes
   *     code work, so it is never online for it);
   *   - none, in a project that uses global Runners: a global Runner, or an
   *     AI agent of the project's own;
   *   - none, in a project that does not: an AI agent of the project's own
   *     only.
   */
  @CaptureSpan()
  public static async getStatusForRepository(
    repository: CodeRepositoryRunnerFactsRow,
  ): Promise<CodeRepositoryRunnerStatus> {
    const decision: CodeRepositoryRunnerDecision =
      await CodeRepositoryRunnerChoice.decideForRepository(repository);

    if (decision.kind === CodeRepositoryRunnerChoiceKind.Custom) {
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

      if (!runner) {
        return { decision, isOnline: false };
      }

      return {
        decision,
        runnerName: runner.name || undefined,
        isOnline:
          getRunnerLiveStatus(runner.lastAlive) ===
            RunnerLiveStatus.Connected &&
          !RunnerServiceClass.isKubernetesAgentRunnerRow(runner),
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
        isOnline: await AIAgentService.hasOnlineGlobalCodeRunner(),
      };
    }

    return { decision, isOnline: false };
  }

  /*
   * Whether anything is online to do the AI work of any of the project's
   * repositories: a global Runner while the project uses them, a Runner a
   * repository picks, or an AI agent of the project's own. What a
   * project-wide checklist asks before any repository is known.
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
      (await AIAgentService.hasOnlineGlobalCodeRunner())
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

    for (const runnerId of runnerIds) {
      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository({
          projectId,
          runnerId,
        });

      if (status.isOnline) {
        return true;
      }
    }

    return false;
  }
}
