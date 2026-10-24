import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import GoogleCloudMarketplaceAPI, {
  GoogleServiceAccountKey,
} from "../../CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import AwsContainerMeteringAPI from "./AwsContainerMeteringAPI";
import AwsWorkloadCredentialsProvider from "./AwsWorkloadCredentials";
import AzureKubernetesAppMeteringAPI from "./AzureKubernetesAppMeteringAPI";
import {
  AwsSelfHostedReporter,
  AzureSelfHostedReporter,
  GoogleCloudSelfHostedReporter,
  SELF_HOSTED_USAGE_DIMENSION,
  SelfHostedMarketplaceReporter,
} from "./SelfHostedMarketplaceReporter";

/*
 * Which cloud marketplace a self-hosted OneUptime Enterprise installation was
 * bought on, and what it needs to bill its users there - read from the
 * environment the marketplace editions of the Helm chart set:
 *
 *   ENTERPRISE_MARKETPLACE                         aws | azure | google-cloud
 *
 *   AWS (EKS container product)
 *   ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE        optional; must be one of
 *                                                  AWS_SELF_HOSTED_PRODUCT_CODES
 *   ENTERPRISE_MARKETPLACE_AWS_REGION              optional; EKS sets AWS_REGION
 *   (credentials: the IRSA role EKS puts on the service account)
 *
 *   Microsoft (AKS Kubernetes application; Azure fills these in)
 *   ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID       global.azure.extension.resourceId
 *   ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID           global.azure.marketplace.planId
 *   ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID         global.azure.identity.clientId
 *
 *   Google Cloud (GKE Kubernetes app; from the reporting secret)
 *   ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME
 *   ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID     consumer-id
 *   ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY   reporting-key
 *   ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_ENTITLEMENT_ID  entitlement-id (shown only)
 *
 * None of this grants anything by itself: an installation is billed - and
 * licensed - only once the marketplace accepts a usage report from it.
 */

/*
 * The AWS Marketplace container product(s) a self-hosted installation may
 * bill. AWS asks sellers to keep the product code out of the buyer's hands -
 * a buyer who could choose it could bill a cheaper product - so the code is
 * compiled in, and ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE may only pick one
 * of these (see SELF_HOSTED_RELEASING.md beside RELEASING.md).
 */
export const AWS_SELF_HOSTED_PRODUCT_CODES: ReadonlyArray<string> = [
  // "OneUptime Enterprise (self-hosted)", product prod-5ijwaqpun3coo.
  "c8qvytt92i74r7bhzi6nxunsi",
];

export type SelfHostedMarketplaceEnvironment = Record<
  string,
  string | undefined
>;

export interface AwsSelfHostedMarketplaceSettings {
  marketplace: CloudMarketplace.AWS;
  productCode: string;
  // The Region the pod runs in; AWS takes usage only in that Region.
  region: string;
}

export interface AzureSelfHostedMarketplaceSettings {
  marketplace: CloudMarketplace.Azure;
  resourceId: string;
  planId: string;
  clientId: string;
}

export interface GoogleCloudSelfHostedMarketplaceSettings {
  marketplace: CloudMarketplace.GoogleCloud;
  serviceName: string;
  consumerId: string;
  entitlementId: string | null;
  reportingKey: GoogleServiceAccountKey;
}

export type SelfHostedMarketplaceSettings =
  | AwsSelfHostedMarketplaceSettings
  | AzureSelfHostedMarketplaceSettings
  | GoogleCloudSelfHostedMarketplaceSettings;

/*
 * What the environment says: no marketplace at all, one whose settings are
 * complete, or one whose settings are not (with every problem named, for the
 * log and the admin dialog).
 */
export type SelfHostedMarketplaceConfigResult =
  | { kind: "none" }
  | { kind: "configured"; settings: SelfHostedMarketplaceSettings }
  | {
      kind: "incomplete";
      marketplace: CloudMarketplace | null;
      problems: Array<string>;
    };

const MARKETPLACE_BY_NAME: ReadonlyMap<string, CloudMarketplace> = new Map<
  string,
  CloudMarketplace
>([
  ["aws", CloudMarketplace.AWS],
  ["azure", CloudMarketplace.Azure],
  ["microsoft", CloudMarketplace.Azure],
  ["google-cloud", CloudMarketplace.GoogleCloud],
  ["gcp", CloudMarketplace.GoogleCloud],
]);

