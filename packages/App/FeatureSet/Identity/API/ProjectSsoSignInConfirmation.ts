import ProjectSsoSignInConfirmation, {
  ProjectSsoConfirmationOutcome,
  ProjectSsoConfirmationResult,
  ProjectSsoKind,
} from "../Utils/ProjectSsoSignInConfirmation";
import LicensedFeatureGate from "../Middleware/LicensedFeatureGate";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * The page a project-SSO confirmation email links to. See
 * ../Utils/ProjectSsoSignInConfirmation.ts for why the email exists.
 *
 *   GET   shows what is being confirmed, behind a button. It writes nothing:
 *         mail scanners open links before people do, so a GET that acted
 *         would be confirmed by the scanner rather than the person.
 *   POST  spends the link: records the consent, accepts or creates the
 *         project memberships, and verifies the address. It still signs
 *         nobody in -- it hands the person back to the provider's own
 *         sign-in, which now goes through.
 *
 * Gated like every other SSO page, so a lapsed license refuses this too.
 */

const router: ExpressRouter = Express.getRouter();

const ssoPageGate: RequestHandler = LicensedFeatureGate.forSsoPage();

export const SSO_SIGN_IN_CONFIRMATION_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/SsoSignInConfirmation.ejs";

const CONFIRMATION_PATH: string =
  "/sso-sign-in-confirmation/:kind/:projectId/:providerId";

type ReadStringFunction = (source: unknown, key: string) => string;

const readString: ReadStringFunction = (
  source: unknown,
  key: string,
): string => {
  const value: unknown = ((source || {}) as JSONObject)[key];

  return typeof value === "string" ? value : "";
};

type RenderPageFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  vars: JSONObject,
) => void;

const renderPage: RenderPageFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  vars: JSONObject,
): void => {
  return Response.render(req, res, SSO_SIGN_IN_CONFIRMATION_VIEW, {
    /*
     * Explicitly off. The URL of this page carries a single-use token, and
     * the whole point of the token is that it reaches nobody but the mailbox
     * owner -- a third-party tag reporting the page URL would break that.
     */
    enableGoogleTagManager: false,
    ...vars,
  });
};

const INVALID_LINK_PAGE: JSONObject = {
  title: "This link is not valid.",
  message:
    "It may already have been used, or the email address on the account may have changed. Sign in with single sign-on again and we will email you a new link.",
};

router.get(
  CONFIRMATION_PATH,
  ssoPageGate,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const kind: string = readString(req.params, "kind");
      const projectId: string = readString(req.params, "projectId");
      const providerId: string = readString(req.params, "providerId");
      const token: string = readString(req.query, "token");
      const signature: string = readString(req.query, "signature");

      /*
       * Checked up front so that a mangled link says so here, rather than
       * after the person has pressed a button. Nothing is looked up or spent.
       */
      if (
        !ProjectSsoSignInConfirmation.isProjectSsoKind(kind) ||
        !ObjectID.isValidUUID(projectId) ||
        !ObjectID.isValidUUID(providerId) ||
        !ObjectID.isValidUUID(token) ||
        !ProjectSsoSignInConfirmation.isSignatureValid({
          token,
          signature,
          kind: kind as ProjectSsoKind,
          projectId,
          providerId,
        })
      ) {
        return renderPage(req, res, INVALID_LINK_PAGE);
      }

      const projectName: string =
        await ProjectSsoSignInConfirmation.getProjectName(
          new ObjectID(projectId),
        );

      return renderPage(req, res, {
        title: "Confirm single sign-on.",
        message: `Allow the single sign-on of the OneUptime project "${projectName}" to sign you in to your OneUptime account? You only need to do this once for this project. If you did not just try to sign in through it, close this page.`,
        formAction: ProjectSsoSignInConfirmation.getConfirmationRoute({
          kind: kind as ProjectSsoKind,
          projectId,
          providerId,
        }).toString(),
        token,
        signature,
        buttonText: "Confirm Sign-In",
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  CONFIRMATION_PATH,
  ssoPageGate,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const kind: string = readString(req.params, "kind");
      const projectId: string = readString(req.params, "projectId");
      const providerId: string = readString(req.params, "providerId");

      const result: ProjectSsoConfirmationResult =
        await ProjectSsoSignInConfirmation.confirm({
          token: readString(req.body, "token"),
          signature: readString(req.body, "signature"),
          kind,
          projectId,
          providerId,
        });

      switch (result.outcome) {
        case ProjectSsoConfirmationOutcome.Confirmed:
          return renderPage(req, res, {
            title: "Single sign-on confirmed.",
            message:
              "This project's single sign-on can now sign you in to OneUptime. Continue to finish signing in.",
            linkUrl: ProjectSsoSignInConfirmation.getSignInStartRoute({
              kind: kind as ProjectSsoKind,
              projectId,
              providerId,
            }).toString(),
            linkText: "Continue to sign in",
          });
        case ProjectSsoConfirmationOutcome.ExpiredLink:
          return renderPage(req, res, {
            title: "This link has expired.",
            message:
              "Sign in with single sign-on again and we will email you a new link.",
          });
        case ProjectSsoConfirmationOutcome.AccountBlocked:
          return renderPage(req, res, {
            title: "Account blocked.",
            message: ExceptionMessages.UserBlocked,
          });
        case ProjectSsoConfirmationOutcome.ProviderUnavailable:
          return renderPage(req, res, {
            title: "Single sign-on is not available.",
            message:
              "This project's single sign-on has been turned off or removed since this email was sent. Please contact your administrator.",
          });
        case ProjectSsoConfirmationOutcome.NoDefaultTeams:
          return renderPage(req, res, {
            title: "No teams added.",
            message:
              "No teams have been added to this SSO config. Please contact your admin and have default teams added.",
          });
        default:
          return renderPage(req, res, INVALID_LINK_PAGE);
      }
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
