import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ResourceCommandPolicy from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import QueryHelper from "../../Types/Database/QueryHelper";
import AIRunService from "../../Services/AIRunService";
import AlertService from "../../Services/AlertService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../Services/IncidentService";
import ResourceAiAccessService from "../../Services/ResourceAiAccessService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../AffectedResources/LinkedAffectedResources";
import RemediationCommandToolkit from "../AI/Remediation/RemediationCommandTools";
import RemediationExecutionRunner from "../AI/Remediation/RemediationExecutionRunner";

/*
 * A WORKFLOW ASKS FOR A FIX, AND A PERSON SAYS YES.
 *
 * A workflow's Propose an OpenStack fix step ends here. It takes the road a fix OneUptime AI
 * proposes takes: the same toolkit, so the same policy, write scope, protected targets and
 * read of what a change touches; into the same suggestion, which only RemediationApproval
 * runs, on a person's click, through the same chokepoint and the same agent. Nothing here
 * enqueues a change. The plan's every command requires approval whatever the cloud's mode is,
 * so a workflow can neither make a change nor approve what it proposed, and what a workflow's
 * settings say can't turn that off: its command is whatever {{...}} resolved to, read after that.
 *
 * Nothing here calls a model, so an AI run's budget has no say. There is a run's row all the
 * same, because that's what a read of what a change touches is filed under, and it is
 * finished from the start, so that nothing ever picks it up to run.
 */

/*
 * Each one is a card somebody has to read, and an alert that flaps fires its workflow every
 * time. The same change is one card however often it is asked for; this is for the rest.
 */
export const MAX_OPENSTACK_WORKFLOW_PROPOSALS_PER_PROJECT_PER_HOUR: number = 20;

const OPEN_PROPOSALS_TO_READ: number = 50;
const VERIFICATION_WINDOW_MINUTES: number = 15;

// What a workflow's suggestion is called, and how the brake finds its fellows.
const WORKFLOW_PROPOSAL_NAME_PREFIX: string = 'Workflow "';

export interface OpenStackWorkflowFixInput {
  projectId: ObjectID;
  workflowName: string;
  alertId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  cloudId?: ObjectID | undefined;
  command: string;
  reason?: string | undefined;
}

export type OpenStackWorkflowFixResult =
  | {
      isProposed: true;
      suggestionId: ObjectID;
      tierName: string;
      wasAlreadyWaiting: boolean;
    }
  | { isProposed: false; refusal: string };

function refuse(refusal: string): OpenStackWorkflowFixResult {
  return { isProposed: false, refusal };
}

function getTierName(tier: ResourceCommandTier): string {
  return tier === ResourceCommandTier.SafeWrite ? "Safe" : "Riskier";
}

