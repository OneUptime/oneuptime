import { JSONObject } from "../JSON";

export enum AttributionConsentState {
  Unknown = "unknown",
  Granted = "granted",
  Denied = "denied",
}

export enum AttributionTouchpointType {
  Visit = "visit",
  MeaningfulVisit = "meaningful_visit",
  DemoBooked = "demo_booked",
}

export interface AcquisitionTouch extends JSONObject {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPage?: string;
  referrer?: string;
  timestamp?: string;
  channel?: string;
  clickIds?: JSONObject;
}

export interface AcquisitionAttribution extends JSONObject {
  anonymousVisitorId?: string;
  consentState?: AttributionConsentState;
  firstTouch?: AcquisitionTouch;
  latestTouch?: AcquisitionTouch;
  latestPaidTouch?: AcquisitionTouch;
}
