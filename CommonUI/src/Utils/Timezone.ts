import Timezone from "Common/Types/Timezone";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
import OneUptimeDate from "Common/Types/Date";

export default class TimezoneUtil {
  public static getTimezoneDropdownOptions(): DropdownOption[] {
    let timezoneOptions: Array<string> = Object.keys(Timezone);

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
          ? (Timezone[keyOfTimezone].toString())
          : "";

      return {
        value: value,
        label:
          OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
            Timezone[keyOfTimezone],
          )
      };
    });
  }
}
