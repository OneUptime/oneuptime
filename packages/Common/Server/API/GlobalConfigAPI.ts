import GlobalConfigService, {
  Service as GlobalConfigServiceType,
} from "../Services/GlobalConfigService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import CallAndSmsGatewayTest, {
  CallAndSmsGatewayTestResult,
} from "../Utils/CallAndSmsGatewayTest";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import ServerEmailLogReader from "../Utils/ServerSending/ServerEmailLogReader";
import { ServerEmailLogAnswer } from "../../Types/Email/ServerEmailLog";
import { SERVER_CHANNEL_SETUP_SELECT } from "../Utils/ServerSending/ServerChannelSetup";
import { getServerTwilioEnvironment } from "../Utils/ServerTwilioConfig";
import ServerTwilioEnvironment, {
  ServerTwilioEnvironmentAnswer,
} from "../../Types/CallAndSMS/ServerTwilioEnvironment";
import { getServerEmailEnvironment } from "../Utils/ServerEmailSettings";
import ServerEmailEnvironment, {
  ServerEmailEnvironmentAnswer,
} from "../../Types/Email/ServerEmailEnvironment";
import { ServerSendingStatusAnswer } from "../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklist from "../Utils/ServerSetup/ServerSetupChecklist";
import ServerSetupChecklistUtil, {
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
} from "../../Types/ServerSetup/ServerSetupChecklist";
import BadDataException from "../../Types/Exception/BadDataException";
import ServerProducts from "../Utils/ServerProducts/ServerProducts";
import {
  SERVER_PRODUCTS_ROUTE,
  toServerProductsAnswerJSON,
} from "../../Types/Product/ServerProductsAnswer";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import {
  MASTER_API_KEY_ROUTE,
  toMasterApiKeyStateJSON,
} from "../../Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Select from "../Types/Database/Select";
import {
  AppVersion,
  DisableUpdateCheck,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import SecurityAdvisoryMatcher from "../../Utils/SecurityAdvisoryMatcher";
import UpdateStatusUtil from "../../Types/UpdateCheck/UpdateStatus";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
} from "../../Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import VersionUtil from "../../Utils/VersionUtil";
import UserMiddleware, {
  RequestSession,
} from "../Middleware/UserAuthorization";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import UserSessionService from "../Services/UserSessionService";
import SsoRequiredSignIn from "../Utils/SsoRequiredSignIn";
import LocalSignInClearing from "../Utils/LocalSignInClearing";
import {
  ClearSavedSignInSettingsAnswer,
  SavedSignInSettingsAnswer,
} from "../../Types/SSO/LocalSignInClearing";
import logger from "../Utils/Logger";
import {
  EndSessionsWithoutSsoAnswer,
  SessionsWithoutSsoAnswer,
  SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
} from "../../Types/SSO/SessionsWithoutSso";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  SeatUsage,
} from "../Enterprise/EnterpriseLicenseSnapshot";
import ResolvedRecordRetention from "../Utils/Retention/ResolvedRecordRetention";
import {
  ResolvedRecordKind,
  readResolvedRecordRetentionMaximumInDays,
} from "../../Types/Retention/ResolvedRecordRetention";
import { RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE } from "../../Types/Retention/ResolvedRecordRetentionAnswers";

/*
 * Who is asking for the license state, which decides how much of it they get.
 *
 *   master-admin  everything, including the license key, the token, the
 *                 instance topology, this installation's version and seat
 *                 usage - the things a master admin needs to manage the
 *                 license and nobody else has any business reading.
 *   public        anybody else, signed in or not (this route also serves the
 *                 signed-out login page): only what the edition pill shows.
 */
export type LicenseResponseAudience = "master-admin" | "public";

