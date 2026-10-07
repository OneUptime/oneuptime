import { DashboardClientUrl } from "../EnvironmentConfig";
import CallerPlan from "../Utils/Billing/CallerPlan";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import { WorkspaceOAuthStateRecord } from "../Utils/Workspace/WorkspaceOAuthState";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import {
  CONNECT_ERROR_QUERY_PARAM,
  CONNECT_PROVIDER_QUERY_PARAM,
  ConnectCallbackError,
  ConnectProvider,
  ConnectStartPage,
} from "../../Types/Workspace/ConnectCallback";

/*
 * HOW A CONNECT CALLBACK ANSWERS.
 *
 * Connecting Slack (installing the app, signing in), Microsoft Teams (admin
 * consent, signing in) or a GitHub App installation ends on a callback the
 * provider sends the browser to. Every one of them is registered through
 * ConnectCallback.route, which runs it in one order and answers every way it
 * can end the same way:
 *
 *  1. Spend the one-use state the start recorded (WorkspaceOAuthState). The
 *     project and the person come from it alone. A state that cannot be spent
 *     is answered on the Dashboard's connect-return page, which opens the
 *     provider's page in the project the person has open: nothing in the
 *     redirect may choose a project.
 *  2. Ask the start's question again, of the person the state names, as they
 *     are now (WorkspaceOAuthCallbackAccess, GitHubConnectAccess).
 *  3. Finish: talk to the provider and write.
 *
 * However it ends, the browser is sent back to the page the connection
 * started from (the project's settings, the person's own settings, or Code
 * Repositories), with nothing added when the connection was made and with
 * `?error=` and a code (Types/Workspace/ConnectCallback) when it was not. The
 * page shows its own sentence for the code. So:
 *
 *  - every request is answered: Express 4 does not catch an async handler's
 *    rejection, so a callback that threw - a token exchange answered with an
 *    HTTPErrorResponse, a read or a write that failed, something thrown that
 *    is not even an Error - used to leave the browser with no answer at all;
 *  - nothing a provider or a failed read said reaches the browser: a refusal
 *    is a code, anything else is "could not finish", and the details are
 *    logged here;
 *  - a refusal is shown where the person can act on it, with the page's
 *    Connect button right there, instead of on a bare JSON error page.
 *
 * Tests/Server/API/ConnectCallbacksAnswer drives every callback through each
 * of these; Tests/Server/API/ConnectCallbacksAskAgain keeps every route that
 * spends a state on ConnectCallback.route.
 */

/*
 * A refusal a callback answers on its page with `code`: something it was told
 * or found that ends the connection. `reason` is for the log only.
 */
export class ConnectCallbackRefusal extends Error {
  public readonly code: ConnectCallbackError;

  public constructor(code: ConnectCallbackError, reason?: string | undefined) {
    super(reason || code);
    this.name = "ConnectCallbackRefusal";
    this.code = code;
  }
}

// What a callback's last step is handed.
export interface ConnectCallbackFinish {
  req: ExpressRequest;
  res: ExpressResponse;
  // The spent state: the project, the person, the page it started from.
  record: WorkspaceOAuthStateRecord;
  /*
   * Sends the browser back to the page the connection started from, the
   * connection made, with `params` for the page (each value encoded).
   */
  backToPage: (params?: Dictionary<string> | undefined) => void;
}

export interface ConnectCallbackSpec {
  provider: ConnectProvider;
  /*
   * Spends the one-use state the provider handed back, for this callback's
   * flows only. Null when it cannot be spent.
   */
  spendState: (
    req: ExpressRequest,
  ) => Promise<WorkspaceOAuthStateRecord | null>;
  /*
   * The start's question, asked again of the person the state names, as they
   * are now. Throws when the answer is no.
   */
  askAgain: (record: WorkspaceOAuthStateRecord) => Promise<void>;
  /*
   * What the page is told when that question is refused: that they may not
   * make this connection, or - for a flow that only asks membership - that
   * they are not a member.
   */
  refusedAs:
    | ConnectCallbackError.NoPermission
    | ConnectCallbackError.NotAMember;
  /*
   * A redirect the provider sends on its own rather than one OneUptime
   * started - GitHub's "Redirect on update" after an installation is changed
   * on GitHub - which carries no state and asks for nothing: the browser is
   * sent to the provider's page, with nothing to refuse.
   */
  isProviderRedirect?: ((req: ExpressRequest) => boolean) | undefined;
  finish: (data: ConnectCallbackFinish) => Promise<void>;
}

export default class ConnectCallback {
  // The Dashboard page that opens a provider's page in the current project.
  public static readonly CONNECT_RETURN_PATH: string = "/connect-return";

