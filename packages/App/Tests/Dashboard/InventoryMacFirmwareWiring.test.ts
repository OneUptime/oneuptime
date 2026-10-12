import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import { describeNetworkDevice } from "Common/Server/Utils/Telemetry/InventoryEntityRegistry";
import Dictionary from "Common/Types/Dictionary";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4107 — the follow-up to #3866. A discovered host's Attributes
 * card still lacked its MAC address and firmware version, and a mirrored
 * network device's card showed only its hostname although the SNMP poll
 * had collected serial, make, model and firmware long ago.
 *
 * The extractor and the mirror are unit-tested in packages/Common. This
 * covers the half that lives in text and hardcoded lists: the collector
 * config we generate must ask for the new detector attributes, every docs
 * language must too, the topology drawer's own key allowlist must carry
 * the new keys (with a translated label), and the CMDB page must list the
 * keys the mirror really writes.
 *
 * Source-wiring rather than rendering, for the reason given in
 * HostAssetAttributesWiring.test.ts.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const DOCS_CONTENT: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Docs",
  "Content",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...parts: Array<string>): string {
  return squash(fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8"));
}

function readCode(...parts: Array<string>): string {
  return squash(
    stripComments(fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")),
  );
}

function readDoc(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DOCS_CONTENT, ...parts), "utf8");
}

function generatedHostDocs(): string {
  return readSource("Pages", "Host", "Utils", "DocumentationMarkdown.ts");
}

/*
 * A switch as the poller leaves it after a full ENTITY-MIB walk, assigned a
 * role and a site - every fact the mirror can write (issue #4569).
 */
function polledSwitch(): NetworkDevice {
  const site: NetworkSite = new NetworkSite();
  site.name = "London DC1";
  const role: NetworkDeviceRole = new NetworkDeviceRole();
  role.key = "switch";
  role.name = "Switch";

  const device: NetworkDevice = new NetworkDevice();
  device.name = "core-sw-01";
  device.hostname = "10.20.0.1";
  device.dnsName = "core-sw-01.corp.example.com";
  device.sysName = "core-sw-01";
  device.macAddress = "00:1b:54:c2:7a:01";
  device.vendor = "Cisco";
  device.deviceModel = "WS-C3850-48P";
  device.serialNumber = "FOC1840X0AB";
  device.firmwareVersion = "16.12.4";
  device.softwareVersion = "16.12.04";
  device.sysDescr = "Cisco IOS Software, Version 16.12.4";
  device.sysLocation = "Hall 2, Rack 14";
  device.site = site;
  device.networkDeviceRole = role;
  return device;
}

/** The drawer rows #4107 adds, and the label each must carry. */
const NEW_DRAWER_ROWS: Array<[string, string]> = [
  ["host.mac", "MAC Address"],
  ["device.firmware.version", "Firmware Version"],
  ["os.version", "OS Version"],
];

