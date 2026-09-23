import DatabaseService from "./DatabaseService";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Model from "../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../Models/DatabaseModels/Runner";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A rule's Command Runners are the hosts its AI-composed Bash/SSH commands
   * may target. A kubernetes-agent Runner (the in-cluster Runner the agent
   * chart registers; RunnerService.isKubernetesAgentRunnerRow) is never
   * one: it runs policy-tiered kubectl for its own cluster only, the claim
   * path never serves it shell work, and its identity is issued with the
   * project's telemetry ingestion key. A rule narrowed to one could never
   * run a command. The dashboard does not offer these Runners; this refuses
   * them on the API path too.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const agentRunners: Array<Runner> =
      await RunnerService.findKubernetesAgentRunners(
        createBy.data.commandRunners,
      );

    if (agentRunners.length > 0) {
      throw new BadDataException(
        Service.getAgentCommandRunnerRefusal(agentRunners[0]!),
      );
    }

    return { createBy, carryForward: [] };
  }

  /*
   * The same refusal on every write of the Command Runners list, with one
   * exception: a kubernetes-agent Runner a rule ALREADY holds (saved before
   * this guard) may be re-posted. The dashboard's rule form re-posts every
   * field, including a stored Runner its picker no longer lists, so
   * refusing it would block every edit of such a rule with nothing on the
   * form to remove. Dropping it silently would be worse: a rule narrowed to
   * that Runner alone would widen to "any Runner" on an unrelated edit. A
   * held agent Runner is harmless — AI is only ever offered online Runners
   * that are not agents (RunnerService.getOnlineAiCommandRunnersForProject),
   * so it narrows the rule to nothing it can target. Adding one is refused.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    const agentRunners: Array<Runner> =
      await RunnerService.findKubernetesAgentRunners(data["commandRunners"]);

    if (agentRunners.length === 0) {
      return { updateBy, carryForward: null };
    }

    /*
     * onBeforeUpdate runs before the framework scopes the query to the
     * caller's project, so scope the read here: a caller's write is never
     * judged against another project's rules.
     */
    const rules: Array<Model> = await this.findBy({
      query: {
        ...updateBy.query,
        ...(updateBy.props.tenantId
          ? { projectId: updateBy.props.tenantId }
          : {}),
      },
      select: {
        _id: true,
        commandRunners: { _id: true },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const agentRunner of agentRunners) {
      const isHeldByEveryRule: boolean = rules.every((rule: Model) => {
        return Service.holdsRunner(rule, agentRunner);
      });

      if (!isHeldByEveryRule) {
        throw new BadDataException(
          Service.getAgentCommandRunnerRefusal(agentRunner),
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  private static holdsRunner(rule: Model, runner: Runner): boolean {
    const runnerId: string | undefined =
      runner.id?.toString() || runner._id?.toString();

    if (!runnerId) {
      return false;
    }

    return RunnerServiceClass.readRunnerIds(rule.commandRunners).some(
      (heldId: ObjectID) => {
        return heldId.toString() === runnerId;
      },
    );
  }

  public static getAgentCommandRunnerRefusal(runner: Runner): string {
    return `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, never the Bash or SSH commands a rule composes, so it cannot be one of this rule's Command Runners. OneUptime AI reaches that cluster through the cluster's AI page instead. Choose Runners you created under Project Settings → Runners, or leave Command Runners empty to allow any Runner with AI commands enabled.`;
  }
}

export default new Service();
