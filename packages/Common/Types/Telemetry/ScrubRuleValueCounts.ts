/*
 * HOW MANY VALUES EACH SCRUB RULE CHANGED, BY SERVICE AND VERSION (#10366).
 *
 * Ingest counts every value a log or trace scrub rule redacts, masks or
 * hashes (Server/Utils/Telemetry/ScrubRuleValueCounter), and the scrub rule
 * lists say it: how many values each rule changed in the last days, and -
 * opened - which services and versions they came from. A rule that changes
 * nothing any more says so too: the code stopped writing what it hides, or
 * the rule no longer matches it.
 *
 * The answers' shape, read by the server and the Dashboard alike.
 */

export const SCRUB_RULE_VALUE_COUNTS_API_PATH: string =
  "/telemetry/scrub-rule-value-counts";

// The days a list counts over.
export const SCRUB_RULE_VALUE_COUNT_DAYS: number = 7;

// The most rules one request names: a page of a list, and some.
export const MAX_SCRUB_RULES_PER_COUNT_REQUEST: number = 100;

export type ScrubRuleValueCountSignal = "log" | "trace";

export interface ScrubRuleValueCountsRequest {
  signal: ScrubRuleValueCountSignal;
  scrubRuleIds: Array<string>;
}

// One service's version's share of a rule's count.
export interface ScrubRuleValueCountOfService {
  // In lower case; "" for records stored under no service.
  serviceId: string;
  // As the person may read it; "" when they may not, or it is gone.
  serviceName: string;
  // As the records said it; "" when they said none.
  serviceVersion: string;
  valueCount: number;
  // ISO 8601; "" when not known.
  lastChangedAt: string;
}

export interface ScrubRuleValueCountOfRule {
  scrubRuleId: string;
  valueCount: number;
  lastChangedAt: string;
  // The most first.
  services: Array<ScrubRuleValueCountOfService>;
}

export interface ScrubRuleValueCountsAnswer {
  // When the count starts (ISO 8601), and over how many days.
  since: string;
  days: number;
  // False when the counts could not be read just now: nothing is said of any rule.
  isChecked: boolean;
  // A rule asked about with no row changed nothing in the days.
  rules: Array<ScrubRuleValueCountOfRule>;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isScrubRuleValueCountSignal(
  value: unknown,
): value is ScrubRuleValueCountSignal {
  return value === "log" || value === "trace";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

/*
 * A request, held to what it may ask: a kind of rule, and the rules' ids -
 * each once, the most a request names. Null for one that asks nothing it
 * may.
 */
export function readScrubRuleValueCountsRequest(
  value: unknown,
): ScrubRuleValueCountsRequest | null {
  const json: Record<string, unknown> = asObject(value);

  if (!isScrubRuleValueCountSignal(json["signal"])) {
    return null;
  }

  const ids: Array<string> = Array.from(
    new Set<string>(
      (Array.isArray(json["scrubRuleIds"]) ? json["scrubRuleIds"] : [])
        .filter((id: unknown): id is string => {
          return typeof id === "string" && UUID_PATTERN.test(id.trim());
        })
        .map((id: string): string => {
          return id.trim().toLowerCase();
        }),
    ),
  ).slice(0, MAX_SCRUB_RULES_PER_COUNT_REQUEST);

  return { signal: json["signal"], scrubRuleIds: ids };
}

// An answer as the server sent it, read strictly: what is not one is left out.
export function readScrubRuleValueCountsAnswer(
  value: unknown,
): ScrubRuleValueCountsAnswer {
  const json: Record<string, unknown> = asObject(value);
  const rules: Array<ScrubRuleValueCountOfRule> = [];

  for (const item of Array.isArray(json["rules"]) ? json["rules"] : []) {
    const rule: Record<string, unknown> = asObject(item);
    const scrubRuleId: string = asText(rule["scrubRuleId"]).toLowerCase();

    if (!UUID_PATTERN.test(scrubRuleId)) {
      continue;
    }

    rules.push({
      scrubRuleId,
      valueCount: asCount(rule["valueCount"]),
      lastChangedAt: asText(rule["lastChangedAt"]),
      services: (Array.isArray(rule["services"]) ? rule["services"] : []).map(
        (entry: unknown): ScrubRuleValueCountOfService => {
          const service: Record<string, unknown> = asObject(entry);

          return {
            serviceId: asText(service["serviceId"]),
            serviceName: asText(service["serviceName"]),
            serviceVersion: asText(service["serviceVersion"]),
            valueCount: asCount(service["valueCount"]),
            lastChangedAt: asText(service["lastChangedAt"]),
          };
        },
      ),
    });
  }

  return {
    since: asText(json["since"]),
    days: asCount(json["days"]) || SCRUB_RULE_VALUE_COUNT_DAYS,
    isChecked: json["isChecked"] === true,
    rules,
  };
}

// Each rule's count, folded from rows of one rule, service and version: the most first.
export function foldScrubRuleValueCounts(
  rows: ReadonlyArray<{
    scrubRuleId: string;
    serviceId: string;
    serviceVersion: string;
    valueCount: number;
    lastChangedAt: Date | null;
  }>,
  serviceNames: ReadonlyMap<string, string>,
): Array<ScrubRuleValueCountOfRule> {
  const byRule: Map<string, ScrubRuleValueCountOfRule> = new Map();

  for (const row of rows) {
    const id: string = row.scrubRuleId.toLowerCase();
    const rule: ScrubRuleValueCountOfRule = byRule.get(id) || {
      scrubRuleId: id,
      valueCount: 0,
      lastChangedAt: "",
      services: [],
    };
    const changedAt: string = row.lastChangedAt
      ? row.lastChangedAt.toISOString()
      : "";

    rule.valueCount += row.valueCount;

    if (changedAt > rule.lastChangedAt) {
      rule.lastChangedAt = changedAt;
    }

    rule.services.push({
      serviceId: row.serviceId,
      serviceName: serviceNames.get(row.serviceId.toLowerCase()) || "",
      serviceVersion: row.serviceVersion,
      valueCount: row.valueCount,
      lastChangedAt: changedAt,
    });
    byRule.set(id, rule);
  }

  return Array.from(byRule.values()).map(
    (rule: ScrubRuleValueCountOfRule): ScrubRuleValueCountOfRule => {
      return {
        ...rule,
        services: [...rule.services].sort(
          (
            a: ScrubRuleValueCountOfService,
            b: ScrubRuleValueCountOfService,
          ): number => {
            return b.valueCount - a.valueCount;
          },
        ),
      };
    },
  );
}
