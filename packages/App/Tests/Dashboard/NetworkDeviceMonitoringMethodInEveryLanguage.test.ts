import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  MONITORING_METHOD_FIELD_DESCRIPTION,
  MONITORING_METHOD_OPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";
import { PROBE_WORDS } from "./ProbeWords";

/*
 * A NETWORK DEVICE'S MONITORING METHOD, IN EVERY LANGUAGE (#8308).
 *
 * A device's Settings page offers two monitoring methods: Probe (the probe
 * pings it, and walks it over SNMP once it has credentials) and Bound
 * monitor (an existing monitor's status is the device's). The device's
 * details card says which one it uses, and two sentences name them: the
 * picker's description ("Probe is the normal choice ... Pick Bound monitor
 * only when no probe can reach it.") and the polling card's, for a device
 * on a bound monitor ("... Switch to Probe above to have a probe ping it.").
 *
 * In twelve languages (da, fr, hi, it, ko, nl, no, pt, ru, sv, zh-CN,
 * zh-TW) the options and the details card's words were left in English, so
 * a Danish picker read "Probe — pinged by the assigned probe ..." under a
 * Danish form, and its sentences kept the English names to match it
 * ("Skift til Probe ovenfor, så en sonde pinger den").
 *
 * Now every language words them, and:
 *
 *   - the Probe option is named by the Dashboard's word for a probe (its
 *     "Probe" key: Sonde, 探测器, پراب), in the picker and on the card;
 *   - the card names the Bound monitor option as the picker does;
 *   - both sentences name the options as the picker draws them, so a
 *     reader told to "switch to Sonde" finds an option called Sonde.
 */

const SETTINGS_PAGE: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Settings.tsx",
);

// The details card's words for each method (Settings.tsx, "Monitoring Method").
const LISTED_PROBE: string =
  "Probe — pinged by the assigned probe; walked over SNMP when credentials are set";
const LISTED_BOUND_MONITOR: string =
  "Bound monitor — the bound monitor's status is this device's status";

// The polling card's description for a device on a bound monitor.
const SWITCH_TO_PROBE: string =
  "This device is a bound-monitor override: nothing polls it. Switch to Probe above to have a probe ping it.";

// The picker's title, its placeholder, and the card row's title.
const FIELD_TITLE: string = "Monitoring Method";
const FIELD_PLACEHOLDER: string = "Monitoring method";

// What an option explains after its name: " — ..." (": ..." in Spanish).
const EXPLANATION_START: RegExp = /\s*[—–]\s*|:\s+/;

// The options' English names, which no other language's words may keep.
const ENGLISH_NAMES: RegExp = /\bProbe\b|Bound monitor|bound-monitor/;

function optionOf(method: NetworkDeviceMonitoringMethod): DropdownOption {
  const option: DropdownOption | undefined = MONITORING_METHOD_OPTIONS.find(
    (candidate: DropdownOption): boolean => {
      return candidate.value === method;
    },
  );

  if (!option) {
    throw new Error(`No ${method} option`);
  }

  return option;
}

const PICKED_PROBE: string = optionOf(NetworkDeviceMonitoringMethod.Probe)
  .label as string;
const PICKED_BOUND_MONITOR: string = optionOf(
  NetworkDeviceMonitoringMethod.Monitor,
).label as string;

const EVERY_KEY: ReadonlyArray<string> = [
  PICKED_PROBE,
  PICKED_BOUND_MONITOR,
  LISTED_PROBE,
  LISTED_BOUND_MONITOR,
  FIELD_TITLE,
  FIELD_PLACEHOLDER,
  MONITORING_METHOD_FIELD_DESCRIPTION,
  SWITCH_TO_PROBE,
];

// A key as a language words it, or its English where the language has none.
function worded(language: string, key: string): string {
  return readDashboardLocale(language)[key] || key;
}

// The name an option is known by: its words before the explanation.
function nameOf(text: string): string {
  return (text.split(EXPLANATION_START)[0] as string).trim();
}

describe("the words this test reads", () => {
  test("are the picker's options, in the order it offers them", () => {
    expect(
      MONITORING_METHOD_OPTIONS.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([
      NetworkDeviceMonitoringMethod.Probe,
      NetworkDeviceMonitoringMethod.Monitor,
    ]);
    expect(PICKED_PROBE).toBe(
      "Probe — pinged by the assigned probe on its schedule; walked over SNMP when credentials are set",
    );
    expect(PICKED_BOUND_MONITOR).toBe(
      "Bound monitor — an existing monitor's status is this device's status (override)",
    );
  });

  test("are the ones the Settings page draws", () => {
    const page: string = fs.readFileSync(SETTINGS_PAGE, "utf8");

    expect(page).toContain("dropdownOptions: MONITORING_METHOD_OPTIONS");
    expect(page).toContain(`title: "${FIELD_TITLE}"`);
    expect(page).toContain(`placeholder: "${FIELD_PLACEHOLDER}"`);
    expect(page).toContain(`"${LISTED_PROBE}"`);
    expect(page).toContain(`"${LISTED_BOUND_MONITOR}"`);
    expect(page).toContain(`"${SWITCH_TO_PROBE}"`);
  });

  test("name the options in English as the picker draws them", () => {
    expect(nameOf(PICKED_PROBE)).toBe("Probe");
    expect(nameOf(PICKED_BOUND_MONITOR)).toBe("Bound monitor");
    expect(nameOf(LISTED_PROBE)).toBe("Probe");
    expect(nameOf(LISTED_BOUND_MONITOR)).toBe("Bound monitor");
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).toMatch(/^Probe is /);
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).toContain("Pick Bound monitor");
    expect(SWITCH_TO_PROBE).toContain("Switch to Probe above");
  });

  test("read an option's name before its dash, or before Spanish's colon", () => {
    expect(nameOf("Sonde — pinges af den tildelte sonde")).toBe("Sonde");
    expect(nameOf("Sonda: la sonda asignada le hace ping")).toBe("Sonda");
    expect(nameOf("探测器 — 由分配的探测器按计划 ping")).toBe("探测器");
    expect(nameOf("Gebundener Monitor")).toBe("Gebundener Monitor");
  });
});

