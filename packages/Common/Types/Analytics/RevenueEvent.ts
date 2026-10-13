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
  SubscriptionStarted = "subscription_started",
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

export const isRevenueEventName: (name: string) => name is RevenueEventName = (
  name: string,
): name is RevenueEventName => {
  return (Object.values(RevenueEventName) as Array<string>).includes(name);
};

/*
 * The parameters Google Analytics receives with a revenue event: exactly the
 * ones the Tag Manager container's "GA4 - OneUptime Key Events" tag forwards
 * (Docs/analytics/gtm-key-events.json), so an event reports the same whether
 * it goes through the container or straight to Google Analytics. Nothing else
 * - in particular nothing that identifies a person.
 */
export const GoogleAnalyticsEventParameters: ReadonlyArray<string> = [
  "value",
  "currency",
  "plan",
  "funnel_stage",
  "is_paid_conversion",
  "project_id",
  "booking_kind",
  "event_schema_version",
];
