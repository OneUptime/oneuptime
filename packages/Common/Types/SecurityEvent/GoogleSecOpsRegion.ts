/*
 * Regional service endpoint prefixes published for chronicle.googleapis.com.
 *
 * Keep this list shared by server-side validation and the connection form. A
 * free-text form in front of a stricter server allowlist lets a typo survive
 * until save, while two copied allowlists eventually disagree as Google adds
 * endpoints.
 *
 * Source: https://cloud.google.com/chronicle/docs/reference/rest
 */
export const GOOGLE_SECOPS_SUPPORTED_REGIONS: ReadonlyArray<string> = [
  "us",
  "eu",
  "europe",
  "africa-south1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "europe-central2",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west6",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast2",
  "southamerica-east1",
];
