import { JSONObject } from "../../../Types/JSON";
import {
  parseMonitorStepRetries,
  parseMonitorStepRetriesInput,
} from "../../../Types/Monitor/MonitorStepRetries";
import { MonitorStepDnsMonitorUtil } from "../../../Types/Monitor/MonitorStepDnsMonitor";
import { MonitorStepDnssecMonitorUtil } from "../../../Types/Monitor/MonitorStepDnssecMonitor";
import { MonitorStepDomainMonitorUtil } from "../../../Types/Monitor/MonitorStepDomainMonitor";
import { MonitorStepExternalStatusPageMonitorUtil } from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { MonitorStepSnmpMonitorUtil } from "../../../Types/Monitor/MonitorStepSnmpMonitor";

/*
 * DNS, DNSSEC, Domain, External Status Page and SNMP monitors keep their retry
 * count in their own step config rather than in the step's retryCount. Those
 * parsers read it with `||`, so a saved 0 came back as 3 — the one setting a
 * user picks to say "check once, do not retry" was the one setting that could
 * not be saved. Now that the value counts retries AFTER the first attempt, a
 * stored 3 means four attempts, which makes the lost 0 louder still.
 */

interface RetriesParserCase {
  name: string;
  // Every one of these types defaults to three retries (four attempts).
  defaultRetries: number;
  /*
   * SNMP's field is optional on the type (Network Device configs omit it),
   * but its parser and default always fill it in; every assertion below
   * expects a number, so an undefined still fails.
   */
  parse: (json: JSONObject) => number | undefined;
  // The value the parsed config writes back out, to prove 0 survives a save.
  roundTrip: (json: JSONObject) => unknown;
  getDefaultRetries: () => number | undefined;
}

const cases: Array<RetriesParserCase> = [
  {
    name: "MonitorStepDnsMonitorUtil",
    defaultRetries: 3,
    parse: (json: JSONObject): number => {
      return MonitorStepDnsMonitorUtil.fromJSON(json).retries;
    },
    roundTrip: (json: JSONObject): unknown => {
      return MonitorStepDnsMonitorUtil.toJSON(
        MonitorStepDnsMonitorUtil.fromJSON(json),
      )["retries"];
    },
    getDefaultRetries: (): number => {
      return MonitorStepDnsMonitorUtil.getDefault().retries;
    },
  },
  {
    name: "MonitorStepDnssecMonitorUtil",
    defaultRetries: 3,
    parse: (json: JSONObject): number => {
      return MonitorStepDnssecMonitorUtil.fromJSON(json).retries;
    },
    roundTrip: (json: JSONObject): unknown => {
      return MonitorStepDnssecMonitorUtil.toJSON(
        MonitorStepDnssecMonitorUtil.fromJSON(json),
      )["retries"];
    },
    getDefaultRetries: (): number => {
      return MonitorStepDnssecMonitorUtil.getDefault().retries;
    },
  },
  {
    name: "MonitorStepDomainMonitorUtil",
    defaultRetries: 3,
    parse: (json: JSONObject): number => {
      return MonitorStepDomainMonitorUtil.fromJSON(json).retries;
    },
    roundTrip: (json: JSONObject): unknown => {
      return MonitorStepDomainMonitorUtil.toJSON(
        MonitorStepDomainMonitorUtil.fromJSON(json),
      )["retries"];
    },
    getDefaultRetries: (): number => {
      return MonitorStepDomainMonitorUtil.getDefault().retries;
    },
  },
  {
    name: "MonitorStepExternalStatusPageMonitorUtil",
    defaultRetries: 3,
    parse: (json: JSONObject): number => {
      return MonitorStepExternalStatusPageMonitorUtil.fromJSON(json).retries;
    },
    roundTrip: (json: JSONObject): unknown => {
      return MonitorStepExternalStatusPageMonitorUtil.toJSON(
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(json),
      )["retries"];
    },
    getDefaultRetries: (): number => {
      return MonitorStepExternalStatusPageMonitorUtil.getDefault().retries;
    },
  },
  {
    name: "MonitorStepSnmpMonitorUtil",
    defaultRetries: 3,
    parse: (json: JSONObject): number | undefined => {
      return MonitorStepSnmpMonitorUtil.fromJSON(json).retries;
    },
    roundTrip: (json: JSONObject): unknown => {
      return MonitorStepSnmpMonitorUtil.toJSON(
        MonitorStepSnmpMonitorUtil.fromJSON(json),
      )["retries"];
    },
    getDefaultRetries: (): number | undefined => {
      return MonitorStepSnmpMonitorUtil.getDefault().retries;
    },
  },
];

describe("Per-type monitor step retries parsing", () => {
  describe.each(cases)(
    "$name",
    ({
      defaultRetries,
      parse,
      roundTrip,
      getDefaultRetries,
    }: RetriesParserCase) => {
      test("keeps a stored 0, so a user can ask for no retries", () => {
        expect(parse({ retries: 0 })).toBe(0);
      });

      test("writes a stored 0 back out as 0", () => {
        expect(roundTrip({ retries: 0 })).toBe(0);
      });

      test("keeps every other count it is given", () => {
        expect(parse({ retries: 1 })).toBe(1);
        expect(parse({ retries: 2 })).toBe(2);
        expect(parse({ retries: 5 })).toBe(5);
      });

      test("falls back to the type default when the key is missing", () => {
        expect(parse({})).toBe(defaultRetries);
      });

      test.each([
        ["null", null],
        ["undefined", undefined],
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["a negative count", -1],
        ["a word", "many"],
        ["an empty string", ""],
        ["a boolean", true],
        ["an object", {}],
      ])(
        "falls back to the type default for %s",
        (_label: string, value: unknown) => {
          expect(parse({ retries: value } as JSONObject)).toBe(defaultRetries);
        },
      );

      test("reads a count stored as a string, 0 included", () => {
        expect(parse({ retries: "0" } as JSONObject)).toBe(0);
        expect(parse({ retries: "4" } as JSONObject)).toBe(4);
      });

      test("still defaults to three retries", () => {
        expect(getDefaultRetries()).toBe(defaultRetries);
      });
    },
  );
});

describe("parseMonitorStepRetries", () => {
  test("keeps 0 and floors a fractional count", () => {
    expect(parseMonitorStepRetries(0, 3)).toBe(0);
    expect(parseMonitorStepRetries(2.7, 3)).toBe(2);
  });

  test("uses the caller's default, whatever it is", () => {
    expect(parseMonitorStepRetries(undefined, 5)).toBe(5);
    expect(parseMonitorStepRetries(null, 0)).toBe(0);
  });
});

describe("parseMonitorStepRetriesInput", () => {
  test("saves a typed 0 as no retries", () => {
    expect(parseMonitorStepRetriesInput("0", 3)).toBe(0);
  });

  test("keeps a typed count", () => {
    expect(parseMonitorStepRetriesInput("2", 3)).toBe(2);
    expect(parseMonitorStepRetriesInput("10", 3)).toBe(10);
  });

  test("reads an empty or non-numeric box as the type default", () => {
    expect(parseMonitorStepRetriesInput("", 3)).toBe(3);
    expect(parseMonitorStepRetriesInput("   ", 3)).toBe(3);
    expect(parseMonitorStepRetriesInput("abc", 3)).toBe(3);
  });

  test("reads a negative count as no retries", () => {
    expect(parseMonitorStepRetriesInput("-1", 3)).toBe(0);
  });
});
