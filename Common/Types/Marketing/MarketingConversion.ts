export enum MarketingConversionType {
  SignUp = "SignUp",
  // A verified Cal.com booking. See Docs/analytics/enterprise-conversion-tracking.md.
  MeetingBooked = "MeetingBooked",
  PaidSubscription = "PaidSubscription",
}

/*
 * Conversion types that ad platforms have an explicit conversion-action
 * mapping for. Every provider picks its platform conversion action by
 * branching on SignUp vs not-SignUp, so a type that is not listed here would
 * be uploaded as a purchase — add a type only once every provider has a
 * mapping for it. Types left out stay ledger-only and are recorded as Skipped.
 */
export const AdUploadableMarketingConversionTypes: Array<MarketingConversionType> =
  [MarketingConversionType.SignUp, MarketingConversionType.PaidSubscription];

export enum MarketingConversionUploadStatus {
  Uploaded = "Uploaded",
  Failed = "Failed",
  // No click id relevant to this ad platform — nothing to upload.
  Skipped = "Skipped",
}
