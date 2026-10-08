import ObjectID from "../../Types/ObjectID";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "./Realtime/RealtimeAccessChanges";

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
  /*
   * When the provider was last turned off (milliseconds), or null when it
   * never was: a sign-in it gave before then no longer counts, even once it
   * is on again (Utils/SsoSignInsEnded).
   */
  signInsEndedAtMs: number | null;
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

/*
 * Whether a write to a global provider, or to one of its project
 * attachments, may let it sign fewer people in: it turns it off, or
 * restricts the provider to its attached projects.
 */
export function isGlobalProviderNarrowing(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  // Only the write's own fields count, never ones it inherits.
  const writes: (column: string, value: boolean) => boolean = (
    column: string,
    value: boolean,
  ): boolean => {
    return (
      Object.prototype.hasOwnProperty.call(data, column) &&
      (data as Record<string, unknown>)[column] === value
    );
  };

  return (
    writes("isEnabled", false) || writes("restrictToAttachedProjects", true)
  );
}

/*
 * Whether an attachment added, turned off or removed changes who these
 * providers sign in. Only a provider that is on and restricted to its
 * attached projects reads its attachments (doAttachmentsGovernProject); for
 * any other, an attachment only says where people are provisioned. A
 * provider that cannot be named (null) or read counts as restricted, so a
 * failed read never keeps a change quiet.
 */
export async function isAnyAttachedProviderRestricted(data: {
  providerIds: Array<ObjectID | null>;
  getProviderTrust: (providerId: ObjectID) => Promise<GlobalProviderTrust>;
}): Promise<boolean> {
  const asked: Set<string> = new Set();

  for (const providerId of data.providerIds) {
    if (!providerId) {
      return true;
    }

    if (asked.has(providerId.toString())) {
      continue;
    }

    asked.add(providerId.toString());

    try {
      const trust: GlobalProviderTrust =
        await data.getProviderTrust(providerId);

      if (trust.isUsable && trust.restrictToAttachedProjects) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

/*
 * A global provider now signs fewer people in - turned off, deleted,
 * restricted to its attached projects, or an attachment of a restricted
 * one added, turned off or removed. Every server forgets these answers
 * (GlobalConfigService.forgetSignInRules) and asks the live updates it holds
 * again, as their joins were (RealtimeAccessChanges, SignInRulesChanged for
 * the whole instance), so a page signed in with it stops hearing at once,
 * as its requests are refused at once.
 */
export function announceGlobalSignInChange(): void {
  RealtimeAccessChanges.announce({
    kind: RealtimeAccessChangeKind.SignInRulesChanged,
  });
}

/*
 * Counts the times every answer was dropped. A lookup that started before
 * the latest drop may hold an answer from before the change that caused it,
 * so it is handed to the requests waiting on it but never cached.
 */
let forgets: number = 0;

/** Drops every cached answer. Used by the write hooks and by tests. */
export function clearGlobalSsoAuthorizationCaches(): void {
  forgets++;
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

/*
 * One lookup per key at a time, cached for GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS
 * once it answers - unless the answers were dropped while it ran: the
 * change that dropped them may have landed after it read, so its answer is
 * returned to the requests waiting on it and not cached. A lookup that fails
 * is not cached either.
 */
async function loadOnce<T>(
  inFlight: Map<string, Promise<T>>,
  cache: InMemoryTTLCache<T>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing: Promise<T> | undefined = inFlight.get(key);

  if (existing) {
    return existing;
  }

  const forgetsAtStart: number = forgets;

  const loaded: Promise<T> = load().then((value: T): T => {
    if (forgetsAtStart === forgets) {
      cache.set(key, value, GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS);
    }

    return value;
  });

  const pending: Promise<T> = loaded.finally((): void => {
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
  return loadOnce(inFlightTrustLookups, globalSsoProviderTrustCache, key, load);
}

export function loadAttachmentsOnce(
  key: string,
  load: () => Promise<GlobalProviderAttachments>,
): Promise<GlobalProviderAttachments> {
  return loadOnce(
    inFlightAttachmentLookups,
    globalSsoAttachmentsCache,
    key,
    load,
  );
}
