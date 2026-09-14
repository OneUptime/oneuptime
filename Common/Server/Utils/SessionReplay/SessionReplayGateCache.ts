import ProjectService from "../../Services/ProjectService";
import RumApplicationService from "../../Services/RumApplicationService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SessionReplayGateCacheStore, {
  POLICY_CACHE_TTL_MS,
  PolicyCacheEntry,
} from "./SessionReplayGateCacheStore";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import { SelectOptions } from "../../Types/Database/Select";
import ObjectID from "../../../Types/ObjectID";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode, {
  parseSessionReplayMaskingMode,
} from "../../../Types/Rum/SessionReplayMaskingMode";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "../../../Types/Rum/SessionReplay";
import SessionIdentity from "../../../Utils/Rum/SessionIdentity";
import OriginAllowList from "../../../Utils/Telemetry/OriginAllowList";

/*
 * RumApplication.sessionReplaySamplePercentage's column default. Declared
 * here rather than read off the model because this file compiles against
 * checkouts whose model predates the column (see buildSelect).
 */
const DEFAULT_SESSION_REPLAY_SAMPLE_PERCENTAGE: number = 100;

/*
 * Resolves the session-replay policy for one (project, appIdentifier) pair,
 * which is what all three ingest-time gates need: the org-wide allow flag,
 * the per-application enable flag, and the origin allowlist.
 *
 * The two SWITCHES default to refusing. An application that has never been
 * configured, a project that has never opted in, a row whose enable columns
 * have not been migrated yet, and a lookup that fails outright all resolve
 * to "do not accept recordings". That is the opposite posture from the log
 * and trace scrub loaders, which continue with empty rules on failure, and
 * it is deliberate: a span recorded by mistake is a span, a session
 * recorded by mistake is a video of a real person.
 *
 * Once both switches say yes, the remaining policy columns default to what
 * the MODEL defaults to (consent NotRequired, trigger Always, sample 100),
 * because those are instructions to a recorder the customer has already
 * switched on, and a silent downgrade to "record nothing" is the failure
 * the Dashboard cannot explain. See loadPolicy.
 *
 * Cache shape follows the house convention for hot-path policy (a
 * process-local Map with a 60s TTL, as in LogScrubRuleService), with one
 * addition: a Redis kill key checked on a 5s TTL. Without it, turning an
 * application off would take up to the full 60s cache TTL plus the config
 * endpoint's 300s browser cache - roughly six minutes - to stop a live
 * recorder. With it the SERVER stops accepting within 5s and the directive
 * on the chunk response stops the recorder within one flush window.
 *
 * The cache state and its invalidation live in SessionReplayGateCacheStore,
 * which RumApplicationService and ProjectService call from their update and
 * delete hooks. This file imports both of those services, so the store has
 * to be a separate leaf module or the invalidation would be a cycle.
 */

/*
 * Policy columns read off RumApplication and Project.
 *
 * These are declared as a name list rather than inline in a `select` object
 * for one reason: this file is on the ingest hot path and must keep
 * compiling and behaving sanely whether or not a given checkout has the
 * Postgres columns yet. The list is intersected with the columns the model
 * actually declares (see buildSelect), so on a model that predates the
 * columns we simply select none of them, every field reads undefined, and
 * the defaults below refuse the recording - which is exactly the behaviour
 * we want from an unconfigured application anyway.
 */
const RUM_APPLICATION_POLICY_COLUMNS: ReadonlyArray<string> = [
  "isSessionReplayEnabled",
  "sessionReplayMaskingMode",
  "sessionReplayMaskSelectors",
  "sessionReplayBlockSelectors",
  "sessionReplayAllowedOrigins",
  "sessionReplayConsentMode",
  "sessionReplayCaptureTrigger",
  "sessionReplaySamplePercentage",
  "sessionReplayCaptureUserIdentity",
  "sessionReplayCaptureGeo",
  "sessionReplayRecordCanvas",
  "sessionReplayRetentionInDays",
  "sessionReplayMonthlyBudgetInGB",
  "sessionReplayIgnoreErrorPatterns",
  "sessionReplayTracePropagationOrigins",
  "sessionReplayLcpBudgetMs",
  "sessionReplayLongTaskBudgetMs",
  "sessionReplaySlowRequestBudgetMs",
];

const PROJECT_POLICY_COLUMNS: ReadonlyArray<string> = [
  "isSessionReplayAllowed",
];

