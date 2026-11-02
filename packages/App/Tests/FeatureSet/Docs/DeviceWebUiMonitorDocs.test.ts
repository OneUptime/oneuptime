import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NETWORK_DEVICE_PAGE,
  drawnNetworkLabel,
  sectionInLanguage,
} from "./NetworkDocsLabels";
import URL from "Common/Types/API/URL";
import DeviceWebUiUtil, {
  DEVICE_MONITOR_CHECK_QUERY_PARAM,
  DeviceMonitorCheck,
} from "Common/Utils/NetworkDevice/DeviceWebUiUtil";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * #5281: "Monitor web UI" on a network device's Monitors card opens Create
 * Monitor on a Website monitor of the device's management page. The
 * Network Device guide says so under "One device at a time", where a
 * reader learns to create a monitor from that card - held here to the code
 * that makes it true, and present in every docs language with the labels
 * that language's Dashboard draws. NetworkDocsTranslations holds the
 * translations to the English page line for line.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const HEADING: string = "### One device at a time";

const SECTION: string = sectionInLanguage("en", NETWORK_DEVICE_PAGE, HEADING);

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const CARD: string = readSource(
  "App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard.tsx",
);
const CREATE: string = readSource(
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Create.tsx",
);

// The part of Create Monitor that fills in a device's web UI monitor.
function webUiPreSeed(): string {
  const start: number = CREATE.indexOf(
    "const preSeedWebUiMonitorForDevice: (data: {",
  );
  const end: number = CREATE.indexOf("\n  };\n", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return CREATE.slice(start, end);
}

describe("the English section on Monitor web UI", () => {
  it("names the button as the device's Monitors card draws it, beside Create Monitor", () => {
    expect(CARD).toContain('title="Monitor web UI"');
    expect(CARD).toContain('"Monitors alerting on this device"');
    expect(SECTION).toContain(
      "Open the device's page and click **Create Monitor** on the **Monitors alerting on this device** card.",
    );
    expect(SECTION).toContain(
      "**Monitor web UI**, on the same card, opens a **Website** monitor of it",
    );
    // After the paragraph on Create Monitor, before the steps from Monitors.
    expect(SECTION.indexOf("**Monitor web UI**")).toBeGreaterThan(
      SECTION.indexOf("**Create Monitor** on the"),
    );
    expect(SECTION.indexOf("**Monitor web UI**")).toBeLessThan(
      SECTION.indexOf("To create one from **Monitors** instead:"),
    );
  });

  it("opens Create Monitor on the device's link, asking for its web UI", () => {
    expect(DEVICE_MONITOR_CHECK_QUERY_PARAM).toBe("check");
    expect(DeviceMonitorCheck.WebUi).toBe("web-ui");
    expect(CARD).toContain(
      "?networkDeviceId=${encodeURIComponent(\n      networkDeviceId,\n    )}&${DEVICE_MONITOR_CHECK_QUERY_PARAM}=${DeviceMonitorCheck.WebUi}",
    );
    expect(CREATE).toContain(
      "Navigation.getQueryStringByName(DEVICE_MONITOR_CHECK_QUERY_PARAM) ===\n      DeviceMonitorCheck.WebUi",
    );
  });

  it("says what the monitor starts with, as Create Monitor fills it in", () => {
    const preSeed: string = webUiPreSeed();

    // A Website monitor, https on the device's address.
    expect(preSeed).toContain("monitorType: MonitorType.Website,");
    expect(preSeed).toContain(
      "const webUiUrl: URL | null = DeviceWebUiUtil.getUrl(",
    );
    expect((DeviceWebUiUtil.getUrl("10.20.0.1") as URL).toString()).toBe(
      "https://10.20.0.1/",
    );
    expect(
      (DeviceWebUiUtil.getUrl("core-sw-01.example.net") as URL).toString(),
    ).toBe("https://core-sw-01.example.net/");
    expect(SECTION).toContain("`https://` on the device's address");

    // Self-signed certificates allowed.
    expect(preSeed).toContain("allowSelfSignedCertificates: true,");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep.tsx",
      ),
    ).toContain('title={"Allow self-signed certificates"}');
    expect(SECTION).toContain("with **Allow self-signed certificates** on");

    // From the device's own probe, named after the device.
    expect(preSeed).toContain("data.device?.probeId");
    expect(preSeed).toContain('"{{deviceName}} web UI"');
    expect(SECTION).toContain(
      "checked from the device's own probe and named after the device.",
    );
  });

  it("says which monitor the card lists, as the card finds it", () => {
    const listed: (monitorName: string, url: string) => boolean = (
      monitorName: string,
      url: string,
    ): boolean => {
      return DeviceWebUiUtil.isWebUiMonitorOf({
        monitorName: monitorName,
        destinations: [url],
        deviceName: "sw-core-01",
        deviceAddress: "10.20.0.1",
      });
    };

    // Named after the device, its URL on the device's address: any scheme, port or path.
    expect(listed("sw-core-01 web UI", "https://10.20.0.1/")).toBe(true);
    expect(listed("Admin page of sw-core-01", "http://10.20.0.1:8080/ui")).toBe(
      true,
    );
    // Either one missing, and it is some other Website monitor.
    expect(listed("Core switch web UI", "https://10.20.0.1/")).toBe(false);
    expect(listed("sw-core-01 web UI", "https://10.20.0.2/")).toBe(false);

    expect(SECTION).toContain(
      "Change the URL if the UI answers on `http`, on another port or under a path, then save.",
    );
    expect(SECTION).toContain(
      "The card lists the monitor as long as its name has the device's name in it and its URL is on the device's address; it does not change the device's status.",
    );
  });
});

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s Network Device guide",
  (language: string) => {
    it("says what Monitor web UI does, with the labels this language's Dashboard draws", () => {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        HEADING,
      );

      for (const label of [
        "Monitor web UI",
        "Website",
        "Allow self-signed certificates",
      ]) {
        expect({
          language,
          label,
          named: section.includes(`**${drawnNetworkLabel(language, label)}**`),
        }).toEqual({ language, label, named: true });
      }

      expect(section).toContain("`https://`");
      expect(section).toContain("`http`");
    });
  },
);
