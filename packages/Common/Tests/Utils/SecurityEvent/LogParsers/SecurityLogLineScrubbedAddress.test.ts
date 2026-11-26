import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  buildLogSecurityEvent,
  pickAddress,
  readEventHost,
  readIpAddress,
  readIpAddressOnly,
  readRemoteIpAddress,
  readRemoteIpAddressOnly,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  markClientAddressScrubbed,
  readEventAddress,
  readHiddenAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  SecurityRecordReading,
  toNormalizedSecurityEvent,
} from "../../../../Utils/SecurityEvent/SecurityRecordReading";
import {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
} from "../../../../Utils/Telemetry/ScrubIpAddress";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";
import {
  DESTINATION_ADDRESS,
  SOURCE_ADDRESS,
  legacyTokenOf,
  tokenOf,
} from "./ScrubbedAddressFormats";

/*
 * THE SHARED HELPERS EVERY LOG FORMAT READS ITS ADDRESSES WITH (#10419).
 *
 * readIpAddress and readRemoteIpAddress used to drop anything that was no
 * IP address, what a scrub rule left in an address's place included. They
 * now keep that value, in the one spelling ScrubbedAddress reads, for the
 * event every format builds (buildLogSecurityEvent) to name no address
 * there and say a scrub rule hid it - and for the log scan to look a Hash
 * rule's token up in the address vault. readIpAddressOnly and
 * readRemoteIpAddressOnly read an address and nothing else.
 */

const KEYED: string = tokenOf(SOURCE_ADDRESS);
const LEGACY: string = legacyTokenOf(SOURCE_ADDRESS);

// What a rule leaves, as a line may write it, and the one spelling it is read as.
const WRITTEN_SCRUBBED: ReadonlyArray<[string, string]> = [
  [KEYED, KEYED],
  [LEGACY, LEGACY],
  ["[REDACTED]", "[REDACTED]"],
  [IPV4_ADDRESS_MASK, IPV4_ADDRESS_MASK],
  [IPV6_ADDRESS_MASK, IPV6_ADDRESS_MASK],
  // A custom pattern's mask keeps an address's first and last characters.
  ["2*********7", "2*********7"],
  // With the port, the brackets and the IPv4-mapped prefix an address is written with.
  [`${KEYED}:52314`, KEYED],
  ["[REDACTED]:443", "[REDACTED]"],
  [`${IPV4_ADDRESS_MASK}:52314`, IPV4_ADDRESS_MASK],
  [`[${IPV6_ADDRESS_MASK}]:443`, IPV6_ADDRESS_MASK],
  [`::ffff:${KEYED}`, KEYED],
  ["::ffff:[REDACTED]", "[REDACTED]"],
  // The full stop or comma of the sentence it ends, and the white space around it.
  [`${KEYED}.`, KEYED],
  ["[REDACTED],", "[REDACTED]"],
  [`  ${KEYED}  `, KEYED],
];

// Values that are neither an address nor what one of OneUptime's rules leaves.
const NEITHER: ReadonlyArray<string> = [
  "",
  "-",
  "unknown",
  "host.example",
  "[Redacted]",
  "[REDACTED",
  "[HASHED:3F9A1C0BE27D4E5A]",
  "[HASHED:xyz]",
  "[HASHED:3f9a1c0be27d4e5a0]",
  "*",
  "**",
  "from [REDACTED]",
  "203.0.113.7.4",
  `${"*".repeat(200)}`,
];

