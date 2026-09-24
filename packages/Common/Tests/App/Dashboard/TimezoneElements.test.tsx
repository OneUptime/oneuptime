/** @timezone UTC */

import "@testing-library/jest-dom";
import { cleanup, render, RenderResult } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";
import TimezoneElement from "../../../../App/FeatureSet/Dashboard/src/Components/Timezone/TimezoneElement";
import TimezonesElement from "../../../../App/FeatureSet/Dashboard/src/Components/Timezone/TimezonesElement";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";

/*
 * TimezoneElement and TimezonesElement are how a stored timezone is shown
 * read-only: a user's profile, an on-call schedule, a status page's
 * subscriber timezones. The value they are given is whatever was stored,
 * and stored values are never rewritten — so it can be a legacy tz name
 * ("Singapore", "US/Pacific", "Asia/Calcutta") the pickers no longer offer.
 *
 * Shown as given, a profile saved as "Singapore" would read "GMT+8
 * Singapore" here while its edit form shows "GMT+8 Asia/Singapore"; one
 * saved as "US/Pacific-New", which tzdata dropped, would read "GMT+0
 * US/Pacific-New", because moment has no data for it and falls back to UTC.
 * Both components show the current name instead, and the list shows each
 * zone once.
 *
 * The clock is frozen in a northern-hemisphere summer so that labels of
 * daylight-saving zones are fixed. Expected labels are still computed with
 * OneUptimeDate wherever the exact offset is not the point.
 */

const FROZEN_NOW: string = "2026-07-15T12:00:00.000Z";

const labelOf: (timezone: Timezone) => string = (
  timezone: Timezone,
): string => {
  return OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(timezone);
};

const getLines: (container: HTMLElement) => Array<string> = (
  container: HTMLElement,
): Array<string> => {
  return Array.from(container.querySelectorAll("p")).map(
    (line: HTMLParagraphElement): string => {
      return line.textContent || "";
    },
  );
};

const renderTimezone: (timezone: Timezone | string) => RenderResult = (
  timezone: Timezone | string,
): RenderResult => {
  return render(<TimezoneElement timezone={timezone as Timezone} />);
};

const renderTimezones: (timezones: Array<Timezone | string>) => RenderResult = (
  timezones: Array<Timezone | string>,
): RenderResult => {
  return render(<TimezonesElement timezones={timezones as Array<Timezone>} />);
};

const DUPLICATE_KEY_WARNING: string =
  "Encountered two children with the same key";

