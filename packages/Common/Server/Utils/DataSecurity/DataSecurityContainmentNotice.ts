import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import ServiceOwnerTeam from "../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Blue500 } from "../../../Types/BrandColors";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import MailService from "../../Services/MailService";
import ServiceOwnerTeamService from "../../Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../Services/ServiceOwnerUserService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import logger from "../Logger";
import DataSecurityIntegrations, {
  getDataSecurityAiLinkInDashboard,
} from "./DataSecurityIntegrations";

/*
 * THE EMAIL FOR A CHANGE ONEUPTIME AI MADE WITHOUT ASKING (#10366).
 *
 * When OneUptime AI contains a telemetry issue on its own - a scrub rule
 * for a secret, proven on the very records it was seen in - nobody pressed
 * anything, so the people who would want to know are told: the store's
 * owners, and the owners of the service whose telemetry it is (who may not
 * own the store). The email says what was done, how it was proven and how
 * to undo it - and, for a secret, that hiding it stops new copies only:
 * the secret must be rotated, and where it was seen. Never a value.
 *
 * It is its own email, not the new-issue email (DataSecurityOwnerNotice):
 * a change was made to how a service's telemetry is stored, and that is
 * news whether the issue is new or not. Where nobody owns the store or the
 * service, nobody is emailed: the issue's timeline and Data Security > AI
 * still say what was done.
 */

// The most people one email goes to.
const MAX_RECIPIENTS: number = 50;

export interface ContainmentNoticeContent {
  // The change in a line, as the proposal names it.
  title: string;
  // What was done: each rule, as a line.
  ruleLines: ReadonlyArray<MarkdownText>;
  // How each was proven, as lines.
  proofLines: ReadonlyArray<MarkdownText>;
  // What a person still must do: rotate a secret, and where it was seen.
  actionLines: ReadonlyArray<MarkdownText>;
}

export function getContainmentNoticeSubject(data: {
  dataStoreName: string;
  isSecret: boolean;
}): string {
  return data.isSecret
    ? `Data Security: OneUptime AI hid a secret in ${data.dataStoreName} - rotate it`
    : `Data Security: OneUptime AI hid sensitive data in ${data.dataStoreName}`;
}

/*
 * The email, as Markdown. The store's and the service's names come from a
 * person or a cloud, so they are placed as text (mdText) - never a value.
 */
export function buildContainmentNoticeMarkdown(data: {
  dataStoreName: string;
  content: ContainmentNoticeContent;
  issueLink: URL;
  aiLink: URL;
}): MarkdownText {
  return FeedMarkdown.join(
    [
      mdText`OneUptime AI made a change to **${data.dataStoreName}** without asking, as your Data Security AI rules allow: **${data.content.title}**.`,
      FeedMarkdown.bulletList(data.content.ruleLines),
      ...(data.content.proofLines.length > 0
        ? [
            mdText`How it was proven before anything was changed:`,
            FeedMarkdown.bulletList(data.content.proofLines),
          ]
        : []),
      ...data.content.actionLines,
      mdText`[Open the issue](${data.issueLink.toString()}) to see the change on its timeline. To take it back, press Undo there, or on [Data Security → AI](${data.aiLink.toString()}): the rules are deleted, and new telemetry is stored as it arrives again.`,
    ],
    "\n\n",
  );
}

export default class DataSecurityContainmentNotice {
  /*
   * Who hears of a change to a store's telemetry: its owners, and its
   * service's - each person once.
   */
  public static async getRecipients(data: {
    dataStoreId: ObjectID;
    serviceId?: ObjectID | null | undefined;
  }): Promise<Array<User>> {
    const byId: Map<string, User> = new Map<string, User>();

    for (const owner of await DataSecurityIntegrations.getOwnerUsers(
      data.dataStoreId,
    )) {
      if (owner.id) {
        byId.set(owner.id.toString(), owner);
      }
    }

    if (data.serviceId) {
      for (const owner of await this.getServiceOwnerUsers(data.serviceId)) {
        if (owner.id && !byId.has(owner.id.toString())) {
          byId.set(owner.id.toString(), owner);
        }
      }
    }

    return Array.from(byId.values()).slice(0, MAX_RECIPIENTS);
  }

