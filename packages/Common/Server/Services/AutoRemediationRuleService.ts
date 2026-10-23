import ProjectReferencesService from "./ProjectReferencesService";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Model from "../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../Models/DatabaseModels/Runner";
import AutoRemediationAction, {
  isAutoRemediationAction,
} from "../../Types/AutoRemediation/AutoRemediationAction";
import { readAutoRemediationIds } from "../../Types/AutoRemediation/AutoRemediationFix";
import RunnerAiCommandsPick from "../Utils/Runner/RunnerAiCommandsPick";
import { getRuleExternalMcpServersProblem } from "../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { getRuleCodeRepositoriesProblem } from "../../Types/CodeRepository/CodeRepositoryAllowance";
import { getAiRuleShapeProblem } from "../../Types/AI/AiRule";
import {
  AI_RULE_CRITERIA_FIELDS,
  getAiRuleCriteriaProblem,
} from "../../Types/AI/AiRuleCriteria";
import { getInvestigationRuleWaitProblem } from "../../Types/AI/InvestigationRuleWait";

// The keys a write names the rule's Runner by: the id, or the relation.
const RUNNER_KEYS: Array<string> = ["runnerId", "runner"];

/*
 * The AI rules of incidents and alerts (Types/AI/AiRule): the table the
 * auto remediation rules had, which the investigation rules moved into. A
 * rule investigates what it matches, fixes it, or both; it may wait before
 * investigating; and its conditions are its own kind of signal's.
 */

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A rule names at most as many external MCP servers as a project may
   * have, and at most MAX_CODE_REPOSITORIES_PER_RULE code repositories:
   * answered before any reference is read. Whether each is the project's
   * own is checked with every other reference the rule writes.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    this.assertMcpServersFit(createBy.data.externalMcpServers);
    this.assertCodeRepositoriesFit(createBy.data.codeRepositories);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    // An edit that leaves a list alone is not judged on it.
    if (data["externalMcpServers"] !== undefined) {
      this.assertMcpServersFit(data["externalMcpServers"]);
    }

    if (data["codeRepositories"] !== undefined) {
      this.assertCodeRepositoriesFit(data["codeRepositories"]);
    }
  }

  /*
   * What a new rule does and matches, judged after the project check and
   * before anything here reads a Runner: these read nothing.
   *
   * What it does is what the write says, else the columns' defaults - it
   * fixes, and does not investigate, as an auto remediation rule an older
   * API or Terraform client creates always did.
   */
  public static assertNewRuleFits(data: Model): void {
    Service.assertShapeFits({
      investigates: data.investigates,
      fixes: data.fixes,
    });

    Service.assertWaitFits(data.onlyIfOpenAfterMinutes);

    Service.assertCriteriaFitTrigger({
      triggerEntityType: data.triggerEntityType,
      data: data as unknown as Record<string, unknown>,
    });
  }

  /*
   * A rule investigates, fixes, or both: one that does neither does
   * nothing, and would still narrow what is fixed (Types/AI/AiRule).
   */
  public static assertShapeFits(rule: {
    investigates?: unknown;
    fixes?: unknown;
  }): void {
    const problem: string | null = getAiRuleShapeProblem(rule);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * A rule's wait (onlyIfOpenAfterMinutes, issue #5074) is a whole number of
   * minutes, at most a day, or nothing. Refused with a message that says
   * so, rather than saved as a wait OneUptime AI would read differently.
   */
  public static assertWaitFits(value: unknown): void {
    const problem: string | null = getInvestigationRuleWaitProblem(value);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * One table holds incident and alert rules, and each can only match on
   * its own kind of signal's criteria: a condition on alert severities can
   * never be true for an incident. Such a rule is refused instead of being
   * saved as one that silently never matches - which, since rules narrow
   * what is investigated and fixed, would quietly stop both.
   */
  public static assertCriteriaFitTrigger(data: {
    triggerEntityType: unknown;
    data: Record<string, unknown>;
  }): void {
    const problem: string | null = getAiRuleCriteriaProblem({
      triggerEntityType: data.triggerEntityType,
      criteria: data.data["criteria"],
      values: data.data,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  // Whether an update writes the rule's conditions.
  public static doesUpdateChangeCriteria(
    data: Record<string, unknown>,
  ): boolean {
    return (
      (data["criteria"] !== undefined && data["criteria"] !== null) ||
      AI_RULE_CRITERIA_FIELDS.some((field: string): boolean => {
        const value: unknown = data[field];
        return Array.isArray(value) && value.length > 0;
      })
    );
  }

  // Whether an update writes what the rule does: investigate, fix, or both.
  public static doesUpdateChangeShape(data: Record<string, unknown>): boolean {
    return data["investigates"] !== undefined || data["fixes"] !== undefined;
  }

  private assertMcpServersFit(servers: unknown): void {
    const problem: string | null = getRuleExternalMcpServersProblem(servers);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  private assertCodeRepositoriesFit(repositories: unknown): void {
    const problem: string | null = getRuleCodeRepositoriesProblem(repositories);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * A rule's Runner (and, for a rule saved before rules were simplified, its
   * Command Runners) are the hosts its AI-composed Bash commands may target.
   * A kubernetes-agent Runner (the in-cluster Runner the agent chart
   * registers; RunnerService.isKubernetesAgentRunnerRow) is never one: it
   * runs policy-tiered kubectl for its own cluster only, the claim path
   * never serves it shell work, and its identity is issued with the
   * project's telemetry ingestion key. A rule narrowed to one could never
   * run a command. The dashboard does not offer these Runners; this refuses
   * them on the API path too. That the Runner is one of the rule's own
   * project's - never another project's, never a global Runner - the
   * project check in super.onBeforeCreate has decided before this runs.
   *
   * Picking the Runner is what lets OneUptime AI's commands run on it
   * (RunnerAiCommandsPick): there is no switch on the Runner any more.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeCreate(createBy);

    Service.assertNewRuleFits(createBy.data);

    createBy.data.remediationAction = Service.getRemediationActionOnCreate(
      createBy.data,
    );

    const written: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const agentRunners: Array<Runner> =
      await RunnerService.findKubernetesAgentRunners([
        ...RunnerServiceClass.readRunnerIds(createBy.data.commandRunners),
        ...Service.readWrittenRunnerIds(written),
      ]);

    if (agentRunners.length > 0) {
      throw new BadDataException(
        Service.getAgentCommandRunnerRefusal(agentRunners[0]!),
      );
    }

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: createBy.data.projectId || createBy.props.tenantId,
      runnerIds: Service.readWrittenRunnerIds(written),
      props: createBy.props,
    });

    return { createBy, carryForward: [] };
  }

  /*
   * The same refusal on every write of the rule's Runners, with one
   * exception: a kubernetes-agent Runner a rule ALREADY holds (saved before
   * this guard) may be re-posted. The dashboard's rule form re-posts every
   * field, including a stored Runner its picker no longer lists, so refusing
   * it would block every edit of such a rule with nothing on the form to
   * remove. Dropping it silently would be worse: the rule's Runner would
   * change on an unrelated edit. A held agent Runner is harmless - the claim
   * path never serves it shell work - so it narrows the rule to nothing it
   * can target. Adding one is refused.
   *
   * An edit of what the rule does (investigates, fixes) is judged with the
   * rule's other column as stored - one that would leave a rule doing
   * neither is refused - and an edit of its conditions against the rule's
   * own kind of signal (its trigger cannot change).
   *
   * It reads the rules the update writes - the ones its caller may write -
   * once, and the update is held to the rules read
   * (findRowsAndHoldUpdateToThem), so a rule the check did not see is never
   * written. Nothing is read when the update names no kubernetes-agent
   * Runner and changes neither what the rule does nor its conditions. A
   * Runner the update picks is let run OneUptime AI's commands once the
   * checks pass (RunnerAiCommandsPick).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    // An edit that leaves the wait alone is not judged on it.
    if (data["onlyIfOpenAfterMinutes"] !== undefined) {
      Service.assertWaitFits(data["onlyIfOpenAfterMinutes"]);
    }

    if (
      data["remediationAction"] === null ||
      data["remediationAction"] === ""
    ) {
      throw new BadDataException(
        `Fix With must be one of: ${Object.values(AutoRemediationAction).join(", ")}.`,
      );
    }

    Service.assertRemediationAction(data["remediationAction"]);

    const writtenRunnerIds: Array<ObjectID> = Service.readWrittenRunnerIds(
      data as unknown as Record<string, unknown>,
    );

    const agentRunners: Array<Runner> =
      await RunnerService.findKubernetesAgentRunners([
        ...RunnerServiceClass.readRunnerIds(data["commandRunners"]),
        ...writtenRunnerIds,
      ]);

    const written: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;
    const changesShape: boolean = Service.doesUpdateChangeShape(written);
    const changesCriteria: boolean = Service.doesUpdateChangeCriteria(written);

    if (agentRunners.length === 0 && !changesShape && !changesCriteria) {
      await this.allowPickedRunners({
        updateBy,
        runnerIds: writtenRunnerIds,
        projectIds:
          writtenRunnerIds.length > 0
            ? await this.findProjectsToCheckUpdateIn(updateBy)
            : [],
      });

      return { updateBy, carryForward: null };
    }

    const rules: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        commandRunners: { _id: true },
        runnerId: true,
        triggerEntityType: true,
        investigates: true,
        fixes: true,
      },
    );

    for (const rule of rules) {
      if (changesShape) {
        Service.assertShapeFits({
          investigates:
            written["investigates"] !== undefined
              ? written["investigates"]
              : rule.investigates,
          fixes: written["fixes"] !== undefined ? written["fixes"] : rule.fixes,
        });
      }

      if (changesCriteria) {
        Service.assertCriteriaFitTrigger({
          triggerEntityType: rule.triggerEntityType,
          data: written,
        });
      }
    }

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

    await this.allowPickedRunners({
      updateBy,
      runnerIds: writtenRunnerIds,
      projectIds: this.getProjectsToCheckRowsIn(updateBy.props, rules),
    });

    return { updateBy, carryForward: null };
  }

  /*
   * Lets the Runner an update picks run OneUptime AI's commands, in each
   * project the update writes rules in: a teammate's request's project, or -
   * for OneUptime's own update, or a master admin's - the project of each
   * rule it writes. The caller works those out with the update path's own
   * readers (findProjectsToCheckUpdateIn, getProjectsToCheckRowsIn), which
   * hold the update to the rules read, so a rule in a project the Runner
   * was not allowed in is never written.
   */
  private async allowPickedRunners(data: {
    updateBy: UpdateBy<Model>;
    runnerIds: Array<ObjectID>;
    projectIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.runnerIds.length === 0) {
      return;
    }

    for (const projectId of data.projectIds) {
      await RunnerAiCommandsPick.allowPickedRunners({
        projectId,
        runnerIds: data.runnerIds,
        props: data.updateBy.props,
      });
    }
  }

  // The Runner a write names for its rules, as an id, or none.
  public static readWrittenRunnerIds(
    data: Record<string, unknown> | undefined,
  ): Array<ObjectID> {
    if (!data) {
      return [];
    }

    return RunnerServiceClass.readRunnerIds(
      RUNNER_KEYS.map((key: string): unknown => {
        return data[key];
      }).filter((value: unknown): boolean => {
        return value !== undefined && value !== null && value !== "";
      }),
    );
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

  // Whether a rule holds this Runner already: as its Runner, or a Command Runner.
  private static holdsRunner(rule: Model, runner: Runner): boolean {
    const runnerId: string | undefined =
      runner.id?.toString() || runner._id?.toString();

    if (!runnerId) {
      return false;
    }

    const held: Array<string> = readAutoRemediationIds([
      rule.runnerId,
      ...RunnerServiceClass.readRunnerIds(rule.commandRunners),
    ]);

    return held.includes(runnerId.toLowerCase());
  }

  public static getAgentCommandRunnerRefusal(runner: Runner): string {
    return `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, never the Bash commands a rule composes, so it cannot be this rule's Runner. OneUptime AI reaches that cluster through its Kubernetes AI agent instead (the cluster's AI → Agent page), whatever Runner the rule picks. Pick a Runner you created under Runbooks → Runners, or none.`;
  }
}

export default new Service();
