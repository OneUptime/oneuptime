import {
  CLOUD_MARKETPLACES_SECTION_ID,
  CLOUD_MARKETPLACES_SECTION_PATH,
  CLOUD_MARKETPLACE_CTA,
  CloudMarketplaceCard,
  CloudMarketplaceEntries,
  CloudMarketplaceEntry,
  CloudMarketplaceLink,
  CloudMarketplaceListingRow,
  CloudMarketplaceProduct,
  CloudMarketplaceProductNames,
  CloudMarketplaceProducts,
  CloudMarketplacesContent,
  ENTERPRISE_MARKETPLACE_GUIDE_PATH,
  ENTERPRISE_PRICE_PER_USER_HOUR,
  PRIVATE_OFFER_PATH,
  getCloudMarketplaceAnchorId,
  getCloudMarketplacesContent,
  getListingDetail,
  getPublicListings,
  toCloudMarketplaceCard,
  withSeparators,
} from "../Utils/CloudMarketplaces";
import PageSEOConfig from "../Utils/PageSEO";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHERE ONEUPTIME IS SOLD ON THE CLOUD MARKETPLACES, AS DATA.
 *
 * Utils/CloudMarketplaces.ts is what the Resellers page, the pricing and
 * self-hosted pages and the markdown variants show. These hold it to the
 * repository's own facts about the listings - the marketplace guides, the
 * marketplace editions of the chart, the buyer's guide in the docs - pin
 * the addresses seen public on the marketplaces themselves, and pin how the
 * list becomes the cards and the sentences the pages draw.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

const CLOUD_GUIDE: string = repoFile(
  "packages/Common/Server/Utils/Marketplace/RELEASING.md",
);
const SELF_HOSTED_GUIDE: string = repoFile(
  "packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md",
);
const BUYER_GUIDE: string = repoFile(
  "packages/App/FeatureSet/Docs/Content/en/installation/cloud-marketplaces.md",
);

interface Editions {
  aws: { productId: string };
  azure: { offerId: string };
}

const EDITIONS: Editions = JSON.parse(
  repoFile("HelmChart/Marketplace/editions.json"),
) as Editions;

// Each marketplace's own host, where its listings live.
const LISTING_HOSTS: Record<string, string> = {
  [CloudMarketplace.AWS]: "aws.amazon.com",
  [CloudMarketplace.Azure]: "marketplace.microsoft.com",
  [CloudMarketplace.GoogleCloud]: "console.cloud.google.com",
};

// Microsoft's address of an offer: /<locale>/product/<publisher>.<offer>.
const MICROSOFT_PUBLISHER_ID: string = "oneupitme";
const MICROSOFT_CLOUD_OFFER_ID: string = "oneuptime-cloud";
// AWS's address of a listing: /marketplace/pp/prodview-<13 letters and digits>.
const AWS_LISTING_PATH: RegExp = /^\/marketplace\/pp\/prodview-[a-z0-9]{13}$/;

function entryOf(marketplace: CloudMarketplace): CloudMarketplaceEntry {
  const entry: CloudMarketplaceEntry | undefined = CloudMarketplaceEntries.find(
    (candidate: CloudMarketplaceEntry): boolean => {
      return candidate.marketplace === marketplace;
    },
  );

  expect(entry).toBeDefined();

  return entry!;
}

function publicListingUrls(): Array<string> {
  const urls: Array<string> = [];

  for (const entry of CloudMarketplaceEntries) {
    for (const product of CloudMarketplaceProducts) {
      const url: string | null = entry.listingUrls[product];

      if (url) {
        urls.push(url);
      }
    }
  }

  return urls;
}

// The rows of the guide's table that start with "| <first cell> |".
function tableRowOf(markdown: string, firstCell: string): string {
  const row: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith(`| ${firstCell} `);
    });

  expect(row).toBeDefined();

  return row!;
}

function entry(
  overrides: Partial<CloudMarketplaceEntry> = {},
): CloudMarketplaceEntry {
  return {
    marketplace: CloudMarketplace.AWS,
    kubernetesService: "Amazon EKS",
    listingUrls: { cloud: null, enterprise: null },
    ...overrides,
  };
}

