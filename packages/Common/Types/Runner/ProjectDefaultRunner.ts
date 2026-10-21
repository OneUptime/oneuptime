import {
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "../Kubernetes/KubernetesClusterAiAccess";

/*
 * THE PROJECT'S DEFAULT RUNNER - which of a project's own Runners may be it.
 *
 * A project may mark one of its own Runners as its default
 * (Runner.isProjectDefault), as it marks one Twilio config its default:
 * work that picks no Runner of its own then runs on it, in place of the
 * Global Runner (Types/Runner/RunnerChoice, the default order). Making a
 * Runner the default takes it from the project's other Runners
 * (Server/Utils/Database/ProjectDefaultRow), so a project has one at most.
 * No Runner is the default until someone makes it so - not even a
 * project's first: a Runner that has never connected must not start taking
 * steps that ran fine on the Global Runner.
 *
 * Only a Runner that can run what picks no Runner may be it:
 *
 *   - never a global Runner - it belongs to no project;
 *   - never the in-cluster Runner the Kubernetes agent chart installed: it
 *     runs kubectl for its own cluster only;
 *   - never one with "Runs Runbooks" off: it would take no step.
 *
 * Pure, so the server (RunnerService refuses the rest, and the rule reads
 * the default through it) and the Dashboard (which offers "Set as Project
 * Default" only where the server takes it) answer the same way.
 */

// What the rule reads off a Runner row.
export interface ProjectDefaultRunnerCandidate {
  isGlobalRunner?: boolean | null | undefined;
  canRunRunbooks?: boolean | null | undefined;
  name?: unknown;
  hostInfo?: unknown;
}

export enum ProjectDefaultRunnerRefusal {
  GlobalRunner = "global_runner",
  KubernetesAgentRunner = "kubernetes_agent_runner",
  DoesNotRunRunbooks = "does_not_run_runbooks",
}

/*
 * The in-cluster Runner the Kubernetes agent chart installed: its name
 * marker or its posture, either one (RunnerService.isKubernetesAgentRunnerRow
 * reads it the same way).
 */
export function isKubernetesAgentRunnerCandidate(
  runner: ProjectDefaultRunnerCandidate,
): boolean {
  return (
    isKubernetesAgentRunnerName(
      typeof runner.name === "string" ? runner.name.trim().toLowerCase() : "",
    ) ||
    isKubernetesAgentRunnerPosture(
      parseKubernetesRunnerPosture(runner.hostInfo),
    )
  );
}

// Why this Runner may not be its project's default, or null when it may.
export function getProjectDefaultRunnerRefusal(
  runner: ProjectDefaultRunnerCandidate,
): ProjectDefaultRunnerRefusal | null {
  if (runner.isGlobalRunner === true) {
    return ProjectDefaultRunnerRefusal.GlobalRunner;
  }

  if (isKubernetesAgentRunnerCandidate(runner)) {
    return ProjectDefaultRunnerRefusal.KubernetesAgentRunner;
  }

  if (runner.canRunRunbooks === false) {
    return ProjectDefaultRunnerRefusal.DoesNotRunRunbooks;
  }

  return null;
}

export function canBeProjectDefaultRunner(
  runner: ProjectDefaultRunnerCandidate,
): boolean {
  return getProjectDefaultRunnerRefusal(runner) === null;
}

/*
 * The refusal's words, for the server's error and the Dashboard's locked
 * action alike. `name` is the Runner's own, quoted as stored.
 */
export function describeProjectDefaultRunnerRefusal(data: {
  refusal: ProjectDefaultRunnerRefusal;
  name?: string | undefined;
}): string {
  const runner: string = data.name ? `"${data.name}"` : "This Runner";

  switch (data.refusal) {
    case ProjectDefaultRunnerRefusal.GlobalRunner:
      return `${runner} is a global Runner, which belongs to no project, so it cannot be a project's default Runner. Make one of the project's own Runners the default under Runbooks → Runners.`;
    case ProjectDefaultRunnerRefusal.KubernetesAgentRunner:
      return `${runner} is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, so it cannot be the project's default Runner.`;
    case ProjectDefaultRunnerRefusal.DoesNotRunRunbooks:
      return `${runner} does not run runbooks, so it cannot be the project's default Runner. Turn on Runs Runbooks for it first.`;
    default: {
      const unhandled: never = data.refusal;
      return unhandled;
    }
  }
}

/*
 * What an update that turns "Runs Runbooks" off for the project's default
 * Runner is refused with: the steps that pick no Runner run on it, so it
 * stays able to run them until another Runner is the default, or none is.
 */
export function describeDefaultRunnerStopsRunningRunbooks(
  name?: string | undefined,
): string {
  const runner: string = name ? `"${name}"` : "This Runner";

  return `${runner} is the project's default Runner: the runbook steps that pick no Runner run on it, so Runs Runbooks stays on. Make another Runner the default, or stop using this one as the default, first.`;
}
