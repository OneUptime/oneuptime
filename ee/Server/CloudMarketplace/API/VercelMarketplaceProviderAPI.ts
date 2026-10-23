import { JSONObject } from "Common/Types/JSON";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceConfig from "../MarketplaceConfig";
import VercelMarketplaceAuth, {
  VercelAuthError,
  VercelMarketplaceCaller,
} from "../Vercel/VercelMarketplaceAuth";
import VercelMarketplaceProvider, {
  VercelProviderError,
} from "../Vercel/VercelMarketplaceProvider";
import VercelMarketplaceWebhooks, {
  VercelWebhookEvent,
} from "../Vercel/VercelMarketplaceWebhooks";
import { VERCEL_SIGNATURE_HEADER } from "Common/Server/Utils/Marketplace/Vercel/VercelSignature";

/*
 * Vercel Marketplace's routes, under /api/marketplace/vercel - the
 * integration's Base URL, which Vercel calls the provider API at
 * (https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner),
 * and its Webhook URL:
 *
 *   PUT    /v1/installations/:installationId                 upsert installation
 *   GET    /v1/installations/:installationId                 get installation
 *   PATCH  /v1/installations/:installationId                 update installation (no installation plans)
 *   DELETE /v1/installations/:installationId                 uninstall
 *   GET    /v1/installations/:installationId/plans           installation plans (none: plans are per resource)
 *   GET    /v1/products/:productSlug/plans                   the plans a resource is added on
 *   POST   /v1/installations/:installationId/resources       add a resource
 *   GET    /v1/installations/:id/resources/:resourceId       get / change / delete a resource
 *   PATCH  /v1/installations/:id/resources/:resourceId
 *   DELETE /v1/installations/:id/resources/:resourceId
 *   GET    /v1/installations/:id/resources/:resourceId/plans the plans a resource may move to
 *   POST   /v1/installations/:id/resources/:resourceId/secrets/rotate
 *   POST   /webhook                                          webhooks (x-vercel-signature)
 *
 * Every provider API call carries an OIDC token Vercel signed for the
 * integration (VercelMarketplaceAuth); one that does not is refused with
 * 403, as Vercel's example provider does. Only on OneUptime Cloud, and only
 * when this server has the integration's credentials (MarketplaceConfig);
 * otherwise Vercel gets a 404.
 *
 * Sign-in from Vercel ("Open in OneUptime") is the Identity service's:
 * /identity/vercel/sso.
 */

const BASE: string = "/marketplace/vercel";

type ProviderHandler = (
  req: ExpressRequest,
  caller: VercelMarketplaceCaller,
) => Promise<{ status: number; body?: JSONObject | undefined }>;

export default class VercelMarketplaceProviderAPI {
  private router: ExpressRouter;
  private auth: VercelMarketplaceAuth;

  public constructor(options?: { auth?: VercelMarketplaceAuth | undefined }) {
    this.router = Express.getRouter();
    this.auth = options?.auth || new VercelMarketplaceAuth();

    const installation: string = `${BASE}/v1/installations/:installationId`;
    const resource: string = `${installation}/resources/:resourceId`;

    this.route(
      "put",
      installation,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        await VercelMarketplaceProvider.upsertInstallation({
          caller: caller,
          installationId: VercelMarketplaceProviderAPI.param(
            req,
            "installationId",
          ),
          body: VercelMarketplaceProviderAPI.body(req),
        });
        return { status: 204 };
      },
    );

