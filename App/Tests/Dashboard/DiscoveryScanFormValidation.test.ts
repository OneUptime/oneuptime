import { describe, expect, test } from "@jest/globals";
import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  isIcmpOnlyScan,
  isSnmpStepNeeded,
  validateRescanInterval,
  validateScanName,
  validateScanTarget,
  validateSnmpConfigs,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  MAXIMUM_SNMP_PORT,
  MAX_SNMP_CONFIGS_PER_SCAN,
  MINIMUM_SNMP_PORT,
} from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";

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

/*
 * The SNMP step's value is a LIST, not a string, and it is written by a
 * CustomComponent rather than by an input — so unlike every other field here
 * it can hold literally any JSON shape the editor (or an initialValues object,
 * or a future caller) puts there.
 */
function snmpConfigs(value: unknown): ScanTargetValues {
  return { snmpConfigs: value } as ScanTargetValues;
}

/*
 * The card the editor seeds a fresh form with: v2c, no community string. The
 * probe falls back to "public" for that, which is a real answer for discovery
 * — so an operator who clicks straight through the wizard still gets a scan
 * that sweeps, exactly as the single-config form did.
 */
function validV2cConfig(id: string): DiscoveryScanSnmpConfig {
  return {
    id: id,
    name: `Config ${id}`,
    snmpVersion: "V2c",
  };
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

/*
 * The SNMP step's credential LIST (issue #3458).
 *
 * A scan used to carry exactly one credential set in flattened columns, and
 * the SNMP step was nine flat Fields. Real subnets are mixed — access switches
 * on v2c with one community, the core on v3, a printer block on the factory
 * default — so a single-credential scan silently missed everything speaking
 * anything else and reported a confident zero. The step now collects an
 * ORDERED LIST through a CustomComponent (SnmpConfigListEditor), and this
 * validator is the gate on it.
 *
 * Three things make it worth its own set of tests rather than trusting
 * SnmpScanConfigUtil's own suite:
 *
 *   - the VALUE is arbitrary JSON. Every other validator here reads a text
 *     box; this one reads whatever a custom component last reported, so "not a
 *     list" is a reachable state rather than a defensive one.
 *   - it is the ONLY rule on the field that can say anything useful.
 *     `required` on a CustomComponent is satisfied by any non-empty value, so
 *     ten half-filled v3 cards with no usernames clear it — and Validation
 *     runs customValidation last, so this message is the one the operator
 *     reads.
 *   - the step it lives on is OPTIONAL now. A scan can be ICMP-only (issue
 *     #3445), and such a scan collects no credentials at all — so "what this
 *     validator says about a list" and "whether anything ever asks it" became
 *     two separate questions. This block answers the first; the block at the
 *     bottom of the file answers the second.
 */
describe("validateSnmpConfigs — stays silent on EMPTY so `required` keeps its message", () => {
  /*
   * Same contract as validateScanTarget above, for the same reason:
   * customValidation runs LAST and overwrites whatever validateRequired put on
   * the field. If this spoke up for a field the editor has not reported into
   * yet, "SNMP Configs is required." would be replaced by a sentence about
   * list contents on a step the operator has not reached.
   *
   * The empty STRING is the case that actually happens: FormField hands a
   * CustomComponent `currentValues[fieldName] || ""`, so an untouched create
   * form carries "" here and not an empty list.
   */
  test.each([
    ["an absent key", undefined],
    ["an explicit null", null],
    [
      "the empty string FormField supplies for an untouched CustomComponent",
      "",
    ],
  ])("%s produces no error", (_label: string, value: unknown) => {
    expect(validateSnmpConfigs(snmpConfigs(value))).toBeNull();
  });

  test("a form with no snmpConfigs key at all is handled", () => {
    expect(validateSnmpConfigs({} as ScanTargetValues)).toBeNull();
  });

  /*
   * The short-circuit is doing real work for "", exactly as it is for the scan
   * target: the shared rule itself calls an empty string "not a list", which
   * would be a confusing thing to say about a box nobody has touched.
   */
  test("the shared rule would have complained about the empty string", () => {
    expect(SnmpScanConfigUtil.getValidationError("")).toBe(
      "SNMP configs must be a list.",
    );
  });
});

describe("validateSnmpConfigs — refuses a list the probe could not sweep", () => {
  /*
   * Deleting every card. Silently treating that as "fall back to the flattened
   * columns" would leave the scan running credentials the operator can no
   * longer see anywhere in the UI, which is how a scan nobody can explain gets
   * created.
   */
  test("an empty list is refused, and says what to do about it", () => {
    const message: string | null = validateSnmpConfigs(snmpConfigs([]));

    expect(message).toBe(SnmpScanConfigUtil.getValidationError([]));
    expect(message).toBe(
      "Add at least one SNMP config, or the scan has no credentials to try.",
    );
  });

  /*
   * The cap is a time budget, not taste: every extra config costs another full
   * SNMP timeout on each address that answers nothing, and a sweep that runs
   * past the probe's deadline is reported Failed with no results at all.
   */
  test("a list past the cap is refused, and the message quotes both numbers", () => {
    const tooMany: Array<DiscoveryScanSnmpConfig> = Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN + 1 },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return validV2cConfig(`config-${index}`);
      },
    );

    const message: string | null = validateSnmpConfigs(snmpConfigs(tooMany));

    expect(message).toBe(SnmpScanConfigUtil.getValidationError(tooMany));
    expect(message).toContain(
      `at most ${MAX_SNMP_CONFIGS_PER_SCAN} SNMP configs`,
    );
    expect(message).toContain(`This one has ${tooMany.length}.`);
  });

  /*
   * A v3 session with no security name is rejected by every device, host after
   * host, and the sweep reports zero rather than failing loudly — the exact
   * invisible failure this feature exists to end. Caught here so it is a
   * sentence under the editor instead.
   */
  test("a v3 config with no username is refused, and names the card", () => {
    const missingUsername: Array<DiscoveryScanSnmpConfig> = [
      { id: "core", snmpVersion: "V3" },
    ];

    const message: string | null = validateSnmpConfigs(
      snmpConfigs(missingUsername),
    );

    expect(message).toBe(
      SnmpScanConfigUtil.getValidationError(missingUsername),
    );
    expect(message).toBe(
      "SNMP config 1: SNMP v3 needs a username (the security name configured on the device).",
    );
  });

  /*
   * The card is named by POSITION, which is the only actionable way to point
   * at one of several identical-looking cards — and the reason the shared rule
   * builds its messages with an index rather than just naming the field.
   */
  test("the position in the message follows the offending card", () => {
    const secondCardIsBad: Array<DiscoveryScanSnmpConfig> = [
      validV2cConfig("first"),
      { id: "second", snmpVersion: "V3" },
    ];

    expect(validateSnmpConfigs(snmpConfigs(secondCardIsBad))).toContain(
      "SNMP config 2:",
    );
  });

  /*
   * The port comes out of a Number input as TEXT, so "161.5" would parseInt to
   * 161, clear both bounds and then be dialled as a port the probe cannot
   * reach. The shared rule checks the raw value for exactly that reason.
   */
  test("a port outside the UDP range is refused, and names the range", () => {
    const badPort: Array<DiscoveryScanSnmpConfig> = [
      { id: "printers", snmpVersion: "V2c", snmpPort: MAXIMUM_SNMP_PORT + 1 },
    ];

    const message: string | null = validateSnmpConfigs(snmpConfigs(badPort));

    expect(message).toBe(SnmpScanConfigUtil.getValidationError(badPort));
    expect(message).toBe(
      `SNMP config 1: the SNMP port must be between ${MINIMUM_SNMP_PORT} and ${MAXIMUM_SNMP_PORT}.`,
    );
  });

  test("a fractional port is refused as not whole rather than truncated", () => {
    const fractionalPort: Array<unknown> = [
      { id: "printers", snmpVersion: "V2c", snmpPort: "161.5" },
    ];

    expect(validateSnmpConfigs(snmpConfigs(fractionalPort))).toBe(
      "SNMP config 1: the SNMP port must be a whole number.",
    );
  });
});

