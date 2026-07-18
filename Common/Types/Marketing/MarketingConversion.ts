export enum MarketingConversionType {
  SignUp = "SignUp",
  PaidSubscription = "PaidSubscription",
}

export enum MarketingConversionUploadStatus {
  Uploaded = "Uploaded",
  Failed = "Failed",
  // No click id relevant to this ad platform — nothing to upload.
  Skipped = "Skipped",
}
