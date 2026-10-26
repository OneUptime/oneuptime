import ObjectID from "../ObjectID";

/*
 * WHERE AI WORKS IN A CODE REPOSITORY - the repository's one rule.
 *
 * The default order a runbook step's Runner follows (Types/Runner/
 * RunnerChoice), for a repository:
 *
 *   1. the Runner the repository picked (CodeRepository.runnerId, its
 *      Runner setting in Code) - a pick always wins: only that Runner may
 *      take the repository's AI work and be handed a token for it;
 *   2. for a repository that picked none, the project's default Runner
 *      (Runner.isProjectDefault, Types/Runner/ProjectDefaultRunner) when it
 *      has one - followed, not copied: making another Runner the default
 *      moves every repository that picks none onto it;
 *   3. otherwise a global Runner - the one OneUptime runs for every project
 *      (on a self-hosted install, the bundled `runner` service of Docker
 *      Compose and the Helm chart) - unless its project turned global
 *      Runners off (Project.useGlobalRunners), in which case it needs one of
 *      the project's own Runners.
 *
 * A repository may also pick the Global Runner itself
 * (CodeRepository.isGlobalRunnerPicked): it then never follows the
 * project's default Runner, as a step that picked the Global Runner never
 * does (GLOBAL_RUNNER_CHOICE_ID).
 *
 * An AI agent of the project's own from before Runners (an AIAgent row with
 * a project) still serves the project's repositories that picked no Runner,
 * whatever the switch says: it is the project's, not a global one.
 *
 * Pure, so the server (the code-fix claim, the repository token, Code's
 * gate and the queue sweeper) and the dashboard's Runner picker answer the
 * same question the same way.
 */

export enum CodeRepositoryRunnerChoiceKind {
  // The repository picked one of its project's Runners.
  Custom = "custom",
  // The repository picked none, and its project has a default Runner.
  ProjectDefault = "project-default",
  /*
   * The repository picked none and its project has no default Runner, or
   * it picked the Global Runner; its project uses global Runners.
   */
  Global = "global",
  /*
   * The repository picked none and its project has no default Runner, or
   * it picked the Global Runner; its project turned global Runners off.
   */
  NoRunner = "no-runner",
}

export type CodeRepositoryRunnerDecision =
  | { kind: CodeRepositoryRunnerChoiceKind.Custom; runnerId: string }
  | { kind: CodeRepositoryRunnerChoiceKind.ProjectDefault; runnerId: string }
  | { kind: CodeRepositoryRunnerChoiceKind.Global }
  | { kind: CodeRepositoryRunnerChoiceKind.NoRunner };

export interface CodeRepositoryRunnerFacts {
  // The Runner the repository picked, as stored: empty when it picked none.
  repositoryRunnerId?: ObjectID | string | null | undefined;
  /*
   * Whether the repository picked the Global Runner itself
   * (CodeRepository.isGlobalRunnerPicked): read only when it picked no
   * Runner, and then it never follows the project's default Runner.
   */
  picksGlobalRunner?: boolean | null | undefined;
  /*
   * The project's default Runner, as its id - one the rule of
   * Types/Runner/ProjectDefaultRunner lets be it - or empty when the
   * project has none.
   */
  projectDefaultRunnerId?: ObjectID | string | null | undefined;
  // Whether the repository's project uses global Runners (on by default).
  projectUsesGlobalRunners: boolean;
}

/*
 * Whether a repository's work follows its project's default Runner: it
 * picked no Runner, and did not pick the Global Runner either. Such a
 * repository runs on the project's default Runner whenever there is one.
 */
export function followsProjectDefaultRunner(
  facts: Pick<
    CodeRepositoryRunnerFacts,
    "repositoryRunnerId" | "picksGlobalRunner"
  >,
): boolean {
  return (
    !getRepositoryRunnerId(facts.repositoryRunnerId) &&
    facts.picksGlobalRunner !== true
  );
}

