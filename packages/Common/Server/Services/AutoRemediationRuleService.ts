import ProjectReferencesService from "./ProjectReferencesService";
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
import AutoRemediationAction, {
  isAutoRemediationAction,
} from "../../Types/AutoRemediation/AutoRemediationAction";
import AiRemediationCredentialUse, {
  RuleCommandSettings,
  RuleCommandSettingsChange,
} from "../Utils/AutoRemediation/AiRemediationCredentialUse";

/*
 * The columns that decide whether, and where, a rule runs OneUptime AI's
 * commands without asking (AiRemediationCredentialUse) - whether it is on
 * included.
 */
const COMMAND_SETTINGS_COLUMNS: Array<keyof RuleCommandSettings> = [
  "isEnabled",
  "remediationAction",
  "aiComposesCommands",
  "executionMode",
  "commandAllowlist",
  "commandRunners",
];

export class Service extends ProjectReferencesService<Model> {
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
    // The project's own records only, before anything here reads one.
    await super.onBeforeCreate(createBy);

    createBy.data.remediationAction = Service.getRemediationActionOnCreate(
      createBy.data,
    );

    /*
     * A rule that runs OneUptime AI's commands without asking is saved only
     * by someone who may read runbook credentials: its commands may run over
     * SSH with any credential assigned to its Runners, and nobody approves
     * them (AiRemediationCredentialUse).
     */
    AiRemediationCredentialUse.assertMaySaveRules({
      props: createBy.props,
      changes: [{ before: null, after: createBy.data }],
    });

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
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    if (
      data["remediationAction"] === null ||
      data["remediationAction"] === ""
    ) {
      throw new BadDataException(
        `Fix With must be one of: ${Object.values(AutoRemediationAction).join(", ")}.`,
      );
    }

    Service.assertRemediationAction(data["remediationAction"]);

    // Who may let OneUptime AI's commands run without asking. See the helper.
    await this.checkCommandsWithoutAsking(updateBy);

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

  /*
   * An update may leave a rule running OneUptime AI's commands without
   * asking more widely than it did - turn it on, add an allowlist pattern,
   * reach more Runners - only when its caller may read runbook credentials
   * (AiRemediationCredentialUse). Only a real change counts: the dashboard's
   * rule form posts every field, so an edit that keeps what a rule already
   * runs keeps it. The rules are read as OneUptime through the update's own
   * query and window - the rows the write itself goes on to change - pinned
   * to the request's project (hooks run before the framework scopes it),
   * and only when the update writes one of the settings at all.
   */
  private async checkCommandsWithoutAsking(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    const writesSettings: boolean = COMMAND_SETTINGS_COLUMNS.some(
      (column: keyof RuleCommandSettings): boolean => {
        return data[column] !== undefined;
      },
    );

    if (
      !writesSettings ||
      AiRemediationCredentialUse.mayUseCredentials(updateBy.props)
    ) {
      return;
    }

    const rules: Array<Model> = await this.findBy({
      query: {
        ...updateBy.query,
        ...(updateBy.props.tenantId
          ? { projectId: updateBy.props.tenantId }
          : {}),
      },
      select: {
        _id: true,
        isEnabled: true,
        remediationAction: true,
        aiComposesCommands: true,
        executionMode: true,
        commandAllowlist: true,
        commandRunners: { _id: true },
      },
      skip: this.normalizePositiveNumber(updateBy.skip) ?? 0,
      limit: this.normalizePositiveNumber(updateBy.limit) ?? LIMIT_MAX,
      props: { isRoot: true },
    });

    AiRemediationCredentialUse.assertMaySaveRules({
      props: updateBy.props,
      changes: rules.map((rule: Model): RuleCommandSettingsChange => {
        const after: RuleCommandSettings = {
          isEnabled: rule.isEnabled,
          remediationAction: rule.remediationAction,
          aiComposesCommands: rule.aiComposesCommands,
          executionMode: rule.executionMode,
          commandAllowlist: rule.commandAllowlist,
          commandRunners: rule.commandRunners,
        };

        for (const column of COMMAND_SETTINGS_COLUMNS) {
          if (data[column] !== undefined) {
            (after as unknown as JSONObject)[column] = data[column];
          }
        }

        return { before: rule, after: after };
      }),
    });
  }

  /*
   * What a new rule fixes with. The dashboard always says; an API or
   * Terraform client written before rules had a Fix With does not, and a
   * rule it creates with runbooks and no AI flag meant "run these
   * runbooks" - as it did before - not the column's default, OneUptime AI.
   * Anything else that names no Fix With is OneUptime AI.
   */
  public static getRemediationActionOnCreate(
    data: Pick<
      Model,
      | "remediationAction"
      | "runbooks"
      | "aiComposesCommands"
      | "aiSelectsRunbook"
    >,
  ): AutoRemediationAction {
    if (isAutoRemediationAction(data.remediationAction)) {
      return data.remediationAction;
    }

    Service.assertRemediationAction(data.remediationAction);

    const hasRunbooks: boolean =
      Array.isArray(data.runbooks) && data.runbooks.length > 0;

    return hasRunbooks && !data.aiComposesCommands && !data.aiSelectsRunbook
      ? AutoRemediationAction.Runbooks
      : AutoRemediationAction.OneUptimeAI;
  }

  // A Fix With that is given must be one this build knows.
  public static assertRemediationAction(value: unknown): void {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (!isAutoRemediationAction(value)) {
      throw new BadDataException(
        `Fix With must be one of: ${Object.values(AutoRemediationAction).join(", ")}.`,
      );
    }
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
    return `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, never the Bash or SSH commands a rule composes, so it cannot be one of this rule's Command Runners. OneUptime AI reaches that cluster through its Kubernetes AI agent instead (the cluster's AI → Agent page). Choose Runners you created under Runbooks → Runners, or leave Command Runners empty to allow any Runner with AI commands enabled.`;
  }
}

export default new Service();
