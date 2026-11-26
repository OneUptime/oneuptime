import { describe, expect, test } from "@jest/globals";
import {
  doesHidingRuleReachService,
  findHidingRuleOfRecords,
  readScrubRuleHidingAddresses,
  readScrubRulesHidingAddressesAnswer,
  ScrubRuleHidingAddresses,
} from "../../../Types/Telemetry/ScrubRuleAddresses";

/*
 * THE SCRUB RULES THAT HIDE ADDRESSES FROM SECURITY EVENTS, AS A PAGE
 * READS THEM (#10396).
 *
 * The answer is read defensively: one that does not say it was checked
 * names no rule, a rule without an id or a kind is no rule, a rule is named
 * once. A finding's records are hidden by the first rule of their kind that
 * reaches their service.
 */

const RULE_ID: string = "0192f1a0-0000-7000-8000-0000001039d1";
const OTHER_RULE_ID: string = "0192f1a0-0000-7000-8000-0000001039d2";
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001039d3";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-0000001039d4";

describe("the answer, read for a page", () => {
  test("names each rule once, with its kind, its service in lower case, and the kinds read", () => {
    expect(
      readScrubRulesHidingAddressesAnswer({
        isChecked: true,
        signalsRead: ["trace", "log", "metric"],
        rules: [
          {
            signal: "log",
            ruleId: RULE_ID.toUpperCase(),
            ruleName: "Scrub IP addresses",
            scrubAction: "redact",
            serviceId: CHECKOUT.toUpperCase(),
          },
          { signal: "log", ruleId: RULE_ID, ruleName: "again" },
          { signal: "metric", ruleId: OTHER_RULE_ID },
          { signal: "trace", ruleId: "not-an-id" },
          "garbled",
        ],
      }),
    ).toEqual({
      isChecked: true,
      signalsRead: ["log", "trace"],
      rules: [
        {
          signal: "log",
          ruleId: RULE_ID,
          ruleName: "Scrub IP addresses",
          scrubAction: "redact",
          serviceId: CHECKOUT,
        },
      ],
    });
  });

  test("an answer that does not say it was checked names nothing", () => {
    for (const value of [
      undefined,
      null,
      "yes",
      [],
      { rules: [{ signal: "log", ruleId: RULE_ID }] },
      { isChecked: "true", rules: [{ signal: "log", ruleId: RULE_ID }] },
    ]) {
      expect(readScrubRulesHidingAddressesAnswer(value)).toEqual({
        isChecked: false,
        signalsRead: [],
        rules: [],
      });
    }
  });

  test("a rule's service that is no id is left out", () => {
    expect(
      readScrubRuleHidingAddresses({
        signal: "trace",
        ruleId: RULE_ID,
        ruleName: "Span IPs",
        scrubAction: "mask",
        serviceId: "checkout",
      }),
    ).toEqual({
      signal: "trace",
      ruleId: RULE_ID,
      ruleName: "Span IPs",
      scrubAction: "mask",
    });
  });
});

describe("the rule that hides a finding's addresses", () => {
  const everyService: ScrubRuleHidingAddresses = {
    signal: "log",
    ruleId: RULE_ID,
    ruleName: "Scrub IP addresses",
    scrubAction: "redact",
  };
  const payments: ScrubRuleHidingAddresses = {
    signal: "trace",
    ruleId: OTHER_RULE_ID,
    ruleName: "Payments' span IPs",
    scrubAction: "mask",
    serviceId: PAYMENTS,
  };

  test("a rule for every service reaches each; one for a service only that one", () => {
    expect(doesHidingRuleReachService(everyService, CHECKOUT)).toBe(true);
    expect(doesHidingRuleReachService(everyService, null)).toBe(true);
    expect(doesHidingRuleReachService(payments, PAYMENTS.toUpperCase())).toBe(
      true,
    );
    expect(doesHidingRuleReachService(payments, CHECKOUT)).toBe(false);
    expect(doesHidingRuleReachService(payments, undefined)).toBe(false);
  });

  test("the first of the records' kind that reaches their service, or none", () => {
    const rules: Array<ScrubRuleHidingAddresses> = [everyService, payments];

    expect(
      findHidingRuleOfRecords(rules, { signal: "log", serviceId: CHECKOUT }),
    ).toBe(everyService);
    expect(
      findHidingRuleOfRecords(rules, { signal: "trace", serviceId: PAYMENTS }),
    ).toBe(payments);
    expect(
      findHidingRuleOfRecords(rules, { signal: "trace", serviceId: CHECKOUT }),
    ).toBeNull();
  });
});
