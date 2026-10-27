import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";

/*
 * WHERE ONEUPTIME IS SOLD ON THE CLOUD MARKETPLACES, AS DATA.
 *
 * AWS Marketplace, Microsoft Marketplace and Google Cloud Marketplace each
 * sell two OneUptime products:
 *
 * - OneUptime Cloud, which OneUptime runs, billed through the marketplace at
 *   the prices on /pricing (Common/Server/Utils/Marketplace/RELEASING.md);
 * - OneUptime Enterprise, which the buyer runs in their own Kubernetes
 *   cluster, billed per user by the hour, its marketplace subscription its
 *   license (SELF_HOSTED_RELEASING.md, /docs/installation/cloud-marketplaces).
 *
 * A marketplace is not a reseller: the buyer still buys OneUptime from
 * OneUptime, through the cloud account they already have, and pays for it
 * on their cloud bill. So the Resellers page shows the marketplaces in a
 * section of their own (#cloud-marketplaces), after the resellers, and the
 * pricing and self-hosted pages point at the listings of their own product.
 * All of them, and the Resellers page's markdown variant, read this list.
 *
 * A listing's address goes here only once the marketplace shows the listing
 * to everyone, and only as the marketplace itself links to it: never one put
 * together from a product ID. Until then it is null, and the Resellers page
 * says "Coming soon" without a link. When a listing goes public, set its
 * address here, in the marketplace guide's list of public listings, and -
 * for OneUptime Enterprise - in the Listing row of the buyer's guide,
 * /docs/installation/cloud-marketplaces, in every language
 * (Tests/CloudMarketplaces holds all three to this list).
 */

export type CloudMarketplaceProduct = "cloud" | "enterprise";

// The order a marketplace's card lists its products in.
export const CloudMarketplaceProducts: ReadonlyArray<CloudMarketplaceProduct> =
  ["cloud", "enterprise"];

export interface CloudMarketplaceEntry {
  marketplace: CloudMarketplace;
  /*
   * The cloud's Kubernetes service OneUptime Enterprise installs on, as
   * /docs/installation/cloud-marketplaces names it.
   */
  kubernetesService: string;
  // Each product's public listing on this marketplace, or null.
  listingUrls: Record<CloudMarketplaceProduct, string | null>;
}

/*
 * The three marketplaces, in the order the page shows them. Seen on each
 * marketplace on 2026-10-21.
 */
export const CloudMarketplaceEntries: ReadonlyArray<CloudMarketplaceEntry> = [
  {
    marketplace: CloudMarketplace.AWS,
    kubernetesService: "Amazon EKS",
    listingUrls: {
      /*
       * SaaS product prod-unn56dxklr4mw, "OneUptime", sold by OneUptime
       * (seller profile seller-d3b2fafj4knc2).
       */
      cloud: "https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw",
      /*
       * Container product prod-5ijwaqpun3coo (editions.json aws.productId):
       * Limited, shown only to the seller and its allowlist, since
       * 2026-10-19.
       */
      enterprise: null,
    },
  },
  {
    marketplace: CloudMarketplace.Azure,
    kubernetesService: "Azure Kubernetes Service",
    listingUrls: {
      /*
       * Publisher ID "oneupitme", as Partner Center has it, and the SaaS
       * offer oneuptime-cloud. Listed by HackerBay Inc.
       */
      cloud:
        "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud",
      // The Azure Container offer oneuptime-enterprise (editions.json azure.offerId).
      enterprise:
        "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise",
    },
  },
  {
    marketplace: CloudMarketplace.GoogleCloud,
    kubernetesService: "Google Kubernetes Engine",
    listingUrls: {
      // Neither product shows on Google Cloud Marketplace yet.
      cloud: null,
      enterprise: null,
    },
  },
];

// Where the Resellers page shows the marketplaces.
export const CLOUD_MARKETPLACES_SECTION_ID: string = "cloud-marketplaces";
export const CLOUD_MARKETPLACES_SECTION_PATH: string = `/resellers#${CLOUD_MARKETPLACES_SECTION_ID}`;

// The buyer's guide to installing OneUptime Enterprise from a marketplace.
export const ENTERPRISE_MARKETPLACE_GUIDE_PATH: string =
  "/docs/installation/cloud-marketplaces";

// Private offers are agreed with the team, as each listing says.
export const PRIVATE_OFFER_PATH: string = "/enterprise/demo";

/*
 * OneUptime Enterprise's list price on every marketplace, per user per hour
 * (SELF_HOSTED_RELEASING.md, "Pricing"; the docs page says the same).
 */
export const ENTERPRISE_PRICE_PER_USER_HOUR: string = "$0.10";

// What the click listener in head-basic.ejs reports a listing's click as.
export const CLOUD_MARKETPLACE_CTA: string = "cta_cloud_marketplace";

export const CloudMarketplaceProductNames: Record<
  CloudMarketplaceProduct,
  string
> = {
  cloud: "OneUptime Cloud",
  enterprise: "OneUptime Enterprise",
};

// One product on one marketplace, as its row on the marketplace's card shows it.
export interface CloudMarketplaceListingRow {
  product: CloudMarketplaceProduct;
  productName: string;
  // "Hosted by OneUptime", or "Self-hosted on Amazon EKS".
  detail: string;
  listingUrl: string | null;
  // The listing, named for a screen reader: "OneUptime Cloud on AWS Marketplace".
  label: string;
}

