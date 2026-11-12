import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import MonitoringSwitchCopy from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import fs from "fs";
import path from "path";

/*
 * OPEN MONITOR NAMES THE MONITOR, NOT MONITORING (#6965's UI review).
 *
 * A device whose bound monitor has its monitoring turned off offers two
 * links in its hero's Monitor Status tile, one under the other: Turn
 * monitoring on, and Open monitor. German, Danish, Norwegian and Swedish
 * worded the second as "open monitoring" (Überwachung öffnen, Åbn
 * overvågning, Åpne overvåking, Öppna övervakning), so the tile read as two
 * actions on one thing. Every language here words Open monitor with its
 * noun for a monitor, never with the word its Turn monitoring on uses for
 * monitoring.
 */

const OPEN_MONITOR: string = "Open monitor";

// The word each language's Turn monitoring on uses for monitoring.
const MONITORING_WORD: Record<string, string> = {
  da: "overvågning",
  de: "Überwachung",
  es: "monitoreo",
  fa: "پایش",
  fr: "surveillance",
  hi: "निगरानी",
  it: "monitoraggio",
  ja: "監視",
  ko: "모니터링",
  nl: "bewaking",
  no: "overvåking",
  pt: "monitoramento",
  ru: "мониторинг",
  sv: "övervakning",
  "zh-CN": "监控",
};

/*
 * The languages this cannot be asked of, and why: the two links still
 * differ there, by their verbs.
 */
const SAME_WORD_FOR_BOTH: Record<string, string> = {
  ar: "the Dashboard words a monitor and monitoring alike, المراقبة, throughout",
  "zh-TW":
    "a monitor, 監測器, is its word for monitoring, 監測, with 器 (device) after it",
};

describe("Open monitor, under Turn monitoring on in the device hero", () => {
  test("the hero draws the two links together, from these keys", () => {
    const hero: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero.tsx",
      ),
      "utf8",
    );

    expect(MonitoringSwitchCopy.turnOnButton).toBe("Turn monitoring on");
    expect(hero).toContain("title={MonitoringSwitchCopy.turnOnButton}");
    expect(hero).toContain(`translator.translateText("${OPEN_MONITOR}")`);
  });

  test("every Dashboard language is asked, or says why it cannot be", () => {
    expect(
      [...Object.keys(MONITORING_WORD), ...Object.keys(SAME_WORD_FOR_BOTH)]
        .slice()
        .sort(),
    ).toEqual([...DASHBOARD_LANGUAGES].sort());
  });

  test.each(Object.keys(MONITORING_WORD))(
    "%s words Open monitor with its noun for a monitor, not its word for monitoring",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const monitoring: string = MONITORING_WORD[language]!.toLowerCase();

      // The word is the one Turn monitoring on uses, so the list stays true.
      expect(words[MonitoringSwitchCopy.turnOnButton]!.toLowerCase()).toContain(
        monitoring,
      );
      expect(words[OPEN_MONITOR]).toBeTruthy();
      expect(words[OPEN_MONITOR]!.toLowerCase()).not.toContain(monitoring);
    },
  );

  test("German, Danish, Norwegian and Swedish open the monitor", () => {
    expect(readDashboardLocale("de")[OPEN_MONITOR]).toBe("Monitor öffnen");
    expect(readDashboardLocale("da")[OPEN_MONITOR]).toBe("Åbn monitor");
    expect(readDashboardLocale("no")[OPEN_MONITOR]).toBe("Åpne monitor");
    expect(readDashboardLocale("sv")[OPEN_MONITOR]).toBe("Öppna monitor");
  });
});
