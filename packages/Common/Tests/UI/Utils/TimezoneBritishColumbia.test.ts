/** @timezone UTC */

import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import Timezone from "../../../Types/Timezone";
import TimezoneUtil from "../../../UI/Utils/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE TIME ZONE PICKER SAID "GMT-8 America/Vancouver" (issue #9999).
 *
 * Every time zone picker - User Settings, an on-call schedule and its
 * layers, a status page's subscribers and reports, an SLO, a runbook's
 * schedule, the workspace summaries, the clock widget - labels each zone
 * with its offset now, from moment-timezone's bundled data. With tzdata
 * 2024b, British Columbia fell back to UTC-8 on 2026-11-01, so a customer
 * in Vancouver, on UTC-7 all year since March 2026, read "GMT-8
 * America/Vancouver". With 2026b or later it is "GMT-7", listed with the
 * other UTC-7 zones, and Canada/Pacific, a value saved before the picker
 * stopped offering legacy names, still selects it.
 */

function optionsAt(now: string): Array<DropdownOption> {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));

  return TimezoneUtil.getTimezoneDropdownOptions();
}

function optionOf(
  options: Array<DropdownOption>,
  timezone: Timezone,
): DropdownOption | undefined {
  return options.find((option: DropdownOption): boolean => {
    return option.value === timezone;
  });
}

function positionOf(
  options: Array<DropdownOption>,
  timezone: Timezone,
): number {
  return options.findIndex((option: DropdownOption): boolean => {
    return option.value === timezone;
  });
}

// A picker label's offset and the space after it: "GMT-7 ", "GMT+5:30 ".
const PICKER_LABEL: RegExp = /^GMT([+-])(\d+)(?::(\d+))? /;

// The offset in minutes a label names: "GMT-7 ..." is -420, "GMT+5:30 ..." 330.
function offsetOfLabel(label: string): number {
  const match: RegExpExecArray | null = PICKER_LABEL.exec(label);

  if (!match) {
    throw new Error(`Not a picker label: ${label}`);
  }

  const minutes: number = Number(match[2]) * 60 + Number(match[3] || 0);

  return match[1] === "-" ? -minutes : minutes;
}

afterEach(() => {
  jest.useRealTimers();
});

describe("the time zone picker on 2026-11-19, after British Columbia stayed on UTC-7", () => {
  const NOW: string = "2026-11-19T12:00:00.000Z";

  test("labels America/Vancouver GMT-7", () => {
    const vancouver: DropdownOption | undefined = optionOf(
      optionsAt(NOW),
      Timezone.AmericaVancouver,
    );

    expect(vancouver?.label).toBe("GMT-7 America/Vancouver");
  });

  test("still selects America/Vancouver for a saved Canada/Pacific, and does not offer Canada/Pacific", () => {
    const options: Array<DropdownOption> = optionsAt(NOW);

    expect(optionOf(options, Timezone.AmericaVancouver)?.aliases).toContain(
      Timezone.CanadaPacific,
    );
    expect(optionOf(options, Timezone.CanadaPacific)).toBeUndefined();
  });

  test("labels Los Angeles and Tijuana GMT-8: they fell back on 2026-11-01", () => {
    const options: Array<DropdownOption> = optionsAt(NOW);

    expect(optionOf(options, Timezone.AmericaLos_Angeles)?.label).toBe(
      "GMT-8 America/Los_Angeles",
    );
    expect(optionOf(options, Timezone.AmericaTijuana)?.label).toBe(
      "GMT-8 America/Tijuana",
    );
  });

  test("lists Vancouver with the other UTC-7 zones, after every UTC-8 zone", () => {
    const options: Array<DropdownOption> = optionsAt(NOW);
    const vancouver: number = positionOf(options, Timezone.AmericaVancouver);

    // Whitehorse (Yukon) and Phoenix have been on UTC-7 all year for years.
    for (const utcMinusSeven of [
      Timezone.AmericaWhitehorse,
      Timezone.AmericaPhoenix,
    ]) {
      expect(optionOf(options, utcMinusSeven)?.label).toBe(
        `GMT-7 ${utcMinusSeven}`,
      );
    }

    expect(vancouver).toBeGreaterThan(
      positionOf(options, Timezone.AmericaLos_Angeles),
    );
    expect(vancouver).toBeGreaterThan(
      positionOf(options, Timezone.AmericaTijuana),
    );

    const offsets: Array<number> = options.map(
      (option: DropdownOption): number => {
        return offsetOfLabel(String(option.label));
      },
    );

    // Nothing before Vancouver is east of UTC-7, nothing after it is west.
    expect(offsets[vancouver]).toBe(-7 * 60);
    expect(
      offsets.slice(0, vancouver).every((offset: number): boolean => {
        return offset <= -7 * 60;
      }),
    ).toBe(true);
    expect(
      offsets.slice(vancouver).every((offset: number): boolean => {
        return offset >= -7 * 60;
      }),
    ).toBe(true);
    // And every UTC-8 zone is before it.
    expect(
      offsets.slice(vancouver).some((offset: number): boolean => {
        return offset === -8 * 60;
      }),
    ).toBe(false);
  });
});

describe("the time zone picker in the summers either side of the change", () => {
  test.each(["2026-07-15T12:00:00.000Z", "2027-07-15T12:00:00.000Z"])(
    "on %s labels Vancouver GMT-7, and Los Angeles GMT-7 too",
    (now: string) => {
      const options: Array<DropdownOption> = optionsAt(now);

      expect(optionOf(options, Timezone.AmericaVancouver)?.label).toBe(
        "GMT-7 America/Vancouver",
      );
      expect(optionOf(options, Timezone.AmericaLos_Angeles)?.label).toBe(
        "GMT-7 America/Los_Angeles",
      );
    },
  );

  test("in January 2027 labels Vancouver GMT-7, where it was GMT-8 in January 2026", () => {
    expect(
      optionOf(optionsAt("2026-01-15T12:00:00.000Z"), Timezone.AmericaVancouver)
        ?.label,
    ).toBe("GMT-8 America/Vancouver");
    expect(
      optionOf(optionsAt("2027-01-15T12:00:00.000Z"), Timezone.AmericaVancouver)
        ?.label,
    ).toBe("GMT-7 America/Vancouver");
  });
});
