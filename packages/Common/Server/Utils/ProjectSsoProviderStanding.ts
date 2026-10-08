import ObjectID from "../../Types/ObjectID";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import SsoSignInsEnded, { SsoProviderSignInStanding } from "./SsoSignInsEnded";

/*
 * WHETHER A PROJECT'S OWN SSO PROVIDER STILL VOUCHES FOR A SIGN-IN IT GAVE.
 *
 * A project SAML or OIDC sign-in leaves a thirty-day SSO token that names
 * the project, the person and the provider that signed them in
 * (CookieUtil.getSSOToken). OneUptime signed it, so on its own it says only
 * that the provider vouched for the person when they signed in. Whether the
 * provider still does is a question for the database, asked on every
 * request to a project that requires SSO (UserMiddleware.
 * isProjectScopedSsoSignInAuthorizedForProject):
 *
 *   - the provider is still there, and still that project's: a deleted
 *     provider vouches for nobody;
 *   - it is turned on: a provider turned off vouches for nobody;
 *   - the sign-in was given after the provider was last turned off
 *     (signInsEndedAt): turning a provider off ends the sign-ins it gave,
 *     and turning it on again does not bring them back.
 *
 * Changing anything else about a provider - its certificate, client secret,
 * addresses or teams - leaves the sign-ins it gave as they are: they were
 * checked when they were made.
 *
 * The answer is cached on each server for a minute, and concurrent misses
 * share one query. Turning a provider off or on, or deleting it, forgets its
 * project's answers on the server that made the change, and on every other
 * server through RealtimeAccessChanges (SignInRulesChanged, which has each
 * server call ProjectService.forgetSignInRules). A read that was under way
 * when answers were forgotten may hold the old answer: it is returned to its
 * own request but never cached.
 */

export const PROJECT_SSO_PROVIDER_STANDING_CACHE_TTL_MS: number = 60_000;

// The two kinds of provider a project signs people in with itself.
export type ProjectSsoProviderType =
  | SsoProviderType.ProjectSSO
  | SsoProviderType.ProjectOIDC;

/*
 * What the database says about a provider, for one project: whether it
 * exists, is that project's and is turned on, and when it was last turned
 * off (Utils/SsoSignInsEnded, the rule every kind of provider follows).
 */
export type ProjectSsoProviderStandingValue = SsoProviderSignInStanding;

// A provider that is not there, or not the project's: it vouches for nobody.
export const PROVIDER_NOT_FOUND: ProjectSsoProviderStandingValue = {
  isOn: false,
  signInsEndedAtMs: null,
};

export function isProjectSsoProviderType(
  value: unknown,
): value is ProjectSsoProviderType {
  return (
    value === SsoProviderType.ProjectSSO ||
    value === SsoProviderType.ProjectOIDC
  );
}

export default class ProjectSsoProviderStanding {
  private static cache: InMemoryTTLCache<ProjectSsoProviderStandingValue> =
    new InMemoryTTLCache<ProjectSsoProviderStandingValue>(10_000);

  private static inFlight: Map<
    string,
    Promise<ProjectSsoProviderStandingValue>
  > = new Map<string, Promise<ProjectSsoProviderStandingValue>>();

  /*
   * Counts the times answers were forgotten. A read that started before the
   * latest one may hold an answer from before the change, so it is not
   * cached.
   */
  private static forgets: number = 0;

  /*
   * The provider's standing in the project: from this server's cache, or
   * from `load` (one database read, shared by every request that asks while
   * it runs). `load` throws when the database cannot be read; that is an
   * error, never an answer, and it is not cached.
   */
  public static async get(data: {
    projectId: ObjectID;
    providerType: ProjectSsoProviderType;
    providerId: ObjectID;
    load: () => Promise<ProjectSsoProviderStandingValue>;
  }): Promise<ProjectSsoProviderStandingValue> {
    const key: string = ProjectSsoProviderStanding.getKey(data);

    const cached: ProjectSsoProviderStandingValue | undefined =
      ProjectSsoProviderStanding.cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const existing: Promise<ProjectSsoProviderStandingValue> | undefined =
      ProjectSsoProviderStanding.inFlight.get(key);

    if (existing) {
      return existing;
    }

    const forgetsAtStart: number = ProjectSsoProviderStanding.forgets;

    const pending: Promise<ProjectSsoProviderStandingValue> = Promise.resolve()
      .then(data.load)
      .then(
        (
          standing: ProjectSsoProviderStandingValue,
        ): ProjectSsoProviderStandingValue => {
          if (forgetsAtStart === ProjectSsoProviderStanding.forgets) {
            ProjectSsoProviderStanding.cache.set(
              key,
              standing,
              PROJECT_SSO_PROVIDER_STANDING_CACHE_TTL_MS,
            );
          }

          return standing;
        },
      )
      .finally((): void => {
        // Only if the slot is still this read's: a forget may have freed it.
        if (ProjectSsoProviderStanding.inFlight.get(key) === pending) {
          ProjectSsoProviderStanding.inFlight.delete(key);
        }
      });

    ProjectSsoProviderStanding.inFlight.set(key, pending);

    return pending;
  }

  /*
   * Whether a provider with this standing vouches for a sign-in it gave at
   * `issuedAtMs`: the rule every kind of provider follows
   * (SsoSignInsEnded.doesProviderVouchFor).
   */
  public static doesVouchFor(
    standing: ProjectSsoProviderStandingValue,
    issuedAtMs: number | null,
  ): boolean {
    return SsoSignInsEnded.doesProviderVouchFor(standing, issuedAtMs);
  }

  /*
   * Forgets this server's answers for the project's providers, or for every
   * project when none is named, so the next request reads them again.
   */
  public static forget(projectId?: ObjectID | string | undefined): void {
    ProjectSsoProviderStanding.forgets++;

    if (!projectId) {
      ProjectSsoProviderStanding.cache.clear();
      ProjectSsoProviderStanding.inFlight.clear();
      return;
    }

    const prefix: string = `${projectId.toString().toLowerCase()}:`;

    ProjectSsoProviderStanding.cache.deleteByPrefix(prefix);

    for (const key of Array.from(ProjectSsoProviderStanding.inFlight.keys())) {
      if (key.startsWith(prefix)) {
        ProjectSsoProviderStanding.inFlight.delete(key);
      }
    }
  }

  // How many answers this server holds. For tests.
  public static size(): number {
    return ProjectSsoProviderStanding.cache.size();
  }

  /*
   * Keyed by project first, so a project's answers can be forgotten
   * together, then by kind: a SAML and an OIDC provider are rows of
   * different tables, and one must never answer for the other.
   */
  private static getKey(data: {
    projectId: ObjectID;
    providerType: ProjectSsoProviderType;
    providerId: ObjectID;
  }): string {
    return [
      data.projectId.toString().toLowerCase(),
      data.providerType,
      data.providerId.toString().toLowerCase(),
    ].join(":");
  }
}
