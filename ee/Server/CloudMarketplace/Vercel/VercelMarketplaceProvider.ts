import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import logger from "Common/Server/Utils/Logger";
import { VercelMarketplaceCaller } from "./VercelMarketplaceAuth";
import VercelMarketplaceBilling from "./VercelMarketplaceBilling";
import VercelMarketplaceMonitors from "./VercelMarketplaceMonitors";
import VercelMarketplacePlans, {
  VercelBillingPlan,
} from "./VercelMarketplacePlans";
import VercelMarketplaceResources, {
  ProvisionedVercelResource,
} from "./VercelMarketplaceResources";
import VercelResource, {
  VERCEL_METADATA_KEYS,
  VercelResourceDetails,
} from "./VercelResource";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * The provider API OneUptime hosts for Vercel Marketplace - what Vercel
 * calls when a team installs OneUptime, adds, changes or deletes a OneUptime
 * resource, or uninstalls
 * (https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner).
 * The routes (Server/API/VercelMarketplaceProviderAPI) check the caller's
 * token and hand the request here.
 *
 * Every refusal is a VercelProviderError, answered in Vercel's error shape;
 * its user message is shown to the person in the Vercel dashboard.
 */

export type VercelProviderErrorCode =
  | "validation_error"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "unprocessable";

const STATUS_OF_CODE: Record<VercelProviderErrorCode, number> = {
  validation_error: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
};

export class VercelProviderError extends Error {
  public readonly code: VercelProviderErrorCode;
  public readonly userMessage: string | undefined;
  public readonly fields: Array<{ key: string; message: string }> | undefined;

  public constructor(data: {
    code: VercelProviderErrorCode;
    message: string;
    userMessage?: string | undefined;
    fields?: Array<{ key: string; message: string }> | undefined;
  }) {
    super(data.message);
    this.name = "VercelProviderError";
    this.code = data.code;
    this.userMessage = data.userMessage;
    this.fields = data.fields;
  }

  public getStatus(): number {
    return STATUS_OF_CODE[this.code];
  }

