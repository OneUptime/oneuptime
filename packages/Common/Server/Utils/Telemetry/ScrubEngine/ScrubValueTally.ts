import { JSONObject } from "../../../../Types/JSON";
import { readScopeId } from "../../../../Types/Telemetry/ScrubRuleScope";
import ScrubRuleValueCounter, {
  ScrubRuleValueSignal,
} from "../ScrubRuleValueCounter";
import { CompiledScrubRule, getScrubRuleIdText } from "./CompiledScrubRule";

/*
 * HOW MANY VALUES EACH RULE CHANGED IN ONE RECORD (#10366).
 *
 * Each time a rule leaves something in place of a value - a match it
 * redacted, masked or hashed, a text under a key it hid - the engine tells
 * the record's tally which rule did. Once the record is scrubbed, the tally
 * is handed to the rule counter (ScrubRuleValueCounter) with the record's
 * service and service.version, kept per hour: what shows a rule that never
 * fires, and how #10368 proves a leak stopped at its source.
 *
 * A record no rule changed costs nothing but the tally's own creation. Data
 * Security's proof runs rules on copies of records and counts nothing.
 */

// The attribute a record's resource writes its version under, as ingest stores it.
const SERVICE_VERSION_KEYS: ReadonlyArray<string> = [
  "resource.service.version",
  "service.version",
];

// The longest version a counter keeps: past it, the version is no key.
const MAX_SERVICE_VERSION_LENGTH: number = 128;

export class ScrubValueTally {
  private counts: Map<string, number> | null = null;

  public add(compiled: CompiledScrubRule): void {
    const ruleId: string = getScrubRuleIdText(compiled.rule);

    if (!ruleId) {
      return;
    }

    if (!this.counts) {
      this.counts = new Map<string, number>();
    }

    this.counts.set(ruleId, (this.counts.get(ruleId) || 0) + 1);
  }

  public get isEmpty(): boolean {
    return !this.counts || this.counts.size === 0;
  }

  public countOf(ruleId: string): number {
    return this.counts?.get(ruleId.toLowerCase()) || 0;
  }

  public entries(): Array<[string, number]> {
    return this.counts ? Array.from(this.counts.entries()) : [];
  }
}

// The version of the service that wrote a record, as its attributes say: "" when they do not.
export function readServiceVersion(record: JSONObject): string {
  const attributes: unknown = record["attributes"];

  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  for (const key of SERVICE_VERSION_KEYS) {
    const value: unknown = (attributes as JSONObject)[key];

    if (typeof value === "string" && value.trim()) {
      const version: string = value.trim();

      return version.length <= MAX_SERVICE_VERSION_LENGTH ? version : "";
    }
  }

  return "";
}

/*
 * A record's tally, handed to the counter: its project, its kind, the
 * service it was stored under and that service's version. Never throws.
 */
export function countScrubbedValues(data: {
  tally: ScrubValueTally;
  signal: ScrubRuleValueSignal;
  projectId: unknown;
  record: JSONObject;
}): void {
  if (data.tally.isEmpty) {
    return;
  }

  try {
    ScrubRuleValueCounter.add({
      projectId: readScopeId(data.projectId),
      signal: data.signal,
      serviceId: readScopeId(data.record["primaryEntityId"]),
      serviceVersion: readServiceVersion(data.record),
      counts: data.tally.entries(),
    });
  } catch {
    // A counter is never worth a record.
  }
}