export interface BuildLicenseResponseData {
  audience: LicenseResponseAudience;
  // Whether the enterprise module is loaded in this process.
  isEnterpriseEditionLoaded: boolean;
  // The license snapshot, or null on the Community Edition.
  snapshot: EnterpriseLicenseSnapshot | null;
  /*
   * The GlobalConfig row, selected with LICENSE_RESPONSE_CONFIG_SELECT. Only
   * read for the master-admin audience.
   */
  config: GlobalConfig | null;
  // Seat usage as the license client enforces it. Only for master admins.
  seatUsage: SeatUsage | null;
}

// Everything buildLicenseResponse reads off the GlobalConfig row.
export const LICENSE_RESPONSE_CONFIG_SELECT: Select<GlobalConfig> = {
  enterpriseLicenseKey: true,
  enterpriseLicenseToken: true,
  enterpriseLicenseCurrentUserCount: true,
  enterpriseLicenseUserCountUpdatedAt: true,
  enterpriseLicenseInstances: true,
  enterpriseMarketplaceBilling: true,
  instanceId: true,
  latestReleaseVersion: true,
  latestReleasePublishedAt: true,
  latestReleaseCheckedAt: true,
};

// Everything buildUpdateStatusResponse reads off the GlobalConfig row.
export const UPDATE_STATUS_CONFIG_SELECT: Select<GlobalConfig> = {
  latestReleaseVersion: true,
  latestReleasePublishedAt: true,
  latestReleaseCheckedAt: true,
  securityAdvisories: true,
  securityAdvisoriesCheckedAt: true,
  updateCheckLastAttemptAt: true,
  updateCheckLastFailure: true,
};

export default class GlobalConfigAPI extends BaseAPI<
  GlobalConfig,
  GlobalConfigServiceType