/*
 * Structural view over the policy columns. Reading them through an index
 * signature rather than the model's own accessors is what lets the file
 * compile against a model that has not grown the columns yet.
 */
interface RumApplicationPolicyView {
  [key: string]: unknown;
}

export interface SessionReplayGatePolicy {
  projectId: ObjectID;
  rumApplicationId: ObjectID;

  /* Org-wide hard off. False means nothing about this project records. */
  isProjectAllowed: boolean;

  /* Per-application opt-in. */
  isAppEnabled: boolean;

  /*
   * Empty means ANY ORIGIN, which is the shipped default (the column
   * defaults to '[]') and what isOriginAllowed below actually implements -
   * this doc used to claim the opposite ("empty means REFUSED"), in the one
   * direction where being wrong matters, since a reader would conclude the
   * feature was locked down out of the box.
   *
   * Filling it in is the only anti-forgery control available: a
   * TelemetryIngestionKey has no expiry, no scope and no origin binding, and
   * the docs tell customers to paste it into browser JavaScript, so anyone
   * who scrapes the key can write recordings into the victim's project until
   * this list names the customer's own domains. The installation-test panel
   * flags an empty list as a warning for exactly that reason.
   */
  allowedOrigins: Array<string>;

  maskingMode: SessionReplayMaskingMode;
  consentMode: SessionReplayConsentMode;
  captureTrigger: SessionReplayCaptureTrigger;

  samplePercentage: number;

  maskSelectors: Array<string>;
  blockSelectors: Array<string>;

  recordCanvas: boolean;
  captureUserIdentity: boolean;
  captureGeo: boolean;

  /* Already clamped to the allowed closed set. */
  retentionInDays: number;

  monthlyBudgetInGB: number | null;

  /*
   * Error message/source regexes whose matches never fire the capture
   * trigger. Served to the recorder verbatim; compiled and capped there.
   */
  ignoreErrorPatterns: Array<string>;

  /*
   * Origins the recorder may inject a W3C traceparent header into.
   * Empty = never inject; the empty default is the CORS safety mechanism.
   */
  tracePropagationOrigins: Array<string>;

  /* Performance capture budgets in milliseconds; 0 disables each. */
  lcpBudgetMs: number;
  longTaskBudgetMs: number;
  slowRequestBudgetMs: number;

  /*
   * Advances whenever the application row is updated, so a recorder can
   * notice its cached config is stale without diffing the whole object.
   */
  configEpoch: number;
}

/*
 * WHY a policy lookup came back empty.
 *
 * getPolicy() folds every refusing state into null, which is the right
 * shape for the gate (it must refuse, and the recorder is told "stop"), but
 * the config endpoint, the /validate probe and the health counters all owe
 * the customer a NAME: a project that was switched off, an application that
 * was switched off, an identifier that matches no application, and a
 * project killed by the operator's kill key are four different settings
 * pages. Answering "not enabled for application" for all four sends the
 * customer to the wrong one.
 *
 * A closed vocabulary that carries no project data; it is only ever
 * answered to a request already holding a valid ingestion key for the
 * project.
 */
export enum SessionReplayPolicyRefusal {
  /* Project.isSessionReplayAllowed is false: the org-wide switch. */
  ProjectNotAllowed = "project-not-allowed",

  /* RumApplication.isSessionReplayEnabled is false for this application. */
  ApplicationNotEnabled = "application-not-enabled",

  /*
   * No application by that identifier could be found or created. With a
   * project that allows replay the application is created on first sight,
   * so this is either a project that does not allow it or a creation that
   * failed.
   */
  ApplicationUnknown = "application-unknown",

  /* The gate cache's Redis kill key is set for the project. */
  ProjectKilled = "project-killed",

  /* No identifier was supplied at all. */
  IdentifierMissing = "app-identifier-missing",
}

export interface SessionReplayPolicyResolution {
  policy: SessionReplayGatePolicy | null;
  /* Set exactly when policy is null. */
  refusal: SessionReplayPolicyRefusal | null;
}

/*
 * What the cache slot holds. The store is untyped by design (see its
 * header); this resolver is its only writer and reader, and it caches the
 * REFUSAL alongside the policy so a repeat lookup for a switched-off
 * application can still say which switch is off without another round trip
 * to Postgres.
 */
interface CachedPolicySlot {
  policy: SessionReplayGatePolicy | null;
  refusal: SessionReplayPolicyRefusal | null;
}

