import DatabaseConfig from "../DatabaseConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import Queue, { QueueName } from "../Infrastructure/Queue";
import MailService from "../Services/MailService";
import ProjectService from "../Services/ProjectService";
import UserService from "../Services/UserService";
import logger from "./Logger";
import ProductBrandingText from "./ProductBrandingText";
import { DEFAULT_EMAIL_TIMEZONE } from "./RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "./ServerTranslation";
import SsoManagedSignIn from "./SsoManagedSignIn";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import { AccountsRoute } from "../../ServiceRoute";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../Types/ReaderLanguage";
import {
  hasLocalSignInSettings,
  LocalSignInSettings,
  readLocalSignInSettings,
} from "../../Types/SSO/LocalSignInClearing";
import {
  getSignInSettingsClearedEmailVariables,
  getSignInSettingsClearedSubject,
  SignInAfterClearing,
  SignInSettingsClearedBy,
  SignInSettingsClearer,
} from "../../Types/SSO/SignInSettingsClearedEmail";
import { SignInManagement } from "../../Types/SSO/SsoManagedSignIn";
import { Translator } from "../../Types/Translator";
import { getUserWritingLanguage } from "../../Types/UserLanguage";
import crypto from "crypto";

/*
 * EMAILING THE PEOPLE WHOSE SIGN-IN SETTINGS WERE CLEARED (issues #9818,
 * #9820 and #9991).
 *
 * What the email says, and why it says nothing about anybody else, is in
 * Common/Types/SSO/SignInSettingsClearedEmail.ts. This sends it:
 *
 *   - to the address on the person's account, read when the email is
 *     written, never one a caller names, in the language on their account,
 *     with the time of the clear in their own time zone;
 *   - only for a clear that removed something (hasLocalSignInSettings), so
 *     somebody who had nothing saved hears nothing;
 *   - with how they sign in now read from the rule at the moment the email
 *     is written (SsoManagedSignIn): single sign-on and its providers while
 *     SSO manages their sign-in, Forgot password? when nothing does, and
 *     both when the rule cannot be read.
 *
 * A DURABLE JOB FOR EACH EMAIL (#9991). The emails used to wait in the
 * memory of the server that cleared, one after another: a restart in the
 * middle of a bulk clear - a deploy - lost every email not yet sent, while
 * the settings stayed cleared. Now each email is a job on the Worker queue
 * (Server/Infrastructure/Queue), kept in Redis until a worker has sent it:
 *
 *   - a clear hands its emails over (notify) the moment each batch is
 *     cleared and audited, a few milliseconds of Redis writes, and never
 *     waits longer than EMAIL_ENQUEUE_TIMEOUT_IN_MS, nor fails, nor throws:
 *     a clear is never blocked or failed by an email;
 *   - a worker - this server's or another's, now or after a restart - sends
 *     it (runJob). A send that fails is tried again, EMAIL_JOB_ATTEMPTS
 *     times in all, waiting EMAIL_JOB_BACKOFF_IN_MS, then twice as long
 *     each time; the last failure is logged by the person's id, and given
 *     up;
 *   - its jobs come after the Worker queue's own (EMAIL_JOB_PRIORITY), so a
 *     clear of thousands of people never holds up a cron.
 *
 * A JOB CARRIES NO MORE OF THE PERSON THAN IT NEEDS: their id, who cleared
 * them by role (and the project's id for an owner's clear), when, and what
 * was removed - counts and yes-or-no, the one thing nobody can read again
 * once it is gone. Their address, name, language and time zone, the
 * project's name and the providers' names are read when the email is
 * written, so an email that waited goes to the address the account has then.
 *
 * ONE EMAIL, HOWEVER OFTEN IT IS QUEUED. Two queued emails for one person
 * that say the same thing - the same clear queued twice, two clears that
 * read the same settings at the same moment, a job a worker ran again after
 * its email went - are one send:
 *
 *   - the job's id is the person's and what the email says
 *     (getEmailKey): an email queued while the same one still waits is
 *     the job already there (BullMQ keeps it);
 *   - once an email has gone, its key is kept for EMAIL_SENT_WINDOW_IN_SECONDS
 *     (wasSent), and a job that finds it there sends nothing.
 *
 * An email that says something else - another clearer, more or less
 * removed - is another email, and goes.
 */

/*
 * One person's settings, cleared, for their email: whose, what they had
 * (all of which is gone), and who cleared them - a server admin, or an
 * owner of the project named by its id - and when (now, when left out).
 */