describe("validateSnmpConfigs — accepts every list the probe can sweep", () => {
  /*
   * The single card the editor seeds a fresh form with. If this ever stopped
   * validating, the wizard would refuse to advance past the SNMP step before
   * the operator had typed anything at all.
   */
  test("one v2c config with nothing but a version passes", () => {
    expect(
      validateSnmpConfigs(snmpConfigs([{ id: "seeded", snmpVersion: "V2c" }])),
    ).toBeNull();
  });

  /*
   * No community string. The sweep falls back to "public", which is a real and
   * very common answer for discovery — requiring one would refuse the single
   * most useful default.
   */
  test("a v2c config with no community string passes", () => {
    expect(validateSnmpConfigs(snmpConfigs([validV2cConfig("a")]))).toBeNull();
  });

  /*
   * The whole point of the feature: one scan, several credential sets, tried
   * in order. A mixed subnet — v2c access switches, a v3 core, a printer block
   * on its own port — has to be expressible in one scan.
   */
  test("a mixed list of v1, v2c and authPriv v3 configs passes", () => {
    const mixed: Array<DiscoveryScanSnmpConfig> = [
      { id: "access", name: "Access switches", snmpVersion: "V2c" },
      {
        id: "core",
        name: "Core",
        snmpVersion: "V3",
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "authentication passphrase",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "privacy passphrase",
      },
      {
        id: "printers",
        name: "Printers - factory default",
        snmpVersion: "V1",
        snmpCommunityString: "public",
        snmpPort: 1161,
      },
    ];

    expect(validateSnmpConfigs(snmpConfigs(mixed))).toBeNull();
  });

  test("a list exactly at the cap passes", () => {
    const atCap: Array<DiscoveryScanSnmpConfig> = Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return validV2cConfig(`config-${index}`);
      },
    );

    expect(validateSnmpConfigs(snmpConfigs(atCap))).toBeNull();
  });
});