describe("the buyer's guide's listing row", () => {
  /*
   * /docs/installation/cloud-marketplaces is the buyer's guide to OneUptime
   * Enterprise, and its first table's first row says where each listing is
   * (#5128's follow-ups): a link to it once the marketplace shows it to
   * everyone, else that it is not public yet, with the private offer page
   * to ask on. In every language the docs are written in.
   */
  const DOCS_CONTENT: string = path.join(
    REPO_ROOT,
    "packages/App/FeatureSet/Docs/Content",
  );
  const COLUMNS: ReadonlyArray<[CloudMarketplace, string]> = [
    [CloudMarketplace.AWS, "AWS"],
    [CloudMarketplace.Azure, "Microsoft"],
    [CloudMarketplace.GoogleCloud, "Google Cloud"],
  ];
  const HEADER: string = `| | ${COLUMNS.map(
    ([, name]: [CloudMarketplace, string]): string => {
      return name;
    },
  ).join(" | ")} |`;

  const languages: Array<string> = fs
    .readdirSync(DOCS_CONTENT)
    .filter((language: string): boolean => {
      return fs.existsSync(
        path.join(DOCS_CONTENT, language, "installation/cloud-marketplaces.md"),
      );
    })
    .sort();

  // The cells of the row under the table's header and separator.
  const listingCells: (language: string) => Array<string> = (
    language: string,
  ): Array<string> => {
    const lines: Array<string> = fs
      .readFileSync(
        path.join(DOCS_CONTENT, language, "installation/cloud-marketplaces.md"),
        "utf-8",
      )
      .split("\n");
    const header: number = lines.indexOf(HEADER);

    expect([language, header >= 0]).toEqual([language, true]);

    return lines[header + 2]!.split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });
  };

  test("is written in every docs language", () => {
    expect(languages).toHaveLength(17);
    expect(listingCells("en")[0]).toBe("Listing");
  });

  test.each(COLUMNS)(
    "%s: a link to the public OneUptime Enterprise listing, or not public yet with the private offer page",
    (marketplace: CloudMarketplace, name: string) => {
      const column: number =
        1 +
        COLUMNS.findIndex(([candidate]: [CloudMarketplace, string]) => {
          return candidate === marketplace;
        });
      const url: string | null = entryOf(marketplace).listingUrls.enterprise;

      for (const language of languages) {
        const cell: string = listingCells(language)[column]!;

        if (url) {
          expect([language, name, cell]).toEqual([
            language,
            name,
            `[OneUptime Enterprise](${url})`,
          ]);
          continue;
        }

        expect([
          language,
          name,
          cell.includes(LISTING_HOSTS[marketplace]!),
          cell.includes(`](https://oneuptime.com${PRIVATE_OFFER_PATH})`),
        ]).toEqual([language, name, false, true]);
      }

      if (!url) {
        expect(listingCells("en")[column]).toBe(
          `Not public yet: [contact us](https://oneuptime.com${PRIVATE_OFFER_PATH})`,
        );
      }
    },
  );
});

describe("the marketplaces", () => {
  test("are the three clouds, each once, in the order the guides list them", () => {
    expect(
      CloudMarketplaceEntries.map((item: CloudMarketplaceEntry) => {
        return item.marketplace;
      }),
    ).toEqual([
      CloudMarketplace.AWS,
      CloudMarketplace.Azure,
      CloudMarketplace.GoogleCloud,
    ]);
  });

  test("are every cloud marketplace OneUptime is sold on, and not Vercel's integration", () => {
    expect(
      CloudMarketplaceUtil.getAll().filter((marketplace: CloudMarketplace) => {
        return marketplace !== CloudMarketplace.Vercel;
      }),
    ).toEqual(
      CloudMarketplaceEntries.map((item: CloudMarketplaceEntry) => {
        return item.marketplace;
      }),
    );
  });

  test("sell the two products the guides describe: OneUptime Cloud and OneUptime Enterprise", () => {
    expect([...CloudMarketplaceProducts]).toEqual(["cloud", "enterprise"]);
    expect(CloudMarketplaceProductNames).toEqual({
      cloud: "OneUptime Cloud",
      enterprise: "OneUptime Enterprise",
    });

    for (const item of CloudMarketplaceEntries) {
      expect(Object.keys(item.listingUrls).sort()).toEqual(
        [...CloudMarketplaceProducts].sort(),
      );
    }
  });

  test.each([
    [CloudMarketplace.AWS, "Amazon EKS"],
    [CloudMarketplace.Azure, "Azure Kubernetes Service (AKS)"],
    [CloudMarketplace.GoogleCloud, "Google Kubernetes Engine (GKE)"],
  ] as Array<[CloudMarketplace, string]>)(
    "%s installs OneUptime Enterprise on the Kubernetes service the buyer's guide names",
    (marketplace: CloudMarketplace, docsName: string) => {
      const runsOn: Array<string> = tableRowOf(BUYER_GUIDE, "Runs on")
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        })
        .filter((cell: string): boolean => {
          return cell.length > 0;
        });

      expect(runsOn).toContain(docsName);
      // The card says the service's name, without the guide's abbreviation.
      expect(docsName.startsWith(entryOf(marketplace).kubernetesService)).toBe(
        true,
      );
    },
  );
});

