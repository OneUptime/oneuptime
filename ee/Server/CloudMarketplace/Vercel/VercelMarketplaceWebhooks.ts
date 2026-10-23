import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import { VercelMarketplaceClientSecret } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import logger from "Common/Server/Utils/Logger";
import VercelMarketplaceBilling from "./VercelMarketplaceBilling";
import VercelMarketplaceMonitors from "./VercelMarketplaceMonitors";
import VercelMarketplaceResources from "./VercelMarketplaceResources";
import VercelSignature from "Common/Server/Utils/Marketplace/Vercel/VercelSignature";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * The webhooks Vercel sends OneUptime's integration
 * (https://vercel.com/docs/webhooks/webhooks-api), signed with the
 * integration's client secret (x-vercel-signature):
 *
 *   integration-resource.project-connected / -disconnected
 *       a Vercel project connected to a resource, or no longer: its
 *       production domain's monitor is made, or deleted;
 *   deployment.succeeded / .ready / .promoted (production)
 *       the monitor of a project connected before it had a domain;
 *   marketplace.invoice.overdue / .paid
 *       an invoice unpaid at the end of Vercel's 15 days of retries
 *       suspends the team's resources - their projects keep their data and
 *       stop being served, as a card customer's do - and paying it brings
 *       them back. Nothing is deleted for not paying;
 *   integration-configuration.removed
 *       the team uninstalled OneUptime (Vercel also calls Delete
 *       Installation; either one does it);
 *   marketplace.member.changed
 *       someone left the team (role NONE): they leave its OneUptime
 *       projects. Vercel names them by email only when the integration has
 *       that permission.
 *
 * Anything else is acknowledged and ignored.
 */

export interface VercelWebhookEvent {
  id: string;
  type: string;
  payload: JSONObject;
}

export default class VercelMarketplaceWebhooks {
  public static isSignatureValid(data: {
    rawBody: string | Buffer | undefined;
    signature: unknown;
  }): boolean {
    if (data.rawBody === undefined) {
      return false;
    }

    return VercelSignature.isValid({
      body: data.rawBody,
      signature: data.signature,
      secret: VercelMarketplaceClientSecret,
    });
  }

  public static parse(body: unknown): VercelWebhookEvent | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const event: JSONObject = body as JSONObject;
    const type: unknown = event["type"];
    const payload: unknown = event["payload"];

    if (typeof type !== "string" || !type) {
      return null;
    }

    return {
      id: typeof event["id"] === "string" ? event["id"] : "",
      type: type,
      payload:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as JSONObject)
          : {},
    };
  }

  public static async handle(event: VercelWebhookEvent): Promise<void> {
    switch (event.type) {
      case "integration-resource.project-connected":
      case "integration-resource.project-disconnected": {
        const installationId: string | null =
          VercelMarketplaceWebhooks.readInstallationId(event.payload);
        const resourceId: string | null = VercelMarketplaceWebhooks.readString(
          event.payload["resourceId"],
        );
        const project: JSONObject = VercelMarketplaceWebhooks.readObject(
          event.payload["project"],
        );
        const vercelProjectId: string | null =
          VercelMarketplaceWebhooks.readString(project["id"]) ||
          VercelMarketplaceWebhooks.readString(event.payload["projectId"]);

        if (!installationId || !resourceId || !vercelProjectId) {
          return;
        }

        const connection: {
          installationId: string;
          resourceId: string;
          vercelProjectId: string;
          vercelProjectName?: string | undefined;
          productionDomain?: string | undefined;
        } = {
          installationId: installationId,
          resourceId: resourceId,
          vercelProjectId: vercelProjectId,
          vercelProjectName:
            VercelMarketplaceWebhooks.readString(project["name"]) || undefined,
          productionDomain:
            VercelMarketplaceWebhooks.readString(
              event.payload["productionDomain"],
            ) || undefined,
        };

        if (event.type === "integration-resource.project-connected") {
          await VercelMarketplaceMonitors.onProjectConnected(connection);
        } else {
          await VercelMarketplaceMonitors.onProjectDisconnected(connection);
        }

        return;
      }

      case "deployment.succeeded":
      case "deployment.ready":
      case "deployment.promoted": {
        const isProduction: boolean =
          event.type === "deployment.promoted" ||
          event.payload["target"] === "production";

        const project: JSONObject = VercelMarketplaceWebhooks.readObject(
          event.payload["project"],
        );
        const vercelProjectId: string | null =
          VercelMarketplaceWebhooks.readString(project["id"]);

        if (!isProduction || !vercelProjectId) {
          return;
        }

        const integrations: Array<unknown> = Array.isArray(
          event.payload["integrations"],
        )
          ? (event.payload["integrations"] as Array<unknown>)
          : [];

        const installationIds: Array<string> = [];
        const resourceIds: Array<string> = [];

        for (const integration of integrations) {
          const entry: JSONObject =
            VercelMarketplaceWebhooks.readObject(integration);
          const installationId: string | null =
            VercelMarketplaceWebhooks.readString(entry["installationId"]);

          if (installationId) {
            installationIds.push(installationId);
          }

          for (const resource of Array.isArray(entry["resources"])
            ? (entry["resources"] as Array<unknown>)
            : []) {
            const resourceId: string | null =
              VercelMarketplaceWebhooks.readString(
                VercelMarketplaceWebhooks.readObject(resource)[
                  "externalResourceId"
                ],
              );

            if (resourceId) {
              resourceIds.push(resourceId);
            }
          }
        }

        for (const installationId of Array.isArray(
          event.payload["installationIds"],
        )
          ? (event.payload["installationIds"] as Array<unknown>)
          : []) {
          if (typeof installationId === "string" && installationId) {
            installationIds.push(installationId);
          }
        }

        await VercelMarketplaceMonitors.onProductionDeployment({
          vercelProjectId: vercelProjectId,
          installationIds: installationIds,
          resourceIds: resourceIds,
        });

        return;
      }

      case "marketplace.invoice.overdue":
        await VercelMarketplaceWebhooks.setStatusOfInstallation(
          VercelMarketplaceWebhooks.readInstallationId(event.payload),
          {
            from: MarketplaceSubscriptionStatus.Active,
            to: MarketplaceSubscriptionStatus.Suspended,
            externalState: "invoice-overdue",
          },
        );
        return;

      case "marketplace.invoice.paid":
        await VercelMarketplaceWebhooks.setStatusOfInstallation(
          VercelMarketplaceWebhooks.readInstallationId(event.payload),
          {
            from: MarketplaceSubscriptionStatus.Suspended,
            to: MarketplaceSubscriptionStatus.Active,
            externalState: "invoice-paid",
          },
        );
        return;

      case "marketplace.invoice.notpaid":
        logger.warn(
          `Vercel could not charge invoice ${String(event.payload["invoiceId"])} of installation ${VercelMarketplaceWebhooks.readInstallationId(event.payload)}; it retries for 15 days before the invoice is overdue.`,
        );
        return;

      case "marketplace.invoice.refunded":
        logger.info(
          `Vercel refunded ${String(event.payload["amount"])} USD of invoice ${String(event.payload["invoiceId"])} (installation ${VercelMarketplaceWebhooks.readInstallationId(event.payload)}): ${String(event.payload["reason"] || "")}`,
        );
        return;

      case "integration-configuration.removed": {
        const installationId: string | null =
          VercelMarketplaceWebhooks.readInstallationId(event.payload);

        if (!installationId) {
          return;
        }

        const installation: VercelMarketplaceInstallation | null =
          await VercelMarketplaceInstallationService.findByInstallationId(
            installationId,
          );

        if (installation) {
          await VercelMarketplaceBilling.requestDeletion(installation);
        }

        return;
      }

      case "marketplace.member.changed":
        if (event.payload["role"] === "NONE") {
          await VercelMarketplaceWebhooks.removeMember({
            installationId: VercelMarketplaceWebhooks.readInstallationId(
              event.payload,
            ),
            email: VercelMarketplaceWebhooks.readString(
              event.payload["userEmail"],
            ),
          });
        }
        return;

      default:
        return;
    }
  }

  private static async setStatusOfInstallation(
    installationId: string | null,
    change: {
      from: MarketplaceSubscriptionStatus;
      to: MarketplaceSubscriptionStatus;
      externalState: string;
    },
  ): Promise<void> {
    if (!installationId) {
      return;
    }

    const purchases: Array<MarketplaceSubscription> =
      await VercelMarketplaceResources.listPurchases(installationId);

    for (const purchase of purchases) {
      if (purchase.status !== change.from) {
        continue;
      }

      const updated: MarketplaceSubscription =
        await MarketplacePurchases.updatePurchase(purchase, {
          status: change.to,
          externalState: change.externalState,
        });

      logger.info(
        `Vercel resource ${purchase.externalSubscriptionId} (installation ${installationId}) is now ${change.to}: ${change.externalState}.`,
      );

      await VercelMarketplaceResources.tellVercelResourceChanged(updated);
    }
  }

  /*
   * Someone left the Vercel team: they leave the team's OneUptime projects.
   * A project needs one owner, so the last one stays, and is logged.
   */
  private static async removeMember(data: {
    installationId: string | null;
    email: string | null;
  }): Promise<void> {
    if (!data.installationId || !data.email) {
      return;
    }

    let email: Email;

    try {
      email = new Email(data.email);
    } catch {
      return;
    }

    const user: User | null = await UserService.findOneBy({
      query: { email: email },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!user) {
      return;
    }

    const purchases: Array<MarketplaceSubscription> =
      await VercelMarketplaceResources.listPurchases(data.installationId);

    for (const purchase of purchases) {
      if (!purchase.projectId) {
        continue;
      }

      try {
        await TeamMemberService.deleteBy({
          query: { projectId: purchase.projectId, userId: user.id! },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      } catch (err) {
        logger.error(
          `Could not take ${data.email} out of project ${purchase.projectId.toString()} after they left the Vercel team: ${(err as Error).message}`,
        );
      }
    }

    await AccessTokenService.refreshUserAllPermissions(user.id!);
  }

  // The installation an event is about: payload.installationId, or the configuration's ID.
  private static readInstallationId(payload: JSONObject): string | null {
    return (
      VercelMarketplaceWebhooks.readString(payload["installationId"]) ||
      VercelMarketplaceWebhooks.readString(
        VercelMarketplaceWebhooks.readObject(payload["configuration"])["id"],
      )
    );
  }

  private static readObject(value: unknown): JSONObject {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};
  }

  private static readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
