/** @timezone UTC */

import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import TimezoneUtil from "../../../UI/Utils/Timezone";

describe("TimezoneUtil", () => {
  describe("getTimezoneDropdownOptions", () => {
    it("offers a substantial list rather than an empty one", () => {
      expect(TimezoneUtil.getTimezoneDropdownOptions().length).toBeGreaterThan(
        100,
      );
    });

    it("offers only zones moment can actually resolve to a wall clock", () => {
      /*
       * These options feed the on-call rotation engine, SLO windows and the
       * user's own profile — a zone that cannot be resolved silently
       * mis-schedules people, so none may be offered.
       */
      for (const option of TimezoneUtil.getTimezoneDropdownOptions()) {
        expect(Moment.tz.zone(String(option.value))).toBeTruthy();
      }
    });

    it("drops US/Pacific-New, which the tzdb removed in 2020", () => {
      const values: Array<string> =
        TimezoneUtil.getTimezoneDropdownOptions().map(
          (option: DropdownOption): string => {
            return String(option.value);
          },
        );

      expect(Object.values(Timezone) as Array<string>).toContain(
        "US/Pacific-New",
      );
      expect(values).not.toContain("US/Pacific-New");
    });

    it("keeps every zone the tzdb still knows about", () => {
      const values: Array<string> =
        TimezoneUtil.getTimezoneDropdownOptions().map(
          (option: DropdownOption): string => {
            return String(option.value);
          },
        );

      const resolvable: Array<string> = (
        Object.values(Timezone) as Array<string>
      ).filter((timezone: string): boolean => {
        return Boolean(Moment.tz.zone(timezone));
      });

      expect(values.sort()).toEqual(resolvable.sort());
    });

    it("never emits an empty value", () => {
      for (const option of TimezoneUtil.getTimezoneDropdownOptions()) {
        expect(String(option.value).length).toBeGreaterThan(0);
      }
    });

    it("labels every option with its GMT offset and zone name", () => {
      for (const option of TimezoneUtil.getTimezoneDropdownOptions()) {
        expect(String(option.label)).toMatch(/^GMT[+-]\d/);
        expect(String(option.label)).toContain(String(option.value));
      }
    });

    it("orders the list west to east by GMT offset", () => {
      const offsets: Array<number> =
        TimezoneUtil.getTimezoneDropdownOptions().map(
          (option: DropdownOption): number => {
            return OneUptimeDate.getGmtOffsetByTimezone(
              String(option.value) as Timezone,
            );
          },
        );

      for (let index: number = 1; index < offsets.length; index++) {
        expect(offsets[index]!).toBeGreaterThanOrEqual(offsets[index - 1]!);
      }
    });
  });
});
