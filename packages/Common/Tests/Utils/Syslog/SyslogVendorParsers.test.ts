import SyslogEventNormalizer, {
  NormalizedSyslogMessage,
  ReadSyslogLine,
} from "../../../Utils/Syslog/SyslogEventNormalizer";
import SyslogVendorCatalog, {
  SYSLOG_VENDOR_PARSERS,
} from "../../../Utils/Syslog/SyslogVendorCatalog";
import {
  SyslogEventRule,
  SyslogParserId,
  SyslogVendorParser,
} from "../../../Utils/Syslog/SyslogVendorParser";
import { NetworkEventTypeUtil } from "../../../Types/NetworkEvent/NetworkEventType";
import {
  ALL_SYSLOG_VENDOR_SAMPLES,
  ARUBA_SAMPLES,
  CAMBIUM_SAMPLES,
  CEF_SAMPLES,
  CISCO_SAMPLES,
  EXTREME_SAMPLES,
  FORTINET_SAMPLES,
  LINUX_SAMPLES,
  MIKROTIK_SAMPLES,
  SOPHOS_SAMPLES,
  SyslogVendorSample,
  UNIFI_SAMPLES,
  UNRECOGNIZED_SAMPLES,
} from "../../Helpers/SyslogVendorSamples";
import { describe, expect, it } from "@jest/globals";

/*
 * Every built-in syslog parser, on the lines its vendor's documentation
 * says the devices send (Tests/Helpers/SyslogVendorSamples.ts names the
 * source of each).
 *
 * A line goes through the same two steps ingest takes - the syslog header
 * is read, then the message - and must come out as its sample expects:
 * the parser that claims it, the event it is (or that it is none), the
 * attributes stored with it, and who it says it is from.
 */

function read(sample: SyslogVendorSample): NormalizedSyslogMessage {
  const line: ReadSyslogLine | null = SyslogEventNormalizer.readLine(
    sample.line,
    sample.deviceVendor ? { deviceVendor: sample.deviceVendor } : undefined,
  );

  if (!line) {
    throw new Error(`Expected ${JSON.stringify(sample.line)} to be read`);
  }

  return line.normalized;
}

function describeSamples(
  title: string,
  samples: Array<SyslogVendorSample>,
): void {
  describe(title, () => {
    for (const sample of samples) {
      it(sample.name, () => {
        const normalized: NormalizedSyslogMessage = read(sample);

        expect({
          parserId: normalized.parserId,
          eventName: normalized.eventName,
        }).toEqual({
          parserId: sample.expect.parserId,
          eventName: sample.expect.eventName,
        });

        if (sample.expect.vendor !== undefined) {
          expect(normalized.vendor).toBe(sample.expect.vendor);
        }

        // An event is always stored under its name and its domain.
        if (sample.expect.eventName) {
          expect(normalized.attributes["event.name"]).toBe(
            sample.expect.eventName,
          );
          expect(normalized.attributes["event.domain"]).toBe("network");
        } else {
          expect(normalized.attributes["event.name"]).toBeUndefined();
          expect(normalized.attributes["event.domain"]).toBeUndefined();
          expect(normalized.attributes["event.message"]).toBeUndefined();
        }

        if (sample.expect.attributes) {
          expect(normalized.attributes).toMatchObject(
            sample.expect.attributes,
          );
        }

        for (const key of sample.expect.absent || []) {
          expect(Object.keys(normalized.attributes)).not.toContain(key);
        }

        if (sample.expect.identity) {
          expect(normalized.identity).toEqual(sample.expect.identity);
        }

        if (sample.expect.headerHostname === null) {
          expect(normalized.headerHostname).toBeUndefined();
        } else if (sample.expect.headerHostname !== undefined) {
          expect(normalized.headerHostname).toBe(sample.expect.headerHostname);
        }

        if (sample.expect.severity !== undefined) {
          expect(normalized.severity).toBe(sample.expect.severity);
        }
      });
    }
  });
}

