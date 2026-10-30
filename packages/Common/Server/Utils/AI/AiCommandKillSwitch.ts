import Project from "../../../Models/DatabaseModels/Project";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import ObjectID from "../../../Types/ObjectID";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../../Types/Runbook/RunnerJobOrigin";
import ProjectService from "../../Services/ProjectService";

/*
 * ENABLE AI STOPS EVERY COMMAND OneUptime AI SENDS TO INFRASTRUCTURE.
 *
 * Enable AI (Project.enableAi, Project Settings > AI > AI Features) is the
 * project's one AI switch, and its kill switch. Every model call is held to
 * it inside AIService.executeWithLogging (the AI kill switch backstop,
 * AIKillSwitchBackstop.test.ts). This is its twin for the commands AI sends
 * to a Runner, a Kubernetes AI agent or a resource AI agent - a Docker
 * host, a Proxmox cluster, a host, a cloud account's Cloud AI agent - which
 * can leave OneUptime without another model call: the commands of a plan a
 * person approved before the switch went off, the next command of a plan
 * that is running, the rollback of a fix that did not help, a job that was
 * enqueued a moment ago and waits for its agent to claim it.
 *
 * So the switch is read in two places, every time:
 *
 *   - where a command is enqueued (RunnerJobService.enqueueAiCommand,
 *     enqueueAiKubectlCommand and enqueueAiResourceCommand, the one
 *     chokepoint of each lane): with AI off, nothing is enqueued;
 *   - where an agent claims it (the Runner, Kubernetes AI agent and
 *     resource AI agent ingresses): a job enqueued before the switch went
 *     off is failed with the reason, never handed to the agent.
 *
 * The one exception is an access test - Test connection on a resource's
 * AI agent page, Test access on a cluster's. A person runs it to check an
 * agent before turning AI on, it is a read, and no AI composed it.
 *
 * Read with === false, as everywhere: the column is NOT NULL DEFAULT true,
 * so a value that was not read is never taken for "off". A project that is
 * gone is off: there is nobody left to act for.
 */

export const AI_COMMANDS_OFF_ENQUEUE_MESSAGE: string =
  "OneUptime AI is turned off for this project (Enable AI, under Project Settings → AI → AI Features), so this command was not sent to its agent. Turn Enable AI on to let OneUptime AI run commands again.";

export const AI_COMMANDS_OFF_CLAIM_MESSAGE: string =
  "OneUptime AI was turned off for this project (Enable AI) before this command left OneUptime, so its agent did not run it.";

export default class AiCommandKillSwitch {
  /*
   * Whether Enable AI is off for the project (or the project is gone).
   * A read that fails throws: every caller fails closed with it.
   */
  public static async isAiOff(projectId: ObjectID): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, enableAi: true },
      props: { isRoot: true },
    });

    return !project || project.enableAi === false;
  }

  /*
   * Whether a claimed job is an access test: the only AI-command job with
   * no AI run behind it (the enqueue chokepoints refuse an investigation
   * job without one, and a remediation job without its suggestion).
   */
  public static isAccessTestJob(
    job: Pick<RunnerJob, "origin" | "aiRunId" | "autoRemediationSuggestionId">,
  ): boolean {
    return (
      job.origin === RunnerJobOrigin.AiInvestigation &&
      !job.aiRunId &&
      !job.autoRemediationSuggestionId
    );
  }

  // Whether a claimed job is a command OneUptime AI sent (not a runbook step).
  public static isAiCommandJob(job: Pick<RunnerJob, "origin">): boolean {
    return AI_COMMAND_JOB_ORIGINS.includes(
      job.origin || RunnerJobOrigin.Runbook,
    );
  }

  /*
   * Why a job an agent just claimed must be failed instead of served, or
   * null when it may be served: an AI command (not an access test) of a
   * project whose Enable AI is off now. projectId is the claim's project:
   * the authenticated agent's, which every claim query holds the job to.
   */
  public static async getClaimRefusal(data: {
    job: Pick<RunnerJob, "origin" | "aiRunId" | "autoRemediationSuggestionId">;
    projectId: ObjectID;
  }): Promise<string | null> {
    if (
      !AiCommandKillSwitch.isAiCommandJob(data.job) ||
      AiCommandKillSwitch.isAccessTestJob(data.job)
    ) {
      return null;
    }

    return (await AiCommandKillSwitch.isAiOff(data.projectId))
      ? AI_COMMANDS_OFF_CLAIM_MESSAGE
      : null;
  }
}
