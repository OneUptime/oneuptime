import {
  DeviceNamingOutcome,
  DeviceNamingResult,
} from "../../../Types/NetworkDevice/DeviceNaming";
import { MAX_DEVICE_NAME_LENGTH } from "../../NetworkDiscovery/DiscoveredDeviceBuilder";
import {
  NamePatternProblem,
  NamePatternRendering,
  NamePatternValues,
  NamePlaceholder,
  ParsedNamePattern,
  composeName,
  parseNamePattern,
  readNameCounter,
  renderNamePattern,
} from "./NamePattern";
import {
  NamingLookupTable,
  lookUpNamingValue,
  readNamingLookupTable,
} from "./NamingLookup";
import NamingRuleMatcher, {
  DeviceNamingFacts,
  NamingRuleConditionColumns,
} from "./NamingRuleMatcher";

/*
 * WHAT THE NAMING RULES CALL EACH DEVICE (OneUptime issue #6619).
 *
 * One planner for every place devices are named: the import's preview, the
 * import itself (Review Results, Add to Monitoring and auto import rules)
 * and the rules applied to the devices already in the project. Pure, so
 * every rule below is tested without a database; the server reads the rules,
 * the sites and the project's names and hands them over.
 *
 * For each device, in the order given:
 *
 *   1. The enabled rules are tried top of the list first - the highest
 *      priority number, then the oldest rule - as the rules page lists them.
 *   2. The first rule whose conditions match the device AND whose pattern
 *      it has every value for names it. A rule that matches but lacks a
 *      value (no site code, no row in its lookup table) lets the next rule
 *      try: that is how a lookup table covers the devices it lists and a
 *      broader rule below it the rest.
 *   3. The name must be one no other device in the project has, whatever
 *      its case - device names are unique per project. A pattern with a
 *      counter takes the lowest free number. A pattern without one whose
 *      name is taken does not fall through to the next rule: the device
 *      matched the rule meant for it, and a person decides which of the two
 *      devices keeps the name (NameTaken).
 *   4. A device already in the project that already has the name - or,
 *      with a counter, any number of the pattern - follows the rules and is
 *      left alone: renumbering the switches of a site because 01 came free
 *      would rename what nobody asked to have renamed.
 *
 * Every name a device is given is held for the rest of the plan, so two
 * devices planned together never get the same name, and the outcome depends
 * only on the order the caller gives - the server sorts them first.
 */

/*
 * The rule columns the planner reads, on top of the conditions'. The
 * NetworkDeviceNamingRule model satisfies this structurally.
 */
export interface NamingRuleCandidate extends NamingRuleConditionColumns {
  _id?: unknown;
  id?: unknown;
  name?: string | null | undefined;
  priority?: number | null | undefined;
  createdAt?: Date | string | null | undefined;
  isEnabled?: boolean | null | undefined;
  namePattern?: string | null | undefined;
  lookupKey?: string | null | undefined;
  lookupEntries?: unknown;
}

// A rule read once for a plan: its pattern parsed, its table indexed.
export interface PreparedNamingRule {
  id: string;
  name: string;
  rule: NamingRuleCandidate;
  pattern: ParsedNamePattern;
  lookup: NamingLookupTable | null;
}

function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (
    value &&
    typeof (value as { toString?: () => string }).toString === "function"
  ) {
    const text: string = String(value);
    return text === "[object Object]" ? "" : text;
  }

  return "";
}

function toTime(value: unknown): number {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  return 0;
}

/*
 * The order rules are tried in, as the rules page lists them: the highest
 * priority first, then the oldest, then by id - so two rules with the same
 * place never swap between runs.
 */
