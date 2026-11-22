import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiActionService from "../../../../Services/SecurityCaseAiActionService";
import logger from "../../../Logger";

/*
 * WHAT HAPPENS TO ONEUPTIME AI'S WORK WHEN A PERSON CHANGES THE CASE AROUND
 * IT (#10352), called from the case service as the change is recorded.
 *
 *   - A close OneUptime AI made, reopened: its close reads as undone by
 *     whoever reopened the case - one of the "steps people undid" the
 *     overview counts - and the case is theirs again (the service clears
 *     aiClosedAt, and OneUptime AI's state stays Finished: it does not pick
 *     a reopened case up again by itself; Respond with AI does).
 *
 * Never throws: the case's own change is what matters.
 */
export default class SecurityCaseResponseEvents {
  public static async closeWasReopened(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    try {
      const close: SecurityCaseAiAction | null =
        await SecurityCaseAiActionService.findOneBy({
          query: {
            projectId: data.projectId,
            securityCaseId: data.securityCaseId,
            kind: SecurityCaseAiActionKind.CloseCase,
            status: SecurityCaseAiActionStatus.Done,
          },
          select: { _id: true },
          sort: { createdAt: SortOrder.Descending },
          props: { isRoot: true },
        });

      if (!close?.id) {
        return;
      }

      await SecurityCaseAiActionService.updateColumnsByIdWithoutHooks({
        id: close.id,
        data: {
          status: SecurityCaseAiActionStatus.Undone,
          reason: SecurityCaseAiActionReason.UndoneByPerson,
          undoneAt: OneUptimeDate.getCurrentDate(),
          undoneByUserId: data.userId || null,
        } as unknown as PartialEntity<SecurityCaseAiAction>,
      });
    } catch (error) {
      logger.error(
        `SecurityCaseResponseEvents: could not record that case ${data.securityCaseId.toString()}, which OneUptime AI closed, was reopened:`,
      );
      logger.error(error);
    }
  }
}
