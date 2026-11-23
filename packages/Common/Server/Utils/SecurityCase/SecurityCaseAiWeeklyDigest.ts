import DatabaseConfig from "../../DatabaseConfig";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../Models/DatabaseModels/SecurityCaseAiAction";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SafeHtml from "../../../Types/SafeHtml";
import {
  SecurityCaseAiDigestActionRow,
  SecurityCaseAiDigestCaseRow,
  SecurityCaseAiWeeklyDigestNumbers,
  computeSecurityCaseAiWeeklyDigest,
} from "../../../Utils/SecurityCase/SecurityCaseAiWeeklyDigest";
import AccessTokenService from "../../Services/AccessTokenService";
import MailService from "../../Services/MailService";
import ProjectService from "../../Services/ProjectService";
import SecurityCaseAiActionService from "../../Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * "WHAT ONEUPTIME AI DID ON SECURITY CASES THIS WEEK" (#10353): each Monday,
 * the project's security owners get one email of what OneUptime AI did on
 * the project's security cases the week before
 * (Utils/SecurityCase/SecurityCaseAiWeeklyDigest): the cases it responded
 * first to and how those ended, how soon the cases it worked were
 * contained, the blocks it made and the ones lifted again, what it asked
 * people and how long they took, and what a person undid.
 *
 * WHO ITS SECURITY OWNERS ARE. OneUptime has no such group, so the digest
 * goes to the members who answer for security work and may read it: those
 * holding Project Owner - who, as for every notice of something that runs
 * on its own (the blocklist feed that stops being read, the on-call
 * readiness digest), are told - and those holding Security Admin, whose
 * authority OneUptime AI acts on when it contains without asking
 * (TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS). Each must be able to read
 * security cases. Project Admins, who may change the settings but hold no
 * security role, are left out: they are often many, and none of the
 * security work is theirs to answer for.
 *
 * Numbers only, and a link to Security Events -> Overview: no case's title,
 * entity or triage leaves the project's own pages, so a Security Admin
 * whose role is limited to some labels is told nothing about a case they
 * may not read. Silent for a week OneUptime AI did nothing: an email that
 * always comes and says nothing teaches people to ignore it.
 */

// The week a digest covers, before the moment it is sent.
export const SECURITY_CASE_AI_DIGEST_WEEK_IN_DAYS: number = 7;

// The most rows a project's digest reads of each kind.
const DIGEST_ROWS_READ_LIMIT: number = 5000;

// Who gets the digest, besides being able to read security cases.
export const SECURITY_CASE_AI_DIGEST_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.SecurityAdmin,
];

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

// "1 case", "3 cases": a count and its word, held together.
function count(value: number, one: string, other: string): string {
  return `${value}${NO_BREAK_SPACE}${value === 1 ? one : other}`;
}

function minutes(value: number): string {
  return count(value, "minute", "minutes");
}

export function getSecurityCaseAiWeeklyDigestSubject(): string {
  return `What ${getAiName()} did on security cases this week`;
}

/*
 * The digest's lines, in the English every owner email is written in: one
 * a measure, each left out when there is nothing to say of it.
 */
export function getSecurityCaseAiWeeklyDigestLines(
  digest: SecurityCaseAiWeeklyDigestNumbers,
): Array<string> {
  const lines: Array<string> = [];

  if (digest.casesHeld > 0) {
    lines.push(
      `Responded first to ${count(digest.casesHeld, "case", "cases")}: ${digest.casesResolvedWithoutPerson} resolved with nobody alerted, ${digest.casesHandedToPeople} handed to people, ${digest.casesStoppedByPerson} taken or paged by a person.`,
    );
  }

  if (
    digest.casesContained > 0 &&
    digest.medianTimeToContainInMinutes !== null
  ) {
    lines.push(
      `Time to contain: ${minutes(digest.medianTimeToContainInMinutes)} at the median, over the ${count(digest.casesContained, "case", "cases")} it worked that were contained.`,
    );
  }

  if (digest.blocksMade > 0 || digest.blocksLifted > 0) {
    lines.push(
      `Blocks: ${count(digest.blocksMade, "address", "addresses")} blocked, ${count(digest.blocksLifted, "block", "blocks")} lifted again.`,
    );
  }

  if (digest.approvalsAsked > 0) {
    lines.push(
      digest.medianApprovalWaitInMinutes !== null
        ? `Approvals: ${count(digest.approvalsAsked, "step", "steps")} asked of a person, ${digest.approvalsAnswered} answered after ${minutes(digest.medianApprovalWaitInMinutes)} at the median.`
        : `Approvals: ${count(digest.approvalsAsked, "step", "steps")} asked of a person, none answered yet.`,
    );
  }

  if (digest.undoneByPeople > 0) {
    lines.push(
      `Undone by a person: ${count(digest.undoneByPeople, "step", "steps")} of ${getAiName()}'s.`,
    );
  }

  return lines;
}