export type SignInSettingsClearedEmailEvent = {
  userId: ObjectID;
  cleared: LocalSignInSettings;
  clearedAt?: Date | undefined;
} & (
  | { clearedBy: SignInSettingsClearedBy.ServerAdmin }
  | { clearedBy: SignInSettingsClearedBy.ProjectOwner; projectId: ObjectID }
);

/*
 * What one email's job carries, read back from its data: ids, the role of
 * whoever cleared, when, and what was removed. Nothing else of the person.
 */
export interface SignInSettingsClearedEmailJob {
  userId: ObjectID;
  clearedBy: SignInSettingsClearedBy;
  // The project an owner cleared them from: null for a server admin's clear.
  projectId: ObjectID | null;
  clearedAt: Date;
  cleared: LocalSignInSettings;
}

// The Worker queue's job that sends one email (App/FeatureSet/Workers).
export const SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB: string =
  "SignInSettingsCleared:SendEmail";

// How long one email may take to reach the mail service before it is given up.
export const EMAIL_HAND_OFF_TIMEOUT_IN_MS: number = 30 * 1000;

/*
 * How long a worker gives one email's job: the mail service's limit, and
 * the reads around it.
 */
export const EMAIL_JOB_TIMEOUT_IN_MS: number = 2 * 60 * 1000;

/*
 * How many times an email is tried, the first included, and how long it
 * waits before the second: 30 seconds, then a minute, two, four and eight,
 * about a quarter of an hour in all - long enough for a mail service that
 * restarts, short enough that a person is told the same day.
 */
export const EMAIL_JOB_ATTEMPTS: number = 6;
export const EMAIL_JOB_BACKOFF_IN_MS: number = 30 * 1000;

/*
 * The Worker queue takes every job without a priority first (Queue.addJob):
 * its crons and notifications are never held up behind a clear of thousands
 * of people.
 */
export const EMAIL_JOB_PRIORITY: number = 10;

/*
 * The longest a clear waits for its emails to be queued. Queuing is a Redis
 * write each, done in milliseconds: this is only ever reached while Redis
 * does not answer, and then the clear goes on without them.
 */
export const EMAIL_ENQUEUE_TIMEOUT_IN_MS: number = 5 * 1000;

/*
 * How long an email that went is remembered by what it said: the same
 * email queued again in that time is not sent again. Longer than any job
 * waits to be run again after its email went (a stalled job is run again
 * within a minute or two), and short enough that the same thing removed
 * again later, a new clear, is told.
 */
export const EMAIL_SENT_WINDOW_IN_SECONDS: number = 15 * 60;

// Where wasSent keeps the emails that went (GlobalCache).
export const EMAIL_SENT_CACHE_NAMESPACE: string =
  "sign-in-settings-cleared-email-sent";

// What a sent email's key holds.
const SENT_MARK: string = "sent";

// How one email went: sent, nobody to send it to, or not sent (try again).
export enum SignInSettingsClearedEmailOutcome {
  Sent = "Sent",
  // No account any more, or no address on it: nothing to try again.
  NobodyToEmail = "NobodyToEmail",
  // The mail service failed or refused it, or a read failed: try again.
  NotSent = "NotSent",
}

// How the person signs in now, and through which providers.
interface SignInNow {
  way: SignInAfterClearing;
  ssoProviderNames: Array<string>;
}

// The order the key reads what was removed in, so it never depends on JSON's.
const CLEARED_FIELDS_IN_KEY_ORDER: ReadonlyArray<keyof LocalSignInSettings> = [
  "hasPassword",
  "hasPasswordResetLink",
  "isTwoFactorAuthEnabled",
  "authenticatorAppCount",
  "passkeyAndSecurityKeyCount",
  "backupCodeCount",
];

const readId: (value: unknown) => ObjectID | null = (
  value: unknown,
): ObjectID | null => {
  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : null;
};

export default class SignInSettingsClearedEmail {
  /*
   * What a job carries for this event (SignInSettingsClearedEmailJob): ids,
   * the clearer's role, when, and what was removed.
   */
  public static toJobData(event: SignInSettingsClearedEmailEvent): JSONObject {
    const cleared: JSONObject = {};

    for (const field of CLEARED_FIELDS_IN_KEY_ORDER) {
      cleared[field] = event.cleared[field];
    }

    return {
      userId: event.userId.toString(),
      clearedBy: event.clearedBy,
      ...(event.clearedBy === SignInSettingsClearedBy.ProjectOwner
        ? { projectId: event.projectId.toString() }
        : {}),
      clearedAt: (
        event.clearedAt || OneUptimeDate.getCurrentDate()
      ).toISOString(),
      cleared: cleared,
    };
  }