export default class SessionReplayGateCache {
  /*
   * Resolve the policy for one application.
   *
   * Returns null when the recording must be refused for a reason the
   * client cannot fix by retrying: unknown application, project not opted
   * in, or application not enabled. THROWS when the lookup itself failed
   * (Postgres unreachable, Redis error), because those two outcomes must
   * produce different HTTP answers - a terminal 204 that stops the
   * recorder, versus a retryable 503 that does not silently discard a
   * recording during a database blip.
   *
   * Callers that need to say WHY the answer was null use resolvePolicy.
   */
  public static async getPolicy(data: {
    projectId: ObjectID;
    appIdentifier: string;
  }): Promise<SessionReplayGatePolicy | null> {
    const resolution: SessionReplayPolicyResolution =
      await this.resolvePolicy(data);

    return resolution.policy;
  }

  /*
   * getPolicy with the refusal reason attached. Same caching, same kill-key
   * check, same throw-on-lookup-failure contract.
   */
  public static async resolvePolicy(data: {
    projectId: ObjectID;
    appIdentifier: string;
  }): Promise<SessionReplayPolicyResolution> {
    const appIdentifier: string = data.appIdentifier.trim();

    if (!appIdentifier) {
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.IdentifierMissing,
      };
    }

    const cacheKey: string = `${data.projectId.toString()}:${appIdentifier.toLowerCase()}`;

    const cached: PolicyCacheEntry<CachedPolicySlot> | undefined =
      SessionReplayGateCacheStore.getPolicyEntry<CachedPolicySlot>(cacheKey);

    if (
      cached &&
      cached.policy &&
      Date.now() - cached.loadedAt < POLICY_CACHE_TTL_MS
    ) {
      /*
       * The kill key is consulted even on a cache hit - that is the whole
       * point of it. A cached "enabled" policy is only honoured while the
       * project has not been switched off in the last few seconds.
       */
      if (
        cached.policy.policy &&
        (await SessionReplayGateCacheStore.isProjectKilled(data.projectId))
      ) {
        return {
          policy: null,
          refusal: SessionReplayPolicyRefusal.ProjectKilled,
        };
      }

      return {
        policy: cached.policy.policy,
        refusal: cached.policy.refusal,
      };
    }

    const loaded: SessionReplayPolicyResolution = await this.loadPolicy({
      projectId: data.projectId,
      appIdentifier: appIdentifier,
    });

    SessionReplayGateCacheStore.setPolicyEntry<CachedPolicySlot>(cacheKey, {
      policy: loaded.policy,
      refusal: loaded.refusal,
    });

