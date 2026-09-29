import Timezone from "../../Types/Timezone";
import TimezoneAlias, {
  LEGACY_TIMEZONE_NAMES,
} from "../../Types/TimezoneAlias";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * Contract under test — which timezone names are CURRENT (offered by the
 * picker, shown in the UI) and which are LEGACY (accepted and stored as
 * given, shown and matched as their current name, never offered). Nothing
 * rewrites a stored legacy name: rows, tokens and API callers read back
 * exactly what they wrote.
 *
 * The bug: the dashboard picker listed "GMT+8 Asia/Singapore" and "GMT+8
 * Singapore", "America/Los_Angeles" and "US/Pacific", nine spellings of UTC.
 * The enum carries every name the tz database answers to, including the ~150
 * it keeps only for backward compatibility, and the picker offered all of
 * them.
 *
 * Most assertions here are derived from the tz data moment-timezone ships,
 * not from hand-picked examples: a hand-written list would only ever confirm
 * the names its author already thought of. The classification tests are
 * exhaustive over the whole enum, so upgrading moment-timezone to a tzdata
 * release that adds, renames or retires a zone fails here, naming the zone,
 * instead of quietly bringing a duplicate (or a missing country) back into
 * the picker.
 */

type ZoneRules = {
  untils: Array<number>;
  offsets: Array<number>;
  abbrs: Array<string>;
};

const ALL_TIMEZONES: Array<Timezone> = Object.values(
  Timezone,
) as Array<Timezone>;

const LEGACY_PAIRS: Array<[Timezone, Timezone]> = Object.entries(
  LEGACY_TIMEZONE_NAMES,
) as Array<[Timezone, Timezone]>;

const LEGACY_NAMES: Set<string> = new Set<string>(
  LEGACY_PAIRS.map(([legacy]: [Timezone, Timezone]): string => {
    return legacy;
  }),
);

const CURRENT_TIMEZONES: Array<Timezone> = ALL_TIMEZONES.filter(
  (timezone: Timezone): boolean => {
    return !LEGACY_NAMES.has(timezone);
  },
);

/*
 * tzdata's zone.tab / zone1970.tab: the zones it publishes for "programs
 * that let users select a timezone". moment exposes exactly that set through
 * its country table.
 */
const buildZoneTabNames: () => Set<string> = (): Set<string> => {
  const names: Set<string> = new Set<string>();

  for (const country of moment.tz.countries()) {
    for (const zone of moment.tz.zonesForCountry(country)) {
      names.add(zone);
    }
  }

  return names;
};

const ZONE_TAB_NAMES: Set<string> = buildZoneTabNames();

// Etc/GMT+5, Etc/GMT-14, ... — but not Etc/GMT+0 / Etc/GMT-0, which are GMT.
const isFixedOffsetName: (timezone: string) => boolean = (
  timezone: string,
): boolean => {
  const match: RegExpMatchArray | null = timezone.match(
    /^Etc\/GMT[+-](\d{1,2})$/,
  );

  return match !== null && Number(match[1]) !== 0;
};

const classify: (timezone: string) => Array<string> = (
  timezone: string,
): Array<string> => {
  const kinds: Array<string> = [];

  if (LEGACY_NAMES.has(timezone)) {
    kinds.push("legacy");
  }

  if (ZONE_TAB_NAMES.has(timezone)) {
    kinds.push("zone.tab");
  }

  if (isFixedOffsetName(timezone)) {
    kinds.push("Etc/GMT±N");
  }

  if (timezone === "UTC") {
    kinds.push("UTC");
  }

  if (timezone === "GMT") {
    kinds.push("GMT");
  }

  return kinds;
};

const rulesOf: (timezone: string) => ZoneRules | null = (
  timezone: string,
): ZoneRules | null => {
  const zone: moment.MomentZone | null = moment.tz.zone(timezone);

  if (!zone) {
    return null;
  }

  return { untils: zone.untils, offsets: zone.offsets, abbrs: zone.abbrs };
};

const variantsOf: (timezone: string) => Array<string> = (
  timezone: string,
): Array<string> => {
  return [
    timezone,
    timezone.toLowerCase(),
    timezone.toUpperCase(),
    ` ${timezone} `,
    `\t${timezone.toLowerCase()}\n`,
  ];
};

