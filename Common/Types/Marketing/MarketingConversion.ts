export enum MarketingConversionType {
  SignUp = "SignUp",
  MeetingBooked = "MeetingBooked",
  PaidSubscription = "PaidSubscription",
}

export const AdUploadableMarketingConversionTypes: Array<MarketingConversionType> =
  [
    MarketingConversionType.SignUp,
    MarketingConversionType.PaidSubscription,
  ];

export enum MarketingConversionUploadStatus {
  Uploaded = "Uploaded",
  Failed = "Failed",
  // No click id relevant to this ad platform — nothing to upload.
  Skipped = "Skipped",
}
