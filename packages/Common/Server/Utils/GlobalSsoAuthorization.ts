import ObjectID from "../../Types/ObjectID";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";

/*
 * The stateful half of Global SSO enforcement.
 *
 * A Global SSO/OIDC token is a 30-day, self-contained JWT with no project
 * binding, so on its own it answers only "this person authenticated against
 * SOME instance-wide identity provider at some point in the last month". Two
 * questions it cannot answer:
 *
 *   1. IS THE PROVIDER STILL TRUSTED? Turning a provider off, or deleting it,
 *      has to actually cut off access. Without a check at request time the
 *      "Enabled" toggle does nothing to anyone already signed in, for up to
 *      thirty days. This check is UNCONDITIONAL - "disabled" has only one
 *      possible meaning.
 *
 *   2. DOES THE PROVIDER GOVERN THIS PROJECT? Deliberately OPT-IN, per
 *      provider, via `restrictToAttachedProjects`. The attachment rows
 *      (GlobalSsoProject / GlobalOidcProject) were introduced as the
 *      PROVISIONING allow-list - "a SAML assertion can only ever provision a
 *      user into projects that a master admin has explicitly attached here",
 *      per the model's own docstring - and the login routers gate a session on
 *      membership of ANY project, not of an attached one. Reading attachments
 *      as an access boundary by default would therefore lock existing users
 *      out of projects they legitimately reach today, immediately on upgrade,
 *      with no way to recover from inside the product. So it stays off unless
 *      an admin asks for it.
 *
 * Both answers come from Postgres and run on every authenticated request
 * against an SSO-enforced project, so both are cached in-process for 60
 * seconds, and concurrent misses share one query.
 */

export const GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS: number = 60_000;

/** What the enforcement path needs to know about a global provider. */
export interface GlobalProviderTrust {
  // The provider row exists and its "Enabled" toggle is on.
  isUsable: boolean;
  // The admin opted this provider into attachment-scoped access.
  restrictToAttachedProjects: boolean;
}

/*
 * Absence of an entry means "not yet looked up", which is why these are read
 * with an explicit `undefined` check rather than a truthiness test: a cached
 * "this provider is disabled" must not be mistaken for a cache miss and
 * re-queried on every single request.
 */
export const globalSsoProviderTrustCache: InMemoryTTLCache<GlobalProviderTrust> =
  new InMemoryTTLCache(10_000);

/**
 * A provider's attachment rows.
 *
 * `hasAnyAttachmentRows` distinguishes "this provider has no attachments at
 * all" from "it has attachments but every one of them is disabled". Collapsing
 * those two would mean an admin disabling the last attachment WIDENS the
 * provider to every project - the exact opposite of the intent.
 */
export interface GlobalProviderAttachments {
  hasAnyAttachmentRows: boolean;
  enabledProjectIds: Array<string>;
}

export const globalSsoAttachmentsCache: InMemoryTTLCache<GlobalProviderAttachments> =
  new InMemoryTTLCache(10_000);

export type GlobalProviderKind = "sso" | "oidc";

/*
 * Namespaced by kind. A Global SSO provider and a Global OIDC provider are
 * different rows in different tables and could in principle share an id;
 * collapsing the keys would let one vouch for the other.
 */
export function globalProviderCacheKey(
  providerKind: GlobalProviderKind,
  providerId: ObjectID,
): string {
  return `${providerKind}:${providerId.toString()}`;
}

/**
 * Decides whether a provider's attachments cover `projectId`, for a provider
 * that has opted into attachment-scoped access.
 *
 * A provider with no attachment rows at all is instance-wide, matching the
 * "default-all" reading the login routers use. A provider that HAS attachment
 * rows governs exactly the enabled ones - so disabling them all denies rather
 * than widens.
 */
export function doAttachmentsGovernProject(
  attachments: GlobalProviderAttachments,
  projectId: ObjectID,
): boolean {
  if (!attachments.hasAnyAttachmentRows) {
    return true;
  }

  return attachments.enabledProjectIds.includes(projectId.toString());
}

/** Drops every cached answer. Used by the write hooks and by tests. */
export function clearGlobalSsoAuthorizationCaches(): void {
  globalSsoProviderTrustCache.clear();
  globalSsoAttachmentsCache.clear();
  inFlightTrustLookups.clear();
  inFlightAttachmentLookups.clear();
}

/*
 * In-flight de-duplication.
 *
 * The multi-tenant permission path fans out over every project the user
 * belongs to CONCURRENTLY. Without this, a cold cache means N simultaneous
 * copies of the same two queries - for a user in fifty projects, a hundred
 * queries where two would do. Worse, failures are never cached, so a database
 * that is already struggling gets the full fan-out again on every request.
 *
 * Sharing the promise collapses all of that to one query per provider, and a
 * rejection is shared too rather than being retried N times in the same tick.
 */
const inFlightTrustLookups: Map<
  string,
  Promise<GlobalProviderTrust>
> = new Map();
const inFlightAttachmentLookups: Map<
  string,
  Promise<GlobalProviderAttachments>
> = new Map();

async function loadOnce<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing: Promise<T> | undefined = inFlight.get(key);

  if (existing) {
    return existing;
  }

  const pending: Promise<T> = load().finally((): void => {
    /*
     * Only clear the slot if it is still OURS. A cache clear between the two
     * (every write to a Global SSO/OIDC service does exactly that, twice) lets
     * a NEWER lookup take the key while this one is still on the wire; a blind
     * delete would evict that newer entry when this one settles, and the fan-
     * out that follows would stop de-duplicating - the one situation this
     * exists for.
     */
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  });

  inFlight.set(key, pending);

  return pending;
}

export function loadTrustOnce(
  key: string,
  load: () => Promise<GlobalProviderTrust>,
): Promise<GlobalProviderTrust> {
  return loadOnce(inFlightTrustLookups, key, load);
}

export function loadAttachmentsOnce(
  key: string,
  load: () => Promise<GlobalProviderAttachments>,
): Promise<GlobalProviderAttachments> {
  return loadOnce(inFlightAttachmentLookups, key, load);
}
