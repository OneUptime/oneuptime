import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import AwsMarketplaceAdapter from "./AWS/AwsMarketplaceAdapter";
import AzureMarketplaceAdapter from "./Azure/AzureMarketplaceAdapter";
import GoogleCloudMarketplaceAdapter from "./GoogleCloud/GoogleCloudMarketplaceAdapter";
import MarketplaceAdapter from "./MarketplaceAdapter";
import VercelMarketplaceAdapter from "./Vercel/VercelMarketplaceAdapter";

/*
 * One adapter per marketplace, made on first use: each holds an API client
 * that caches its access token, and there is no reason to build one for a
 * marketplace this server does not sell through.
 */
export default class MarketplaceAdapters {
  private static adapters: Map<CloudMarketplace, MarketplaceAdapter> =
    new Map();

  public static get(marketplace: CloudMarketplace): MarketplaceAdapter {
    const existing: MarketplaceAdapter | undefined =
      MarketplaceAdapters.adapters.get(marketplace);

    if (existing) {
      return existing;
    }

    const adapter: MarketplaceAdapter = MarketplaceAdapters.create(marketplace);
    MarketplaceAdapters.adapters.set(marketplace, adapter);
    return adapter;
  }

  // For tests: the adapter every caller gets for a marketplace from now on.
  public static set(
    marketplace: CloudMarketplace,
    adapter: MarketplaceAdapter | null,
  ): void {
    if (adapter) {
      MarketplaceAdapters.adapters.set(marketplace, adapter);
    } else {
      MarketplaceAdapters.adapters.delete(marketplace);
    }
  }

  private static create(marketplace: CloudMarketplace): MarketplaceAdapter {
    switch (marketplace) {
      case CloudMarketplace.AWS:
        return new AwsMarketplaceAdapter();
      case CloudMarketplace.Azure:
        return new AzureMarketplaceAdapter();
      case CloudMarketplace.GoogleCloud:
        return new GoogleCloudMarketplaceAdapter();
      case CloudMarketplace.Vercel:
        return new VercelMarketplaceAdapter();
    }
  }
}
