import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  WIFI_INTERNAL_NETWORK_RULES,
  WifiInternalNetworkKind,
  WifiInternalNetworkRule,
} from "Common/Types/Monitor/SnmpMonitor/WifiInternalNetwork";
import {
  WIFI_VENDORS_DOCS_PATH,
  getWifiTemplates,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/WifiTemplateAdvice";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { NETWORK_DEVICE_PAGE, sectionInLanguage } from "./NetworkDocsLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The network device guide's "Supported Wi-Fi Vendors" table answers the
 * customer's question - which wireless vendors does OneUptime support - in
 * every docs language. It names every Wi-Fi
 * vendor template by the label the dashboard shows (markdown is not
 * compiled, so a renamed template would otherwise leave the guide pointing
 * at a dropdown entry that is not there), says what each vendor reports
 * over SNMP and what needs its cloud, and is where the empty Wi-Fi tab
 * links.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";

// The English section's heading; a translation's section sits on its lines.
const SECTION_HEADING: string = "### Supported Wi-Fi Vendors";

const TEMPLATE_LABELS_IN_TABLE: Array<string> = [
  ...getWifiTemplates().map((template: SnmpVendorTemplate) => {
    return template.label;
  }),
  SnmpVendorTemplateUtil.getById("tplink-omada-eap")!.label,
];

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s network device guide's Wi-Fi vendors",
  (language: string) => {
    const section: string = sectionInLanguage(
      language,
      NETWORK_DEVICE_PAGE,
      SECTION_HEADING,
    );

    test.each(TEMPLATE_LABELS_IN_TABLE)(
      "names the %s template as the dashboard does",
      (label: string) => {
        expect(section).toContain(`| ${label} |`);
      },
    );

    test("covers every vendor the customer works with", () => {
      for (const vendor of [
        "| Ubiquiti UniFi |",
        "| HPE Aruba |",
        "| Extreme Networks |",
        "| TP-Link |",
        "| Juniper |",
      ]) {
        expect(section).toContain(vendor);
      }
    });

    test("says what needs the vendor's cloud: Mist, Omada and Aruba Central", () => {
      expect(section).toContain("Mist");
      expect(section).toContain("Omada Controller");
      expect(section).toContain("Aruba Central");
      expect(section).toContain("AOS 10");
    });

    test("sends Mist's access point alerts through an Incoming Request monitor", () => {
      expect(section).toContain("/docs/monitor/incoming-request-monitor");
      expect(section).toContain("device-updowns");
    });

    test("says where each vendor turns SNMP on", () => {
      expect(section).toContain("cnMaestro");
      expect(section).toContain("UniFi Network");
      expect(section).toContain("ExtremeCloud IQ");
      expect(section).toContain("Network Config → SNMP");
    });

    test("names the networks UniFi runs for itself, which the Wi-Fi tab leaves out (#4730)", () => {
      const tab: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        "### The Wi-Fi Tab",
      );

      // The names as UniFi spells them, in every language's punctuation.
      expect(tab).toContain("`vwire-…`");
      expect(tab).toContain("`element-…`");
      expect(tab).toContain("WDS");
    });
  },
);

