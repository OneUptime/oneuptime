import { DisableTelemetry } from "../../EnvironmentConfig";
import { AsyncLocalStorage } from "async_hooks";

export type TelemetryContextAttributeValue =
  | string
  | number
  | boolean
  | undefined;

/**
 * Canonical set of tenant/business attributes we propagate across a unit of
 * work (an HTTP request, a worker job, a probe check, a cron run). The open
 * index signature allows additional ad-hoc keys, but prefer the named ones so
 * dashboards and queries stay consistent.
 */
export interface TelemetryContextAttributes {
  userId?: string | undefined;
  projectId?: string | undefined;
  requestId?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
  monitorId?: string | undefined;
  statusPageId?: string | undefined;
  scheduledMaintenanceId?: string | undefined;
  onCallDutyPolicyId?: string | undefined;
  onCallDutyPolicyScheduleId?: string | undefined;
  incidentEpisodeId?: string | undefined;
  alertEpisodeId?: string | undefined;
  workspaceType?: string | undefined;
  channelId?: string | undefined;
  [key: string]: TelemetryContextAttributeValue;
}

interface TelemetryContextStore {
  attributes: Record<string, string | number | boolean>;
}

/**
 * Ambient, mutable telemetry context backed by AsyncLocalStorage.
 *
 * Why this exists: OpenTelemetry span attributes do NOT propagate from a
 * parent span to its children, and OneUptime sets tenant context (projectId,
 * userId, ...) deep in middleware while the spans that matter are created much
 * further down the call stack. Rather than thread attributes through every
 * function or tag ~1958 `@CaptureSpan` call sites by hand, we keep a small
 * mutable attribute bag scoped to the current unit of work. `ContextSpanProcessor`
 * stamps it onto every span at creation, and `Logger` merges it into every log
 * record — so context flows everywhere automatically.
 *
 * Seed a scope at each entry point with `runWithContext`, then enrich it as
 * more identifiers become known with `setAttributes`.
 */
export default class TelemetryContext {
  private static storage: AsyncLocalStorage<TelemetryContextStore> =
    new AsyncLocalStorage<TelemetryContextStore>();

  /**
   * Identifier keys we look for when seeding context from an arbitrary payload
   * (see {@link pickKnownAttributes}).
   */
  private static readonly KNOWN_ID_KEYS: Array<string> = [
    "projectId",
    "userId",
    "monitorId",
    "incidentId",
    "alertId",
    "statusPageId",
    "scheduledMaintenanceId",
    "onCallDutyPolicyId",
    "onCallDutyPolicyScheduleId",
    "incidentEpisodeId",
    "alertEpisodeId",
    "workspaceType",
    "channelId",
    "requestId",
  ];

  /**
   * Run `fn` within a fresh telemetry-context scope seeded with `attributes`.
   * Any attributes from an enclosing scope are inherited so nested units of
   * work (e.g. a job spawned while handling a request) keep their context.
   */
  public static runWithContext<T>(
    attributes: TelemetryContextAttributes,
    fn: () => T,
  ): T {
    if (DisableTelemetry) {
      return fn();
    }

    const inherited: Record<string, string | number | boolean> =
      this.getAttributes();

    const store: TelemetryContextStore = {
      attributes: { ...inherited },
    };

    this.mergeInto(store.attributes, attributes);

    return this.storage.run(store, fn);
  }

  /**
   * Merge `attributes` into the current scope. No-op when there is no active
   * scope (e.g. code running outside any seeded entry point) or telemetry is
   * disabled, so it is always safe to call.
   */
  public static setAttributes(attributes: TelemetryContextAttributes): void {
    if (DisableTelemetry) {
      return;
    }

    const store: TelemetryContextStore | undefined = this.storage.getStore();

    if (!store) {
      return;
    }

    this.mergeInto(store.attributes, attributes);
  }

  /**
   * Read the attributes for the current scope. Returns an empty object when
   * there is no active scope. The returned object is the live store — treat it
   * as read-only (consumers copy it before mutating).
   */
  public static getAttributes(): Record<string, string | number | boolean> {
    const store: TelemetryContextStore | undefined = this.storage.getStore();

    if (!store) {
      return {};
    }

    return store.attributes;
  }

  /**
   * Best-effort extraction of known tenant/business identifiers from an
   * arbitrary object (e.g. a queue job's `data` payload), so worker jobs can
   * seed context without every job knowing about telemetry. Values are coerced
   * to strings; unknown/empty values are skipped.
   */
  public static pickKnownAttributes(data: unknown): TelemetryContextAttributes {
    const attributes: TelemetryContextAttributes = {};

    if (!data || typeof data !== "object") {
      return attributes;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;

    for (const key of this.KNOWN_ID_KEYS) {
      const value: unknown = record[key];

      if (value === undefined || value === null) {
        continue;
      }

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        attributes[key] = value;
        continue;
      }

      // ObjectID-like values expose a meaningful toString().
      const asString: string = String(value);
      if (asString && asString !== "[object Object]") {
        attributes[key] = asString;
      }
    }

    return attributes;
  }

  private static mergeInto(
    target: Record<string, string | number | boolean>,
    attributes: TelemetryContextAttributes,
  ): void {
    for (const key in attributes) {
      const value: TelemetryContextAttributeValue = attributes[key];

      if (value !== undefined && value !== null) {
        target[key] = value;
      }
    }
  }
}
