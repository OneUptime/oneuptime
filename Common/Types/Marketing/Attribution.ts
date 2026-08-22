/*
 * The visitor-attribution wire contract, shared by every place that reads or
 * writes it.
 *
 * Attribution starts in the browser (Home/Views/head-basic.ejs stores it in
 * localStorage) and reaches the server through three unrelated doors:
 *
 *   - the signup form (App/FeatureSet/Accounts/src/Pages/Register.tsx), which
 *     posts it onto the User record;
 *   - the Cal.com booking webhook (App/API/CalWebhook.ts), which reads it back
 *     out of booking metadata the embed carried;
 *   - the enterprise licence request form (App/API/EnterpriseLicenseRequest.ts).
 *
 * Every one of those doors is reachable by an unauthenticated caller, so all
 * three must whitelist and length-bound what they accept. Keeping the key
 * lists here rather than in each door means a key added for the browser cannot
 * be silently dropped by one of the readers — which is exactly what happened
 * to UTM parameters on the Cal path, where the webhook parsed click IDs the
 * embed never sent.
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
 * UTM parameters travel as snake_case on a URL and in Cal booking metadata,
 * and as camelCase once they are columns on User/Project/MarketingConversion.
 * Both spellings are accepted on the way in — Cal booking questions and hand
 * written links produce either — and only the camelCase form is stored.
 */
export const UtmWireKeyToPropertyKey: Record<string, string> = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_term: "utmTerm",
  utm_content: "utmContent",
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
