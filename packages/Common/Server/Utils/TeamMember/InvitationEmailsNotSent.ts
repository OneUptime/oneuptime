import EmailLog from "../../../Models/DatabaseModels/EmailLog";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MailStatus from "../../../Types/Mail/MailStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  InvitationEmailNotSent,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
} from "../../../Types/Team/InvitationEmailsNotSent";
import EmailLogService from "../../Services/EmailLogService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHOSE LATEST INVITATION EMAIL WAS NOT SENT (#9511, Types/Team/
 * InvitationEmailsNotSent), read from the project's Email Logs.
 *
 * TeamMemberService emails an invitation with the project and the person
 * it is for, and the Notification service writes a row of the project's
 * Email Logs for it, sent or failed, with the mail service's answer and -
 * since #9511 - its template (EmailLog.templateType). A person's latest
 * such row decides: failed, and they are named here with why; sent, and
 * they are not, whatever an earlier one said - a person invited again once
 * email works, or removed and invited again, heard of it.
 *
 * A row written before Email Logs kept their template names none. For
 * those, an email to the pending person that names no record of the
 * project stands in for the invitation: a pending person is not a member
 * yet, so the project's notifications - pages, owner and shift notices,
 * rollups - are never sent to them (ProjectMembership). Every email sent
 * since names its template, and only an invitation is read.
 *
 * Read with the caller's own permissions - the Email Logs' read, and the
 * privacy of any record a row names - in one read for the whole page, never
 * one per person. A caller who may not read the project's Email Logs is
 * answered with nobody: the page says what it always said.
 */

// The rows read for each person asked about, newest first, at most.
export const EMAILS_READ_PER_PERSON: number = 10;

/*
 * The columns that name a record of the project an email was about. An
 * invitation names none of them; most of the project's other emails to a
 * person name one.
 */
export const RECORD_COLUMNS: ReadonlyArray<string> = [
  "incidentId",
  "alertId",
  "monitorId",
  "scheduledMaintenanceId",
  "statusPageId",
  "statusPageAnnouncementId",
  "onCallDutyPolicyId",
  "onCallDutyPolicyEscalationRuleId",
  "onCallDutyPolicyScheduleId",
  "teamId",
];

export default class InvitationEmailsNotSent {
  /*
   * The query that reads a page of people's invitation emails: theirs, in
   * this project, of the invitation's template - or of none, written
   * before the template was kept - and about no record.
   */
  public static getQuery(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Query<EmailLog> {
    const query: Record<string, unknown> = {
      projectId: data.projectId,
      userId: QueryHelper.any(data.userIds),
      templateType: QueryHelper.equalToOrNull(EmailTemplateType.InviteMember),
    };

    for (const column of RECORD_COLUMNS) {
      query[column] = QueryHelper.isNull();
    }

    return query as Query<EmailLog>;
  }

  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<InvitationEmailNotSent>> {
    const userIds: Array<ObjectID> = data.userIds.slice(
      0,
      MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
    );

    if (userIds.length === 0) {
      return [];
    }

    let rows: Array<EmailLog> = [];

    try {
      rows = await EmailLogService.findBy({
        query: InvitationEmailsNotSent.getQuery({
          projectId: data.projectId,
          userIds: userIds,
        }),
        select: {
          _id: true,
          userId: true,
          status: true,
          statusMessage: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: userIds.length * EMAILS_READ_PER_PERSON,
        props: data.props,
      });
    } catch (err) {
      // Not theirs to read: they are told nothing they could not see.
      if (err instanceof NotAuthorizedException) {
        return [];
      }

      throw err;
    }

    return InvitationEmailsNotSent.getLatestFailures(rows);
  }

  /*
   * Of rows read newest first, each person's latest: named when it failed.
   * A person whose rows were all past the read's limit is not named - the
   * page then says what it always said - but anyone named has their latest
   * row among those read, which came before every older one.
   */
  public static getLatestFailures(
    rows: Array<EmailLog>,
  ): Array<InvitationEmailNotSent> {
    const seen: Set<string> = new Set<string>();
    const notSent: Array<InvitationEmailNotSent> = [];

    for (const row of rows) {
      const userId: string = row.userId?.toString().toLowerCase() || "";

      if (!userId || seen.has(userId)) {
        continue;
      }

      seen.add(userId);

      if (row.status !== MailStatus.Error) {
        continue;
      }

      notSent.push({
        userId: userId,
        statusMessage: (row.statusMessage || "").trim(),
      });
    }

    return notSent;
  }
}
