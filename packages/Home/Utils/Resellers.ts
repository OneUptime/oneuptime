import {
  ResellerInquiryFormContent,
  getResellerInquiryFormContent,
} from "./ResellerInquiry";

/*
 * THE RESELLERS PAGE (/resellers), AS DATA.
 *
 * Companies that sell OneUptime in their own country, listed by region, and
 * the form other companies use to ask to become one (ResellerInquiry.ts
 * receives it). Adding a reseller is one entry in Resellers below: the page,
 * its markdown variant (/resellers.md) and Tests/Resellers.test.ts all read
 * this list.
 *
 * An entry says only what can be checked: the company's name, where it is,
 * its own website, and one line on what it does in the words of that
 * website. No logo until the reseller supplies one (logoPath), and no
 * quotes, services or claims on its behalf.
 */

export type ResellerRegion =
  | "Americas"
  | "Asia Pacific"
  | "Europe, Middle East and Africa";

// The order the page lists regions in.
export const ResellerRegions: ReadonlyArray<ResellerRegion> = [
  "Americas",
  "Asia Pacific",
  "Europe, Middle East and Africa",
];

export interface Reseller {
  // The company's name, as it writes it in English.
  name: string;
  // Its name in its own language, when that differs: SLEXN is 슬렉슨.
  localName?: string | undefined;
  // The language localName is written in, as an HTML lang value ("ko").
  localNameLanguage?: string | undefined;
  city?: string | undefined;
  country: string;
  region: ResellerRegion;
  // The company's own website. https only (Tests/Resellers.test.ts).
  websiteUrl: string;
  // One line on what the company does, from its own website.
  summary: string;
  /*
   * The company's logo under Static/img/resellers (for example
   * "/img/resellers/slexn.svg"), once the company has supplied one. Without
   * it the card is text only.
   */
  logoPath?: string | undefined;
}

export const Resellers: Array<Reseller> = [
  {
    /*
     * https://www.slexn.com: "(유)슬렉슨", 서울 강서구 (Seoul), "소프트웨어
     * 기반 솔루션 & 컨설팅 전문" - software-based solutions and consulting.
     */
    name: "SLEXN",
    localName: "슬렉슨",
    localNameLanguage: "ko",
    city: "Seoul",
    country: "South Korea",
    region: "Asia Pacific",
    websiteUrl: "https://www.slexn.com",
    summary: "Software solutions and consulting.",
  },
];

// One reseller, as its card on the page shows it.
export interface ResellerCard {
  name: string;
  localName: string | null;
  localNameLanguage: string | null;
  // "Seoul, South Korea", or the country alone.
  location: string;
  country: string;
  websiteUrl: string;
  // The website's address as a reader would type it: "slexn.com".
  websiteLabel: string;
  summary: string;
  logoPath: string | null;
}

export interface ResellerRegionGroup {
  region: ResellerRegion;
  // The region's anchor on the page: "asia-pacific".
  anchorId: string;
  resellers: Array<ResellerCard>;
}

export interface ResellersPageContent {
  // Only the regions that have a reseller, in ResellerRegions order.
  regions: Array<ResellerRegionGroup>;
  resellerCount: number;
  form: ResellerInquiryFormContent;
}

const LEADING_WWW: string = "www.";

/*
 * The host of a website's address, without a leading "www.", for the link's
 * text. The address itself is what the link opens.
 */
export const getWebsiteLabel: (websiteUrl: string) => string = (
  websiteUrl: string,
): string => {
  const host: string = new URL(websiteUrl).hostname;

  return host.startsWith(LEADING_WWW) ? host.slice(LEADING_WWW.length) : host;
};

export const getRegionAnchorId: (region: ResellerRegion) => string = (
  region: ResellerRegion,
): string => {
  return region
    .toLowerCase()
    .split(" ")
    .map((word: string): string => {
      return word.endsWith(",") ? word.slice(0, -1) : word;
    })
    .join("-");
};

export const toResellerCard: (reseller: Reseller) => ResellerCard = (
  reseller: Reseller,
): ResellerCard => {
  return {
    name: reseller.name,
    localName: reseller.localName || null,
    localNameLanguage: reseller.localName
      ? reseller.localNameLanguage || null
      : null,
    location: reseller.city
      ? `${reseller.city}, ${reseller.country}`
      : reseller.country,
    country: reseller.country,
    websiteUrl: reseller.websiteUrl,
    websiteLabel: getWebsiteLabel(reseller.websiteUrl),
    summary: reseller.summary,
    logoPath: reseller.logoPath || null,
  };
};

/*
 * The resellers by region: the regions in ResellerRegions order, each with
 * its resellers by name. A region without a reseller is left out rather
 * than shown empty; the page says what to do when a reader's country has
 * none.
 */
export const getResellerRegionGroups: (
  resellers: ReadonlyArray<Reseller>,
) => Array<ResellerRegionGroup> = (
  resellers: ReadonlyArray<Reseller>,
): Array<ResellerRegionGroup> => {
  const groups: Array<ResellerRegionGroup> = [];

  for (const region of ResellerRegions) {
    const inRegion: Array<ResellerCard> = resellers
      .filter((reseller: Reseller): boolean => {
        return reseller.region === region;
      })
      .map(toResellerCard)
      .sort((a: ResellerCard, b: ResellerCard): number => {
        return a.name.localeCompare(b.name, "en");
      });

    if (inRegion.length === 0) {
      continue;
    }

    groups.push({
      region: region,
      anchorId: getRegionAnchorId(region),
      resellers: inRegion,
    });
  }

  return groups;
};

export const getResellersPageContent: (options?: {
  resellers?: ReadonlyArray<Reseller> | undefined;
  inquiryInbox?: string | undefined;
}) => ResellersPageContent = (
  options: {
    resellers?: ReadonlyArray<Reseller> | undefined;
    inquiryInbox?: string | undefined;
  } = {},
): ResellersPageContent => {
  const resellers: ReadonlyArray<Reseller> = options.resellers || Resellers;

  return {
    regions: getResellerRegionGroups(resellers),
    resellerCount: resellers.length,
    form: getResellerInquiryFormContent(options.inquiryInbox),
  };
};
