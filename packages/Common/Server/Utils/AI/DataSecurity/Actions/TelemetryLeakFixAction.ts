import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityFixResult } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import TelemetryLeakFix, {
  TelemetryLeakFixPlan,
} from "../../../DataSecurity/TelemetryLeakFix";
import CallerPermission from "../../../Permission/CallerPermission";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
} from "../DataSecurityAiAction";

/*
 * A SERVICE'S TELEMETRY LEAKS FIXED IN ITS CODE, AS ONEUPTIME AI PROPOSES IT
 * (#10367).
 *
 * After each evaluation, while OneUptime AI works on the project's Data
 * Security issues, it proposes each service's fix (TelemetryLeakFixProposals)
 * as the project's AI rules say for the service's riskiest issue - out of
 * the box Fix is Suggest, so the pull request waits for a person in Data
 * Security > AI, showing where each leak is written and the files OneUptime
 * AI starts from. A rule whose Fix is Without asking opens it on its own: a
 * pull request merges nothing (OpensPullRequest), and the repository's cap
 * on open AI pull requests holds it, the riskiest service first.
 *
 * It is planned for the service, never by the engine for one issue; it is
 * kept on the riskiest of the issues it fixes. Approving it asks for the
 * service's fix in the proposal's repository - or the one the person picks,
 * when nothing decided - with the approver's own permissions, as Fix with
 * AI does (TelemetryLeakFix.start), from where the leaks are written now.
 * It is not undone here: a pull request is closed where it was opened.
 */

// Who may approve it: who may ask Fix with AI for it, who may change the issues.
export const TELEMETRY_FIX_APPROVE_PERMISSIONS: ReadonlyArray<Permission> =
  new DataSecurityIssue().updateRecordPermissions;

export const TELEMETRY_FIX_APPROVE_REFUSED_MESSAGE: string =
  "Asking OneUptime AI for this pull request takes the permission to change Data Security issues.";

export const TELEMETRY_FIX_UNDO_REFUSED_MESSAGE: string =
  "A pull request is closed where it was opened: close it in Code, or on its repository.";

export const TELEMETRY_FIX_NOTHING_LEFT_MESSAGE: string =
  "This service no longer writes sensitive data to its telemetry that OneUptime sees, so no pull request was asked for.";

function holdsAnyOf(
  props: DatabaseCommonInteractionProps,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return (
    Boolean(props.isRoot) ||
    Boolean(props.isMasterAdmin) ||
    CallerPermission.holdsAnyOf(props, permissions)
  );
}

function readId(value: unknown): string {
  return typeof value === "string" && ObjectID.isValidUUID(value.trim())
    ? value.trim().toLowerCase()
    : "";
}

/*
 * Of the service's fixes now, the one the proposal was for: in its
 * repository - or, for a proposal no repository decided, the one no
 * repository decides still, else the riskiest.
 */
export function pickProposedPlan(data: {
  plans: ReadonlyArray<TelemetryLeakFixPlan>;
  repositoryId: string;
}): TelemetryLeakFixPlan | null {
  if (data.repositoryId) {
    return (
      data.plans.find((plan: TelemetryLeakFixPlan): boolean => {
        return (plan.repository?.id || "").toLowerCase() === data.repositoryId;
      }) || null
    );
  }

  return (
    data.plans.find((plan: TelemetryLeakFixPlan): boolean => {
      return !plan.repository;
    }) ||
    data.plans[0] ||
    null
  );
}

export const TelemetryLeakFixAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.FixTelemetryLeaksInCode,

  // Planned for a service, never for one issue.
  appliesToCheck(_checkId: string | undefined): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "planned-for-the-service" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return holdsAnyOf(data.props, TELEMETRY_FIX_APPROVE_PERMISSIONS)
      ? null
      : TELEMETRY_FIX_APPROVE_REFUSED_MESSAGE;
  },

  getUndoRefusal(): string | null {
    return TELEMETRY_FIX_UNDO_REFUSED_MESSAGE;
  },

  // The repository the person picked, when the proposal had none to go to.
  async readChanges(data: { changes: unknown }): Promise<JSONObject> {
    const changes: unknown = data.changes;

    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new BadDataException("Say what you changed before approving.");
    }

    const repositoryId: string = readId(
      (changes as JSONObject)["codeRepositoryId"],
    );

    if (!repositoryId) {
      throw new BadDataException(
        "Choose the repository the pull request goes to.",
      );
    }

    return { codeRepositoryId: repositoryId };
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade> {
    const serviceId: string = readId(data.proposal.plan?.["serviceId"]);
    const plannedRepositoryId: string = readId(
      data.proposal.plan?.["repositoryId"],
    );
    const pickedRepositoryId: string = readId(
      data.changes?.["codeRepositoryId"],
    );

    if (!serviceId) {
      throw new BadDataException(TELEMETRY_FIX_NOTHING_LEFT_MESSAGE);
    }

    const plan: TelemetryLeakFixPlan | null = pickProposedPlan({
      plans: await TelemetryLeakFix.planService({
        projectId: data.projectId,
        serviceId: new ObjectID(serviceId),
      }),
      repositoryId: plannedRepositoryId,
    });

    if (!plan) {
      throw new BadDataException(TELEMETRY_FIX_NOTHING_LEFT_MESSAGE);
    }

    const repositoryId: string =
      pickedRepositoryId ||
      plannedRepositoryId ||
      (plan.repository?.id || "").toLowerCase();

    if (!repositoryId) {
      throw new BadDataException(
        "Choose the repository the pull request goes to.",
      );
    }

    const llmProviderId: string = readId(data.proposal.plan?.["llmProviderId"]);
    const result: DataSecurityFixResult & { wasAlreadyAsked?: boolean } =
      await TelemetryLeakFix.start({
        projectId: data.projectId,
        plan,
        props: data.actor.props,
        requestedRepositoryId: repositoryId,
        ...(llmProviderId ? { llmProviderId: new ObjectID(llmProviderId) } : {}),
      });

    if (!result.aiRunId) {
      throw new BadDataException(result.message);
    }

    return {
      result: { aiRunId: result.aiRunId },
      summaryMarkdown: (result.wasAlreadyAsked
        ? mdText`The service's pull request was already on its way.`
        : mdText`OneUptime AI is writing one pull request that stops ${plan.serviceName || "the service"} writing sensitive data to its telemetry. It appears under Code, and on each issue it fixes.`
      ).toString(),
    };
  },

  async undo(): Promise<DataSecurityAiChangeUndone> {
    throw new BadDataException(TELEMETRY_FIX_UNDO_REFUSED_MESSAGE);
  },
};

export default TelemetryLeakFixAction;