  /*
   * A job's data, as toJobData wrote it, or null for anything else: a job
   * that names nobody, or names them wrongly, is never sent - nor tried
   * again, since trying cannot mend it. Keys it does not know (the tracing
   * the queue adds) are left alone.
   */
  public static readJobData(
    data: unknown,
  ): SignInSettingsClearedEmailJob | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    const job: JSONObject = data as JSONObject;
    const userId: ObjectID | null = readId(job["userId"]);
    const cleared: LocalSignInSettings | null = readLocalSignInSettings(
      job["cleared"],
    );
    const clearedAt: Date | null =
      typeof job["clearedAt"] === "string" &&
      Number.isFinite(Date.parse(job["clearedAt"]))
        ? new Date(job["clearedAt"])
        : null;

    if (!userId || !cleared || !clearedAt) {
      return null;
    }

    if (job["clearedBy"] === SignInSettingsClearedBy.ServerAdmin) {
      return {
        userId: userId,
        clearedBy: SignInSettingsClearedBy.ServerAdmin,
        projectId: null,
        clearedAt: clearedAt,
        cleared: cleared,
      };
    }

    // An owner's clear names its project: it is the one the email names.
    const projectId: ObjectID | null = readId(job["projectId"]);

    if (
      job["clearedBy"] === SignInSettingsClearedBy.ProjectOwner &&
      projectId
    ) {
      return {
        userId: userId,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectId: projectId,
        clearedAt: clearedAt,
        cleared: cleared,
      };
    }