describe("what the Wi-Fi tab leaves out, held to the rules that leave it out (#4730)", () => {
  const tab: string = read("en", DEVICE_GUIDE).substring(
    read("en", DEVICE_GUIDE).indexOf("### The Wi-Fi Tab"),
    read("en", DEVICE_GUIDE).indexOf("### Supported Wi-Fi Vendors"),
  );

  // The bullet that says it, whole.
  const bullet: string =
    tab.split("\n").find((line: string): boolean => {
      return line.includes("(`vwire-…`)");
    }) || "";

  function ruleOf(
    vendor: string,
    kind: WifiInternalNetworkKind,
    column: string,
  ): WifiInternalNetworkRule {
    const rule: WifiInternalNetworkRule | undefined =
      WIFI_INTERNAL_NETWORK_RULES.find(
        (candidate: WifiInternalNetworkRule): boolean => {
          return (
            candidate.vendor === vendor &&
            candidate.kind === kind &&
            candidate.column === column
          );
        },
      );

    expect(rule).toBeDefined();
    return rule!;
  }

  test("is a bullet of its own, beside IQ Engine's N/A interfaces", () => {
    expect(bullet.startsWith("- ")).toBe(true);
    expect(tab).toContain("with N/A for those) is not listed as an SSID.");
  });

  test("names UniFi's mesh link by the name UniFi gives it", () => {
    const rule: WifiInternalNetworkRule = ruleOf(
      "Ubiquiti UniFi",
      WifiInternalNetworkKind.MeshLink,
      "unifiVapEssId",
    );

    expect(bullet).toContain("UniFi's wireless mesh link (`vwire-…`)");
    expect(rule.pattern?.test("vwire-0123456789abcdef")).toBe(true);
  });

  test("names UniFi's device adoption network by the name UniFi gives it", () => {
    const rule: WifiInternalNetworkRule = ruleOf(
      "Ubiquiti UniFi",
      WifiInternalNetworkKind.DeviceAdoption,
      "unifiVapEssId",
    );

    expect(bullet).toContain(
      "its network for adopting new UniFi devices (`element-…`)",
    );
    expect(rule.pattern?.test("element-0123456789abcdef")).toBe(true);
  });

  test("names the Extreme controller's WDS and mesh services, by their service types", () => {
    const rule: WifiInternalNetworkRule = ruleOf(
      "Extreme Networks",
      WifiInternalNetworkKind.MeshLink,
      "wlanServiceType",
    );

    expect(bullet).toContain("an Extreme controller's WDS and mesh services");
    // wds(3) and mesh(6), as HIPATH-WIRELESS-HWC-MIB numbers them.
    expect(rule.values).toEqual(["3", "6"]);
  });

  test("promises a hidden SSID of the reader's own is listed - no rule reads whether one is hidden", () => {
    expect(bullet).toContain(
      "A hidden SSID of your own is listed like any other.",
    );

    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      expect(rule.column.toLowerCase()).not.toContain("hide");
      expect(rule.column.toLowerCase()).not.toContain("supress");
    }
  });

  test("names no vendor the rules do not cover", () => {
    const vendors: Array<string> = Array.from(
      new Set(
        WIFI_INTERNAL_NETWORK_RULES.map(
          (rule: WifiInternalNetworkRule): string => {
            return rule.vendor;
          },
        ),
      ),
    ).sort();

    expect(vendors).toEqual(["Extreme Networks", "Ubiquiti UniFi"]);
    expect(bullet).not.toContain("Aruba");
    expect(bullet).not.toContain("Cambium");
  });
});

describe("the English guide", () => {
  const guide: string = read("en", DEVICE_GUIDE);

  test("has the heading the empty Wi-Fi tab links to", () => {
    const anchor: string = WIFI_VENDORS_DOCS_PATH.split("#")[1]!;

    const anchors: Array<string> = (guide.match(/^#{2,4} .+$/gm) || []).map(
      (heading: string): string => {
        return heading
          .replace(/^#+ /, "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replace(/ /g, "-");
      },
    );

    expect(anchors).toContain(anchor);
    expect(WIFI_VENDORS_DOCS_PATH.split("#")[0]).toBe(
      "/monitor/network-device-monitor",
    );
  });

  test("lists every Wi-Fi template in the vendor template table, and the renamed Ubiquiti one", () => {
    const table: string = guide.substring(
      guide.indexOf("### Vendor Health Templates"),
      guide.indexOf("### OID Collection Templates"),
    );

    for (const label of TEMPLATE_LABELS_IN_TABLE) {
      expect(table).toContain(label);
    }

    expect(table).toContain("Ubiquiti EdgeOS / EdgeSwitch / UniFi Switches");
    expect(table).not.toContain("Ubiquiti EdgeOS / UniFi |");
  });

  test("explains how the Wi-Fi tab puts each vendor's facts together", () => {
    const tab: string = guide.substring(
      guide.indexOf("### The Wi-Fi Tab"),
      guide.indexOf("### Supported Wi-Fi Vendors"),
    );

    expect(tab).toContain("6 GHz");
    expect(tab).toContain(
      "UniFi reports channel, transmit power and clients per SSID",
    );
    expect(tab).toContain("Apply Template");
  });

  test("says how vendor numbers in units of their own are read", () => {
    expect(guide).toContain("**adjust** the number they read");
    expect(guide).toContain(
      "**Noise Floor Greater Than -80** means the same on every",
    );
  });

  test("pages for an access point gone from its controller", () => {
    expect(guide).toContain('"Access Points: row unhealthy"');
  });
});

describe("the vendor guides", () => {
  test("send Extreme's Wi-Fi readers to the supported vendors", () => {
    expect(read("en", "monitor/network-vendor-guides.md")).toContain(
      "/docs/monitor/network-device-monitor#supported-wi-fi-vendors",
    );
  });
});