describe("a network device's monitoring method", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "is worded in %s: its options, the card's words, the title and both sentences",
    (language: string) => {
      expect(
        EVERY_KEY.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s names the Probe option by its word for a probe, in the picker and on the card",
    (language: string) => {
      const probe: string = worded(language, "Probe");

      expect(probe).not.toBe("Probe");
      expect(nameOf(worded(language, PICKED_PROBE))).toBe(probe);
      expect(nameOf(worded(language, LISTED_PROBE))).toBe(probe);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s's card names the Bound monitor option as the picker does",
    (language: string) => {
      const picked: string = nameOf(worded(language, PICKED_BOUND_MONITOR));

      expect(picked).not.toBe("Bound monitor");
      expect(nameOf(worded(language, LISTED_BOUND_MONITOR))).toBe(picked);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s's description names both options as the picker draws them",
    (language: string) => {
      const sentence: string = worded(
        language,
        MONITORING_METHOD_FIELD_DESCRIPTION,
      );

      expect(sentence).toContain(nameOf(worded(language, PICKED_PROBE)));
      expect(sentence).toContain(
        nameOf(worded(language, PICKED_BOUND_MONITOR)),
      );
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s tells a device on a bound monitor to switch to the Probe option as drawn",
    (language: string) => {
      expect(worded(language, SWITCH_TO_PROBE)).toContain(
        nameOf(worded(language, PICKED_PROBE)),
      );
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps neither English name in its words",
    (language: string) => {
      expect(
        EVERY_KEY.map((key: string): string => {
          return worded(language, key);
        }).filter((text: string): boolean => {
          return ENGLISH_NAMES.test(text);
        }),
      ).toEqual([]);
    },
  );

  /*
   * ProbeWordPerLanguage holds these languages to their word for a probe.
   * It kept "Skift til Probe ovenfor" and nine more phrases only because
   * the option was drawn in English (#8308): with none kept, the sentences
   * say the word themselves.
   */
  test.each(Object.keys(PROBE_WORDS))(
    "%s's sentences say its word for a probe, with no phrase kept for the option",
    (language: string) => {
      const others: RegExp = PROBE_WORDS[language]!.others;

      for (const key of [
        MONITORING_METHOD_FIELD_DESCRIPTION,
        SWITCH_TO_PROBE,
      ]) {
        expect([key, others.test(worded(language, key))]).toEqual([key, false]);
      }

      for (const kept of PROBE_WORDS[language]!.keptPhrases) {
        expect(kept.why).not.toMatch(/draws in English/);
      }
    },
  );

  test.each([
    ["da", "Sonde", "Bundet monitor", "Skift til Sonde ovenfor"],
    ["nl", "Sonde", "Gekoppelde monitor", "naar Sonde om"],
    ["no", "Sonde", "Bundet monitor", "Bytt til Sonde ovenfor"],
    ["sv", "Sond", "Bunden monitor", "Byt till Sond ovan"],
    ["it", "Sonda", "Monitor associato", "Passa a Sonda qui sopra"],
    ["pt", "Sonda", "Monitor vinculado", "Mude para Sonda acima"],
    ["fr", "Sonde", "Moniteur lié", "Passez à Sonde ci-dessus"],
    ["ru", "Зонд", "Привязанный монитор", "Переключитесь выше на «Зонд»"],
    ["hi", "प्रोब", "बाँधा गया मॉनिटर", "ऊपर प्रोब पर स्विच"],
    ["ko", "프로브", "바인딩된 모니터", "위에서 프로브로 바꾸세요"],
    ["zh-CN", "探测器", "绑定的监视器", "在上方切换到探测器"],
    ["zh-TW", "探測器", "綁定的監測器", "在上方切換到探測器"],
    ["de", "Sonde", "Gebundener Monitor", "Wechseln Sie oben zu Sonde"],
    ["fa", "پراب", "مانیتور متصل", "در بالا به پراب تغییر دهید"],
    ["ar", "المسبار", "مراقبة مرتبطة", "بدّل إلى «المسبار» أعلاه"],
  ])(
    "%s offers %p and %p, and its card says %p",
    (language: string, probe: string, bound: string, switchTo: string) => {
      expect(nameOf(worded(language, PICKED_PROBE))).toBe(probe);
      expect(nameOf(worded(language, PICKED_BOUND_MONITOR))).toBe(bound);
      expect(worded(language, SWITCH_TO_PROBE)).toContain(switchTo);
    },
  );
});