describe("validateSnmpConfigs — agrees with the server, exactly", () => {
  /*
   * The same identity assertion validateScanTarget and validateScanName carry,
   * and the reason validateSnmpConfigs delegates rather than restating the
   * rules. The write hooks in NetworkDeviceDiscoveryScanService throw
   * BadDataException with THIS function's message, so a divergence here means
   * the editor accepting a list the API is about to refuse — with the refusal
   * arriving as a banner on the last step of the wizard, which is the failure
   * shape issue #3377 was about.
   */
  test.each([
    ["an empty list", []],
    ["a valid single config", [{ id: "a", snmpVersion: "V2c" }]],
    [
      "a valid pair",
      [
        { id: "a", snmpVersion: "V2c" },
        { id: "b", snmpVersion: "V1" },
      ],
    ],
    ["a v3 config with no username", [{ id: "a", snmpVersion: "V3" }]],
    [
      "a v3 config at authPriv with no privacy key",
      [
        {
          id: "a",
          snmpVersion: "V3",
          snmpV3Username: "monitoring",
          snmpV3SecurityLevel: "authPriv",
          snmpV3AuthKey: "authentication passphrase",
        },
      ],
    ],
    [
      "an unrecognized security level",
      [
        {
          id: "a",
          snmpVersion: "V3",
          snmpV3Username: "monitoring",
          snmpV3SecurityLevel: "authAndPriv",
        },
      ],
    ],
    ["a port out of range", [{ id: "a", snmpVersion: "V2c", snmpPort: 0 }]],
    [
      "two configs sharing an id",
      [
        { id: "same", snmpVersion: "V2c" },
        { id: "same", snmpVersion: "V3", snmpV3Username: "monitoring" },
      ],
    ],
    ["a non-object entry", ["not-a-config"]],
    ["a value that is not a list at all", { id: "a" }],
    ["a number", 161],
    ["an explicit null", null],
  ])(
    "produces the server's own answer for %s",
    (_label: string, value: unknown) => {
      expect(validateSnmpConfigs(snmpConfigs(value))).toBe(
        SnmpScanConfigUtil.getValidationError(value),
      );
    },
  );

  /*
   * The ONE deliberate divergence, and it is the short-circuit rather than a
   * disagreement about the rules: an untouched CustomComponent reports "", and
   * the field's own `required` is what should speak for that. The server never
   * sees an empty string here — the editor always reports a list — so nothing
   * downstream depends on the two answers matching for this input.
   */
  test("the only place the two differ is the untouched empty string", () => {
    expect(validateSnmpConfigs(snmpConfigs(""))).toBeNull();
    expect(SnmpScanConfigUtil.getValidationError("")).not.toBeNull();
  });
});

