import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../Models/DatabaseModels/SecurityCaseAiAction";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import { Orange500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
  SECURITY_CASE_HAND_OFFS_TOLD_NOBODY,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import { toSecurityCaseAiActionEvidenceJson } from "../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import { SECURITY_CASE_HAND_OFF_SENTENCES } from "../../../Types/SecurityCase/SecurityCaseAiWords";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import SecurityCaseAiActionService from "../../Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseAiHold from "./SecurityCaseAiHold";
import SecurityCaseNotifications from "./SecurityCaseNotifications";

/*
 * HANDING A SECURITY CASE TO PEOPLE (#10352). OneUptime AI never stands
 * down quietly: whenever it stops working a case - text written to steer an
 * AI, the project's highest priority, a protected target, its hourly limit,
 * AI off or out of credits, a step that did not hold or was turned down,
 * or nothing left it may do - it hands the case over here, and says why:
 *
 *   - the case: OneUptime AI's state is Handed To People, with the reason,
 *     and it looks at the case no more (SecurityCase.aiResponseState,
 *     aiHandOffReason, aiNextLookAt);
 *   - its log: a Hand To People row, with the steps left for a person;
 *   - the timeline: why, and which steps are left, as OneUptime AI's entry;
 *   - the people: a notice through the case's notification rules - the
 *     people on the case, or, with nobody on it, those told about cases at
 *     its priority, as they chose to be told, and the Slack and Microsoft
 *     Teams channels the project's Security Case rules name
 *     (SecurityCaseNotifications.aiHandedOff). Never held back.
 *
 * Once per hand-off: a case already handed over, or closed, is not handed
 * over again, and nobody is told twice.
 *
 * A case OneUptime AI held while it responded first (#10353,
 * SecurityCaseAiHold) has its hold ended here too: the notice people were
 * held from goes out with the hand-off's reason, in place of the hand-off's
 * own notice - and a person who took the case over has it, so nobody else
 * is alerted.
 */
export default class SecurityCaseHandOff {
  @CaptureSpan()
  public static async handToPeople(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    reason: SecurityCaseHandOffReason;
    // The steps a person has to do, or that the hand-off is about.
    stepKeys?: Array<string> | undefined;
    // Each step's words, in English, for the timeline: by key.
    stepTitles?: Record<string, string> | undefined;
    aiRunId?: ObjectID | undefined;
    // The person who took the case over, for a hand-off of theirs.
    byUserId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<boolean> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, aiResponseState: true, closedAt: true },
        props: { isRoot: true },
      });

    if (!securityCase?.id || securityCase.closedAt) {
      return false;
    }

    // Already handed over, or done with: once per hand-off.
    if (
      securityCase.aiResponseState ===
        SecurityCaseAiResponseState.HandedToPeople ||
      securityCase.aiResponseState === SecurityCaseAiResponseState.Finished
    ) {
      return false;
    }

    const isHandedOver: boolean =
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: securityCase.id,
        data: {
          aiResponseState: SecurityCaseAiResponseState.HandedToPeople,
          aiHandOffReason: data.reason,
          aiNextLookAt: null,
        } as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          aiResponseState: (securityCase.aiResponseState ||
            null) as unknown as SecurityCaseAiResponseState,
        } as unknown as PartialEntity<SecurityCase>,
        skipUpdateDateColumn: true,
      });

    // Another look handed it over first.
    if (!isHandedOver) {
      return false;
    }

    const stepKeys: Array<string> = data.stepKeys || [];

    try {
      const row: SecurityCaseAiAction = new SecurityCaseAiAction();
      row.projectId = data.projectId;
      row.securityCaseId = data.securityCaseId;
      row.kind = SecurityCaseAiActionKind.HandToPeople;
      row.status = SecurityCaseAiActionStatus.Done;
      row.reason = SecurityCaseAiActionReason.HandedOff;
      row.handOffReason = data.reason;
      row.stepKey = SECURITY_CASE_AI_HAND_OFF_STEP_KEY;
      row.doneAt = now;
      row.evidence = toSecurityCaseAiActionEvidenceJson(
        stepKeys.length > 0 ? { stepKeys } : {},
      );

      if (data.aiRunId) {
        row.aiRunId = data.aiRunId;
      }

      if (data.byUserId) {
        row.decidedByUserId = data.byUserId;
        row.decidedAt = now;
      }

      await SecurityCaseAiActionService.create({
        data: row,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `SecurityCaseHandOff: could not log the hand-off of case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
    }

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: this.getHandOffMarkdown(data.reason).toString(),
      moreInformationInMarkdown: this.getStepsLeftMarkdown({
        stepKeys,
        stepTitles: data.stepTitles || {},
      })?.toString(),
      eventType: SecurityCaseFeedEventType.AiResponse,
      displayColor: Orange500,
      postedAt: now,
      ...(data.byUserId ? { userId: data.byUserId } : {}),
    });

    /*
     * A case OneUptime AI held while it responded first (#10353): its hold
     * ends with the hand-off, and the notice people were held from is the
     * one that tells them, with this reason - so nobody is told twice.
     */
    const isHoldEnded: boolean = await SecurityCaseAiHold.onHandedToPeople({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      reason: data.reason,
      byUserId: data.byUserId,
    });

    // Whoever took the case over knows it is theirs.
    if (
      !isHoldEnded &&
      !SECURITY_CASE_HAND_OFFS_TOLD_NOBODY.includes(data.reason)
    ) {
      await SecurityCaseNotifications.aiHandedOff({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        reason: data.reason,
      });
    }

    return true;
  }

  // The timeline's line: who handed the case over, and why.
  public static getHandOffMarkdown(
    reason: SecurityCaseHandOffReason,
  ): MarkdownText {
    return mdText`🙋 **${getAiName()} handed this case to people.** ${SECURITY_CASE_HAND_OFF_SENTENCES[reason]}`;
  }

  // Under it: the steps left for a person, by their words.
  public static getStepsLeftMarkdown(data: {
    stepKeys: Array<string>;
    stepTitles: Record<string, string>;
  }): MarkdownText | undefined {
    const titles: Array<string> = data.stepKeys
      .map((key: string): string => {
        return data.stepTitles[key] || "";
      })
      .filter(Boolean);

    if (titles.length === 0) {
      return undefined;
    }

    return mdText`Left for a person:\n\n${FeedMarkdown.join(
      titles.map((title: string): MarkdownText => {
        return mdText`- ${title}`;
      }),
      "\n",
    )}`;
  }
}

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}
