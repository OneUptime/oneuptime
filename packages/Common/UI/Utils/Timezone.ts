import Timezone from "../../Types/Timezone";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
import OneUptimeDate, { Moment } from "../../Types/Date";

export default class TimezoneUtil {
  public static getTimezoneDropdownOptions(): DropdownOption[] {
    /*
     * The Timezone enum outlives the tzdb, so it can still list a zone the
     * bundled moment-timezone has since dropped ("US/Pacific-New", removed in
     * tzdata 2020b). Offering one is a trap: every consumer of the choice —
     * the on-call rotation engine, the SLO windows, this user's own profile —
     * then holds a zone that cannot be resolved to a wall clock. Filter them
     * out at the source rather than leave each caller to discover it.
     */
    let timezoneOptions: Array<string> = Object.keys(Timezone).filter(
      (key: string): boolean => {
        const timezone: Timezone = Timezone[key as keyof typeof Timezone];

        return (
          Boolean(timezone) && Boolean(Moment.tz.zone(timezone.toString()))
        );
      },
    );

    // order timezone by GMT offset.

    timezoneOptions = timezoneOptions.sort((a: string, b: string) => {
      const keyOfTimezoneA: keyof typeof Timezone = a as keyof typeof Timezone;
      const keyOfTimezoneB: keyof typeof Timezone = b as keyof typeof Timezone;

      return (
        OneUptimeDate.getGmtOffsetByTimezone(Timezone[keyOfTimezoneA]) -
        OneUptimeDate.getGmtOffsetByTimezone(Timezone[keyOfTimezoneB])
      );
    });

    return timezoneOptions.map((key: string) => {
      const keyOfTimezone: keyof typeof Timezone = key as keyof typeof Timezone;

      const value: string =
        Timezone && Timezone[keyOfTimezone]
          ? Timezone[keyOfTimezone].toString()
          : "";

      return {
        value: value,
        label: OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
          Timezone[keyOfTimezone],
        ),
      };
    });
  }
}
