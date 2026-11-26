/*
 * SCRUB RULES THAT KEEP SECURITY EVENTS FROM NAMING AN ATTACKER'S ADDRESS,
 * AND HASH INSTEAD (#10396).
 *
 * An IP Address scrub rule that redacts or masks, on logs or traces that
 * Security Events reads, leaves every attack's event there without an
 * address: nothing to block, nothing for threat intel to look up. Hashing
 * hides the address from people just as well - they read a token - and
 * Security Events' address vault (#10395) still names the address behind
 * it. So every such rule says so, where it is and where the findings it
 * covers are, with one button, Hash Instead, that switches the rule's
 * action. Security Events' setup item uses the same switch.
 *
 * The answers' shape, read by the server and the Dashboard alike.
 */

export const SCRUB_RULES_HIDING_ADDRESSES_API_PATH: string =
  "/telemetry/scrub-rules-hiding-addresses";

export const SCRUB_RULE_HASH_INSTEAD_API_PATH: string =
  "/telemetry/scrub-rule-hash-instead";

export type ScrubRuleAddressSignal = "log" | "trace";

// One rule that keeps Security Events from naming the addresses it hides.
export interface ScrubRuleHidingAddresses {
  signal: ScrubRuleAddressSignal;
  ruleId: string;
  ruleName: string;
  // Redact or Mask: what Hash Instead changes.
  scrubAction: string;
  // The service it is for, in lower case; none for every service (#10433).
  serviceId?: string | undefined;
}

export interface ScrubRulesHidingAddressesAnswer {
  /*
   * False when it could not be told just now whether Security Events reads
   * the project's logs or traces: no rule is said to hide anything from it.
   */
  isChecked: boolean;
  /*
   * The kinds of record Security Events reads addresses from: what the rule
   * form's notice under its actions asks (a rule not saved yet).
   */
  signalsRead: Array<ScrubRuleAddressSignal>;
  rules: Array<ScrubRuleHidingAddresses>;
}

// What Hash Instead asks for: which rule, of which kind.
export interface ScrubRuleHashInsteadRequest {
  signal: ScrubRuleAddressSignal;
  ruleId: string;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isScrubRuleAddressSignal(
  value: unknown,
): value is ScrubRuleAddressSignal {
  return value === "log" || value === "trace";
}

// One rule as it arrived, or null for one that is no rule.
export function readScrubRuleHidingAddresses(
  value: unknown,
): ScrubRuleHidingAddresses | null {
  const entry: Record<string, unknown> = asObject(value);
  const ruleId: string = textOf(entry["ruleId"]).trim();

  if (
    !isScrubRuleAddressSignal(entry["signal"]) ||
    !UUID_PATTERN.test(ruleId)
  ) {
    return null;
  }

  const rule: ScrubRuleHidingAddresses = {
    signal: entry["signal"],
    ruleId: ruleId.toLowerCase(),
    ruleName: textOf(entry["ruleName"]),
    scrubAction: textOf(entry["scrubAction"]),
  };
  const serviceId: string = textOf(entry["serviceId"]).trim();

  if (UUID_PATTERN.test(serviceId)) {
    rule.serviceId = serviceId.toLowerCase();
  }

  return rule;
}

/*
 * An answer as it arrived, read defensively for a page: a rule without an
 * id or a kind is no rule, and an answer that does not say it was checked
 * names none.
 */
export function readScrubRulesHidingAddressesAnswer(
  value: unknown,
): ScrubRulesHidingAddressesAnswer {
  const answer: Record<string, unknown> = asObject(value);

  if (answer["isChecked"] !== true) {
    return { isChecked: false, signalsRead: [], rules: [] };
  }

  const signalsRead: Array<ScrubRuleAddressSignal> = (
    ["log", "trace"] as Array<ScrubRuleAddressSignal>
  ).filter((signal: ScrubRuleAddressSignal): boolean => {
    return (
      Array.isArray(answer["signalsRead"]) &&
      answer["signalsRead"].includes(signal)
    );
  });

  const rules: Array<ScrubRuleHidingAddresses> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of Array.isArray(answer["rules"]) ? answer["rules"] : []) {
    const rule: ScrubRuleHidingAddresses | null =
      readScrubRuleHidingAddresses(item);

    if (rule && !seen.has(rule.ruleId)) {
      seen.add(rule.ruleId);
      rules.push(rule);
    }
  }

  return { isChecked: true, signalsRead, rules };
}

/*
 * Whether a rule hides addresses in the records of a service: one that
 * names no service hides them in every service's.
 */
export function doesHidingRuleReachService(
  rule: Pick<ScrubRuleHidingAddresses, "serviceId">,
  serviceId: string | null | undefined,
): boolean {
  if (!rule.serviceId) {
    return true;
  }

  return rule.serviceId === (serviceId || "").trim().toLowerCase();
}

/*
 * The rule that keeps Security Events from naming the addresses of a
 * finding's records - the first of the answer's rules of that signal that
 * reaches the finding's service - or null. What a finding's notice names.
 */
export function findHidingRuleOfRecords(
  rules: ReadonlyArray<ScrubRuleHidingAddresses>,
  records: {
    signal: ScrubRuleAddressSignal;
    serviceId?: string | null | undefined;
  },
): ScrubRuleHidingAddresses | null {
  return (
    rules.find((rule: ScrubRuleHidingAddresses): boolean => {
      return (
        rule.signal === records.signal &&
        doesHidingRuleReachService(rule, records.serviceId)
      );
    }) || null
  );
}
