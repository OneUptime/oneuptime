import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../../Types/SecurityEvent/DetectionUncountedEvents";
import { SECURITY_LOG_FORMAT_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityLogFormat";
import { OpenStackAuditAttribute } from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  HiddenAddress,
  SCRUBBED_ADDRESS_ROLES,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  readHiddenAddress,
  readScrubbedAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  DESTINATION_ADDRESS,
  SCRUBBED_ADDRESS_FORMATS,
  SCRUBBED_ADDRESS_PAIRS,
  SOURCE_ADDRESS,
  ScrubbedAddressFormat,
  ScrubbedAddressPair,
  lineWithAddresses,
  lineWithScrubbed,
  tokenOf,
} from "./ScrubbedAddressFormats";

/*
 * EVERY LOG FORMAT KEEPS AN ADDRESS A SCRUB RULE HID (#10419).
 *
 * Every format read its source and destination through readIpAddress and
 * readRemoteIpAddress, which dropped what an IP Address scrub rule left in
 * an address's place. So an SSH brute force, a firewall's denied
 * connection, a Windows failed logon and a cloud audit record named no
 * address, and said nothing about why - and the address vault (#10395) was
 * never asked about a Hash rule's token. Now the helpers keep what a rule
 * left, and the event every format builds (buildLogSecurityEvent) names no
 * address there and says a scrub rule hid it, for the source and the
 * destination alike, whatever the rule did: hash, redact or mask.
 *
 * Pinned here, for one line of every format (ScrubbedAddressFormats):
 *
 *   - with its addresses, the event names them and says nothing hidden;
 *   - with each kind of value a rule leaves, the event names no address,
 *     and each address it reads says a rule hid it: what the rule left, in
 *     the line's text, never an observable;
 *   - the message and the record's own fields keep what the line says;
 *   - the parser's own address attributes name real addresses only, and a
 *     host is never what a rule left;
 *   - the rules that count per address leave the events out (#10415).
 */

function parseOne(line: SecurityLogLine): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(line);

  expect(events).toHaveLength(1);

  return events[0]!;
}

function addressOf(
  event: NormalizedSecurityEvent,
  role: ScrubbedAddressRole,
): string {
  return role === ScrubbedAddressRole.Principal
    ? event.principalIp
    : event.targetIp;
}

function expectedAddress(role: ScrubbedAddressRole): string {
  return role === ScrubbedAddressRole.Principal
    ? SOURCE_ADDRESS
    : DESTINATION_ADDRESS;
}

function scrubbedOf(
  pair: ScrubbedAddressPair,
  role: ScrubbedAddressRole,
): string {
  return role === ScrubbedAddressRole.Principal
    ? pair.source
    : pair.destination;
}

const FORMAT_CASES: Array<[string, ScrubbedAddressFormat]> =
  SCRUBBED_ADDRESS_FORMATS.map(
    (format: ScrubbedAddressFormat): [string, ScrubbedAddressFormat] => {
      return [format.name, format];
    },
  );

const HIDDEN_CASES: Array<
  [string, string, ScrubbedAddressFormat, ScrubbedAddressPair]
> = SCRUBBED_ADDRESS_FORMATS.flatMap(
  (
    format: ScrubbedAddressFormat,
  ): Array<[string, string, ScrubbedAddressFormat, ScrubbedAddressPair]> => {
    return SCRUBBED_ADDRESS_PAIRS.map(
      (
        pair: ScrubbedAddressPair,
      ): [string, string, ScrubbedAddressFormat, ScrubbedAddressPair] => {
        return [format.name, pair.label, format, pair];
      },
    );
  },
);

describe("one line of every format", () => {
  test("covers each format Security Events reads its addresses from", () => {
    const formats: Set<string> = new Set<string>(
      SCRUBBED_ADDRESS_FORMATS.map((format: ScrubbedAddressFormat): string => {
        return format.format;
      }),
    );

    expect(Array.from(formats).sort()).toEqual(
      [
        "ssh-sign-in",
        "windows-events",
        "kubernetes-audit",
        "aws-cloudtrail",
        "google-cloud-audit",
        "azure-activity",
        "azure-resource-logs",
        "openstack-audit",
        "cef",
        "leef",
        "palo-alto",
        "fortigate",
        "cisco-asa",
      ].sort(),
    );
  });

  test.each(FORMAT_CASES)(
    "%s, with its addresses, names them and says nothing hidden",
    (_name: string, format: ScrubbedAddressFormat) => {
      const line: SecurityLogLine = lineWithAddresses(format);
      const event: NormalizedSecurityEvent = parseOne(line);

      // The log scan asks the database for this line.
      expect(matchesSecurityLogPrefilter(line.body)).toBe(true);
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        format.format,
      );

      for (const role of SCRUBBED_ADDRESS_ROLES) {
        expect(readHiddenAddress(event, role)).toBeNull();
      }

      for (const role of format.roles) {
        expect({ role, address: addressOf(event, role) }).toEqual({
          role,
          address: expectedAddress(role),
        });
        expect(event.observables).toContain(expectedAddress(role));
      }
    },
  );
});

