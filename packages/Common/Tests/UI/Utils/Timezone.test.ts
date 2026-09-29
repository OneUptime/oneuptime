/** @timezone UTC */

import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias, {
  LEGACY_TIMEZONE_NAMES,
} from "../../../Types/TimezoneAlias";
import TimezoneUtil from "../../../UI/Utils/Timezone";

function getOptions(): Array<DropdownOption> {
  return TimezoneUtil.getTimezoneDropdownOptions();
}

function getOfferedValues(): Array<string> {
  return getOptions().map((option: DropdownOption): string => {
    return String(option.value);
  });
}

function getLabels(): Array<string> {
  return getOptions().map((option: DropdownOption): string => {
    return String(option.label);
  });
}

/*
 * The names tzdata publishes for "programs that let users select a
 * timezone" (zone.tab / zone1970.tab). moment-timezone exposes exactly that
 * set through its country tables.
 */
function getZoneTabNames(): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const country of Moment.tz.countries()) {
    for (const zone of Moment.tz.zonesForCountry(country)) {
      names.add(zone);
    }
  }

  return names;
}

// Etc/GMT+1 ... Etc/GMT-14. Etc/GMT+0 and Etc/GMT-0 are spellings of GMT.
const FIXED_OFFSET_ZONE: RegExp = /^Etc\/GMT[+-][1-9]\d*$/;
const UTC_SPELLING: RegExp = /utc|uct|zulu|universal/i;
const GMT_SPELLING: RegExp = /^(etc\/)?(gmt([+-]?0)?|greenwich)$/i;

function findDuplicates(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const duplicates: Array<string> = [];

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.push(value);
    }

    seen.add(value);
  }

  return duplicates;
}

