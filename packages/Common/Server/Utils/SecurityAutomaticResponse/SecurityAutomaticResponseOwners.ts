import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import MailService from "../../Services/MailService";
import OnCallPageService, {
  OnCallPageResult,
} from "../../Services/OnCallPageService";
import ProjectService from "../../Services/ProjectService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE PROJECT'S SECURITY OWNERS, as automatic response tells and pages them
 * (#10350): its Security Admins - the people who turn policies on - or,
 * in a project with none, its Project Owners, as the product tells them of
 * everything else that stops working on its own. #10641 lets a project
 * choose who instead.
 *
 *   - page: at the hourly limit, an attack too large for a policy needs a
 *     person now, so they are paged - an alert of the project, through
 *     each person's own on-call rules (OnCallPageService);
 *   - tell: a block lifted because a signed-in user was seen from its
 *     address, and a trial run that finished, are an email each.
 *
 * Never throws: what a policy did stands whether or not anyone could be
 * told, and the log says why not.
 */
export default class SecurityAutomaticResponseOwners {
  // The Security Admins, or the Project Owners when the project has none.
  @CaptureSpan()
  public static async find(projectId: ObjectID): Promise<Array<User>> {
    const admins: Array<User> = await ProjectService.getUsersHolding(
      projectId,
      Permission.SecurityAdmin,
    );

    if (admins.length > 0) {
      return admins;
    }

    return await ProjectService.getOwners(projectId);
  }

  /*
   * Pages them about something new, as an alert of the project. Whether
   * anyone was paged; false when nobody could be.
   */
  @CaptureSpan()
  public static async page(data: {
    projectId: ObjectID;
    title: string;
    descriptionInMarkdown: string;
  }): Promise<boolean> {
    try {
      const owners: Array<User> = await this.find(data.projectId);
      const userIds: Array<ObjectID> = owners
        .map((owner: User): ObjectID | undefined => {
          return owner.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      if (userIds.length === 0) {
        logger.warn(
          `SecurityAutomaticResponseOwners: project ${data.projectId.toString()} has no Security Admin or Project Owner to page about "${data.title}".`,
        );
        return false;
      }

      const result: OnCallPageResult = await OnCallPageService.page({
        projectId: data.projectId,
        targets: { userIds },
        about: {
          newAlert: {
            title: data.title,
            description: data.descriptionInMarkdown,
            rootCause:
              "Paged by an automatic response policy of Security Events.",
          },
        },
        props: { isRoot: true, tenantId: data.projectId },
        maxWaitForRecordInMs: 0,
      });

      return result.isAnyonePaged;
    } catch (error) {
      logger.error(
        `SecurityAutomaticResponseOwners: could not page project ${data.projectId.toString()}'s security owners about "${data.title}":`,
      );
      logger.error(error);
      return false;
    }
  }

  // Emails them. How many were sent.
  @CaptureSpan()
  public static async tell(data: {
    projectId: ObjectID;
    subject: string;
    messageInMarkdown: string;
  }): Promise<number> {
    try {
      const owners: Array<User> = await this.find(data.projectId);
      const html: string = await Markdown.convertToHTML(
        data.messageInMarkdown,
        MarkdownContentType.Email,
      );
      let sent: number = 0;

      for (const owner of owners) {
        if (!owner.email) {
          continue;
        }

        try {
          await MailService.sendMail(
            {
              toEmail: new Email(owner.email.toString()),
              templateType: EmailTemplateType.SimpleMessage,
              vars: { subject: data.subject, message: html },
              subject: data.subject,
              isSubjectLiteral: true,
            },
            {
              projectId: data.projectId,
              userId: owner.id || undefined,
              timeoutInMs: 20000,
            },
          );
          sent++;
        } catch (error) {
          logger.warn(
            `SecurityAutomaticResponseOwners: could not email ${owner.email.toString()} about "${data.subject}": ${String(error)}`,
          );
        }
      }

      return sent;
    } catch (error) {
      logger.error(
        `SecurityAutomaticResponseOwners: could not tell project ${data.projectId.toString()}'s security owners about "${data.subject}":`,
      );
      logger.error(error);
      return 0;
    }
  }
}