export default class OpenStackWorkflowFix {
  public static async propose(
    data: OpenStackWorkflowFixInput,
  ): Promise<OpenStackWorkflowFixResult> {
    const { projectId } = data;
    const command: string = data.command.trim();

    if (!command) {
      return refuse("The step has no command to propose.");
    }

    if (Boolean(data.alertId) === Boolean(data.incidentId)) {
      return refuse(
        "Say which alert or which incident this fix is for: one of them, not both.",
      );
    }

    // The policy first: what can never be proposed needs nothing else read to say so.
    const policy: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command,
      });

    if (policy.tier === ResourceCommandTier.Denied) {
      return refuse(`OneUptime can't propose this: ${policy.reason}.`);
    }

    if (policy.tier === ResourceCommandTier.Read) {
      return refuse(
        `"${policy.displayCommand}" only reads, so there is nothing for a person to approve.`,
      );
    }

    const cloudOrRefusal: ObjectID | string = await this.readCloudOf(data);

    if (typeof cloudOrRefusal === "string") {
      return refuse(cloudOrRefusal);
    }

    const cloudId: ObjectID = cloudOrRefusal;

    const gateRefusal: string | null =
      await RemediationExecutionRunner.checkProjectGates({ projectId });

    if (gateRefusal) {
      return refuse(gateRefusal);
    }

    const status: ResourceAiAccessStatus | null =
      await ResourceAiAccessService.getStatusForResource({
        projectId,
        resourceType: AiResourceType.OpenStackCloud,
        resourceId: cloudId,
      });

    if (!status) {
      return refuse("That OpenStack cloud is not in this project.");
    }

    if (!status.isRemediationReady) {
      const gap: ResourceAiAccessGap | undefined = status.gaps.find(
        (candidate: ResourceAiAccessGap): boolean => {
          return candidate.blocksRemediation;
        },
      );

      return refuse(
        gap
          ? `${gap.title}. ${gap.nextStep}`
          : "Fixes are not allowed on this OpenStack cloud yet.",
      );
    }

    const scopeRefusal: string | null =
      RemediationCommandToolkit.getResourceWriteScopeRefusal({
        resource: status,
        command,
      });

    if (scopeRefusal) {
      return refuse(scopeRefusal);
    }

    const waiting: AutoRemediationSuggestion | null =
      await this.findWaitingProposal({ projectId, cloudId, command });

    if (waiting?.id) {
      return {
        isProposed: true,
        suggestionId: waiting.id,
        tierName: getTierName(policy.tier),
        wasAlreadyWaiting: true,
      };
    }

    const proposedLastHour: number = (
      await AutoRemediationSuggestionService.countBy({
        query: {
          projectId,
          ruleNameSnapshot: QueryHelper.startsWith(
            WORKFLOW_PROPOSAL_NAME_PREFIX,
          ),
          createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (
      proposedLastHour >= MAX_OPENSTACK_WORKFLOW_PROPOSALS_PER_PROJECT_PER_HOUR
    ) {
      return refuse(
        `This project's workflows have proposed ${proposedLastHour} fixes in the last hour, and each is a card somebody has to read. Try again later.`,
      );
    }

    const name: string = `${WORKFLOW_PROPOSAL_NAME_PREFIX}${data.workflowName}"`;
    const run: AIRun = await this.recordRun({ ...data, name });
    const suggestionId: ObjectID = ObjectID.generate();

    const toolkit: RemediationCommandToolkit = new RemediationCommandToolkit({
      projectId,
      aiRunId: run.id!,
      suggestionId,
      mode: "Suggest",
      allowlistPatterns: [],
      allowedRunnerIds: [],
      clusterTargets: [],
      resourceTargets: [status],
      resourceRoundNumber: 1,
      suggestionCreatedAt: OneUptimeDate.getCurrentDate(),
      proposesRefusedCommands: true,
      resourceHold: { anyOrder: false },
    });

    const problem: string | null = await toolkit.proposeOneCommand({
      stepType: RunbookStepType.ResourceCommand,
      resourceId: cloudId.toString(),
      command,
      rationale:
        data.reason || `The workflow ${data.workflowName} asked for it.`,
      expectedEffect: "What the command says, once a person approves it.",
    });

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();

    if (problem || !plan) {
      return refuse(problem || "The toolkit proposed nothing.");
    }

    plan.executionStatus = AiRemediationPlanExecutionStatus.NotStarted;

    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();

    suggestion.projectId = projectId;
    suggestion.resourceType = AiResourceType.OpenStackCloud;
    suggestion.resourceId = cloudId;
    suggestion.ruleNameSnapshot = name;
    suggestion.status = AutoRemediationSuggestionStatus.Suggested;
    suggestion.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    suggestion.executionMode = AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes = VERIFICATION_WINDOW_MINUTES;
    // A person approves it, and a person resolves what it was for.
    suggestion.autoResolveOnRecovery = false;
    suggestion.aiRunId = run.id!;
    suggestion.rationaleMarkdown = (
      data.reason
        ? mdText`Proposed by the workflow ${data.workflowName}: ${data.reason}`
        : mdText`Proposed by the workflow ${data.workflowName}.`
    ).toString();

    if (data.alertId) {
      suggestion.alertId = data.alertId;
    }

    if (data.incidentId) {
      suggestion.incidentId = data.incidentId;
    }

    const recordedPlan: AiRemediationCommandPlan =
      await RemediationExecutionRunner.withTrackRecords({
        suggestion,
        plan,
      });

    suggestion.commandPlan = AiRemediationCommandPlanUtil.toJSON(recordedPlan);

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    await AIRunService.updateOneById({
      id: run.id!,
      data: { triggeredByAutoRemediationSuggestionId: created.id! },
      props: { isRoot: true },
    });

    suggestion.id = created.id!;

    await RemediationExecutionRunner.announceProposedPlan({
      suggestion,
      plan: recordedPlan,
      isProposedByWorkflow: true,
    });

    return {
      isProposed: true,
      suggestionId: created.id!,
      tierName: getTierName(policy.tier),
      wasAlreadyWaiting: false,
    };
  }

  /*
   * The cloud the alert or incident is about, or why there's no saying. The record is this
   * project's or nothing, whatever ID a workflow's variables resolved to.
   */
  private static async readCloudOf(
    data: OpenStackWorkflowFixInput,
  ): Promise<ObjectID | string> {
    const { projectId } = data;
    let linked: Array<LinkedAffectedResource>;

    if (data.alertId) {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!alert) {
        return "There is no such alert in this project.";
      }

      linked = await LinkedAffectedResources.readForAlert({
        service: AlertService,
        projectId,
        alertId: data.alertId,
      });
    } else {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId!.toString(), projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!incident) {
        return "There is no such incident in this project.";
      }

      linked = await LinkedAffectedResources.readForIncident({
        service: IncidentService,
        projectId,
        incidentId: data.incidentId!,
      });
    }

    const clouds: Array<LinkedAffectedResource> = linked.filter(
      (resource: LinkedAffectedResource): boolean => {
        return resource.type === LinkedAffectedResourceType.OpenStackCloud;
      },
    );

    if (data.cloudId) {
      const named: string = data.cloudId.toString();
      const isOneOfThem: boolean = clouds.some(
        (cloud: LinkedAffectedResource): boolean => {
          return cloud.id === named;
        },
      );

      // A cloud the record doesn't name is fine only when it names none at all.
      return clouds.length === 0 || isOneOfThem
        ? data.cloudId
        : "That OpenStack cloud is not one this record is linked to.";
    }

    if (clouds.length === 1) {
      return new ObjectID(clouds[0]!.id);
    }

    return clouds.length === 0
      ? "This record is not linked to an OpenStack cloud. Fill in OpenStack Cloud ID to name one."
      : `This record is linked to ${clouds.length} OpenStack clouds. Fill in OpenStack Cloud ID to name one.`;
  }

  // The same change on the same cloud, already waiting for somebody, whoever proposed it.
  private static async findWaitingProposal(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    command: string;
  }): Promise<AutoRemediationSuggestion | null> {
    const rows: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          projectId: data.projectId,
          resourceType: AiResourceType.OpenStackCloud,
          resourceId: data.cloudId,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          status: AutoRemediationSuggestionStatus.Suggested,
        },
        select: { _id: true, commandPlan: true },
        limit: OPEN_PROPOSALS_TO_READ,
        skip: 0,
        props: { isRoot: true },
      });

    return (
      rows.find((row: AutoRemediationSuggestion): boolean => {
        return Boolean(
          AiRemediationCommandPlanUtil.parse(row.commandPlan)?.commands.some(
            (planned: AiRemediationCommand): boolean => {
              return planned.command === data.command;
            },
          ),
        );
      }) || null
    );
  }

  // What the reads of what a change touches are filed under: finished, so nothing runs it.
  private static async recordRun(
    data: OpenStackWorkflowFixInput & { name: string },
  ): Promise<AIRun> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const run: AIRun = new AIRun();

    run.projectId = data.projectId;
    run.runType = AIRunType.RemediationExecution;
    run.status = AIRunStatus.Completed;
    run.codeFixRecommendation = AIRunCodeFixRecommendation.NotRecommended;
    run.title = `${data.name} proposed a fix`;
    run.startedAt = now;
    run.completedAt = now;

    if (data.alertId) {
      run.triggeredByAlertId = data.alertId;
    }

    if (data.incidentId) {
      run.triggeredByIncidentId = data.incidentId;
    }

    return await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }
}
