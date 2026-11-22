import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import { SecurityCaseFeedEventType } from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStatus from "../../../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseTask from "../../../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "../../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { Indigo500 } from "../../../../../Types/BrandColors";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityBlockAction } from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR,
  SECURITY_CASE_AI_ACTION_AREAS,
  SECURITY_CASE_AI_BLOCK_DURATION,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiOnItsOwnStamp,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  isSecurityCaseAiBreakerTripped,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseAiActionEvidence,
  toSecurityCaseAiActionEvidenceJson,
} from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import {
  SECURITY_CASE_AI_ACTION_REASON_SENTENCES,
  getSecurityCaseAiActionTitle,
} from "../../../../../Types/SecurityCase/SecurityCaseAiWords";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityCaseMatchesJson } from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityEntityType,
  readSecurityEntities,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { findProtectingRule } from "../../../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import SecurityPlaybookTrigger from "../../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { createTranslator } from "../../../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { isCaseBlockableAddress } from "../../../../../Utils/SecurityCase/ResponsePlan/BlockableAddresses";
import {
  HOST_CONTAINMENT_ACTIONS,
  USER_CONTAINMENT_ACTIONS,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import { ResponseStep } from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { wordStepCheckSentence } from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckSentences";
import SecurityCaseStatuses from "../../../../../Utils/SecurityCase/SecurityCaseStatuses";
import { canonicalAddress } from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import IncidentSeverityService from "../../../../Services/IncidentSeverityService";
import SecurityBlockService from "../../../../Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../../Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../Services/SecurityPlaybookService";
import SecurityProtectedEntityService from "../../../../Services/SecurityProtectedEntityService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import { ProjectSecurityCaseValues } from "../../../SecurityCase/SecurityCaseValues";
import { ResponderIntent } from "./SecurityCaseResponsePlanner";

/*
 * ONEUPTIME AI'S TOOLS ON A SECURITY CASE (#10352): each thing it does,
 * asks or leaves on a case it works, carried out through the same server
 * path a person's would take.
 *
 *   - Every change of the case, every block and lift, every containment
 *     and the code fix is one step of the playbook engine
 *     (SecurityPlaybookRunService.startAiStepRun): its approvals - a step
 *     OneUptime AI asks about waits for a person's, in Slack and Microsoft
 *     Teams too - its protected checks, its timeline, its audit log and its
 *     undo apply as they do to any run, and its changes read as OneUptime
 *     AI's.
 *   - Taking the case puts it on OneUptime AI's queue; a step it marks done
 *     is a task of the case's ticked, as a person's tick is
 *     (SecurityCaseTaskService) - each on the timeline as OneUptime AI's.
 *
 * Its own authorization, whatever the planner decided: what it acts on is
 * the case's own (a blockable address of the case's requests, an entity the
 * case names), checked against the protected list and the project's own
 * addresses first; nothing runs on its own past the hourly limit
 * (SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR); and every action is
 * recorded on the case's log before it starts, so an interrupted look reads
 * how it went instead of starting it again.
 */

// What a look hands each tool: the case, and what it was read with.
export interface ToolkitCase {
  projectId: ObjectID;
  securityCase: SecurityCase;
  // The look's run; none for a decision a person made on the card.
  aiRunId?: ObjectID | undefined;
  limits: SecurityCaseAiLimits;
  values: ProjectSecurityCaseValues;
  matches: SecurityCaseMatchesJson | null;
  // The plan's steps, by key: the words a timeline entry names a step by.
  stepsByKey: Map<string, ResponseStep>;
  now: Date;
}

// What came of carrying out one intent.
export interface ToolResult {
  status: SecurityCaseAiActionStatus;
  // The case goes to people, and why.
  handOff?: SecurityCaseHandOffReason | undefined;
}

// English, for the timeline: every reader sees the same entry.
const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

// The actions whose step is one of the engine's, and the engine's action for each.
const ENGINE_ACTIONS: Partial<
  Record<SecurityCaseAiActionKind, SecurityPlaybookActionType>
> = {
  [SecurityCaseAiActionKind.SetPriority]:
    SecurityPlaybookActionType.SetCasePriority,
  [SecurityCaseAiActionKind.MarkContained]:
    SecurityPlaybookActionType.SetCaseStatus,
  [SecurityCaseAiActionKind.CloseCase]:
    SecurityPlaybookActionType.SetCaseStatus,
  [SecurityCaseAiActionKind.DeclareIncident]:
    SecurityPlaybookActionType.DeclareIncident,
  [SecurityCaseAiActionKind.BlockAddress]:
    SecurityPlaybookActionType.BlockAddress,
  [SecurityCaseAiActionKind.LiftBlock]:
    SecurityPlaybookActionType.LiftAddressBlock,
  [SecurityCaseAiActionKind.RequestCodeFix]:
    SecurityPlaybookActionType.FixWithAi,
};

export default class SecurityCaseResponseToolkit {
  /*
   * One intent of a look, carried out: recorded on the case's log, then
   * done, asked or left. Never throws: what fails is recorded as failed,
   * and the look hands the case to people.
   */
  public static async carryOut(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<ToolResult> {
    try {
      if (intent.decision === SecurityCaseAiDecisionKind.Leave) {
        await this.leave(data, intent);
        return { status: SecurityCaseAiActionStatus.Left };
      }

      const refusal: ToolResult | null = await this.refuse(data, intent);

      if (refusal) {
        return refusal;
      }

      if (ENGINE_ACTIONS[intent.kind] !== undefined) {
        return await this.startEngineStep(data, intent);
      }

      switch (intent.kind) {
        case SecurityCaseAiActionKind.ContainAccount:
        case SecurityCaseAiActionKind.ContainHost:
          return await this.startEngineStep(data, intent);
        case SecurityCaseAiActionKind.TakeCase:
        case SecurityCaseAiActionKind.MarkStepDone:
        case SecurityCaseAiActionKind.OfferRuleException:
          return intent.decision === SecurityCaseAiDecisionKind.Ask
            ? await this.ask(data, intent)
            : await this.doDirectly(data, intent);
        default:
          await this.leave(data, intent);
          return { status: SecurityCaseAiActionStatus.Left };
      }
    } catch (error) {
      logger.error(
        `SecurityCaseResponseToolkit: ${intent.kind} on case ${data.securityCase.id?.toString()} failed:`,
      );
      logger.error(error);
      return {
        status: SecurityCaseAiActionStatus.Failed,
        handOff: SecurityCaseHandOffReason.StepFailed,
      };
    }
  }

  /*
   * What stops an action before it starts, whatever the planner decided:
   * the hourly limit on actions on its own, and what it would act on - an
   * address none of the case's requests came from, one already blocked, a
   * protected address, user or host. Each is recorded, and the case goes to
   * people where it must.
   */
  private static async refuse(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<ToolResult | null> {
    if (
      intent.decision === SecurityCaseAiDecisionKind.Do &&
      isSecurityCaseAiBreakerTripped(
        await this.countActionsOnItsOwnThisHour({
          projectId: data.projectId,
          now: data.now,
        }),
      )
    ) {
      return {
        status: SecurityCaseAiActionStatus.Left,
        handOff: SecurityCaseHandOffReason.BreakerTripped,
      };
    }

    if (intent.kind === SecurityCaseAiActionKind.BlockAddress) {
      const address: string | null = canonicalAddress(intent.target || "");

      if (
        !address ||
        !isCaseBlockableAddress({
          value: address,
          entities: readSecurityEntities(data.securityCase.entities),
          matches: data.matches,
        })
      ) {
        await this.leave(data, {
          ...intent,
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.NeedsJudgement,
        });
        return { status: SecurityCaseAiActionStatus.Left };
      }

      const check: Awaited<ReturnType<typeof SecurityBlockService.check>> =
        await SecurityBlockService.check({
          projectId: data.projectId,
          value: address,
          props: { isRoot: true },
        });

      if (check.coveredBy) {
        await this.leave(data, {
          ...intent,
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.AlreadyBlocked,
        });
        return { status: SecurityCaseAiActionStatus.Left };
      }

      if (check.protection?.protection) {
        await this.leave(data, {
          ...intent,
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.ProtectedTarget,
        });
        return {
          status: SecurityCaseAiActionStatus.Left,
          handOff: SecurityCaseHandOffReason.ProtectedTarget,
        };
      }

      // OneUptime could not tell whether it is one of the project's own: a person decides.
      if (
        check.problem ||
        !check.protection ||
        check.protection.unreadSources.length > 0
      ) {
        await this.leave(data, {
          ...intent,
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.NeedsJudgement,
        });
        return {
          status: SecurityCaseAiActionStatus.Left,
          handOff: SecurityCaseHandOffReason.CannotTell,
        };
      }
    }

    if (
      intent.kind === SecurityCaseAiActionKind.ContainAccount ||
      intent.kind === SecurityCaseAiActionKind.ContainHost
    ) {
      const entityType: SecurityEntityType =
        intent.kind === SecurityCaseAiActionKind.ContainAccount
          ? SecurityEntityType.User
          : SecurityEntityType.Host;
      const rules: Awaited<
        ReturnType<typeof SecurityProtectedEntityService.getRules>
      > = await SecurityProtectedEntityService.getRules({
        projectId: data.projectId,
        entityType,
      });

      if (
        findProtectingRule({
          type: entityType,
          value: intent.target || "",
          rules,
        })
      ) {
        await this.leave(data, {
          ...intent,
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.ProtectedTarget,
        });
        return {
          status: SecurityCaseAiActionStatus.Left,
          handOff: SecurityCaseHandOffReason.ProtectedTarget,
        };
      }
    }

    return null;
  }

  // Actions OneUptime AI took on its own in the last hour, across the project's cases.
  public static async countActionsOnItsOwnThisHour(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    return (
      await SecurityCaseAiActionService.countBy({
        query: {
          projectId: data.projectId,
          reason: SecurityCaseAiActionReason.OnItsOwn,
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveHours(data.now, -1),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  // ---------- The engine's steps ----------

  /*
   * One step of the engine's, for one action: recorded first, then started,
   * then linked to its run. Ask makes the step wait for a person's
   * approval; On its own lets it run - a containment step with its kind's
   * stamp of who let OneUptime AI contain on its own, as a playbook step
   * saved with Needs Approval off carries it.
   */
  private static async startEngineStep(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<ToolResult> {
    const isAsked: boolean = intent.decision === SecurityCaseAiDecisionKind.Ask;
    const built:
      | { step: SecurityPlaybookStep; targets?: Array<SecurityPlaybookTarget> }
      | string = await this.buildEngineStep(data, intent);

    // Nothing to run it with: the step is a person's, and the log says why.
    if (typeof built === "string") {
      await this.leave(data, {
        ...intent,
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: built as SecurityCaseAiActionReason,
      });
      return { status: SecurityCaseAiActionStatus.Left };
    }

    const row: SecurityCaseAiAction = await this.record(data, intent, {
      status: SecurityCaseAiActionStatus.Doing,
    });

    let run: SecurityPlaybookRun;

    try {
      run = await SecurityPlaybookRunService.startAiStepRun({
        projectId: data.projectId,
        securityCaseId: data.securityCase.id!,
        step: built.step,
        ...(built.targets ? { targets: built.targets } : {}),
      });
    } catch (error) {
      // One of its own already waits or runs on the case for the same target: that one is it.
      const existing: SecurityPlaybookRun | null =
        error instanceof BadDataException
          ? await this.findUnfinishedAiRun({
              data,
              action: built.step.action,
            })
          : null;

      if (!existing?.id) {
        await this.updateRow(row.id!, {
          status: SecurityCaseAiActionStatus.Failed,
          reason: SecurityCaseAiActionReason.EngineFailed,
          evidence: toSecurityCaseAiActionEvidenceJson({
            ...this.getEvidence(intent),
            error: error instanceof Error ? error.message : String(error),
          }),
        });
        return {
          status: SecurityCaseAiActionStatus.Failed,
          handOff: SecurityCaseHandOffReason.StepFailed,
        };
      }

      run = existing;
    }

    await this.updateRow(row.id!, {
      securityPlaybookRunId: run.id!,
      ...(isAsked
        ? {
            status: SecurityCaseAiActionStatus.Asked,
            askedAt: data.now,
          }
        : {}),
    });

    return {
      status: isAsked
        ? SecurityCaseAiActionStatus.Asked
        : SecurityCaseAiActionStatus.Doing,
    };
  }

  // OneUptime AI's unfinished run of an action on the case, if there is one.
  private static async findUnfinishedAiRun(data: {
    data: ToolkitCase;
    action: SecurityPlaybookActionType;
  }): Promise<SecurityPlaybookRun | null> {
    const runs: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          projectId: data.data.projectId,
          securityCaseId: data.data.securityCase.id!,
          securityPlaybookId: QueryHelper.isNull(),
          trigger: SecurityPlaybookTrigger.OneUptimeAi,
        },
        select: { _id: true, steps: true, status: true },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: 20,
        props: { isRoot: true },
      });

    return (
      runs.find((run: SecurityPlaybookRun): boolean => {
        try {
          return (
            parseSecurityPlaybookSteps(run.steps)[0]?.action === data.action
          );
        } catch {
          return false;
        }
      }) || null
    );
  }

  /*
   * The engine's step for an action, and what it acts on - or why there is
   * none to run (a reason a person is left the step with).
   */
  private static async buildEngineStep(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<
    | { step: SecurityPlaybookStep; targets?: Array<SecurityPlaybookTarget> }
    | SecurityCaseAiActionReason
  > {
    const isAsked: boolean = intent.decision === SecurityCaseAiDecisionKind.Ask;
    const base: {
      id: string;
      requiresApproval: boolean;
      continueOnFailure: boolean;
      onlyIfThreatIntelMatched: boolean;
    } = {
      id: ObjectID.generate().toString(),
      requiresApproval: isAsked,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    };
    const area: SecurityCaseAiArea | null =
      SECURITY_CASE_AI_ACTION_AREAS[intent.kind];
    // Who let OneUptime AI contain on its own: its kind's stamp.
    const stamp: SecurityCaseAiOnItsOwnStamp | undefined = area
      ? data.limits.stamps[area]
      : undefined;
    const approvalTurnedOff: SecurityPlaybookStep["approvalTurnedOff"] = isAsked
      ? undefined
      : {
          ...(stamp?.byUserId ? { byUserId: stamp.byUserId } : {}),
          at: stamp?.at || data.now.toISOString(),
        };

    switch (intent.kind) {
      case SecurityCaseAiActionKind.SetPriority:
        if (!intent.priorityId) {
          return SecurityCaseAiActionReason.NeedsJudgement;
        }

        return {
          step: {
            ...base,
            action: SecurityPlaybookActionType.SetCasePriority,
            config: { priorityId: intent.priorityId },
          },
        };

      case SecurityCaseAiActionKind.MarkContained:
      case SecurityCaseAiActionKind.CloseCase: {
        const status: SecurityCaseStatus | null =
          SecurityCaseStatuses.getStatusOfStage(
            data.values.statuses,
            intent.kind === SecurityCaseAiActionKind.MarkContained
              ? SecurityCaseStage.Contained
              : SecurityCaseStage.Closed,
          );

        if (!status?.id) {
          return SecurityCaseAiActionReason.NoWayToDoIt;
        }

        const config: JSONObject = { statusId: status.id.toString() };

        if (
          intent.kind === SecurityCaseAiActionKind.CloseCase &&
          intent.verdict
        ) {
          config["verdict"] = intent.verdict;
        }

        return {
          step: {
            ...base,
            action: SecurityPlaybookActionType.SetCaseStatus,
            config,
          },
        };
      }

      case SecurityCaseAiActionKind.DeclareIncident: {
        const severity: IncidentSeverity | null =
          await IncidentSeverityService.findOneBy({
            query: { projectId: data.projectId, isArchived: false },
            select: { _id: true },
            sort: { order: SortOrder.Ascending },
            props: { isRoot: true },
          });

        if (!severity?.id) {
          return SecurityCaseAiActionReason.NoWayToDoIt;
        }

        return {
          step: {
            ...base,
            // An incident pages people: it always waits for one.
            requiresApproval: true,
            action: SecurityPlaybookActionType.DeclareIncident,
            config: { incidentSeverityId: severity.id.toString() },
          },
        };
      }

      case SecurityCaseAiActionKind.BlockAddress: {
        const address: string = canonicalAddress(intent.target || "") || "";

        return {
          step: {
            ...base,
            action: SecurityPlaybookActionType.BlockAddress,
            config: {
              blockAction: SecurityBlockAction.Block,
              duration: SECURITY_CASE_AI_BLOCK_DURATION,
            },
            ...(approvalTurnedOff ? { approvalTurnedOff } : {}),
          },
          targets: [
            {
              type: SecurityEntityType.IpAddress,
              value: address,
              reason: SecurityPlaybookTargetReason.OnTheCase,
              state: SecurityPlaybookTargetState.Proposed,
            },
          ],
        };
      }

      case SecurityCaseAiActionKind.LiftBlock: {
        const blocks: Array<{ value?: string | undefined }> =
          intent.blockIds && intent.blockIds.length > 0
            ? await SecurityBlockService.findByIds({
                projectId: data.projectId,
                ids: intent.blockIds.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              })
            : [];
        const targets: Array<SecurityPlaybookTarget> = blocks
          .map((block: { value?: string | undefined }): string => {
            return block.value || "";
          })
          .filter(Boolean)
          .map((value: string): SecurityPlaybookTarget => {
            return {
              type: SecurityEntityType.IpAddress,
              value,
              reason: SecurityPlaybookTargetReason.OnTheCase,
              state: SecurityPlaybookTargetState.Proposed,
            };
          });

        if (targets.length === 0) {
          return SecurityCaseAiActionReason.NoWayToDoIt;
        }

        return {
          step: {
            ...base,
            requiresApproval: false,
            action: SecurityPlaybookActionType.LiftAddressBlock,
            config: {},
          },
          targets,
        };
      }

      case SecurityCaseAiActionKind.RequestCodeFix:
        return {
          step: {
            ...base,
            action: SecurityPlaybookActionType.FixWithAi,
            config: {},
          },
        };

      case SecurityCaseAiActionKind.ContainAccount:
      case SecurityCaseAiActionKind.ContainHost: {
        const isUser: boolean =
          intent.kind === SecurityCaseAiActionKind.ContainAccount;
        const template: SecurityPlaybookStep | null =
          await this.findContainmentStep({
            data,
            actions: isUser
              ? USER_CONTAINMENT_ACTIONS
              : HOST_CONTAINMENT_ACTIONS,
          });

        if (!template) {
          return SecurityCaseAiActionReason.NoWayToDoIt;
        }

        return {
          step: {
            ...base,
            action: template.action,
            config: template.config,
            ...(approvalTurnedOff ? { approvalTurnedOff } : {}),
          },
          targets: [
            {
              type: isUser ? SecurityEntityType.User : SecurityEntityType.Host,
              value: intent.target || "",
              reason: SecurityPlaybookTargetReason.OnTheCase,
              state: SecurityPlaybookTargetState.Proposed,
            },
          ],
        };
      }

      default:
        return SecurityCaseAiActionReason.NoWayToDoIt;
    }
  }

  /*
   * How the project contains an account or a host: the step of one of its
   * playbooks that does - the one its triage suggested first - with the
   * connection that playbook names. OneUptime AI takes the playbook's own
   * product and connection, never one of its own choosing.
   */
  public static async findContainmentStep(data: {
    data: ToolkitCase;
    actions: ReadonlyArray<string>;
  }): Promise<SecurityPlaybookStep | null> {
    const playbooks: Array<SecurityPlaybook> =
      await SecurityPlaybookService.findBy({
        query: { projectId: data.data.projectId, isEnabled: true },
        select: { _id: true, steps: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      });
    const preferredId: string | undefined =
      data.data.securityCase.aiSuggestedPlaybookId?.toString();
    const ordered: Array<SecurityPlaybook> = [
      ...playbooks.filter((playbook: SecurityPlaybook): boolean => {
        return playbook.id?.toString() === preferredId;
      }),
      ...playbooks.filter((playbook: SecurityPlaybook): boolean => {
        return playbook.id?.toString() !== preferredId;
      }),
    ];

    for (const playbook of ordered) {
      let steps: Array<SecurityPlaybookStep> = [];

      try {
        steps = parseSecurityPlaybookSteps(playbook.steps);
      } catch {
        continue;
      }

      const step: SecurityPlaybookStep | undefined = steps.find(
        (candidate: SecurityPlaybookStep): boolean => {
          return data.actions.includes(candidate.action);
        },
      );

      if (step) {
        return step;
      }
    }

    return null;
  }

  // ---------- What it does itself ----------

  /*
   * Taking the case, marking a step done, offering an exception - on its own
   * (a person's approval of one comes here too, as approvedBy).
   */
  public static async doDirectly(
    data: ToolkitCase,
    intent: ResponderIntent,
    approvedBy?: ObjectID | undefined,
    existingRowId?: ObjectID | undefined,
  ): Promise<ToolResult> {
    const reason: SecurityCaseAiActionReason = approvedBy
      ? SecurityCaseAiActionReason.Approved
      : SecurityCaseAiActionReason.OnItsOwn;
    const done: Partial<SecurityCaseAiAction> = {
      status: SecurityCaseAiActionStatus.Done,
      reason,
      doneAt: data.now,
      ...(approvedBy
        ? { decidedAt: data.now, decidedByUserId: approvedBy }
        : {}),
    };

    switch (intent.kind) {
      case SecurityCaseAiActionKind.TakeCase: {
        await SecurityCaseService.updateColumnsByIdWithoutHooks({
          id: data.securityCase.id!,
          data: {
            aiTookCaseAt: data.securityCase.aiTookCaseAt || data.now,
            aiResponseState: SecurityCaseAiResponseState.Working,
          } as unknown as PartialEntity<SecurityCase>,
        });

        await this.writeFeed(data, {
          markdown: mdText`🤖 **${getAiName()} took this case.** It works the case within what your project lets it do on its own, and asks a person for the rest.`,
        });
        break;
      }

      case SecurityCaseAiActionKind.MarkStepDone: {
        await this.tickStep(data, intent.stepKey, intent.stepTitle);

        await this.writeFeed(data, {
          markdown: mdText`🤖 **${getAiName()} marked a step done:** ${intent.stepTitle || this.getStepWords(data, intent.stepKey)}`,
          details: this.getCheckDetails(intent),
        });
        break;
      }

      default:
        break;
    }

    if (existingRowId) {
      await this.updateRow(existingRowId, done);
    } else {
      await this.record(data, intent, done);
    }

    return { status: SecurityCaseAiActionStatus.Done };
  }

  /*
   * A step OneUptime AI marks done: the case's task of the step, ticked, as
   * a person's tick of it is - its own timeline entry, and a check of the
   * case's steps (SecurityCaseTaskService).
   */
  private static async tickStep(
    data: ToolkitCase,
    stepKey: string,
    stepTitle?: string | undefined,
  ): Promise<void> {
    const existing: SecurityCaseTask | null =
      await SecurityCaseTaskService.findOneBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCase.id!,
          responseStepKey: stepKey,
        },
        select: { _id: true, isDone: true },
        props: { isRoot: true },
      });

    if (existing?.id) {
      if (!existing.isDone) {
        await SecurityCaseTaskService.updateOneById({
          id: existing.id,
          data: { isDone: true },
          props: { isRoot: true },
        });
      }
      return;
    }

    const task: SecurityCaseTask = new SecurityCaseTask();
    task.projectId = data.projectId;
    task.securityCaseId = data.securityCase.id!;
    task.title =
      (stepTitle || this.getStepWords(data, stepKey)).slice(0, 500) || stepKey;
    task.responseStepKey = stepKey;
    task.isDone = true;

    await SecurityCaseTaskService.create({
      data: task,
      props: { isRoot: true },
    });
  }

  // Asked of a person on the case's AI card: what only OneUptime AI does itself.
  private static async ask(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<ToolResult> {
    await this.record(data, intent, {
      status: SecurityCaseAiActionStatus.Asked,
      askedAt: data.now,
    });

    await this.writeFeed(data, {
      markdown: mdText`🤖 **${getAiName()} asks a person to approve:** ${ENGLISH.translateTemplate(
        getSecurityCaseAiActionTitle({
          kind: intent.kind,
          status: SecurityCaseAiActionStatus.Asked,
        }),
        { value: intent.target || "", verdict: intent.verdict || "" },
      )}. ${SECURITY_CASE_AI_ACTION_REASON_SENTENCES[intent.reason]}`,
    });

    return { status: SecurityCaseAiActionStatus.Asked };
  }

  /*
   * A step left for a person, and why - on the case's log and its timeline,
   * once: the planner leaves a step it already left for the same reason as
   * it was.
   */
  private static async leave(
    data: ToolkitCase,
    intent: ResponderIntent,
  ): Promise<void> {
    await this.record(data, intent, {
      status: SecurityCaseAiActionStatus.Left,
    });

    await this.writeFeed(data, {
      markdown: mdText`🤖 **${getAiName()} left a step for a person:** ${this.getStepWords(data, intent.stepKey)}. ${SECURITY_CASE_AI_ACTION_REASON_SENTENCES[intent.reason]}`,
    });
  }

  // ---------- The log ----------

  private static getEvidence(
    intent: ResponderIntent,
  ): SecurityCaseAiActionEvidence {
    return {
      ...(intent.check
        ? {
            check: {
              state: intent.check.state,
              evidence: intent.check.evidence,
            },
          }
        : {}),
      ...(intent.verdict ? { verdict: intent.verdict } : {}),
      ...(intent.priorityId ? { priorityId: intent.priorityId } : {}),
      ...(intent.trackRecord ? { trackRecord: intent.trackRecord } : {}),
      ...(intent.entity ? { entity: intent.entity } : {}),
    };
  }

  // A row of the case's log, for an intent, before anything is done about it.
  private static async record(
    data: ToolkitCase,
    intent: ResponderIntent,
    extra: Partial<SecurityCaseAiAction>,
  ): Promise<SecurityCaseAiAction> {
    const row: SecurityCaseAiAction = new SecurityCaseAiAction();
    row.projectId = data.projectId;
    row.securityCaseId = data.securityCase.id!;

    if (data.aiRunId) {
      row.aiRunId = data.aiRunId;
    }

    row.kind = intent.kind;
    row.reason = intent.reason;
    row.stepKey = intent.stepKey.slice(0, 100);

    const area: SecurityCaseAiArea | null =
      SECURITY_CASE_AI_ACTION_AREAS[intent.kind];

    if (area) {
      row.area = area;
    }

    if (intent.mode) {
      row.mode = intent.mode;
    }

    if (intent.target) {
      row.target = intent.target.slice(0, 500);
    }

    if (intent.detectionRuleId) {
      row.detectionRuleId = new ObjectID(intent.detectionRuleId);
    }

    const step: ResponseStep | undefined = data.stepsByKey.get(intent.stepKey);

    row.evidence = toSecurityCaseAiActionEvidenceJson({
      ...this.getEvidence(intent),
      ...(step
        ? {
            step: {
              template:
                typeof step.text.template === "string"
                  ? step.text.template
                  : "",
              values: step.text.values,
              ...(step.ruleText ? { ruleText: step.ruleText } : {}),
            },
          }
        : {}),
    });

    if (intent.report) {
      row.report = intent.report;
    }

    Object.assign(row, extra);

    return await SecurityCaseAiActionService.create({
      data: row,
      props: { isRoot: true },
    });
  }

  public static async updateRow(
    id: ObjectID,
    data: Partial<SecurityCaseAiAction>,
  ): Promise<void> {
    await SecurityCaseAiActionService.updateColumnsByIdWithoutHooks({
      id,
      data: data as unknown as PartialEntity<SecurityCaseAiAction>,
    });
  }

  // ---------- The timeline ----------

  // A step as the plan words it, in English.
  public static getStepWords(data: ToolkitCase, stepKey: string): string {
    const step: ResponseStep | undefined = data.stepsByKey.get(stepKey);

    if (!step) {
      return stepKey;
    }

    if (step.ruleText) {
      return step.ruleText;
    }

    return typeof step.text.template === "string" && step.text.template
      ? ENGLISH.translateTemplate(step.text.template, step.text.values)
      : stepKey;
  }

  // The check a step was settled by, as the timeline's details.
  private static getCheckDetails(
    intent: ResponderIntent,
  ): MarkdownText | undefined {
    if (!intent.check) {
      return undefined;
    }

    const lines: Array<string> = [
      intent.check.evidence.sentence,
      ...intent.check.evidence.facts,
    ].map((sentence: (typeof intent.check.evidence.facts)[number]): string => {
      return wordStepCheckSentence({
        sentence,
        translator: ENGLISH,
        writeTime: (time: Date): string => {
          return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
        },
      });
    });

    return mdText`What OneUptime found:\n\n${FeedMarkdown.join(
      lines.map((line: string): MarkdownText => {
        return mdText`- ${line}`;
      }),
      "\n",
    )}`;
  }

  public static async writeFeed(
    data: ToolkitCase,
    entry: { markdown: MarkdownText; details?: MarkdownText | undefined },
  ): Promise<void> {
    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCase.id!,
      feedInfoInMarkdown: entry.markdown.toString(),
      moreInformationInMarkdown: entry.details?.toString(),
      eventType: SecurityCaseFeedEventType.AiResponse,
      displayColor: Indigo500,
    });
  }

  // The OneUptime AI cap, for the docs and tests.
  public static readonly ACTIONS_ON_ITS_OWN_PER_HOUR: number =
    SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR;
}