  public toJSON(): JSONObject {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.userMessage ? { user: { message: this.userMessage } } : {}),
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

const MAX_RESOURCE_NAME_LENGTH: number = 100;
const PROVISION_LOCK_NAMESPACE: string = "vercel-marketplace-provision";
const IDEMPOTENCY_NAMESPACE: string = "vercel-marketplace-idempotency";
const IDEMPOTENCY_TTL_IN_SECONDS: number = 24 * 60 * 60;
const MAX_IDEMPOTENCY_KEY_LENGTH: number = 200;

export default class VercelMarketplaceProvider {
  /*
   * PUT /v1/installations/{installationId}: the team installed OneUptime, or
   * Vercel brings the installation up to date (a new token, new scopes, a
   * new contact). The token is kept, encrypted: it never expires, and every
   * call OneUptime makes to Vercel for this team is made with it.
   */
  public static async upsertInstallation(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    body: JSONObject;
  }): Promise<void> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);

    const credentials: unknown = data.body["credentials"];
    const accessToken: unknown =
      credentials && typeof credentials === "object"
        ? (credentials as JSONObject)["access_token"]
        : undefined;
    const tokenType: unknown =
      credentials && typeof credentials === "object"
        ? (credentials as JSONObject)["token_type"]
        : undefined;

    if (typeof accessToken !== "string" || !accessToken) {
      throw new VercelProviderError({
        code: "validation_error",
        message: "credentials.access_token is required.",
        fields: [
          { key: "credentials", message: "An access token is required." },
        ],
      });
    }

    const account: JSONObject =
      data.body["account"] && typeof data.body["account"] === "object"
        ? (data.body["account"] as JSONObject)
        : {};
    const contact: JSONObject =
      account["contact"] && typeof account["contact"] === "object"
        ? (account["contact"] as JSONObject)
        : {};

    const scopes: Array<string> = Array.isArray(data.body["scopes"])
      ? (data.body["scopes"] as Array<unknown>).filter(
          (scope: unknown): scope is string => {
            return typeof scope === "string" && Boolean(scope);
          },
        )
      : [];

    const acceptedPolicies: JSONObject =
      data.body["acceptedPolicies"] &&
      typeof data.body["acceptedPolicies"] === "object" &&
      !Array.isArray(data.body["acceptedPolicies"])
        ? (data.body["acceptedPolicies"] as JSONObject)
        : {};

    // What Vercel says now; a detail it leaves out is cleared, not kept from before.
    const fields: Record<string, unknown> = {
      vercelAccountId: data.caller.accountId || null,
      accessToken: accessToken,
      tokenType:
        typeof tokenType === "string" && tokenType ? tokenType : "Bearer",
      scopes: scopes,
      acceptedPolicies: acceptedPolicies,
      accountName: VercelMarketplaceProvider.clip(account["name"], 500) || null,
      accountUrl: VercelMarketplaceProvider.clip(account["url"], 500) || null,
      contactEmail:
        VercelMarketplaceProvider.readEmail(contact["email"]) || null,
      contactName: VercelMarketplaceProvider.clip(contact["name"], 500) || null,
    };

    const existing: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        data.installationId,
      );

    if (existing) {
      if (existing.status !== VercelInstallationStatus.Active) {
        throw new VercelProviderError({
          code: "conflict",
          message: "This installation was uninstalled.",
          userMessage:
            "OneUptime was uninstalled from this team. Install it again from the Vercel Marketplace.",
        });
      }

      await VercelMarketplaceInstallationService.updateOneById({
        id: existing.id!,
        data: fields as QueryDeepPartialEntity<VercelMarketplaceInstallation>,
        props: { isRoot: true },
      });

      return;
    }

    const installation: VercelMarketplaceInstallation =
      new VercelMarketplaceInstallation();

    for (const [key, value] of Object.entries(fields)) {
      if (value !== null) {
        (installation as unknown as Record<string, unknown>)[key] = value;
      }
    }

    installation.installationId = data.installationId;
    installation.status = VercelInstallationStatus.Active;

    try {
      await VercelMarketplaceInstallationService.create({
        data: installation,
        props: { isRoot: true },
      });
    } catch (err) {
      // Vercel sent the same upsert twice at once: the other one made it.
      const made: VercelMarketplaceInstallation | null =
        await VercelMarketplaceInstallationService.findByInstallationId(
          data.installationId,
        );

      if (!made) {
        throw err;
      }

      await VercelMarketplaceInstallationService.updateOneById({
        id: made.id!,
        data: fields as QueryDeepPartialEntity<VercelMarketplaceInstallation>,
        props: { isRoot: true },
      });
    }

    logger.info(
      `Vercel installation ${data.installationId} (${String(fields["accountName"] || data.caller.accountId)}) installed OneUptime.`,
    );
  }

  // GET /v1/installations/{installationId}: nothing is billed at installation level.
  public static async getInstallation(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
  }): Promise<JSONObject> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    await VercelMarketplaceProvider.getInstallationRecord(data.installationId);
    return {};
  }

  /*
   * DELETE /v1/installations/{installationId}: the team uninstalled
   * OneUptime. Vercel does not delete the resources one by one, so this is
   * where they end: their telemetry stops now, and the billing job deletes
   * their projects - each billed first for what it used since its last
   * hourly report - sends the final invoice and tells Vercel billing is
   * finalized. Until then the installation is "delete pending" on Vercel
   * (finalized: false); with nothing left to bill it ends at once.
   */
  public static async deleteInstallation(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
  }): Promise<{ finalized: boolean }> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    VercelMarketplaceProvider.assertAdminOrSystem(data.caller);

    const installation: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        data.installationId,
      );

    if (!installation) {
      return { finalized: true };
    }

    const finalized: boolean =
      await VercelMarketplaceBilling.requestDeletion(installation);

    return { finalized: finalized };
  }

  // GET /v1/products/{productSlug}/plans, and a resource's plans.
  public static listPlans(): { plans: Array<VercelBillingPlan> } {
    return { plans: VercelMarketplacePlans.getPlans() };
  }

  /*
   * POST /v1/installations/{installationId}/resources: the team adds a
   * OneUptime resource. It becomes a OneUptime project of its own, owned by
   * the person who added it, on the plan they chose and billed through
   * Vercel, with an ingestion key whose value is returned as the resource's
   * secrets - the environment variables of every Vercel project connected
   * to it - and, unless they turned it off, a public status page.
   *
   * Vercel sends a provisioning again, with the same Idempotency-Key, when
   * it did not get an answer. The first one is remembered by that key, under
   * a lock per installation, so a retry finishes and answers for the same
   * resource rather than making a second project.
   */
  public static async provisionResource(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    body: JSONObject;
    idempotencyKey?: string | undefined;
  }): Promise<JSONObject> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    VercelMarketplaceProvider.assertAdminUser(data.caller);

    const installation: VercelMarketplaceInstallation =
      await VercelMarketplaceProvider.getActiveInstallation(
        data.installationId,
      );

    const productId: unknown = data.body["productId"];
    const name: string =
      typeof data.body["name"] === "string" ? data.body["name"].trim() : "";
    const plan: SubscriptionPlan | undefined = VercelMarketplacePlans.findPlan(
      typeof data.body["billingPlanId"] === "string"
        ? data.body["billingPlanId"]
        : undefined,
    );

    const fields: Array<{ key: string; message: string }> = [];

    if (!name) {
      fields.push({ key: "name", message: "Enter a name for the resource." });
    } else if (name.length > MAX_RESOURCE_NAME_LENGTH) {
      fields.push({
        key: "name",
        message: `A name can be at most ${MAX_RESOURCE_NAME_LENGTH} characters.`,
      });
    }

    if (!plan) {
      fields.push({
        key: "billingPlanId",
        message: "Choose one of OneUptime's plans.",
      });
    }

    if (typeof productId !== "string" || !productId) {
      fields.push({ key: "productId", message: "The product is required." });
    }

    if (fields.length > 0) {
      throw new VercelProviderError({
        code: "validation_error",
        message: "The resource cannot be provisioned as asked.",
        fields: fields,
      });
    }

    const idempotencyKey: string | null =
      VercelMarketplaceProvider.readIdempotencyKey(data.idempotencyKey);

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: data.installationId,
      namespace: PROVISION_LOCK_NAMESPACE,
      lockTimeout: 120_000,
      acquireTimeout: 60_000,
    });

    try {
      const earlier: MarketplaceSubscription | null = idempotencyKey
        ? await VercelMarketplaceProvider.findByIdempotencyKey(
            data.installationId,
            idempotencyKey,
          )
        : null;

      const owner: User = await VercelMarketplaceProvider.findOrCreateOwner(
        data.caller,
      );

      const resourceId: string =
        earlier?.externalSubscriptionId || ObjectID.generate().toString();

      if (idempotencyKey && !earlier) {
        await GlobalCache.setString(
          IDEMPOTENCY_NAMESPACE,
          `${data.installationId}:${idempotencyKey}`,
          resourceId,
          { expiresInSeconds: IDEMPOTENCY_TTL_IN_SECONDS },
        );
      }

      const provisioned: ProvisionedVercelResource =
        await VercelMarketplaceResources.provision({
          installation: installation,
          purchase: earlier || undefined,
          resourceId: resourceId,
          productId: productId as string,
          name: name,
          metadata:
            data.body["metadata"] && typeof data.body["metadata"] === "object"
              ? (data.body["metadata"] as Record<string, unknown>)
              : {},
          plan: plan!,
          ownerUserId: owner.id!,
          ownerEmail: owner.email?.toString(),
          vercelUserId: data.caller.userId,
        });

      logger.info(
        `Vercel installation ${data.installationId} provisioned resource ${resourceId} as project ${provisioned.purchase.projectId?.toString()}.`,
      );

      return {
        ...VercelResource.toResponse(provisioned.purchase),
        secrets: provisioned.secrets,
      } as unknown as JSONObject;
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }
  }

  // GET /v1/installations/{installationId}/resources/{resourceId}
  public static async getResource(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    resourceId: string;
  }): Promise<JSONObject> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);

    const purchase: MarketplaceSubscription =
      await VercelMarketplaceProvider.getResourceRecord(data);

    return VercelResource.toResponse(purchase) as unknown as JSONObject;
  }

  /*
   * PATCH /v1/installations/{installationId}/resources/{resourceId}: the team
   * renamed the resource, changed its settings or its plan in Vercel. The
   * project is renamed with it and moved to the plan; turning the domain
   * monitors on makes the ones still missing.
   */
  public static async updateResource(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    resourceId: string;
    body: JSONObject;
  }): Promise<JSONObject> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    VercelMarketplaceProvider.assertAdminUser(data.caller);

    let purchase: MarketplaceSubscription =
      await VercelMarketplaceProvider.getResourceRecord(data);

    if (purchase.status === MarketplaceSubscriptionStatus.Cancelled) {
      throw new VercelProviderError({
        code: "conflict",
        message: "This resource was deleted.",
      });
    }

    let details: VercelResourceDetails = VercelResource.readDetails(purchase);
    const wereMonitorsOn: boolean = VercelResource.isSettingOn(
      details.metadata,
      VERCEL_METADATA_KEYS.monitorProductionDomains,
    );

    if (data.body["name"] !== undefined) {
      const name: string =
        typeof data.body["name"] === "string" ? data.body["name"].trim() : "";

      if (!name || name.length > MAX_RESOURCE_NAME_LENGTH) {
        throw new VercelProviderError({
          code: "validation_error",
          message: "The name is not valid.",
          fields: [
            {
              key: "name",
              message: `Enter a name of 1 to ${MAX_RESOURCE_NAME_LENGTH} characters.`,
            },
          ],
        });
      }

      if (name !== details.name && purchase.projectId) {
        await ProjectService.updateOneById({
          id: purchase.projectId,
          data: { name: name },
          props: { isRoot: true },
        });
      }

      details = { ...details, name: name };
    }

    if (data.body["metadata"] !== undefined) {
      details = {
        ...details,
        metadata: {
          ...details.metadata,
          ...VercelResource.readMetadata(data.body["metadata"]),
        },
      };
    }

    purchase = await VercelMarketplaceResources.saveDetails(purchase, details);

    if (typeof data.body["billingPlanId"] === "string") {
      const plan: SubscriptionPlan | undefined =
        VercelMarketplacePlans.findPlan(data.body["billingPlanId"]);

      if (!plan) {
        throw new VercelProviderError({
          code: "validation_error",
          message: "The plan is not one of OneUptime's.",
          fields: [
            {
              key: "billingPlanId",
              message: "Choose one of OneUptime's plans.",
            },
          ],
        });
      }

      const vercelPlanId: string = VercelMarketplacePlans.getVercelPlanId(plan);

      const projectId: ObjectID | undefined = purchase.projectId;

      if (vercelPlanId !== purchase.externalPlanId && projectId) {
        // On the purchase first, so the plan change is not sent back to Vercel.
        purchase = await MarketplacePurchases.updatePurchase(purchase, {
          externalPlanId: vercelPlanId,
        });

        await ProjectService.changePlan({
          projectId: projectId,
          paymentProviderPlanId: plan.getMonthlyPlanId(),
        });
      }
    }

    if (
      !wereMonitorsOn &&
      VercelResource.isSettingOn(
        details.metadata,
        VERCEL_METADATA_KEYS.monitorProductionDomains,
      )
    ) {
      await VercelMarketplaceMonitors.addMissingMonitors(purchase);
    }

    return VercelResource.toResponse(purchase) as unknown as JSONObject;
  }

  /*
   * DELETE /v1/installations/{installationId}/resources/{resourceId}: the
   * team deleted the resource. Its project is deleted after its final usage
   * is billed (VercelMarketplaceResources.deprovision).
   */
  public static async deleteResource(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    resourceId: string;
  }): Promise<void> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    VercelMarketplaceProvider.assertAdminOrSystem(data.caller);

    const purchase: MarketplaceSubscription | null =
      await VercelMarketplaceResources.findPurchase(data);

    if (!purchase) {
      return;
    }

    await VercelMarketplaceResources.deprovision(purchase);

    logger.info(
      `Vercel installation ${data.installationId} deleted resource ${data.resourceId}.`,
    );
  }

  /*
   * POST .../resources/{resourceId}/secrets/rotate: new secrets, at once
   * (sync). The old key keeps working for the hours Vercel asks.
   */
  public static async rotateSecrets(data: {
    caller: VercelMarketplaceCaller;
    installationId: string;
    resourceId: string;
    body: JSONObject;
  }): Promise<JSONObject> {
    VercelMarketplaceProvider.assertCallerOf(data.caller, data.installationId);
    VercelMarketplaceProvider.assertAdminOrSystem(data.caller);

    const purchase: MarketplaceSubscription =
      await VercelMarketplaceProvider.getResourceRecord(data);

    if (
      purchase.status === MarketplaceSubscriptionStatus.Cancelled ||
      !purchase.projectId
    ) {
      throw new VercelProviderError({
        code: "conflict",
        message: "This resource was deleted.",
      });
    }

    const delay: unknown = data.body["delayOldSecretsExpirationHours"];

    const secrets: Awaited<
      ReturnType<typeof VercelMarketplaceResources.rotateSecrets>
    > = await VercelMarketplaceResources.rotateSecrets({
      purchase: purchase,
      keepOldKeyForHours:
        typeof delay === "number" && Number.isFinite(delay) ? delay : 0,
    });

    return { sync: true, secrets: secrets } as unknown as JSONObject;
  }

  /*
   * A token for one installation is never used for another: the path's
   * installation must be the one Vercel signed the token for.
   */
  public static assertCallerOf(
    caller: VercelMarketplaceCaller,
    installationId: string,
  ): void {
    if (!caller.installationId || caller.installationId !== installationId) {
      throw new VercelProviderError({
        code: "forbidden",
        message: "The token is not for this installation.",
      });
    }
  }

  /*
   * Vercel's USER role is its read-only roles (Billing, Viewer). Adding,
   * changing and deleting a resource takes an ADMIN, or Vercel itself.
   */
  private static assertAdminOrSystem(caller: VercelMarketplaceCaller): void {
    if (caller.kind === "user" && caller.userRole !== "ADMIN") {
      throw new VercelProviderError({
        code: "forbidden",
        message: "Only a team admin may do this.",
        userMessage: "Only an owner or member of the Vercel team can do this.",
      });
    }
  }

  private static assertAdminUser(caller: VercelMarketplaceCaller): void {
    if (caller.kind !== "user") {
      throw new VercelProviderError({
        code: "forbidden",
        message: "This call needs a user token.",
      });
    }

    VercelMarketplaceProvider.assertAdminOrSystem(caller);
  }

  private static async getInstallationRecord(
    installationId: string,
  ): Promise<VercelMarketplaceInstallation> {
    const installation: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        installationId,
      );

    if (!installation) {
      throw new VercelProviderError({
        code: "not_found",
        message: "Installation not found.",
      });
    }

    return installation;
  }

  private static async getActiveInstallation(
    installationId: string,
  ): Promise<VercelMarketplaceInstallation> {
    const installation: VercelMarketplaceInstallation =
      await VercelMarketplaceProvider.getInstallationRecord(installationId);

    if (installation.status !== VercelInstallationStatus.Active) {
      throw new VercelProviderError({
        code: "conflict",
        message: "This installation was uninstalled.",
        userMessage:
          "OneUptime was uninstalled from this team. Install it again from the Vercel Marketplace.",
      });
    }

    return installation;
  }

  private static async getResourceRecord(data: {
    installationId: string;
    resourceId: string;
  }): Promise<MarketplaceSubscription> {
    const purchase: MarketplaceSubscription | null =
      await VercelMarketplaceResources.findPurchase(data);

    if (!purchase) {
      throw new VercelProviderError({
        code: "not_found",
        message: "Resource not found.",
      });
    }

    return purchase;
  }

  private static async findByIdempotencyKey(
    installationId: string,
    idempotencyKey: string,
  ): Promise<MarketplaceSubscription | null> {
    const resourceId: string | null = await GlobalCache.getString(
      IDEMPOTENCY_NAMESPACE,
      `${installationId}:${idempotencyKey}`,
    );

    if (!resourceId) {
      return null;
    }

    return await VercelMarketplaceResources.findPurchase({
      installationId: installationId,
      resourceId: resourceId,
    });
  }

  /*
   * The OneUptime user who owns the new resource's project: the one with
   * the email address Vercel vouches for, or a new one with it. Nobody signs
   * in here - the person signs in later, from Vercel - so an existing,
   * verified account is used as it is, whatever its sign-in method.
   */
  private static async findOrCreateOwner(
    caller: VercelMarketplaceCaller,
  ): Promise<User> {
    if (!caller.userEmail || !caller.isUserEmailVerified) {
      throw new VercelProviderError({
        code: "forbidden",
        message: "The user's email address is not verified.",
        userMessage:
          "OneUptime needs your verified email address. Verify the email address of your Vercel account, then add OneUptime again.",
      });
    }

    let email: Email;

    try {
      email = new Email(caller.userEmail);
    } catch {
      throw new VercelProviderError({
        code: "validation_error",
        message: "The user's email address is not valid.",
      });
    }

    const existing: User | null = await UserService.findOneBy({
      query: { email: email },
      select: {
        _id: true,
        email: true,
        isBlocked: true,
        isEmailVerified: true,
      },
      props: { isRoot: true },
    });

    if (existing) {
      if (existing.isBlocked) {
        throw new VercelProviderError({
          code: "forbidden",
          message: "The OneUptime account is blocked.",
          userMessage:
            "The OneUptime account with your email address is blocked. Contact OneUptime support.",
        });
      }

      /*
       * An account nobody has verified may have been registered by someone
       * other than the address's owner: the project is not given to it
       * until its owner has proved the mailbox, as every sign-in requires.
       */
      if (!existing.isEmailVerified) {
        throw new VercelProviderError({
          code: "forbidden",
          message: "The OneUptime account's email address is not verified.",
          userMessage:
            "A OneUptime account with your email address exists, but its email address is not verified. Sign in at oneuptime.com and verify it, then add OneUptime again.",
        });
      }

      return existing;
    }

    if (await DatabaseConfig.shouldDisableSignup()) {
      throw new VercelProviderError({
        code: "forbidden",
        message: "Sign up is disabled.",
        userMessage: "OneUptime is not taking new accounts right now.",
      });
    }

    const created: User = await UserService.createByEmail({
      email: email,
      name: caller.userName ? new Name(caller.userName) : undefined,
      isEmailVerified: true,
      generateRandomPassword: true,
      props: { isRoot: true },
    });

    return created;
  }

  private static readIdempotencyKey(value: unknown): string | null {
    return typeof value === "string" &&
      value.trim() &&
      value.length <= MAX_IDEMPOTENCY_KEY_LENGTH
      ? value.trim()
      : null;
  }

  private static clip(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }

    return value.trim().substring(0, maxLength);
  }

  private static readEmail(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim() || value.length > 100) {
      return undefined;
    }

    try {
      return new Email(value.trim()).toString();
    } catch {
      return undefined;
    }
  }
}
