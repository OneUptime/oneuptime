import { IsBillingEnabled } from "../EnvironmentConfig";
import MailService from "../Services/MailService";
import ProductFeedbackService, {
  ServerFeedbackSettings,
} from "../Services/ProductFeedbackService";
import ProjectService from "../Services/ProjectService";
import UserService from "../Services/UserService";
import logger from "./Logger";
import { ProductFeedbackRateLimit } from "./ProductFeedbackRateLimit";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Email from "../../Types/Email";
import EmailMessage from "../../Types/Email/EmailMessage";
import { toMailboxAddress } from "../../Types/Email/EmailRecipients";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import ObjectID from "../../Types/ObjectID";
import {
  GIVE_FEEDBACK_CATEGORY_TITLES,
  GiveFeedbackCategory,
  GiveFeedbackDestination,
  GiveFeedbackReceipt,
  ONEUPTIME_SUPPORT_EMAIL,
  ProductFeedbackSubmission,
  getGiveFeedbackDestination,
  isGiveFeedbackEmailed,
  isGiveFeedbackOffered,
  toGiveFeedbackCategory,
} from "../../Types/ProductFeedback/ProductFeedback";
import SafeHtml from "../../Types/SafeHtml";

/*
 * GIVE FEEDBACK, EMAILED TO THE TEAM THAT READS IT (issue #8893).
 *
 * Give feedback is a message: the person writes to someone and wants an
 * answer. Once the answer is kept (ProductFeedbackService.submit), this
 * emails it - with the person's name and email address, their project, the
 * page as a route with no ids and the version - to:
 *
 *   - the OneUptime team at support@oneuptime.com, on OneUptime Cloud;
 *   - a self-hosted server's admins at its Admin Notification Email, through
 *     the server's own mail settings. Never to OneUptime: a self-hosted
 *     server's people, projects and words are its own;
 *   - nobody, on a self-hosted server with no Admin Notification Email: the
 *     answer is in Admin Dashboard > Feedback, as every answer is;
 *   - an address of the server's own, where a master admin sent Give
 *     feedback there (Admin Dashboard > Settings > Help and Support,
 *     #10865), through the server's own mail settings, while the server can
 *     send email - Help offers no Give feedback while it cannot. Where it
 *     opens a page of the server's own, or is hidden, nothing is emailed.
 *
 * The person is copied (Cc) and a reply goes to them (Reply-To), so the
 * team's answer reaches them, not the server's no-reply address - only at
 * the address they proved is theirs (User.isEmailVerified).
 *
 * Giving feedback never fails or waits for any of this. The API keeps the
 * answer, asks prepare() what will be sent (one read of the person, never a
 * throw), answers the Dashboard, and only then calls send(), which logs a
 * failure and throws nothing. A person can have
 * GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR emailed an hour, and the server
 * GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR: past either, the answer is still
 * kept, just not emailed, and the Dashboard is told so.
 */

export const GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR: number = 5;
export const GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR: number = 200;

// How much of the first line the subject shows.
export const GIVE_FEEDBACK_SUBJECT_SUMMARY_LENGTH: number = 80;

const HOUR_MS: number = 60 * 60 * 1000;
const SERVER_KEY: string = "server";
const LINE_BREAK: RegExp = /\r\n|\r|\n/;
// Characters that are no part of a line of text: nothing in a subject but words.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001f\u007f]/g;

// What the email says: the answer, and who gave it, as the server read them.
export interface GiveFeedbackEmailData {
  category: GiveFeedbackCategory;
  details: string;
  page: string;
  version: string;
  person: {
    name: string;
    email: string;
    // Copied, and replied to: only an address they proved is theirs.
    isEmailVerified: boolean;
  };
  project: { id: string; name: string } | null;
}

// What will be emailed, once the Dashboard has its answer (send).
export interface GiveFeedbackDelivery {
  to: string;
  destination: GiveFeedbackDestination;
  email: GiveFeedbackEmailData;
  projectId: ObjectID | null;
}

/*
 * The subject the team's inbox lists it by: what it is about, and the
 * start of its first line - "Feedback (Something's broken): The SLO page
 * shows no budget". Final text, never compiled (isSubjectLiteral): the
 * words are the person's.
 */