const read: (env: SelfHostedMarketplaceEnvironment, name: string) => string = (
  env: SelfHostedMarketplaceEnvironment,
  name: string,
): string => {
  const value: string | undefined = env[name];
  return typeof value === "string" ? value.trim() : "";
};

/*
 * Azure fills the global.azure values in when it installs the extension; the
 * chart ships placeholders. A placeholder is no value.
 */
const isPlaceholder: (value: string) => boolean = (value: string): boolean => {
  return value === "" || value.toUpperCase() === "DONOTMODIFY";
};

export default class SelfHostedMarketplaceConfig {
  // The marketplace an ENTERPRISE_MARKETPLACE value names, or null.
  public static parseMarketplace(value: string): CloudMarketplace | null {
    return MARKETPLACE_BY_NAME.get(value.trim().toLowerCase()) || null;
  }

  public static read(
    env: SelfHostedMarketplaceEnvironment = process.env,
    trustedAwsProductCodes: ReadonlyArray<string> = AWS_SELF_HOSTED_PRODUCT_CODES,
  ): SelfHostedMarketplaceConfigResult {
    const name: string = read(env, "ENTERPRISE_MARKETPLACE");

    if (!name) {
      return { kind: "none" };
    }

    const marketplace: CloudMarketplace | null =
      SelfHostedMarketplaceConfig.parseMarketplace(name);

    if (!marketplace) {
      return {
        kind: "incomplete",
        marketplace: null,
        problems: [
          `ENTERPRISE_MARKETPLACE is "${name}", which is not aws, azure or google-cloud.`,
        ],
      };
    }

    switch (marketplace) {
      case CloudMarketplace.AWS:
        return SelfHostedMarketplaceConfig.readAws(env, trustedAwsProductCodes);
      case CloudMarketplace.Azure:
        return SelfHostedMarketplaceConfig.readAzure(env);
      case CloudMarketplace.GoogleCloud:
        return SelfHostedMarketplaceConfig.readGoogleCloud(env);
      case CloudMarketplace.Vercel:
        // Not reachable from a name (MARKETPLACE_BY_NAME): Vercel sells OneUptime Cloud only.
        return {
          kind: "incomplete",
          marketplace: null,
          problems: [
            "Vercel Marketplace sells OneUptime Cloud only, not self-hosted OneUptime.",
          ],
        };
    }
  }

  // The reporter for configured settings: the marketplace's own API, wired up.
  public static createReporter(
    settings: SelfHostedMarketplaceSettings,
  ): SelfHostedMarketplaceReporter {
    switch (settings.marketplace) {
      case CloudMarketplace.AWS:
        return new AwsSelfHostedReporter({
          api: new AwsContainerMeteringAPI({
            credentials: new AwsWorkloadCredentialsProvider(),
            region: settings.region,
          }),
          productCode: settings.productCode,
        });
      case CloudMarketplace.Azure:
        return new AzureSelfHostedReporter({
          api: new AzureKubernetesAppMeteringAPI({
            clientId: settings.clientId,
          }),
          resourceUri: settings.resourceId,
          planId: settings.planId,
        });
      case CloudMarketplace.GoogleCloud:
        return new GoogleCloudSelfHostedReporter({
          api: new GoogleCloudMarketplaceAPI({
            // Only Service Control is called; the procurement partner ID is not needed.
            providerId: "",
            serviceAccountKey: settings.reportingKey,
            serviceName: settings.serviceName,
          }),
          consumerId: settings.consumerId,
          metricName: SelfHostedMarketplaceConfig.getGoogleCloudMetricName(
            settings.serviceName,
          ),
        });
    }
  }

  public static getGoogleCloudMetricName(serviceName: string): string {
    return `${serviceName}/${SELF_HOSTED_USAGE_DIMENSION}`;
  }

  private static readAws(
    env: SelfHostedMarketplaceEnvironment,
    trustedProductCodes: ReadonlyArray<string>,
  ): SelfHostedMarketplaceConfigResult {
    const problems: Array<string> = [];
    const requested: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE",
    );
    let productCode: string = "";