describe("the listings' addresses", () => {
  test("are the ones seen public on the marketplaces on 2026-10-21, and no other", () => {
    /*
     * AWS: OneUptime Cloud (SaaS) is public; OneUptime Enterprise's
     * container product is Limited. Microsoft: both offers are live, under
     * the publisher ID Partner Center has for HackerBay. Google Cloud:
     * neither shows yet. A change here is a listing going public (or
     * away): open it on the marketplace first.
     */
    expect(
      CloudMarketplaceEntries.map((item: CloudMarketplaceEntry) => {
        return [item.marketplace, item.listingUrls];
      }),
    ).toEqual([
      [
        CloudMarketplace.AWS,
        {
          cloud: "https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw",
          enterprise: null,
        },
      ],
      [
        CloudMarketplace.Azure,
        {
          cloud:
            "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud",
          enterprise:
            "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise",
        },
      ],
      [CloudMarketplace.GoogleCloud, { cloud: null, enterprise: null }],
    ]);
  });

  test.each(
    CloudMarketplaceEntries.flatMap((item: CloudMarketplaceEntry) => {
      return CloudMarketplaceProducts.filter(
        (product: CloudMarketplaceProduct): boolean => {
          return item.listingUrls[product] !== null;
        },
      ).map((product: CloudMarketplaceProduct): [string, string, string] => {
        return [
          CloudMarketplaceUtil.getDisplayName(item.marketplace),
          product,
          item.listingUrls[product]!,
        ];
      });
    }),
  )(
    "%s's %s listing is on the marketplace's own host, over https, as it links it",
    (_name: string, _product: string, address: string) => {
      const url: URL = new URL(address);
      const item: CloudMarketplaceEntry = CloudMarketplaceEntries.find(
        (candidate: CloudMarketplaceEntry): boolean => {
          return Object.values(candidate.listingUrls).includes(address);
        },
      )!;

      expect(url.protocol).toBe("https:");
      expect(url.host).toBe(LISTING_HOSTS[item.marketplace]);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      // No tracking or search parameters: the listing itself.
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      // Written exactly as the browser would normalise it.
      expect(url.toString()).toBe(address);
    },
  );

  test("AWS's listing has the path AWS links its listings with", () => {
    const address: string = entryOf(CloudMarketplace.AWS).listingUrls.cloud!;

    expect(AWS_LISTING_PATH.test(new URL(address).pathname)).toBe(true);
  });

  test("Microsoft's listings are the offers the guides and the chart's editions name, under its publisher ID", () => {
    const microsoft: CloudMarketplaceEntry = entryOf(CloudMarketplace.Azure);

    // The SaaS offer, as both guides name it.
    expect(CLOUD_GUIDE).toContain(`\`${MICROSOFT_CLOUD_OFFER_ID}\``);
    expect(SELF_HOSTED_GUIDE).toContain(`\`${MICROSOFT_CLOUD_OFFER_ID}\``);
    // The container offer, as the Azure edition is built for it.
    expect(EDITIONS.azure.offerId).toBe("oneuptime-enterprise");

    expect(new URL(microsoft.listingUrls.cloud!).pathname).toBe(
      `/en-us/product/${MICROSOFT_PUBLISHER_ID}.${MICROSOFT_CLOUD_OFFER_ID}`,
    );
    expect(new URL(microsoft.listingUrls.enterprise!).pathname).toBe(
      `/en-us/product/${MICROSOFT_PUBLISHER_ID}.${EDITIONS.azure.offerId}`,
    );
  });

  test("no two listings share an address", () => {
    const urls: Array<string> = publicListingUrls();

    expect(new Set(urls).size).toBe(urls.length);
  });

  test("each guide lists its product's public addresses, so the website and the runbooks agree", () => {
    for (const item of CloudMarketplaceEntries) {
      if (item.listingUrls.cloud) {
        expect(CLOUD_GUIDE).toContain(`\`${item.listingUrls.cloud}\``);
      }

      if (item.listingUrls.enterprise) {
        expect(SELF_HOSTED_GUIDE).toContain(
          `\`${item.listingUrls.enterprise}\``,
        );
      }
    }
  });

  test("each guide says a listing without an address is not public yet, and points at this list", () => {
    for (const [guide, product] of [
      [CLOUD_GUIDE, "cloud"],
      [SELF_HOSTED_GUIDE, "enterprise"],
    ] as Array<[string, CloudMarketplaceProduct]>) {
      expect(guide).toContain(
        "[packages/Home/Utils/CloudMarketplaces.ts](../../../../Home/Utils/CloudMarketplaces.ts)",
      );
      // The link is relative to the guides' folder: it resolves to this file.
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "packages/Common/Server/Utils/Marketplace",
            "../../../../Home/Utils/CloudMarketplaces.ts",
          ),
        ),
      ).toBe(true);

      for (const item of CloudMarketplaceEntries) {
        const name: string =
          item.marketplace === CloudMarketplace.GoogleCloud
            ? "Google Cloud"
            : item.marketplace === CloudMarketplace.Azure
              ? "Microsoft"
              : "AWS";
        const row: string = tableRowOf(guide, name);

        expect(row.includes("Not public yet")).toBe(
          item.listingUrls[product] === null,
        );
      }
    }
  });

  test("the AWS container product that is not public yet is the one the chart's AWS edition ships", () => {
    expect(entryOf(CloudMarketplace.AWS).listingUrls.enterprise).toBeNull();
    expect(tableRowOf(SELF_HOSTED_GUIDE, "AWS")).toContain(
      `\`${EDITIONS.aws.productId}\` is Limited`,
    );
  });
});