describe("validateSnmpConfigs — survives values that are not credential lists", () => {
  /*
   * validate() runs from a useEffect on EVERY value change, including the
   * first render, so a validator that throws takes the whole wizard down
   * rather than showing a message. This field is the most exposed one on the
   * form: its value comes from a custom component and is stored in a jsonb
   * column, so neither a form control nor a column type constrains its shape.
   */
  test.each([
    ["a number", 42],
    ["zero", 0],
    ["a boolean", true],
    ["a bare string", "V2c"],
    ["an object rather than a list", { id: "a", snmpVersion: "V2c" }],
    ["a list of numbers", [1, 2, 3]],
    ["a list of nulls", [null, null]],
    ["a nested list", [[{ id: "a" }]]],
    ["a deeply nested list", [[[[{ id: "a" }]]]]],
    ["a list holding a list of strings", [["V2c"]]],
    ["a config whose name is not text", [{ id: "a", name: 1100 }]],
    ["a config whose version is an object", [{ id: "a", snmpVersion: {} }]],
  ])("%s does not throw", (_label: string, value: unknown) => {
    expect(() => {
      return validateSnmpConfigs(snmpConfigs(value));
    }).not.toThrow();
  });

  /*
   * Not throwing is only half of it — a shape the form cannot store has to be
   * REFUSED rather than waved through to the API.
   */
  test.each([
    ["a number", 42],
    ["a bare string", "V2c"],
    ["an object rather than a list", { id: "a", snmpVersion: "V2c" }],
    ["a nested list", [[{ id: "a" }]]],
    ["a list of numbers", [1, 2, 3]],
    ["a list of nulls", [null, null]],
  ])("%s is refused rather than accepted", (_label: string, value: unknown) => {
    expect(validateSnmpConfigs(snmpConfigs(value))).not.toBeNull();
  });

  /*
   * `0` is falsy. A guard written against the truthiness of the raw value
   * rather than against undefined/null/"" would read it as "untouched" and let
   * it through — the same falsy trap the scan target and rescan interval tests
   * above pin.
   */
  test("zero is treated as a reported value, not as an untouched field", () => {
    expect(validateSnmpConfigs(snmpConfigs(0))).not.toBeNull();
  });
});

/*
 * Which sweep the operator asked for (issue #3445).
 *
 * "SNMP Version is required" blocked Next on a wizard the operator was trying
 * to use for an ICMP-only sweep — there was no way to say "I only want to know
 * what is alive in 10.20.30.0/24", so the SNMP step's `required` rules spoke
 * for a scan that was never going to send an SNMP packet.
 *
 * The fix is not a new validator but the ABSENCE of one: `isSnmpStepNeeded` is
 * the `showIf` on the wizard's middle step, and BasicForm validates only the
 * fields of the step being submitted (the currentFormStepId guard in
 * Common/UI/Components/Forms/Validation.ts). A step filtered out of `formSteps`
 * can never BE that step, so `required: true` on SNMP Version simply stops
 * speaking rather than blocking a field that is not on screen.
 *
 * WHY THE ABSENT CASE IS THE ONE THAT MATTERS
 *
 * `isSnmpEnabled` is a new optional flag, and three different writers hand one
 * of these objects to the predicates with the key MISSING:
 *
 *   - a scan row created before the column existed (a legacy row read back for
 *     the edit form, which carries no value for a column that was not there);
 *   - a `select` that does not list the column, which yields a row with every
 *     other field populated and this one undefined;
 *   - an older server answering a newer client (or a plain API call that simply
 *     omits it).
 *
 * Every one of those meant "ping sweep, then SNMP" before this change, because
 * that is the only thing a discovery scan has ever done. So absence MUST read
 * as "SNMP", and only an explicit `false` may turn it off. Reading absence as
 * "SNMP is off" would not fail loudly anywhere — it would hide the SNMP step,
 * strip the credentials, and silently stop doing SNMP discovery on every scan
 * in the project.
 */

function scanMode(value: unknown): ScanTargetValues {
  return { isSnmpEnabled: value } as ScanTargetValues;
}

