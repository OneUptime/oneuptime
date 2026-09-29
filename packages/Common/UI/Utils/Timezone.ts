import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
import OneUptimeDate, { Moment } from "../../Types/Date";

interface OfferedTimezone {
  timezone: Timezone;
  gmtOffsetInMinutes: number;
}

export default class TimezoneUtil {
  public static getTimezoneDropdownOptions(): DropdownOption[] {
    /*
     * The Timezone enum outlives the tzdb, so it can still list a zone the
     * bundled moment-timezone has since dropped ("US/Pacific-New", removed in
     * tzdata 2020b). Offering one is a trap: every consumer of the choice —
     * the on-call rotation engine, the SLO windows, this user's own profile —
     * then holds a zone that cannot be resolved to a wall clock. Filter them
     * out at the source rather than leave each caller to discover it.
     *
     * Legacy names are left out too. The enum also lists the ~150 names the
     * tzdb keeps only so old configurations keep working — "Singapore" for
     * Asia/Singapore, "US/Pacific" for America/Los_Angeles, "Asia/Calcutta"
     * for Asia/Kolkata, seven more spellings of UTC — and offering them put
     * the same clock in this list more than once ("GMT+8 Asia/Singapore" and
     * "GMT+8 Singapore"). Every legacy name's current name is offered, so no
     * place drops out of the list. Legacy names remain valid stored values:
     * rows, tokens and API callers hold them and every reader still resolves
     * them — they are just never offered. Which names are legacy, and what
     * each one maps to, is decided in one place: Types/TimezoneAlias.ts.
     */
    const offeredTimezones: Array<OfferedTimezone> = (
      Object.values(Timezone) as Array<Timezone>
    )
      .filter((timezone: Timezone): boolean => {
        return (
          Boolean(Moment.tz.zone(timezone)) &&
          !TimezoneAlias.isLegacyName(timezone)
        );
      })
      .map((timezone: Timezone): OfferedTimezone => {
        return {
          timezone: timezone,
          gmtOffsetInMinutes: OneUptimeDate.getGmtOffsetByTimezone(timezone),
        };
      });

    /*
     * West to east by GMT offset, then by name within an offset so the order
     * never depends on how the enum happens to be declared. Each offset is
     * resolved once above: resolving it in the comparator cost two moment.tz()
     * calls per comparison, thousands for one list.
     */
    offeredTimezones.sort((a: OfferedTimezone, b: OfferedTimezone): number => {
      if (a.gmtOffsetInMinutes !== b.gmtOffsetInMinutes) {
        return a.gmtOffsetInMinutes - b.gmtOffsetInMinutes;
      }

      if (a.timezone === b.timezone) {
        return 0;
      }

      return a.timezone < b.timezone ? -1 : 1;
    });

    return offeredTimezones.map(
      (offeredTimezone: OfferedTimezone): DropdownOption => {
        const option: DropdownOption = {
          value: offeredTimezone.timezone,
          label: OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
            offeredTimezone.timezone,
          ),
        };

        /*
         * Stored values are not rewritten, so a profile, schedule or status
         * page saved as "Singapore" still holds it. Listed as an alias, it
         * selects this option instead of leaving the picker empty — and in
         * the subscriber-timezones multi-select, instead of being dropped
         * from the list on the next edit.
         */
        const legacyNames: Array<Timezone> = TimezoneAlias.getLegacyNamesOf(
          offeredTimezone.timezone,
        );

        if (legacyNames.length > 0) {
          option.aliases = legacyNames;
        }

        return option;
      },
    );
  }
}
