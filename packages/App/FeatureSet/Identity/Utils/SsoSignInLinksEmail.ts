import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
  UNKNOWN_DEVICE,
} from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "Common/Server/Utils/ServerTranslation";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { AccountsRoute } from "Common/ServiceRoute";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  EmailedSsoProject,
  getSsoSignInLinksEmailVariables,
  getSsoSignInLinksSubject,
  MAX_EMAILED_SSO_PROJECTS,
} from "Common/Types/Accounts/SsoSignInLinks";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "Common/Types/ReaderLanguage";
import RequestOrigin from "Common/Types/RequestOrigin";
import { getProjectSsoSignInRoute } from "Common/Types/SSO/SignInMethods";
import { translationKey, Translator } from "Common/Types/Translator";
import { getUserWritingLanguage } from "Common/Types/UserLanguage";

/*
 * EMAILING AN ACCOUNT THE SSO SIGN-IN LINKS OF ITS ORGANIZATIONS (#9987).
 *
 * What the email lists, to whom, and why the route answers every address
 * alike, is in Common/Types/Accounts/SsoSignInLinks.ts. This does the work
 * the route never waits for (POST /identity/send-sso-sign-in-links):
 *
 *   - reads the account at the address: none, a blocked one and a OneUptime
 *     administrator's (whom a project's SSO never signs in) are sent
 *     nothing;
 *   - reads the projects it has joined - an invitation not accepted is not
 *     joined: anyone can invite an address, and their own provider would
 *     then reach a stranger in OneUptime's name - and keeps those whose own
 *     SAML or OIDC providers are on;
 *   - emails the account's own address, in the account's own language, the
 *     link of each, when there is one; otherwise nothing.
 *
 * NEVER IN THE ANSWER'S WAY. The route has answered before any of it runs,
 * and nothing here throws: a failure is logged, by the account's id and
 * never by its address. The requests go one after another, so a burst of
 * them hands the database and the mail service one at a time, and at most
 * MAX_WAITING wait at once: past that one is dropped and logged, which the
 * answer - the same for every address - does not say.
 */

// How long one email may take to reach the mail service before it is given up.
export const SSO_SIGN_IN_LINKS_EMAIL_TIMEOUT_IN_MS: number = 30 * 1000;

// The most requests that wait their turn at once.
export const MAX_WAITING_SSO_SIGN_IN_LINKS_EMAILS: number = 1000;

export interface SsoSignInLinksRequest {
  // The address the request named: the only one ever emailed.
  email: Email;
  // Where the request came from, for the email's rows.
  origin?: RequestOrigin | undefined;
  // When it was asked for.
  at?: Date | undefined;
}

// What happened to one request, for the tests and the log.
export enum SsoSignInLinksOutcome {
  Sent = "sent",
  // No account at the address, or one a project's SSO cannot sign in.
  NoAccount = "no-account",
  // An account in no project whose own SSO providers are on.
  NoSsoProject = "no-sso-project",
  NotSent = "not-sent",
}

export default class SsoSignInLinksEmail {
  private static queue: Promise<void> = Promise.resolve();
  private static waiting: number = 0;

  /*
   * Queues the work for one request, behind any still going. Never
   * rejects; the promise is for tests - the route does not wait for it.
   */
  public static sendInBackground(
    request: SsoSignInLinksRequest,
  ): Promise<void> {
    if (SsoSignInLinksEmail.waiting >= MAX_WAITING_SSO_SIGN_IN_LINKS_EMAILS) {
      logger.warn(
        `Too many SSO sign-in link emails are waiting (${MAX_WAITING_SSO_SIGN_IN_LINKS_EMAILS}); one request was dropped.`,
      );

      return Promise.resolve();
    }

    SsoSignInLinksEmail.waiting += 1;

    const sent: Promise<void> = SsoSignInLinksEmail.queue.then(
      async (): Promise<void> => {
        try {
          await SsoSignInLinksEmail.send(request);
        } finally {
          SsoSignInLinksEmail.waiting -= 1;
        }
      },
    );

    // Nothing above rejects, but a queue that did would stop every request after it.
    SsoSignInLinksEmail.queue = sent.catch((): void => {
      // Each request logs its own failure.
    });

    return SsoSignInLinksEmail.queue;
  }

  // One request's work, start to end. Never throws.
  public static async send(
    request: SsoSignInLinksRequest,
  ): Promise<SsoSignInLinksOutcome> {
    let userId: ObjectID | undefined = undefined;

    try {
      const account: User | null = await SsoSignInLinksEmail.findAccount(
        request.email,
      );

      if (!account || !account.id || !account.email) {
        return SsoSignInLinksOutcome.NoAccount;
      }

      userId = account.id;

      const projects: Array<EmailedSsoProject> =
        await SsoSignInLinksEmail.findProjects(account.id);

      if (projects.length === 0) {
        return SsoSignInLinksOutcome.NoSsoProject;
      }

      return (await SsoSignInLinksEmail.sendTo({
        account: account,
        projects: projects,
        request: request,
      }))
        ? SsoSignInLinksOutcome.Sent
        : SsoSignInLinksOutcome.NotSent;
    } catch (err) {
      logger.error(
        userId
          ? `The SSO sign-in links were not emailed to user ${userId.toString()}.`
          : "The SSO sign-in links were not emailed: the account could not be read.",
      );
      logger.error(err);

      return SsoSignInLinksOutcome.NotSent;
    }
  }

