import AuditLogService from "../../Services/AuditLogService";
import { CalendarFeedRotation } from "./CalendarFeedToken";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";

/*
 * A CALENDAR LINK RESET, IN THE AUDIT LOG (issue #6286).
 *
 * Resetting a calendar feed's link - the project's on-call calendar, an
 * on-call schedule's, the scheduled maintenance calendar - ends the old link
 * at once for everyone who holds it. The new token is written as root, and
 * only OneUptime writes the token columns, so the audit defaults leave them
 * out of every entry (AuditLogCoverage): a reset recorded nothing at all.
 *
 * So each rotation records its own entry once the new token is written,
 * naming the columns that say the link changed: the token's hint, recorded
 * as changed and never with its value (its name says it is part of a
 * token, so the recorder redacts it), and when the link was made. The token
 * and its hashes never reach an entry.
 *
 * Whose change it is: the person's when a route resets the link for them
 * (their props), and OneUptime's own - a system event, kept when the project
 * stores system events - when a member leaving the project rotates it
 * (rotateFeedsForMemberLeave).
 */

// The columns a reset's entry names: what says the link changed, and when.
export const CALENDAR_FEED_ROTATION_AUDIT_COLUMNS: ReadonlyArray<string> = [
  "tokenHint",
  "rotatedAt",
];

export default class CalendarFeedRotationAuditLog {
  public static async record<TModel extends BaseModel>(data: {
    model: TModel;
    // The feed as it was, with its project, the hint and rotatedAt.
    before: TModel;
    rotation: CalendarFeedRotation;
    // Who reset the link; none for OneUptime's own rotation.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    if (!data.before.id) {
      return;
    }

    await AuditLogService.recordUpdate({
      model: data.model,
      before: data.before,
      updatedFields: {
        tokenHint: data.rotation.tokenHint,
        rotatedAt: data.rotation.rotatedAt,
      } as unknown as JSONObject,
      itemId: data.before.id,
      props: data.props || { isRoot: true },
      includeColumns: [...CALENDAR_FEED_ROTATION_AUDIT_COLUMNS],
    });
  }
}