describe("the facts the page states", () => {
  test("OneUptime Enterprise's price is the guide's list price and the buyer's guide's", () => {
    expect(ENTERPRISE_PRICE_PER_USER_HOUR).toBe("$0.10");
    expect(SELF_HOSTED_GUIDE).toContain(
      "**List price: USD 0.10 per user-hour**",
    );
    expect(BUYER_GUIDE).toContain("USD 0.10 per user per hour");
  });

  test("the buyer's guide it links is a docs page in English", () => {
    expect(ENTERPRISE_MARKETPLACE_GUIDE_PATH).toBe(
      "/docs/installation/cloud-marketplaces",
    );
    expect(BUYER_GUIDE.startsWith("# Cloud Marketplaces\n")).toBe(true);
  });

  test("private offers are agreed with the team, on the page the listings name for them", () => {
    expect(PRIVATE_OFFER_PATH).toBe("/enterprise/demo");
    expect(PageSEOConfig[PRIVATE_OFFER_PATH]?.canonicalPath).toBe(
      PRIVATE_OFFER_PATH,
    );
    // The listing copy in both guides sends private offers there.
    expect(CLOUD_GUIDE).toContain("https://oneuptime.com/enterprise/demo");
    expect(SELF_HOSTED_GUIDE).toContain(
      "https://oneuptime.com/enterprise/demo",
    );
  });

  test("the section is on the Resellers page, under an anchor of its own", () => {
    expect(CLOUD_MARKETPLACES_SECTION_ID).toBe("cloud-marketplaces");
    expect(CLOUD_MARKETPLACES_SECTION_PATH).toBe(
      "/resellers#cloud-marketplaces",
    );
    expect(PageSEOConfig["/resellers"]?.canonicalPath).toBe("/resellers");
  });

  test("a click on a listing is reported under a name of its own", () => {
    expect(CLOUD_MARKETPLACE_CTA).toBe("cta_cloud_marketplace");
  });
});