/*
 * ONE table, read by both predicates.
 *
 * isSnmpStepNeeded and isIcmpOnlyScan are used in different places — the
 * former gates a wizard step, the latter gates a field's showIf and a branch of
 * the review copy — and the whole point of shipping them as a pair is that a
 * scan cannot be one kind of scan for the step and the other kind for the
 * fields. Driving both off the same rows is what stops a later edit teaching
 * one of them about a case the other has never heard of.
 */
const SCAN_MODE_CASES: Array<[string, ScanTargetValues, boolean]> = [
  ["a form the operator has not touched yet", {} as ScanTargetValues, true],
  ["a form where the toggle is on", scanMode(true), true],
  [
    "a form where the toggle key is present but undefined",
    scanMode(undefined),
    true,
  ],
  ["a legacy row that has no value for the column", scanMode(null), true],
  ["a form where the operator turned the toggle off", scanMode(false), false],
];

describe("isSnmpStepNeeded — the wizard keeps asking about SNMP unless told not to", () => {
  test.each(SCAN_MODE_CASES)(
    "%s — isSnmpStepNeeded",
    (_label: string, values: ScanTargetValues, needsSnmpStep: boolean) => {
      expect(isSnmpStepNeeded(values)).toBe(needsSnmpStep);
    },
  );

  test("an absent flag keeps the SNMP step, because that is what it has always meant", () => {
    /*
     * Stated on its own, away from the table, because it is the single
     * invariant in this change whose breakage is silent. A legacy row, a select
     * that omits the column and an older server all arrive here as an object
     * with no `isSnmpEnabled` key at all, and every scan they describe is an
     * SNMP scan.
     */
    expect(isSnmpStepNeeded({} as ScanTargetValues)).toBe(true);
    expect(isSnmpStepNeeded(scanMode(undefined))).toBe(true);
    expect(isSnmpStepNeeded(scanMode(null))).toBe(true);
  });

  test("only an explicit boolean false turns the step off", () => {
    /*
     * `!== false` rather than `Boolean(...)`. Everything below is falsy, or
     * looks like a "no" written by something other than the Toggle field — a
     * query string, a JSON body, a CSV import. None of them may switch SNMP off
     * on their own, because the safe direction for an ambiguous value is the
     * sweep the product has always done: a scan that probes SNMP when it did
     * not need to costs one round of packets, whereas a scan that skips SNMP
     * when it should not have finds nothing and says nothing about why.
     */
    for (const value of [0, "", "false", "off", "no", "0", [], {}, NaN]) {
      expect(isSnmpStepNeeded(scanMode(value))).toBe(true);
      expect(isIcmpOnlyScan(scanMode(value))).toBe(false);
    }

    expect(isSnmpStepNeeded(scanMode(false))).toBe(false);
  });

  test("a truthy value is not an off switch either", () => {
    for (const value of [true, 1, "true", "yes", "SNMP"]) {
      expect(isSnmpStepNeeded(scanMode(value))).toBe(true);
    }
  });
});

describe("isIcmpOnlyScan — the exact negation, on the same rows", () => {
  test.each(SCAN_MODE_CASES)(
    "%s — isIcmpOnlyScan",
    (_label: string, values: ScanTargetValues, needsSnmpStep: boolean) => {
      expect(isIcmpOnlyScan(values)).toBe(!needsSnmpStep);
    },
  );

  test("an ICMP-only scan is the ONLY case that answers yes", () => {
    expect(isIcmpOnlyScan(scanMode(false))).toBe(true);

    expect(isIcmpOnlyScan({} as ScanTargetValues)).toBe(false);
    expect(isIcmpOnlyScan(scanMode(true))).toBe(false);
    expect(isIcmpOnlyScan(scanMode(undefined))).toBe(false);
    expect(isIcmpOnlyScan(scanMode(null))).toBe(false);
  });
});

