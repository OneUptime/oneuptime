import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceConfig from "../MarketplaceConfig";
import { VercelSecret } from "./VercelMarketplaceAPI";
import VercelMarketplacePlans, {
  VercelBillingPlan,
} from "./VercelMarketplacePlans";

/*
 * A OneUptime resource on Vercel: what a Vercel team adds when it adds
 * OneUptime, each one a OneUptime project of its own. Its billing record is
 * a MarketplaceSubscription (marketplace Vercel): externalSubscriptionId is
 * the resource's ID, externalCustomerId the installation's, externalPlanId
 * the Vercel plan, and details holds what Vercel shows of the resource - its
 * name and settings - and the OneUptime records it was given.
 *
 * Its secrets are the environment variables Vercel gives every project
 * connected to it: the OpenTelemetry exporter settings @vercel/otel (and
 * any OpenTelemetry SDK) read, so traces reach the resource's project with
 * no setup, and the ingestion key on its own, which the log and trace
 * drains send as a header ({{ONEUPTIME_TELEMETRY_INGESTION_KEY}} in the
 * Integration Console).
 */

export const VERCEL_SECRET_NAMES: {
  endpoint: string;
  headers: string;
  protocol: string;
  ingestionKey: string;
} = {
  endpoint: "OTEL_EXPORTER_OTLP_ENDPOINT",
  headers: "OTEL_EXPORTER_OTLP_HEADERS",
  protocol: "OTEL_EXPORTER_OTLP_PROTOCOL",
  ingestionKey: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
};

/*
 * The resource's settings, asked for when it is added (the product's
 * metadata schema in the Integration Console). Both default to on: a
 * resource made without them - the CLI, an old schema - gets both.
 */
export const VERCEL_METADATA_KEYS: {
  monitorProductionDomains: string;
  createStatusPage: string;
} = {
  monitorProductionDomains: "monitorProductionDomains",
  createStatusPage: "createStatusPage",
};

export interface VercelResourceDetails {
  name: string;
  productId: string;
  metadata: JSONObject;
  // The ingestion key whose value the resource's secrets carry.
  telemetryIngestionKeyId?: string | undefined;
  // The status page made for the resource, if one was.
  statusPageId?: string | undefined;
  // The Vercel user who added it.
  provisionedByVercelUserId?: string | undefined;
}

// Vercel's resource states (Partner API Resource.status).
export type VercelResourceStatus =
  | "ready"
  | "pending"
  | "onboarding"
  | "suspended"
  | "resumed"
  | "uninstalled"
  | "error";

export interface VercelResourceResponse {
  id: string;
  productId: string;
  name: string;
  metadata: JSONObject;
  status: VercelResourceStatus;
  billingPlan?: VercelBillingPlan | undefined;
}

export default class VercelResource {
  public static readDetails(
    purchase: MarketplaceSubscription,
  ): VercelResourceDetails {
    const details: JSONObject = purchase.details || {};
    const metadata: unknown = details["metadata"];

    return {
      name:
        typeof details["name"] === "string" && details["name"]
          ? details["name"]
          : "OneUptime",
      productId:
        typeof details["productId"] === "string"
          ? details["productId"]
          : purchase.externalOfferId || "",
      metadata:
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as JSONObject)
          : {},
      telemetryIngestionKeyId:
        typeof details["telemetryIngestionKeyId"] === "string"
          ? details["telemetryIngestionKeyId"]
          : undefined,
      statusPageId:
        typeof details["statusPageId"] === "string"
          ? details["statusPageId"]
          : undefined,
      provisionedByVercelUserId:
        typeof details["provisionedByVercelUserId"] === "string"
          ? details["provisionedByVercelUserId"]
          : undefined,
    };
  }

  public static toDetailsJson(details: VercelResourceDetails): JSONObject {
    const json: JSONObject = {
      name: details.name,
      productId: details.productId,
      metadata: details.metadata,
    };

    if (details.telemetryIngestionKeyId) {
      json["telemetryIngestionKeyId"] = details.telemetryIngestionKeyId;
    }

    if (details.statusPageId) {
      json["statusPageId"] = details.statusPageId;
    }

    if (details.provisionedByVercelUserId) {
      json["provisionedByVercelUserId"] = details.provisionedByVercelUserId;
    }

    return json;
  }

  // A boolean setting of the resource; on unless it was turned off.
  public static isSettingOn(metadata: JSONObject, key: string): boolean {
    const value: unknown = metadata[key];
    return !(value === false || value === "false");
  }

  /*
   * Only the settings OneUptime knows, and only as booleans: metadata is
   * written by whoever adds the resource and is shown back to them, so
   * nothing else from it is kept.
   */
  public static readMetadata(value: unknown): JSONObject {
    const metadata: JSONObject = {};

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return metadata;
    }

    for (const key of Object.values(VERCEL_METADATA_KEYS)) {
      const setting: unknown = (value as Record<string, unknown>)[key];

      if (typeof setting === "boolean") {
        metadata[key] = setting;
      } else if (setting === "true" || setting === "false") {
        metadata[key] = setting === "true";
      }
    }

    return metadata;
  }

  // The environment variables of the projects connected to the resource.
  public static getSecrets(ingestionKey: string): Array<VercelSecret> {
    const origin: string = MarketplaceConfig.getPublicOrigin();

    return [
      { name: VERCEL_SECRET_NAMES.endpoint, value: `${origin}/otlp` },
      {
        name: VERCEL_SECRET_NAMES.headers,
        value: `x-oneuptime-token=${ingestionKey}`,
      },
      { name: VERCEL_SECRET_NAMES.protocol, value: "http/protobuf" },
      { name: VERCEL_SECRET_NAMES.ingestionKey, value: ingestionKey },
    ];
  }

  public static toVercelStatus(
    status: MarketplaceSubscriptionStatus | undefined,
  ): VercelResourceStatus {
    switch (status) {
      case MarketplaceSubscriptionStatus.Active:
        return "ready";
      case MarketplaceSubscriptionStatus.Suspended:
        return "suspended";
      case MarketplaceSubscriptionStatus.Cancelled:
        return "uninstalled";
      case MarketplaceSubscriptionStatus.Pending:
      default:
        return "pending";
    }
  }

  // The resource as Vercel's Get Resource and Update Resource answers describe it.
  public static toResponse(
    purchase: MarketplaceSubscription,
  ): VercelResourceResponse {
    const details: VercelResourceDetails = VercelResource.readDetails(purchase);
    const plan: SubscriptionPlan | undefined = VercelMarketplacePlans.findPlan(
      purchase.externalPlanId,
    );

    return {
      id: purchase.externalSubscriptionId!,
      productId: details.productId,
      name: details.name,
      metadata: details.metadata,
      status: VercelResource.toVercelStatus(purchase.status),
      ...(plan
        ? { billingPlan: VercelMarketplacePlans.toVercelPlan(plan) }
        : {}),
    };
  }
}
