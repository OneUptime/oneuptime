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
  ProjectInvitationEmailNotSent,
  ProjectInvitee,
  getProjectInviteeKey,
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

  /*
   * The query that reads the invitation emails of people in projects of
   * their own (#9518, the Admin Dashboard): theirs, in those projects, read
   * as getQuery reads them.
   */
  public static getQueryInProjects(data: {
    projectIds: Array<ObjectID>;
    userIds: Array<ObjectID>;
  }): Query<EmailLog> {
    const query: Record<string, unknown> = {
      projectId:
        data.projectIds.length === 1
          ? data.projectIds[0]
          : QueryHelper.any(data.projectIds),
      userId: QueryHelper.any(data.userIds),
      templateType: QueryHelper.equalToOrNull(EmailTemplateType.InviteMember),
    };

    for (const column of RECORD_COLUMNS) {
      query[column] = QueryHelper.isNull();
    }

    return query as Query<EmailLog>;
  }

  /*
   * Of these people, each in their own project, those whose latest
   * invitation email to it was not sent (#9518): for a master admin, who
   * reads every project's Email Logs - with the props they ask with, so a
   * caller who may not read them is told about nobody. One read for the
   * page: the rows of the projects and the people asked about, newest
   * first, of which only the pairs asked about count. A page of the Admin
   * Dashboard is one project's people, or one person's projects, so the
   * read finds no pair it was not asked about.
   */
  @CaptureSpan()
  public static async readInProjects(data: {
    invitees: Array<{ projectId: ObjectID; userId: ObjectID }>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ProjectInvitationEmailNotSent>> {
    const invitees: Array<{ projectId: ObjectID; userId: ObjectID }> =
      data.invitees.slice(0, MAX_PEOPLE_PER_INVITATION_EMAILS_READ);

    if (invitees.length === 0) {
      return [];
    }

    const projectIds: Array<ObjectID> = InvitationEmailsNotSent.getEachOnce(
      invitees.map(
        (invitee: { projectId: ObjectID; userId: ObjectID }): ObjectID => {
          return invitee.projectId;
        },
      ),
    );
    const userIds: Array<ObjectID> = InvitationEmailsNotSent.getEachOnce(
      invitees.map(
        (invitee: { projectId: ObjectID; userId: ObjectID }): ObjectID => {
          return invitee.userId;
        },
      ),
    );

    let rows: Array<EmailLog> = [];

    try {
      rows = await EmailLogService.findBy({
        query: InvitationEmailsNotSent.getQueryInProjects({
          projectIds: projectIds,
          userIds: userIds,
        }),
        select: {
          _id: true,
          projectId: true,
          userId: true,
          status: true,
          statusMessage: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit:
          Math.min(
            projectIds.length * userIds.length,
            MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
          ) * EMAILS_READ_PER_PERSON,
        props: data.props,
      });
    } catch (err) {
      // Not theirs to read: they are told nothing they could not see.
      if (err instanceof NotAuthorizedException) {
        return [];
      }

      throw err;
    }

    return InvitationEmailsNotSent.getLatestFailuresInProjects({
      rows: rows,
      invitees: invitees.map(
        (invitee: {
          projectId: ObjectID;
          userId: ObjectID;
        }): ProjectInvitee => {
          return {
            projectId: invitee.projectId.toString(),
            userId: invitee.userId.toString(),
          };
        },
      ),
    });
  }

  /*
   * Of rows read newest first, each invitee's latest in their project:
   * named when it failed, as getLatestFailures names a person. A pair
   * nobody asked about is passed over.
   */
  public static getLatestFailuresInProjects(data: {
    rows: Array<EmailLog>;
    invitees: Array<ProjectInvitee>;
  }): Array<ProjectInvitationEmailNotSent> {
    const asked: Set<string> = new Set<string>(
      data.invitees.map(getProjectInviteeKey),
    );
    const seen: Set<string> = new Set<string>();
    const notSent: Array<ProjectInvitationEmailNotSent> = [];

    for (const row of data.rows) {
      const projectId: string = row.projectId?.toString().toLowerCase() || "";
      const userId: string = row.userId?.toString().toLowerCase() || "";

      if (!projectId || !userId) {
        continue;
      }

      const key: string = getProjectInviteeKey({
        projectId: projectId,
        userId: userId,
      });

      if (!asked.has(key) || seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (row.status !== MailStatus.Error) {
        continue;
      }

      notSent.push({
        projectId: projectId,
        userId: userId,
        statusMessage: (row.statusMessage || "").trim(),
      });
    }

    return notSent;
  }

  // Each id once, in the order first met.
  private static getEachOnce(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const once: Array<ObjectID> = [];

    for (const id of ids) {
      const text: string = id.toString().toLowerCase();

      if (!seen.has(text)) {
        seen.add(text);
        once.push(id);
      }
    }

    return once;
  }
}
