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
 * Campaign parameters travel as snake_case on a URL and as camelCase once they
 * are columns on User/Project. Both spellings are accepted on the way in — hand
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
  /*
   * Google Ads' own campaign parameters. Not UTMs, but they travel the same
   * way: Google Ads adds them to the landing URL of its ad clicks, gad_source
   * even with auto-tagging off
   * (https://support.google.com/google-ads/answer/16193746). gad_campaignid
   * names the campaign on a click whose ad carries no UTMs at all;
   * gad_source says which of Google's surfaces showed the ad, as a number
   * Google does not document. Google appends them after the ad's own
   * parameters, so a long landing URL loses them first when utmUrl is cut to
   * its column - hence columns of their own.
   */
  gad_source: "gadSource",
  gad_campaignid: "gadCampaignId",
};

export const UtmPropertyKeys: Array<string> = Object.values(
  UtmWireKeyToPropertyKey,
);

/*
 * The landing URL of the attributed visit. Stored beside the campaign values
 * because it keeps whatever the link carried that no list here names.
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

/*
 * Signing up with Microsoft or Google posts no form. The button is a link, the
 * browser goes off to the provider, and the account is made on the way back,
 * by a request that cannot read localStorage - where the attribution lives. So
 * the button writes the attribution into this cookie as it is pressed, and the
 * callback reads it. Its path is the one every provider's sign-in sits under
 * (/identity/microsoft, /identity/google): the page loads never carry it, and
 * the callback spends it.
 */
export const SignInAttributionCookieName: string =
  "oneuptime-sign-in-attribution";
export const SignInAttributionCookiePath: string = "/identity";

/*
 * On the address a sign-in ends on when it made a new account, naming the
 * provider. The sign-up page's reporting never runs for such a person, so the
 * Dashboard - the first page they load - reports the sign-up, and takes this
 * off the address.
 */
export const SignedUpWithQueryParam: string = "signed_up_with";
export const SignedUpWithMicrosoft: string = "microsoft";
export const SignedUpWithGoogle: string = "google";

// What the Dashboard reports a sign-up for: a provider that signs people up.
export const SignedUpWithProviders: ReadonlyArray<string> = [
  SignedUpWithMicrosoft,
  SignedUpWithGoogle,
];