describe("LEGACY_TIMEZONE_NAMES — the map itself", () => {
  test("every legacy name is a Timezone enum value", () => {
    const offenders: Array<string> = LEGACY_PAIRS.filter(
      ([legacy]: [Timezone, Timezone]): boolean => {
        return !ALL_TIMEZONES.includes(legacy);
      },
    ).map(([legacy]: [Timezone, Timezone]): string => {
      return legacy;
    });

    expect(offenders).toEqual([]);
  });

  test("every current name it maps to is a Timezone enum value", () => {
    const offenders: Array<string> = LEGACY_PAIRS.filter(
      ([, current]: [Timezone, Timezone]): boolean => {
        return !ALL_TIMEZONES.includes(current);
      },
    ).map(([legacy, current]: [Timezone, Timezone]): string => {
      return `${legacy} -> ${current}`;
    });

    expect(offenders).toEqual([]);
  });

  /*
   * A chain (A -> B -> C) would translate A to B, which the picker does not
   * offer, and list A as an alias of B, an option that does not exist: a
   * record holding A would select nothing, the very empty-field symptom the
   * map exists to fix.
   */
  test("no target is itself a legacy name (no chains)", () => {
    const offenders: Array<string> = LEGACY_PAIRS.filter(
      ([, current]: [Timezone, Timezone]): boolean => {
        return LEGACY_NAMES.has(current);
      },
    ).map(([legacy, current]: [Timezone, Timezone]): string => {
      return `${legacy} -> ${current}`;
    });

    expect(offenders).toEqual([]);
  });

  test("no legacy name maps to itself", () => {
    const offenders: Array<string> = LEGACY_PAIRS.filter(
      ([legacy, current]: [Timezone, Timezone]): boolean => {
        return legacy === current;
      },
    ).map(([legacy]: [Timezone, Timezone]): string => {
      return legacy;
    });

    expect(offenders).toEqual([]);
  });

  /*
   * Rows, JWTs, browser storage and API callers hold these names. Removing
   * one from the enum would turn a stored, working value into a type error
   * in every reader — hiding it from the picker is all that was wanted.
   */
  test("the enum still contains every legacy name", () => {
    for (const legacy of LEGACY_NAMES) {
      expect(ALL_TIMEZONES).toContain(legacy);
    }
  });

  test("no two enum values differ only in case, so a case-insensitive lookup is unambiguous", () => {
    const seen: Map<string, string> = new Map<string, string>();
    const collisions: Array<string> = [];

    for (const timezone of ALL_TIMEZONES) {
      const key: string = timezone.toLowerCase();
      const previous: string | undefined = seen.get(key);

      if (previous !== undefined) {
        collisions.push(`${previous} / ${timezone}`);
      }

      seen.set(key, timezone);
    }

    expect(collisions).toEqual([]);
  });
});

describe("LEGACY_TIMEZONE_NAMES — every translation keeps the clock", () => {
  /*
   * Translating a stored value must never move a user's clock: every pair
   * has to be the same zone in moment's data — identical transitions,
   * offsets and abbreviations — for its whole history, not just today.
   * This is what makes the same-country departures from tzdata's own link
   * targets (Africa/Timbuktu -> Africa/Bamako rather than Africa/Abidjan)
   * safe.
   */
  test.each(
    LEGACY_PAIRS.filter(([legacy]: [Timezone, Timezone]): boolean => {
      return legacy !== Timezone.USPacificNew;
    }),
  )("%s has exactly the rules of %s", (legacy: Timezone, current: Timezone) => {
    const legacyRules: ZoneRules | null = rulesOf(legacy);
    const currentRules: ZoneRules | null = rulesOf(current);

    expect(legacyRules).not.toBeNull();
    expect(currentRules).not.toBeNull();
    expect(legacyRules).toEqual(currentRules);
  });

  /*
   * tzdata removed US/Pacific-New in 2020b; moment cannot resolve it at
   * all. A stored value is read as the zone it used to link to rather than
   * handed to moment, which would silently fall back to UTC.
   */
  test("US/Pacific-New, which moment cannot resolve, is read as a zone it can", () => {
    expect(moment.tz.zone(Timezone.USPacificNew)).toBeNull();
    expect(LEGACY_TIMEZONE_NAMES[Timezone.USPacificNew]).toBe(
      Timezone.AmericaLos_Angeles,
    );
    expect(moment.tz.zone(Timezone.AmericaLos_Angeles)).not.toBeNull();
  });

  test("US/Pacific-New is the only enum value moment cannot resolve", () => {
    const unresolvable: Array<Timezone> = ALL_TIMEZONES.filter(
      (timezone: Timezone): boolean => {
        return moment.tz.zone(timezone) === null;
      },
    );

    expect(unresolvable).toEqual([Timezone.USPacificNew]);
  });

  test("every current name resolves in moment", () => {
    const unresolvable: Array<Timezone> = CURRENT_TIMEZONES.filter(
      (timezone: Timezone): boolean => {
        return moment.tz.zone(timezone) === null;
      },
    );

    expect(unresolvable).toEqual([]);
  });
});