describe("Timezone display elements", () => {
  let consoleErrorSpy: SpyInstance<typeof console.error>;

  /*
   * Only React's duplicate-key warning, not everything on console.error:
   * Testing Library's own one-off deprecation notice lands there too, on
   * whichever test happens to render first.
   */
  const getDuplicateKeyWarnings: () => Array<string> = (): Array<string> => {
    return consoleErrorSpy.mock.calls
      .map((call: Array<unknown>): string => {
        return call.map(String).join(" ");
      })
      .filter((message: string): boolean => {
        return message.includes(DUPLICATE_KEY_WARNING);
      });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FROZEN_NOW));

    // Captured, not printed: a duplicate React key is reported here.
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {
        return undefined;
      });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("TimezoneElement", () => {
    test('shows "Singapore" under its current name, as the edit form does', () => {
      const { container } = renderTimezone("Singapore");

      expect(getLines(container)).toEqual(["GMT+8 Asia/Singapore"]);
      expect(getLines(container)).toEqual([labelOf(Timezone.AsiaSingapore)]);
    });

    test("shows US/Pacific-New, which moment cannot resolve, as Los Angeles rather than GMT+0", () => {
      const { container } = renderTimezone("US/Pacific-New");

      // July: Los Angeles is on daylight-saving time.
      expect(getLines(container)).toEqual(["GMT-7 America/Los_Angeles"]);
      expect(getLines(container)).toEqual([
        labelOf(Timezone.AmericaLos_Angeles),
      ]);
      expect(container.textContent).not.toContain("GMT+0");
      expect(container.textContent).not.toContain("US/Pacific-New");
    });

    test.each([
      ["US/Pacific", Timezone.AmericaLos_Angeles],
      ["Asia/Calcutta", Timezone.AsiaKolkata],
      ["Europe/Kiev", Timezone.EuropeKyiv],
      ["GB", Timezone.EuropeLondon],
      ["Etc/UTC", Timezone.UTC],
      ["Zulu", Timezone.UTC],
      ["Etc/Greenwich", Timezone.GMT],
      ["US/Samoa", Timezone.PacificPago_Pago],
    ])(
      "shows the legacy name %s as %s",
      (legacyName: string, currentName: Timezone) => {
        const { container } = renderTimezone(legacyName);

        expect(getLines(container)).toEqual([labelOf(currentName)]);
      },
    );

    test.each([
      Timezone.AsiaSingapore,
      Timezone.AmericaLos_Angeles,
      Timezone.AsiaKuala_Lumpur,
      Timezone.EuropeOslo,
      Timezone.UTC,
      Timezone.GMT,
      Timezone.EtcGMTNegative8,
    ])("shows the current name %s exactly as before", (timezone: Timezone) => {
      const { container } = renderTimezone(timezone);

      expect(getLines(container)).toEqual([labelOf(timezone)]);
    });

    test("shows every Timezone enum value under its current name, never a legacy one", () => {
      const offenders: Array<string> = [];

      for (const timezone of Object.values(Timezone) as Array<Timezone>) {
        const { container, unmount } = renderTimezone(timezone);
        const shown: string = container.textContent || "";
        const expected: string = labelOf(
          TimezoneAlias.getCanonicalTimezone(timezone),
        );

        if (shown !== expected) {
          offenders.push(`${timezone}: "${shown}", expected "${expected}"`);
        }

        unmount();
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("TimezonesElement", () => {
    test("shows a list saved with both Singapore spellings as one line for Singapore", () => {
      const { container } = renderTimezones([
        "Singapore",
        "Asia/Singapore",
        "Asia/Tokyo",
      ]);

      expect(getLines(container)).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
      ]);
    });

    test("renders two spellings of one zone without a duplicate-key warning", () => {
      /*
       * Translated one by one, "Singapore" and "Asia/Singapore" would both
       * be keyed "Asia/Singapore" — React warns about that, and may drop or
       * reuse the wrong element on the next render.
       */
      const { rerender } = renderTimezones([
        "Singapore",
        "Asia/Singapore",
        "Asia/Tokyo",
      ]);

      rerender(
        <TimezonesElement
          timezones={
            ["Asia/Singapore", "Singapore", "Japan"] as Array<Timezone>
          }
        />,
      );

      expect(getDuplicateKeyWarnings()).toEqual([]);
    });

    test("would catch a duplicate key, so the check above is not vacuous", () => {
      // The same list, keyed as it would be without de-duplicating.
      render(
        <div>
          {["Asia/Singapore", "Asia/Singapore"].map(
            (timezone: string, index: number): ReactElement => {
              return <p key={timezone}>{`${timezone} ${index}`}</p>;
            },
          )}
        </div>,
      );

      expect(getDuplicateKeyWarnings()).toHaveLength(1);
      expect(getDuplicateKeyWarnings()[0]).toContain("Asia/Singapore");
    });

    test("keeps the first occurrence's position", () => {
      const { container } = renderTimezones([
        "Asia/Tokyo",
        "Singapore",
        "Etc/UTC",
        "Asia/Singapore",
        "UTC",
        "Japan",
      ]);

      expect(getLines(container)).toEqual([
        labelOf(Timezone.AsiaTokyo),
        labelOf(Timezone.AsiaSingapore),
        labelOf(Timezone.UTC),
      ]);
    });

    test("collapses every spelling of UTC to one line", () => {
      const { container } = renderTimezones([
        "Etc/UTC",
        "Zulu",
        "UTC",
        "UCT",
        "Universal",
        "Etc/Zulu",
      ]);

      expect(getLines(container)).toEqual([labelOf(Timezone.UTC)]);
    });

    test("treats a spelling in another case or with padding as the same zone", () => {
      const { container } = renderTimezones([
        "Asia/Singapore",
        " singapore ",
        "ASIA/SINGAPORE",
      ]);

      expect(getLines(container)).toEqual([labelOf(Timezone.AsiaSingapore)]);
    });

    test("shows a list of distinct current names unchanged and in order", () => {
      const timezones: Array<Timezone> = [
        Timezone.AmericaNew_York,
        Timezone.EuropeLondon,
        Timezone.AsiaKolkata,
        Timezone.AsiaKuala_Lumpur,
        Timezone.AsiaSingapore,
      ];

      const { container } = renderTimezones(timezones);

      expect(getLines(container)).toEqual(timezones.map(labelOf));
    });

    test("keeps two places that merely share a clock as two lines", () => {
      // Kuala Lumpur keeps Singapore's rules, but it is a different place.
      const { container } = renderTimezones([
        Timezone.AsiaSingapore,
        Timezone.AsiaKuala_Lumpur,
      ]);

      expect(getLines(container)).toEqual([
        labelOf(Timezone.AsiaSingapore),
        labelOf(Timezone.AsiaKuala_Lumpur),
      ]);
    });

    test("renders nothing for an empty list", () => {
      const { container } = renderTimezones([]);

      expect(getLines(container)).toEqual([]);
      expect(container.textContent).toBe("");
      expect(container.firstElementChild?.childElementCount).toBe(0);
    });

    test("does not mutate the list it is given", () => {
      const timezones: Array<Timezone> = [
        Timezone.Singapore,
        Timezone.AsiaSingapore,
      ];

      renderTimezones(timezones);

      expect(timezones).toEqual([Timezone.Singapore, Timezone.AsiaSingapore]);
    });
  });
});
