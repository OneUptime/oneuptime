import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import { DashboardRoute } from "Common/ServiceRoute";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import {
  MARKETPLACE_PURCHASE_PAGE_ROUTE,
  MarketplacePurchaseDetails,
} from "Common/Types/Marketplace/MarketplacePurchase";
import {
  MARKETPLACE_USAGE_ROUTE,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";
import { PROJECT_USAGE_READ_PERMISSIONS } from "Common/Utils/Project/ProjectBilling";
import ObjectID from "Common/Types/ObjectID";
import {
  IsBillingEnabled,
  MicrosoftSignInClientId,
} from "Common/Server/EnvironmentConfig";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import AwsMarketplaceInbound, {
  AWS_EVENTS_SECRET_HEADER,
  AwsInboundError,
  AwsMarketplaceEvent,
} from "../AWS/AwsMarketplaceInbound";
import AzureMarketplaceInbound, {
  AzureWebhookCall,
} from "../Azure/AzureMarketplaceInbound";
import GoogleCloudMarketplaceAdapter from "../GoogleCloud/GoogleCloudMarketplaceAdapter";
import GoogleCloudMarketplaceInbound, {
  GoogleCloudMarketplaceEvent,
  GoogleCloudSignup,
} from "../GoogleCloud/GoogleCloudMarketplaceInbound";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceClaimToken from "../MarketplaceClaimToken";
import MarketplaceConfig from "../MarketplaceConfig";
import MarketplacePurchaseClaim from "../MarketplacePurchaseClaim";
import MarketplaceUsageSummarizer from "../MarketplaceUsageSummarizer";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import { JwtVerificationError } from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";
import Response from "Common/Server/Utils/Response";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * Every route a cloud marketplace - or a buyer coming from one - reaches,
 * under /api/marketplace:
 *
 *   AWS Marketplace
 *     POST /aws/register            fulfillment URL (the buyer's browser, with a registration token)
 *     POST /aws/events              EventBridge API destination (shared secret header)
 *   Microsoft Marketplace (Azure)
 *     GET  /azure/landing           landing page URL (?token=)
 *     POST /azure/webhook           connection webhook (Microsoft Entra bearer token)
 *   Google Cloud Marketplace
 *     POST /google-cloud/signup     sign-up URL (the buyer's browser, with a signed JWT)
 *     POST /google-cloud/events     Pub/Sub push subscription (Google OIDC bearer token)
 *   The purchase page (/accounts/marketplace), for the signed-in buyer
 *     POST /purchase/details        what the purchase is, and what it can be linked to
 *     POST /purchase/complete       link it to a project, or a new one
 *     POST /purchase/dismiss        forget it in this browser
 *   The Billing page of a marketplace-billed project
 *     GET  /usage                   what its marketplace bill was made of, by month
 *
 * Only on OneUptime Cloud (billing enabled), and each marketplace only when
 * this server is set up for it (MarketplaceConfig); otherwise the buyer is
 * told so and the marketplace gets a 404.
 *
 * A buyer's marketplace token is resolved on arrival and never put in a URL:
 * the browser carries on to the purchase page with a claim token in an
 * HttpOnly cookie instead (MarketplaceClaimToken).
 */

const MESSAGE_VIEW: string = "/usr/src/Common/Server/Views/ViewMessage.ejs";

export default class MarketplaceAPI {
  private router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      "/marketplace/aws/register",
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleAwsRegistration(req, res);
      },
    );

    this.router.get(
      "/marketplace/aws/register",
      (req: ExpressRequest, res: ExpressResponse) => {
        MarketplaceAPI.renderMessage(req, res, {
          title: "Open OneUptime from AWS Marketplace",
          message:
            "This page is where AWS Marketplace sends you after you subscribe to OneUptime. Open the subscription in AWS Marketplace and choose Set up your account.",
          statusCode: 400,
        });
      },
    );

    this.router.post(
      "/marketplace/aws/events",
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleAwsEvent(req, res);
      },
    );

    /*
     * The landing page only asks whether someone is signed in, to send a
     * buyer who is not straight to Sign in with Microsoft; it never acts as
     * the caller. So a stale session cookie makes the visit anonymous here
     * rather than a 401 the buyer could do nothing about.
     */
    this.router.get(
      "/marketplace/azure/landing",
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleAzureLanding(req, res);
      },
    );

    this.router.post(
      "/marketplace/azure/webhook",
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleAzureWebhook(req, res);
      },
    );

    this.router.post(
      "/marketplace/google-cloud/signup",
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleGoogleCloudSignup(req, res);
      },
    );

    this.router.get(
      "/marketplace/google-cloud/signup",
      (req: ExpressRequest, res: ExpressResponse) => {
        MarketplaceAPI.renderMessage(req, res, {
          title: "Open OneUptime from Google Cloud Marketplace",
          message:
            "This page is where Google Cloud Marketplace sends you after you buy OneUptime. Open the product in Google Cloud Marketplace and choose Sign up with OneUptime.",
          statusCode: 400,
        });
      },
    );

    this.router.post(
      "/marketplace/google-cloud/events",
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.handleGoogleCloudEvent(req, res);
      },
    );

    this.router.post(
      "/marketplace/purchase/details",
      MarketplaceAPI.refuseForeignPages,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const purchase: MarketplaceSubscription =
            await MarketplaceAPI.getClaimedPurchase(req);

          const details: MarketplacePurchaseDetails =
            await MarketplacePurchaseClaim.getDetails({
              purchase: purchase,
              userId: MarketplaceAPI.getUserId(req),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            details as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      "/marketplace/purchase/complete",
      MarketplaceAPI.refuseForeignPages,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const purchase: MarketplaceSubscription =
            await MarketplaceAPI.getClaimedPurchase(req);

          const body: JSONObject = (req.body as JSONObject) || {};
          const projectIdValue: unknown = body["projectId"];
          const newProjectName: unknown = body["projectName"];
          const newProjectPlanId: unknown = body["planId"];

          const projectId: ObjectID = await MarketplacePurchaseClaim.complete({
            purchase: purchase,
            userId: MarketplaceAPI.getUserId(req),
            ...(typeof projectIdValue === "string" &&
            ObjectID.isValidUUID(projectIdValue)
              ? { projectId: new ObjectID(projectIdValue) }
              : {}),
            ...(typeof projectIdValue !== "string" &&
            typeof newProjectName === "string"
              ? {
                  newProject: {
                    name: newProjectName,
                    planId:
                      typeof newProjectPlanId === "string"
                        ? newProjectPlanId
                        : "",
                  },
                }
              : {}),
          });

          MarketplaceClaimToken.clearCookies(res);

          return Response.sendJsonObjectResponse(req, res, {
            projectId: projectId.toString(),
            redirectUrl: MarketplaceAPI.getProjectBillingRoute(projectId),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      "/marketplace/purchase/dismiss",
      MarketplaceAPI.refuseForeignPages,
      (req: ExpressRequest, res: ExpressResponse) => {
        MarketplaceClaimToken.clearCookies(res);
        return Response.sendEmptySuccessResponse(req, res);
      },
    );

    /*
     * What the project's marketplace bill was made of, month by month, for
     * its Billing page - read by whoever reads its usage history
     * (PROJECT_USAGE_READ_PERMISSIONS). Sums only: the reports themselves
     * stay master-admin only.
     */
    this.router.get(
      MARKETPLACE_USAGE_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new ForbiddenException(
              "Cloud marketplaces are not available on this server.",
            );
          }

          if (
            !CallerPermission.holdsAnyOf(
              req as OneUptimeRequest,
              PROJECT_USAGE_READ_PERMISSIONS,
            ) &&
            !(req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            throw new ForbiddenException(
              "You need Project Owner, Project Admin, Manage Billing or a billing role to view the project's marketplace usage.",
            );
          }

          const projectId: ObjectID | undefined = (req as OneUptimeRequest)
            .tenantId;

          if (!projectId) {
            throw new ForbiddenException("Choose a project first.");
          }

          const summary: MarketplaceUsageSummary =
            await MarketplaceUsageSummarizer.getSummary(projectId);

          return Response.sendJsonObjectResponse(
            req,
            res,
            summary as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private async handleAwsRegistration(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isAwsConfigured()) {
      return MarketplaceAPI.renderNotAvailable(req, res, CloudMarketplace.AWS);
    }

    const token: unknown = (req.body as JSONObject | undefined)?.[
      "x-amzn-marketplace-token"
    ];

    if (typeof token !== "string" || !token) {
      return MarketplaceAPI.renderMessage(req, res, {
        title: "Open OneUptime from AWS Marketplace",
        message:
          "We did not receive your AWS Marketplace subscription. Open the subscription in AWS Marketplace and choose Set up your account.",
        statusCode: 400,
      });
    }

    try {
      const purchase: MarketplaceSubscription =
        await new AwsMarketplaceInbound().registerBuyer(token);

      return await MarketplaceAPI.sendBuyerToPurchasePage(req, res, purchase);
    } catch (err) {
      logger.error(err);

      const isExpired: boolean =
        err instanceof MarketplaceApiError &&
        (err.message.includes("ExpiredToken") ||
          err.message.includes("InvalidToken"));

      return MarketplaceAPI.renderMessage(req, res, {
        title: "We could not set up your AWS Marketplace subscription",
        message:
          err instanceof AwsInboundError
            ? err.message
            : isExpired
              ? "This link from AWS Marketplace has expired. Open the subscription in AWS Marketplace and choose Set up your account again."
              : "Something went wrong while we were reading your subscription from AWS. Please open the subscription in AWS Marketplace and choose Set up your account again.",
        statusCode: 400,
      });
    }
  }

  private async handleAwsEvent(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isAwsConfigured()) {
      res.status(404).end();
      return;
    }

    const secret: unknown = req.headers[AWS_EVENTS_SECRET_HEADER];

    if (
      !AwsMarketplaceInbound.isEventsSecretValid(
        typeof secret === "string" ? secret : undefined,
      )
    ) {
      res.status(401).json({ message: "Not authorized." });
      return;
    }

    const event: AwsMarketplaceEvent | null = AwsMarketplaceInbound.parseEvent(
      req.body,
    );

    if (!event) {
      res.status(400).json({ message: "Not an EventBridge event." });
      return;
    }

    await MarketplaceAPI.runEventHandler(res, `AWS ${event.detailType}`, () => {
      return new AwsMarketplaceInbound().handleEvent(event);
    });
  }

  private async handleAzureLanding(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isAzureConfigured()) {
      return MarketplaceAPI.renderNotAvailable(
        req,
        res,
        CloudMarketplace.Azure,
      );
    }

    const token: unknown = req.query["token"];

    if (typeof token !== "string" || !token) {
      return MarketplaceAPI.renderMessage(req, res, {
        title: "Open OneUptime from the Azure portal",
        message:
          "This page is where Microsoft sends you after you buy OneUptime. Open your SaaS subscription in the Azure portal or in Microsoft 365 admin center and select Configure account.",
        statusCode: 400,
      });
    }

    try {
      const purchase: MarketplaceSubscription =
        await new AzureMarketplaceInbound().resolveLandingToken(token);

      return await MarketplaceAPI.sendBuyerToPurchasePage(req, res, purchase, {
        signInWithMicrosoft: true,
      });
    } catch (err) {
      logger.error(err);

      // The wording Microsoft asks publishers to use for a token that does not resolve.
      return MarketplaceAPI.renderMessage(req, res, {
        title: "We couldn't identify this purchase",
        message:
          "Reopen this SaaS subscription in the Azure portal or in Microsoft 365 Admin Center and select Configure Account or Manage Account again.",
        statusCode: 400,
      });
    }
  }

  private async handleAzureWebhook(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isAzureConfigured()) {
      res.status(404).end();
      return;
    }

    const inbound: AzureMarketplaceInbound = new AzureMarketplaceInbound();

    try {
      await inbound.verifyWebhookToken({
        authorizationHeader: req.headers["authorization"],
      });
    } catch (err) {
      logger.warn(
        `Refused a Microsoft Marketplace webhook call: ${(err as Error).message}`,
      );
      res.status(401).json({ message: "Not authorized." });
      return;
    }

    const call: AzureWebhookCall | null =
      AzureMarketplaceInbound.parseWebhookBody(req.body);

    if (!call) {
      res.status(400).json({ message: "Not a Microsoft Marketplace webhook." });
      return;
    }

    await MarketplaceAPI.runEventHandler(res, `Azure ${call.action}`, () => {
      return inbound.handleWebhook(call);
    });
  }

  private async handleGoogleCloudSignup(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isGoogleCloudConfigured()) {
      return MarketplaceAPI.renderNotAvailable(
        req,
        res,
        CloudMarketplace.GoogleCloud,
      );
    }

    const token: unknown = (req.body as JSONObject | undefined)?.[
      "x-gcp-marketplace-token"
    ];

    if (typeof token !== "string" || !token) {
      return MarketplaceAPI.renderMessage(req, res, {
        title: "Open OneUptime from Google Cloud Marketplace",
        message:
          "We did not receive your Google Cloud Marketplace purchase. Open the product in Google Cloud Marketplace and choose Sign up with OneUptime.",
        statusCode: 400,
      });
    }

    try {
      const signup: GoogleCloudSignup =
        await new GoogleCloudMarketplaceInbound().verifySignupToken(token);

      const purchase: MarketplaceSubscription =
        await MarketplacePurchases.recordPurchase({
          marketplace: CloudMarketplace.GoogleCloud,
          externalSubscriptionId: signup.accountId,
          externalCustomerId: signup.accountId,
        });

      return await MarketplaceAPI.sendBuyerToPurchasePage(req, res, purchase);
    } catch (err) {
      logger.error(err);

      return MarketplaceAPI.renderMessage(req, res, {
        title: "We could not set up your Google Cloud Marketplace purchase",
        message:
          err instanceof JwtVerificationError
            ? "This link from Google Cloud Marketplace has expired. Open the product in Google Cloud Marketplace and choose Sign up with OneUptime again."
            : "Something went wrong while we were reading your purchase from Google Cloud. Open the product in Google Cloud Marketplace and choose Sign up with OneUptime again.",
        statusCode: 400,
      });
    }
  }

  private async handleGoogleCloudEvent(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isGoogleCloudConfigured()) {
      res.status(404).end();
      return;
    }

    const inbound: GoogleCloudMarketplaceInbound =
      new GoogleCloudMarketplaceInbound();

    try {
      await inbound.verifyPushToken({
        authorizationHeader: req.headers["authorization"],
        audience: MarketplaceConfig.getGoogleCloudPubSubAudience(),
        serviceAccountEmail:
          GoogleCloudMarketplaceAdapter.getPubSubServiceAccountEmail() || "",
      });
    } catch (err) {
      logger.warn(
        `Refused a Google Cloud Marketplace Pub/Sub delivery: ${(err as Error).message}`,
      );
      res.status(401).json({ message: "Not authorized." });
      return;
    }

    const event: GoogleCloudMarketplaceEvent | null =
      GoogleCloudMarketplaceInbound.parsePushBody(req.body);

    if (!event) {
      // Acknowledged: a message that is not a marketplace event will never become one.
      res.status(204).end();
      return;
    }

    await MarketplaceAPI.runEventHandler(
      res,
      `Google Cloud ${event.eventType}`,
      () => {
        return inbound.handleEvent(event);
      },
    );
  }

  /*
   * Run a marketplace notification's handler and answer the marketplace:
   * 200 when it is done with, 503 when the marketplace should deliver it
   * again (OneUptime could not reach the marketplace's API to act on it).
   * A failure that a retry will not cure is logged and acknowledged, so a
   * bad message is not redelivered for hours.
   */
  private static async runEventHandler(
    res: ExpressResponse,
    description: string,
    handler: () => Promise<void>,
  ): Promise<void> {
    try {
      await handler();
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error(`Marketplace notification failed: ${description}`);
      logger.error(err);

      if (err instanceof MarketplaceApiError && !err.isRetryable) {
        res.status(200).json({ received: true });
        return;
      }

      res.status(503).json({ message: "Please retry." });
    }
  }

  /*
   * The purchase is recorded: send the buyer on. One already set up goes to
   * its project's billing page. Otherwise the browser is given the claim
   * token and goes to the purchase page - by way of Sign in with Microsoft,
   * for a Microsoft Marketplace buyer who is not signed in, where this server
   * offers it.
   */
  private static async sendBuyerToPurchasePage(
    req: ExpressRequest,
    res: ExpressResponse,
    purchase: MarketplaceSubscription,
    options?: { signInWithMicrosoft?: boolean | undefined },
  ): Promise<void> {
    if (purchase.projectId) {
      res.redirect(
        303,
        MarketplaceAPI.getProjectBillingRoute(purchase.projectId),
      );
      return;
    }

    const token: string = await MarketplacePurchases.issueClaimToken(
      purchase.id!,
    );

    MarketplaceClaimToken.setCookies(res, token);

    const isSignedIn: boolean = Boolean(
      (req as OneUptimeRequest).userAuthorization?.userId,
    );

    if (
      options?.signInWithMicrosoft &&
      !isSignedIn &&
      MicrosoftSignInClientId
    ) {
      res.redirect(303, "/identity/microsoft/sign-in");
      return;
    }

    res.redirect(303, MARKETPLACE_PURCHASE_PAGE_ROUTE);
  }

  private static getProjectBillingRoute(projectId: ObjectID): string {
    return `${DashboardRoute.toString()}/${projectId.toString()}/settings/billing`;
  }

  // The purchase this browser's claim token was issued for.
  private static async getClaimedPurchase(
    req: ExpressRequest,
  ): Promise<MarketplaceSubscription> {
    if (!IsBillingEnabled) {
      throw new ForbiddenException(
        "Cloud marketplaces are not available on this server.",
      );
    }

    const token: string | null = MarketplaceClaimToken.readFromRequest(req);

    const purchase: MarketplaceSubscription | null = token
      ? await MarketplacePurchases.findPurchaseByClaimToken(token)
      : null;

    if (!purchase) {
      throw new ForbiddenException(
        "There is no marketplace purchase waiting to be set up in this browser. Open OneUptime from the marketplace you bought it on again.",
      );
    }

    return purchase;
  }

  private static getUserId(req: ExpressRequest): ObjectID {
    const userId: ObjectID | undefined = (req as OneUptimeRequest)
      .userAuthorization?.userId;

    if (!userId) {
      throw new NotAuthenticatedException("Please sign in.");
    }

    return userId;
  }

  /*
   * The purchase routes act for the signed-in buyer, with a cookie another
   * site's page could otherwise have the browser send: refuse a request any
   * page but OneUptime's own made (see SameOriginRequest).
   */
  private static refuseForeignPages(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (
      SameOriginRequest.isForeignPageRequest({
        headers: req.headers,
        instanceOrigin: SameOriginRequest.getInstanceOrigin(),
      })
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException("This request did not come from OneUptime."),
      );
    }

    return next();
  }

  private static renderNotAvailable(
    req: ExpressRequest,
    res: ExpressResponse,
    marketplace: CloudMarketplace,
  ): void {
    MarketplaceAPI.renderMessage(req, res, {
      title: `${CloudMarketplaceUtil.getDisplayName(marketplace)} is not available here`,
      message: `This OneUptime server does not sell through ${CloudMarketplaceUtil.getDisplayName(marketplace)}.`,
      statusCode: 404,
    });
  }

  private static renderMessage(
    req: ExpressRequest,
    res: ExpressResponse,
    data: { title: string; message: string; statusCode: number },
  ): void {
    res.status(data.statusCode);

    return Response.render(req, res, MESSAGE_VIEW, {
      title: data.title,
      message: data.message,
      viewDetailsUrl: "/",
      viewDetailsText: "Go to OneUptime",
    });
  }
}