describe("a marketplace's card", () => {
  test.each([
    ["AWS Marketplace", "aws-marketplace"],
    ["Microsoft Marketplace", "microsoft-marketplace"],
    ["Google Cloud Marketplace", "google-cloud-marketplace"],
    ["  Two  Spaces ", "two-spaces"],
  ])("%s is anchored at #%s", (name: string, anchorId: string) => {
    expect(getCloudMarketplaceAnchorId(name)).toBe(anchorId);
  });

  test("says what each product is, and where OneUptime Enterprise runs", () => {
    expect(getListingDetail("cloud", "Amazon EKS")).toBe("Hosted by OneUptime");
    expect(getListingDetail("enterprise", "Amazon EKS")).toBe(
      "Self-hosted on Amazon EKS",
    );
  });

  test("is AWS's card for AWS: its name, its anchor and a row for each product", () => {
    const card: CloudMarketplaceCard = toCloudMarketplaceCard(
      entryOf(CloudMarketplace.AWS),
    );

    expect(card).toEqual({
      marketplace: CloudMarketplace.AWS,
      name: "AWS Marketplace",
      anchorId: "aws-marketplace",
      hasPublicListing: true,
      listings: [
        {
          product: "cloud",
          productName: "OneUptime Cloud",
          detail: "Hosted by OneUptime",
          listingUrl:
            "https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw",
          label: "OneUptime Cloud on AWS Marketplace",
        },
        {
          product: "enterprise",
          productName: "OneUptime Enterprise",
          detail: "Self-hosted on Amazon EKS",
          listingUrl: null,
          label: "OneUptime Enterprise on AWS Marketplace",
        },
      ],
    });
  });

  test("names each marketplace as the product's billing pages do", () => {
    for (const item of CloudMarketplaceEntries) {
      expect(toCloudMarketplaceCard(item).name).toBe(
        CloudMarketplaceUtil.getDisplayName(item.marketplace),
      );
    }
  });

  test("calls Microsoft's marketplace by its own name, and says where on Azure", () => {
    const card: CloudMarketplaceCard = toCloudMarketplaceCard(
      entryOf(CloudMarketplace.Azure),
    );

    expect(card.name).toBe("Microsoft Marketplace");
    expect(card.anchorId).toBe("microsoft-marketplace");
    expect(
      card.listings.map((row: CloudMarketplaceListingRow) => {
        return row.detail;
      }),
    ).toEqual([
      "Hosted by OneUptime",
      "Self-hosted on Azure Kubernetes Service",
    ]);
  });

  test("has a public listing when either product shows, and none when neither does", () => {
    expect(
      toCloudMarketplaceCard(
        entry({ listingUrls: { cloud: null, enterprise: null } }),
      ).hasPublicListing,
    ).toBe(false);
    expect(
      toCloudMarketplaceCard(
        entry({
          listingUrls: { cloud: null, enterprise: "https://example.com/e" },
        }),
      ).hasPublicListing,
    ).toBe(true);
    expect(
      toCloudMarketplaceCard(
        entry({
          listingUrls: { cloud: "https://example.com/c", enterprise: null },
        }),
      ).hasPublicListing,
    ).toBe(true);
    expect(
      toCloudMarketplaceCard(entryOf(CloudMarketplace.GoogleCloud))
        .hasPublicListing,
    ).toBe(false);
  });

  test("treats an empty address as no listing", () => {
    const card: CloudMarketplaceCard = toCloudMarketplaceCard(
      entry({
        listingUrls: { cloud: "", enterprise: null } as unknown as Record<
          CloudMarketplaceProduct,
          string | null
        >,
      }),
    );

    expect(card.listings[0]!.listingUrl).toBeNull();
    expect(card.hasPublicListing).toBe(false);
  });

  test("lists the products in the same order on every card", () => {
    for (const item of CloudMarketplaceEntries) {
      expect(
        toCloudMarketplaceCard(item).listings.map(
          (row: CloudMarketplaceListingRow) => {
            return row.product;
          },
        ),
      ).toEqual([...CloudMarketplaceProducts]);
    }
  });
});