describe("the predicates read the whole form they are handed", () => {
  test("a whole form, not just the flag, is answered the same way", () => {
    /*
     * The predicates are handed the ENTIRE form values object by `showIf`, not
     * a hand-built one, so they have to be indifferent to everything else on
     * it. A structural read (`values.isSnmpEnabled !== false`) is indifferent
     * by construction; a read that first narrowed to a model instance would
     * not be.
     */
    const wholeForm: ScanTargetValues = {
      cidr: "10.244.102.0/24",
      name: "Region 1100 sweep",
      isRecurring: true,
      rescanIntervalInMinutes: 60,
      isSnmpEnabled: false,
    } as ScanTargetValues;

    expect(isSnmpStepNeeded(wholeForm)).toBe(false);
    expect(isIcmpOnlyScan(wholeForm)).toBe(true);
  });
});

/*
 * WHERE THE TWO CHANGES MEET: a credential list on a scan that sends no SNMP.
 *
 * The credential LIST (issue #3458) and the scan METHOD (issue #3445) were
 * built independently and land on the same wizard step. Their combination has
 * a failure mode neither side can see on its own: an operator who starts a v3
 * card, thinks better of it and turns SNMP off is left on a form carrying a
 * list that validateSnmpConfigs refuses — "SNMP config 1: SNMP v3 needs a
 * username" — for a scan that will never send an SNMP packet. That is issue
 * #3445 wearing a new costume: "Next" blocked by a field the operator cannot
 * see, a credential list this time rather than a version dropdown.
 *
 * Three things prevent it, at three different levels. They are deliberately
 * redundant, because each covers a case the others do not:
 *
 *   - the STEP disappears. `isSnmpStepNeeded` is the wizard's step-level
 *     showIf, and BasicForm validates only the fields belonging to the step
 *     being submitted (the currentFormStepId guard in
 *     Common/UI/Components/Forms/Validation.ts) — so a step filtered out of
 *     `formSteps` can never BE that step, and its fields are never judged.
 *   - the FIELD disappears. Its own showIf is `!isIcmpOnlyScan`, which is what
 *     holds in the Edit dialog: one page, no steps, nothing for a step filter
 *     to remove.
 *   - the VALUE is cleared. The method toggle's onChange hands back
 *     `snmpConfigs: undefined` along with `isSnmpEnabled: false`, so on the
 *     ordinary path there is nothing left to judge even if something asked.
 *     (That onChange is a field definition inside Discovery.tsx, which App's
 *     tsc cannot reach — it is pinned against the real captured fields in
 *     Common/Tests/App/Dashboard/DiscoveryScanEditForm.test.tsx and
 *     DiscoveryScanWizardValidation.test.tsx. What IS reachable from here, and
 *     is asserted below, is that the form state that onChange produces is one
 *     every rule in this module agrees is a saveable ICMP-only scan.)
 *
 * What this block deliberately does NOT do is teach validateSnmpConfigs about
 * the scan's method. It is the same function the server validates the write
 * with, and the server must refuse an unstorable list whoever sent it and
 * whatever else is on the row; a client-side copy that fell silent for
 * `isSnmpEnabled: false` would be a second, quieter rule standing in front of
 * the shared one, and the "agrees with the server, exactly" assertions above
 * would stop being true. Hiding the question is the FORM's job, and the form
 * does it where the operator can see it.
 */

/*
 * A whole form, shaped the way `showIf` and `customValidation` are actually
 * handed one: both keys present, alongside the fields from the other steps.
 * The point of every case below is that the two rules are read off the SAME
 * object, so building one that carries only the key under test would test
 * something the wizard never does.
 */
function scanFormWith(
  isSnmpEnabled: unknown,
  configs: unknown,
): ScanTargetValues {
  return {
    cidr: "10.244.102.0/24",
    name: "Region 1100 sweep",
    isSnmpEnabled: isSnmpEnabled,
    snmpConfigs: configs,
  } as ScanTargetValues;
}

/*
 * A card the shared rule refuses: v3 with no security name. A session built
 * from it is rejected by every device, host after host, and the sweep reports
 * a confident zero rather than failing loudly — which is why it is an error at
 * all, and why it is the right value to prove the hiding with. If an ICMP-only
 * scan were still judged against its credential list, THIS is the sentence
 * that would block a ping sweep.
 */
const INCOMPLETE_V3_CONFIG: DiscoveryScanSnmpConfig = {
  id: "core",
  name: "Core",
  snmpVersion: "V3",
};