describeSamples("Sophos Firewall", SOPHOS_SAMPLES);
describeSamples("Fortinet FortiGate", FORTINET_SAMPLES);
describeSamples("Cisco IOS, IOS XE, NX-OS and ASA", CISCO_SAMPLES);
describeSamples("Extreme Networks EXOS and VOSS", EXTREME_SAMPLES);
describeSamples("HPE Aruba Networking AOS-CX and AOS-Switch", ARUBA_SAMPLES);
describeSamples("MikroTik RouterOS", MIKROTIK_SAMPLES);
describeSamples("Cambium Networks Enterprise Wi-Fi", CAMBIUM_SAMPLES);
describeSamples("Ubiquiti UniFi", UNIFI_SAMPLES);
describeSamples("Linux-based devices", LINUX_SAMPLES);
describeSamples("CEF from any other product", CEF_SAMPLES);
describeSamples("lines no parser claims", UNRECOGNIZED_SAMPLES);

describe("the samples themselves", () => {
  it("have a name each, and none twice", () => {
    const names: Array<string> = ALL_SYSLOG_VENDOR_SAMPLES.map(
      (sample: SyslogVendorSample): string => {
        return sample.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  it("each say where the line comes from", () => {
    for (const sample of ALL_SYSLOG_VENDOR_SAMPLES) {
      expect({
        name: sample.name,
        hasSource: sample.source.trim().length >= 6,
      }).toEqual({ name: sample.name, hasSource: true });
    }
  });

  it("expect only events of the vocabulary", () => {
    for (const sample of ALL_SYSLOG_VENDOR_SAMPLES) {
      if (sample.expect.eventName) {
        expect({
          name: sample.name,
          known: NetworkEventTypeUtil.isBuiltIn(sample.expect.eventName),
        }).toEqual({ name: sample.name, known: true });
      }
    }
  });

  it("cover every parser of the catalog, each with an event and with a line that is none", () => {
    for (const parser of SYSLOG_VENDOR_PARSERS) {
      const own: Array<SyslogVendorSample> = ALL_SYSLOG_VENDOR_SAMPLES.filter(
        (sample: SyslogVendorSample): boolean => {
          return sample.expect.parserId === parser.id;
        },
      );

      expect({
        parser: parser.id,
        hasEvent: own.some((sample: SyslogVendorSample): boolean => {
          return sample.expect.eventName !== null;
        }),
        hasNonEvent: own.some((sample: SyslogVendorSample): boolean => {
          return sample.expect.eventName === null;
        }),
      }).toEqual({ parser: parser.id, hasEvent: true, hasNonEvent: true });
    }
  });

  it("reach every rule of every parser: no rule is untested, and none is shadowed by one before it", () => {
    const reached: Set<string> = new Set();

    for (const sample of ALL_SYSLOG_VENDOR_SAMPLES) {
      const normalized: NormalizedSyslogMessage = read(sample);

      if (normalized.parserId && normalized.ruleIndex !== null) {
        reached.add(`${normalized.parserId} #${normalized.ruleIndex}`);
      }
    }

    const unreached: Array<string> = [];

    for (const parser of SYSLOG_VENDOR_PARSERS) {
      parser.rules.forEach((rule: SyslogEventRule, index: number): void => {
        if (!reached.has(`${parser.id} #${index}`)) {
          unreached.push(`${parser.id} #${index} (${rule.event})`);
        }
      });
    }

    expect(unreached).toEqual([]);
  });
});

describe("telling the vendors apart", () => {
  it("each line is claimed by exactly the parser its sample names - no parser detects another's", () => {
    for (const sample of ALL_SYSLOG_VENDOR_SAMPLES) {
      // Without the device's vendor: only what the line itself proves.
      const line: ReadSyslogLine | null = SyslogEventNormalizer.readLine(
        sample.line,
      );
      const expected: string | null = sample.deviceVendor
        ? null
        : sample.expect.parserId;

      expect({ name: sample.name, parserId: line?.normalized.parserId }).toEqual(
        { name: sample.name, parserId: expected },
      );
    }
  });

  it("a format with no mark of its own is read only for a device of its maker", () => {
    const needVendor: Array<SyslogVendorSample> =
      ALL_SYSLOG_VENDOR_SAMPLES.filter(
        (sample: SyslogVendorSample): boolean => {
          return Boolean(sample.deviceVendor);
        },
      );

    expect(needVendor.length).toBeGreaterThanOrEqual(3);

    for (const sample of needVendor) {
      // Its own maker: read.
      expect(read(sample).parserId).toBe(sample.expect.parserId);

      // No maker known, and another maker: left alone.
      expect(
        SyslogEventNormalizer.readLine(sample.line)?.normalized.eventName,
      ).toBeNull();
      expect(
        SyslogEventNormalizer.readLine(sample.line, {
          deviceVendor: "Juniper Networks",
        })?.normalized.parserId,
      ).toBeNull();
    }
  });

  it("the device's vendor never overrides what a line itself proves", () => {
    const cisco: SyslogVendorSample = CISCO_SAMPLES[0] as SyslogVendorSample;

    expect(
      SyslogEventNormalizer.readLine(cisco.line, {
        deviceVendor: "MikroTik",
      })?.normalized.parserId,
    ).toBe(SyslogParserId.Cisco);
  });

  it("names the vendor in a device's own words for it, in any case", () => {
    const sample: SyslogVendorSample = MIKROTIK_SAMPLES.find(
      (candidate: SyslogVendorSample): boolean => {
        return Boolean(candidate.deviceVendor);
      },
    ) as SyslogVendorSample;

    for (const deviceVendor of [
      "MikroTik",
      "mikrotik",
      "MikroTikls SIA",
      "RouterOS CCR2004-16G-2S+",
    ]) {
      expect({
        deviceVendor,
        parserId: SyslogEventNormalizer.readLine(sample.line, { deviceVendor })
          ?.normalized.parserId,
      }).toEqual({ deviceVendor, parserId: SyslogParserId.MikroTikRouterOs });
    }
  });
});

describe("the catalog", () => {
  it("reads the eight vendors of issue #4728, and Linux-based devices", () => {
    expect(SyslogVendorCatalog.getVendors()).toEqual([
      "Ubiquiti",
      "Sophos",
      "Fortinet",
      "Cisco",
      "Extreme Networks",
      "HPE Aruba Networking",
      "MikroTik",
      "Cambium Networks",
    ]);

    expect(
      SYSLOG_VENDOR_PARSERS.map((parser: SyslogVendorParser): string => {
        return parser.id;
      }),
    ).toEqual([
      "ubiquiti-unifi",
      "sophos-firewall",
      "fortinet-fortigate",
      "cisco",
      "extreme-exos",
      "extreme-voss",
      "aruba-aos-cx",
      "aruba-aos-switch",
      "mikrotik-routeros",
      "cambium-enterprise-wifi",
      "linux",
    ]);
  });

  it("gives every parser an id of its own, a product and a format", () => {
    const ids: Array<string> = SYSLOG_VENDOR_PARSERS.map(
      (parser: SyslogVendorParser): string => {
        return parser.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const parser of SYSLOG_VENDOR_PARSERS) {
      expect(SyslogVendorCatalog.isParserId(parser.id)).toBe(true);
      expect(parser.product.length).toBeGreaterThan(3);
      expect(parser.format.length).toBeGreaterThan(2);
      expect(SyslogVendorCatalog.getParser(parser.id)).toBe(parser);
    }

    expect(SyslogVendorCatalog.getParser("nobody")).toBeNull();
    expect(SyslogVendorCatalog.isParserId("nobody")).toBe(false);
    // A CEF message from any other product has an id too, and no parser.
    expect(SyslogVendorCatalog.isParserId(SyslogParserId.Cef)).toBe(true);
    expect(SyslogVendorCatalog.getParser(SyslogParserId.Cef)).toBeNull();
  });

  it("groups a vendor's parsers", () => {
    expect(
      SyslogVendorCatalog.getParsersOfVendor("Extreme Networks").map(
        (parser: SyslogVendorParser): string => {
          return parser.id;
        },
      ),
    ).toEqual(["extreme-exos", "extreme-voss"]);
    expect(SyslogVendorCatalog.getParsersOfVendor("Nobody")).toEqual([]);
  });

  it("only a parser whose format has no mark of its own asks for the device's vendor", () => {
    expect(
      SYSLOG_VENDOR_PARSERS.filter((parser: SyslogVendorParser): boolean => {
        return parser.detectForKnownVendor !== undefined;
      }).map((parser: SyslogVendorParser): string => {
        return parser.id;
      }),
    ).toEqual([
      "aruba-aos-switch",
      "mikrotik-routeros",
      "cambium-enterprise-wifi",
    ]);

    // And each of those names its maker, or the vendor could never match.
    for (const parser of SYSLOG_VENDOR_PARSERS) {
      if (parser.detectForKnownVendor) {
        expect(parser.vendorKeywords.length).toBeGreaterThan(0);
      }

      for (const keyword of parser.vendorKeywords) {
        expect(keyword).toBe(keyword.toLowerCase());
      }
    }
  });
});