describe("a line whose addresses a scrub rule hid", () => {
  test.each(HIDDEN_CASES)(
    "%s, with %s: names no address, and says a rule hid each it reads",
    (
      _name: string,
      _label: string,
      format: ScrubbedAddressFormat,
      pair: ScrubbedAddressPair,
    ) => {
      const line: SecurityLogLine = lineWithScrubbed(format, pair);
      const event: NormalizedSecurityEvent = parseOne(line);

      // Still a line the scan reads, and still an event: the rule hid only the address.
      expect(matchesSecurityLogPrefilter(line.body)).toBe(true);
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        format.format,
      );

      for (const role of SCRUBBED_ADDRESS_ROLES) {
        const hidden: HiddenAddress | null = readHiddenAddress(event, role);

        if (!format.roles.includes(role)) {
          expect({ role, hidden }).toEqual({ role, hidden: null });
          continue;
        }

        expect({
          role,
          address: addressOf(event, role),
          hidden: hidden
            ? { kind: hidden.kind, value: hidden.value, place: hidden.place }
            : null,
        }).toEqual({
          role,
          address: "",
          hidden: {
            kind: pair.kind,
            value: scrubbedOf(pair, role),
            place: ScrubbedAddressPlace.LogBody,
          },
        });
      }

      // What a rule left is never an observable, an entity or a host.
      expect(
        event.observables.filter((observable: string): boolean => {
          return readScrubbedAddress(observable) !== null;
        }),
      ).toEqual([]);
      expect(readScrubbedAddress(event.principalHost)).toBeNull();
      expect(readScrubbedAddress(event.targetHost)).toBeNull();
    },
  );

  test("the IPS finding's destination host, which held the address, is no host", () => {
    const format: ScrubbedAddressFormat = SCRUBBED_ADDRESS_FORMATS.find(
      (candidate: ScrubbedAddressFormat): boolean => {
        return candidate.name.startsWith("a FortiGate IPS finding");
      },
    )!;

    expect(parseOne(lineWithAddresses(format)).targetHost).toBe(
      DESTINATION_ADDRESS,
    );

    const hidden: NormalizedSecurityEvent = parseOne(
      lineWithScrubbed(format, SCRUBBED_ADDRESS_PAIRS[2]!),
    );

    expect(hidden.targetHost).toBe("");
    expect(hidden.targetIp).toBe("");
    expect(readHiddenAddress(hidden, ScrubbedAddressRole.Target)?.value).toBe(
      "[REDACTED]",
    );
  });

  test("a CloudTrail call whose address a rule hid has no host of [REDACTED] or a token", () => {
    const format: ScrubbedAddressFormat = SCRUBBED_ADDRESS_FORMATS.find(
      (candidate: ScrubbedAddressFormat): boolean => {
        return candidate.name === "a CloudTrail record sent as a log";
      },
    )!;

    for (const pair of SCRUBBED_ADDRESS_PAIRS) {
      const event: NormalizedSecurityEvent = parseOne(
        lineWithScrubbed(format, pair),
      );

      expect({ label: pair.label, host: event.principalHost }).toEqual({
        label: pair.label,
        host: "",
      });
    }

    // A call from inside AWS still names the service as its host.
    const fromAws: NormalizedSecurityEvent = parseOne(
      format.line({ source: "ec2.amazonaws.com", destination: "" }),
    );

    expect(fromAws.principalHost).toBe("ec2.amazonaws.com");
    expect(fromAws.principalIp).toBe("");
    expect(
      readHiddenAddress(fromAws, ScrubbedAddressRole.Principal),
    ).toBeNull();
  });
});