describe("readIpAddress and readRemoteIpAddress", () => {
  test.each(WRITTEN_SCRUBBED)(
    "keep what a scrub rule left, %p, as %p",
    (written: string, kept: string) => {
      expect(readIpAddress(written)).toBe(kept);
      expect(readRemoteIpAddress(written)).toBe(kept);
    },
  );

  test("read an address as they always did", () => {
    expect(readIpAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(readIpAddress(" 2001:db8::7 ")).toBe("2001:db8::7");
    expect(readIpAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(readRemoteIpAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(readRemoteIpAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    // This machine's own and "any" are no remote address, never hidden.
    for (const local of ["127.0.0.1", "::1", "0.0.0.0", "::"]) {
      expect(readRemoteIpAddress(local)).toBe("");
    }
  });

  test.each(NEITHER)("read nothing of %p", (value: string) => {
    expect(readIpAddress(value)).toBe("");
    expect(readRemoteIpAddress(value)).toBe("");
  });

  test("an address with a port is still no address to them: the parser reads its own shape", () => {
    expect(readIpAddress("203.0.113.7:52314")).toBe("");
  });

  test("the Only readers never keep what a rule left", () => {
    for (const [written] of WRITTEN_SCRUBBED) {
      expect({ written, ip: readIpAddressOnly(written) }).toEqual({
        written,
        ip: "",
      });
      expect({ written, ip: readRemoteIpAddressOnly(written) }).toEqual({
        written,
        ip: "",
      });
    }

    expect(readIpAddressOnly("203.0.113.7")).toBe("203.0.113.7");
    expect(readIpAddressOnly("127.0.0.1")).toBe("127.0.0.1");
    expect(readRemoteIpAddressOnly("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(readRemoteIpAddressOnly("127.0.0.1")).toBe("");
  });

  test("read a long value in time in line with its length", () => {
    const long: string = `[${"*".repeat(200_000)}]:${"9".repeat(200_000)}`;
    const read: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return [readIpAddress(long), readRemoteIpAddress(long)];
      },
      limitInMs: 2000,
    });

    expect(read.result).toEqual(["", ""]);
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("pickAddress, of the fields a record may name one address in", () => {
  test("an address wins wherever it is", () => {
    expect(pickAddress(["[REDACTED]", "", "2001:db8::7"])).toBe("2001:db8::7");
    expect(pickAddress([KEYED, SOURCE_ADDRESS])).toBe(SOURCE_ADDRESS);
    expect(pickAddress([SOURCE_ADDRESS, DESTINATION_ADDRESS])).toBe(
      SOURCE_ADDRESS,
    );
  });

  test("else the first a rule left, else nothing", () => {
    expect(pickAddress(["", "[REDACTED]", KEYED])).toBe("[REDACTED]");
    expect(pickAddress([KEYED, "[REDACTED]"])).toBe(KEYED);
    expect(pickAddress(["", " ", ""])).toBe("");
    expect(pickAddress([])).toBe("");
  });
});

describe("readEventAddress and readEventHost", () => {
  test("an address field: the address, or no address and what the rule left", () => {
    expect(readEventAddress(` ${SOURCE_ADDRESS} `)).toEqual({
      address: SOURCE_ADDRESS,
      scrubbed: null,
    });
    expect(readEventAddress(KEYED)).toEqual({
      address: "",
      scrubbed: { kind: ScrubbedAddressKind.Hashed, value: KEYED },
    });
    expect(readEventAddress("[REDACTED]:443")).toEqual({
      address: "",
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
    });
    expect(readEventAddress(IPV6_ADDRESS_MASK)).toEqual({
      address: "",
      scrubbed: { kind: ScrubbedAddressKind.Masked, value: IPV6_ADDRESS_MASK },
    });
    // Anything else is the parser's to decide, and kept as handed over.
    expect(readEventAddress("not-an-address")).toEqual({
      address: "not-an-address",
      scrubbed: null,
    });
    expect(readEventAddress(undefined)).toEqual({
      address: "",
      scrubbed: null,
    });
  });

  test("a host is never what a rule left", () => {
    expect(readEventHost(" web-01 ")).toBe("web-01");
    expect(readEventHost("ec2.amazonaws.com")).toBe("ec2.amazonaws.com");
    expect(readEventHost(SOURCE_ADDRESS)).toBe(SOURCE_ADDRESS);

    for (const [written] of WRITTEN_SCRUBBED) {
      expect({ written, host: readEventHost(written) }).toEqual({
        written,
        host: "",
      });
    }
  });
});

describe("the event every format builds", () => {
  function build(data: {
    principalIp?: string;
    targetIp?: string;
    principalHost?: string;
    targetHost?: string;
    attributes?: Record<string, string>;
  }): NormalizedSecurityEvent {
    return buildLogSecurityEvent({
      line: logLine("a line"),
      format: SecurityLogFormat.Cef,
      classUid: 4001,
      activityName: "Refuse",
      statusName: "Blocked",
      severity: OcsfSeverity.Low,
      message: `Connection from ${data.principalIp || ""} to ${data.targetIp || ""} blocked`,
      principalIp: data.principalIp,
      targetIp: data.targetIp,
      principalHost: data.principalHost,
      targetHost: data.targetHost,
      attributes: { ...(data.attributes || {}) },
    });
  }

  test("names its addresses, and says nothing hidden", () => {
    const event: NormalizedSecurityEvent = build({
      principalIp: SOURCE_ADDRESS,
      targetIp: DESTINATION_ADDRESS,
    });

    expect([event.principalIp, event.targetIp]).toEqual([
      SOURCE_ADDRESS,
      DESTINATION_ADDRESS,
    ]);
    expect(event.observables).toEqual([SOURCE_ADDRESS, DESTINATION_ADDRESS]);

    for (const key of [
      ...CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
      ...TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
    ]) {
      expect(event.attributes[key]).toBeUndefined();
    }
  });

  test("an address a rule hid is none, and each says so in its own marker", () => {
    const event: NormalizedSecurityEvent = build({
      principalIp: KEYED,
      targetIp: "[REDACTED]",
    });

    expect([event.principalIp, event.targetIp]).toEqual(["", ""]);
    expect(event.observables).toEqual([]);
    expect(event.attributes).toEqual(
      expect.objectContaining({
        "oneuptime.request.client_address_hidden": "scrub-rule",
        "oneuptime.request.client_address_scrubbed": KEYED,
        "oneuptime.request.client_address_scrubbed_in": "log-body",
        "oneuptime.target_address_hidden": "scrub-rule",
        "oneuptime.target_address_scrubbed": "[REDACTED]",
        "oneuptime.target_address_scrubbed_in": "log-body",
      }),
    );
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toEqual({
      kind: ScrubbedAddressKind.Hashed,
      value: KEYED,
      place: ScrubbedAddressPlace.LogBody,
      signal: "log",
      ruleId: "",
      ruleName: "",
    });
    expect(readHiddenAddress(event, ScrubbedAddressRole.Target)).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: ScrubbedAddressPlace.LogBody,
      signal: "log",
      ruleId: "",
      ruleName: "",
    });
    // The message is the parser's sentence, as it wrote it.
    expect(event.message).toBe(
      `Connection from ${KEYED} to [REDACTED] blocked`,
    );
  });

  test("one address hidden leaves the other named", () => {
    const event: NormalizedSecurityEvent = build({
      principalIp: "10.0.0.5",
      targetIp: tokenOf(DESTINATION_ADDRESS),
    });

    expect(event.principalIp).toBe("10.0.0.5");
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toBeNull();
    expect(readHiddenAddress(event, ScrubbedAddressRole.Target)?.value).toBe(
      tokenOf(DESTINATION_ADDRESS),
    );
    expect(event.observables).toEqual(["10.0.0.5"]);
  });

  test("a parser that marked an address itself keeps its marker", () => {
    const attributes: Record<string, string> = {};

    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      place: ScrubbedAddressPlace.LogAttributes,
    });

    const event: NormalizedSecurityEvent = build({
      principalIp: KEYED,
      attributes,
    });

    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toEqual(
      expect.objectContaining({
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogAttributes,
      }),
    );
    expect(event.principalIp).toBe("");
  });

  test("a host a rule hid is no host, nor an observable", () => {
    const event: NormalizedSecurityEvent = build({
      principalHost: "[REDACTED]",
      targetHost: tokenOf(DESTINATION_ADDRESS),
    });

    expect([event.principalHost, event.targetHost]).toEqual(["", ""]);
    expect(event.observables).toEqual([]);
    // A host field is no address field: nothing to look up, and no marker.
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toBeNull();
    expect(readHiddenAddress(event, ScrubbedAddressRole.Target)).toBeNull();
  });
});

describe("a connection's reading, which no scrub rule ran over", () => {
  function reading(
    overrides: Partial<SecurityRecordReading>,
  ): SecurityRecordReading {
    return {
      time: new Date("2026-11-20T10:00:00.000Z"),
      eventUid: "connector:1",
      classUid: 3002,
      activityName: "Logon",
      statusName: "Failure",
      severity: OcsfSeverity.Low,
      message: "A sign-in",
      attributes: {},
      ...overrides,
    };
  }

  test("names its addresses as it always did", () => {
    const event: NormalizedSecurityEvent = toNormalizedSecurityEvent({
      reading: reading({
        principalIp: SOURCE_ADDRESS,
        targetIp: DESTINATION_ADDRESS,
      }),
      vendorName: "Microsoft",
      productName: "Microsoft Entra ID",
      raw: {},
    });

    expect([event.principalIp, event.targetIp]).toEqual([
      SOURCE_ADDRESS,
      DESTINATION_ADDRESS,
    ]);
  });

  test("names nothing of what only looks like a rule's value, and marks nothing", () => {
    const event: NormalizedSecurityEvent = toNormalizedSecurityEvent({
      reading: reading({ principalIp: KEYED, targetIp: "[REDACTED]" }),
      vendorName: "Microsoft",
      productName: "Microsoft Entra ID",
      raw: {},
    });

    expect([event.principalIp, event.targetIp]).toEqual(["", ""]);
    expect(event.observables).toEqual([]);
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toBeNull();
    expect(readHiddenAddress(event, ScrubbedAddressRole.Target)).toBeNull();
  });
});
