import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  isSecurityCaseAiResponseActive,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";
import SecurityCaseHandOff from "../../../SecurityCase/SecurityCaseHandOff";
import SecurityEventsSwitch from "../../../SecurityCase/SecurityEventsSwitch";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * ONEUPTIME AI STOPS WORKING SECURITY CASES WHILE SECURITY EVENTS IS
 * SWITCHED OFF ON THE SERVER (#10816).
 *
 * Switching a product off stops what the server would start anew on it,
 * OneUptime AI's runs first (#9489): the AI queue neither queues nor claims
 * a run of a case while Security Events is off. For OneUptime AI working a
 * case end to end (#10352) that alone left the case "Working" with nothing
 * working it, nobody told, and its looks taken up again on their own once
 * the product was back. So, while Security Events is off:
 *
 *   - no look at a case starts (SecurityCaseResponse.startLook), and a look
 *     under way starts no new step: it asks before each one
 *     (SecurityCaseResponseLook). A step it started already - the engine's
 *     run, queued or running - finishes, or is undone, in the engine as
 *     usual; one waiting for a person's approval waits for a person, whose
 *     answer the API refuses while the product is off.
 *   - every case it works goes to people within a minute, through its
 *     hand-off, saying why (SecurityCaseHandOffReason.ProductOff): the
 *     every-minute job hands them over in place of their looks
 *     (SecurityCaseResponse.startDueLooks), whenever their next look was
 *     due. A case it was about to take up after a triage goes to people
 *     the same way, and a case closed meanwhile is done with, as a look
 *     would leave it.
 *
 * Switched on again, nothing resumes on its own: a case handed over is the
 * people's until someone presses Respond with AI, and a look queued before
 * the hand-off does nothing when it is claimed (SecurityCaseResponseLook).
 * Take Over still works while the product is off: stopping OneUptime AI is
 * never held back (ProductCustomRoutesGuard).
 *
 * Everything is read and written as OneUptime (root), with the project and
 * the case named in every query.
 */

// The most cases one tick of the every-minute job stops while Security Events is off.
export const SECURITY_CASE_AI_PRODUCT_OFF_STOPS_PER_TICK: number = 100;

// What stopping one case came to.
export enum SecurityCaseProductOffStop {
  // Handed to people, saying Security Events is switched off.
  HandedOff = "HandedOff",
  // Closed already: done with, as a look leaves a closed case.
  Finished = "Finished",
  // Not OneUptime AI's to stop: handed over or done with already, or gone.
  None = "None",
}

export default class SecurityCaseResponseProductOff {
  // Whether Security Events is switched off on the server (SecurityEventsSwitch).
  public static async isOff(): Promise<boolean> {
    return await SecurityEventsSwitch.isOff();
  }

  /*
   * One case OneUptime AI works, or was about to take up, stopped: a closed
   * case is done with; any other goes to people, saying why, with the steps
   * it was about to take as the ones left for a person. Once: a case handed
   * over or done with already is left as it is.
   */
  @CaptureSpan()
  public static async stopCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    // The look that stopped, for the hand-off's row of the case's log.
    aiRunId?: ObjectID | undefined;
    stepKeys?: Array<string> | undefined;
    stepTitles?: Record<string, string> | undefined;
    now?: Date | undefined;
  }): Promise<SecurityCaseProductOffStop> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, aiResponseState: true, closedAt: true },
        props: { isRoot: true },
      });

    if (!securityCase?.id) {
      return SecurityCaseProductOffStop.None;
    }

    if (securityCase.closedAt) {
      // Closing it finished OneUptime AI's work on it already (SecurityCaseService).
      if (
        securityCase.aiResponseState === SecurityCaseAiResponseState.Finished
      ) {
        return SecurityCaseProductOffStop.Finished;
      }

      if (!isSecurityCaseAiResponseActive(securityCase.aiResponseState)) {
        return SecurityCaseProductOffStop.None;
      }

      const isFinished: boolean =
        await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
          id: securityCase.id,
          data: {
            aiResponseState: SecurityCaseAiResponseState.Finished,
            aiNextLookAt: null,
          } as unknown as PartialEntity<SecurityCase>,
          expectedData: {
            projectId: data.projectId,
            aiResponseState: securityCase.aiResponseState,
          } as unknown as PartialEntity<SecurityCase>,
          skipUpdateDateColumn: true,
        });

      return isFinished
        ? SecurityCaseProductOffStop.Finished
        : SecurityCaseProductOffStop.None;
    }

    const isHandedOver: boolean = await SecurityCaseHandOff.handToPeople({
      projectId: data.projectId,
      securityCaseId: securityCase.id,
      reason: SecurityCaseHandOffReason.ProductOff,
      stepKeys: data.stepKeys,
      stepTitles: data.stepTitles,
      aiRunId: data.aiRunId,
      now: data.now,
    });

    return isHandedOver
      ? SecurityCaseProductOffStop.HandedOff
      : SecurityCaseProductOffStop.None;
  }

  /*
   * Every minute while Security Events is off: each case OneUptime AI
   * works, stopped - read by the index its looks are read by, oldest look
   * first, so a long list is worked through tick by tick. Returns how many
   * were stopped. Never throws: a case that fails is tried again a minute
   * later.
   */
  @CaptureSpan()
  public static async stopEveryCase(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    let working: Array<SecurityCase> = [];

    try {
      working = await SecurityCaseService.findBy({
        query: {
          aiNextLookAt: QueryHelper.notNull(),
          aiResponseState: new Includes([
            ...SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
          ]),
        },
        select: { _id: true, projectId: true },
        sort: { aiNextLookAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_CASE_AI_PRODUCT_OFF_STOPS_PER_TICK,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        "SecurityCaseResponseProductOff: could not read the security cases OneUptime AI works, to hand them to people while Security Events is switched off:",
      );
      logger.error(error);
      return 0;
    }

    let stopped: number = 0;

    for (const securityCase of working) {
      if (!securityCase.id || !securityCase.projectId) {
        continue;
      }

      try {
        if (
          (await this.stopCase({
            projectId: securityCase.projectId,
            securityCaseId: securityCase.id,
            now,
          })) !== SecurityCaseProductOffStop.None
        ) {
          stopped++;
        }
      } catch (error) {
        logger.error(
          `SecurityCaseResponseProductOff: could not hand security case ${securityCase.id.toString()} to people while Security Events is switched off:`,
        );
        logger.error(error);
      }
    }

    return stopped;
  }
}
