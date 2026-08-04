import AIAgentService from "../../../Services/AIAgentService";
import RunnerService from "../../../Services/RunnerService";
import ObjectID from "../../../../Types/ObjectID";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import Runner from "../../../../Models/DatabaseModels/Runner";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export interface OnlineCodeFixAgent {
  name: string;
}

/*
 * Who can actually pick up a code-fix run for a project. Two kinds of agent
 * claim that work, so both count:
 *
 *   - an AIAgent row: the in-cluster fleet, and legacy per-project agents.
 *   - a OneUptime Runner (Runner row) with the code-fix capability
 *     enabled — what a customer installs today.
 *
 * Readiness checks and the orphaned-run sweeper share this, so a project
 * served only by a Runner is never told "no agent is online" and never has
 * its queued runs failed out from under a Runner that was polling all along.
 */
export default class CodeFixAgentAvailability {
  @CaptureSpan()
  public static async getOnlineAgentForProject(
    projectId: ObjectID,
  ): Promise<OnlineCodeFixAgent | null> {
    const aiAgent: AIAgent | null =
      await AIAgentService.getConnectedAIAgentForProject(projectId);

    if (aiAgent) {
      return { name: aiAgent.name || "AI agent" };
    }

    const runner: Runner | null =
      await RunnerService.getOnlineCodeFixRunnerForProject(projectId);

    if (runner) {
      return { name: runner.name || "Runner" };
    }

    return null;
  }

  @CaptureSpan()
  public static async hasOnlineAgentForProject(
    projectId: ObjectID,
  ): Promise<boolean> {
    return Boolean(
      await CodeFixAgentAvailability.getOnlineAgentForProject(projectId),
    );
  }
}
