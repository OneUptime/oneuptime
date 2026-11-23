import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import { SCRUB_REDACTED_TEXT } from "../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import TraceScrubField from "../../../Types/Trace/TraceScrubField";
import {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
} from "../../../Utils/Telemetry/ScrubIpAddress";
import {
  AddressScrubRule,
  CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE,
  CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  HiddenClientAddress,
  SCRUBBED_ADDRESS_ATTRIBUTES,
  SCRUBBED_ADDRESS_ROLES,
  SCRUB_REDACTED_VALUE,
  ScrubbedAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  clearAddressScrubbed,
  clearClientAddressScrubbed,
  doesScrubRuleReach,
  findScrubRuleHidingAddresses,
  findScrubRuleThatHid,
  getScrubbedAddressMarkerAttributes,
  getScrubbedKindOfAction,
  getSignalOfScrubbedAddressPlace,
  markAddressScrubbed,
  markClientAddressScrubbed,
  nameAddressScrubRule,
  nameClientAddressScrubRule,
  readHiddenAddress,
  readHiddenClientAddress,
  readHiddenTargetAddress,
  readScrubbedAddress,
  readScrubbedValue,
  readSecurityAddressScrubRules,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";

/*
 * What a scrub rule leaves where an address was, read as Security Events
 * reads an address (#10397): the three values a rule leaves - Redact's
 * "[REDACTED]", Mask's shapes and a Hash rule's token, in the form tokens
 * had before they were keyed per project and the form #10394 makes - and
 * every way a log or a span writes an address around them. Then the marker
 * an event keeps, and which of a project's rules explains it.
 */

// The Hash action before #10394: the first 8 hex characters of an unkeyed SHA-256.
function legacyToken(value: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(value).digest("hex").substring(0, 8)}]`;
}

const PROJECT_A: string = "0192f1a0-0000-7000-8000-00000000a0a1";
const PROJECT_B: string = "0192f1a0-0000-7000-8000-00000000a0b2";

const LEGACY_TOKEN: string = legacyToken("203.0.113.7");
// The token a Hash rule makes now (#10394): the engines' own function.
const KEYED_TOKEN: string = ScrubHashToken.ofIpAddress({
  projectId: PROJECT_A,
  address: "203.0.113.7",
});
const SCRUB_IPV4_MASK: string = IPV4_ADDRESS_MASK;
const SCRUB_IPV6_MASK: string = IPV6_ADDRESS_MASK;

function rule(overrides: Partial<AddressScrubRule> = {}): AddressScrubRule {
  return {
    id: "0192f1a0-0000-7000-8000-00000000a001",
    name: "Scrub IP addresses",
    patternType: LogScrubPatternType.IPAddress,
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Both,
    ...overrides,
  };
}

describe("what a scrub rule leaves of a whole value", () => {
  test("Redact's, Mask's and both forms of a Hash rule's token are each known", () => {
    const cases: ReadonlyArray<[string, ScrubbedAddressKind]> = [
      ["[REDACTED]", ScrubbedAddressKind.Redacted],
      [SCRUB_IPV4_MASK, ScrubbedAddressKind.Masked],
      [SCRUB_IPV6_MASK, ScrubbedAddressKind.Masked],
      [LEGACY_TOKEN, ScrubbedAddressKind.Hashed],
      [KEYED_TOKEN, ScrubbedAddressKind.Hashed],
      // A custom pattern's mask keeps an address's first and last characters.
      ["2*********7", ScrubbedAddressKind.Masked],
      ["F*****1", ScrubbedAddressKind.Masked],
      // A short value's mask is all stars.
      ["***", ScrubbedAddressKind.Masked],
    ];

    for (const [value, kind] of cases) {
      expect({ value, read: readScrubbedValue(value) }).toEqual({
        value,
        read: { kind, value },
      });
    }
  });

  test("the tokens are the shapes the hash makes, in every project and however the address is written", () => {
    expect(LEGACY_TOKEN).toMatch(/^\[HASHED:[0-9a-f]{8}\]$/);
    expect(KEYED_TOKEN).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);

    const otherProject: string = ScrubHashToken.ofIpAddress({
      projectId: PROJECT_B,
      address: "203.0.113.7",
    });
    // A project's key makes another token for the same address: each is still one.
    expect(otherProject).not.toBe(KEYED_TOKEN);
    expect(readScrubbedValue(otherProject)?.kind).toBe(
      ScrubbedAddressKind.Hashed,
    );
    // An IPv4 address an IPv6 socket wrote makes the address's own token.
    expect(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_A,
        address: "::ffff:203.0.113.7",
      }),
    ).toBe(KEYED_TOKEN);

    for (const address of ["2001:db8::7", "198.51.100.23", "8.8.8.8"]) {
      const token: string = ScrubHashToken.ofIpAddress({
        projectId: PROJECT_A,
        address,
      });

      expect({ address, read: readScrubbedValue(token) }).toEqual({
        address,
        read: { kind: ScrubbedAddressKind.Hashed, value: token },
      });
    }
  });

  test("a token is today's 16 hex characters or the 8 of before, and no other length", () => {
    for (const length of [8, 16]) {
      expect(readScrubbedValue(`[HASHED:${"a".repeat(length)}]`)?.kind).toBe(
        ScrubbedAddressKind.Hashed,
      );
    }

    for (const length of [0, 1, 7, 9, 15, 17, 32, 64]) {
      expect({
        length,
        read: readScrubbedValue(`[HASHED:${"a".repeat(length)}]`),
      }).toEqual({ length, read: null });
    }
  });

  test("what Redact leaves is the engines' own word for it", () => {
    expect(SCRUB_REDACTED_VALUE).toBe(SCRUB_REDACTED_TEXT);
  });

  test("an address, a name, nothing, and what no OneUptime rule writes are no value a rule left", () => {
    for (const value of [
      "",
      "   ",
      "203.0.113.7",
      "2001:db8::7",
      "::ffff:203.0.113.7",
      "unknown",
      "-",
      "localhost",
      "app.internal",
      "/var/run/app.sock",
      // An app's own logger, or another redactor: not a scrub rule of the project's.
      "[Redacted]",
      "[redacted]",
      "[FILTERED]",
      // A token as no rule writes it.
      "[HASHED:3F9A1C0E7B2D4A68]",
      "[HASHED:3f9a1c0]",
      "[HASHED:3f9a1c0e7b2d4a68",
      "HASHED:3f9a1c0e7b2d4a68]",
      "[HASHED:3f9a1c0e7b2d4g68]",
      "[HASHED:]",
      // Too few stars to be a mask, or more than stars and an address's shape.
      "**",
      "a**b",
      "*.*.*.*",
      "us***@***.com",
      "***-**-1234",
      "[REDACTED]x",
      "x[REDACTED]",
      // Longer than any value a rule leaves.
      "*".repeat(200),
    ]) {
      expect({ value, read: readScrubbedValue(value) }).toEqual({
        value,
        read: null,
      });
    }
  });

  test("white space around a value is not part of it", () => {
    expect(readScrubbedValue("  [REDACTED]\t")).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: SCRUB_REDACTED_VALUE,
    });
  });
});

describe("what a scrub rule left where an address was written", () => {
  test("with the port, the brackets, the IPv4-mapped prefix and the stop a log writes around an address", () => {
    const cases: ReadonlyArray<[string, ScrubbedAddress]> = [
      [
        "[REDACTED]:51234",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
      [
        "***.***.***.***:443",
        { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV4_MASK },
      ],
      [
        `${KEYED_TOKEN}:8080`,
        { kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN },
      ],
      // A token of digits only, with a port: the port is the last colon's.
      [
        "[HASHED:12345678]:443",
        { kind: ScrubbedAddressKind.Hashed, value: "[HASHED:12345678]" },
      ],
      [
        `[${SCRUB_IPV6_MASK}]:443`,
        { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV6_MASK },
      ],
      [
        "[[REDACTED]]:443",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
      [
        `[${LEGACY_TOKEN}]`,
        { kind: ScrubbedAddressKind.Hashed, value: LEGACY_TOKEN },
      ],
      // An IP Address rule hid only the dotted quad before #10393.
      [
        "::ffff:[REDACTED]",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
      [
        "::FFFF:***.***.***.***",
        { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV4_MASK },
      ],
      [
        `::ffff:${LEGACY_TOKEN}`,
        { kind: ScrubbedAddressKind.Hashed, value: LEGACY_TOKEN },
      ],
      [
        "[::ffff:[REDACTED]]:44220",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
      [
        "[REDACTED].",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
      [
        "[REDACTED]:51234,",
        { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      ],
    ];

    for (const [written, read] of cases) {
      expect({ written, read: readScrubbedAddress(written) }).toEqual({
        written,
        read,
      });
    }
  });

  test("an address, and a value only part of which a rule left, are not read as hidden", () => {
    for (const written of [
      "203.0.113.7:443",
      "[2001:db8::7]:443",
      "::ffff:203.0.113.7",
      "[REDACTED]:abc",
      "[REDACTED]:123456",
      "10.0.[REDACTED]",
      "[REDACTED] [REDACTED]",
      "[REDACTED], [REDACTED]",
      "::ffff:",
      "[]",
      "[",
      "]",
    ]) {
      expect({ written, read: readScrubbedAddress(written) }).toEqual({
        written,
        read: null,
      });
    }
  });
});

describe("the marker an event keeps", () => {
  test("says a scrub rule hid the client address, what it left and where, and never the address", () => {
    const attributes: JSONObject = {};

    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN },
      place: ScrubbedAddressPlace.SpanAttributes,
    });

    expect(attributes).toEqual({
      "oneuptime.request.client_address_hidden": "scrub-rule",
      "oneuptime.request.client_address_scrubbed": KEYED_TOKEN,
      "oneuptime.request.client_address_scrubbed_in": "span-attributes",
    });
    expect(attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress]).toBe(
      undefined,
    );
  });

  test("names the rule that explains it, its name kept to a column's length", () => {
    const attributes: JSONObject = {};

    nameClientAddressScrubRule(attributes, {
      id: "rule-1",
      name: "  Hide IPs ",
    });
    expect(attributes).toEqual({
      "oneuptime.request.client_address_scrub_rule_id": "rule-1",
      "oneuptime.request.client_address_scrub_rule": "Hide IPs",
    });

    nameClientAddressScrubRule(attributes, { id: "rule-2", name: "" });
    expect(attributes).toEqual({
      "oneuptime.request.client_address_scrub_rule_id": "rule-2",
    });

    nameClientAddressScrubRule(attributes, {
      id: "rule-3",
      name: "n".repeat(300),
    });
    expect(
      (attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule] as string)
        .length,
    ).toBe(255);

    // No id, no rule.
    const unnamed: JSONObject = {};
    nameClientAddressScrubRule(unnamed, { id: " ", name: "Hide IPs" });
    expect(unnamed).toEqual({});
  });

  test("is read back as the event's hidden address, the rule's name only with its id", () => {
    const attributes: JSONObject = {};

    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      place: ScrubbedAddressPlace.LogBody,
    });

    expect(readHiddenClientAddress({ principalIp: "", attributes })).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: ScrubbedAddressPlace.LogBody,
      signal: "log",
      ruleId: "",
      ruleName: "",
    } as HiddenClientAddress);

    attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule] = "Orphan";
    expect(readHiddenClientAddress({ attributes })?.ruleName).toBe("");

    nameClientAddressScrubRule(attributes, { id: "rule-1", name: "Hide IPs" });
    expect(readHiddenClientAddress({ attributes })).toEqual(
      expect.objectContaining({ ruleId: "rule-1", ruleName: "Hide IPs" }),
    );
  });

  test("says nothing for an event that names its address - the vault named it (#10395) - or carries no marker", () => {
    const attributes: JSONObject = {};

    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN },
      place: ScrubbedAddressPlace.SpanAttributes,
    });

    expect(
      readHiddenClientAddress({ principalIp: "203.0.113.7", attributes }),
    ).toBeNull();
    expect(readHiddenClientAddress({ attributes: {} })).toBeNull();
    expect(readHiddenClientAddress({})).toBeNull();
    expect(readHiddenClientAddress({ attributes: null })).toBeNull();
    expect(
      readHiddenClientAddress({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden]: "something-else",
        },
      }),
    ).toBeNull();
  });

  test("reads a kept event's snapshot, whose attributes are text, and a marker missing its parts", () => {
    const hidden: HiddenClientAddress | null = readHiddenClientAddress({
      principalIp: "",
      attributes: {
        [SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden]: "scrub-rule",
        [SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn]: "somewhere",
      },
    });

    expect(hidden).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: null,
      signal: null,
      ruleId: "",
      ruleName: "",
    });
  });

  test("is cleared whole once the event names its address", () => {
    const attributes: JSONObject = { "web.attack.kind": "path-traversal" };

    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV4_MASK },
      place: ScrubbedAddressPlace.LogAttributes,
    });
    nameClientAddressScrubRule(attributes, { id: "rule-1", name: "Hide IPs" });
    clearClientAddressScrubbed(attributes);

    expect(attributes).toEqual({ "web.attack.kind": "path-traversal" });
    expect(CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES).toHaveLength(5);
  });

  test("each place belongs to its kind of rules", () => {
    expect(getSignalOfScrubbedAddressPlace(ScrubbedAddressPlace.LogBody)).toBe(
      "log",
    );
    expect(
      getSignalOfScrubbedAddressPlace(ScrubbedAddressPlace.LogAttributes),
    ).toBe("log");
    expect(
      getSignalOfScrubbedAddressPlace(ScrubbedAddressPlace.SpanAttributes),
    ).toBe("trace");
    expect(CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE).toBe("scrub-rule");
  });
});

/*
 * An event's destination has a marker of its own (#10419): a firewall's
 * denied connection or an outbound transfer names where it went (targetIp),
 * and a scrub rule may hide that address as it hides the source.
 */
describe("the marker of each of an event's addresses", () => {
  test("the principal's is the request attributes stored events already use; the target's its own", () => {
    expect(SCRUBBED_ADDRESS_ROLES).toEqual([
      ScrubbedAddressRole.Principal,
      ScrubbedAddressRole.Target,
    ]);
    expect(SCRUBBED_ADDRESS_ATTRIBUTES[ScrubbedAddressRole.Principal]).toEqual(
      {
        hidden: SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden,
        scrubbed: SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbed,
        scrubbedIn: SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn,
        ruleId: SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRuleId,
        rule: SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule,
      },
    );
    expect(TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES).toEqual([
      "oneuptime.target_address_hidden",
      "oneuptime.target_address_scrubbed",
      "oneuptime.target_address_scrubbed_in",
      "oneuptime.target_address_scrub_rule_id",
      "oneuptime.target_address_scrub_rule",
    ]);
    expect(
      getScrubbedAddressMarkerAttributes(ScrubbedAddressRole.Principal),
    ).toEqual(CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES);
  });

  test("a destination a rule hid says so, and the rule, apart from the source", () => {
    const attributes: JSONObject = {};

    markAddressScrubbed(attributes, {
      role: ScrubbedAddressRole.Target,
      scrubbed: { kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN },
      place: ScrubbedAddressPlace.LogBody,
    });
    nameAddressScrubRule(attributes, ScrubbedAddressRole.Target, {
      id: "rule-1",
      name: " Hash IP addresses ",
    });

    expect(attributes).toEqual({
      "oneuptime.target_address_hidden": "scrub-rule",
      "oneuptime.target_address_scrubbed": KEYED_TOKEN,
      "oneuptime.target_address_scrubbed_in": "log-body",
      "oneuptime.target_address_scrub_rule_id": "rule-1",
      "oneuptime.target_address_scrub_rule": "Hash IP addresses",
    });
    expect(readHiddenTargetAddress({ targetIp: "", attributes })).toEqual({
      kind: ScrubbedAddressKind.Hashed,
      value: KEYED_TOKEN,
      place: ScrubbedAddressPlace.LogBody,
      signal: "log",
      ruleId: "rule-1",
      ruleName: "Hash IP addresses",
    });
    // The source is no hidden address of this event.
    expect(readHiddenClientAddress({ principalIp: "", attributes })).toBeNull();
  });

  test("each address's marker is read, named and cleared apart", () => {
    const attributes: JSONObject = { "panos.src": "[REDACTED]" };

    markAddressScrubbed(attributes, {
      role: ScrubbedAddressRole.Principal,
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      place: ScrubbedAddressPlace.LogBody,
    });
    markAddressScrubbed(attributes, {
      role: ScrubbedAddressRole.Target,
      scrubbed: { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV6_MASK },
      place: ScrubbedAddressPlace.LogAttributes,
    });
    nameAddressScrubRule(attributes, ScrubbedAddressRole.Principal, {
      id: "rule-redact",
      name: "Redact IPs",
    });

    expect(
      readHiddenAddress({ attributes }, ScrubbedAddressRole.Principal),
    ).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Redacted,
        ruleName: "Redact IPs",
      }),
    );
    expect(readHiddenAddress({ attributes }, ScrubbedAddressRole.Target)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Masked,
        value: SCRUB_IPV6_MASK,
        place: ScrubbedAddressPlace.LogAttributes,
        ruleId: "",
      }),
    );

    // The vault named the destination: only its marker goes.
    clearAddressScrubbed(attributes, ScrubbedAddressRole.Target);

    expect(
      readHiddenAddress({ attributes }, ScrubbedAddressRole.Target),
    ).toBeNull();
    expect(
      readHiddenAddress({ attributes }, ScrubbedAddressRole.Principal)?.value,
    ).toBe("[REDACTED]");

    clearAddressScrubbed(attributes, ScrubbedAddressRole.Principal);

    expect(attributes).toEqual({ "panos.src": "[REDACTED]" });
  });

  test("an event that names its destination says nothing hidden there, whatever its marker", () => {
    const attributes: JSONObject = {};

    markAddressScrubbed(attributes, {
      role: ScrubbedAddressRole.Target,
      scrubbed: { kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN },
      place: ScrubbedAddressPlace.LogBody,
    });

    expect(
      readHiddenTargetAddress({ targetIp: "198.51.100.9", attributes }),
    ).toBeNull();
    // A source named says nothing of the destination.
    expect(
      readHiddenTargetAddress({
        principalIp: "203.0.113.7",
        attributes,
      } as { targetIp?: string; attributes?: unknown }),
    ).toEqual(expect.objectContaining({ value: KEYED_TOKEN }));
    expect(readHiddenTargetAddress({})).toBeNull();
  });
});

describe("which of a project's rules hid it", () => {
  test("an action leaves the kind of value ingest leaves", () => {
    expect(getScrubbedKindOfAction(LogScrubAction.Redact)).toBe(
      ScrubbedAddressKind.Redacted,
    );
    expect(getScrubbedKindOfAction(LogScrubAction.Mask)).toBe(
      ScrubbedAddressKind.Masked,
    );
    expect(getScrubbedKindOfAction(LogScrubAction.Hash)).toBe(
      ScrubbedAddressKind.Hashed,
    );
    // Empty is the default, and an action no engine knows redacts.
    expect(getScrubbedKindOfAction("")).toBe(ScrubbedAddressKind.Redacted);
    expect(getScrubbedKindOfAction(undefined)).toBe(
      ScrubbedAddressKind.Redacted,
    );
    expect(getScrubbedKindOfAction("shred")).toBe(ScrubbedAddressKind.Redacted);
  });

  test("a rule reaches the parts of a record its fields name, as ingest runs it", () => {
    const cases: ReadonlyArray<[string, ScrubbedAddressPlace, boolean]> = [
      [LogScrubField.Both, ScrubbedAddressPlace.LogBody, true],
      [LogScrubField.Both, ScrubbedAddressPlace.LogAttributes, true],
      [LogScrubField.Body, ScrubbedAddressPlace.LogBody, true],
      [LogScrubField.Body, ScrubbedAddressPlace.LogAttributes, false],
      [LogScrubField.Attributes, ScrubbedAddressPlace.LogBody, false],
      [LogScrubField.Attributes, ScrubbedAddressPlace.LogAttributes, true],
      ["", ScrubbedAddressPlace.LogBody, true],
      ["", ScrubbedAddressPlace.LogAttributes, true],
      ["everything", ScrubbedAddressPlace.LogBody, false],
      [TraceScrubField.All, ScrubbedAddressPlace.SpanAttributes, true],
      [TraceScrubField.Attributes, ScrubbedAddressPlace.SpanAttributes, true],
      [TraceScrubField.Events, ScrubbedAddressPlace.SpanAttributes, false],
      [TraceScrubField.Name, ScrubbedAddressPlace.SpanAttributes, false],
      ["", ScrubbedAddressPlace.SpanAttributes, true],
      ["everything", ScrubbedAddressPlace.SpanAttributes, false],
    ];

    for (const [fieldsToScrub, place, reaches] of cases) {
      expect({
        fieldsToScrub,
        place,
        reaches: doesScrubRuleReach({ fieldsToScrub }, place),
      }).toEqual({ fieldsToScrub, place, reaches });
    }
  });

  test("is the first IP Address rule over that part whose action leaves what the record holds", () => {
    const rules: Array<AddressScrubRule> = [
      rule({ id: "email", patternType: LogScrubPatternType.Email }),
      rule({ id: "custom", patternType: LogScrubPatternType.Custom }),
      rule({ id: "keys", patternType: LogScrubPatternType.SensitiveKeys }),
      rule({
        id: "mask-body",
        scrubAction: LogScrubAction.Mask,
        fieldsToScrub: LogScrubField.Body,
      }),
      rule({
        id: "redact-attributes",
        fieldsToScrub: LogScrubField.Attributes,
      }),
      rule({ id: "redact-both" }),
      rule({ id: "hash-both", scrubAction: LogScrubAction.Hash }),
    ];

    const idOf: (
      kind: ScrubbedAddressKind,
      place: ScrubbedAddressPlace,
    ) => string | null = (
      kind: ScrubbedAddressKind,
      place: ScrubbedAddressPlace,
    ): string | null => {
      return findScrubRuleThatHid(rules, { kind, place })?.id || null;
    };

    expect(
      idOf(ScrubbedAddressKind.Redacted, ScrubbedAddressPlace.LogBody),
    ).toBe("redact-both");
    expect(
      idOf(ScrubbedAddressKind.Redacted, ScrubbedAddressPlace.LogAttributes),
    ).toBe("redact-attributes");
    expect(idOf(ScrubbedAddressKind.Masked, ScrubbedAddressPlace.LogBody)).toBe(
      "mask-body",
    );
    expect(
      idOf(ScrubbedAddressKind.Masked, ScrubbedAddressPlace.LogAttributes),
    ).toBeNull();
    expect(idOf(ScrubbedAddressKind.Hashed, ScrubbedAddressPlace.LogBody)).toBe(
      "hash-both",
    );
  });

  test("names none when no enabled IP Address rule explains it", () => {
    expect(
      findScrubRuleThatHid([], {
        kind: ScrubbedAddressKind.Redacted,
        place: ScrubbedAddressPlace.LogBody,
      }),
    ).toBeNull();
    expect(
      findScrubRuleThatHid(
        [rule({ patternType: LogScrubPatternType.Custom })],
        {
          kind: ScrubbedAddressKind.Redacted,
          place: ScrubbedAddressPlace.LogBody,
        },
      ),
    ).toBeNull();
    expect(
      findScrubRuleThatHid([rule({ fieldsToScrub: TraceScrubField.Events })], {
        kind: ScrubbedAddressKind.Redacted,
        place: ScrubbedAddressPlace.SpanAttributes,
      }),
    ).toBeNull();
  });

  test("a trace rule over all or the attributes names a span's hidden address", () => {
    expect(
      findScrubRuleThatHid(
        [
          rule({ id: "name", fieldsToScrub: TraceScrubField.Name }),
          rule({ id: "all", fieldsToScrub: TraceScrubField.All }),
        ],
        {
          kind: ScrubbedAddressKind.Redacted,
          place: ScrubbedAddressPlace.SpanAttributes,
        },
      )?.id,
    ).toBe("all");
  });
});

describe("the rule Security Events' setup names", () => {
  test("is an IP Address rule that redacts or masks where Security Events reads an address", () => {
    expect(findScrubRuleHidingAddresses([rule()], "log")?.id).toBe(rule().id);
    expect(
      findScrubRuleHidingAddresses(
        [
          rule({
            scrubAction: LogScrubAction.Mask,
            fieldsToScrub: LogScrubField.Body,
          }),
        ],
        "log",
      ),
    ).not.toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ fieldsToScrub: LogScrubField.Attributes })],
        "log",
      ),
    ).not.toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ fieldsToScrub: TraceScrubField.Attributes })],
        "trace",
      ),
    ).not.toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ fieldsToScrub: TraceScrubField.All })],
        "trace",
      ),
    ).not.toBeNull();
  });

  test("never a Hash rule, whose token the address vault names (#10395), nor one that cannot reach an address", () => {
    expect(
      findScrubRuleHidingAddresses(
        [rule({ scrubAction: LogScrubAction.Hash })],
        "log",
      ),
    ).toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ fieldsToScrub: TraceScrubField.Events })],
        "trace",
      ),
    ).toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ fieldsToScrub: TraceScrubField.Name })],
        "trace",
      ),
    ).toBeNull();
    expect(
      findScrubRuleHidingAddresses(
        [rule({ patternType: LogScrubPatternType.Custom })],
        "log",
      ),
    ).toBeNull();
  });

  test("is the first of them in the order ingest runs the rules", () => {
    expect(
      findScrubRuleHidingAddresses(
        [
          rule({ id: "hash", scrubAction: LogScrubAction.Hash }),
          rule({ id: "mask", scrubAction: LogScrubAction.Mask }),
          rule({ id: "redact" }),
        ],
        "log",
      )?.id,
    ).toBe("mask");
  });

  test("its rules are read from the wire defensively, logs first, each kind once", () => {
    expect(
      readSecurityAddressScrubRules([
        { signal: "trace", ruleId: "t", ruleName: "Hide", scrubAction: "mask" },
        { signal: "log", ruleId: "l", ruleName: "Hide", scrubAction: "redact" },
        {
          signal: "log",
          ruleId: "l2",
          ruleName: "Again",
          scrubAction: "redact",
        },
        { signal: "metric", ruleId: "m" },
        { signal: "log" },
        null,
        "text",
      ]),
    ).toEqual([
      { signal: "log", ruleId: "l", ruleName: "Hide", scrubAction: "redact" },
      { signal: "trace", ruleId: "t", ruleName: "Hide", scrubAction: "mask" },
    ]);
    expect(readSecurityAddressScrubRules(undefined)).toEqual([]);
    expect(readSecurityAddressScrubRules({})).toEqual([]);
    expect(
      readSecurityAddressScrubRules([{ signal: "log", ruleName: "No id" }]),
    ).toEqual([]);
  });
});