// Who asks to work in a repository.
export enum CodeWorkerKind {
  // One of the repository's project's own Runners (a Runner row).
  ProjectRunner = "project-runner",
  /*
   * A global Runner: a Runner row with no project (isGlobalRunner), which
   * OneUptime runs for every project.
   */
  GlobalRunner = "global-runner",
  // An AI agent of the project's own, from before Runners.
  ProjectAgent = "project-agent",
}

export interface CodeWorker {
  kind: CodeWorkerKind;
  // The Runner's or the agent's id.
  id: ObjectID | string;
}

// The Runner id a repository stored, trimmed and lower-cased: "" for none.
export function getRepositoryRunnerId(value: unknown): string {
  if (value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function decideCodeRepositoryRunner(
  facts: CodeRepositoryRunnerFacts,
): CodeRepositoryRunnerDecision {
  const runnerId: string = getRepositoryRunnerId(facts.repositoryRunnerId);

  // A pick always wins.
  if (runnerId) {
    return { kind: CodeRepositoryRunnerChoiceKind.Custom, runnerId };
  }

  // Then the project's default Runner, unless it picked the Global Runner.
  const defaultRunnerId: string = getRepositoryRunnerId(
    facts.projectDefaultRunnerId,
  );

  if (defaultRunnerId && followsProjectDefaultRunner(facts)) {
    return {
      kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
      runnerId: defaultRunnerId,
    };
  }

  if (facts.projectUsesGlobalRunners) {
    return { kind: CodeRepositoryRunnerChoiceKind.Global };
  }

  return { kind: CodeRepositoryRunnerChoiceKind.NoRunner };
}

/*
 * Whether this worker may work in a repository its rule decided so for:
 * take its AI work, and be handed a token for it.
 *
 *   - a repository that picked a Runner: that Runner, and nothing else;
 *   - one that follows its project's default Runner: that Runner, and an
 *     AI agent of the project's own;
 *   - one that runs on a global Runner: a global Runner while its project
 *     uses them, and an AI agent of the project's own either way.
 *
 * A project's Runner never works in a repository that did not pick it,
 * unless it is the project's default Runner and the repository follows it.
 */
export function mayWorkInCodeRepository(data: {
  worker: CodeWorker;
  decision: CodeRepositoryRunnerDecision;
}): boolean {
  const workerId: string = getRepositoryRunnerId(data.worker.id);

  switch (data.decision.kind) {
    case CodeRepositoryRunnerChoiceKind.Custom:
      return (
        data.worker.kind === CodeWorkerKind.ProjectRunner &&
        Boolean(workerId) &&
        workerId === data.decision.runnerId
      );
    case CodeRepositoryRunnerChoiceKind.ProjectDefault:
      return (
        (data.worker.kind === CodeWorkerKind.ProjectRunner &&
          Boolean(workerId) &&
          workerId === data.decision.runnerId) ||
        data.worker.kind === CodeWorkerKind.ProjectAgent
      );
    case CodeRepositoryRunnerChoiceKind.Global:
      return (
        data.worker.kind === CodeWorkerKind.GlobalRunner ||
        data.worker.kind === CodeWorkerKind.ProjectAgent
      );
    case CodeRepositoryRunnerChoiceKind.NoRunner:
      return data.worker.kind === CodeWorkerKind.ProjectAgent;
    default: {
      const unhandled: never = data.decision;
      return Boolean(unhandled);
    }
  }
}

/*
 * What the repository token route answers a worker the repository did not
 * pick (mayWorkInCodeRepository), and the run it works on fails with. Said
 * without naming the Runner the repository picked: the worker asking is not
 * told about another Runner of the project.
 */
export const CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL: string =
  "This repository's AI work runs on the Runner its settings in Code pick - the project's default Runner when they pick none - and that is not this Runner, so it was not given access to the repository. Start the task again: it goes to the repository's Runner.";
