/*
 * WHICH RECORDS A LOG OR TRACE SCRUB RULE APPLIES TO (#10433).
 *
 * A scrub rule may name the service it is for (LogScrubRule.serviceId,
 * TraceScrubRule.serviceId): it then hides data in the logs or spans that
 * service sends, and in no other service's. A rule that names none applies
 * to every service and app of the project, as every rule did before a rule
 * could name one, so a rule saved before keeps doing what it did.
 *
 * Scrub It makes its rule for the service a finding was seen in: a finding
 * is evidence about one service's telemetry, and a rule over every service
 * changed records nobody had found anything in, and broke the monitors and
 * recording rules that read them, in services nobody had looked at.
 *
 * A record is a service's by the id it is stored under (primaryEntityId):
 * the Service a log line or a span was sent under. A record stored under no
 * id is no service's, so only the rules that name none apply to it.
 *
 * Read by ingest's log and trace engines (App/FeatureSet/Telemetry/Services/
 * LogScrubRuleService.ts, TraceScrubRuleService.ts) for every record, so the
 * rules of one record are worked out once per rule list and service: a list
 * whose rules name no service is handed back as it is, and a list's rules of
 * a service are kept for the next record of that service. Pure, with no
 * server import, so Data Security's coverage, Security Events and the pages
 * decide alike.
 */

// A rule as this reads it: the service it names, if any.
export interface ScopedScrubRule {
  serviceId?: unknown;
}

// What a list of compiled rules holds: the saved rule inside each.
export interface ScopedCompiledScrubRule {
  rule: ScopedScrubRule;
}

// The most services whose rules are kept per rule list; past it they are worked out each time.
const MAX_SERVICES_KEPT_PER_LIST: number = 1_000;

// An id however it is held: a text, an ObjectID, or nothing.
export function readScopeId(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (typeof value === "object") {
    const text: string = String(value);

    // A plain object's own text is no id.
    return text === "[object Object]" ? "" : text.trim().toLowerCase();
  }

  return "";
}

// The service a rule is for, in lower case: "" for every service.
export function getScrubRuleServiceId(rule: ScopedScrubRule): string {
  return readScopeId(rule.serviceId);
}

// Whether a rule names the service it is for.
export function isServiceScopedScrubRule(rule: ScopedScrubRule): boolean {
  return getScrubRuleServiceId(rule) !== "";
}

/*
 * Whether a rule applies to a record stored under `primaryEntityId`: a rule
 * that names no service applies to every record, one that names a service
 * to that service's records only.
 */
export function doesScrubRuleApplyTo(
  rule: ScopedScrubRule,
  primaryEntityId: unknown,
): boolean {
  const serviceId: string = getScrubRuleServiceId(rule);

  return serviceId === "" || serviceId === readScopeId(primaryEntityId);
}

/*
 * Whether a rule's scope and another's share a service: either names none,
 * or both name the same one. What a reader of one service's telemetry is
 * read against a rule of another with.
 */
export function doScrubScopesMeet(
  serviceIdOfOne: unknown,
  serviceIdsOfOther: ReadonlyArray<unknown> | null,
): boolean {
  const one: string = readScopeId(serviceIdOfOne);

  if (one === "" || serviceIdsOfOther === null) {
    return true;
  }

  return serviceIdsOfOther.some((id: unknown): boolean => {
    return readScopeId(id) === one;
  });
}

// Per rule list: whether any rule names a service, and its rules per service.
interface ListScope<T> {
  hasScopedRules: boolean;
  byService: Map<string, Array<T>>;
}

const scopes: WeakMap<object, ListScope<unknown>> = new WeakMap<
  object,
  ListScope<unknown>
>();

function scopeOf<T extends ScopedCompiledScrubRule>(
  rules: ReadonlyArray<T>,
): ListScope<T> {
  let scope: ListScope<unknown> | undefined = scopes.get(rules);

  if (!scope) {
    scope = {
      hasScopedRules: rules.some((compiled: T): boolean => {
        return isServiceScopedScrubRule(compiled.rule);
      }),
      byService: new Map<string, Array<unknown>>(),
    };
    scopes.set(rules, scope);
  }

  return scope as ListScope<T>;
}

/*
 * The rules of a list that apply to a record stored under
 * `primaryEntityId`, in the list's order: the list itself when none of its
 * rules names a service, so a project whose rules are all project-wide
 * pays nothing per record.
 */
export function getScrubRulesOfRecord<T extends ScopedCompiledScrubRule>(
  rules: Array<T>,
  primaryEntityId: unknown,
): Array<T> {
  if (rules.length === 0) {
    return rules;
  }

  const scope: ListScope<T> = scopeOf(rules);

  if (!scope.hasScopedRules) {
    return rules;
  }

  const serviceId: string = readScopeId(primaryEntityId);
  const kept: Array<T> | undefined = scope.byService.get(serviceId);

  if (kept) {
    return kept;
  }

  const ofRecord: Array<T> = rules.filter((compiled: T): boolean => {
    return doesScrubRuleApplyTo(compiled.rule, serviceId);
  });

  if (scope.byService.size < MAX_SERVICES_KEPT_PER_LIST) {
    scope.byService.set(serviceId, ofRecord);
  }

  return ofRecord;
}