export function compareNamingRules(
  left: NamingRuleCandidate,
  right: NamingRuleCandidate,
): number {
  const leftPriority: number =
    typeof left.priority === "number" ? left.priority : 0;
  const rightPriority: number =
    typeof right.priority === "number" ? right.priority : 0;

  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  const leftTime: number = toTime(left.createdAt);
  const rightTime: number = toTime(right.createdAt);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftId: string = readId(left._id ?? left.id);
  const rightId: string = readId(right._id ?? right.id);

  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/**
 * The rules a plan tries, in order: the enabled ones, each with a pattern
 * that can be read. A rule whose stored pattern cannot be read names
 * nothing - the service refuses such a pattern at save, so it is one
 * written around it.
 */
export function prepareNamingRules(
  rules: ReadonlyArray<NamingRuleCandidate>,
): Array<PreparedNamingRule> {
  const prepared: Array<PreparedNamingRule> = [];

  for (const rule of [...rules].sort(compareNamingRules)) {
    if (!rule || rule.isEnabled === false) {
      continue;
    }

    const read:
      | { pattern: ParsedNamePattern }
      | { problem: NamePatternProblem } = parseNamePattern(rule.namePattern);

    if ("problem" in read) {
      continue;
    }

    prepared.push({
      id: readId(rule._id ?? rule.id),
      name: typeof rule.name === "string" ? rule.name : "",
      rule: rule,
      pattern: read.pattern,
      lookup: read.pattern.placeholders.includes(NamePlaceholder.Lookup)
        ? readNamingLookupTable({
            kind: rule.lookupKey,
            entries: rule.lookupEntries,
          })
        : null,
    });
  }

  return prepared;
}

/*
 * THE NAMES THE PROJECT'S DEVICES HAVE, compared without case, and the
 * device holding each. Names given during a plan are added as it goes.
 */
export class DeviceNameRegistry {
  private readonly holders: Map<
    string,
    { name: string; deviceIds: Set<string> }
  > = new Map<string, { name: string; deviceIds: Set<string> }>();

  public constructor(
    entries: Iterable<{
      name?: string | null | undefined;
      deviceId?: string | null | undefined;
    }> = [],
  ) {
    for (const entry of entries) {
      if (entry && typeof entry.name === "string") {
        this.add(entry.name, entry.deviceId || undefined);
      }
    }
  }

  private static keyOf(name: string): string {
    return name.trim().toLowerCase();
  }

  public add(name: string, deviceId?: string | undefined): void {
    const key: string = DeviceNameRegistry.keyOf(name);

    if (!key) {
      return;
    }

    const holder: { name: string; deviceIds: Set<string> } = this.holders.get(
      key,
    ) || { name: name.trim(), deviceIds: new Set<string>() };

    // A name held without a device (one an import is about to create) holds it too.
    holder.deviceIds.add(deviceId || "");
    this.holders.set(key, holder);
  }

  /*
   * True when a device other than `exceptDeviceId` has the name. A device's
   * own name is never taken for itself.
   */
  public isTaken(name: string, exceptDeviceId?: string | undefined): boolean {
    const holder: { name: string; deviceIds: Set<string> } | undefined =
      this.holders.get(DeviceNameRegistry.keyOf(name));

    if (!holder) {
      return false;
    }

    for (const deviceId of holder.deviceIds) {
      if (!exceptDeviceId || deviceId !== exceptDeviceId) {
        return true;
      }
    }

    return false;
  }

  // The name as the device holding it spells it.
  public getHeldName(name: string): string | undefined {
    return this.holders.get(DeviceNameRegistry.keyOf(name))?.name;
  }

  public get size(): number {
    return this.holders.size;
  }
}

// One device to name: being imported, or already in the project.
export interface DeviceNamingSubject {
  // The caller's key for the device: its host key, or its id.
  key: string;
  facts: DeviceNamingFacts;
  // Set for a device already in the project.
  deviceId?: string | undefined;
  currentName?: string | undefined;
}

/*
 * The highest number a counter tries. A pattern with this many devices
 * taking numbers already is not a pattern a person meant.
 */
export const MAX_NAME_COUNTER: number = 99999;

export function getNamePatternValues(
  facts: DeviceNamingFacts,
  lookup: NamingLookupTable | null,
): NamePatternValues {
  return {
    discoveredName: facts.discoveredName,
    ipAddress: facts.ipAddress,
    macAddress: facts.macAddress,
    vendor: facts.vendor,
    siteName: facts.siteName,
    siteCode: facts.siteCode,
    lookupValue: lookup ? lookUpNamingValue(lookup, facts) : undefined,
  };
}

/*
 * A plan's state across devices: the names held, and where each counter
 * pattern's search for a free number starts (every number below it is
 * taken, and names are never released during a plan).
 */
interface PlanState {
  registry: DeviceNameRegistry;
  nextCounters: Map<string, number>;
}

function counterKeyOf(
  rendering: Extract<NamePatternRendering, { isComplete: true }>,
): string {
  return `${rendering.prefix.toLowerCase()}\u0000${rendering.counterWidth}\u0000${rendering.suffix.toLowerCase()}`;
}

function resolveName(data: {
  rendering: Extract<NamePatternRendering, { isComplete: true }>;
  subject: DeviceNamingSubject;
  rule: PreparedNamingRule;
  state: PlanState;
}): DeviceNamingResult {
  const ruleFields: { ruleId: string; ruleName: string } = {
    ruleId: data.rule.id,
    ruleName: data.rule.name,
  };
  const currentName: string = (data.subject.currentName || "").trim();
  const deviceId: string | undefined = data.subject.deviceId;
  const registry: DeviceNameRegistry = data.state.registry;

  const give: (name: string) => DeviceNamingResult = (
    name: string,
  ): DeviceNamingResult => {
    registry.add(name, deviceId);
    return { outcome: DeviceNamingOutcome.Named, name: name, ...ruleFields };
  };

  if (data.rendering.counterWidth === null) {
    const name: string = data.rendering.prefix;

    if (name.length > MAX_DEVICE_NAME_LENGTH) {
      return {
        outcome: DeviceNamingOutcome.NameTooLong,
        name: name,
        ...ruleFields,
      };
    }

    if (currentName && currentName === name) {
      return {
        outcome: DeviceNamingOutcome.FollowsRules,
        name: name,
        ...ruleFields,
      };
    }

    if (registry.isTaken(name, deviceId)) {
      return {
        outcome: DeviceNamingOutcome.NameTaken,
        name: name,
        takenName: registry.getHeldName(name) || name,
        ...ruleFields,
      };
    }

    return give(name);
  }

  // A device that already carries a number of this pattern keeps it.
  if (currentName) {
    const carried: number | null = readNameCounter(currentName, data.rendering);

    if (carried !== null) {
      const name: string = composeName(data.rendering, carried);

      if (name === currentName) {
        return {
          outcome: DeviceNamingOutcome.FollowsRules,
          name: name,
          ...ruleFields,
        };
      }

      // The same number, in the pattern's own case.
      if (
        name.length <= MAX_DEVICE_NAME_LENGTH &&
        !registry.isTaken(name, deviceId)
      ) {
        return give(name);
      }
    }
  }

  const counterKey: string = counterKeyOf(data.rendering);
  let value: number = data.state.nextCounters.get(counterKey) || 1;

  for (; value <= MAX_NAME_COUNTER; value++) {
    const name: string = composeName(data.rendering, value);

    if (name.length > MAX_DEVICE_NAME_LENGTH) {
      return {
        outcome: DeviceNamingOutcome.NameTooLong,
        name: name,
        ...ruleFields,
      };
    }

    if (!registry.isTaken(name, deviceId)) {
      /*
       * The search for the next device starts here, not one past it: the
       * number is free of every other device, but a device's own current
       * name is free only to itself.
       */
      data.state.nextCounters.set(counterKey, value);
      return give(name);
    }
  }

  data.state.nextCounters.set(counterKey, value);

  return {
    outcome: DeviceNamingOutcome.NameTaken,
    name: composeName(data.rendering, MAX_NAME_COUNTER),
    takenName: composeName(data.rendering, MAX_NAME_COUNTER),
    ...ruleFields,
  };
}

function planOne(
  subject: DeviceNamingSubject,
  rules: ReadonlyArray<PreparedNamingRule>,
  state: PlanState,
): DeviceNamingResult {
  let firstMissing: DeviceNamingResult | null = null;

  for (const rule of rules) {
    if (!NamingRuleMatcher.ruleMatches(rule.rule, subject.facts)) {
      continue;
    }

    const rendering: NamePatternRendering = renderNamePattern(
      rule.pattern,
      getNamePatternValues(subject.facts, rule.lookup),
    );

    if (!rendering.isComplete) {
      if (!firstMissing) {
        firstMissing = {
          outcome: DeviceNamingOutcome.MissingValue,
          ruleId: rule.id,
          ruleName: rule.name,
          missing: rendering.missing,
        };
      }

      continue;
    }

    return resolveName({
      rendering: rendering,
      subject: subject,
      rule: rule,
      state: state,
    });
  }

  return firstMissing || { outcome: DeviceNamingOutcome.NoMatchingRule };
}

/**
 * What the rules call each device, by the subject's key. The registry holds
 * the names the project's devices have, and is given every name the plan
 * gives, so a caller that plans in several calls - an import's devices one
 * at a time - hands the same registry to each.
 */
export function planDeviceNames(data: {
  rules: ReadonlyArray<PreparedNamingRule>;
  subjects: ReadonlyArray<DeviceNamingSubject>;
  registry: DeviceNameRegistry;
  // Kept across calls by a caller that plans one device at a time.
  nextCounters?: Map<string, number> | undefined;
}): Map<string, DeviceNamingResult> {
  const results: Map<string, DeviceNamingResult> = new Map<
    string,
    DeviceNamingResult
  >();
  const state: PlanState = {
    registry: data.registry,
    nextCounters: data.nextCounters || new Map<string, number>(),
  };

  for (const subject of data.subjects) {
    if (!subject || results.has(subject.key)) {
      continue;
    }

    if (data.rules.length === 0) {
      results.set(subject.key, { outcome: DeviceNamingOutcome.NoMatchingRule });
      continue;
    }

    results.set(subject.key, planOne(subject, data.rules, state));
  }

  return results;
}

/*
 * A planner for one device at a time, holding its state between calls: the
 * import names each host as it creates it, after reading what the earlier
 * ones were created under.
 */
export class DeviceNamingSession {
  private readonly rules: ReadonlyArray<PreparedNamingRule>;
  private readonly registry: DeviceNameRegistry;
  private readonly nextCounters: Map<string, number> = new Map<
    string,
    number
  >();

  public constructor(data: {
    rules: ReadonlyArray<PreparedNamingRule>;
    registry: DeviceNameRegistry;
  }) {
    this.rules = data.rules;
    this.registry = data.registry;
  }

  public get hasRules(): boolean {
    return this.rules.length > 0;
  }

  public name(subject: DeviceNamingSubject): DeviceNamingResult {
    return (
      planDeviceNames({
        rules: this.rules,
        subjects: [subject],
        registry: this.registry,
        nextCounters: this.nextCounters,
      }).get(subject.key) || { outcome: DeviceNamingOutcome.NoMatchingRule }
    );
  }

  // A name a device was created or renamed under, outside the rules.
  public hold(name: string, deviceId?: string | undefined): void {
    this.registry.add(name, deviceId);
  }

  public isTaken(name: string, exceptDeviceId?: string | undefined): boolean {
    return this.registry.isTaken(name, exceptDeviceId);
  }
}
