import MonitoringSwitchCopy, {
  MONITORING_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import GlobalProbesOnNewMonitorsCopy, {
  GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Probe/GlobalProbesOnNewMonitorsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * One-switch settings save when they are flipped, in the monitor and status
 * page areas, and "monitoring is off" comes with the button that turns it
 * back on.
 *
 * Four cards whose Edit dialog held one switch are one switch now, drawn by
 * the shared ModelSwitchCard (Common/UI/Components/ModelSwitch):
 *
 *   - a monitor's Settings -> "Monitoring": "Check this monitor", which
 *     replaced "Disable Active Monitoring" (on meant off);
 *   - Monitors -> Settings -> Probes: "Add global probes to new monitors",
 *     which replaced "Disable Global Probes on New Monitors";
 *   - a status page's Embedded Status Badge and MCP Server.
 *
 * The banner on a turned-off monitor's pages and the overview's hero carry
 * "Turn monitoring on", in place of "please go to Settings" and an "Open
 * settings" link.
 *
 * This holds the pages to that, so a page written later cannot quietly
 * bring an Edit dialog or the double negative back. The behaviour is tested
 * in Common/Tests (ModelSwitchRow, ModelSwitchCard, MonitoringSwitch,
 * GlobalProbesOnNewMonitorsCard, StatusPageSwitchCardPages,
 * MonitorOverviewHero); the one-switch cards left in other areas are listed
 * in Common/Tests/UI/Components/Forms/OneSwitchCardsGuard.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readDashboard(relative: string): string {
  return readSource(path.join(DASHBOARD_SRC, relative));
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

describe("a monitor's Monitoring switch", () => {
  const settings: string = readDashboard("Pages/Monitor/View/Settings.tsx");
  const card: string = readDashboard("Components/Monitor/MonitoringCard.tsx");

  test("the Settings page draws the Monitoring card, not a card with an Edit dialog", () => {
    expect(settings).toContain(
      "{monitor?.monitorType !== MonitorType.Manual && ( <MonitoringCard monitorId={modelId} /> )}",
    );
    expect(settings).not.toContain('name="Monitor Settings"');
    expect(settings).not.toContain("Disable Active Monitoring");
  });

  test("the card is the shared switch card, inverted on Disable Monitoring, asking before it turns monitoring off", () => {
    expect(MONITORING_SWITCH_COLUMN).toBe("disableActiveMonitoring");
    expect(card).toContain("<ModelSwitchCard<Monitor>");
    expect(card).toContain("column={MONITORING_SWITCH_COLUMN}");
    expect(card).toContain("isInverted={true}");
    expect(card).toContain(
      "getConfirmation={getTurnOffMonitoringConfirmation}",
    );
    expect(card).toContain("if (isTurningOn) { return undefined; }");
    expect(card).toContain("submitButtonType: ButtonStyleType.DANGER");
  });

  test("its words read on = checked", () => {
    expect(MonitoringSwitchCopy.cardTitle).toBe("Monitoring");
    expect(MonitoringSwitchCopy.switchTitle).toBe("Check this monitor");
    expect(MonitoringSwitchCopy.turnOnButton).toBe("Turn monitoring on");

    for (const text of Object.values(MonitoringSwitchCopy)) {
      expect(text).not.toMatch(/disable/i);
      expect(text).not.toMatch(/go to settings/i);
    }
  });
});

describe("the banner on a turned-off monitor's pages", () => {
  const banner: string = readDashboard(
    "Components/Monitor/DisabledWarning.tsx",
  );
  const hook: string = readDashboard(
    "Components/Monitor/useTurnMonitoringOn.ts",
  );

  test("carries the button that turns monitoring on, in place", () => {
    expect(banner).toContain(
      "const turnMonitoringOn: TurnMonitoringOn = useTurnMonitoringOn({",
    );
    expect(banner).toContain("title={MonitoringSwitchCopy.turnOnButton}");
    expect(banner).toContain("onClick={turnMonitoringOn.turnOn}");
    expect(banner).toContain("disabled={!turnMonitoringOn.gate.isAllowed}");
    expect(banner).toContain("tooltip={turnMonitoringOn.gate.disabledReason}");
  });

  test("the button writes what the switch writes, gated like the switch, and tells the screen", () => {
    expect(hook).toContain(
      "PermissionGate.checkColumnUpdate( monitor, MONITORING_SWITCH_COLUMN, )",
    );
    expect(hook).toContain("[MONITORING_SWITCH_COLUMN]: false");
    expect(hook).toContain("announceModelSwitchSaved({");
  });

  test("it follows the switch on the same page, and the archive banner", () => {
    expect(banner).toContain("subscribeToModelSwitchSaved({");
    expect(banner).toContain("column: MONITORING_SWITCH_COLUMN");
    expect(banner).toContain("subscribeToArchiveStateChanges({");
  });

  test("it no longer sends the reader to Settings, and is not a red alert", () => {
    expect(banner).not.toContain("please go to Settings");
    expect(banner).not.toContain("AlertType.DANGER");
    expect(banner).toContain("type={AlertBannerType.Info}");
    expect(banner).toContain("icon={IconProp.PauseCircle}");
  });

  test("every monitor page that showed it still does", () => {
    /*
     * Interval.tsx is gone: the interval is on the Probes & Interval page
     * (Probes.tsx), whose banner this checks.
     */
    const pages: Array<string> = [
      "Alerts.tsx",
      "Criteria.tsx",
      "CustomFields.tsx",
      "Delete.tsx",
      "Dependencies.tsx",
      "Documentation.tsx",
      "Incidents.tsx",
      "Logs.tsx",
      "Metrics.tsx",
      "Owners.tsx",
      "Probes.tsx",
      "Settings.tsx",
      "Slos.tsx",
      "StatusTimeline.tsx",
    ];

    for (const page of pages) {
      expect([
        page,
        readDashboard(`Pages/Monitor/View/${page}`).includes(
          "<DisabledWarning monitorId={modelId}",
        ),
      ]).toEqual([page, true]);
    }
  });
});

describe("the overview's hero", () => {
  const hero: string = readDashboard(
    "Components/Monitor/Overview/MonitorOverviewHero.tsx",
  );
  const index: string = readDashboard("Pages/Monitor/View/Index.tsx");
  const presentation: string = readSource(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "Utils",
      "Monitor",
      "MonitorOverviewPresentationUtil.ts",
    ),
  );

  test("a turned-off monitor's call to action is the in-place action, not the settings link", () => {
    expect(presentation).toContain(
      'headline: { text: "Monitoring is turned off" }, explanation: PAUSED_EXPLANATION.disabled, lastKnownStatus: lastKnownStatus, callToAction: { text: "Turn monitoring on", actionKey: "turnMonitoringOn", },',
    );
  });

  test("the hero draws it as a button, and the page reads the monitor again after it", () => {
    expect(hero).toContain(
      "if (!isMonitorOverviewActionCallToAction(callToAction)) {",
    );
    expect(hero).toContain("onClick={turnMonitoringOn.turnOn}");
    expect(hero).toContain("onTurnedOn: props.onMonitoringTurnedOn,");
    expect(index).toContain("onMonitoringTurnedOn={onDetailsSaved}");
  });
});

describe("Global Probes on New Monitors", () => {
  const page: string = readDashboard(
    "Pages/Monitor/Settings/MonitorProbes.tsx",
  );
  const card: string = readDashboard(
    "Components/Probe/GlobalProbesOnNewMonitorsCard.tsx",
  );

  test("the Probes settings page draws the switch card", () => {
    expect(page).toContain(
      "<GlobalProbesOnNewMonitorsCard projectId={ProjectUtil.getCurrentProjectId()!} />",
    );
    expect(page).not.toContain("Global Probe Settings");
    expect(page).not.toContain("Disable Global Probes on New Monitors");
    expect(page).not.toContain("doNotAddGlobalProbesByDefaultOnNewMonitors");
  });

  test("the card is the shared switch card on the project column, inverted", () => {
    expect(GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN).toBe(
      "doNotAddGlobalProbesByDefaultOnNewMonitors",
    );
    expect(card).toContain("<ModelSwitchCard<Project>");
    expect(card).toContain("column={GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN}");
    expect(card).toContain("isInverted={true}");
    expect(card).toContain("note={GlobalProbesOnNewMonitorsCopy.note}");
  });
});

describe("status page switches", () => {
  test("Embedded Status: the badge's switch saves when flipped, and the preview follows it", () => {
    const page: string = readDashboard(
      "Pages/StatusPages/View/EmbeddedStatus.tsx",
    );

    expect(page).toContain("<ModelSwitchCard<StatusPage>");
    expect(page).toContain('column="enableEmbeddedOverallStatus"');
    expect(page).toContain('title="Enable Embedded Status Badge"');
    expect(page).toContain("select={{ embeddedOverallStatusToken: true, }}");
    expect(page).toContain("setIsEmbeddedStatusEnabled(isOn);");
    expect(page).not.toContain("CardModelDetail");
  });

  test("MCP: the MCP server's switch saves when flipped", () => {
    const page: string = readDashboard("Pages/StatusPages/View/Mcp.tsx");

    expect(page).toContain("<ModelSwitchCard<StatusPage>");
    expect(page).toContain('column="enableMcpServer"');
    // The help further down names it.
    expect(page).toContain('title="Enable MCP Server"');
    expect(page).toContain('translator.translateText("Enable MCP Server")');
    expect(page).not.toContain("CardModelDetail");
  });

  test("the status page switch row is the shared row, saving in one place", () => {
    const row: string = readDashboard(
      "Components/StatusPage/StatusPageSwitchRow.tsx",
    );

    expect(row).toContain("<ModelSwitchRow<StatusPage>");
    expect(row).not.toContain("updateById");
    expect(row).toContain(
      "return getPlanNeededToChangeColumn(new StatusPage(), column);",
    );
  });
});

describe("the shared switch", () => {
  const row: string = readSource(
    path.join(COMMON_UI, "Components", "ModelSwitch", "ModelSwitchRow.tsx"),
  );

  test("is gated on the column, saves through the API it is given, and announces its saves", () => {
    expect(row).toContain(
      "PermissionGate.checkColumnUpdate( model, props.column, )",
    );
    expect(row).toContain(
      "const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;",
    );
    expect(row).toContain("announceModelSwitchSaved({");
    expect(row).toContain("subscribeToModelSwitchSaved({");
  });
});

describe("the old wording is gone from the dashboard", () => {
  const sources: Array<string> = listSources(DASHBOARD_SRC);

  test.each([
    "Disable Active Monitoring",
    "To enable active monitoring, please go to Settings.",
    "Disable Global Probes on New Monitors",
    "Toggle to enable or disable the automatic addition of Global Probes to new monitors.",
  ])("%s", (text: string) => {
    // In code: the comments that say what was replaced may name it.
    const using: Array<string> = sources
      .filter((file: string): boolean => {
        return readSource(file).includes(text);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(using).toEqual([]);
  });
});

describe("translations", () => {
  const strings: Array<string> = [
    MonitoringSwitchCopy.cardDescription,
    MonitoringSwitchCopy.switchTitle,
    MonitoringSwitchCopy.switchOnDescription,
    MonitoringSwitchCopy.offDescription,
    MonitoringSwitchCopy.bannerTitle,
    MonitoringSwitchCopy.turnOnButton,
    MonitoringSwitchCopy.turnOffConfirmTitle,
    MonitoringSwitchCopy.turnOffConfirmDescription,
    MonitoringSwitchCopy.turnOffConfirmButton,
    GlobalProbesOnNewMonitorsCopy.cardDescription,
    GlobalProbesOnNewMonitorsCopy.switchTitle,
    GlobalProbesOnNewMonitorsCopy.switchOnDescription,
    GlobalProbesOnNewMonitorsCopy.switchOffDescription,
    GlobalProbesOnNewMonitorsCopy.note,
  ];

  // Names every locale already had.
  const names: Array<string> = [
    MonitoringSwitchCopy.cardTitle,
    GlobalProbesOnNewMonitorsCopy.cardTitle,
    "Embedded Status Badge",
    "Enable Embedded Status Badge",
    "MCP Server",
    "Enable MCP Server",
    "Saved",
    "Saving…",
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...strings, ...names]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every new string",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }
    },
  );
});
