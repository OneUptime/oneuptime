import DetectionRuleException from "../../../../../Models/DatabaseModels/DetectionRuleException";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiDecisionKind,
  SecurityCaseHandOffReason,
  readSecurityCaseAiLimits,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseAiActionEvidence,
  readSecurityCaseAiActionEvidence,
} from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "../../../../../Types/SecurityEvent/DetectionRuleException";
import { createTranslator } from "../../../../../Types/Translator";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DetectionRuleExceptionService from "../../../../Services/DetectionRuleExceptionService";
import ProjectService from "../../../../Services/ProjectService";
import SecurityCaseAiActionService from "../../../../Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import ProductBrandingText from "../../../ProductBrandingText";
import SecurityCaseHandOff from "../../../SecurityCase/SecurityCaseHandOff";
import SecurityCaseValues from "../../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import SecurityCaseResponseNudge from "./SecurityCaseResponseNudge";
import SecurityCaseResponseToolkit, {
  ToolkitCase,
} from "./SecurityCaseResponseToolkit";

/*
 * A PERSON'S ANSWER TO WHAT ONEUPTIME AI ASKED ON A CASE (#10352), from the
 * case's AI card, for what OneUptime AI carries out itself - taking the
 * case, marking a step done, an exception for the case's rule. Every other
 * ask is a step of the playbook engine's, approved where its run is: the
 * card, the case's Playbooks page, or one tap in Slack or Microsoft Teams.
 *
 *   - approve: done, as OneUptime AI's, approved by the person - an
 *     exception is created as the person, with their own right to (the
 *     rule's owner accepts it, from the rule's Exceptions page too);
 *   - decline: turned down; OneUptime AI hands the case to people at its
 *     next look, and an exception offered for a closed case is dropped;
 *   - take over: OneUptime AI stops working the case, which is the
 *     person's - nobody else is told.
 *
 * Each decision is one compare-and-set on the row, so two presses at once
 * decide it once. The route checks the person may change the case, or
 * create the rule's exceptions.
 */

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

export const ACTION_NOT_WAITING_MESSAGE: string =
  "This is no longer waiting for a decision. Refresh the case to see where it stands.";