export const getGiveFeedbackSubject: (data: {
  category: GiveFeedbackCategory;
  details: string;
}) => string = (data: {
  category: GiveFeedbackCategory;
  details: string;
}): string => {
  const firstLine: string =
    data.details
      .split(LINE_BREAK)
      .map((line: string): string => {
        return line.replace(CONTROL_CHARACTERS, " ").trim();
      })
      .find((line: string): boolean => {
        return line.length > 0;
      }) || "";

  const summary: string =
    firstLine.length > GIVE_FEEDBACK_SUBJECT_SUMMARY_LENGTH
      ? `${firstLine.slice(0, GIVE_FEEDBACK_SUBJECT_SUMMARY_LENGTH - 1).trimEnd()}…`
      : firstLine;

  const prefix: string = `Feedback (${GIVE_FEEDBACK_CATEGORY_TITLES[data.category]})`;

  return summary ? `${prefix}: ${summary}` : prefix;
};

/*
 * What the person wrote, as HTML: each line escaped (SafeHtml.escape), and
 * a <br/> between lines. The only markup in it is the <br/> this adds.
 */
export const getGiveFeedbackMessageHtml: (details: string) => string = (
  details: string,
): string => {
  return details
    .split(LINE_BREAK)
    .map((line: string): string => {
      return SafeHtml.escape(line);
    })
    .join("<br/>");
};

// The email itself: to the team, the person copied and replied to.
export const buildGiveFeedbackEmail: (data: {
  to: string;
  email: GiveFeedbackEmailData;
}) => EmailMessage = (data: {
  to: string;
  email: GiveFeedbackEmailData;
}): EmailMessage => {
  const email: GiveFeedbackEmailData = data.email;
  const personEmail: string | null = toMailboxAddress(email.person.email);
  const personName: string = email.person.name.trim() || email.person.email;
  const category: string = GIVE_FEEDBACK_CATEGORY_TITLES[email.category];
  const copyTo: Email | undefined =
    personEmail && email.person.isEmailVerified
      ? new Email(personEmail)
      : undefined;

  return {
    toEmail: new Email(data.to),
    ...(copyTo ? { ccEmails: [copyTo], replyToEmail: copyTo } : {}),
    templateType: EmailTemplateType.GiveFeedback,
    subject: getGiveFeedbackSubject({
      category: email.category,
      details: email.details,
    }),
    isSubjectLiteral: true,
    vars: {
      title: `Feedback from ${personName}`,
      preheader: [category, personName, email.project?.name || ""]
        .filter(Boolean)
        .join(" · "),
      category: category,
      messageHtml: getGiveFeedbackMessageHtml(email.details),
      personName: email.person.name.trim(),
      personEmail: email.person.email,
      projectName: email.project?.name || "",
      projectId: email.project?.id || "",
      page: email.page,
      version: email.version,
    },
  };
};

export class GiveFeedbackEmail {
  // Whether this is OneUptime Cloud (billing on), as everything else reads it.
  private readonly isOneUptimeCloud: () => boolean;

  public constructor(options?: { isOneUptimeCloud?: () => boolean }) {
    this.isOneUptimeCloud =
      options?.isOneUptimeCloud ||
      ((): boolean => {
        return IsBillingEnabled;
      });
  }

  private readonly perPerson: ProductFeedbackRateLimit =
    new ProductFeedbackRateLimit(
      GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR,
      HOUR_MS,
    );

  private readonly perServer: ProductFeedbackRateLimit =
    new ProductFeedbackRateLimit(
      GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR,
      HOUR_MS,
      1,
    );