> {
  public constructor() {
    super(GlobalConfig, GlobalConfigService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/vars`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                disableUserProjectCreation: true,
                disablePushNotifications: true,
                // Whether the server can send email: read, never sent on.
                ...SERVER_CHANNEL_SETUP_SELECT,
                serverSendingHealth: true,
              },
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            GlobalConfigAPI.buildVarsResponse(globalConfig),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * GET /global-config/sending-status - whether this server can send
     * email, SMS, calls and push notifications (ServerSendingStatus): each
     * channel's state, since when it fails and why, what its settings are
     * missing, and whether the server's global probes report. The banner in
     * the Dashboard and the Admin Dashboard reads it.
     *
     * Master admins only: why a mail server refuses mail, and that a server
     * is not finished, are its admins' business. Anybody else reads only
     * GET /global-config/vars' canSendEmail.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/sending-status`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const answer: ServerSendingStatusAnswer =
            await ServerSendingStatus.getAnswer();

          return Response.sendJsonObjectResponse(
            req,
            res,
            JSON.parse(JSON.stringify(answer)) as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/email-log - the server's own email log (#6878,
     * Types/Email/ServerEmailLog): one page of it, newest first, every
     * email or the failed ones only. Master admins only - whom an email
     * went to is personal data - and never cached.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/email-log`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const answer: ServerEmailLogAnswer = await ServerEmailLogReader.read(
            ServerEmailLogReader.readQuery(
              (req.query || {}) as { [name: string]: unknown },
            ),
          );

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/sessions-without-sso - how many people, master
     * admins left out, are signed in without single sign-on (Types/SSO/
     * SessionsWithoutSso): what the Require SSO card says while the server
     * requires SSO, before it offers to sign them out. Master admins only.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/sessions-without-sso`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const answer: SessionsWithoutSsoAnswer = {
            peopleCount:
              await UserSessionService.countPeopleSignedInWithoutSso(),
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/sessions-without-sso/end - a master admin signing
     * out everyone who signed in without single sign-on: every such session
     * of everyone but master admins ends on the server, its refresh token
     * with it (UserSessionService.endSessionsSignedInWithoutSso). Refused
     * while the server does not require SSO, when they would sign in again
     * with their password at once. A read of the rule that fails refuses
     * too. Master admins only.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/sessions-without-sso/end`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!(await SsoRequiredSignIn.isSsoRequired())) {
            throw new BadDataException(
              SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
            );
          }

          const answer: EndSessionsWithoutSsoAnswer = {
            sessionsEnded:
              await UserSessionService.endSessionsSignedInWithoutSso(),
          };

          logger.info(
            `A master admin signed out everyone signed in without SSO: ${answer.sessionsEnded} session(s) ended.`,
          );

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/saved-sign-in-settings - how many people the
     * server's SSO requirement covers, master admins left out, still have a
     * password, passkey, security key, authenticator app, backup codes or
     * two-factor authentication saved (Types/SSO/LocalSignInClearing,
     * #9762): what the Require SSO card says while the server requires
     * SSO, before it offers to clear them. Master admins only.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/saved-sign-in-settings`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const answer: SavedSignInSettingsAnswer = {
            peopleCount:
              await LocalSignInClearing.countPeopleCoveredBySsoRequirement(),
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/saved-sign-in-settings/clear - a master admin
     * clearing those settings for everyone the server's SSO requirement
     * covers (LocalSignInClearing.clearForEveryoneCoveredBySsoRequirement):
     * never a master admin's, each person recorded in their projects' audit
     * logs. Refused while the server does not require SSO, when the
     * settings still sign people in; a read of the rule that fails refuses
     * too. It cannot be undone, and the card asks first. Master admins
     * only, by session: the master admin is the session's own person.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/saved-sign-in-settings/clear`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * The master admin as their session names them: the middleware
           * read the session, and sets no userAuthorization for a handler
           * to read.
           */
          const clearedByUserId: ObjectID | null =
            await GlobalConfigAPI.getSessionUserId(req);

          if (!clearedByUserId) {
            throw new NotAuthenticatedException(
              "Sign in as a master admin to clear people's sign-in settings.",
            );
          }

          const answer: ClearSavedSignInSettingsAnswer = {
            peopleCleared:
              await LocalSignInClearing.clearForEveryoneCoveredBySsoRequirement(
                {
                  clearedByUserId: clearedByUserId,
                },
              ),
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/setup-checklist - what this server still needs
     * (ServerSetupChecklist, #6824): every check of the setup checklist,
     * worked out from the server's real state - email, HTTPS, sign-ups, SMS
     * and calls, probes, backups, update checks, browser push, AI and single
     * sign-on - with what each was checked against, what an admin chose,
     * and whether the asking admin hid the card. The Admin Dashboard's
     * Server setup page and the Dashboard's card read it.
     *
     * Master admins only, or the server's master API key (read-only, so the
     * command line - `npm run doctor`, #6826 - can ask it too): a mail
     * server's name and why it refuses mail are the server's admins'
     * business.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/setup-checklist`,
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const answer: ServerSetupChecklistAnswer =
            await ServerSetupChecklist.getAnswer({
              readerUserId: await GlobalConfigAPI.getSessionUserId(req),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            JSON.parse(JSON.stringify(answer)) as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/setup-checklist/choice - a master admin making, or
     * undoing ({ choice: null }), the one choice a check allows: "We will use
     * email and push only", "Keep sign-ups open", "Not needed" for probes and
     * update checks, "This server is backed up". Kept with who chose it and
     * when. Answers the checklist as it now stands.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/setup-checklist/choice`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = (req.body || {}) as JSONObject;
          const check: unknown = body["check"];
          const choice: unknown = body["choice"];

          if (!ServerSetupChecklistUtil.isCheckId(check)) {
            throw new BadDataException("Unknown setup checklist check.");
          }

          const allowed: ServerSetupChoiceKind | null =
            ServerSetupChecklistUtil.getDefinition(check).choice;

          if (choice !== null && (!allowed || choice !== allowed)) {
            throw new BadDataException(
              "This choice cannot be made for this check.",
            );
          }

          const userId: ObjectID | null =
            await GlobalConfigAPI.getSessionUserId(req);

          await ServerSetupChecklist.choose({
            check: check,
            kind: choice as ServerSetupChoiceKind | null,
            byUserId: userId,
          });

          const answer: ServerSetupChecklistAnswer =
            await ServerSetupChecklist.getAnswer({ readerUserId: userId });

          return Response.sendJsonObjectResponse(
            req,
            res,
            JSON.parse(JSON.stringify(answer)) as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/setup-checklist/hide - a master admin hiding the
     * setup card from the Dashboard, in every browser they use, until a
     * required check opens that is not open now. Nobody else's card changes.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/setup-checklist/hide`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID | null =
            await GlobalConfigAPI.getSessionUserId(req);

          if (!userId) {
            throw new BadDataException("Sign in to hide the setup checklist.");
          }

          await ServerSetupChecklist.hideFor(userId);

          const answer: ServerSetupChecklistAnswer =
            await ServerSetupChecklist.getAnswer({ readerUserId: userId });

          return Response.sendJsonObjectResponse(
            req,
            res,
            JSON.parse(JSON.stringify(answer)) as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/server-products - Admin Dashboard > Settings >
     * Products (#6815): what is off on this server and why, the preset the
     * switches match, and where they come from (Types/Product/
     * ServerProductsAnswer). Master admins, or the server's master API key
     * (read-only), as the setup checklist.
     */
    this.router.get(
      SERVER_PRODUCTS_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          return Response.sendJsonObjectResponse(
            req,
            res,
            toServerProductsAnswerJSON(await ServerProducts.getAnswer()),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/server-products - a master admin applying a
     * preset ({ preset }) or one switch ({ product, isOn }), for every
     * project on the server. Kept with who changed it and when. Answers the
     * page as it now stands.
     */
    this.router.post(
      SERVER_PRODUCTS_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};
          const userId: ObjectID | null =
            await GlobalConfigAPI.getSessionUserId(req);

          if (body["preset"] !== undefined) {
            await ServerProducts.applyPreset({
              preset: body["preset"],
              byUserId: userId,
            });
          } else {
            await ServerProducts.switchProduct({
              product: body["product"],
              isOn: body["isOn"],
              byUserId: userId,
            });
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            toServerProductsAnswerJSON(await ServerProducts.getAnswer()),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/resolved-record-retention/projects-reached?kind=
     * Incident&maximumInDays=365 - Admin Dashboard > Settings > Data
     * Retention (issue #6941): how many live projects that server maximum
     * holds to a shorter length than they keep resolved incidents (alerts)
     * for now - set to Never, or to longer - so the question asked before
     * it is saved says how far it reaches. Master admins only.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/${RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE}`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const kind: unknown = req.query["kind"];
          const maximumInDays: number | undefined =
            readResolvedRecordRetentionMaximumInDays(
              req.query["maximumInDays"],
            );

          if (
            (kind !== ResolvedRecordKind.Incident &&
              kind !== ResolvedRecordKind.Alert) ||
            maximumInDays === undefined
          ) {
            throw new BadDataException(
              "Say which maximum to count projects for: the kind (Incident or Alert) and a maximum in days, one of the retention choices.",
            );
          }

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            count: await ResolvedRecordRetention.countProjectsReachedByMaximum({
              kind: kind,
              maximumInDays: maximumInDays,
            }),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/call-and-sms-gateway/test - a master admin trying
     * the server's SMS and call gateway as saved (Admin Dashboard >
     * Settings > Call and SMS): one request to it, to nobody, from the
     * Notification service (CallAndSmsGatewayTest). Answers how it went,
     * delivered or not, as a custom channel's test does.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/call-and-sms-gateway/test`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const result: CallAndSmsGatewayTestResult =
            await CallAndSmsGatewayTest.send();

          return Response.sendJsonObjectResponse(req, res, {
            ok: result.ok,
            responseStatusCode: result.statusCode || null,
            statusMessage: result.message,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/master-api-key - whether the server has a master
     * API key, and whether it is on (Admin Dashboard > Settings > API
     * Key). Never the key, nor its hash: the key is stored hashed (#7901)
     * and shown once, when it is made.
     *
     * A signed-in master admin, as the page is theirs.
     */
    this.router.get(
      MASTER_API_KEY_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          return Response.sendJsonObjectResponse(
            req,
            res,
            toMasterApiKeyStateJSON(
              await GlobalConfigService.getMasterApiKeyState(),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /global-config/master-api-key - a master admin making the
     * server's master API key: a new one, in place of the one before, which
     * stops working at once, turned on (GlobalConfigService.
     * createMasterApiKey). The answer holds the key, the one time it is
     * ever sent: only its hash is kept, so the page shows it once, and no
     * cache may keep the answer.
     *
     * A signed-in master admin only, never the master API key: a key that
     * leaked must not be able to replace itself and lock its admins out.
     * The page says afterwards that they made it, and when (#8903).
     */
    this.router.post(
      MASTER_API_KEY_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const masterApiKey: string =
            await GlobalConfigService.createMasterApiKey({
              createdByUserId: await GlobalConfigAPI.getSessionUserId(req),
            });

          res.setHeader("Cache-Control", "no-store");

          return Response.sendJsonObjectResponse(req, res, {
            ...toMasterApiKeyStateJSON(
              await GlobalConfigService.getMasterApiKeyState(),
            ),
            masterApiKey: masterApiKey,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/twilio-environment - whether the GLOBAL_TWILIO_
     * environment variables set the server's Twilio account (#7515), the
     * account they set, and what is wrong with them
     * (Types/CallAndSMS/ServerTwilioEnvironment). Admin Dashboard >
     * Settings > Call and SMS shows it in place of the saved account, with
     * no Edit button. Never the auth token: only whether there is one.
     *
     * Master admins only, as the saved account is theirs to read.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/twilio-environment`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const answer: ServerTwilioEnvironmentAnswer =
            ServerTwilioEnvironment.toAnswer(getServerTwilioEnvironment());

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/email-environment - whether the GLOBAL_EMAIL_
     * environment variables set the server's email settings (#7738), the
     * settings they set, and what is wrong with them
     * (Types/Email/ServerEmailEnvironment). Admin Dashboard > Settings >
     * Emails shows them in place of the saved settings, with no Edit
     * button. Never a password or a key: only whether each is set.
     *
     * Master admins only, as the saved settings are theirs to read.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/email-environment`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const answer: ServerEmailEnvironmentAnswer =
            ServerEmailEnvironment.toAnswer(getServerEmailEnvironment());

          return Response.sendJsonObjectResponse(
            req,
            res,
            answer as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * GET /global-config/update-status - whether this installation should be
     * upgraded, and why: a newer release, or a published security advisory
     * that affects the version it runs, with the release that fixes it. The
     * Dashboard's and the Admin Dashboard's footers and the Admin
     * Dashboard's security notice draw it; no browser asks GitHub.
     *
     * Master admins only. They are the ones who can upgrade, and telling
     * anybody else that this server runs a version with a known security
     * issue advertises an unpatched target. On OneUptime Cloud it says
     * nothing: Cloud is not told to upgrade itself.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/update-status`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const config: GlobalConfig | null = IsBillingEnabled
            ? null
            : await GlobalConfigService.findOneById({
                id: ObjectID.getZeroObjectID(),
                select: UPDATE_STATUS_CONFIG_SELECT,
                props: {
                  isRoot: true,
                },
              });

          return Response.sendJsonObjectResponse(
            req,
            res,
            GlobalConfigAPI.buildUpdateStatusResponse(config),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The license state of this installation, for the edition pill, its
     * read-only dialog and the Admin Dashboard's license page.
     *
     * This route stays in core so the Community Edition can still serve the
     * version and update-check half of the dialog. The license half comes
     * from the Enterprise license client through EnterpriseEdition; activating
     * and refreshing a license (the POSTs on this path) are served by the
     * Enterprise module itself (ee/Server/License).
     *
     * This route also serves the login page (before sign-in), so it cannot
     * require authentication outright. Anybody but a master admin gets only
     * what the edition pill shows - see buildLicenseResponse.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * This route also serves the login page, so a caller with no session
           * normally gets the reduced anonymous payload below. Unless it says
           * it is signed in (the dashboards do): then no session means an
           * expired one, and the anonymous payload would read as "unlicensed".
           * Answer 401 so the client refreshes and asks again.
           */
          if (
            req.query["signedIn"] === "true" &&
            UserMiddleware.isAnonymousRequest(req as OneUptimeRequest)
          ) {
            throw new NotAuthenticatedException(
              UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
            );
          }

          const audience: LicenseResponseAudience =
            GlobalConfigAPI.getLicenseResponseAudience(req);
          const isEnterpriseEditionLoaded: boolean =
            EnterpriseEdition.isLoaded();

          const snapshot: EnterpriseLicenseSnapshot | null =
            isEnterpriseEditionLoaded
              ? await EnterpriseEdition.getLicenseSnapshot()
              : null;

          /*
           * Only a master admin's response carries anything read from the row
           * or derived from the live User table, so nobody else costs a read.
           */
          const config: GlobalConfig | null =
            audience === "master-admin"
              ? await GlobalConfigService.findOneById({
                  id: ObjectID.getZeroObjectID(),
                  select: LICENSE_RESPONSE_CONFIG_SELECT,
                  props: {
                    isRoot: true,
                  },
                })
              : null;

          const seatUsage: SeatUsage | null =
            audience === "master-admin" && isEnterpriseEditionLoaded
              ? await EnterpriseEdition.getSeatUsage()
              : null;

          return Response.sendJsonObjectResponse(
            req,
            res,
            GlobalConfigAPI.buildLicenseResponse({
              audience,
              isEnterpriseEditionLoaded,
              snapshot,
              config,
              seatUsage,
            }),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * The body of GET /global-config/vars, which anybody reads, signed in or
   * not: switches the pages follow, and whether the server can send email -
   * a yes or no only, never an address, a setting or why a send failed.
   */
  public static buildVarsResponse(
    globalConfig: GlobalConfig | null,
  ): JSONObject {
    return {
      disableUserProjectCreation: Boolean(
        globalConfig?.disableUserProjectCreation,
      ),
      /*
       * Whether push notifications are turned off for the whole server: the
       * Dashboard says so in place of the push devices, and offers none in a
       * notification rule.
       */
      disablePushNotifications: Boolean(globalConfig?.disablePushNotifications),
      /*
       * False while the server is known not to be able to send email - its
       * settings are missing, or it has never managed to send one - so no
       * page promises an email that cannot come (ServerSendingStatus.
       * canSendEmailPubliclyFrom). Once email has worked, a later failure is
       * told to master admins only (GET /global-config/sending-status).
       */
      canSendEmail: ServerSendingStatus.canSendEmailPubliclyFrom(globalConfig),
    };
  }

  /*
   * The signed-in person asking, from their session, or null (the master API
   * key, which is nobody): whose "Hide" the checklist reads, and who made a
   * choice on it.
   */
  public static async getSessionUserId(
    req: ExpressRequest,
  ): Promise<ObjectID | null> {
    const session: RequestSession =
      await UserMiddleware.readRequestSession(req);

    if (session.kind !== "user" || !session.session.userId) {
      return null;
    }

    return new ObjectID(session.session.userId.toString());
  }

  /*
   * A master admin is recognised from the verified access token that
   * UserMiddleware.getUserMiddleware decoded. Anything else - no token, an
   * API key, a status-page user, a signed-in project member - is "public".
   */
  public static getLicenseResponseAudience(
    req: ExpressRequest,
  ): LicenseResponseAudience {
    return (req as OneUptimeRequest).userAuthorization?.isMasterAdmin === true
      ? "master-admin"
      : "public";
  }

  /*
   * The body of GET /global-config/license, and of the Enterprise license
   * client's activation and refresh responses, so the three can never
   * disagree on a field.
   *
   * licenseValid is true for a valid license AND one in its grace period:
   * grace means nothing has changed yet, and the dialog must not tell an
   * administrator the license is gone while everything still works.
   */
  public static buildLicenseResponse(
    data: BuildLicenseResponseData,
  ): JSONObject {
    const snapshot: EnterpriseLicenseSnapshot | null =
      data.isEnterpriseEditionLoaded ? data.snapshot : null;

    const publicFields: JSONObject = {
      edition: data.isEnterpriseEditionLoaded ? "enterprise" : "community",
      status: snapshot ? snapshot.status : null,
      verification: snapshot ? snapshot.verification : null,
      graceReason: snapshot?.graceReason || null,
      licenseValid: EnterpriseLicenseSnapshotUtil.isUsable(snapshot),
      companyName: snapshot?.companyName || null,
      expiresAt: GlobalConfigAPI.toIsoString(snapshot?.expiresAt),
      graceEndsAt: GlobalConfigAPI.toIsoString(snapshot?.graceEndsAt),
      isEvaluation: Boolean(snapshot?.isEvaluation),
      // The name older dialogs read; same value as isEvaluation.
      isEvaluationLicense: Boolean(snapshot?.isEvaluation),
      /*
       * Which enterprise features the license covers: "all", or the
       * EnterpriseFeature values it lists (null on the Community Edition).
       * A valid license that leaves a feature out stops that feature (see
       * EnterpriseEdition.isFeatureActive), which licenseValid alone cannot
       * tell a screen.
       */
      features: GlobalConfigAPI.toFeaturesResponse(snapshot),
      /*
       * The cloud marketplace the license comes from - "AWS", "Azure" or
       * "GoogleCloud" - when it is a marketplace subscription rather than a
       * license key; null otherwise. Screens say "Licensed through AWS
       * Marketplace" instead of offering to renew a key nobody has.
       */
      marketplace: snapshot?.marketplace || null,
    };

    if (data.audience !== "master-admin") {
      return publicFields;
    }

    const config: GlobalConfig | null = data.config;

    /*
     * The license columns mean nothing on the Community Edition (a leftover
     * key from an earlier Enterprise image licenses nothing here), so only
     * the version half of the dialog is filled in there.
     */
    const licenseConfig: GlobalConfig | null = snapshot ? config : null;

    const licenseToken: string | null =
      licenseConfig?.enterpriseLicenseToken || null;
    const licenseKey: string | null =
      licenseConfig?.enterpriseLicenseKey || null;

    return {
      ...publicFields,
      message: snapshot?.message || null,
      licenseKey: licenseKey,
      token: licenseToken,
      /*
       * "offline" when the license was activated by pasting a signed token:
       * such an installation holds no license key and never calls home.
       */
      activationMode: licenseToken ? (licenseKey ? "online" : "offline") : null,
      // From the signed claims for a verified license, else the stored column.
      userLimit:
        typeof snapshot?.userLimit === "number" ? snapshot.userLimit : null,
      currentUserCount:
        typeof licenseConfig?.enterpriseLicenseCurrentUserCount === "number"
          ? licenseConfig.enterpriseLicenseCurrentUserCount
          : null,
      userCountUpdatedAt: GlobalConfigAPI.toIsoString(
        licenseConfig?.enterpriseLicenseUserCountUpdatedAt,
      ),
      instances: Array.isArray(licenseConfig?.enterpriseLicenseInstances)
        ? (licenseConfig?.enterpriseLicenseInstances as Array<EnterpriseLicenseInstanceSummary>)
        : [],
      instanceId: licenseConfig?.instanceId
        ? licenseConfig.instanceId.toString()
        : null,
      /*
       * Which build this installation runs, and whether a newer one has been
       * released. Master admins only: telling anybody else that this server
       * is behind on patches advertises an unpatched target.
       */
      /*
       * How this installation bills through the marketplace it was bought on:
       * when the marketplace last took a usage report, what it last said and
       * what is still to be reported. Null on an installation that is not
       * billed through a marketplace.
       */
      marketplaceBilling: GlobalConfigAPI.toMarketplaceBillingResponse(
        licenseConfig?.enterpriseMarketplaceBilling,
      ),
      currentVersion: AppVersion,
      latestVersion: config?.latestReleaseVersion || null,
      latestVersionPublishedAt: GlobalConfigAPI.toIsoString(
        config?.latestReleasePublishedAt,
      ),
      latestVersionCheckedAt: GlobalConfigAPI.toIsoString(
        config?.latestReleaseCheckedAt,
      ),
      isUpdateAvailable: VersionUtil.isUpdateAvailable({
        currentVersion: AppVersion,
        latestVersion: config?.latestReleaseVersion,
      }),
      /*
       * Lets the dialog say "update checks are off" instead of "has not
       * checked yet", which would be a promise the installation is never
       * going to keep.
       */
      isUpdateCheckDisabled: DisableUpdateCheck,
      ...GlobalConfigAPI.getSeatUsageResponseFields(
        snapshot ? data.seatUsage : null,
      ),
    };
  }

  /*
   * The body of GET /global-config/update-status, from the row the daily
   * update check wrote and the version this process runs now - so an
   * upgrade clears a security notice the moment the new version starts.
   */
  public static buildUpdateStatusResponse(
    config: GlobalConfig | null,
  ): JSONObject {
    return UpdateStatusUtil.toJSON(
      SecurityAdvisoryMatcher.buildUpdateStatus({
        currentVersion: AppVersion,
        isUpdateCheckDisabled: DisableUpdateCheck,
        isSelfHosted: !IsBillingEnabled,
        latestVersion: config?.latestReleaseVersion,
        latestVersionPublishedAt: config?.latestReleasePublishedAt,
        latestVersionCheckedAt: config?.latestReleaseCheckedAt,
        advisories: config?.securityAdvisories,
        advisoriesCheckedAt: config?.securityAdvisoriesCheckedAt,
        lastCheckAttemptedAt: config?.updateCheckLastAttemptAt,
        lastCheckFailure: config?.updateCheckLastFailure,
      }),
    );
  }

  // The marketplace billing summary for a response, or null when there is none.
  public static toMarketplaceBillingResponse(
    value: unknown,
  ): JSONObject | null {
    const state: EnterpriseMarketplaceBillingState | null =
      EnterpriseMarketplaceBillingUtil.fromJSON(value);

    if (!state) {
      return null;
    }

    return JSON.parse(
      JSON.stringify(EnterpriseMarketplaceBillingUtil.summarize(state)),
    ) as JSONObject;
  }

  // The license's features for a response: "all", a copy of the list, or null.
  public static toFeaturesResponse(
    snapshot: EnterpriseLicenseSnapshot | null,
  ): "all" | Array<string> | null {
    if (!snapshot) {
      return null;
    }

    if (snapshot.features === "all") {
      return "all";
    }

    return Array.isArray(snapshot.features) ? [...snapshot.features] : [];
  }

  /*
   * The seat-enforcement half of a license response. Always the same keys, so
   * a client never has to tell "this build does not report seats" apart from
   * "this installation does not enforce them" by which fields are missing:
   * isSeatLimitEnforced is the single flag that answers that.
   */
  public static getSeatUsageResponseFields(
    seatUsage: SeatUsage | null,
  ): JSONObject {
    if (!seatUsage || !seatUsage.isEnforced) {
      return {
        isSeatLimitEnforced: false,
        seatsInUse: null,
        seatsRemaining: null,
        canAddMoreUsers: true,
      };
    }

    return {
      isSeatLimitEnforced: true,
      seatsInUse: seatUsage.seatsInUse,
      seatsRemaining: seatUsage.seatsRemaining,
      canAddMoreUsers: seatUsage.hasSeatForNewUser,
    };
  }

  private static toIsoString(value: Date | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }
}
