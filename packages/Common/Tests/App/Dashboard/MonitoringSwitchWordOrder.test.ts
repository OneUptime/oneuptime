import { describe, expect, test } from "@jest/globals";
import MonitoringSwitchCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import MonitorGroupMonitoringCopy from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCopy";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ONE SWITCH, SAID ONE WAY (#6988).
 *
 * A monitor group's Monitoring card drew its two buttons side by side as
 * "Turn monitoring on" and "Turn off monitoring": one switch, said two ways,
 * in two word orders. A monitor's own switch said "Turn monitoring on" on
 * its banner and "Turn off monitoring?" in its dialog. Every place that
 * turns monitoring on or off - the group's card and its dialog, a monitor's
 * Monitoring card, its Disabled banner and its dialog, the Monitors list's
 * Disable - now says "Turn monitoring on" and "Turn monitoring off".
 *
 * Only the English differed: each language already said the two alike
 * (German "Überwachung einschalten" / "ausschalten"), so each kept its
 * words under the new keys, and the old keys are gone.
 */

const TURN_ON_OR_OFF: RegExp = /\bturn\b.*\b(on|off)\b/i;

// The one word order: "Turn monitoring on", "Turn monitoring off ...".
const ONE_WORD_ORDER: RegExp = /^Turn monitoring (on|off)\b/;

// The words that said it the other way round.
const OLD_KEYS: ReadonlyArray<string> = [
  "Turn off monitoring",
  "Turn off monitoring?",
  "Turn off monitoring for this group?",
];

// Every word of the two copies that turns monitoring on or off.
function switchWords(): Array<string> {
  return [
    ...Object.values(MonitoringSwitchCopy),
    ...Object.values(MonitorGroupMonitoringCopy),
  ].filter((text: string): boolean => {
    return TURN_ON_OR_OFF.test(text) && /monitoring/i.test(text);
  });
}

describe("turning monitoring on and off", () => {
  test("every button, title and dialog says it in one word order", () => {
    const words: Array<string> = switchWords();

    // The card's description says both: "Turn monitoring off or on ...".
    expect(words).toEqual(
      expect.arrayContaining([
        MonitoringSwitchCopy.turnOnButton,
        MonitoringSwitchCopy.turnOffConfirmTitle,
        MonitoringSwitchCopy.turnOffConfirmButton,
        MonitorGroupMonitoringCopy.turnOnButton,
        MonitorGroupMonitoringCopy.turnOffButton,
        MonitorGroupMonitoringCopy.turnOffConfirmTitle,
      ]),
    );

    expect(
      words.filter((text: string): boolean => {
        return !ONE_WORD_ORDER.test(text);
      }),
    ).toEqual([]);
  });

  test("the group's two buttons and a monitor's say the same words", () => {
    expect(MonitorGroupMonitoringCopy.turnOnButton).toBe("Turn monitoring on");
    expect(MonitorGroupMonitoringCopy.turnOffButton).toBe(
      "Turn monitoring off",
    );
    expect(MonitoringSwitchCopy.turnOnButton).toBe(
      MonitorGroupMonitoringCopy.turnOnButton,
    );
    expect(MonitoringSwitchCopy.turnOffConfirmButton).toBe(
      MonitorGroupMonitoringCopy.turnOffButton,
    );
    expect(MonitoringSwitchCopy.turnOffConfirmTitle).toBe(
      "Turn monitoring off?",
    );
    expect(MonitorGroupMonitoringCopy.turnOffConfirmTitle).toBe(
      "Turn monitoring off for this group?",
    );
  });

  test("the pattern finds the word order it replaced", () => {
    for (const old of OLD_KEYS) {
      expect(old).not.toMatch(ONE_WORD_ORDER);
      expect(old).toMatch(TURN_ON_OR_OFF);
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)(
  "turning monitoring on and off in %s",
  (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    test("every new key is worded, and no old key is left", () => {
      for (const key of switchWords()) {
        expect({ key, worded: Boolean(words[key]) }).toEqual({
          key,
          worded: true,
        });
      }

      for (const old of OLD_KEYS) {
        expect({ old, present: old in words }).toEqual({
          old,
          present: false,
        });
      }
    });

    test("on and off are two different words", () => {
      expect(words["Turn monitoring on"]).toBeTruthy();
      expect(words["Turn monitoring off"]).toBeTruthy();
      expect(words["Turn monitoring on"]).not.toBe(
        words["Turn monitoring off"],
      );
    });
  },
);
