import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import {
  doesScrubRuleApplyTo,
  doScrubScopesMeet,
  getScrubRuleServiceId,
  getScrubRulesOfRecord,
  isServiceScopedScrubRule,
  readScopeId,
  ScopedCompiledScrubRule,
} from "../../../Types/Telemetry/ScrubRuleScope";

/*
 * WHICH RECORDS A LOG OR TRACE SCRUB RULE APPLIES TO (#10433).
 *
 * A rule that names a service scrubs that service's records only; one
 * that names none scrubs every record, as every rule did before. Ingest
 * asks for every record, so a list whose rules name no service is handed
 * back as it is, and a list's rules of one service are worked out once.
 */

const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010433a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010433b";

interface TestRule extends ScopedCompiledScrubRule {
  name: string;
}

function rule(name: string, serviceId?: unknown): TestRule {
  return { name, rule: serviceId === undefined ? {} : { serviceId } };
}

function names(rules: Array<TestRule>): Array<string> {
  return rules.map((compiled: TestRule): string => {
    return compiled.name;
  });
}

describe("an id, however it is held", () => {
  test("a text, an ObjectID, or nothing; never a plain object's text", () => {
    expect(readScopeId(` ${CHECKOUT.toUpperCase()} `)).toBe(CHECKOUT);
    expect(readScopeId(new ObjectID(CHECKOUT))).toBe(CHECKOUT);
    expect(readScopeId(null)).toBe("");
    expect(readScopeId(undefined)).toBe("");
    expect(readScopeId({ a: 1 })).toBe("");
    expect(readScopeId(42)).toBe("");
  });

  test("a rule names a service, or every service", () => {
    expect(getScrubRuleServiceId({ serviceId: new ObjectID(CHECKOUT) })).toBe(
      CHECKOUT,
    );
    expect(getScrubRuleServiceId({})).toBe("");
    expect(isServiceScopedScrubRule({ serviceId: CHECKOUT })).toBe(true);
    expect(isServiceScopedScrubRule({ serviceId: null })).toBe(false);
    expect(isServiceScopedScrubRule({ serviceId: "  " })).toBe(false);
  });
});

describe("whether a rule applies to a record", () => {
  test("a rule of no service applies to every record, one with no service too", () => {
    expect(doesScrubRuleApplyTo({}, CHECKOUT)).toBe(true);
    expect(doesScrubRuleApplyTo({ serviceId: null }, PAYMENTS)).toBe(true);
    expect(doesScrubRuleApplyTo({}, undefined)).toBe(true);
  });

  test("a rule of a service applies to that service's records only, whatever the spelling", () => {
    expect(doesScrubRuleApplyTo({ serviceId: CHECKOUT }, CHECKOUT)).toBe(true);
    expect(
      doesScrubRuleApplyTo(
        { serviceId: new ObjectID(CHECKOUT) },
        CHECKOUT.toUpperCase(),
      ),
    ).toBe(true);
    // A span row holds its service as an ObjectID.
    expect(
      doesScrubRuleApplyTo({ serviceId: CHECKOUT }, new ObjectID(CHECKOUT)),
    ).toBe(true);
    expect(doesScrubRuleApplyTo({ serviceId: CHECKOUT }, PAYMENTS)).toBe(false);
  });

  test("a record stored under no service is no service's: a rule of one never applies", () => {
    expect(doesScrubRuleApplyTo({ serviceId: CHECKOUT }, undefined)).toBe(
      false,
    );
    expect(doesScrubRuleApplyTo({ serviceId: CHECKOUT }, "")).toBe(false);
  });
});

describe("whether a rule's scope and a reader's meet", () => {
  test("either of every service meets the other", () => {
    expect(doScrubScopesMeet(null, null)).toBe(true);
    expect(doScrubScopesMeet(null, [CHECKOUT])).toBe(true);
    expect(doScrubScopesMeet(CHECKOUT, null)).toBe(true);
  });

  test("a rule of one service meets a reader of that service, and no other", () => {
    expect(doScrubScopesMeet(CHECKOUT, [PAYMENTS, CHECKOUT])).toBe(true);
    expect(
      doScrubScopesMeet(new ObjectID(CHECKOUT), [CHECKOUT.toUpperCase()]),
    ).toBe(true);
    expect(doScrubScopesMeet(CHECKOUT, [PAYMENTS])).toBe(false);
    expect(doScrubScopesMeet(CHECKOUT, [])).toBe(false);
  });
});

describe("the rules of one record", () => {
  test("a list whose rules name no service is handed back as it is", () => {
    const rules: Array<TestRule> = [rule("a"), rule("b", null)];

    expect(getScrubRulesOfRecord(rules, CHECKOUT)).toBe(rules);
    expect(getScrubRulesOfRecord(rules, undefined)).toBe(rules);
    expect(getScrubRulesOfRecord([], CHECKOUT)).toEqual([]);
  });

  test("a rule of another service is left out, in the list's own order", () => {
    const rules: Array<TestRule> = [
      rule("every service, first"),
      rule("checkout's", CHECKOUT),
      rule("payments'", new ObjectID(PAYMENTS)),
      rule("every service, last"),
    ];

    expect(names(getScrubRulesOfRecord(rules, CHECKOUT))).toEqual([
      "every service, first",
      "checkout's",
      "every service, last",
    ]);
    expect(names(getScrubRulesOfRecord(rules, new ObjectID(PAYMENTS)))).toEqual(
      ["every service, first", "payments'", "every service, last"],
    );
    expect(names(getScrubRulesOfRecord(rules, undefined))).toEqual([
      "every service, first",
      "every service, last",
    ]);
  });

  test("a service's rules are worked out once per list: the next record of it gets the same list", () => {
    const rules: Array<TestRule> = [rule("checkout's", CHECKOUT), rule("all")];
    const first: Array<TestRule> = getScrubRulesOfRecord(rules, CHECKOUT);

    expect(getScrubRulesOfRecord(rules, CHECKOUT.toUpperCase())).toBe(first);
    expect(getScrubRulesOfRecord(rules, PAYMENTS)).not.toBe(first);
    // A new list of the same rules - the next minute's - is worked out again.
    expect(getScrubRulesOfRecord([...rules], CHECKOUT)).not.toBe(first);
    expect(names(getScrubRulesOfRecord([...rules], CHECKOUT))).toEqual(
      names(first),
    );
  });

  test("a list of nothing but another service's rules leaves a record none", () => {
    expect(getScrubRulesOfRecord([rule("x", CHECKOUT)], PAYMENTS)).toEqual([]);
  });
});