describe("classification of the whole enum against the tzdata moment ships", () => {
  /*
   * The central invariant. A name is exactly one of: legacy (hidden, and
   * translated), a zone.tab place, a fixed-offset Etc/GMT±N zone, UTC or
   * GMT. A value in none of these is a duplicate the picker would still
   * show; a value in two is contradictory. Either way it is named here.
   */
  test("every enum value is exactly one of: legacy, zone.tab, Etc/GMT±N, UTC, GMT", () => {
    const offenders: Array<string> = [];

    for (const timezone of ALL_TIMEZONES) {
      const kinds: Array<string> = classify(timezone);

      if (kinds.length !== 1) {
        offenders.push(`${timezone}: [${kinds.join(", ")}]`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no legacy name is a zone.tab name", () => {
    const offenders: Array<string> = [...LEGACY_NAMES].filter(
      (legacy: string): boolean => {
        return ZONE_TAB_NAMES.has(legacy);
      },
    );

    expect(offenders).toEqual([]);
  });

  test("every legacy name maps to a zone.tab name, UTC or GMT", () => {
    const offenders: Array<string> = LEGACY_PAIRS.filter(
      ([, current]: [Timezone, Timezone]): boolean => {
        return (
          !ZONE_TAB_NAMES.has(current) &&
          current !== Timezone.UTC &&
          current !== Timezone.GMT
        );
      },
    ).map(([legacy, current]: [Timezone, Timezone]): string => {
      return `${legacy} -> ${current}`;
    });

    expect(offenders).toEqual([]);
  });

  /*
   * Hiding the legacy names must not hide a place. Europe/Kyiv,
   * America/Nuuk, Pacific/Kanton, America/Ciudad_Juarez and Asia/Qostanay
   * were missing from the enum until the map was written — Ukraine would
   * have had no entry at all once Europe/Kiev was hidden.
   */
  test("every zone.tab name is in the enum, so the picker can offer every place tzdata lists", () => {
    const missing: Array<string> = [...ZONE_TAB_NAMES].filter(
      (zone: string): boolean => {
        return !ALL_TIMEZONES.includes(zone as Timezone);
      },
    );

    expect(missing).toEqual([]);
  });

  test("the five names added with the map are current zone.tab names", () => {
    for (const timezone of [
      Timezone.EuropeKyiv,
      Timezone.AmericaNuuk,
      Timezone.PacificKanton,
      Timezone.AmericaCiudad_Juarez,
      Timezone.AsiaQostanay,
    ]) {
      expect(ZONE_TAB_NAMES.has(timezone)).toBe(true);
      expect(TimezoneAlias.isLegacyName(timezone)).toBe(false);
    }
  });

  /*
   * Any name moment can resolve — including whatever moment.tz.guess()
   * returns, which is only ever a name moment has data for — is a Timezone,
   * so it is either offered or translated. A name outside the enum would be
   * neither.
   */
  test("every name moment knows is an enum value", () => {
    const missing: Array<string> = moment.tz
      .names()
      .filter((name: string): boolean => {
        return !ALL_TIMEZONES.includes(name as Timezone);
      });

    expect(missing).toEqual([]);
  });

  /*
   * The regression itself, stated over the data: among the names the
   * picker still offers, two share a clock only when they are two different
   * places tzdata lists (Europe/Oslo and Europe/Berlin), or they are UTC and
   * GMT, which the product deliberately keeps as two names.
   */
  test("the only clock still offered under two names that are not two zone.tab places is UTC/GMT", () => {
    const byClock: Map<string, Array<Timezone>> = new Map<
      string,
      Array<Timezone>
    >();

    for (const timezone of CURRENT_TIMEZONES) {
      const rules: ZoneRules | null = rulesOf(timezone);
      const key: string = JSON.stringify([rules?.untils, rules?.offsets]);
      byClock.set(key, [...(byClock.get(key) || []), timezone]);
    }

    const sharedWithNonPlace: Array<Array<Timezone>> = [
      ...byClock.values(),
    ].filter((names: Array<Timezone>): boolean => {
      return (
        names.length > 1 &&
        names.some((name: Timezone): boolean => {
          return !ZONE_TAB_NAMES.has(name);
        })
      );
    });

    expect(
      sharedWithNonPlace.map((names: Array<Timezone>): Array<Timezone> => {
        return [...names].sort();
      }),
    ).toEqual([[Timezone.GMT, Timezone.UTC]]);
  });

  /*
   * What is left to offer: each zone.tab place once, the 26 fixed offsets
   * (Etc/GMT+1..+12 and Etc/GMT-1..-14), UTC and GMT — and nothing else.
   */
  test("the current names are exactly the zone.tab places, the 26 fixed offsets, UTC and GMT", () => {
    const fixedOffsets: Array<Timezone> =
      CURRENT_TIMEZONES.filter(isFixedOffsetName);

    expect(fixedOffsets).toHaveLength(26);
    expect(CURRENT_TIMEZONES).toHaveLength(
      ZONE_TAB_NAMES.size + fixedOffsets.length + 2,
    );
    expect(CURRENT_TIMEZONES).toContain(Timezone.UTC);
    expect(CURRENT_TIMEZONES).toContain(Timezone.GMT);
  });
});

describe("known translations", () => {
  test.each([
    ["Singapore", "Asia/Singapore"],
    ["Asia/Calcutta", "Asia/Kolkata"],
    ["US/Pacific", "America/Los_Angeles"],
    ["US/Eastern", "America/New_York"],
    ["GB", "Europe/London"],
    ["Europe/Kiev", "Europe/Kyiv"],
    ["Europe/Zaporozhye", "Europe/Kyiv"],
    ["Europe/Uzhgorod", "Europe/Kyiv"],
    ["America/Godthab", "America/Nuuk"],
    ["Pacific/Enderbury", "Pacific/Kanton"],
    ["Iceland", "Atlantic/Reykjavik"],
    ["Etc/UTC", "UTC"],
    ["Etc/UCT", "UTC"],
    ["UCT", "UTC"],
    ["Universal", "UTC"],
    ["Zulu", "UTC"],
    ["Etc/Zulu", "UTC"],
    ["Etc/GMT", "GMT"],
    ["Etc/GMT0", "GMT"],
    ["Etc/GMT+0", "GMT"],
    ["Etc/GMT-0", "GMT"],
    ["GMT0", "GMT"],
    ["GMT+0", "GMT"],
    ["GMT-0", "GMT"],
    ["Greenwich", "GMT"],
    ["Etc/Greenwich", "GMT"],
    ["US/Pacific-New", "America/Los_Angeles"],
    ["Pacific/Samoa", "Pacific/Pago_Pago"],
    // AMERICAN Samoa (UTC-11), not the country Samoa (Pacific/Apia, UTC+13).
    ["US/Samoa", "Pacific/Pago_Pago"],
    ["Africa/Timbuktu", "Africa/Bamako"],
    ["America/Coral_Harbour", "America/Atikokan"],
    ["Antarctica/South_Pole", "Antarctica/McMurdo"],
    ["Atlantic/Jan_Mayen", "Arctic/Longyearbyen"],
    ["Pacific/Yap", "Pacific/Chuuk"],
    // EST never observes daylight saving, so it is Panama, not New York.
    ["EST", "America/Panama"],
    ["EST5EDT", "America/New_York"],
    ["MST", "America/Phoenix"],
    ["America/Montreal", "America/Toronto"],
    ["Asia/Chungking", "Asia/Shanghai"],
    ["Asia/Saigon", "Asia/Ho_Chi_Minh"],
    ["Asia/Katmandu", "Asia/Kathmandu"],
    ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"],
    ["Japan", "Asia/Tokyo"],
    ["PRC", "Asia/Shanghai"],
  ])("%s -> %s", (legacy: string, current: string) => {
    expect(LEGACY_TIMEZONE_NAMES[legacy as Timezone]).toBe(current);
    expect(TimezoneAlias.isLegacyName(legacy)).toBe(true);
    expect(TimezoneAlias.getCanonicalTimezone(legacy)).toBe(current);
    expect(TimezoneAlias.isLegacyName(current)).toBe(false);
  });

  test("US/Samoa and Pacific/Apia are not the same clock", () => {
    expect(TimezoneAlias.getCanonicalTimezone(Timezone.USSamoa)).not.toBe(
      Timezone.PacificApia,
    );
    expect(rulesOf(Timezone.USSamoa)).not.toEqual(
      rulesOf(Timezone.PacificApia),
    );
  });
});

describe("names that are NOT legacy", () => {
  /*
   * tzdata stores these as links to another zone, because the clocks have
   * matched since 1970. They still name a different place, so to someone
   * choosing they are not duplicates, and zone.tab lists them.
   */
  test.each([
    ["Europe/Oslo", "Europe/Berlin"],
    ["Asia/Kuala_Lumpur", "Asia/Singapore"],
    ["Europe/Amsterdam", "Europe/Brussels"],
    ["Atlantic/Reykjavik", "Africa/Abidjan"],
    ["America/Nassau", "America/Toronto"],
  ])(
    "%s shares %s's rules but is a place of its own",
    (timezone: string, sameClockAs: string) => {
      expect(rulesOf(timezone)).toEqual(rulesOf(sameClockAs));
      expect(ZONE_TAB_NAMES.has(timezone)).toBe(true);
      expect(TimezoneAlias.isLegacyName(timezone)).toBe(false);
      expect(TimezoneAlias.getCanonicalTimezone(timezone)).toBe(timezone);
    },
  );

  test.each([
    "UTC",
    "GMT",
    "Etc/GMT-8",
    "Etc/GMT+12",
    "Asia/Singapore",
    "Asia/Kolkata",
    "America/Los_Angeles",
    "Europe/Kyiv",
    "Pacific/Apia",
    "Pacific/Pago_Pago",
  ])("%s is current and translates to itself", (timezone: string) => {
    expect(TimezoneAlias.isLegacyName(timezone)).toBe(false);
    expect(TimezoneAlias.getCanonicalTimezone(timezone)).toBe(timezone);
  });
});

describe("TimezoneAlias.getCanonicalTimezone", () => {
  test("every current enum value is a fixpoint", () => {
    const offenders: Array<string> = CURRENT_TIMEZONES.filter(
      (timezone: Timezone): boolean => {
        return TimezoneAlias.getCanonicalTimezone(timezone) !== timezone;
      },
    );

    expect(offenders).toEqual([]);
  });

  test("every legacy enum value translates to its mapped current name", () => {
    const offenders: Array<string> = [];

    for (const [legacy, current] of LEGACY_PAIRS) {
      const canonical: Timezone = TimezoneAlias.getCanonicalTimezone(legacy);

      if (canonical !== current) {
        offenders.push(`${legacy} -> ${canonical}, expected ${current}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every enum value translates to a current name", () => {
    const offenders: Array<string> = ALL_TIMEZONES.filter(
      (timezone: Timezone): boolean => {
        return TimezoneAlias.isLegacyName(
          TimezoneAlias.getCanonicalTimezone(timezone),
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  /*
   * moment matches zone names case-insensitively, so "asia/calcutta" from
   * an API caller is a zone every reader accepts; it must also be a value
   * the picker can match.
   */
  test.each([
    [" asia/calcutta ", "Asia/Kolkata"],
    ["SINGAPORE", "Asia/Singapore"],
    ["singapore", "Asia/Singapore"],
    ["utc", "UTC"],
    ["Utc", "UTC"],
    ["etc/utc", "UTC"],
    ["\tEurope/Kiev\n", "Europe/Kyiv"],
    ["america/new_york", "America/New_York"],
    [" Asia/Singapore ", "Asia/Singapore"],
    ["US/PACIFIC", "America/Los_Angeles"],
    ["etc/gmt-8", "Etc/GMT-8"],
  ])("%j -> %s", (input: string, expected: string) => {
    expect(TimezoneAlias.getCanonicalTimezone(input)).toBe(expected);
  });

  test("every case and whitespace variant of every enum value translates like the exact name", () => {
    const offenders: Array<string> = [];

    for (const timezone of ALL_TIMEZONES) {
      const expected: Timezone = TimezoneAlias.getCanonicalTimezone(timezone);

      for (const variant of variantsOf(timezone)) {
        const actual: Timezone = TimezoneAlias.getCanonicalTimezone(variant);

        if (actual !== expected) {
          offenders.push(`${JSON.stringify(variant)} -> ${actual}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Translating is not validating. A zone newer than the enum
   * (America/Coyhaique arrived in tzdata 2025b), a typo, or an empty
   * string comes back exactly as given — never trimmed, never re-cased,
   * never swapped for a guess.
   */
  test.each([
    "Mars/Olympus",
    " Mars/Olympus ",
    "mars/olympus",
    "",
    "   ",
    "America/Coyhaique",
    "Asia/Singapore/Extra",
  ])("the unknown %j comes back as the identical string", (input: string) => {
    expect(TimezoneAlias.getCanonicalTimezone(input)).toBe(input);
  });

  /*
   * Browser storage is JSON-parsed on read, so a corrupt saved timezone can
   * reach this as a number or null despite the types. It is handed back as
   * it came rather than thrown on.
   */
  test.each([[null], [undefined], [42], [{}], [true]])(
    "hands the non-string %p back untouched instead of throwing",
    (value: unknown) => {
      expect(
        TimezoneAlias.getCanonicalTimezone(value as unknown as string),
      ).toBe(value);
    },
  );

  test("America/Coyhaique really is unknown to the enum and to moment", () => {
    // Guards the example above: if tzdata catches up, pick another.
    expect(ALL_TIMEZONES).not.toContain("America/Coyhaique");
    expect(moment.tz.zone("America/Coyhaique")).toBeNull();
  });

  test("is idempotent over every enum value and every variant", () => {
    const offenders: Array<string> = [];

    for (const timezone of ALL_TIMEZONES) {
      for (const variant of [...variantsOf(timezone), "Mars/Olympus", ""]) {
        const once: Timezone = TimezoneAlias.getCanonicalTimezone(variant);
        const twice: Timezone = TimezoneAlias.getCanonicalTimezone(once);

        if (once !== twice) {
          offenders.push(`${JSON.stringify(variant)}: ${once} -> ${twice}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("TimezoneAlias.isLegacyName", () => {
  // Each wrapped in a row: test.each would spread a bare [] into no argument.
  test.each([[null], [undefined], [42], [{}], [[]], [true]])(
    "is false for the non-string %p",
    (value: unknown) => {
      expect(TimezoneAlias.isLegacyName(value as string)).toBe(false);
    },
  );

  test.each([
    "Singapore",
    " singapore ",
    "SINGAPORE",
    "US/PACIFIC",
    "etc/utc",
    "\tzulu\n",
    "Asia/Calcutta",
    "us/pacific-new",
  ])("is true for %j (case-insensitive, trimmed)", (value: string) => {
    expect(TimezoneAlias.isLegacyName(value)).toBe(true);
  });

  test("is true for every legacy name, in every case and padding", () => {
    const offenders: Array<string> = [];

    for (const legacy of LEGACY_NAMES) {
      for (const variant of variantsOf(legacy)) {
        if (!TimezoneAlias.isLegacyName(variant)) {
          offenders.push(JSON.stringify(variant));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("is false for every current name, in every case and padding", () => {
    const offenders: Array<string> = [];

    for (const timezone of CURRENT_TIMEZONES) {
      for (const variant of variantsOf(timezone)) {
        if (TimezoneAlias.isLegacyName(variant)) {
          offenders.push(JSON.stringify(variant));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test.each(["Mars/Olympus", "", "   ", "America/Coyhaique"])(
    "is false for the unknown %j",
    (value: string) => {
      expect(TimezoneAlias.isLegacyName(value)).toBe(false);
    },
  );
});

describe("TimezoneAlias.getCanonicalTimezones", () => {
  test("translates every entry", () => {
    expect(
      TimezoneAlias.getCanonicalTimezones([
        "Singapore",
        "US/Pacific",
        "Asia/Calcutta",
      ]),
    ).toEqual(["Asia/Singapore", "America/Los_Angeles", "Asia/Kolkata"]);
  });

  test("drops the duplicates translating produces, keeping the first position", () => {
    expect(
      TimezoneAlias.getCanonicalTimezones([
        "Singapore",
        "Asia/Singapore",
        "UTC",
        "Etc/UTC",
      ]),
    ).toEqual(["Asia/Singapore", "UTC"]);
  });

  test("the first occurrence keeps its place even when a later one is the current spelling", () => {
    expect(
      TimezoneAlias.getCanonicalTimezones([
        "Etc/UTC",
        "Asia/Kolkata",
        "UTC",
        "Asia/Calcutta",
        "Zulu",
        "Europe/Kiev",
        "Europe/Zaporozhye",
        "Europe/Kyiv",
      ]),
    ).toEqual(["UTC", "Asia/Kolkata", "Europe/Kyiv"]);
  });

  test("returns an empty list for an empty list", () => {
    expect(TimezoneAlias.getCanonicalTimezones([])).toEqual([]);
  });

  test("keeps unknown entries as given, in place", () => {
    expect(
      TimezoneAlias.getCanonicalTimezones([
        "Mars/Olympus",
        "Singapore",
        "America/Coyhaique",
      ]),
    ).toEqual(["Mars/Olympus", "Asia/Singapore", "America/Coyhaique"]);
  });

  test("does not mutate its input", () => {
    const input: Array<string> = ["Singapore", "Asia/Singapore"];

    TimezoneAlias.getCanonicalTimezones(input);

    expect(input).toEqual(["Singapore", "Asia/Singapore"]);
  });

  test("the whole enum collapses to exactly the current names, once each", () => {
    const canonical: Array<Timezone> =
      TimezoneAlias.getCanonicalTimezones(ALL_TIMEZONES);

    expect(new Set<Timezone>(canonical).size).toBe(canonical.length);
    expect([...canonical].sort()).toEqual([...CURRENT_TIMEZONES].sort());
  });

  test("is idempotent", () => {
    const input: Array<string> = [
      ...ALL_TIMEZONES,
      ...ALL_TIMEZONES.map((timezone: Timezone): string => {
        return ` ${timezone.toUpperCase()} `;
      }),
      "Mars/Olympus",
    ];

    const once: Array<Timezone> = TimezoneAlias.getCanonicalTimezones(input);

    expect(TimezoneAlias.getCanonicalTimezones(once)).toEqual(once);
  });
});

describe("TimezoneAlias.getLegacyNamesOf", () => {
  /*
   * The picker lists these on each option as its aliases, so a record that
   * still holds a legacy name selects the option it translates to. It must
   * be the exact inverse of the map: a legacy name missing here shows an
   * empty field, and one listed under the wrong option shows the wrong zone.
   */
  const sortedLegacyNamesOf: (timezone: Timezone) => Array<string> = (
    timezone: Timezone,
  ): Array<string> => {
    return [...TimezoneAlias.getLegacyNamesOf(timezone)].sort();
  };

  test("is the exact inverse of LEGACY_TIMEZONE_NAMES over the whole enum", () => {
    const offenders: Array<string> = [];

    for (const timezone of ALL_TIMEZONES) {
      const expected: Array<string> = LEGACY_PAIRS.filter(
        ([, current]: [Timezone, Timezone]): boolean => {
          return current === timezone;
        },
      )
        .map(([legacy]: [Timezone, Timezone]): string => {
          return legacy;
        })
        .sort();

      const actual: Array<string> = sortedLegacyNamesOf(timezone);

      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        offenders.push(
          `${timezone}: [${actual.join(", ")}], expected [${expected.join(", ")}]`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  test("lists every legacy name under exactly one current name", () => {
    const listed: Array<string> = CURRENT_TIMEZONES.flatMap(
      (timezone: Timezone): Array<string> => {
        return TimezoneAlias.getLegacyNamesOf(timezone);
      },
    );

    expect(listed).toHaveLength(LEGACY_NAMES.size);
    expect([...listed].sort()).toEqual([...LEGACY_NAMES].sort());
  });

  test("lists each legacy name under the name getCanonicalTimezone translates it to", () => {
    const offenders: Array<string> = [];

    for (const timezone of CURRENT_TIMEZONES) {
      for (const legacy of TimezoneAlias.getLegacyNamesOf(timezone)) {
        if (TimezoneAlias.getCanonicalTimezone(legacy) !== timezone) {
          offenders.push(`${legacy} listed under ${timezone}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("lists only legacy names, never a current one", () => {
    const offenders: Array<string> = ALL_TIMEZONES.flatMap(
      (timezone: Timezone): Array<string> => {
        return TimezoneAlias.getLegacyNamesOf(timezone).filter(
          (listed: Timezone): boolean => {
            return !TimezoneAlias.isLegacyName(listed);
          },
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("never lists a name among its own legacy names", () => {
    const offenders: Array<string> = ALL_TIMEZONES.filter(
      (timezone: Timezone): boolean => {
        return TimezoneAlias.getLegacyNamesOf(timezone).includes(timezone);
      },
    );

    expect(offenders).toEqual([]);
  });

  test.each([
    [Timezone.AsiaSingapore, ["Singapore"]],
    [Timezone.AsiaKolkata, ["Asia/Calcutta"]],
    [Timezone.AsiaTokyo, ["Japan"]],
    [Timezone.AmericaLos_Angeles, ["PST8PDT", "US/Pacific", "US/Pacific-New"]],
    [Timezone.AmericaNew_York, ["EST5EDT", "US/Eastern"]],
    // US/Michigan is Detroit's, not New York's, although both are Eastern.
    [Timezone.AmericaDetroit, ["US/Michigan"]],
    [
      Timezone.EuropeKyiv,
      ["Europe/Kiev", "Europe/Uzhgorod", "Europe/Zaporozhye"],
    ],
    [
      Timezone.UTC,
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
    [
      Timezone.GMT,
      [
        "Etc/GMT",
        "Etc/GMT+0",
        "Etc/GMT-0",
        "Etc/GMT0",
        "Etc/Greenwich",
        "GMT+0",
        "GMT-0",
        "GMT0",
        "Greenwich",
      ],
    ],
  ])("%s -> %j", (timezone: Timezone, expected: Array<string>) => {
    expect(sortedLegacyNamesOf(timezone)).toEqual([...expected].sort());
  });

  /*
   * Most current names have no legacy spelling at all — including places
   * that merely share another zone's clock (Oslo keeps Berlin's rules, Kuala
   * Lumpur Singapore's), which are not legacy names of anything.
   */
  test.each([
    Timezone.AsiaKuala_Lumpur,
    Timezone.EuropeOslo,
    Timezone.EuropeBerlin,
    Timezone.PacificApia,
    Timezone.EtcGMTNegative8,
  ])(
    "is [] for %s, a current name with no legacy names",
    (timezone: Timezone) => {
      expect(TimezoneAlias.getLegacyNamesOf(timezone)).toEqual([]);
    },
  );

  test("is [] for every legacy name itself, since no legacy name is a target", () => {
    const offenders: Array<string> = [...LEGACY_NAMES].filter(
      (legacy: string): boolean => {
        return TimezoneAlias.getLegacyNamesOf(legacy as Timezone).length > 0;
      },
    );

    expect(offenders).toEqual([]);
  });

  test.each([
    Timezone.Singapore,
    Timezone.USPacific,
    Timezone.AsiaCalcutta,
    Timezone.EtcUTC,
    Timezone.USPacificNew,
  ])("is [] for the legacy name %s", (timezone: Timezone) => {
    expect(TimezoneAlias.getLegacyNamesOf(timezone)).toEqual([]);
  });

  test.each(["Mars/Olympus", "", "America/Coyhaique"])(
    "is [] for the unknown %j",
    (timezone: string) => {
      expect(TimezoneAlias.getLegacyNamesOf(timezone as Timezone)).toEqual([]);
    },
  );

  test("returns a fresh array on every call, so mutating one cannot change the next", () => {
    /*
     * The picker hands this array straight to an option as its aliases,
     * and the option lists are cached at module level. Were it the map's
     * own array, a caller's push would change what a legacy name selects
     * in every picker on the page.
     */
    const first: Array<Timezone> = TimezoneAlias.getLegacyNamesOf(
      Timezone.AmericaLos_Angeles,
    );
    const second: Array<Timezone> = TimezoneAlias.getLegacyNamesOf(
      Timezone.AmericaLos_Angeles,
    );

    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    const before: Array<Timezone> = [...first];

    first.push(Timezone.AsiaTokyo);
    first.splice(0, 1);
    second.length = 0;

    expect(TimezoneAlias.getLegacyNamesOf(Timezone.AmericaLos_Angeles)).toEqual(
      before,
    );
  });

  test("returns a fresh empty array for a name with none, too", () => {
    const empty: Array<Timezone> = TimezoneAlias.getLegacyNamesOf(
      Timezone.AsiaKuala_Lumpur,
    );

    empty.push(Timezone.Singapore);

    expect(TimezoneAlias.getLegacyNamesOf(Timezone.AsiaKuala_Lumpur)).toEqual(
      [],
    );
    expect(TimezoneAlias.getLegacyNamesOf(Timezone.AsiaKuala_Lumpur)).not.toBe(
      TimezoneAlias.getLegacyNamesOf(Timezone.AsiaKuala_Lumpur),
    );
  });

  test("does not change what getCanonicalTimezone or isLegacyName answer after its result is mutated", () => {
    TimezoneAlias.getLegacyNamesOf(Timezone.AsiaSingapore).push(
      Timezone.AsiaTokyo,
    );

    expect(TimezoneAlias.getCanonicalTimezone(Timezone.Singapore)).toBe(
      Timezone.AsiaSingapore,
    );
    expect(TimezoneAlias.getCanonicalTimezone(Timezone.AsiaTokyo)).toBe(
      Timezone.AsiaTokyo,
    );
    expect(TimezoneAlias.isLegacyName(Timezone.AsiaTokyo)).toBe(false);
    expect(TimezoneAlias.getLegacyNamesOf(Timezone.AsiaSingapore)).toEqual([
      Timezone.Singapore,
    ]);
  });
});