  /*
   * The handler a connect callback is registered with. It never throws and
   * always answers.
   */
  public static route(
    spec: ConnectCallbackSpec,
  ): (req: ExpressRequest, res: ExpressResponse) => Promise<void> {
    return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      let record: WorkspaceOAuthStateRecord | null = null;

      try {
        if (spec.isProviderRedirect && spec.isProviderRedirect(req)) {
          return Response.redirect(
            req,
            res,
            ConnectCallback.getConnectReturnUrl(spec.provider),
          );
        }

        record = await spec.spendState(req);

        if (!record) {
          throw new ConnectCallbackRefusal(
            ConnectCallbackError.LinkInvalid,
            "The connection state is unknown, expired, already used, issued for another flow, or brought back by another browser.",
          );
        }

        const startedRecord: WorkspaceOAuthStateRecord = record;

        try {
          await spec.askAgain(startedRecord);
        } catch (refusal) {
          throw ConnectCallback.refusalOfQuestion(refusal, spec.refusedAs);
        }

        await spec.finish({
          req,
          res,
          record: startedRecord,
          backToPage: (params?: Dictionary<string> | undefined): void => {
            const pageUrl: URL = ConnectCallback.getPageUrl({
              provider: spec.provider,
              record: startedRecord,
            });

            for (const [name, value] of Object.entries(params || {})) {
              pageUrl.addQueryParam(name, value, true);
            }

            Response.redirect(req, res, pageUrl);
          },
        });
      } catch (error) {
        ConnectCallback.answer({
          req,
          res,
          provider: spec.provider,
          record,
          error,
        });
      }
    };
  }

  /*
   * The code `error` is answered with: a refusal's own, and "could not
   * finish" for anything else - an Exception that is not a refusal, an
   * HTTPErrorResponse, something that is not even an Error. Never its text.
   */
  public static codeFor(error: unknown): ConnectCallbackError {
    return error instanceof ConnectCallbackRefusal
      ? error.code
      : ConnectCallbackError.CouldNotFinish;
  }

  /*
   * What the start's question being asked again and refused means for the
   * page. A plan refusal is the plan; any other authorization refusal is the
   * callback's own (no permission, or not a member), except a plan that
   * could not be read, which is no refusal of the person. Anything else -
   * a read that failed - is not a refusal at all.
   */
  public static refusalOfQuestion(
    refusal: unknown,
    refusedAs: ConnectCallbackError,
  ): unknown {
    if (refusal instanceof PaymentRequiredException) {
      return new ConnectCallbackRefusal(
        ConnectCallbackError.PlanRequired,
        refusal.message,
      );
    }

    if (
      refusal instanceof NotAuthorizedException &&
      refusal.message !== CallerPlan.PLAN_UNKNOWN_MESSAGE
    ) {
      return new ConnectCallbackRefusal(refusedAs, refusal.message);
    }

    return refusal;
  }

  /*
   * What a provider's own `?error=` means: the person cancelled, or did not
   * allow it (`access_denied`, the OAuth code for both), or anything else.
   * Null when there is none. What the provider said is for the log only.
   */
  public static refusalOfProviderError(
    req: ExpressRequest,
  ): ConnectCallbackRefusal | null {
    const error: string | undefined = req.query["error"]?.toString();

    if (!error) {
      return null;
    }

    const description: string | undefined =
      req.query["error_description"]?.toString();

    return new ConnectCallbackRefusal(
      error === "access_denied"
        ? ConnectCallbackError.Cancelled
        : ConnectCallbackError.CouldNotFinish,
      `The provider answered with an error: ${error}${
        description ? ` (${description})` : ""
      }`,
    );
  }

  /*
   * The page a connection to `provider` started from, in the state's project:
   * Slack and Microsoft Teams in the project's settings, or the person's own
   * settings when it was started there; GitHub on Code Repositories.
   */
  public static getPageUrl(data: {
    provider: ConnectProvider;
    record: Pick<WorkspaceOAuthStateRecord, "projectId" | "startPage">;
  }): URL {
    return URL.fromString(
      `${DashboardClientUrl.toString()}/${data.record.projectId.toString()}${ConnectCallback.getPagePath(
        data.provider,
        data.record.startPage,
      )}`,
    );
  }

  /*
   * Where the browser goes when no project can be trusted: the Dashboard's
   * connect-return page, which opens `provider`'s page in the project the
   * person has open.
   */
  public static getConnectReturnUrl(provider: ConnectProvider): URL {
    return URL.fromString(
      `${DashboardClientUrl.toString()}${ConnectCallback.CONNECT_RETURN_PATH}`,
    ).addQueryParam(CONNECT_PROVIDER_QUERY_PARAM, provider, true);
  }

  private static getPagePath(
    provider: ConnectProvider,
    startPage: ConnectStartPage,
  ): string {
    const settings: string =
      startPage === ConnectStartPage.UserSettings
        ? "/user-settings"
        : "/settings";

    switch (provider) {
      case ConnectProvider.Slack:
        return `${settings}/slack-integration`;
      case ConnectProvider.MicrosoftTeams:
        return `${settings}/microsoft-teams-integration`;
      case ConnectProvider.GitHub:
        return "/code-repository";
    }
  }

  /*
   * The answer to a callback that did not finish: logged here, and the
   * browser sent to the page with the code. A response already on its way
   * is left alone, and should even the redirect fail, a plain sentence still
   * answers.
   */
  private static answer(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    provider: ConnectProvider;
    record: WorkspaceOAuthStateRecord | null;
    error: unknown;
  }): void {
    const { req, res } = data;
    const code: ConnectCallbackError = ConnectCallback.codeFor(data.error);

    if (data.error instanceof ConnectCallbackRefusal) {
      logger.info(
        `${data.provider} connect callback refused (${code}): ${data.error.message}`,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );
    } else {
      logger.error(
        `${data.provider} connect callback could not finish:`,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );
      logger.error(
        data.error,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );
    }

    if (res.headersSent) {
      return;
    }

    try {
      const pageUrl: URL = data.record
        ? ConnectCallback.getPageUrl({
            provider: data.provider,
            record: data.record,
          })
        : ConnectCallback.getConnectReturnUrl(data.provider);

      Response.redirect(
        req,
        res,
        pageUrl.addQueryParam(CONNECT_ERROR_QUERY_PARAM, code, true),
      );
    } catch (redirectError) {
      logger.error(
        redirectError,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );

      if (!res.headersSent) {
        res.status(500).send({
          message: "OneUptime could not finish connecting. Please try again.",
        });
      }
    }
  }
}
