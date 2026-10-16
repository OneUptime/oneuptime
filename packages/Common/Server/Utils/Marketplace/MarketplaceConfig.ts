import {
  AppApiClientUrl,
  AwsMarketplaceAccessKeyId,
  AwsMarketplaceEventsSecret,
  AwsMarketplaceProductCode,
  AwsMarketplaceSecretAccessKey,
  AzureMarketplaceClientId,
  AzureMarketplaceClientSecret,
  AzureMarketplaceTenantId,
  GoogleCloudMarketplacePubSubAudience,
  GoogleCloudMarketplacePubSubServiceAccountEmail,
  GoogleCloudMarketplaceProviderId,
  GoogleCloudMarketplaceServiceAccountKey,
  GoogleCloudMarketplaceServiceName,
  GoogleCloudMarketplaceSignupAudience,
  GoogleCloudMarketplaceUsageMetric,
  Host,
  IsBillingEnabled,
} from "../../EnvironmentConfig";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import GoogleCloudMarketplaceAPI, {
  GoogleServiceAccountKey,
} from "./GoogleCloud/GoogleCloudMarketplaceAPI";

/*
 * Which marketplaces this server sells through, read from its settings
 * (EnvironmentConfig). A marketplace is offered only where billing is
 * enabled - OneUptime Cloud - and only when every setting it needs is
 * present: a half-configured marketplace would take a buyer's purchase and
 * then be unable to activate or bill it.
 */
export default class MarketplaceConfig {
  public static isAwsConfigured(): boolean {
    return (
      IsBillingEnabled &&
      Boolean(
        AwsMarketplaceAccessKeyId &&
          AwsMarketplaceSecretAccessKey &&
          AwsMarketplaceProductCode &&
          AwsMarketplaceEventsSecret,
      )
    );
  }

  public static isAzureConfigured(): boolean {
    return (
      IsBillingEnabled &&
      Boolean(
        AzureMarketplaceTenantId &&
          AzureMarketplaceClientId &&
          AzureMarketplaceClientSecret,
      )
    );
  }

  public static isGoogleCloudConfigured(): boolean {
    return (
      IsBillingEnabled &&
      Boolean(
        GoogleCloudMarketplaceProviderId &&
          GoogleCloudMarketplaceServiceName &&
          GoogleCloudMarketplaceUsageMetric &&
          GoogleCloudMarketplacePubSubServiceAccountEmail &&
          MarketplaceConfig.getGoogleCloudServiceAccountKey(),
      )
    );
  }

  public static isConfigured(marketplace: CloudMarketplace): boolean {
    switch (marketplace) {
      case CloudMarketplace.AWS:
        return MarketplaceConfig.isAwsConfigured();
      case CloudMarketplace.Azure:
        return MarketplaceConfig.isAzureConfigured();
      case CloudMarketplace.GoogleCloud:
        return MarketplaceConfig.isGoogleCloudConfigured();
    }
  }

  public static getGoogleCloudServiceAccountKey(): GoogleServiceAccountKey | null {
    return GoogleCloudMarketplaceAPI.parseServiceAccountKey(
      GoogleCloudMarketplaceServiceAccountKey,
    );
  }

  /*
   * The audience Google puts in the token a buyer arrives with: the domain the
   * product is listed under in Producer Portal, which is this server's host
   * unless set otherwise.
   */
  public static getGoogleCloudSignupAudience(): string {
    return GoogleCloudMarketplaceSignupAudience || Host;
  }

  /*
   * The audience of the token Pub/Sub signs each push delivery with: the push
   * endpoint's own URL - Pub/Sub's default - unless the subscription was
   * created with another.
   */
  public static getGoogleCloudPubSubAudience(): string {
    return (
      GoogleCloudMarketplacePubSubAudience ||
      `${AppApiClientUrl.toString().replace(/\/$/, "")}/marketplace/google-cloud/events`
    );
  }

  // The public URLs each marketplace's seller portal asks for (see RELEASING.md).
  public static getPublicUrls(): Record<string, string> {
    const apiBase: string = AppApiClientUrl.toString().replace(/\/$/, "");

    return {
      awsRegistrationUrl: `${apiBase}/marketplace/aws/register`,
      awsEventsUrl: `${apiBase}/marketplace/aws/events`,
      azureLandingPageUrl: `${apiBase}/marketplace/azure/landing`,
      azureWebhookUrl: `${apiBase}/marketplace/azure/webhook`,
      googleCloudSignupUrl: `${apiBase}/marketplace/google-cloud/signup`,
      googleCloudEventsUrl: `${apiBase}/marketplace/google-cloud/events`,
    };
  }
}