    return null;
  }

  /*
   * What sets one email apart from another: the person, and what it says -
   * who cleared them, from which project, and what was removed. Not when:
   * two clears that read the same settings at the same moment say the same
   * thing, and the person is told once. A hash, so the key holds no count
   * or name of anything.
   */
  public static getEmailKey(job: {
    userId: ObjectID;
    clearedBy: SignInSettingsClearedBy;
    projectId: ObjectID | null;
    cleared: LocalSignInSettings;
  }): string {
    const said: string = JSON.stringify([
      job.clearedBy,
      job.projectId ? job.projectId.toString().toLowerCase() : "",
      ...CLEARED_FIELDS_IN_KEY_ORDER.map((field: keyof LocalSignInSettings) => {
        return job.cleared[field];
      }),
    ]);

    const hash: string = crypto
      .createHash("sha256")
      .update(said)
      .digest("hex")
      .slice(0, 32);

    return `${job.userId.toString().toLowerCase()}-${hash}`;
  }

  // The id of the job that sends this email: one job for one email.
  public static getJobId(emailKey: string): string {
    return `${SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB}-${emailKey}`;
  }

  /*
   * Queues an email for each person whose clear removed something. Resolves
   * once they are queued, or after EMAIL_ENQUEUE_TIMEOUT_IN_MS, whichever
   * comes first; never rejects, so a clear may wait for it and never fail
   * with it. An email that could not be queued is logged by the person's id.
   */
  public static async notify(
    events: Array<SignInSettingsClearedEmailEvent>,
  ): Promise<void> {
    const toSend: Array<SignInSettingsClearedEmailEvent> = (
      events || []
    ).filter((event: SignInSettingsClearedEmailEvent): boolean => {
      return Boolean(
        event &&
          event.userId &&
          event.cleared &&
          hasLocalSignInSettings(event.cleared),
      );
    });

    if (toSend.length === 0) {
      return;
    }

    const queued: Promise<void> = Promise.all(
      toSend.map((event: SignInSettingsClearedEmailEvent): Promise<void> => {
        return SignInSettingsClearedEmail.enqueue(event);
      }),
    ).then((): void => {
      return undefined;
    });

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timedOut: Promise<boolean> = new Promise<boolean>(
      (resolve: (isTimedOut: boolean) => void): void => {
        timer = setTimeout((): void => {
          resolve(true);
        }, EMAIL_ENQUEUE_TIMEOUT_IN_MS);
      },
    );

    const isTimedOut: boolean = await Promise.race([
      queued.then((): boolean => {
        return false;
      }),
      timedOut,
    ]);

    if (timer) {
      clearTimeout(timer);
    }

    if (isTimedOut) {
      logger.error(
        `The emails saying their sign-in settings were cleared were not all queued within ${EMAIL_ENQUEUE_TIMEOUT_IN_MS} ms (${toSend.length} people): Redis did not answer. The clear went on; they are queued once Redis answers, while this server runs.`,
      );
    }
  }

  // Queues one person's email. Never rejects: a failure is logged.
  private static async enqueue(
    event: SignInSettingsClearedEmailEvent,
  ): Promise<void> {
    try {
      const data: JSONObject = SignInSettingsClearedEmail.toJobData(event);
      const job: SignInSettingsClearedEmailJob | null =
        SignInSettingsClearedEmail.readJobData(data);

      if (!job) {
        logger.error(
          `The email saying their sign-in settings were cleared was not queued for user ${event.userId.toString()}: its clear names nobody to send it for.`,
        );
        return;
      }

      await Queue.addJob(
        QueueName.Worker,
        SignInSettingsClearedEmail.getJobId(
          SignInSettingsClearedEmail.getEmailKey(job),
        ),
        SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
        data,
        {
          attempts: EMAIL_JOB_ATTEMPTS,
          backoffDelayInMs: EMAIL_JOB_BACKOFF_IN_MS,
          priority: EMAIL_JOB_PRIORITY,
          /*
           * The same email queued while its job still waits is that job
           * (BullMQ keeps it), never a second one - and once it is done it
           * leaves the queue, so the same thing cleared again later is a
           * job of its own (wasSent tells the two apart).
           */
          skipExistenceCheck: true,
          removeWhenDone: true,
        },
      );
    } catch (err) {
      logger.error(
        `The email saying their sign-in settings were cleared could not be queued for user ${event.userId.toString()}.`,
      );
      logger.error(err);
    }
  }

  /*
   * A worker's job: send the email its data describes, once. Returns when
   * it went, when there is nothing to send (nobody, or a job that names
   * nobody), and when the same email already went; throws when it was not
   * sent, so the queue tries again - until its last attempt, which is
   * logged as given up.
   */
  public static async runJob(
    data: unknown,
    attempt?: { attempt: number; maxAttempts: number } | undefined,
  ): Promise<void> {
    const job: SignInSettingsClearedEmailJob | null =
      SignInSettingsClearedEmail.readJobData(data);

    if (!job) {
      logger.error(
        `A ${SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB} job that names nobody to email was dropped.`,
      );
      return;
    }

    if (!hasLocalSignInSettings(job.cleared)) {
      return;
    }

    const emailKey: string = SignInSettingsClearedEmail.getEmailKey(job);

    if (await SignInSettingsClearedEmail.wasSent(emailKey)) {
      logger.info(
        `The email saying their sign-in settings were cleared already went to user ${job.userId.toString()}; it is not sent again.`,
      );
      return;
    }

    const outcome: SignInSettingsClearedEmailOutcome =
      await SignInSettingsClearedEmail.sendToPerson(job);

    if (outcome === SignInSettingsClearedEmailOutcome.Sent) {
      await SignInSettingsClearedEmail.markSent(emailKey, job.userId);
      return;
    }

    if (outcome === SignInSettingsClearedEmailOutcome.NobodyToEmail) {
      return;
    }

    const attemptNumber: number = attempt?.attempt || 1;
    const maxAttempts: number = attempt?.maxAttempts || 1;

    if (attemptNumber >= maxAttempts) {
      logger.error(
        `Gave up on the email saying their sign-in settings were cleared, for user ${job.userId.toString()}, after ${attemptNumber} attempt(s).`,
      );
    }

    throw new Error(
      `The email saying their sign-in settings were cleared was not sent to user ${job.userId.toString()} (attempt ${attemptNumber} of ${maxAttempts}).`,
    );
  }

  /*
   * Whether this email already went (EMAIL_SENT_WINDOW_IN_SECONDS). A cache
   * that cannot be read throws: the job is tried again, rather than risk a
   * second email.
   */
  public static async wasSent(emailKey: string): Promise<boolean> {
    return (
      (await GlobalCache.getString(EMAIL_SENT_CACHE_NAMESPACE, emailKey)) ===
      SENT_MARK
    );
  }

  /*
   * Remembers that this email went. Never throws: it went, and trying the
   * job again would send it twice.
   */
  private static async markSent(
    emailKey: string,
    userId: ObjectID,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        EMAIL_SENT_CACHE_NAMESPACE,
        emailKey,
        SENT_MARK,
        { expiresInSeconds: EMAIL_SENT_WINDOW_IN_SECONDS },
      );
    } catch (err) {
      logger.error(
        `The email saying their sign-in settings were cleared went to user ${userId.toString()}, but could not be remembered as sent.`,
      );
      logger.error(err);
    }
  }

  /*
   * One person's email: Sent once the mail service has taken it,
   * NobodyToEmail for an account that is gone or has no address, NotSent
   * for a failure - logged by the person's id and never by their address.
   * Never throws.
   */
  public static async sendToPerson(
    job: SignInSettingsClearedEmailJob,
  ): Promise<SignInSettingsClearedEmailOutcome> {
    try {
      const user: User | null = await UserService.findOneById({
        id: job.userId,
        select: {
          _id: true,
          email: true,
          timezone: true,
          language: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user || !user.email) {
        return SignInSettingsClearedEmailOutcome.NobodyToEmail;
      }

      const clearer: SignInSettingsClearer =
        await SignInSettingsClearedEmail.readClearer(job);

      const signIn: SignInNow = await SignInSettingsClearedEmail.readSignInNow(
        job.userId,
      );

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      const accountsUrl: (path: string) => string = (path: string): string => {
        return new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(path),
        ).toString();
      };

      const language: string = getUserWritingLanguage(user);
      const productName: string = ProductBrandingText.getProductName();

      // The subject and the date in the reader's language, as one piece of work.
      const written: { subject: string; clearedAt: string } = writeInLanguage(
        language,
        (translator: Translator): { subject: string; clearedAt: string } => {
          return {
            subject: getSignInSettingsClearedSubject(translator, productName),
            // When it was cleared, not when the email went.
            clearedAt: OneUptimeDate.getDateAsFormattedStringInTimezone({
              date: job.clearedAt,
              timezone: user.timezone || DEFAULT_EMAIL_TIMEZONE,
            }),
          };
        },
      );

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          {
            toEmail: user.email,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.SignInSettingsCleared,
            vars: getSignInSettingsClearedEmailVariables({
              ...clearer,
              cleared: job.cleared,
              signIn: signIn.way,
              ssoProviderNames: signIn.ssoProviderNames,
              clearedAt: written.clearedAt,
              productName: productName,
              signInUrl: accountsUrl("/login"),
              ssoSignInUrl: accountsUrl("/sso"),
              forgotPasswordUrl: accountsUrl("/forgot-password"),
            }),
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            userId: job.userId,
            timeoutInMs: EMAIL_HAND_OFF_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying their sign-in settings were cleared was not sent to user ${job.userId.toString()}: the mail service refused it (${response.statusCode}).`,
        );
        return SignInSettingsClearedEmailOutcome.NotSent;
      }

      return SignInSettingsClearedEmailOutcome.Sent;
    } catch (err) {
      logger.error(
        `The email saying their sign-in settings were cleared was not sent to user ${job.userId.toString()}.`,
      );
      logger.error(err);
      return SignInSettingsClearedEmailOutcome.NotSent;
    }
  }

  /*
   * Who cleared them, as the email names them: a server admin, or an owner
   * of the project, by its name as it is now - none for a project deleted
   * since (the email then names no project). A read that fails throws, and
   * the email is tried again.
   */
  private static async readClearer(
    job: SignInSettingsClearedEmailJob,
  ): Promise<SignInSettingsClearer> {
    if (
      job.clearedBy !== SignInSettingsClearedBy.ProjectOwner ||
      !job.projectId
    ) {
      return { clearedBy: SignInSettingsClearedBy.ServerAdmin };
    }

    const project: Project | null = await ProjectService.findOneById({
      id: job.projectId,
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      clearedBy: SignInSettingsClearedBy.ProjectOwner,
      projectName: (project?.name || "").toString().trim(),
    };
  }

  /*
   * How the person signs in now, by the rule (SsoManagedSignIn): with
   * single sign-on and its providers while it manages their sign-in, with a
   * new password otherwise. A rule that cannot be read is no reason to
   * hold the email: it then names both ways.
   */
  private static async readSignInNow(userId: ObjectID): Promise<SignInNow> {
    try {
      const management: SignInManagement =
        await SsoManagedSignIn.getSignInManagement(userId);

      return management.isManagedBySso
        ? {
            way: SignInAfterClearing.SingleSignOn,
            ssoProviderNames: management.ssoProviderNames,
          }
        : { way: SignInAfterClearing.ForgotPassword, ssoProviderNames: [] };
    } catch (err) {
      logger.error(
        `Could not read how user ${userId.toString()} signs in for the email saying their sign-in settings were cleared; it names both ways.`,
      );
      logger.error(err);

      return { way: SignInAfterClearing.Unknown, ssoProviderNames: [] };
    }
  }
}