// The email's body, as HTML the owner email places in its message.
export function getSecurityCaseAiWeeklyDigestHtml(data: {
  projectName: string;
  digest: SecurityCaseAiWeeklyDigestNumbers;
  overviewLink: URL | null;
}): string {
  const paragraphs: Array<string> = [
    SafeHtml.escape(
      `Here is what ${getAiName()} did on the security cases of ${data.projectName.trim() || "your project"} in the last ${SECURITY_CASE_AI_DIGEST_WEEK_IN_DAYS}${NO_BREAK_SPACE}days.`,
    ),
    getSecurityCaseAiWeeklyDigestLines(data.digest)
      .map((line: string): string => {
        return `&bull; ${SafeHtml.escape(line)}`;
      })
      .join(" <br/> "),
  ];

  if (data.overviewLink) {
    const text: string = SafeHtml.escape(data.overviewLink.toString());

    paragraphs.push(
      `${SafeHtml.escape("Every case is on Security Events, Overview:")} <br/> <a href="${text}">${text}</a>`,
    );
  }

  paragraphs.push(
    SafeHtml.escape(
      `You get this email because you are a Project Owner or Security Admin of ${data.projectName.trim() || "this project"}. It comes each Monday after a week in which ${getAiName()} worked your security cases.`,
    ),
  );

  return paragraphs.join(" <br/> <br/> ");
}

export default class SecurityCaseAiWeeklyDigest {
  /*
   * Every project OneUptime AI did something on a security case of in the
   * week before `now`: each one's digest, to its security owners. Returns
   * how many emails went out. One project's failure is nobody else's.
   */
  @CaptureSpan()
  public static async sendAll(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const weekStart: Date = OneUptimeDate.addRemoveDays(
      now,
      -SECURITY_CASE_AI_DIGEST_WEEK_IN_DAYS,
    );
    let sent: number = 0;

    for (const projectId of await this.findProjectsWithActivity({
      weekStart,
    })) {
      try {
        sent += await this.sendForProject({ projectId, now });
      } catch (error) {
        logger.error(
          `SecurityCaseAiWeeklyDigest: could not send project ${projectId.toString()}'s digest:`,
        );
        logger.error(error);
      }
    }

    return sent;
  }

  // One project's digest, to its security owners. Returns how many emails went out.
  @CaptureSpan()
  public static async sendForProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    const weekStart: Date = OneUptimeDate.addRemoveDays(
      data.now,
      -SECURITY_CASE_AI_DIGEST_WEEK_IN_DAYS,
    );
    const digest: SecurityCaseAiWeeklyDigestNumbers = await this.read({
      projectId: data.projectId,
      weekStart,
      weekEnd: data.now,
    });

    if (!digest.hasActivity) {
      return 0;
    }

    const recipients: Array<User> = await this.whoGetsIt(data.projectId);