    if (
      loaded.policy &&
      (await SessionReplayGateCacheStore.isProjectKilled(data.projectId))
    ) {
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.ProjectKilled,
      };
    }

    return loaded;
  }

  private static async loadPolicy(data: {
    projectId: ObjectID;
    appIdentifier: string;
  }): Promise<SessionReplayPolicyResolution> {
    const project: Project | null = await ProjectService.findOneBy({
      query: {
        _id: data.projectId.toString(),
      },
      select: this.buildSelect(new Project(), PROJECT_POLICY_COLUMNS),
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      /*
       * The key authenticated a project that no longer exists (deleted
       * between the key check and here). Nothing about it is allowed.
       */
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.ProjectNotAllowed,
      };
    }

    const projectView: RumApplicationPolicyView =
      project as unknown as RumApplicationPolicyView;

    const isProjectAllowed: boolean =
      projectView["isSessionReplayAllowed"] === true;

    let app: RumApplication | null = await RumApplicationService.findOneBy({
      query: {
        projectId: data.projectId,
        appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
      },
      select: this.buildSelect(
        new RumApplication(),
        RUM_APPLICATION_POLICY_COLUMNS,
      ),
      props: {
        isRoot: true,
      },
    });

    /*
     * Create the application on first sight, the same way OTel RUM telemetry
     * does via findOrCreateByAppIdentifier.
     *
     * Without this, session replay cannot bootstrap itself at all: there is no
     * "create application" button in the Dashboard - RUM applications appear
     * only once telemetry arrives - so a customer who pastes the recorder
     * snippet and nothing else would get enabled:false forever, with the
     * recorder silently declining to record and no way to fix it from the UI.
     *
     * Only reached behind an authenticated, project-scoped ingestion key, and
     * only for a project that already allows session replay, so this creates
     * exactly the row the customer's own traffic implies.
     */
    if (!app) {
      if (!isProjectAllowed) {
        return {
          policy: null,
          refusal: SessionReplayPolicyRefusal.ProjectNotAllowed,
        };
      }

      await RumApplicationService.findOrCreateByAppIdentifier({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
      });

      app = await RumApplicationService.findOneBy({
        query: {
          projectId: data.projectId,
          appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
        },
        select: this.buildSelect(
          new RumApplication(),
          RUM_APPLICATION_POLICY_COLUMNS,
        ),
        props: {
          isRoot: true,
        },
      });
    }

    if (!app || !app.id) {
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.ApplicationUnknown,
      };
    }

    const appView: RumApplicationPolicyView =
      app as unknown as RumApplicationPolicyView;

    const isAppEnabled: boolean = appView["isSessionReplayEnabled"] === true;

    /*
     * Both flags are required. Returning null rather than a disabled policy
     * keeps every caller from having to remember to check them: if this
     * function hands back an object at all, recording is permitted. The
     * project switch is reported ahead of the application switch because
     * flipping the application on does nothing while the project is off.
     */
    if (!isProjectAllowed) {
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.ProjectNotAllowed,
      };
    }

    if (!isAppEnabled) {
      return {
        policy: null,
        refusal: SessionReplayPolicyRefusal.ApplicationNotEnabled,
      };
    }

    const requestedRetentionDays: number = this.readNumber(
      appView["sessionReplayRetentionInDays"],
      DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
    );

    /*
     * Null-column fallbacks are the MODEL defaults (RumApplication.ts:
     * consent NotRequired, trigger Always, sample 100), not the refusing
     * ones. This gate refuses through the two boolean switches above; once
     * those say yes, a policy column that is null - an explicit null via the
     * CRUD API, a partially applied migration, a checkout behind on
     * migrations - must read as "the default the settings page shows", or
     * the row silently reverts to "capture only on error, sample 0%" while
     * the ingest-status page reports the row's own (null) values and cannot
     * explain the silence. The recorder honours these three as instructions,
     * so they must match what the Dashboard says the application does.
     */
    return {
      policy: {
        projectId: data.projectId,
        rumApplicationId: app.id,
        isProjectAllowed: true,
        isAppEnabled: true,
        allowedOrigins: this.readStringArray(
          appView["sessionReplayAllowedOrigins"],
        ),
        maskingMode: parseSessionReplayMaskingMode(
          appView["sessionReplayMaskingMode"],
        ),
        consentMode:
          appView["sessionReplayConsentMode"] ===
          SessionReplayConsentMode.RequireExplicit
            ? SessionReplayConsentMode.RequireExplicit
            : SessionReplayConsentMode.NotRequired,
        captureTrigger:
          appView["sessionReplayCaptureTrigger"] ===
          SessionReplayCaptureTrigger.OnErrorOrFrustration
            ? SessionReplayCaptureTrigger.OnErrorOrFrustration
            : SessionReplayCaptureTrigger.Always,
        samplePercentage: this.readNumber(
          appView["sessionReplaySamplePercentage"],
          DEFAULT_SESSION_REPLAY_SAMPLE_PERCENTAGE,
        ),
        maskSelectors: this.readStringArray(
          appView["sessionReplayMaskSelectors"],
        ),
        blockSelectors: this.readStringArray(
          appView["sessionReplayBlockSelectors"],
        ),
        recordCanvas: appView["sessionReplayRecordCanvas"] === true,
        captureUserIdentity:
          appView["sessionReplayCaptureUserIdentity"] === true,
        captureGeo: appView["sessionReplayCaptureGeo"] === true,
        retentionInDays: SessionIdentity.clampRetentionDays(
          requestedRetentionDays,
          SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
          DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
        ),
        monthlyBudgetInGB: this.readNullableNumber(
          appView["sessionReplayMonthlyBudgetInGB"],
        ),
        ignoreErrorPatterns: this.readStringArray(
          appView["sessionReplayIgnoreErrorPatterns"],
        ),
        tracePropagationOrigins: this.readStringArray(
          appView["sessionReplayTracePropagationOrigins"],
        ),
        lcpBudgetMs: this.readNumber(appView["sessionReplayLcpBudgetMs"], 0),
        longTaskBudgetMs: this.readNumber(
          appView["sessionReplayLongTaskBudgetMs"],
          0,
        ),
        slowRequestBudgetMs: this.readNumber(
          appView["sessionReplaySlowRequestBudgetMs"],
          0,
        ),
        configEpoch: this.getConfigEpoch(app),
      },
      refusal: null,
    };
  }

  /*
   * Is `origin` covered by the application's allowlist?
   *
   * The matching itself lives in Common/Utils/Telemetry/OriginAllowList so
   * that this gate and the Browser telemetry-ingestion-key gate cannot drift
   * apart - two allowlists with subtly different wildcard rules would be a
   * confusing and exploitable split. What stays HERE is the empty-list
   * policy, which is the one thing the two callers disagree about: session
   * replay reads empty as "any origin", a Browser ingestion key reads it as
   * "nothing". See the class comment in OriginAllowList.
   */
  public static isOriginAllowed(
    policy: SessionReplayGatePolicy,
    origin: string | undefined,
  ): boolean {
    /*
     * An empty allowlist means "any origin", not "no origin".
     *
     * Be aware of what this gives up. TelemetryIngestionKey has no expiry, no
     * scope and no origin binding, and the install instructions put it in
     * plain sight in the customer's browser JavaScript. The allowlist was the
     * only control preventing anyone who scraped that key from writing
     * recordings into the victim's project, so with it empty a project is
     * open to forged sessions until someone fills it in.
     *
     * Populate sessionReplayAllowedOrigins per application in production. The
     * rate limit and the per-project byte budget still bound the damage, but
     * they bound volume, not authenticity.
     */
    if (policy.allowedOrigins.length === 0) {
      return true;
    }

    /*
     * A configured allowlist is still enforced strictly: once the customer has
     * named their origins, a request without an Origin header is refused
     * rather than waved through. OriginAllowList.matches answers false for a
     * missing or blank origin, so that rule is carried by the delegate.
     */
    return OriginAllowList.matches(origin, policy.allowedOrigins);
  }

  /*
   * Invalidation. Delegated to the leaf store so the services that own the
   * policy rows can call the same code without importing this resolver.
   */
  public static async markProjectDisabled(projectId: ObjectID): Promise<void> {
    return await SessionReplayGateCacheStore.markProjectDisabled(projectId);
  }

  public static async clearProjectDisabled(projectId: ObjectID): Promise<void> {
    return await SessionReplayGateCacheStore.clearProjectDisabled(projectId);
  }

  /* Drop cached policy for one project, or for everything. */
  public static clearCache(projectId?: ObjectID | undefined): void {
    SessionReplayGateCacheStore.clearCache(projectId);
  }

  /*
   * Build a `select` restricted to the columns the model instance actually
   * declares. Model properties are initialised to `undefined` in their
   * declarations, so Object.keys on a fresh instance is an accurate list of
   * what exists in this checkout - which keeps a column that has not landed
   * yet out of the generated SQL instead of producing an unknown-column
   * error on every ingest request.
   */
  private static buildSelect<TModel extends BaseModel>(
    instance: TModel,
    optionalColumns: ReadonlyArray<string>,
  ): SelectOptions<TModel> {
    const declared: Set<string> = new Set<string>(Object.keys(instance));

    /*
     * Only _id is universal. projectId and updatedAt are guarded like every
     * other column because this helper is used for BOTH Project and
     * RumApplication, and Project has no projectId of its own - selecting it
     * there asks the ORM for a column that does not exist, which yields no
     * row rather than an error, so the policy silently resolved to null and
     * session replay reported itself disabled with nothing in the logs.
     */
    const select: Record<string, boolean> = {
      _id: true,
    };

    for (const column of ["projectId", "updatedAt", ...optionalColumns]) {
      if (declared.has(column)) {
        select[column] = true;
      }
    }

    return select as SelectOptions<TModel>;
  }

  /*
   * Config epoch is the application row's last-update time in millis. It
   * is monotonic per row, free to compute, and changes on exactly the event
   * a recorder cares about.
   */
  private static getConfigEpoch(app: RumApplication): number {
    const updatedAt: Date | undefined = app.updatedAt;

    if (!updatedAt) {
      return 0;
    }

    const millis: number = new Date(updatedAt).getTime();

    return Number.isFinite(millis) ? millis : 0;
  }

  private static readNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed: number = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private static readNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed: number = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private static readStringArray(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: Array<string> = [];

    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) {
        result.push(entry.trim());
      }
    }

    return result;
  }
}