  /*
   * The account at the address, if a project's SSO could sign it in: not
   * blocked, and not a OneUptime administrator's.
   */
  public static async findAccount(email: Email): Promise<User | null> {
    const account: User | null = await UserService.findOneBy({
      query: {
        email: email,
      },
      select: {
        _id: true,
        email: true,
        isBlocked: true,
        isMasterAdmin: true,
        timezone: true,
        language: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!account || account.isBlocked || account.isMasterAdmin === true) {
      return null;
    }

    return account;
  }

  /*
   * The projects the account has joined that have an own SAML or OIDC
   * provider that is on, by name, each with its SSO sign-in link.
   */
  public static async findProjects(
    userId: ObjectID,
  ): Promise<Array<EmailedSsoProject>> {
    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: userId,
        hasAcceptedInvitation: true,
      },
      select: {
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Array<ObjectID> = SsoSignInLinksEmail.distinctIds(
      memberships.map((membership: TeamMember): ObjectID | undefined => {
        return membership.projectId;
      }),
    );

    if (projectIds.length === 0) {
      return [];
    }

    const [samlProviders, oidcProviders]: [
      Array<ProjectSSO>,
      Array<ProjectOIDC>,
    ] = await Promise.all([
      ProjectSSOService.findBy({
        query: {
          projectId: QueryHelper.any(projectIds),
          isEnabled: true,
        },
        select: {
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      ProjectOidcService.findBy({
        query: {
          projectId: QueryHelper.any(projectIds),
          isEnabled: true,
        },
        select: {
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    ]);

    // The projects with a provider of their own that is on.
    const withSso: Set<string> = new Set<string>();

    for (const provider of [...samlProviders, ...oidcProviders]) {
      if (provider.projectId) {
        withSso.add(provider.projectId.toString().toLowerCase());
      }
    }

    if (withSso.size === 0) {
      return [];
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(
          projectIds.filter((projectId: ObjectID): boolean => {
            return withSso.has(projectId.toString().toLowerCase());
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: MAX_EMAILED_SSO_PROJECTS,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return projects
      .filter((project: Project): boolean => {
        return Boolean(project.id);
      })
      .map((project: Project): EmailedSsoProject => {
        return {
          projectName: project.name || "",
          signInUrl: new URL(
            httpProtocol,
            host,
            new Route(AccountsRoute.toString()).addRoute(
              getProjectSsoSignInRoute(project.id!),
            ),
          ).toString(),
        };
      });
  }

  /*
   * The email itself: to the account's own address, in its language, with
   * the time in its time zone. True once the mail service has taken it.
   */
  private static async sendTo(data: {
    account: User;
    projects: Array<EmailedSsoProject>;
    request: SsoSignInLinksRequest;
  }): Promise<boolean> {
    const language: string = getUserWritingLanguage(data.account);
    const productName: string = ProductBrandingText.getProductName();

    // The subject, the time and the device in the reader's language, as one piece of work.
    const written: { subject: string; origin: RequestOriginEmailVars } =
      writeInLanguage(
        language,
        (
          translator: Translator,
        ): { subject: string; origin: RequestOriginEmailVars } => {
          const origin: RequestOriginEmailVars = RequestOriginUtil.getEmailVars(
            {
              origin: data.request.origin,
              at: data.request.at,
              timezone: data.account.timezone,
            },
          );

          return {
            subject: getSsoSignInLinksSubject(translator, productName),
            origin: {
              ...origin,
              // The one device name that is OneUptime's own words.
              requestDevice:
                origin.requestDevice === UNKNOWN_DEVICE
                  ? translator.translateText(
                      translationKey("Unknown device"),
                    ) || UNKNOWN_DEVICE
                  : origin.requestDevice,
            },
          };
        },
      );

    const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
      await MailService.sendMail(
        {
          toEmail: data.account.email!,
          subject: written.subject,
          isSubjectLiteral: true,
          templateType: EmailTemplateType.SsoSignInLinks,
          vars: getSsoSignInLinksEmailVariables({
            productName: productName,
            projects: data.projects,
            requestedAt: written.origin.requestedAt,
            requestIpAddress: written.origin.requestIpAddress,
            requestLocation: written.origin.requestLocation,
            requestDevice: written.origin.requestDevice,
          }),
          ...(language === DEFAULT_READER_LANGUAGE
            ? {}
            : { language: language }),
        },
        {
          userId: data.account.id!,
          timeoutInMs: SSO_SIGN_IN_LINKS_EMAIL_TIMEOUT_IN_MS,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      logger.error(
        `The SSO sign-in links were not emailed to user ${data.account.id!.toString()}: the mail service refused them (${response.statusCode}).`,
      );
      return false;
    }

    return true;
  }

  // Each id once, in the order first met.
  private static distinctIds(
    ids: Array<ObjectID | undefined>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const kept: Array<ObjectID> = [];

    for (const id of ids) {
      if (!id) {
        continue;
      }

      const key: string = id.toString().toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        kept.push(id);
      }
    }

    return kept;
  }

  // Test-only: forget the queue and what waits in it.
  public static resetForTests(): void {
    SsoSignInLinksEmail.queue = Promise.resolve();
    SsoSignInLinksEmail.waiting = 0;
  }

  // Test-only: resolves once every request queued so far has run.
  public static waitForQueueForTests(): Promise<void> {
    return SsoSignInLinksEmail.queue;
  }
}
