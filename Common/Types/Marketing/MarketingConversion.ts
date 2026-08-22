export enum MarketingConversionType {
  SignUp = "SignUp",
  PaidSubscription = "PaidSubscription",
  // Internal acquisition ledger row. Providers must never upload this directly.
  Touchpoint = "Touchpoint",
}

export enum MarketingConversionUploadStatus {
  Uploaded = "Uploaded",
  Failed = "Failed",
  // No click id relevant to this ad platform — nothing to upload.
  Skipped = "Skipped",
}