describe("inventory MAC, firmware and network devices are wired end to end (issue #4107)", () => {
  describe("the topology drawer does not disagree with the Inventory page", () => {
    test.each(NEW_DRAWER_ROWS)(
      "%s has a drawer row labelled %p",
      (key: string, label: string) => {
        expect(
          readCode("Components", "Topology", "EntityDetailPanel.tsx"),
        ).toContain(`{ key: "${key}", label: "${label}" }`);
      },
    );

    /*
     * The drawer renders each label through t(). A label with no entry in
     * a locale file renders in English for that language, silently.
     */
    test.each(NEW_DRAWER_ROWS)(
      "the %s label is translated in every locale",
      (_key: string, label: string) => {
        const localesDir: string = path.join(DASHBOARD_SRC, "Locales");
        const files: Array<string> = fs
          .readdirSync(localesDir)
          .filter((name: string): boolean => {
            return name.endsWith(".json");
          });

        expect(files.length).toBeGreaterThanOrEqual(17);
        for (const file of files) {
          const locale: Dictionary<unknown> = JSON.parse(
            fs.readFileSync(path.join(localesDir, file), "utf8"),
          );
          const value: unknown = locale[label];
          expect({
            file,
            hasLabel: typeof value === "string" && value.length > 0,
          }).toEqual({
            file,
            hasLabel: true,
          });
        }
      },
    );

    /*
     * Every hardware fact a mirrored switch now carries has a drawer row,
     * so opening a switch in the topology map tells the same story as its
     * Inventory item.
     */
    test("every hardware key a mirrored switch carries has a drawer row", () => {
      const drawer: string = readCode(
        "Components",
        "Topology",
        "EntityDetailPanel.tsx",
      );
      for (const key of [
        "host.mac",
        "device.manufacturer",
        "device.model.name",
        "host.serial_number",
        "device.firmware.version",
        "os.version",
      ]) {
        expect(Object.keys(describeNetworkDevice(polledSwitch()))).toContain(
          key,
        );
        expect(drawer).toContain(`key: "${key}"`);
      }
    });
  });

  describe("the generated collector config", () => {
    test.each(["host.mac", "os.version"])(
      "%s is enabled in the system detector",
      (key: string) => {
        expect(generatedHostDocs()).toContain(`${key}: enabled: true`);
      },
    );

    test("the previously enabled attributes are all still enabled", () => {
      for (const key of [
        "host.name",
        "host.id",
        "host.arch",
        "host.ip",
        "os.type",
        "os.description",
      ]) {
        expect(generatedHostDocs()).toContain(`${key}: enabled: true`);
      }
    });

    test("the stamping example includes the firmware version", () => {
      expect(generatedHostDocs()).toContain(
        '- key: device.firmware.version value: "1.21.0" action: upsert',
      );
    });

    /*
     * Win32_BIOS.SMBIOSBIOSVersion is the BIOS version string ("1.21.0");
     * .Version is the ACPI OEM id ("DELL - 1072009"), which is not what a
     * CMDB calls firmware.
     */
    test("the Windows script reads the firmware from SMBIOSBIOSVersion", () => {
      expect(generatedHostDocs()).toContain(
        "- key: device.firmware.version value: $(Format-YamlValue $bios.SMBIOSBIOSVersion)",
      );
      expect(
        readCode("Pages", "Host", "Utils", "DocumentationMarkdown.ts"),
      ).not.toMatch(/\$bios\.Version\b/);
    });

    test("the firmware aliases are documented as accepted", () => {
      expect(generatedHostDocs()).toContain("host.firmware.version");
      expect(generatedHostDocs()).toContain("host.bios.version");
    });
  });

  describe("the docs site host page", () => {
    function languages(): Array<string> {
      return fs
        .readdirSync(DOCS_CONTENT, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => {
          return (
            entry.isDirectory() &&
            fs.existsSync(
              path.join(
                DOCS_CONTENT,
                entry.name,
                "telemetry",
                "host-otel-collector.md",
              ),
            )
          );
        })
        .map((entry: fs.Dirent): string => {
          return entry.name;
        });
    }

    /*
     * A reader who follows the docs page instead of the dashboard's
     * generated config must get host.mac and os.version too. The YAML is
     * not translated, so every language carries it in every block.
     */
    test("every language enables host.mac and os.version in every block", () => {
      const all: Array<string> = languages();
      expect(all.length).toBeGreaterThanOrEqual(17);

      for (const language of all) {
        const doc: string = readDoc(
          language,
          "telemetry",
          "host-otel-collector.md",
        );
        const blocks: number = (doc.match(/ {6}resource_attributes:\n/g) || [])
          .length;
        expect(blocks).toBeGreaterThan(0);

        for (const key of ["host.mac", "os.version"]) {
          const enabled: number = (
            doc.match(
              new RegExp(
                `${key.replace(".", "\\.")}:\\n {10}enabled: true`,
                "g",
              ),
            ) || []
          ).length;
          expect({ language, key, enabled }).toEqual({
            language,
            key,
            enabled: blocks,
          });
        }
      }
    });

    test("English explains how to read the firmware version on each OS", () => {
      const doc: string = readDoc("en", "telemetry", "host-otel-collector.md");

      expect(doc).toContain(
        "### Inventory attributes (IP, MAC, serial number, make, model, firmware)",
      );
      expect(doc).toContain("device.firmware.version");
      expect(doc).toContain("$bios.SMBIOSBIOSVersion");
      expect(doc).toContain("/sys/class/dmi/id/bios_version");
      expect(doc).toContain("System Firmware Version");
    });

    test("English says where host.mac comes from and what is left out", () => {
      const doc: string = readDoc("en", "telemetry", "host-otel-collector.md");

      expect(doc).toContain("| MAC addresses | `host.mac` |");
      expect(doc).toContain("00-00-00-00-00-00");
    });

    test("links to the renamed section use its new anchor", () => {
      for (const [folder, file] of [
        ["inventory", "cmdb-sync.md"],
        ["rum", "index.md"],
      ]) {
        const doc: string = readDoc("en", folder!, file!);
        expect(doc).toContain(
          "/docs/telemetry/host-otel-collector#inventory-attributes-ip-mac-serial-number-make-model-firmware",
        );
        expect(doc).not.toContain(
          "#inventory-attributes-ip-serial-number-make-model)",
        );
      }
    });
  });

  describe("the CMDB page", () => {
    function cmdbDoc(): string {
      return readDoc("en", "inventory", "cmdb-sync.md");
    }

    function networkSection(): string {
      const doc: string = cmdbDoc();
      const start: number = doc.indexOf("## Network Device Asset Attributes");
      expect(start).toBeGreaterThan(-1);
      const end: number = doc.indexOf("\n## ", start + 1);
      return doc.substring(start, end === -1 ? undefined : end);
    }

    test("the host table lists the new host keys", () => {
      for (const key of ["host.mac", "os.version", "device.firmware.version"]) {
        expect(cmdbDoc()).toContain(`\`${key}\``);
      }
    });

    /*
     * The documentation half of the network-device change, checked against
     * the code rather than a hand-kept list: every key the mirror writes
     * for a fully polled switch is in the table, and the table names no
     * key the mirror does not write.
     */
    test("the network-device table lists exactly the keys the mirror writes", () => {
      const written: Array<string> = Object.keys(
        describeNetworkDevice(polledSwitch()),
      ).sort();

      const documented: Array<string> = Array.from(
        networkSection().matchAll(/^\| [^|]+ \| `([^`]+)` \|/gm),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .sort();

      expect(documented).toEqual(written);
    });

    test("it no longer sends a sync to the Network Device record for hardware", () => {
      expect(cmdbDoc()).not.toContain(
        "The discovered hardware detail — vendor, model, serial number, firmware, site — lives on the Network Device record itself.",
      );
      expect(cmdbDoc()).toContain(
        "[Network device asset attributes](#network-device-asset-attributes)",
      );
    });

    /*
     * Hosts merge additively; the mirror replaces. A sync author needs to
     * know which, since it decides whether a value can disappear.
     */
    test("it says mirrored values are replaced, not merged", () => {
      expect(networkSection()).toContain("**replace**");
    });

    test("it says why there is no upgrade version", () => {
      expect(networkSection()).toContain("*available upgrade*");
    });
  });
});
