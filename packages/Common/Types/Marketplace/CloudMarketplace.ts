/*
 * The marketplaces OneUptime Cloud is sold through: the three clouds, and
 * Vercel Marketplace, where OneUptime is a native integration.
 *
 * A project bought on one of them is billed by that marketplace instead of by
 * a card on file: the marketplace charges the customer on their cloud (or
 * Vercel) bill, and OneUptime reports what the project used (see
 * ee/Server/CloudMarketplace). The values are stored in the database
 * (Project.billingMarketplace, MarketplaceSubscription.marketplace), so they
 * never change; what people read is getDisplayName.
 */
enum CloudMarketplace {
  AWS = "AWS",
  Azure = "Azure",
  GoogleCloud = "GoogleCloud",
  Vercel = "Vercel",
}

export class CloudMarketplaceUtil {
  public static getAll(): Array<CloudMarketplace> {
    return [
      CloudMarketplace.AWS,
      CloudMarketplace.Azure,
      CloudMarketplace.GoogleCloud,
      CloudMarketplace.Vercel,
    ];
  }

  public static isCloudMarketplace(value: unknown): value is CloudMarketplace {
    return CloudMarketplaceUtil.getAll().includes(value as CloudMarketplace);
  }

  /*
   * The marketplace's own name for itself. Microsoft merged Azure Marketplace
   * and AppSource into "Microsoft Marketplace" in 2025.
   */
  public static getDisplayName(marketplace: CloudMarketplace): string {
    switch (marketplace) {
      case CloudMarketplace.AWS:
        return "AWS Marketplace";
      case CloudMarketplace.Azure:
        return "Microsoft Marketplace";
      case CloudMarketplace.GoogleCloud:
        return "Google Cloud Marketplace";
      case CloudMarketplace.Vercel:
        return "Vercel Marketplace";
    }
  }

  /*
   * Where the customer manages (and cancels) what they bought. These are the
   * marketplaces' own subscription pages, the same for every customer (on
   * Vercel, the team's Integrations page, which lists the OneUptime
   * resources and their invoices).
   */
  public static getManageSubscriptionUrl(
    marketplace: CloudMarketplace,
  ): string {
    switch (marketplace) {
      case CloudMarketplace.AWS:
        return "https://console.aws.amazon.com/marketplace/home#/subscriptions";
      case CloudMarketplace.Azure:
        return "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.SaaS%2Fresources";
      case CloudMarketplace.GoogleCloud:
        return "https://console.cloud.google.com/marketplace/orders";
      case CloudMarketplace.Vercel:
        return "https://vercel.com/dashboard/integrations";
    }
  }
}

export default CloudMarketplace;
