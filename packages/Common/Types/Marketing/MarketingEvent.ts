import { JSONObject } from "../JSON";

/*
 * The outbound marketing event contract.
 *
 * OneUptime does not keep a conversion ledger. The moments worth
 * measuring are emitted as signed webhooks at the instant they happen and are
 * not stored here afterwards, so this interface — not a database table — is
 * the whole record of what a conversion looks like.
 *
 * Two consequences follow from having no store, and both are the receiver's
 * job rather than ours:
 *
 *   - DEDUPLICATION. `eventId` is stable for a given real-world occurrence, so
 *     a redelivery carries the id the first attempt did. Retries are expected
 *     (the delivery queue retries), so a receiver that keys on
 *     anything else will double-count.
 *   - ORDERING. Events are delivered per-occurrence with no sequence number.
 *     A signup and a plan change seconds apart may arrive either way round;
 *     order by `occurredAt`, never by arrival.
 *
 * Names are the same snake_case the browser funnel uses
 * (Common/Types/Analytics/RevenueEvent.ts) so one event means one thing on
 * both sides. Adding a property is safe; changing what an existing one means
 * requires a new schema version.
 */
export enum MarketingEventType {
  SignUp = "sign_up",
  /*
   * A project's first paid subscription, created together with the project.
   *
   * Deliberately not a subscription_upgraded. An upgrade is a movement between
   * two tiers and reports expansion; this has no previous tier at all and is
   * new business. Reporting one as the other mixes net-new with expansion
   * revenue, and nothing downstream could separate them again.
   */
  SubscriptionStarted = "subscription_started",
  SubscriptionUpgraded = "subscription_upgraded",
  SubscriptionDowngraded = "subscription_downgraded",
  /*
   * The first money a project paid, read off the Stripe invoice that took it.
   *
   * On OneUptime Cloud every paid plan starts on a free trial that asks for
   * no card, so subscription_started is a plan chosen, not a payment. This is
   * the payment: most often the invoice Stripe raises when that trial ends,
   * which no browser is present to report.
   */
  FirstPayment = "first_payment",
  /*
   * A paid subscription stopped: cancelled, its project deleted, Stripe
   * giving up on a card that kept failing, or a free trial that ended
   * without ever being paid for. The counterpart a receiver needs to stop
   * counting subscription_started's value as revenue still to come.
   */
  SubscriptionEnded = "subscription_ended",
  /*
   * A sales-led licence was issued, carrying its annual contract value.
   *
   * This is the only event that reports enterprise revenue, and the only one
   * whose email is typed in by a human rather than captured from a session —
   * which is exactly what makes it joinable: set EnterpriseLicense.email to
   * the address the customer booked with and this event shares an identity
   * with whatever else that address has done, months earlier.
   */
  EnterpriseLicenseIssued = "enterprise_license_issued",
}

export const MARKETING_EVENT_SCHEMA_VERSION: number = 1;

/*
 * The campaign the converting visitor carried.
 *
 * Copied from the User or Project row the conversion happened on. Every field
 * is optional: a conversion with no attribution at all is still a conversion,
 * and is still emitted.
 */
export interface MarketingEventAttribution extends JSONObject {
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  utmId?: string | undefined;
  utmSourcePlatform?: string | undefined;
  utmCreativeFormat?: string | undefined;
  utmMarketingTactic?: string | undefined;
  utmUrl?: string | undefined;
  clickIds: JSONObject;
  firstTouch: JSONObject;
}

export interface MarketingEvent extends JSONObject {
  schemaVersion: number;
  /*
   * Stable per real-world occurrence, and the receiver's deduplication key:
   *
   *   sign_up:{userId}
   *   subscription_started:{projectId}
   *   subscription_upgraded:{projectId}:{occurredAt}
   *   subscription_downgraded:{projectId}:{occurredAt}
   *   enterprise_license_issued:{enterpriseLicenseId}
   *   first_payment:{projectId}
   *   subscription_ended:{stripeSubscriptionId}
   *
   * Five of these are naturally unique — a user signs up once, a project has
   * one first subscription and one first payment, a licence row is issued
   * once, a Stripe subscription ends once — so the queue retrying a job, or
   * Stripe sending a webhook again, cannot produce a second conversion. A
   * plan change can legitimately recur for one project, so its id carries
   * the instant it happened.
   */
  eventId: string;
  eventType: MarketingEventType;
  // ISO 8601, UTC. The moment the conversion happened, not the moment it was sent.
  occurredAt: string;
  /*
   * Identity. Both forms are sent: the address for a direct CRM join, and its
   * SHA-256 (trimmed and lowercased before hashing, per the usual ad-platform
   * normalisation) for anywhere a digest is wanted instead. Absent only when
   * OneUptime genuinely has no address for the conversion.
   */
  email?: string | undefined;
  emailHash?: string | undefined;
  attribution: MarketingEventAttribution;
  // Event-specific detail. See the per-event builders in MarketingEventUtil.
  data: JSONObject;
}