  /*
   * Where Give feedback goes on this server (GiveFeedbackDestination), and
   * the address it is emailed to: nowhere at all where it is not offered -
   * hidden, or sent to an address of the server's own the server cannot
   * send email to (isGiveFeedbackOffered) - so nothing is promised that
   * cannot be kept.
   */
  public getDestination(settings: ServerFeedbackSettings): {
    destination: GiveFeedbackDestination;
    to: string | null;
  } {
    const destination: GiveFeedbackDestination = getGiveFeedbackDestination({
      isOneUptimeCloud: this.isOneUptimeCloud(),
      adminNotificationEmail: settings.adminNotificationEmail,
      giveFeedback: settings.giveFeedback,
    });

    if (
      !isGiveFeedbackOffered({
        giveFeedback: settings.giveFeedback,
        canSendEmail: settings.canSendEmail,
      })
    ) {
      return { destination, to: null };
    }

    switch (destination) {
      case GiveFeedbackDestination.OneUptimeTeam:
        return { destination, to: ONEUPTIME_SUPPORT_EMAIL };
      case GiveFeedbackDestination.ServerAdminsByEmail:
        return {
          destination,
          to: toMailboxAddress(settings.adminNotificationEmail),
        };
      case GiveFeedbackDestination.SupportTeamByEmail:
        return {
          destination,
          to: toMailboxAddress(settings.giveFeedback?.value),
        };
      default:
        return { destination, to: null };
    }
  }

  /*
   * What will be emailed for this answer, or null when nothing is: Give
   * feedback only, where the server emails it, while the person and the
   * server are under their hourly counts. Reads the person; never throws.
   */
  public async prepare(data: {
    userId: ObjectID;
    projectId: ObjectID | null;
    submission: ProductFeedbackSubmission;
    nowMs: number;
  }): Promise<GiveFeedbackDelivery | null> {
    try {
      if (!data.submission.details) {
        return null;
      }

      const { destination, to } = this.getDestination(
        await ProductFeedbackService.getServerFeedbackSettings(),
      );

      if (!isGiveFeedbackEmailed(destination) || !to) {
        return null;
      }

      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: {
          name: true,
          email: true,
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      const personEmail: string | null = toMailboxAddress(
        user?.email?.toString(),
      );

      if (!user || !personEmail) {
        return null;
      }

      if (!this.perPerson.take(data.userId.toString(), data.nowMs)) {
        logger.warn(
          "Give feedback was kept but not emailed: this person has had the most emailed this hour.",
        );
        return null;
      }

      if (!this.perServer.take(SERVER_KEY, data.nowMs)) {
        logger.warn(
          "Give feedback was kept but not emailed: this server has emailed the most it may this hour.",
        );
        return null;
      }

      return {
        to: to,
        destination: destination,
        projectId: data.projectId,
        email: {
          category: toGiveFeedbackCategory(data.submission.topic),
          details: data.submission.details,
          page: data.submission.page,
          version: data.submission.version,
          person: {
            name: user.name?.toString() || "",
            email: personEmail,
            isEmailVerified: Boolean(user.isEmailVerified),
          },
          project: null,
        },
      };
    } catch (err) {
      logger.error("Give feedback was kept, but could not be emailed:");
      logger.error(err);
      return null;
    }
  }

  // What the Dashboard is told: whether it is emailed, and where a copy goes.
  public getReceipt(
    delivery: GiveFeedbackDelivery | null,
  ): GiveFeedbackReceipt {
    if (!delivery) {
      return { isEmailed: false, copyTo: null };
    }

    return {
      isEmailed: true,
      copyTo: delivery.email.person.isEmailVerified
        ? delivery.email.person.email
        : null,
    };
  }

  /*
   * Sends it: with the project's name read first, when the person gave it
   * from a project of theirs. Logs a failure; never throws.
   */
  public async send(delivery: GiveFeedbackDelivery): Promise<void> {
    try {
      let project: { id: string; name: string } | null = null;

      if (delivery.projectId) {
        const found: Project | null = await ProjectService.findOneById({
          id: delivery.projectId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        project = {
          id: delivery.projectId.toString(),
          name: found?.name || "",
        };
      }

      // The notification service answers a send it could not make, rather than throw.
      const sent: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          buildGiveFeedbackEmail({
            to: delivery.to,
            email: { ...delivery.email, project: project },
          }),
        );

      if (sent instanceof HTTPErrorResponse) {
        logger.error(
          `Give feedback was kept, but its email was not sent: ${sent.message}`,
        );
      }
    } catch (err) {
      logger.error("Give feedback was kept, but its email was not sent:");
      logger.error(err);
    }
  }
}

export default new GiveFeedbackEmail();
