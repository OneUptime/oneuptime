import { JSONObject } from "../JSON";

/**
 * Stable, versioned events used to measure the self-serve revenue funnel.
 *
 * Event names are intentionally GA4-compatible snake_case. Additive property
 * changes are safe; breaking semantic changes require a new schema version.
 */
export enum RevenueEventName {
  SignupStarted = "signup_started",
  SignupCompleted = "sign_up",
  WorkspaceCreated = "workspace_created",
  MonitorCreated = "monitor_created",
  TeammateInvited = "teammate_invited",
  SubscriptionUpgraded = "subscription_upgraded",
  SubscriptionDowngraded = "subscription_downgraded",
}

export enum RevenueFunnelStage {
  Acquisition = "acquisition",
  Signup = "signup",
  Activation = "activation",
  Collaboration = "collaboration",
  Revenue = "revenue",
}

export interface RevenueEventProperties extends JSONObject {
  funnel_stage: RevenueFunnelStage;
}

export const REVENUE_EVENT_SCHEMA_VERSION: number = 1;