export default class SecurityCaseResponseDecisions {
  // The row a decision is about: one of the case's, waiting on the card.
  public static async readAskedAction(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actionId: ObjectID;
  }): Promise<SecurityCaseAiAction> {
    const row: SecurityCaseAiAction | null =
      await SecurityCaseAiActionService.findOneBy({
        query: {
          _id: data.actionId,
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: {
          _id: true,
          kind: true,
          status: true,
          stepKey: true,
          target: true,
          evidence: true,
          detectionRuleId: true,
          securityPlaybookRunId: true,
        },
        props: { isRoot: true },
      });

    if (!row?.id) {
      throw new NotFoundException(
        "This action of OneUptime AI's was not found on the case.",
      );
    }

    if (
      row.status !== SecurityCaseAiActionStatus.Asked ||
      row.securityPlaybookRunId
    ) {
      throw new BadDataException(ACTION_NOT_WAITING_MESSAGE);
    }

    return row;
  }

  // Asked -> another state, once.
  private static async claim(
    row: SecurityCaseAiAction,
    data: Partial<SecurityCaseAiAction>,
  ): Promise<void> {
    const isClaimed: boolean =
      await SecurityCaseAiActionService.compareAndSetColumnsByIdWithoutHooks({
        id: row.id!,
        data: data as unknown as PartialEntity<SecurityCaseAiAction>,
        expectedData: {
          status: SecurityCaseAiActionStatus.Asked,
        } as unknown as PartialEntity<SecurityCaseAiAction>,
      });

    if (!isClaimed) {
      throw new BadDataException(ACTION_NOT_WAITING_MESSAGE);
    }
  }

  @CaptureSpan()
  public static async approve(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const row: SecurityCaseAiAction = await this.readAskedAction(data);
    const evidence: SecurityCaseAiActionEvidence =
      readSecurityCaseAiActionEvidence(row.evidence);
    const now: Date = OneUptimeDate.getCurrentDate();

    if (row.kind === SecurityCaseAiActionKind.OfferRuleException) {
      await this.acceptException({ ...data, row, evidence, now });
      return;
    }

    if (
      row.kind !== SecurityCaseAiActionKind.TakeCase &&
      row.kind !== SecurityCaseAiActionKind.MarkStepDone
    ) {
      throw new BadDataException(ACTION_NOT_WAITING_MESSAGE);
    }

    await this.claim(row, { status: SecurityCaseAiActionStatus.Doing });

    const toolkit: ToolkitCase = await this.readToolkitCase({
      ...data,
      now,
    });

    await SecurityCaseResponseToolkit.doDirectly(
      toolkit,
      {
        kind: row.kind,
        stepKey: row.stepKey || "",
        ...(row.target ? { target: row.target } : {}),
        decision: SecurityCaseAiDecisionKind.Do,
        reason: SecurityCaseAiActionReason.Approved,
        mode: null,
        ...(evidence.check
          ? {
              check: {
                stepKey: row.stepKey || "",
                state: evidence.check.state,
                evidence: evidence.check.evidence,
              },
            }
          : {}),
        stepTitle: evidence.step?.ruleText
          ? evidence.step.ruleText
          : evidence.step?.template
            ? ENGLISH.translateTemplate(
                evidence.step.template,
                evidence.step.values,
              )
            : undefined,
      },
      data.props.userId,
      row.id!,
    );

    await SecurityCaseResponseNudge.lookNow({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
    });
  }

  /*
   * The rule's exception OneUptime AI offered, accepted: created as the
   * person, held to their own right to create the rule's exceptions.
   */
  private static async acceptException(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    row: SecurityCaseAiAction;
    evidence: SecurityCaseAiActionEvidence;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<void> {
    const entityType: SecurityEntityType | undefined =
      data.evidence.entity?.type;
    const value: string = data.evidence.entity?.value || data.row.target || "";

    if (!data.row.detectionRuleId || !entityType || !value) {
      throw new BadDataException(
        "OneUptime AI's exception names no value for the rule to skip. Add the exception on the rule's Exceptions page.",
      );
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, caseNumberWithPrefix: true, verdict: true },
        props: { isRoot: true },
      });

    await this.claim(data.row, { status: SecurityCaseAiActionStatus.Doing });

    const exception: DetectionRuleException = new DetectionRuleException();
    exception.projectId = data.projectId;
    exception.detectionRuleId = data.row.detectionRuleId;
    exception.kind = DetectionRuleExceptionKind.Entity;
    exception.entityType = entityType;
    exception.value = value;
    exception.reason = `Offered by ${getAiName()}: ${securityCase?.caseNumberWithPrefix || "the case"} closed as ${securityCase?.verdict || "a false positive"}.`;

    try {
      await DetectionRuleExceptionService.create({
        data: exception,
        props: data.props,
      });
    } catch (error) {
      // Not made: the offer waits again, and the person is told why.
      await SecurityCaseResponseToolkit.updateRow(data.row.id!, {
        status: SecurityCaseAiActionStatus.Asked,
      });
      throw error;
    }

    await SecurityCaseResponseToolkit.updateRow(data.row.id!, {
      status: SecurityCaseAiActionStatus.Done,
      reason: SecurityCaseAiActionReason.Approved,
      doneAt: data.now,
      decidedAt: data.now,
      ...(data.props.userId ? { decidedByUserId: data.props.userId } : {}),
    });
  }

  @CaptureSpan()
  public static async decline(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const row: SecurityCaseAiAction = await this.readAskedAction(data);
    const now: Date = OneUptimeDate.getCurrentDate();

    await this.claim(row, {
      status: SecurityCaseAiActionStatus.Declined,
      reason: SecurityCaseAiActionReason.DeclinedByPerson,
      decidedAt: now,
      ...(data.props.userId ? { decidedByUserId: data.props.userId } : {}),
    });

    // An exception for a closed case, dropped: nothing more to do.
    if (row.kind === SecurityCaseAiActionKind.OfferRuleException) {
      return;
    }

    await SecurityCaseResponseToolkit.writeFeed(
      {
        projectId: data.projectId,
        securityCase: { id: data.securityCaseId } as SecurityCase,
      } as ToolkitCase,
      {
        markdown: mdText`🤖 A person turned down what ${getAiName()} asked.`,
      },
    );

    await SecurityCaseResponseNudge.lookNow({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
    });
  }

  // A person takes the case over: OneUptime AI stops working it.
  @CaptureSpan()
  public static async takeOver(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    return await SecurityCaseHandOff.handToPeople({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      reason: SecurityCaseHandOffReason.TakenOver,
      byUserId: data.props.userId,
    });
  }

  // What a tool needs, for a decision made on the card.
  private static async readToolkitCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actionId: ObjectID;
    now: Date;
  }): Promise<ToolkitCase> {
    const [securityCase, project]: [SecurityCase | null, Project | null] =
      await Promise.all([
        SecurityCaseService.findOneBy({
          query: { _id: data.securityCaseId, projectId: data.projectId },
          select: {
            _id: true,
            projectId: true,
            entities: true,
            aiTookCaseAt: true,
            aiSuggestedPlaybookId: true,
          },
          props: { isRoot: true },
        }),
        ProjectService.findOneById({
          id: data.projectId,
          select: {
            _id: true,
            enableAutomaticSecurityCaseResponse: true,
            securityCaseAiCaseMode: true,
            securityCaseAiEdgeMode: true,
            securityCaseAiAccountsMode: true,
            securityCaseAiHostsMode: true,
            securityCaseAiCodeMode: true,
            securityCaseAiCloseMode: true,
            securityCaseAiOnItsOwnStamps: true,
          },
          props: { isRoot: true },
        }),
      ]);

    if (!securityCase?.id) {
      throw new NotFoundException("Security case not found.");
    }

    return {
      projectId: data.projectId,
      securityCase,
      limits: readSecurityCaseAiLimits(project),
      values: await SecurityCaseValues.getForProject(data.projectId),
      matches: null,
      stepsByKey: new Map(),
      now: data.now,
    };
  }
}