describe("listings named in a sentence", () => {
  const link: (name: string) => { name: string; url: string } = (
    name: string,
  ): { name: string; url: string } => {
    return { name: name, url: `https://example.com/${name}` };
  };

  const sentence: (links: Array<CloudMarketplaceLink>) => string = (
    links: Array<CloudMarketplaceLink>,
  ): string => {
    return links
      .map((item: CloudMarketplaceLink): string => {
        return `${item.separator}${item.name}`;
      })
      .join("");
  };

  test.each([
    [[], ""],
    [["A"], "A"],
    [["A", "B"], "A or B"],
    [["A", "B", "C"], "A, B or C"],
    [["A", "B", "C", "D"], "A, B, C or D"],
  ] as Array<[Array<string>, string]>)(
    "%j reads as %j",
    (names: Array<string>, expected: string) => {
      expect(sentence(withSeparators(names.map(link)))).toBe(expected);
    },
  );

  test("keeps each address with its name", () => {
    expect(withSeparators([link("A"), link("B")])).toEqual([
      { name: "A", url: "https://example.com/A", separator: "" },
      { name: "B", url: "https://example.com/B", separator: " or " },
    ]);
  });

  test("are a product's public listings only, in the marketplaces' order", () => {
    const cards: Array<CloudMarketplaceCard> = [
      entry({
        marketplace: CloudMarketplace.GoogleCloud,
        kubernetesService: "Google Kubernetes Engine",
        listingUrls: { cloud: "https://example.com/g", enterprise: null },
      }),
      entry({
        marketplace: CloudMarketplace.AWS,
        listingUrls: {
          cloud: "https://example.com/a",
          enterprise: "https://example.com/ae",
        },
      }),
    ].map(toCloudMarketplaceCard);

    expect(getPublicListings(cards, "cloud")).toEqual([
      {
        name: "Google Cloud Marketplace",
        url: "https://example.com/g",
        separator: "",
      },
      {
        name: "AWS Marketplace",
        url: "https://example.com/a",
        separator: " or ",
      },
    ]);
    expect(getPublicListings(cards, "enterprise")).toEqual([
      { name: "AWS Marketplace", url: "https://example.com/ae", separator: "" },
    ]);
  });
});

describe("what the pages get", () => {
  test("is every marketplace's card, the public listings of each product and the section's links", () => {
    const content: CloudMarketplacesContent = getCloudMarketplacesContent();

    expect(content.marketplaces).toEqual(
      CloudMarketplaceEntries.map(toCloudMarketplaceCard),
    );
    expect(content.hasPublicListing).toBe(true);
    expect(content.publicListings).toEqual({
      cloud: [
        {
          name: "AWS Marketplace",
          url: "https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw",
          separator: "",
        },
        {
          name: "Microsoft Marketplace",
          url: "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud",
          separator: " or ",
        },
      ],
      enterprise: [
        {
          name: "Microsoft Marketplace",
          url: "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise",
          separator: "",
        },
      ],
    });
    expect(content.sectionId).toBe(CLOUD_MARKETPLACES_SECTION_ID);
    expect(content.sectionPath).toBe(CLOUD_MARKETPLACES_SECTION_PATH);
    expect(content.enterpriseGuidePath).toBe(ENTERPRISE_MARKETPLACE_GUIDE_PATH);
    expect(content.privateOfferPath).toBe(PRIVATE_OFFER_PATH);
    expect(content.enterprisePricePerUserHour).toBe(
      ENTERPRISE_PRICE_PER_USER_HOUR,
    );
    expect(content.ctaName).toBe(CLOUD_MARKETPLACE_CTA);
  });

  test("has nothing to show while no listing is public", () => {
    const content: CloudMarketplacesContent = getCloudMarketplacesContent(
      CloudMarketplaceEntries.map(
        (item: CloudMarketplaceEntry): CloudMarketplaceEntry => {
          return { ...item, listingUrls: { cloud: null, enterprise: null } };
        },
      ),
    );

    expect(content.hasPublicListing).toBe(false);
    expect(content.publicListings).toEqual({ cloud: [], enterprise: [] });
    // The cards are still there for whatever reads them.
    expect(content.marketplaces).toHaveLength(3);
  });

  test("has something to show when a single listing is public", () => {
    const content: CloudMarketplacesContent = getCloudMarketplacesContent([
      entry({
        listingUrls: { cloud: null, enterprise: "https://example.com/e" },
      }),
    ]);

    expect(content.hasPublicListing).toBe(true);
    expect(content.publicListings.cloud).toEqual([]);
    expect(content.publicListings.enterprise).toHaveLength(1);
  });

  test("is drawn fresh each time, so a page cannot change another's copy", () => {
    const first: CloudMarketplacesContent = getCloudMarketplacesContent();
    const second: CloudMarketplacesContent = getCloudMarketplacesContent();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.marketplaces[0]).not.toBe(second.marketplaces[0]);
  });
});
