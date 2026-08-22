export enum MarketingConversionType {
  SignUp = "SignUp",
  // A verified Cal.com booking. See Docs/analytics/enterprise-conversion-tracking.md.
  MeetingBooked = "MeetingBooked",
  /*
   * A submitted enterprise licence / self-hosted assessment request. Written
   * by App/API/EnterpriseLicenseRequest.ts, which replaced the mailto: link
   * that made this step of the funnel unmeasurable.
   */
  EnterpriseLicenseRequested = "EnterpriseLicenseRequested",
  PaidSubscription = "PaidSubscription",
}

/*
 * Conversion types ad platforms may be told about.
 *
 * This list used to hold only SignUp and PaidSubscription because every
 * provider chose its platform conversion action with a two-way branch on
 * isSignUp(), so any third type would have been uploaded as a *purchase*
 * carrying whatever value the row held. That branch is gone: providers now
 * declare a Record<MarketingConversionType, ...> mapping, which the compiler
 * refuses to accept unless every member of the enum above is named. Adding a
 * conversion type is therefore a type error in each provider until that
 * provider says what the type means on its platform.
 *
 * A mapping may legitimately be an empty string, meaning "this deployment has
 * not configured a conversion action for this type yet". That is a config gap,
 * not a modelling gap: the worker leaves such rows pending rather than
 * skipping them, so they upload once the id is set.
 */
export const AdUploadableMarketingConversionTypes: Array<MarketingConversionType> =
  [
    MarketingConversionType.SignUp,
    MarketingConversionType.MeetingBooked,
    MarketingConversionType.EnterpriseLicenseRequested,
    MarketingConversionType.PaidSubscription,
  ];

/*
 * Types that represent a sales-led lead rather than a completed self-serve
 * transaction. They carry no revenue of their own — a booked meeting is not
 * money — so providers must not attach a conversion value to them even when
 * the row happens to have one, and platforms that demand a value for their
 * purchase-shaped events must not be handed these as purchases.
 */
export const LeadMarketingConversionTypes: Array<MarketingConversionType> = [
  MarketingConversionType.MeetingBooked,
  MarketingConversionType.EnterpriseLicenseRequested,
];

export enum MarketingConversionUploadStatus {
  Uploaded = "Uploaded",
  Failed = "Failed",
  // No identifier relevant to this ad platform — nothing to upload.
  Skipped = "Skipped",
}
