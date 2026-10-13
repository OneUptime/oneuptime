/*
 * The docs link is built from the dashboard's DOCS_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    DOCS_URL: URLType.fromString("https://oneuptime.com/docs"),
  };
});

import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_EVENTS_DOCS_PATH,
  OTHER_DEVICES_NAME,
  PROBE_ADDRESS_PLACEHOLDER,
  SYSLOG_PORT,
  SyslogSetupGuide,
  SyslogSetupVendor,
  getConfigurationForProbe,
  getNetworkEventsDocsUrl,
  getSyslogSetupGuides,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsSetup";
import { DEFAULT_SYSLOG_RECEIVER_PORT } from "Common/Types/Syslog/SyslogReceiverDefaults";
import SyslogVendorCatalog from "Common/Utils/Syslog/SyslogVendorCatalog";
import {
  SyslogParserId,
  SyslogVendorParser,
} from "Common/Utils/Syslog/SyslogVendorParser";
import fs from "fs";
import path from "path";

/*
 * What the Events pages show before the first message arrives: the probe's
 * port, and per vendor the lines to paste (or the clicks to make) to point
 * a device's syslog at it.
 *
 * A guide is a promise: follow it and OneUptime reads what the device then
 * sends. So the guides are held to the parser catalog - every built-in
 * parser is reached by a guide, and no guide names a parser that does not
 * exist - and to the port the probe really listens on.
 */

const PROBE_CONFIG: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "Probe", "Config.ts"),
  "utf8",
);

function guideFor(vendor: SyslogSetupVendor): SyslogSetupGuide {
  const guide: SyslogSetupGuide | undefined = getSyslogSetupGuides().find(
    (candidate: SyslogSetupGuide): boolean => {
      return candidate.vendor === vendor;
    },
  );

  if (!guide) {
    throw new Error(`No guide for ${vendor}`);
  }

  return guide;
}

function linesOf(vendor: SyslogSetupVendor): Array<string> {
  return (guideFor(vendor).configuration || "").split("\n");
}

describe("the probe's port", () => {
  test("is 5140, the probe's own default, so the guide and the probe agree", () => {
    expect(SYSLOG_PORT).toBe(5140);
    expect(SYSLOG_PORT).toBe(DEFAULT_SYSLOG_RECEIVER_PORT);
    expect(PROBE_CONFIG).toContain("DEFAULT_SYSLOG_RECEIVER_PORT");
  });
});