describe("TimezoneUtil", () => {
  describe("getTimezoneDropdownOptions", () => {
    it("offers a substantial list rather than an empty one", () => {
      expect(getOptions().length).toBeGreaterThan(100);
    });

    it("offers only zones moment can actually resolve to a wall clock", () => {
      /*
       * These options feed the on-call rotation engine, SLO windows and the
       * user's own profile — a zone that cannot be resolved silently
       * mis-schedules people, so none may be offered.
       */
      for (const option of getOptions()) {
        expect(Moment.tz.zone(String(option.value))).toBeTruthy();
      }
    });

    it("drops US/Pacific-New, which the tzdb removed in 2020", () => {
      expect(Object.values(Timezone) as Array<string>).toContain(
        "US/Pacific-New",
      );
      expect(getOfferedValues()).not.toContain("US/Pacific-New");
    });

    it("offers exactly the zones moment resolves, less the legacy names", () => {
      /*
       * Every enum value that is a real clock and is not a
       * backward-compatibility spelling of another one — no more (the
       * duplicates the picker used to show), no less (a place with no entry).
       */
      const expected: Array<string> = (
        Object.values(Timezone) as Array<string>
      ).filter((timezone: string): boolean => {
        return (
          Boolean(Moment.tz.zone(timezone)) &&
          !TimezoneAlias.isLegacyName(timezone)
        );
      });

      expect([...getOfferedValues()].sort()).toEqual([...expected].sort());
    });

    it("never emits an empty value", () => {
      for (const option of getOptions()) {
        expect(String(option.value).length).toBeGreaterThan(0);
      }
    });

    it("labels every option with its GMT offset and zone name", () => {
      for (const option of getOptions()) {
        expect(String(option.label)).toMatch(/^GMT[+-]\d/);
        expect(String(option.label)).toContain(String(option.value));
      }
    });

    it("labels every option exactly as OneUptimeDate formats that zone", () => {
      for (const option of getOptions()) {
        expect(option.label).toBe(
          OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
            option.value as Timezone,
          ),
        );
      }
    });

    it("orders the list west to east by GMT offset", () => {
      const offsets: Array<number> = getOptions().map(
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

    it("orders zones that share an offset by name, so the order is deterministic", () => {
      const options: Array<DropdownOption> = getOptions();
      let tiesCompared: number = 0;

      for (let index: number = 1; index < options.length; index++) {
        const previous: string = String(options[index - 1]!.value);
        const current: string = String(options[index]!.value);

        if (
          OneUptimeDate.getGmtOffsetByTimezone(previous as Timezone) !==
          OneUptimeDate.getGmtOffsetByTimezone(current as Timezone)
        ) {
          continue;
        }

        tiesCompared++;
        expect(previous < current).toBe(true);
      }

      // Most offsets hold many zones; a vacuous pass would prove nothing.
      expect(tiesCompared).toBeGreaterThan(100);
    });

    it("returns the same list, in the same order, every time it is built", () => {
      expect(getOptions()).toEqual(getOptions());
    });

    it("resolves each zone's offset once, not inside the sort comparator", () => {
      /*
       * Building the list used to call moment twice per comparison — some
       * 11,000 zone lookups for one list. Now each offered zone is resolved
       * once for the sort and once more for its label.
       */
      const offsetSpy: jest.SpyInstance = jest.spyOn(
        OneUptimeDate,
        "getGmtOffsetByTimezone",
      );

      try {
        const optionCount: number = getOptions().length;

        expect(offsetSpy.mock.calls.length).toBeLessThanOrEqual(
          optionCount * 2,
        );
      } finally {
        offsetSpy.mockRestore();
      }
    });

    describe.each([
      ["a northern-hemisphere winter", "2026-01-15T12:00:00.000Z"],
      ["a northern-hemisphere summer", "2026-07-15T12:00:00.000Z"],
      ["the day US clocks spring forward", "2026-03-08T12:00:00.000Z"],
    ])("on %s", (_season: string, now: string) => {
      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(now));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("labels each zone with the offset it is sorted by", () => {
        /*
         * Daylight saving moves a zone's offset, and the sort and the label
         * must read the same one — "GMT-7 America/Los_Angeles" belongs among
         * the GMT-7 zones in July, and among the GMT-8 zones in January.
         */
        let previousOffset: number = -Infinity;

        for (const option of getOptions()) {
          const offset: number = OneUptimeDate.getGmtOffsetByTimezone(
            option.value as Timezone,
          );

          expect(String(option.label)).toBe(
            `${OneUptimeDate.getGmtOffsetFriendlyString(offset)} ${String(option.value)}`,
          );
          expect(offset).toBeGreaterThanOrEqual(previousOffset);

          previousOffset = offset;
        }
      });
    });

    it("labels America/Los_Angeles with its daylight-saving offset in July", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));

      try {
        const labels: Array<string> = getLabels();

        expect(labels).toContain("GMT-7 America/Los_Angeles");
        expect(labels).not.toContain("GMT-7 US/Pacific");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("no duplicate timezones", () => {
    it('offers Singapore once: searching "singa" finds only Asia/Singapore', () => {
      /*
       * The reported bug: the picker listed "GMT+8 Asia/Singapore" and
       * "GMT+8 Singapore" — the same clock under its current name and the
       * pre-1993 alias the tzdb keeps for old configurations.
       */
      const matches: Array<DropdownOption> = getOptions().filter(
        (option: DropdownOption): boolean => {
          return String(option.label).toLowerCase().includes("singa");
        },
      );

      expect(
        matches.map((option: DropdownOption): string => {
          return String(option.value);
        }),
      ).toEqual(["Asia/Singapore"]);
      expect(matches[0]!.label).toBe("GMT+8 Asia/Singapore");
    });

    it.each([
      ["calcutta", []],
      ["kolkata", ["Asia/Kolkata"]],
      ["kiev", []],
      ["kyiv", ["Europe/Kyiv"]],
      ["godthab", []],
      ["nuuk", ["America/Nuuk"]],
      ["enderbury", []],
      ["kanton", ["Pacific/Kanton"]],
      ["saigon", []],
      ["ho_chi_minh", ["Asia/Ho_Chi_Minh"]],
      ["us/", []],
      ["zulu", []],
      ["buenos_aires", ["America/Argentina/Buenos_Aires"]],
    ])(
      'searching "%s" finds only %j',
      (search: string, expected: Array<string>) => {
        const matches: Array<string> = getOptions()
          .filter((option: DropdownOption): boolean => {
            return String(option.label).toLowerCase().includes(search);
          })
          .map((option: DropdownOption): string => {
            return String(option.value);
          });

        expect(matches).toEqual(expected);
      },
    );

    it("offers every UTC spelling as the single entry UTC", () => {
      const utcLike: Array<string> = getOfferedValues().filter(
        (value: string): boolean => {
          return UTC_SPELLING.test(value);
        },
      );

      expect(utcLike).toEqual(["UTC"]);
    });

    it("offers every GMT spelling as the single entry GMT", () => {
      const gmtLike: Array<string> = getOfferedValues().filter(
        (value: string): boolean => {
          return GMT_SPELLING.test(value);
        },
      );

      expect(gmtLike).toEqual(["GMT"]);
    });

    it("never offers the same value twice", () => {
      expect(findDuplicates(getOfferedValues())).toEqual([]);
    });

    it("never offers the same value twice, even ignoring case", () => {
      expect(
        findDuplicates(
          getOfferedValues().map((value: string): string => {
            return value.toLowerCase();
          }),
        ),
      ).toEqual([]);
    });

    it("never shows the same label twice", () => {
      expect(findDuplicates(getLabels())).toEqual([]);
    });

    it("offers no legacy name", () => {
      const legacyOffered: Array<string> = getOfferedValues().filter(
        (value: string): boolean => {
          return TimezoneAlias.isLegacyName(value);
        },
      );

      expect(legacyOffered).toEqual([]);
    });

    it("offers the current name of every legacy name, so no place drops out of the list", () => {
      const offered: Set<string> = new Set<string>(getOfferedValues());
      const missing: Array<string> = [];

      for (const [legacyName, currentName] of Object.entries(
        LEGACY_TIMEZONE_NAMES,
      )) {
        if (!offered.has(String(currentName))) {
          missing.push(`${legacyName} -> ${String(currentName)}`);
        }
      }

      expect(missing).toEqual([]);
    });

    it("offers a legacy name's current name at the legacy name's own offset", () => {
      /*
       * Hiding "US/Pacific" is only safe if the entry left standing reads the
       * same clock — a user looking for their old choice finds it at the same
       * place in the list.
       */
      const offsetByValue: Map<string, number> = new Map<string, number>();

      for (const value of getOfferedValues()) {
        offsetByValue.set(
          value,
          OneUptimeDate.getGmtOffsetByTimezone(value as Timezone),
        );
      }

      for (const [legacyName, currentName] of Object.entries(
        LEGACY_TIMEZONE_NAMES,
      )) {
        // US/Pacific-New is gone from the tzdb: it has no offset to compare.
        if (!Moment.tz.zone(legacyName)) {
          continue;
        }

        expect({
          legacyName: legacyName,
          offset: offsetByValue.get(String(currentName)),
        }).toEqual({
          legacyName: legacyName,
          offset: OneUptimeDate.getGmtOffsetByTimezone(legacyName as Timezone),
        });
      }
    });

    it("offers only tzdata's selectable names, the fixed-offset Etc/GMT zones, UTC and GMT", () => {
      const zoneTab: Set<string> = getZoneTabNames();

      const unexpected: Array<string> = getOfferedValues().filter(
        (value: string): boolean => {
          return (
            !zoneTab.has(value) &&
            !FIXED_OFFSET_ZONE.test(value) &&
            value !== "UTC" &&
            value !== "GMT"
          );
        },
      );

      expect(unexpected).toEqual([]);
    });

    it("offers every name tzdata lists for users to select from", () => {
      const offered: Set<string> = new Set<string>(getOfferedValues());

      const missing: Array<string> = Array.from(getZoneTabNames()).filter(
        (zone: string): boolean => {
          return !offered.has(zone);
        },
      );

      expect(getZoneTabNames().size).toBeGreaterThan(300);
      expect(missing).toEqual([]);
    });

    it("offers all 26 fixed-offset Etc/GMT zones, from Etc/GMT+12 to Etc/GMT-14", () => {
      const fixedOffsetZones: Array<string> = getOfferedValues()
        .filter((value: string): boolean => {
          return value.startsWith("Etc/");
        })
        .sort();

      const expected: Array<string> = [];

      for (let hours: number = 1; hours <= 12; hours++) {
        expected.push(`Etc/GMT+${hours}`);
      }

      for (let hours: number = 1; hours <= 14; hours++) {
        expected.push(`Etc/GMT-${hours}`);
      }

      expect(fixedOffsetZones).toEqual(expected.sort());
    });

    it.each([
      // The screenshot's zone, and a neighbour that shares its clock.
      "Asia/Singapore",
      "Asia/Kuala_Lumpur",
      /*
       * Links in tzdata too, but to a zone in another country: a real place
       * to anyone choosing, not a duplicate.
       */
      "Europe/Oslo",
      "Europe/Amsterdam",
      "Atlantic/Reykjavik",
      "America/Toronto",
      "Asia/Kolkata",
      "UTC",
      "GMT",
      "Etc/GMT-8",
      // The five current names the enum was missing.
      "Europe/Kyiv",
      "America/Nuuk",
      "Pacific/Kanton",
      "America/Ciudad_Juarez",
      "Asia/Qostanay",
      // US/Samoa is American Samoa; the country Samoa must stay distinct.
      "Pacific/Pago_Pago",
      "Pacific/Apia",
    ])("offers %s", (timezone: string) => {
      expect(getOfferedValues()).toContain(timezone);
    });

    it.each([
      ["Singapore", "Asia/Singapore"],
      ["US/Pacific", "America/Los_Angeles"],
      ["US/Eastern", "America/New_York"],
      ["Asia/Calcutta", "Asia/Kolkata"],
      ["GB", "Europe/London"],
      ["Europe/Kiev", "Europe/Kyiv"],
      ["America/Godthab", "America/Nuuk"],
      ["Pacific/Enderbury", "Pacific/Kanton"],
      ["Etc/UTC", "UTC"],
      ["Zulu", "UTC"],
      ["UCT", "UTC"],
      ["Greenwich", "GMT"],
      ["EST5EDT", "America/New_York"],
      ["CET", "Europe/Brussels"],
      ["America/Montreal", "America/Toronto"],
      ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"],
      ["US/Samoa", "Pacific/Pago_Pago"],
      ["US/Pacific-New", "America/Los_Angeles"],
    ])(
      "hides the legacy name %s and offers %s in its place",
      (legacyName: string, currentName: string) => {
        const values: Array<string> = getOfferedValues();

        // Still a valid stored value — only never offered.
        expect(Object.values(Timezone) as Array<string>).toContain(legacyName);
        expect(values).not.toContain(legacyName);
        expect(values).toContain(currentName);
        expect(TimezoneAlias.getCanonicalTimezone(legacyName)).toBe(
          currentName,
        );
      },
    );

    it("keeps each legacy name's current name distinct from the legacy name", () => {
      /*
       * A legacy name mapped to itself would pass "offers no legacy name"
       * only by removing its place from the list entirely.
       */
      for (const [legacyName, currentName] of Object.entries(
        LEGACY_TIMEZONE_NAMES,
      )) {
        expect(currentName).not.toBe(legacyName);
        expect(TimezoneAlias.isLegacyName(String(currentName))).toBe(false);
      }
    });
  });

  /*
   * Stored values are never rewritten, so a profile, schedule or status page
   * saved as "Singapore" still holds "Singapore" — and the picker no longer
   * offers it. Each option therefore lists the legacy names that mean it as
   * `aliases`, and the Dropdown matches a value that is no option's own
   * against them: the field shows "GMT+8 Asia/Singapore" instead of its
   * placeholder, and the multi-select keeps the zone instead of dropping it
   * on the next edit. These tests pin the aliases to the one map that
   * decides what is legacy, so the two cannot drift apart.
   */
  describe("aliases for legacy names", () => {
    it("lists every legacy name as an alias of exactly one option: the one it translates to", () => {
      const options: Array<DropdownOption> = getOptions();
      const offenders: Array<string> = [];

      for (const legacyName of Object.keys(LEGACY_TIMEZONE_NAMES)) {
        const owners: Array<string> = options
          .filter((option: DropdownOption): boolean => {
            return Boolean(option.aliases?.includes(legacyName));
          })
          .map((option: DropdownOption): string => {
            return String(option.value);
          });

        const expected: Array<string> = [
          TimezoneAlias.getCanonicalTimezone(legacyName),
        ];

        if (JSON.stringify(owners) !== JSON.stringify(expected)) {
          offenders.push(
            `${legacyName}: aliased by [${owners.join(", ")}], expected [${expected.join(", ")}]`,
          );
        }
      }

      expect(offenders).toEqual([]);
    });

    it("lists the legacy names as aliases once each across the whole list, and nothing else", () => {
      const allAliases: Array<string> = getOptions().flatMap(
        (option: DropdownOption): Array<string> => {
          return (option.aliases || []).map(String);
        },
      );

      expect(findDuplicates(allAliases)).toEqual([]);
      expect([...allAliases].sort()).toEqual(
        Object.keys(LEGACY_TIMEZONE_NAMES).sort(),
      );
    });

    it("lists only legacy names as aliases", () => {
      const notLegacy: Array<string> = [];

      for (const option of getOptions()) {
        for (const alias of option.aliases || []) {
          if (!TimezoneAlias.isLegacyName(String(alias))) {
            notLegacy.push(`${String(option.value)}: ${String(alias)}`);
          }
        }
      }

      expect(notLegacy).toEqual([]);
    });

    it("never lists an offered value as an alias, so an option's own value is never claimed by another", () => {
      /*
       * The Dropdown lets an option's own value win over another option's
       * alias; the list must not rely on that rule. An offered value that
       * was also an alias would be a zone reachable under two options.
       */
      const offered: Set<string> = new Set<string>(getOfferedValues());
      const offenders: Array<string> = [];

      for (const option of getOptions()) {
        for (const alias of option.aliases || []) {
          if (offered.has(String(alias))) {
            offenders.push(`${String(option.value)}: ${String(alias)}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });

    it("gives an option an aliases property only when it has legacy names, and then exactly those", () => {
      const offenders: Array<string> = [];
      let optionsWithAliases: number = 0;
      let optionsWithoutAliases: number = 0;

      for (const option of getOptions()) {
        const legacyNames: Array<string> = TimezoneAlias.getLegacyNamesOf(
          option.value as Timezone,
        );

        if (legacyNames.length === 0) {
          optionsWithoutAliases++;

          // Absent, not an empty array: most options have nothing to alias.
          if (Object.prototype.hasOwnProperty.call(option, "aliases")) {
            offenders.push(`${String(option.value)}: has an aliases property`);
          }

          continue;
        }

        optionsWithAliases++;

        const aliases: Array<string> = (option.aliases || []).map(String);

        if (
          JSON.stringify([...aliases].sort()) !==
          JSON.stringify([...legacyNames].sort())
        ) {
          offenders.push(
            `${String(option.value)}: [${aliases.join(", ")}], expected [${legacyNames.join(", ")}]`,
          );
        }
      }

      expect(offenders).toEqual([]);
      // Both branches must be exercised for this to prove anything.
      expect(optionsWithAliases).toBeGreaterThan(50);
      expect(optionsWithoutAliases).toBeGreaterThan(200);
    });

    it("selects exactly one option for every Timezone enum value, by its own value or by an alias", () => {
      /*
       * Whatever a record holds — a current name, a legacy one, even
       * US/Pacific-New, which moment can no longer resolve — some option
       * shows it. None is left to fall back to the placeholder.
       */
      const options: Array<DropdownOption> = getOptions();
      const offenders: Array<string> = [];

      for (const timezone of Object.values(Timezone) as Array<string>) {
        const matches: Array<string> = options
          .filter((option: DropdownOption): boolean => {
            return (
              option.value === timezone ||
              Boolean(option.aliases?.includes(timezone))
            );
          })
          .map((option: DropdownOption): string => {
            return String(option.value);
          });

        const expected: Array<string> = [
          TimezoneAlias.getCanonicalTimezone(timezone),
        ];

        if (JSON.stringify(matches) !== JSON.stringify(expected)) {
          offenders.push(
            `${timezone}: [${matches.join(", ")}], expected [${expected.join(", ")}]`,
          );
        }
      }

      expect(offenders).toEqual([]);
    });

    it("never lists an option's own value among its aliases", () => {
      for (const option of getOptions()) {
        expect(option.aliases || []).not.toContain(option.value);
      }
    });

    it.each([
      ["America/Los_Angeles", ["PST8PDT", "US/Pacific", "US/Pacific-New"]],
      [
        "UTC",
        [
          "Etc/UCT",
          "Etc/UTC",
          "Etc/Universal",
          "Etc/Zulu",
          "UCT",
          "Universal",
          "Zulu",
        ],
      ],
      ["Asia/Singapore", ["Singapore"]],
      ["Asia/Kolkata", ["Asia/Calcutta"]],
      ["Asia/Tokyo", ["Japan"]],
      ["Europe/Kyiv", ["Europe/Kiev", "Europe/Uzhgorod", "Europe/Zaporozhye"]],
    ])(
      "lists the option %s with the aliases %j",
      (value: string, expectedAliases: Array<string>) => {
        const option: DropdownOption | undefined = getOptions().find(
          (candidate: DropdownOption): boolean => {
            return candidate.value === value;
          },
        );

        expect(option).toBeDefined();
        expect([...(option!.aliases || [])].map(String).sort()).toEqual(
          expectedAliases,
        );
      },
    );

    it("lists US/Pacific-New, which moment cannot resolve, as an alias of America/Los_Angeles", () => {
      /*
       * It is left out of the offered values because moment has no data for
       * it, not only because it is legacy. As an alias it still needs no
       * data: a schedule saved with it shows Los Angeles.
       */
      expect(Moment.tz.zone("US/Pacific-New")).toBeNull();

      const owner: DropdownOption | undefined = getOptions().find(
        (option: DropdownOption): boolean => {
          return Boolean(option.aliases?.includes("US/Pacific-New"));
        },
      );

      expect(owner?.value).toBe("America/Los_Angeles");
    });

    it.each([
      "Asia/Kuala_Lumpur",
      "Europe/Oslo",
      "Europe/Berlin",
      "Etc/GMT-8",
      "Pacific/Apia",
    ])(
      "gives %s, which no legacy name translates to, no aliases property",
      (value: string) => {
        const option: DropdownOption | undefined = getOptions().find(
          (candidate: DropdownOption): boolean => {
            return candidate.value === value;
          },
        );

        expect(option).toBeDefined();
        expect(option).not.toHaveProperty("aliases");
      },
    );

    it("builds fresh alias arrays every time, so a caller that mutates one cannot corrupt the next list", () => {
      /*
       * TimezoneSelectButton and the clock widget cache the list at module
       * level, and every other picker builds its own. If the aliases were
       * the map's own arrays, one careless push would change what "Singapore"
       * selects everywhere.
       */
      const first: DropdownOption | undefined = getOptions().find(
        (option: DropdownOption): boolean => {
          return option.value === "Asia/Singapore";
        },
      );

      first!.aliases!.push("Asia/Tokyo");
      first!.aliases!.splice(0, 1);

      const second: DropdownOption | undefined = getOptions().find(
        (option: DropdownOption): boolean => {
          return option.value === "Asia/Singapore";
        },
      );

      expect(second!.aliases).toEqual(["Singapore"]);
      expect(TimezoneAlias.getLegacyNamesOf(Timezone.AsiaSingapore)).toEqual([
        "Singapore",
      ]);
    });

    it("does not change what an option emits or how it is labelled", () => {
      // Choosing an option stores its value; the alias is only for matching.
      const option: DropdownOption | undefined = getOptions().find(
        (candidate: DropdownOption): boolean => {
          return candidate.value === "Asia/Singapore";
        },
      );

      expect(option).toEqual({
        value: "Asia/Singapore",
        label: OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
          Timezone.AsiaSingapore,
        ),
        aliases: ["Singapore"],
      });
    });
  });
});