    this.route(
      "get",
      installation,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.getInstallation({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
          }),
        };
      },
    );

    // Plans are per resource: an installation has none to change.
    this.route(
      "patch",
      installation,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.getInstallation({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
          }),
        };
      },
    );

    this.route(
      "delete",
      installation,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.deleteInstallation({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
          }),
        };
      },
    );

    this.route(
      "get",
      `${installation}/plans`,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        VercelMarketplaceProvider.assertCallerOf(
          caller,
          VercelMarketplaceProviderAPI.param(req, "installationId"),
        );
        return { status: 200, body: { plans: [] } };
      },
    );

    // Asked before anything is installed, too: the token then names no installation.
    this.route("get", `${BASE}/v1/products/:productSlug/plans`, async () => {
      return {
        status: 200,
        body: VercelMarketplaceProvider.listPlans() as unknown as JSONObject,
      };
    });

    this.route(
      "post",
      `${installation}/resources`,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.provisionResource({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
            body: VercelMarketplaceProviderAPI.body(req),
            idempotencyKey: VercelMarketplaceProviderAPI.header(
              req,
              "idempotency-key",
            ),
          }),
        };
      },
    );

    this.route(
      "get",
      resource,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.getResource({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
            resourceId: VercelMarketplaceProviderAPI.param(req, "resourceId"),
          }),
        };
      },
    );

    this.route(
      "patch",
      resource,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.updateResource({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
            resourceId: VercelMarketplaceProviderAPI.param(req, "resourceId"),
            body: VercelMarketplaceProviderAPI.body(req),
          }),
        };
      },
    );

    this.route(
      "delete",
      resource,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        await VercelMarketplaceProvider.deleteResource({
          caller: caller,
          installationId: VercelMarketplaceProviderAPI.param(
            req,
            "installationId",
          ),
          resourceId: VercelMarketplaceProviderAPI.param(req, "resourceId"),
        });
        return { status: 204 };
      },
    );

    this.route(
      "get",
      `${resource}/plans`,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        await VercelMarketplaceProvider.getResource({
          caller: caller,
          installationId: VercelMarketplaceProviderAPI.param(
            req,
            "installationId",
          ),
          resourceId: VercelMarketplaceProviderAPI.param(req, "resourceId"),
        });

        return {
          status: 200,
          body: VercelMarketplaceProvider.listPlans() as unknown as JSONObject,
        };
      },
    );

    this.route(
      "post",
      `${resource}/secrets/rotate`,
      async (req: ExpressRequest, caller: VercelMarketplaceCaller) => {
        return {
          status: 200,
          body: await VercelMarketplaceProvider.rotateSecrets({
            caller: caller,
            installationId: VercelMarketplaceProviderAPI.param(
              req,
              "installationId",
            ),
            resourceId: VercelMarketplaceProviderAPI.param(req, "resourceId"),
            body: VercelMarketplaceProviderAPI.body(req),
          }),
        };
      },
    );

    this.router.post(
      `${BASE}/webhook`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        await VercelMarketplaceProviderAPI.handleWebhook(req, res);
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private route(
    method: "get" | "put" | "post" | "patch" | "delete",
    path: string,
    handler: ProviderHandler,
  ): void {
    this.router[method](
      path,
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        if (!MarketplaceConfig.isVercelConfigured()) {
          res.status(404).json({
            error: {
              code: "not_found",
              message: "Vercel Marketplace is not available on this server.",
            },
          });
          return;
        }

        let caller: VercelMarketplaceCaller;

        try {
          caller = await this.auth.verifyAuthorizationHeader(
            req.headers["authorization"],
          );
        } catch (err) {
          logger.warn(
            `Refused a Vercel Marketplace call to ${req.method} ${req.path}: ${(err as Error).message}`,
          );

          res.status(403).json({
            error: {
              code: "forbidden",
              message:
                err instanceof VercelAuthError
                  ? err.message
                  : "The request could not be authenticated.",
            },
          });
          return;
        }

        try {
          const result: { status: number; body?: JSONObject | undefined } =
            await handler(req, caller);

          if (result.body === undefined) {
            res.status(result.status).end();
            return;
          }

          res.status(result.status).json(result.body);
        } catch (err) {
          if (err instanceof VercelProviderError) {
            res.status(err.getStatus()).json(err.toJSON());
            return;
          }

          logger.error(
            `Vercel Marketplace call ${req.method} ${req.path} failed.`,
          );
          logger.error(err);

          res.status(500).json({
            error: {
              code: "internal_error",
              message:
                "OneUptime could not complete the request. Please retry.",
              user: {
                message:
                  "OneUptime could not complete this right now. Please try again in a minute.",
              },
            },
          });
        }
      },
    );
  }

  /*
   * A webhook: its signature checked against the raw body, then acted on.
   * Answered 200 once done with, and 503 when OneUptime could not reach
   * Vercel to act on it, so Vercel delivers it again (for up to 24 hours).
   */
  private static async handleWebhook(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    if (!MarketplaceConfig.isVercelConfigured()) {
      res.status(404).end();
      return;
    }

    if (
      !VercelMarketplaceWebhooks.isSignatureValid({
        rawBody: (req as OneUptimeRequest).rawBody,
        signature: req.headers[VERCEL_SIGNATURE_HEADER],
      })
    ) {
      logger.warn("Refused a Vercel webhook: its signature is not valid.");
      res.status(401).json({ message: "Not authorized." });
      return;
    }

    const event: VercelWebhookEvent | null = VercelMarketplaceWebhooks.parse(
      req.body,
    );

    if (!event) {
      res.status(400).json({ message: "Not a Vercel webhook." });
      return;
    }

    try {
      await VercelMarketplaceWebhooks.handle(event);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error(`Vercel webhook ${event.type} (${event.id}) failed.`);
      logger.error(err);

      if (err instanceof MarketplaceApiError && !err.isRetryable) {
        res.status(200).json({ received: true });
        return;
      }

      res.status(503).json({ message: "Please retry." });
    }
  }

  private static param(req: ExpressRequest, name: string): string {
    const value: unknown = req.params[name];
    return typeof value === "string" ? value : "";
  }

  private static body(req: ExpressRequest): JSONObject {
    const body: unknown = req.body;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};
  }

  private static header(req: ExpressRequest, name: string): string | undefined {
    const value: unknown = req.headers[name];
    return typeof value === "string" ? value : undefined;
  }
}