    if (recipients.length === 0) {
      logger.warn(
        `SecurityCaseAiWeeklyDigest: project ${data.projectId.toString()} has no Project Owner or Security Admin who can read security cases, so nobody gets its digest.`,
      );
      return 0;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { name: true },
      props: { isRoot: true },
    });
    const subject: string = getSecurityCaseAiWeeklyDigestSubject();
    const message: string = getSecurityCaseAiWeeklyDigestHtml({
      projectName: project?.name || "",
      digest,
      overviewLink: await this.getOverviewLink(data.projectId),
    });
    let sent: number = 0;

    for (const recipient of recipients) {
      if (!recipient.email || !recipient.id) {
        continue;
      }

      try {
        await MailService.sendMail(
          {
            toEmail: recipient.email,
            templateType: EmailTemplateType.SimpleMessage,
            vars: { subject, message },
            subject,
            isSubjectLiteral: true,
          },
          { projectId: data.projectId, userId: recipient.id },
        );
        sent++;
      } catch (error) {
        logger.error(
          `SecurityCaseAiWeeklyDigest: could not email project ${data.projectId.toString()}'s digest to user ${recipient.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    return sent;
  }

  // The week's numbers for one project, read as OneUptime (root).
  public static async read(data: {
    projectId: ObjectID;
    weekStart: Date;
    weekEnd: Date;
  }): Promise<SecurityCaseAiWeeklyDigestNumbers> {
    const caseSelect: {
      _id: true;
      createdAt: true;
      containedAt: true;
      aiTookCaseAt: true;
      aiHoldOutcome: true;
      aiHoldEndedAt: true;
    } = {
      _id: true,
      createdAt: true,
      containedAt: true,
      aiTookCaseAt: true,
      aiHoldOutcome: true,
      aiHoldEndedAt: true,
    };

    const [heldCases, containedCases, actions]: [
      Array<SecurityCase>,
      Array<SecurityCase>,
      Array<SecurityCaseAiAction>,
    ] = await Promise.all([
      SecurityCaseService.findBy({
        query: {
          projectId: data.projectId,
          aiHoldEndedAt: QueryHelper.greaterThanEqualTo(data.weekStart),
        },
        select: caseSelect,
        skip: 0,
        limit: DIGEST_ROWS_READ_LIMIT,
        props: { isRoot: true },
      }),
      SecurityCaseService.findBy({
        query: {
          projectId: data.projectId,
          containedAt: QueryHelper.greaterThanEqualTo(data.weekStart),
          aiTookCaseAt: QueryHelper.notNull(),
        },
        select: caseSelect,
        skip: 0,
        limit: DIGEST_ROWS_READ_LIMIT,
        props: { isRoot: true },
      }),
      // Asked, decided, done or undone this week: each of those writes the row.
      SecurityCaseAiActionService.findBy({
        query: {
          projectId: data.projectId,
          updatedAt: QueryHelper.greaterThanEqualTo(data.weekStart),
        },
        select: {
          _id: true,
          kind: true,
          status: true,
          askedAt: true,
          decidedAt: true,
          doneAt: true,
          undoneAt: true,
        },
        skip: 0,
        limit: DIGEST_ROWS_READ_LIMIT,
        props: { isRoot: true },
      }),
    ]);

    const cases: Map<string, SecurityCaseAiDigestCaseRow> = new Map();

    for (const row of [...heldCases, ...containedCases]) {
      if (!row.id || !row.createdAt) {
        continue;
      }

      cases.set(row.id.toString(), {
        createdAt: new Date(row.createdAt),
        containedAt: row.containedAt ? new Date(row.containedAt) : null,
        aiTookCaseAt: row.aiTookCaseAt ? new Date(row.aiTookCaseAt) : null,
        aiHoldOutcome: row.aiHoldOutcome || null,
        aiHoldEndedAt: row.aiHoldEndedAt ? new Date(row.aiHoldEndedAt) : null,
      });
    }

    return computeSecurityCaseAiWeeklyDigest({
      cases: Array.from(cases.values()),
      actions: actions.map(
        (row: SecurityCaseAiAction): SecurityCaseAiDigestActionRow => {
          return {
            kind: row.kind || "",
            status: row.status || "",
            askedAt: row.askedAt ? new Date(row.askedAt) : null,
            decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
            doneAt: row.doneAt ? new Date(row.doneAt) : null,
            undoneAt: row.undoneAt ? new Date(row.undoneAt) : null,
          };
        },
      ),
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
    });
  }

  /*
   * The project's security owners: its members who hold Project Owner or
   * Security Admin and can read security cases, as their own reads are
   * checked - roles, label limits and blocks included. Once each.
   */
  public static async whoGetsIt(projectId: ObjectID): Promise<Array<User>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: { projectId, hasAcceptedInvitation: true },
      select: { userId: true, user: { _id: true, name: true, email: true } },
      skip: 0,
      limit: DIGEST_ROWS_READ_LIMIT,
      props: { isRoot: true },
    });

    const seen: Set<string> = new Set<string>();
    const owners: Array<User> = [];

    for (const member of members) {
      const userId: string = member.userId?.toString() || "";

      if (!userId || seen.has(userId) || !member.user?.email) {
        continue;
      }

      seen.add(userId);

      try {
        const props: DatabaseCommonInteractionProps =
          await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
            { userId: new ObjectID(userId), projectId },
          );

        if (
          CallerPermission.isProjectMember(props, projectId) &&
          CallerPermission.holdsAnyOf(
            props,
            SECURITY_CASE_AI_DIGEST_PERMISSIONS,
            { projectId },
          ) &&
          CallerPermission.holdsAnyOf(
            props,
            new SecurityCase().getReadPermissions(),
            { projectId },
          )
        ) {
          const user: User = new User(new ObjectID(userId));
          user.email = member.user.email;

          if (member.user.name) {
            user.name = member.user.name;
          }

          owners.push(user);
        }
      } catch (error) {
        logger.error(
          `SecurityCaseAiWeeklyDigest: could not read user ${userId}'s permissions in project ${projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return owners;
  }

  /*
   * The projects OneUptime AI did something on a case of in the week: an
   * action of its own, or a hold that ended. Each once.
   */
  private static async findProjectsWithActivity(data: {
    weekStart: Date;
  }): Promise<Array<ObjectID>> {
    const [actions, holds]: [Array<SecurityCaseAiAction>, Array<SecurityCase>] =
      await Promise.all([
        SecurityCaseAiActionService.findAllBy({
          query: {
            updatedAt: QueryHelper.greaterThanEqualTo(data.weekStart),
          },
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
        SecurityCaseService.findAllBy({
          query: {
            aiHoldEndedAt: QueryHelper.greaterThanEqualTo(data.weekStart),
          },
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
      ]);

    const projectIds: Map<string, ObjectID> = new Map();

    for (const row of [...actions, ...holds]) {
      if (row.projectId) {
        projectIds.set(row.projectId.toString(), row.projectId);
      }
    }

    return Array.from(projectIds.values());
  }

  // Security Events -> Overview, where every number has its cases.
  private static async getOverviewLink(
    projectId: ObjectID,
  ): Promise<URL | null> {
    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/security-events/overview`,
      );
    } catch (error) {
      logger.error(error);
      return null;
    }
  }
}