describe("the vendor guides", () => {
  test("cover the eight vendors asked for, and everything else, in this order", () => {
    expect(
      getSyslogSetupGuides().map((guide: SyslogSetupGuide): string => {
        return guide.name;
      }),
    ).toEqual([
      "Cisco",
      "Sophos Firewall",
      "FortiGate",
      "Extreme Networks",
      "HPE Aruba",
      "MikroTik",
      "UniFi",
      "Cambium",
      "Other devices",
    ]);
  });

  test("each has a vendor of its own", () => {
    const vendors: Array<SyslogSetupVendor> = getSyslogSetupGuides().map(
      (guide: SyslogSetupGuide): SyslogSetupVendor => {
        return guide.vendor;
      },
    );

    expect(new Set(vendors).size).toBe(vendors.length);
    expect([...vendors].sort()).toEqual(
      [...Object.values(SyslogSetupVendor)].sort(),
    );
  });

  test("only the last one's name is words to translate; the rest are product names", () => {
    expect(guideFor(SyslogSetupVendor.Other).name).toBe(OTHER_DEVICES_NAME);
    expect(OTHER_DEVICES_NAME).toBe("Other devices");
  });

  test("every built-in parser is reached by exactly one guide", () => {
    const reached: Array<SyslogParserId> = getSyslogSetupGuides().flatMap(
      (guide: SyslogSetupGuide): Array<SyslogParserId> => {
        return guide.parsers;
      },
    );

    // No parser twice: a format belongs to one tab.
    expect(new Set(reached).size).toBe(reached.length);
    // Every id there is - the catalog's, and the CEF reader's.
    expect([...reached].sort()).toEqual(
      [...Object.values(SyslogParserId)].sort(),
    );

    for (const parser of SyslogVendorCatalog.getParsers()) {
      expect({
        parser: parser.id,
        hasGuide: reached.includes(parser.id),
      }).toEqual({ parser: parser.id, hasGuide: true });
    }
  });

  test("a vendor's guide leads to that vendor's parsers", () => {
    const makers: Record<string, string> = {
      [SyslogSetupVendor.Cisco]: "Cisco",
      [SyslogSetupVendor.Sophos]: "Sophos",
      [SyslogSetupVendor.Fortinet]: "Fortinet",
      [SyslogSetupVendor.Extreme]: "Extreme Networks",
      [SyslogSetupVendor.Aruba]: "HPE Aruba Networking",
      [SyslogSetupVendor.MikroTik]: "MikroTik",
      [SyslogSetupVendor.UniFi]: "Ubiquiti",
      [SyslogSetupVendor.Cambium]: "Cambium Networks",
    };

    for (const guide of getSyslogSetupGuides()) {
      if (guide.vendor === SyslogSetupVendor.Other) {
        continue;
      }

      for (const id of guide.parsers) {
        const parser: SyslogVendorParser | null =
          SyslogVendorCatalog.getParser(id);

        expect({ guide: guide.vendor, maker: parser?.vendor }).toEqual({
          guide: guide.vendor,
          maker: makers[guide.vendor],
        });
      }
    }

    // And every maker the catalog reads has a tab.
    expect([...SyslogVendorCatalog.getVendors()].sort()).toEqual(
      [...Object.values(makers)].sort(),
    );
  });

  test("every guide has steps, each one once", () => {
    for (const guide of getSyslogSetupGuides()) {
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(new Set(guide.steps).size).toBe(guide.steps.length);

      for (const step of guide.steps) {
        expect(step.trim()).toBe(step);
        expect(step.length).toBeGreaterThan(20);
      }
    }
  });

  test("every configuration to paste names the probe by the placeholder and sends to 5140", () => {
    const pasted: Array<SyslogSetupGuide> = getSyslogSetupGuides().filter(
      (guide: SyslogSetupGuide): boolean => {
        return guide.configuration !== null;
      },
    );

    expect(
      pasted.map((guide: SyslogSetupGuide): SyslogSetupVendor => {
        return guide.vendor;
      }),
    ).toEqual([
      SyslogSetupVendor.Cisco,
      SyslogSetupVendor.Fortinet,
      SyslogSetupVendor.Extreme,
      SyslogSetupVendor.Aruba,
      SyslogSetupVendor.MikroTik,
    ]);

    for (const guide of pasted) {
      expect(guide.configuration).toContain(PROBE_ADDRESS_PLACEHOLDER);
      expect(guide.configuration).toContain(String(SYSLOG_PORT));
      // What is pasted is explained: the first step says what to do with it.
      expect(guide.steps[0]).toContain(PROBE_ADDRESS_PLACEHOLDER);
      // No line ends in whitespace, and none is empty: it is pasted as is.
      for (const line of (guide.configuration || "").split("\n")) {
        expect(line.trimEnd()).toBe(line);
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  test("a guide set up by clicks says the port in its steps, or says what to do without one", () => {
    for (const guide of getSyslogSetupGuides()) {
      if (guide.configuration !== null) {
        continue;
      }

      const steps: string = guide.steps.join(" ");

      expect({
        vendor: guide.vendor,
        saysThePort:
          steps.includes(String(SYSLOG_PORT)) || steps.includes("port 514"),
      }).toEqual({ vendor: guide.vendor, saysThePort: true });
    }
  });

  test("Cisco: a logging host over UDP to 5140, informational and up, with timestamps that carry the year's clock", () => {
    expect(linesOf(SyslogSetupVendor.Cisco)).toEqual([
      `logging host ${PROBE_ADDRESS_PLACEHOLDER} transport udp port 5140`,
      "logging trap informational",
      "service timestamps log datetime msec",
    ]);

    // NX-OS words it differently, and the guide says how.
    expect(guideFor(SyslogSetupVendor.Cisco).steps.join(" ")).toContain(
      "logging server <probe-address> 6 port 5140 use-vrf management",
    );
  });

  test("FortiGate: syslogd to 5140 over UDP in the default format, the one the parser reads", () => {
    expect(linesOf(SyslogSetupVendor.Fortinet)).toEqual([
      "config log syslogd setting",
      "    set status enable",
      `    set server "${PROBE_ADDRESS_PLACEHOLDER}"`,
      "    set port 5140",
      "    set mode udp",
      "    set format default",
      "end",
    ]);
  });

  test("Extreme: the target is added and enabled on a virtual router the guide tells you to change", () => {
    expect(linesOf(SyslogSetupVendor.Extreme)).toEqual([
      `configure syslog add ${PROBE_ADDRESS_PLACEHOLDER}:5140 vr VR-Default local7`,
      `enable log target syslog ${PROBE_ADDRESS_PLACEHOLDER}:5140 vr VR-Default local7`,
      "enable syslog",
    ]);
    expect(guideFor(SyslogSetupVendor.Extreme).steps.join(" ")).toContain(
      "VR-Default",
    );
  });

  test("HPE Aruba: AOS-CX to paste, AOS-Switch and the management VRF in the steps", () => {
    expect(linesOf(SyslogSetupVendor.Aruba)).toEqual([
      `logging ${PROBE_ADDRESS_PLACEHOLDER} udp 5140 severity info`,
    ]);

    const steps: string = guideFor(SyslogSetupVendor.Aruba).steps.join(" ");

    expect(steps).toContain("vrf mgmt");
    expect(steps).toContain("logging <probe-address> udp 5140");
  });

  test("MikroTik: the built-in remote action is pointed at the probe, and four topics choose what it sends", () => {
    expect(linesOf(SyslogSetupVendor.MikroTik)).toEqual([
      `/system logging action set remote remote=${PROBE_ADDRESS_PLACEHOLDER} remote-port=5140`,
      "/system logging add topics=info action=remote",
      "/system logging add topics=warning action=remote",
      "/system logging add topics=error action=remote",
      "/system logging add topics=critical action=remote",
    ]);
  });

  test("Sophos: where the clicks are, the port, the level - and that traffic logs are many", () => {
    const steps: string = guideFor(SyslogSetupVendor.Sophos).steps.join(" ");

    expect(steps).toContain("System services > Log settings");
    expect(steps).toContain("port 5140");
    expect(steps).toContain("Information");
    expect(steps).toContain("Either log format the firewall offers is read.");
    expect(steps).toContain("leave them out unless you want them");
  });

  test("UniFi: the console's SIEM export, and where a managed device's events land", () => {
    const steps: string = guideFor(SyslogSetupVendor.UniFi).steps.join(" ");

    expect(steps).toContain("System Logging / SIEM");
    expect(steps).toContain("SIEM Server");
    expect(steps).toContain("port 5140");
    // The console speaks for the access points and switches it manages.
    expect(steps).toContain("with its MAC address");
    expect(steps).toContain("on the console's otherwise");
  });

  test("Cambium: a syslog server in cnMaestro or on the access point, and what to do about port 514", () => {
    const steps: string = guideFor(SyslogSetupVendor.Cambium).steps.join(" ");

    expect(steps).toContain("cnMaestro");
    expect(steps).toContain("Info");
    expect(steps).toContain("port 514");
    expect(steps).toContain("the note under step 1");
  });

  test("other devices: the three formats, both transports, and that an unknown format is kept and can be named", () => {
    const guide: SyslogSetupGuide = guideFor(SyslogSetupVendor.Other);
    const steps: string = guide.steps.join(" ");

    expect(guide.configuration).toBeNull();
    expect(guide.parsers).toEqual([SyslogParserId.Linux, SyslogParserId.Cef]);
    expect(steps).toContain("port 5140, over UDP or TCP");
    for (const format of ["RFC 3164", "RFC 5424", "CEF"]) {
      expect(steps).toContain(format);
    }
    expect(steps).toContain("still has its messages stored");
    expect(steps).toContain("log pipeline");
  });

  test("no guide tells a person to send to the privileged port the probe does not listen on", () => {
    const WORD_514: RegExp = /(?:^|[^0-9])514(?:[^0-9]|$)/;

    for (const guide of getSyslogSetupGuides()) {
      expect({
        vendor: guide.vendor,
        pastes514: WORD_514.test(guide.configuration || ""),
      }).toEqual({ vendor: guide.vendor, pastes514: false });
    }
  });
});

describe("getConfigurationForProbe", () => {
  test("puts the probe's address where the placeholder is, everywhere it is", () => {
    const configuration: string = getConfigurationForProbe(
      guideFor(SyslogSetupVendor.Extreme),
      "192.0.2.50",
    )!;

    expect(configuration).not.toContain(PROBE_ADDRESS_PLACEHOLDER);
    expect(configuration.split("\n")).toEqual([
      "configure syslog add 192.0.2.50:5140 vr VR-Default local7",
      "enable log target syslog 192.0.2.50:5140 vr VR-Default local7",
      "enable syslog",
    ]);
  });

  test("an address is put in as text, whatever is in it", () => {
    // `$&` and `$1` mean something to String.replace; they must not here.
    expect(
      getConfigurationForProbe(guideFor(SyslogSetupVendor.Aruba), "$&-$1"),
    ).toBe("logging $&-$1 udp 5140 severity info");
  });

  test("keeps the placeholder when the page does not know the address", () => {
    const guide: SyslogSetupGuide = guideFor(SyslogSetupVendor.Cisco);

    expect(getConfigurationForProbe(guide, null)).toBe(guide.configuration);
    expect(getConfigurationForProbe(guide, "")).toBe(guide.configuration);
  });

  test("a guide set up by clicks has nothing to paste", () => {
    for (const vendor of [
      SyslogSetupVendor.Sophos,
      SyslogSetupVendor.UniFi,
      SyslogSetupVendor.Cambium,
      SyslogSetupVendor.Other,
    ]) {
      expect(getConfigurationForProbe(guideFor(vendor), "10.0.0.1")).toBeNull();
    }
  });
});

describe("the docs link", () => {
  test("is the network events page, which exists in every language", () => {
    expect(NETWORK_EVENTS_DOCS_PATH).toBe("/monitor/network-events");
    expect(getNetworkEventsDocsUrl().toString()).toBe(
      "https://oneuptime.com/docs/monitor/network-events",
    );

    const content: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Docs",
      "Content",
    );

    let languages: number = 0;

    for (const language of fs.readdirSync(content)) {
      if (!fs.statSync(path.join(content, language)).isDirectory()) {
        continue;
      }

      if (!fs.existsSync(path.join(content, language, "monitor"))) {
        continue;
      }

      languages++;

      expect({
        language,
        exists: fs.existsSync(
          path.join(content, language, "monitor", "network-events.md"),
        ),
      }).toEqual({ language, exists: true });
    }

    expect(languages).toBeGreaterThan(1);
  });
});
