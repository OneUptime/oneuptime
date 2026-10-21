import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import {
  DEVICE_ADDRESS_MONITOR_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPES,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { MANAGE_TEMPLATES_LINK_TITLE } from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnNetworkLabel } from "./NetworkDocsLabels";
import { boldSpans } from "./DocsTranslationChecks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE GUIDES ON WHICH TEMPLATES A DISCOVERY IMPORT OFFERS (OneUptime issue
 * #5145).
 *
 * The network device guide's "Importing what a scan found" says what the
 * import's Monitoring step lists - the kinds of template a device's monitor
 * can be made from - and names its "Manage templates" link the way each
 * language's Dashboard draws it; the monitor templates guide says that a
 * sync keeps each device's address on the monitors such an import made.
 * Markdown is not compiled, so a kind added to the import, or a link
 * renamed, would otherwise leave the guides telling readers something the
 * screen no longer shows. The kinds are read from the list the import and
 * the server work from (DEVICE_MONITOR_TEMPLATE_TYPES), the link's name
 * from the module the step draws it from.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";
const TEMPLATES_GUIDE: string = "monitor/monitor-templates.md";
const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// The numbered step of "Importing what a scan found" about monitoring.
function monitoringStep(language: string): string {
  const guide: string = read(language, DEVICE_GUIDE);
  const englishLines: Array<string> = read("en", DEVICE_GUIDE).split("\n");
  const index: number = englishLines.findIndex((line: string): boolean => {
    return line.startsWith("2. **Monitoring** asks how often");
  });

  expect(index).toBeGreaterThan(0);

  // The translations are kept line for line with the English.
  return guide.split("\n")[index] || "";
}

function titleOf(monitorType: MonitorType): string {
  return MonitorTypeHelper.getTitle(monitorType);
}

describe("the English guides", () => {
  test("the Monitoring step names every kind of template the import lists, and the rule for the rest", () => {
    const step: string = monitoringStep("en");

    for (const monitorType of DEVICE_MONITOR_TEMPLATE_TYPES) {
      expect(step).toContain(titleOf(monitorType));
    }

    expect(step).toContain(
      `a ${DEVICE_ADDRESS_MONITOR_TYPES.slice(0, -1)
        .map(titleOf)
        .join(", ")} or ${titleOf(
        DEVICE_ADDRESS_MONITOR_TYPES[DEVICE_ADDRESS_MONITOR_TYPES.length - 1]!,
      )} template's monitor checks the device's own address from the scan's probe`,
    );
    expect(step).toContain(
      "a Network Device template's monitor reads the device's polls",
    );
    expect(step).toContain(
      "Templates of other kinds cannot check a device and are not listed",
    );
  });

  test("the Monitoring step says a template made meanwhile is listed on coming back", () => {
    expect(monitoringStep("en")).toContain(
      `**${MANAGE_TEMPLATES_LINK_TITLE}** opens your templates in a new tab, and a template you add there is listed when you come back.`,
    );
  });

  test("the Monitoring step says how the checks that read a walk are shown", () => {
    const step: string = monitoringStep("en");

    expect(step).toContain("**SNMP devices only**");
    expect(step).toContain(
      "when every host answered ping only, those checks fold into one line",
    );
  });

  test("the templates guide says a sync keeps each device's address", () => {
    expect(read("en", TEMPLATES_GUIDE)).toContain(
      `the ${DEVICE_ADDRESS_MONITOR_TYPES.slice(0, -1)
        .map(titleOf)
        .join(", ")} and ${titleOf(
        DEVICE_ADDRESS_MONITOR_TYPES[DEVICE_ADDRESS_MONITOR_TYPES.length - 1]!,
      )} monitors a network discovery import made for devices keep checking each device's own address`,
    );
  });
});

describe.each(LANGUAGES)("the %s network device guide", (language: string) => {
  const step: string = monitoringStep(language);

  test("names Manage templates as that language's Dashboard draws it", () => {
    expect(step).toContain(
      `**${drawnNetworkLabel(language, MANAGE_TEMPLATES_LINK_TITLE)}**`,
    );
  });

  test("bolds as many labels in the step as the English does", () => {
    expect(boldSpans(step).length).toBe(boldSpans(monitoringStep("en")).length);
  });

  test("names the Ping, IP and NTP kinds, which every language draws as written", () => {
    for (const monitorType of [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.NTP,
    ]) {
      expect(step).toContain(titleOf(monitorType));
    }
  });
});

describe.each(LANGUAGES)("the %s monitor templates guide", (language: string) => {
  test("says the monitors a discovery import made keep their address, naming the kinds", () => {
    const guide: string = read(language, TEMPLATES_GUIDE);
    const englishLines: Array<string> = read("en", TEMPLATES_GUIDE).split("\n");
    const index: number = englishLines.findIndex((line: string): boolean => {
      return line.startsWith("- Existing templates have no field exclusions");
    });

    expect(index).toBeGreaterThan(0);

    const line: string = guide.split("\n")[index] || "";

    for (const kind of ["Ping", "IP", "NTP"]) {
      expect(line).toContain(kind);
    }
  });
});