export interface CloudMarketplaceCard {
  marketplace: CloudMarketplace;
  // The marketplace's own name for itself: "Microsoft Marketplace".
  name: string;
  // Its card's anchor on the Resellers page: "microsoft-marketplace".
  anchorId: string;
  listings: Array<CloudMarketplaceListingRow>;
  /*
   * False while neither product shows on this marketplace: its card is
   * then one line, the name and "Coming soon", rather than a row per
   * product each saying so.
   */
  hasPublicListing: boolean;
}

/*
 * A public listing, as a sentence naming several of them links it:
 * separator is what comes before its name ("", ", " or " or ").
 */
export interface CloudMarketplaceLink {
  name: string;
  url: string;
  separator: string;
}

export interface CloudMarketplacesContent {
  marketplaces: Array<CloudMarketplaceCard>;
  // False while no marketplace shows any listing: then nothing is shown.
  hasPublicListing: boolean;
  // Each product's public listings, in the marketplaces' order.
  publicListings: Record<CloudMarketplaceProduct, Array<CloudMarketplaceLink>>;
  sectionId: string;
  sectionPath: string;
  enterpriseGuidePath: string;
  privateOfferPath: string;
  enterprisePricePerUserHour: string;
  ctaName: string;
}

/*
 * The anchor of a marketplace's card: its name in lower case, words joined
 * by hyphens ("Google Cloud Marketplace" is "google-cloud-marketplace").
 */
export const getCloudMarketplaceAnchorId: (name: string) => string = (
  name: string,
): string => {
  return name
    .toLowerCase()
    .split(" ")
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .join("-");
};

export const getListingDetail: (
  product: CloudMarketplaceProduct,
  kubernetesService: string,
) => string = (
  product: CloudMarketplaceProduct,
  kubernetesService: string,
): string => {
  return product === "cloud"
    ? "Hosted by OneUptime"
    : `Self-hosted on ${kubernetesService}`;
};

export const toCloudMarketplaceCard: (
  entry: CloudMarketplaceEntry,
) => CloudMarketplaceCard = (
  entry: CloudMarketplaceEntry,
): CloudMarketplaceCard => {
  const name: string = CloudMarketplaceUtil.getDisplayName(entry.marketplace);
  const listings: Array<CloudMarketplaceListingRow> =
    CloudMarketplaceProducts.map(
      (product: CloudMarketplaceProduct): CloudMarketplaceListingRow => {
        const productName: string = CloudMarketplaceProductNames[product];

        return {
          product: product,
          productName: productName,
          detail: getListingDetail(product, entry.kubernetesService),
          listingUrl: entry.listingUrls[product] || null,
          label: `${productName} on ${name}`,
        };
      },
    );

  return {
    marketplace: entry.marketplace,
    name: name,
    anchorId: getCloudMarketplaceAnchorId(name),
    listings: listings,
    hasPublicListing: listings.some(
      (listing: CloudMarketplaceListingRow): boolean => {
        return listing.listingUrl !== null;
      },
    ),
  };
};

/*
 * Names joined for a sentence, each with what comes before it: "A", "A or
 * B", "A, B or C".
 */
export const withSeparators: (
  links: ReadonlyArray<{ name: string; url: string }>,
) => Array<CloudMarketplaceLink> = (
  links: ReadonlyArray<{ name: string; url: string }>,
): Array<CloudMarketplaceLink> => {
  return links.map(
    (
      link: { name: string; url: string },
      index: number,
    ): CloudMarketplaceLink => {
      let separator: string = "";

      if (index > 0) {
        separator = index === links.length - 1 ? " or " : ", ";
      }

      return { name: link.name, url: link.url, separator: separator };
    },
  );
};

export const getPublicListings: (
  cards: ReadonlyArray<CloudMarketplaceCard>,
  product: CloudMarketplaceProduct,
) => Array<CloudMarketplaceLink> = (
  cards: ReadonlyArray<CloudMarketplaceCard>,
  product: CloudMarketplaceProduct,
): Array<CloudMarketplaceLink> => {
  const links: Array<{ name: string; url: string }> = [];

  for (const card of cards) {
    for (const listing of card.listings) {
      if (listing.product === product && listing.listingUrl) {
        links.push({ name: card.name, url: listing.listingUrl });
      }
    }
  }

  return withSeparators(links);
};

export const getCloudMarketplacesContent: (
  entries?: ReadonlyArray<CloudMarketplaceEntry>,
) => CloudMarketplacesContent = (
  entries: ReadonlyArray<CloudMarketplaceEntry> = CloudMarketplaceEntries,
): CloudMarketplacesContent => {
  const marketplaces: Array<CloudMarketplaceCard> = entries.map(
    toCloudMarketplaceCard,
  );
  const cloud: Array<CloudMarketplaceLink> = getPublicListings(
    marketplaces,
    "cloud",
  );
  const enterprise: Array<CloudMarketplaceLink> = getPublicListings(
    marketplaces,
    "enterprise",
  );

  return {
    marketplaces: marketplaces,
    hasPublicListing: cloud.length + enterprise.length > 0,
    publicListings: { cloud: cloud, enterprise: enterprise },
    sectionId: CLOUD_MARKETPLACES_SECTION_ID,
    sectionPath: CLOUD_MARKETPLACES_SECTION_PATH,
    enterpriseGuidePath: ENTERPRISE_MARKETPLACE_GUIDE_PATH,
    privateOfferPath: PRIVATE_OFFER_PATH,
    enterprisePricePerUserHour: ENTERPRISE_PRICE_PER_USER_HOUR,
    ctaName: CLOUD_MARKETPLACE_CTA,
  };
};
