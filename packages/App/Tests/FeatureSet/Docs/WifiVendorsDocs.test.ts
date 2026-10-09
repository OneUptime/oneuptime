import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  WIFI_VENDORS_DOCS_PATH,
  getWifiTemplates,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/WifiTemplateAdvice";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The network device guide's "Supported Wi-Fi Vendors" table answers the
 * customer's question - which wireless vendors does OneUptime support - in
 * English and in Persian, the guide's two languages. It names every Wi-Fi
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

// The section's table rows, from the heading to the next heading.
function supportedVendorsSection(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);
  expect(start).toBeGreaterThan(-1);

  const next: number = markdown.indexOf("\n### ", start + heading.length);
  return markdown.substring(start, next === -1 ? undefined : next);
}

const SECTION_HEADINGS: Record<string, string> = {
  en: "### Supported Wi-Fi Vendors",
  fa: "### فروشندگان Wi-Fi پشتیبانی‌شده",
};

const TEMPLATE_LABELS_IN_TABLE: Array<string> = [
  ...getWifiTemplates().map((template: SnmpVendorTemplate) => {
    return template.label;
  }),
  SnmpVendorTemplateUtil.getById("tplink-omada-eap")!.label,
];

describe.each(["en", "fa"])(
  "the %s network device guide's Wi-Fi vendors",
  (language: string) => {
    const section: string = supportedVendorsSection(
      read(language, DEVICE_GUIDE),
      SECTION_HEADINGS[language]!,
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
  },
);

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
    expect(tab).toContain("UniFi reports channel, transmit power and clients per SSID");
    expect(tab).toContain("Apply Template");
  });

  test("says how vendor numbers in units of their own are read", () => {
    expect(guide).toContain("**adjust** the number they read");
    expect(guide).toContain("**Noise Floor Greater Than -80** means the same on every");
  });

  test("pages for an access point gone from its controller", () => {
    expect(guide).toContain('"Access Points: row\nunhealthy"');
  });
});

describe("the vendor guides", () => {
  test("send Extreme's Wi-Fi readers to the supported vendors", () => {
    expect(read("en", "monitor/network-vendor-guides.md")).toContain(
      "/docs/monitor/network-device-monitor#supported-wi-fi-vendors",
    );
  });
});
