import { describe, expect, test } from "@jest/globals";
import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  validateRescanInterval,
  validateScanName,
  validateScanTarget,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";

/*
 * The client-side half of the Create Network Device Discovery Scan wizard's
 * validation.
 *
 * Customer report (issue #3377): every step of the wizard accepted whatever
 * was typed into it. A phone-number-shaped value in Scan Target cleared
 * "Next", cleared the SNMP step, cleared the Schedule step, and then failed
 * the final submit with one combined banner rendered above the SCHEDULE
 * fields — describing a value entered two steps earlier, with nothing marking
 * the field that caused it.
 *
 * BasicForm only validates the fields belonging to the step being submitted,
 * so a field-level validator IS the per-step gate. These tests pin the two
 * validators the wizard now hangs off: what they reject, what they let
 * through, and — just as important — what they deliberately stay silent about
 * so the field's own `required` rule keeps its shorter message.
 *
 * The scan-target rule deliberately does not restate the parser: it delegates
 * to ScanTargetUtil.getValidationError, the same function
 * NetworkDeviceDiscoveryScanService.onBeforeCreate throws with. Several cases
 * below assert exactly that identity, so the client and server can never drift
 * into disagreeing about which targets are legal.
 */

type ScanTargetValues = FormValues<NetworkDeviceDiscoveryScan>;

function scanTarget(value: unknown): ScanTargetValues {
  return { cidr: value } as ScanTargetValues;
}

function scanName(value: unknown): ScanTargetValues {
  return { name: value } as ScanTargetValues;
}

function schedule(
  isRecurring: unknown,
  rescanIntervalInMinutes?: unknown,
): ScanTargetValues {
  return {
    isRecurring: isRecurring,
    rescanIntervalInMinutes: rescanIntervalInMinutes,
  } as ScanTargetValues;
}