  // A service's owners: the people it names, and the members of its teams.
  public static async getServiceOwnerUsers(
    serviceId: ObjectID,
  ): Promise<Array<User>> {
    const userIds: Set<string> = new Set<string>();
    const users: Array<ServiceOwnerUser> = await ServiceOwnerUserService.findBy(
      {
        query: { serviceId },
        select: { userId: true },
        skip: 0,
        limit: MAX_RECIPIENTS,
        props: { isRoot: true },
      },
    );

    for (const owner of users) {
      if (owner.userId) {
        userIds.add(owner.userId.toString());
      }
    }

    const teams: Array<ServiceOwnerTeam> = await ServiceOwnerTeamService.findBy(
      {
        query: { serviceId },
        select: { teamId: true },
        skip: 0,
        limit: MAX_RECIPIENTS,
        props: { isRoot: true },
      },
    );
    const teamIds: Array<ObjectID> = teams
      .map((owner: ServiceOwnerTeam): ObjectID | undefined => {
        return owner.teamId || undefined;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    if (teamIds.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: { teamId: new Includes(teamIds), hasAcceptedInvitation: true },
        select: { userId: true },
        skip: 0,
        limit: MAX_RECIPIENTS,
        props: { isRoot: true },
      });

      for (const member of members) {
        if (member.userId) {
          userIds.add(member.userId.toString());
        }
      }
    }

    if (userIds.size === 0) {
      return [];
    }

    return await UserService.findBy({
      query: {
        _id: new Includes(
          Array.from(userIds)
            .slice(0, MAX_RECIPIENTS)
            .map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
        ),
      },
      select: { _id: true, email: true, name: true },
      skip: 0,
      limit: MAX_RECIPIENTS,
      props: { isRoot: true },
    });
  }

  /*
   * Email the store's and the service's owners about a change OneUptime AI
   * made without asking, and say so on the issue's timeline. Returns how
   * many were emailed. Never throws: an email that cannot go never takes
   * the change back.
   */
  public static async send(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    dataStoreName: string;
    serviceId?: ObjectID | null | undefined;
    dataSecurityIssueId?: ObjectID | null | undefined;
    isSecret: boolean;
    content: ContainmentNoticeContent;
  }): Promise<number> {
    try {
      const recipients: Array<User> = await this.getRecipients({
        dataStoreId: data.dataStoreId,
        serviceId: data.serviceId,
      });

      if (recipients.length === 0) {
        return 0;
      }

      const issueLink: URL = data.dataSecurityIssueId
        ? await DataSecurityIssueService.getIssueLinkInDashboard(
            data.projectId,
            data.dataSecurityIssueId,
          )
        : await getDataSecurityAiLinkInDashboard(data.projectId);
      const subject: string = getContainmentNoticeSubject({
        dataStoreName: data.dataStoreName,
        isSecret: data.isSecret,
      });
      // The template places the message as HTML: written from Markdown, never as it is.
      const message: string = await Markdown.convertToHTML(
        buildContainmentNoticeMarkdown({
          dataStoreName: data.dataStoreName,
          content: data.content,
          issueLink,
          aiLink: await getDataSecurityAiLinkInDashboard(data.projectId),
        }).toString(),
        MarkdownContentType.Email,
      );
      let emailed: number = 0;

      for (const recipient of recipients) {
        if (!recipient.email || !recipient.id) {
          continue;
        }

        emailed++;
        MailService.sendMail(
          {
            toEmail: recipient.email,
            templateType: EmailTemplateType.SimpleMessage,
            vars: { subject, message },
            subject,
            isSubjectLiteral: true,
          },
          { projectId: data.projectId, userId: recipient.id },
        ).catch((error: Error) => {
          logger.error(error);
        });
      }

      if (emailed > 0 && data.dataSecurityIssueId) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: data.projectId,
          dataSecurityIssueId: data.dataSecurityIssueId,
          eventType: DataSecurityIssueFeedEventType.OwnersNotified,
          displayColor: Blue500,
          feedInfoInMarkdown: (emailed === 1
            ? mdText`The owner of the store and its service was emailed about the change OneUptime AI made.`
            : mdText`The ${String(emailed)} owners of the store and its service were emailed about the change OneUptime AI made.`
          ).toString(),
        });
      }

      return emailed;
    } catch (error) {
      logger.error(
        `DataSecurity: could not email the owners of store ${data.dataStoreId.toString()} about a change OneUptime AI made:`,
      );
      logger.error(error);
      return 0;
    }
  }
}