const INCOMPLETE_V3_MESSAGE: string =
  "SNMP config 1: SNMP v3 needs a username (the security name configured on the device).";

/*
 * Every list shape that would stop the wizard dead if an ICMP-only scan were
 * still asked about it: the half-finished card, the list the operator emptied
 * by deleting every card, and a list past the time-budget cap.
 */
const REFUSED_LIST_CASES: Array<[string, Array<DiscoveryScanSnmpConfig>]> = [
  ["a half-finished v3 card", [INCOMPLETE_V3_CONFIG]],
  ["a list the operator emptied by deleting every card", []],
  [
    "a list past the cap",
    Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN + 1 },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return validV2cConfig(`config-${index}`);
      },
    ),
  ],
];

describe("an ICMP-only scan is never asked for credentials", () => {
  test("both gates are shut, so no field on the SNMP step is submitted at all", () => {
    const icmpOnly: ScanTargetValues = scanFormWith(false, undefined);

    expect(isSnmpStepNeeded(icmpOnly)).toBe(false);
    expect(isIcmpOnlyScan(icmpOnly)).toBe(true);
  });

  test("the form state the method toggle leaves behind has nothing left to refuse", () => {
    /*
     * The ordinary path out of the SNMP step: the toggle's onChange clears the
     * list as it switches the flag, so the form is left holding an absent
     * value — and an absent value is the one case validateSnmpConfigs is
     * silent about anyway, because `required` owns it. The two halves of the
     * merge agree here without either having to know about the other.
     */
    const afterTurningSnmpOff: ScanTargetValues = scanFormWith(
      false,
      undefined,
    );

    expect(validateSnmpConfigs(afterTurningSnmpOff)).toBeNull();
    expect(isSnmpStepNeeded(afterTurningSnmpOff)).toBe(false);
  });

  test.each(REFUSED_LIST_CASES)(
    "%s is HIDDEN on an ICMP-only scan rather than blocking the save",
    (_label: string, configs: Array<DiscoveryScanSnmpConfig>) => {
      const icmpOnly: ScanTargetValues = scanFormWith(false, configs);

      /*
       * The guarantee: whatever is left in the list, an ICMP-only scan is
       * saveable. Both gates have to answer, not just one — the step filter is
       * what the wizard uses, the field's showIf is what the steppless Edit
       * dialog uses, and a scan must not be a ping sweep for one and an SNMP
       * sweep for the other.
       */
      expect(isSnmpStepNeeded(icmpOnly)).toBe(false);
      expect(isIcmpOnlyScan(icmpOnly)).toBe(true);

      /*
       * And this is WHY the gates are load-bearing rather than belt-and-braces
       * decoration: asked directly, the shared rule still refuses this list.
       * If either gate were dropped, the sentence below is what an operator
       * trying to save a ping sweep would read.
       */
      expect(validateSnmpConfigs(icmpOnly)).toBe(
        SnmpScanConfigUtil.getValidationError(configs),
      );
      expect(validateSnmpConfigs(icmpOnly)).not.toBeNull();
    },
  );

  test("the sentence a ping sweep would otherwise be blocked by is a real one", () => {
    /*
     * Spelled out rather than left as "not null", because the value of the
     * test above is entirely in the concreteness of what it is preventing.
     */
    expect(
      validateSnmpConfigs(scanFormWith(false, [INCOMPLETE_V3_CONFIG])),
    ).toBe(INCOMPLETE_V3_MESSAGE);
  });
});