describe("validateScanTarget — accepts everything the probe can actually sweep", () => {
  test.each([
    ["a /24 in CIDR notation", "192.168.1.0/24"],
    ["a /30", "10.0.0.0/30"],
    ["a /32 single host", "10.0.0.5/32"],
    ["a /17, the largest block inside the scan limit", "10.0.0.0/17"],
    ["an octet range across three octets", "10.16-22.0-255.51-66"],
    ["an octet range in the last octet only", "192.168.1.10-20"],
    ["a bare single address", "10.0.0.5"],
    ["a zero-width range, written as a range", "10.0.0.5-5"],
  ])("%s passes", (_label: string, target: string) => {
    expect(validateScanTarget(scanTarget(target))).toBeNull();
  });

  test("surrounding whitespace is trimmed rather than rejected", () => {
    expect(validateScanTarget(scanTarget("  192.168.1.0/24  "))).toBeNull();
    expect(validateScanTarget(scanTarget("\t10.0.0.5\n"))).toBeNull();
  });

  test("a target exactly at the address ceiling passes", () => {
    // A /17 is 32,768 addresses less network and broadcast.
    const atLimit: string = "10.0.0.0/17";

    expect(ScanTargetUtil.countHosts(atLimit)).toBeLessThanOrEqual(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(validateScanTarget(scanTarget(atLimit))).toBeNull();
  });

  test("a target exactly at the length ceiling passes", () => {
    /*
     * The widest well-formed target: four full ranges. If this ever exceeds
     * MAX_TARGET_LENGTH the cap is too tight to express a legal target, which
     * is a bug in the cap and not in this test.
     */
    const widest: string = "255-255.255-255.255-255.255-255";

    expect(widest.length).toBeLessThanOrEqual(ScanTargetUtil.MAX_TARGET_LENGTH);
    expect(validateScanTarget(scanTarget(widest))).toBeNull();
  });
});

describe("validateScanTarget — stays silent on EMPTY so `required` keeps its message", () => {
  /*
   * customValidation runs LAST in Validation.validate and overwrites whatever
   * validateRequired put on the same field. If this validator spoke up for an
   * empty box, "Scan Target is required." would be replaced by the parser's
   * much longer "A scan target is required. Use CIDR notation..." — on a field
   * the operator has not typed into yet.
   *
   * Note that ScanTargetUtil itself does NOT return null for an empty string;
   * the short-circuit in the validator is doing the work.
   */
  test.each([
    ["an absent key", undefined],
    ["an explicit null", null],
    ["an empty string", ""],
  ])("%s produces no error", (_label: string, value: unknown) => {
    expect(validateScanTarget(scanTarget(value))).toBeNull();
  });

  test("the raw parser would have complained about an empty string", () => {
    expect(ScanTargetUtil.getValidationError("")).not.toBeNull();
  });

  test("a form with no cidr key at all is handled", () => {
    expect(validateScanTarget({} as ScanTargetValues)).toBeNull();
  });
});

describe("validateScanTarget — but a BLANK target is its business", () => {
  /*
   * The distinction is load-bearing, and getting it wrong reproduces the
   * reported bug exactly. Validation.validateRequired measures the UNTRIMMED
   * string, so a lone space has length 1 and satisfies `required`; nothing
   * else on a Text field with only an upper length bound speaks for it either.
   * If this validator also trimmed before deciding the box was empty, "   "
   * would clear every rule on step 1 and fail on the server two steps later —
   * as a banner above the Schedule step.
   *
   * So: empty is `required`'s, blank is ours.
   */
  test.each([
    ["a single space", " "],
    ["several spaces", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
    ["mixed whitespace", " \t \n "],
  ])(
    "%s is rejected here rather than by the server",
    (_label: string, value: string) => {
      expect(validateScanTarget(scanTarget(value))).not.toBeNull();
    },
  );

  test("the message is the server's own, so the two cannot disagree", () => {
    expect(validateScanTarget(scanTarget("   "))).toBe(
      ScanTargetUtil.getValidationError("   "),
    );
    expect(validateScanTarget(scanTarget("   "))).toContain(
      "A scan target is required",
    );
  });
});

describe("validateScanTarget — rejects malformed targets", () => {
  test("the reported case: a phone-number-shaped value", () => {
    const message: string | null = validateScanTarget(scanTarget("9876543210"));

    expect(message).toContain("is not a valid scan target");
    expect(message).toContain("CIDR notation");
    expect(message).toContain("octet-range notation");
  });

  test.each([
    ["free text", "not-a-target"],
    ["a hostname", "router.example.com"],
    ["text with a space", "hello world"],
    ["too few octets", "10.0.0"],
    ["too many octets", "10.0.0.0.0"],
    ["an IPv6 address", "fe80::1"],
  ])("%s is rejected", (_label: string, target: string) => {
    expect(validateScanTarget(scanTarget(target))).not.toBeNull();
  });

  test("a bad octet names the octet, not just the target", () => {
    const message: string | null = validateScanTarget(scanTarget("10.0.0.256"));

    expect(message).toContain('Octet "256"');
    expect(message).toContain("between 0 and 255");
  });

  test("a reversed range says which way round to write it", () => {
    const message: string | null = validateScanTarget(
      scanTarget("10.22-16.0.1"),
    );

    expect(message).toContain("reversed");
    expect(message).toContain("16-22");
  });

  test("a non-numeric octet term is named", () => {
    const message: string | null = validateScanTarget(scanTarget("10.abc.0.1"));

    expect(message).toContain('"abc"');
    expect(message).toContain("not a valid octet");
  });
});

describe("validateScanTarget — rejects malformed CIDR as CIDR", () => {
  /*
   * Anything containing a '/' is a CIDR attempt by intent, so it must report a
   * bad prefix rather than fall through to the far more confusing "not a valid
   * scan target". This is ScanTargetUtil's rule; the test is here because the
   * form is where the operator reads the message.
   */
  test("an out-of-range prefix is reported as a prefix problem", () => {
    const message: string | null = validateScanTarget(
      scanTarget("10.0.0.0/33"),
    );

    expect(message).toContain("Prefix length");
    expect(message).toContain("between /0 and /32");
  });

  test.each([
    ["a missing prefix", "10.0.0.0/"],
    ["a non-numeric prefix", "10.0.0.0/abc"],
    ["a three-octet CIDR", "10.0.0/24"],
  ])("%s is rejected as an invalid IPv4 CIDR", (_label: string, t: string) => {
    expect(validateScanTarget(scanTarget(t))).toContain(
      "is not a valid IPv4 CIDR",
    );
  });

  test("an out-of-range octet inside a CIDR is reported as an octet problem", () => {
    expect(validateScanTarget(scanTarget("10.0.0.300/24"))).toContain(
      "between 0 and 255",
    );
  });
});

describe("validateScanTarget — enforces the ceilings the server enforces", () => {
  /*
   * The two rules that were previously reachable ONLY by submitting the whole
   * wizard. Both are well-formed targets, so neither is caught by syntax.
   */
  test("a /8 is refused for size, and the message quotes both numbers", () => {
    const tooBig: string = "10.0.0.0/8";

    // Well-formed — only the size check can catch this one.
    expect(ScanTargetUtil.isValid(tooBig)).toBe(true);

    const message: string | null = validateScanTarget(scanTarget(tooBig));

    expect(message).toContain(
      ScanTargetUtil.MAX_SCAN_HOSTS.toLocaleString("en-US"),
    );
    expect(message).toContain("16,777,214");
    expect(message).toContain("scan limit");
  });

  test("an unbounded octet range is refused for size", () => {
    expect(validateScanTarget(scanTarget("10.0-255.0-255.0-255"))).toContain(
      "scan limit",
    );
  });

  test("one address over the ceiling is refused", () => {
    // A /16 is 65,534 addresses — the first CIDR block past the limit.
    const overLimit: string = "10.0.0.0/16";

    expect(ScanTargetUtil.countHosts(overLimit)).toBeGreaterThan(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(validateScanTarget(scanTarget(overLimit))).toContain("scan limit");
  });

  test("a target past the length ceiling is refused before it is parsed", () => {
    const tooLong: string = `10.0.0.0/24${" ".repeat(0)}`.padEnd(
      ScanTargetUtil.MAX_TARGET_LENGTH + 1,
      "0",
    );

    expect(tooLong.length).toBeGreaterThan(ScanTargetUtil.MAX_TARGET_LENGTH);
    expect(validateScanTarget(scanTarget(tooLong))).toContain(
      `longer than ${ScanTargetUtil.MAX_TARGET_LENGTH} characters`,
    );
  });

  test("the length message echoes nothing back", () => {
    /*
     * The gate exists so a huge request body is not reflected into an even
     * huger message. A client-side validator has the same duty: the field
     * renders whatever it returns.
     */
    const enormous: string = "9".repeat(5000);
    const message: string = validateScanTarget(scanTarget(enormous)) || "";

    expect(message).not.toContain("999");
    expect(message.length).toBeLessThan(200);
  });
});

describe("validateScanTarget — survives values that are not strings", () => {
  /*
   * A form value is a JSONValue. Nothing stops an initialValues object, a
   * paste, or a future field type from putting a number or an object here, and
   * a validator that throws takes the whole form down with it: validate() runs
   * from a useEffect on every value change, including the first.
   */
  test.each([
    ["a number", 42],
    ["zero", 0],
    ["a boolean", true],
    ["an array", ["10.0.0.0/24"]],
    ["an object", { cidr: "10.0.0.0/24" }],
  ])("%s does not throw", (_label: string, value: unknown) => {
    expect(() => {
      return validateScanTarget(scanTarget(value));
    }).not.toThrow();
  });

  test("a number is parsed as the text it looks like, not silently accepted", () => {
    expect(validateScanTarget(scanTarget(42))).toContain(
      "is not a valid scan target",
    );
  });

  test("zero is treated as typed input, not as empty", () => {
    /*
     * `0` is falsy. Were the validator guarding on truthiness of the raw value
     * rather than of the trimmed string, this would return null and a target
     * of "0" would sail through to the server.
     */
    expect(validateScanTarget(scanTarget(0))).not.toBeNull();
  });
});

describe("validateScanTarget — agrees with the server, exactly", () => {
  /*
   * The whole point of delegating rather than re-implementing. If these ever
   * diverge, the wizard is telling the operator something the create hook does
   * not believe.
   */
  test.each([
    ["9876543210"],
    ["not-a-target"],
    ["10.0.0.0/33"],
    ["10.0.0.256"],
    ["10.22-16.0.1"],
    ["10.0.0.0/8"],
    ["10.0.0.0/24"],
    ["10.16-22.0-255.51-66"],
  ])("%s produces the server's own message", (target: string) => {
    expect(validateScanTarget(scanTarget(target))).toBe(
      ScanTargetUtil.getValidationError(target),
    );
  });
});

describe("validateRescanInterval — only speaks when the scan repeats", () => {
  test.each([
    ["the toggle is off", false],
    ["the toggle was never touched", undefined],
    ["the toggle is null", null],
  ])(
    "%s, so even nonsense is ignored",
    (_label: string, isRecurring: unknown) => {
      expect(validateRescanInterval(schedule(isRecurring, "abc"))).toBeNull();
      expect(validateRescanInterval(schedule(isRecurring, 1))).toBeNull();
    },
  );

  test("a value left behind by a toggle turned back off does not block the form", () => {
    /*
     * The field hides itself via showIf, and Validation skips hidden fields —
     * but the VALUE stays in the form. Both guards have to agree, or turning
     * the toggle off would leave an error on a field that is no longer on
     * screen and no longer submitted.
     */
    expect(validateRescanInterval(schedule(false, 3))).toBeNull();
  });
});

describe("validateRescanInterval — stays silent on empty", () => {
  test.each([
    ["an absent key", undefined],
    ["an explicit null", null],
    ["an empty string", ""],
  ])("%s defers to `required`", (_label: string, value: unknown) => {
    expect(validateRescanInterval(schedule(true, value))).toBeNull();
  });

  test("a recurring form with no interval key at all is handled", () => {
    expect(
      validateRescanInterval({ isRecurring: true } as ScanTargetValues),
    ).toBeNull();
  });

  test("a blank interval is not treated as an empty one", () => {
    /*
     * Same distinction as the scan target: `required` measures the untrimmed
     * string, so "  " satisfies it and nothing would speak for the field if
     * this validator also read it as empty.
     */
    expect(validateRescanInterval(schedule(true, "  "))).not.toBeNull();
  });
});

describe("validateRescanInterval — enforces the floor", () => {
  test.each([
    ["the minimum itself", MINIMUM_RESCAN_INTERVAL_IN_MINUTES],
    ["an hour", 60],
    ["a day", 1440],
    ["a numeric string, as the Number input hands it back", "60"],
  ])("%s passes", (_label: string, value: unknown) => {
    expect(validateRescanInterval(schedule(true, value))).toBeNull();
  });

  test.each([
    ["one under the minimum", MINIMUM_RESCAN_INTERVAL_IN_MINUTES - 1],
    ["one minute", 1],
    ["zero", 0],
    ["a negative interval", -60],
  ])("%s is refused and names the floor", (_label: string, value: unknown) => {
    const message: string | null = validateRescanInterval(
      schedule(true, value),
    );

    expect(message).toContain(String(MINIMUM_RESCAN_INTERVAL_IN_MINUTES));
    expect(message).toContain("at least");
  });

  test("zero is refused rather than read as empty", () => {
    // Same falsy trap as a scan target of 0 — guard on the string, not the value.
    expect(validateRescanInterval(schedule(true, 0))).not.toBeNull();
  });
});

describe("validateRescanInterval — enforces whole minutes", () => {
  /*
   * The column is an integer. The framework's own `minValue` check runs the
   * value through parseInt, so 20.5 reads as 20, clears a floor of 15, and
   * fails the INSERT with a driver error the operator cannot act on. This is
   * the case that made a custom validator necessary rather than a `validation`
   * block.
   */
  test.each([
    ["a fractional interval above the floor", 20.5],
    ["a fractional interval as a string", "20.5"],
    ["a fractional interval below the floor", 2.5],
  ])("%s is refused as not whole", (_label: string, value: unknown) => {
    expect(validateRescanInterval(schedule(true, value))).toContain(
      "whole number",
    );
  });

  test.each([
    ["letters", "abc"],
    ["a partly numeric string", "60 minutes"],
    ["an infinity", Infinity],
    ["a NaN", Number.NaN],
    ["an object", {}],
  ])("%s is refused rather than ignored", (_label: string, value: unknown) => {
    expect(validateRescanInterval(schedule(true, value))).not.toBeNull();
  });

  test("nothing here throws, whatever the value", () => {
    for (const value of [{}, [], true, Symbol.iterator.toString()]) {
      expect(() => {
        return validateRescanInterval(schedule(true, value));
      }).not.toThrow();
    }
  });
});

describe("the minimum rescan interval is the one the form advertises", () => {
  test("is a whole number of minutes and at least a quarter hour", () => {
    expect(Number.isInteger(MINIMUM_RESCAN_INTERVAL_IN_MINUTES)).toBe(true);
    expect(MINIMUM_RESCAN_INTERVAL_IN_MINUTES).toBeGreaterThanOrEqual(15);
  });
});

/*
 * The scan's optional name (issue #3391).
 *
 * The field is not required and the column is nullable, so almost everything
 * typed into it is legal — which makes the two things this validator DOES
 * refuse worth pinning, along with the much longer list it deliberately stays
 * silent about. Silence matters here: a validator that complained about an
 * empty optional box would block "Next" on a step the operator has no reason
 * to fill in.
 */
describe("validateScanName — says nothing about a name the operator may legitimately leave out", () => {
  test.each([
    ["an untouched field", undefined],
    ["an explicitly empty field", ""],
    ["a single space", " "],
    ["several spaces", "     "],
    ["a tab", "\t"],
    ["a newline", "\n"],
  ])("%s is accepted in silence", (_label: string, value: unknown) => {
    expect(validateScanName(scanName(value))).toBeNull();
  });

  test("a field the operator never reached is accepted", () => {
    expect(validateScanName({} as ScanTargetValues)).toBeNull();
  });

  test.each([
    ["a purpose", "Router Discovery - Region 1100"],
    ["a site name", "Switch Discovery — WB Units"],
    ["punctuation and digits", "Region 1100 / floor 3 (v2)"],
    ["accents", "Zürich core switches"],
    ["a name with inner spacing", "Router    Discovery"],
    ["a name that needs trimming", "  Router Discovery  "],
  ])("%s is accepted", (_label: string, value: unknown) => {
    expect(validateScanName(scanName(value))).toBeNull();
  });
});

describe("validateScanName — refuses only what could not be stored", () => {
  test("a name at the column width is accepted", () => {
    expect(
      validateScanName(scanName("a".repeat(ScanNameUtil.MAX_SCAN_NAME_LENGTH))),
    ).toBeNull();
  });

  test("a name past the column width is refused on its own step", () => {
    const error: string | null = validateScanName(
      scanName("a".repeat(ScanNameUtil.MAX_SCAN_NAME_LENGTH + 1)),
    );

    expect(error).not.toBeNull();
    expect(error).toContain(String(ScanNameUtil.MAX_SCAN_NAME_LENGTH));
  });

  /*
   * The length is measured on what would actually be stored. A value that only
   * exceeds the cap because of whitespace this validator's own normalization
   * is about to remove is not an error.
   */
  test("a name that only exceeds the cap before trimming is accepted", () => {
    expect(
      validateScanName(
        scanName(` ${"a".repeat(ScanNameUtil.MAX_SCAN_NAME_LENGTH)}  `),
      ),
    ).toBeNull();
  });

  /*
   * Form values are JSONValues, so a text box is not a guarantee of a string —
   * and this validator is shared with the server hook, which really can be
   * handed one of these by an API client.
   */
  test.each([
    ["a number", 1100],
    ["a boolean", true],
    ["an object", {}],
    ["an array", []],
  ])("%s is refused rather than coerced", (_label: string, value: unknown) => {
    expect(validateScanName(scanName(value))).not.toBeNull();
  });

  test("nothing here throws, whatever the value", () => {
    for (const value of [{}, [], true, 0, Symbol.iterator.toString()]) {
      expect(() => {
        return validateScanName(scanName(value));
      }).not.toThrow();
    }
  });
});

/*
 * The same identity assertion the scan-target validator carries: the form and
 * the server share ONE function, so the inline error under the box and the 400
 * from the API cannot drift into disagreeing about which names are legal.
 */
describe("validateScanName delegates to the rule the server enforces", () => {
  test.each([
    ["a legal name", "Router Discovery"],
    ["an empty box", ""],
    ["a blank box", "   "],
    ["an over-long name", "a".repeat(ScanNameUtil.MAX_SCAN_NAME_LENGTH + 1)],
    ["a non-string", 1100],
  ])("agrees with ScanNameUtil about %s", (_label: string, value: unknown) => {
    expect(validateScanName(scanName(value))).toBe(
      ScanNameUtil.getValidationError(value),
    );
  });
});