    if (trustedProductCodes.length === 0) {
      problems.push(
        "This build of OneUptime has no AWS Marketplace product code, so it cannot bill through AWS Marketplace. Use an image from the AWS Marketplace listing.",
      );
    } else if (requested) {
      if (trustedProductCodes.includes(requested)) {
        productCode = requested;
      } else {
        problems.push(
          `ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE "${requested}" is not a OneUptime product on AWS Marketplace.`,
        );
      }
    } else {
      productCode = trustedProductCodes[0]!;
    }

    /*
     * AWS takes usage from EKS only when it is signed with IAM roles for
     * service accounts - not EKS Pod Identity, the node's role or keys.
     */
    if (AwsWorkloadCredentialsProvider.getSource(env) !== "web-identity") {
      problems.push(
        "OneUptime's Kubernetes service account has no IAM role (IAM roles for service accounts). AWS Marketplace takes usage only from a pod with one: create the role with the AWSMarketplaceMeteringFullAccess policy and annotate the service account with eks.amazonaws.com/role-arn.",
      );
    }

    const region: string | null = AwsWorkloadCredentialsProvider.getRegion(
      env,
      read(env, "ENTERPRISE_MARKETPLACE_AWS_REGION") || null,
    );

    if (!region) {
      problems.push(
        "The pod has no AWS Region (AWS_REGION). EKS sets it on pods whose service account has an IAM role; ENTERPRISE_MARKETPLACE_AWS_REGION can name it instead.",
      );
    }

    if (problems.length > 0 || !region) {
      return {
        kind: "incomplete",
        marketplace: CloudMarketplace.AWS,
        problems,
      };
    }

    return {
      kind: "configured",
      settings: {
        marketplace: CloudMarketplace.AWS,
        productCode: productCode,
        region: region,
      },
    };
  }

  private static readAzure(
    env: SelfHostedMarketplaceEnvironment,
  ): SelfHostedMarketplaceConfigResult {
    const resourceId: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID",
    );
    const planId: string = read(env, "ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID");
    const clientId: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID",
    );
    const problems: Array<string> = [];

    if (isPlaceholder(resourceId)) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID (global.azure.extension.resourceId) is not set. Azure sets it when it installs OneUptime from Microsoft Marketplace.",
      );
    } else if (!resourceId.toLowerCase().startsWith("/subscriptions/")) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID must be the ARM resource ID of the OneUptime Kubernetes application.",
      );
    }

    if (isPlaceholder(planId)) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID (global.azure.marketplace.planId) is not set.",
      );
    }

    if (isPlaceholder(clientId)) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID (global.azure.identity.clientId) is not set.",
      );
    }

    if (problems.length > 0) {
      return {
        kind: "incomplete",
        marketplace: CloudMarketplace.Azure,
        problems,
      };
    }

    return {
      kind: "configured",
      settings: {
        marketplace: CloudMarketplace.Azure,
        resourceId,
        planId,
        clientId,
      },
    };
  }

  private static readGoogleCloud(
    env: SelfHostedMarketplaceEnvironment,
  ): SelfHostedMarketplaceConfigResult {
    const serviceName: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME",
    );
    const consumerId: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID",
    );
    const entitlementId: string = read(
      env,
      "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_ENTITLEMENT_ID",
    );
    const reportingKey: GoogleServiceAccountKey | null =
      GoogleCloudMarketplaceAPI.parseServiceAccountKey(
        read(env, "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY"),
      );
    const problems: Array<string> = [];

    if (!serviceName) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME (the product's Service Control service) is not set.",
      );
    }

    if (!consumerId) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID is not set: mount the reporting secret Google Cloud Marketplace created for this deployment (its consumer-id key).",
      );
    }

    if (!reportingKey) {
      problems.push(
        "ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY is not a service account key: mount the reporting secret's reporting-key.",
      );
    }

    if (problems.length > 0 || !reportingKey) {
      return {
        kind: "incomplete",
        marketplace: CloudMarketplace.GoogleCloud,
        problems,
      };
    }

    return {
      kind: "configured",
      settings: {
        marketplace: CloudMarketplace.GoogleCloud,
        serviceName,
        consumerId,
        entitlementId: entitlementId || null,
        reportingKey,
      },
    };
  }
}