describe("turning SNMP back on puts the credential gate back", () => {
  /*
   * The other direction, and the reason the hiding is expressed as a showIf on
   * a live predicate rather than as a one-time strip on save: the operator can
   * change their mind twice. A scan that is asking for credentials again must
   * be held to every rule issue #3458 added, with nothing carried over from the
   * spell it spent as a ping sweep.
   */
  test("an emptied list is refused again the moment the method flag is on", () => {
    const snmpScan: ScanTargetValues = scanFormWith(true, []);

    expect(isSnmpStepNeeded(snmpScan)).toBe(true);
    expect(isIcmpOnlyScan(snmpScan)).toBe(false);
    expect(validateSnmpConfigs(snmpScan)).toBe(
      "Add at least one SNMP config, or the scan has no credentials to try.",
    );
  });

  test("a half-finished v3 card is refused again, naming the card", () => {
    expect(
      validateSnmpConfigs(scanFormWith(true, [INCOMPLETE_V3_CONFIG])),
    ).toBe(INCOMPLETE_V3_MESSAGE);
  });

  test("a scan carrying no method column at all is judged as the SNMP scan it is", () => {
    /*
     * The absent case, now that there is a credential list for it to be absent
     * ALONGSIDE. A legacy row, a `select` that omits the column and an older
     * server all arrive with no `isSnmpEnabled` key, and every scan they
     * describe is an SNMP scan — so its credentials are still the wizard's
     * business and are still validated. Reading absence as "ICMP-only" here
     * would not fail loudly: it would hide the step, skip the rules, and let a
     * list the probe cannot sweep be saved in silence.
     */
    const legacyRow: ScanTargetValues = {
      cidr: "10.244.102.0/24",
      snmpConfigs: [INCOMPLETE_V3_CONFIG],
    } as ScanTargetValues;

    expect(isSnmpStepNeeded(legacyRow)).toBe(true);
    expect(isIcmpOnlyScan(legacyRow)).toBe(false);
    expect(validateSnmpConfigs(legacyRow)).toBe(INCOMPLETE_V3_MESSAGE);
  });
});

describe("the two rules read the same form without reading each other", () => {
  /*
   * The separation the merge is built on. The method predicates answer off the
   * flag alone and the credential rule answers off the list alone, so neither
   * change can quietly alter the other's verdict — which is what makes the
   * gating auditable: exactly one thing (the showIf) decides whether the
   * question is asked, and exactly one thing (the shared rule) decides the
   * answer.
   */
  test("the method predicates ignore the credential list entirely", () => {
    expect(isSnmpStepNeeded(scanFormWith(true, []))).toBe(true);
    expect(
      isSnmpStepNeeded(scanFormWith(false, [validV2cConfig("access")])),
    ).toBe(false);
    expect(isIcmpOnlyScan(scanFormWith(undefined, "not a list at all"))).toBe(
      false,
    );
    expect(isIcmpOnlyScan(scanFormWith(false, [INCOMPLETE_V3_CONFIG]))).toBe(
      true,
    );
  });

  test("the credential rule gives the server's own answer whatever the method flag says", () => {
    /*
     * The identity assertion from the issue #3458 block above, re-run with the
     * issue #3445 column present. The server's copy of this rule does not know
     * the scan's method either — the service decides whether to RUN it, not
     * what it says — so a client-side answer that varied with the flag would be
     * a divergence by construction.
     */
    const configs: Array<DiscoveryScanSnmpConfig> = [INCOMPLETE_V3_CONFIG];

    for (const mode of [undefined, null, true, false, "no", 0]) {
      expect(validateSnmpConfigs(scanFormWith(mode, configs))).toBe(
        SnmpScanConfigUtil.getValidationError(configs),
      );
    }
  });

  test("a list the probe can sweep is accepted on every kind of scan", () => {
    const configs: Array<DiscoveryScanSnmpConfig> = [validV2cConfig("access")];

    for (const mode of [undefined, null, true, false]) {
      expect(validateSnmpConfigs(scanFormWith(mode, configs))).toBeNull();
    }
  });

  test("nothing here throws, whichever half of the form is nonsense", () => {
    /*
     * validate() and every showIf run from a render pass on EVERY value
     * change, so a throw takes the whole wizard down rather than showing a
     * message. Both halves of the merged form value are exposed: the flag
     * comes from a Toggle but can be written by an API caller, and the list
     * comes from a custom component into a jsonb column.
     */
    for (const mode of [{}, [], "maybe", 0, Number.NaN]) {
      for (const configs of [{}, "V2c", 161, [null], [[{ id: "a" }]]]) {
        expect(() => {
          return validateSnmpConfigs(scanFormWith(mode, configs));
        }).not.toThrow();
        expect(() => {
          return isSnmpStepNeeded(scanFormWith(mode, configs));
        }).not.toThrow();
        expect(() => {
          return isIcmpOnlyScan(scanFormWith(mode, configs));
        }).not.toThrow();
      }
    }
  });
});