describe("what the line says is kept as stored", () => {
  const HASHED: ScrubbedAddressPair = SCRUBBED_ADDRESS_PAIRS[0]!;

  function eventOf(name: string): NormalizedSecurityEvent {
    const format: ScrubbedAddressFormat = SCRUBBED_ADDRESS_FORMATS.find(
      (candidate: ScrubbedAddressFormat): boolean => {
        return candidate.name === name;
      },
    )!;

    return parseOne(lineWithScrubbed(format, HASHED));
  }

  test.each([
    [
      "an SSH failed password",
      `Failed SSH sign-in for root from ${tokenOf(SOURCE_ADDRESS)}`,
    ],
    [
      "a Palo Alto traffic log",
      `ms-rdp from ${tokenOf(SOURCE_ADDRESS)} to ${tokenOf(DESTINATION_ADDRESS)}:3389 blocked (deny, rule deny-rdp)`,
    ],
    [
      "a FortiGate traffic log",
      `RDP from ${tokenOf(SOURCE_ADDRESS)} to ${tokenOf(DESTINATION_ADDRESS)}:3389 blocked (deny, policy 0)`,
    ],
    [
      "a Cisco ASA connection an access list denied",
      `TCP connection from ${tokenOf(SOURCE_ADDRESS)} to ${tokenOf(DESTINATION_ADDRESS)}:443 denied by outside_access_in`,
    ],
  ])(
    "%s: its message says the tokens, which only the event's address fields resolve",
    (name: string, message: string) => {
      expect(eventOf(name).message).toBe(message);
    },
  );

  test("a Windows 4625 failed logon's message says what the event wrote", () => {
    expect(eventOf("a Windows 4625 failed logon").message).toContain(
      `from ${tokenOf(SOURCE_ADDRESS)}`,
    );
  });

  test("the record's own fields keep the token, as the record holds it", () => {
    const pan: NormalizedSecurityEvent = eventOf("a Palo Alto traffic log");
    const fortigate: NormalizedSecurityEvent = eventOf(
      "a FortiGate traffic log",
    );
    const cef: NormalizedSecurityEvent = eventOf(
      "a CEF record of a denied connection",
    );
    const cloudTrail: NormalizedSecurityEvent = eventOf(
      "a CloudTrail record sent as a log",
    );

    expect([
      pan.attributes["panos.src"],
      pan.attributes["panos.dst"],
      fortigate.attributes["fortigate.srcip"],
      fortigate.attributes["fortigate.dstip"],
      cef.attributes["cef.src"],
      cef.attributes["cef.dst"],
      cloudTrail.attributes["sourceIPAddress"],
    ]).toEqual([
      tokenOf(SOURCE_ADDRESS),
      tokenOf(DESTINATION_ADDRESS),
      tokenOf(SOURCE_ADDRESS),
      tokenOf(DESTINATION_ADDRESS),
      tokenOf(SOURCE_ADDRESS),
      tokenOf(DESTINATION_ADDRESS),
      tokenOf(SOURCE_ADDRESS),
    ]);
  });

  test("the parser's own address attributes name real addresses only", () => {
    const asa: NormalizedSecurityEvent = eventOf(
      "a Cisco ASA connection an access list denied",
    );
    const openStack: NormalizedSecurityEvent = eventOf(
      "an OpenStack sign-in that failed",
    );

    expect(asa.attributes["asa.src_ip"]).toBeUndefined();
    expect(asa.attributes["asa.dst_ip"]).toBeUndefined();
    // Its interface and port are still read around what the rule left.
    expect(asa.attributes["asa.src_interface"]).toBe("outside");
    expect(asa.attributes["asa.src_port"]).toBe("52314");
    expect(asa.attributes["asa.dst_port"]).toBe("443");
    expect(asa.targetPort).toBe(443);
    expect(
      openStack.attributes[OpenStackAuditAttribute.InitiatorAddress],
    ).toBeUndefined();

    // With the addresses, they are what they always were.
    const named: NormalizedSecurityEvent = parseOne(
      lineWithAddresses(
        SCRUBBED_ADDRESS_FORMATS.find(
          (candidate: ScrubbedAddressFormat): boolean => {
            return (
              candidate.name === "a Cisco ASA connection an access list denied"
            );
          },
        )!,
      ),
    );

    expect([
      named.attributes["asa.src_ip"],
      named.attributes["asa.dst_ip"],
    ]).toEqual([SOURCE_ADDRESS, DESTINATION_ADDRESS]);
  });
});

