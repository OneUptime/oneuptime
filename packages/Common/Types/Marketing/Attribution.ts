/*
 * The visitor-attribution wire contract, shared by every place that reads or
 * writes it.
 *
 * Attribution starts in the browser (Home/Views/head-basic.ejs stores it in
 * localStorage) and reaches the server through the signup form
 * (App/FeatureSet/Accounts/src/Pages/Register.tsx), which posts it onto the
 * User record.
 *
 * That door is reachable by an unauthenticated caller, so it must whitelist and
 * length-bound what it accepts. Keeping the key lists here rather than in the
 * door itself means a key added for the browser cannot be silently dropped on
 * arrival.
 */

// Ad-platform click identifiers, in the spelling each platform uses on the URL.
export const AdClickIdKeys: Array<string> = [
  "gclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "li_fat_id",
  "twclid",
  "rdt_cid",
];

/*
 * UTM parameters travel as snake_case on a URL and as camelCase once they are
 * columns on User/Project. Both spellings are accepted on the way in — hand
 * written links produce either — and only the camelCase form is stored.
 */
export const UtmWireKeyToPropertyKey: Record<string, string> = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_term: "utmTerm",
  utm_content: "utmContent",
  /*
   * GA4's second tier of campaign parameters. Google Ads auto-tagging and the
   * GA4 URL builder emit these alongside the five above, and the booking
   * receiver reports on them, so they are stored rather than dropped at the
   * door.
   */
  utm_id: "utmId",
  utm_source_platform: "utmSourcePlatform",
  utm_creative_format: "utmCreativeFormat",
  utm_marketing_tactic: "utmMarketingTactic",
};

export const UtmPropertyKeys: Array<string> = Object.values(
  UtmWireKeyToPropertyKey,
);

/*
 * The landing URL of the attributed visit. Stored separately from the UTM
 * values because it is the only field that survives a campaign whose link
 * carried no UTMs at all (Google Ads auto-tagging sends gclid and nothing
 * else).
 */
export const UtmUrlPropertyKey: string = "utmUrl";

/*
 * The shape the marketing site writes to localStorage under `firstTouch` and
 * never overwrites. `clickIds` is nested inside it and handled separately.
 */
export const FirstTouchStringKeys: Array<string> = [
  ...UtmPropertyKeys,
  "landingUrl",
  "referrer",
  "timestamp",
];

/*
 * Every attribution value is bounded to this before it is persisted. The utm*
 * columns are LongText, so the bound is not the column width — it is a cap on
 * what an unauthenticated caller can push into the row.
 */
export const MaxAttributionValueLength: number = 500;
