import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import ObjectID from "../../../../../Types/ObjectID";
import { SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES } from "../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import logger from "../../../Logger";

/*
 * SOMETHING ONEUPTIME AI WAITS ON CHANGED: it looks at the case again
 * within a minute (#10352). A step's check written, a step of its own run
 * finished, an approval decided, an action undone - each says so here, and
 * the every-minute job reads the cases whose moment has come
 * (SecurityCase.aiNextLookAt, SecurityCaseResponse.startDueLooks).
 *
 * Only a case OneUptime AI is working is touched: one compare-and-set per
 * state it may be in, with no hooks and no audit record - it is OneUptime's
 * own schedule, like the step checks' nextStepCheckAt. Never throws: a
 * missed nudge only waits for the look the case already has scheduled.
 */
export default class SecurityCaseResponseNudge {
  public static async lookNow(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<void> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    try {
      for (const state of SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES) {
        const isSet: boolean =
          await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
            id: data.securityCaseId,
            data: {
              aiNextLookAt: now,
            } as unknown as PartialEntity<SecurityCase>,
            expectedData: {
              projectId: data.projectId,
              aiResponseState: state,
            } as unknown as PartialEntity<SecurityCase>,
            skipUpdateDateColumn: true,
          });

        if (isSet) {
          return;
        }
      }
    } catch (error) {
      logger.error(
        `SecurityCaseResponseNudge: could not ask OneUptime AI to look at case ${data.securityCaseId.toString()} again:`,
      );
      logger.error(error);
    }
  }
}