describe("an address wins wherever a record names it", () => {
  test("a CEF record's hidden IPv4 source leaves the IPv6 one beside it", () => {
    const event: NormalizedSecurityEvent = parseOne({
      body: `CEF:0|Palo Alto Networks|PAN-OS|10.1.0|deny|TRAFFIC|1|src=[REDACTED] c6a2=2001:db8::7 dst=192.0.2.5 spt=40000 dpt=3389 act=deny`,
      attributes: {},
      time: new Date("2026-11-20T10:00:00.000Z"),
    });

    expect(event.principalIp).toBe("2001:db8::7");
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toBeNull();
  });

  test("a FortiGate SSL VPN line's hidden srcip leaves its remote address", () => {
    const event: NormalizedSecurityEvent = parseOne({
      body: `date=2026-10-30 time=10:00:11 devname="FGT60F" logid="0101039426" type="event" subtype="vpn" level="alert" logdesc="SSL VPN login fail" action="ssl-login-fail" srcip=[REDACTED] remip=10.10.0.4 user="alice" reason="sslvpn_login_permission_denied" msg="SSL user failed to logged in"`,
      attributes: {},
      time: new Date("2026-11-20T10:00:00.000Z"),
    });

    expect(event.principalIp).toBe("10.10.0.4");
    expect(readHiddenAddress(event, ScrubbedAddressRole.Principal)).toBeNull();
  });

  test("a token anywhere but the address's field is never the event's", () => {
    const event: NormalizedSecurityEvent = parseOne({
      body: `CEF:0|Fortinet|Fortigate|v7.0.12|32002|event:system login failed|7|duser=admin src=${SOURCE_ADDRESS} act=login outcome=failed msg=Administrator admin login failed from https(${tokenOf(DESTINATION_ADDRESS)})`,
      attributes: {},
      time: new Date("2026-11-20T10:00:00.000Z"),
    });

    expect(event.principalIp).toBe(SOURCE_ADDRESS);
    expect(event.targetIp).toBe("");

    for (const role of SCRUBBED_ADDRESS_ROLES) {
      expect(readHiddenAddress(event, role)).toBeNull();
    }
  });
});

describe("the rules that count per address never count hidden addresses as one (#10415)", () => {
  const COUNTED_ADDRESS_FIELDS: ReadonlyArray<string> = [
    "principalIp",
    "targetIp",
    OpenStackAuditAttribute.InitiatorAddress,
  ];

  test("each library rule that adds events up per address leaves out events with no address", () => {
    // A rule that fires on each event adds nothing up, so it groups no hidden events together.
    const counting: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (rule: DetectionRuleLibraryEntry): boolean => {
          return (
            COUNTED_ADDRESS_FIELDS.includes(rule.groupByField || "") &&
            (Number(rule.matchCountThreshold ?? 1) > 1 ||
              Boolean(rule.distinctCountField))
          );
        },
      );

    // Brute force, password spraying, OpenStack's failed logins and the rest.
    expect(counting.length).toBeGreaterThan(5);
    expect(
      counting
        .filter((rule: DetectionRuleLibraryEntry): boolean => {
          return !doesDetectionRuleLeaveOutEventsWithNoValue(rule);
        })
        .map((rule: DetectionRuleLibraryEntry): string => {
          return rule.title;
        }),
    ).toEqual([]);
  });

  test.each(HIDDEN_CASES)(
    "%s, with %s: the event has no value for any field a rule counts addresses by",
    (
      _name: string,
      _label: string,
      format: ScrubbedAddressFormat,
      pair: ScrubbedAddressPair,
    ) => {
      const event: NormalizedSecurityEvent = parseOne(
        lineWithScrubbed(format, pair),
      );
      const values: JSONObject = {
        principalIp: event.principalIp,
        targetIp: event.targetIp,
        [OpenStackAuditAttribute.InitiatorAddress]:
          event.attributes[OpenStackAuditAttribute.InitiatorAddress] ?? "",
      };

      expect(values).toEqual({
        principalIp: "",
        targetIp: "",
        [OpenStackAuditAttribute.InitiatorAddress]: "",
      });
    },
  );

  test("hidden events of every format are no one address, of whatever kind the rule left", () => {
    const events: Array<NormalizedSecurityEvent> = HIDDEN_CASES.map(
      ([, , format, pair]: [
        string,
        string,
        ScrubbedAddressFormat,
        ScrubbedAddressPair,
      ]): NormalizedSecurityEvent => {
        return parseOne(lineWithScrubbed(format, pair));
      },
    );
    const addresses: Set<string> = new Set<string>(
      events.flatMap((event: NormalizedSecurityEvent): Array<string> => {
        return [event.principalIp, event.targetIp];
      }),
    );

    // Every event of every format: none names an address a rule could have made up.
    expect(Array.from(addresses)).toEqual([""]);
    expect(
      events.every((event: NormalizedSecurityEvent): boolean => {
        return (
          readHiddenAddress(event, ScrubbedAddressRole.Principal)?.kind !==
          undefined
        );
      }),
    ).toBe(true);
    expect(
      events.filter((event: NormalizedSecurityEvent): boolean => {
        return (
          readHiddenAddress(event, ScrubbedAddressRole.Principal)?.kind ===
          ScrubbedAddressKind.Hashed
        );
      }).length,
    ).toBe(SCRUBBED_ADDRESS_FORMATS.length * 2);
  });
});
