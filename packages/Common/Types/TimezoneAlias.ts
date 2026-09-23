import Timezone from "./Timezone";

/*
 * Why the timezone picker offered "GMT+8 Asia/Singapore" AND "GMT+8
 * Singapore".
 *
 * The Timezone enum lists every name the IANA tz database answers to, and
 * the tz database answers to a great many names it keeps only so that old
 * configurations keep working: its `backward` file maps "Singapore" to
 * Asia/Singapore, "US/Pacific" to America/Los_Angeles, "Asia/Calcutta" to
 * Asia/Kolkata, "Etc/UTC" and "Zulu" to UTC, and so on. Every one of those
 * names became a second (or ninth — see UTC) entry for the same clock.
 *
 * This is the map from each of those legacy names to the one name the
 * product offers for that clock. It is the single place that decides which
 * name is current:
 *
 *   - the picker (UI/Utils/Timezone.ts) leaves every name in this map out,
 *     and lists each one as an alias of the option it maps to, so a record
 *     that already holds "Singapore" still shows "GMT+8 Asia/Singapore"
 *     selected rather than an empty field;
 *   - the browser's own guess (OneUptimeDate.getCurrentTimezone) is
 *     translated, because Chromium reports the ICU spelling of many zones —
 *     Asia/Calcutta, Europe/Kiev, Asia/Saigon — and that guess is what the
 *     dashboard saves to a new user's profile and pre-selects in pickers.
 *
 * The legacy names deliberately STAY in the Timezone enum, and stored
 * values are not rewritten. Rows, JWTs, browser storage, API callers and
 * Terraform configurations hold them, every one of them is still a zone
 * moment resolves, and an API that answered "US/Eastern" with
 * "America/New_York" would break any client that reads back what it wrote.
 * They are accepted everywhere, just never offered.
 *
 * What counts as legacy is the tz database's own answer, not ours:
 *
 *   - A name is CURRENT if tzdata lists it in zone.tab / zone1970.tab — the
 *     tables it publishes for "programs that let users select a timezone" —
 *     or it is one of the fixed-offset Etc/GMT±N zones, or it is UTC or GMT.
 *     That keeps real places that merely share a clock with another place:
 *     Europe/Oslo (Berlin's rules), Asia/Kuala_Lumpur (Singapore's),
 *     Europe/Amsterdam (Brussels'). Those are links in tzdata too, but they
 *     name a different city, so they are not duplicates to anyone choosing.
 *   - A name is LEGACY if it is in tzdata's `backward` file and not in
 *     zone.tab. The groups below follow that file's own sections.
 *
 * Two deliberate departures from tzdata's link targets:
 *
 *   - UTC and GMT are the current names of their families, not Etc/UTC and
 *     Etc/GMT. "UTC" is what every default in the product is (Timezone.UTC
 *     is the column default for a status page report), and tzdata is itself
 *     moving GMT the same way (the "vanguard" lines in `backward`).
 *   - Where tzdata's target is a zone in another country only because the
 *     two share rules since 1970, the name maps to the zone.tab name in its
 *     own country instead: Africa/Timbuktu is Africa/Bamako (Mali), not
 *     Africa/Abidjan. The clock is identical either way — the test suite
 *     checks every pair against moment's data — but the name a user is shown
 *     in place of their old one should still be their country.
 *
 * Every current name a legacy name maps to is in the enum. Five were
 * missing until this map was written (Europe/Kyiv, America/Nuuk,
 * Pacific/Kanton, America/Ciudad_Juarez and Asia/Qostanay), which would
 * have left Ukraine, Greenland and Kanton with no entry at all once their
 * old spellings were hidden.
 *
 * Source: tzdata 2024b, the release the bundled moment-timezone carries.
 */
export const LEGACY_TIMEZONE_NAMES: Readonly<
  Partial<Record<Timezone, Timezone>>
> = {
  /*
   * Pre-1993 country and region names: "Singapore", "Japan", "GB",
   * "US/Pacific", "Canada/Eastern", ... Samoa is a trap worth knowing:
   * US/Samoa is AMERICAN Samoa (Pacific/Pago_Pago, UTC-11), not the country
   * Samoa (Pacific/Apia, UTC+13).
   */
  [Timezone.AustraliaACT]: Timezone.AustraliaSydney,
  [Timezone.AustraliaLHI]: Timezone.AustraliaLord_Howe,
  [Timezone.AustraliaNorth]: Timezone.AustraliaDarwin,
  [Timezone.AustraliaNSW]: Timezone.AustraliaSydney,
  [Timezone.AustraliaQueensland]: Timezone.AustraliaBrisbane,
  [Timezone.AustraliaSouth]: Timezone.AustraliaAdelaide,
  [Timezone.AustraliaTasmania]: Timezone.AustraliaHobart,
  [Timezone.AustraliaVictoria]: Timezone.AustraliaMelbourne,
  [Timezone.AustraliaWest]: Timezone.AustraliaPerth,
  [Timezone.AustraliaYancowinna]: Timezone.AustraliaBroken_Hill,
  [Timezone.BrazilAcre]: Timezone.AmericaRio_Branco,
  [Timezone.BrazilDeNoronha]: Timezone.AmericaNoronha,
  [Timezone.BrazilEast]: Timezone.AmericaSao_Paulo,
  [Timezone.BrazilWest]: Timezone.AmericaManaus,
  [Timezone.CanadaAtlantic]: Timezone.AmericaHalifax,
  [Timezone.CanadaCentral]: Timezone.AmericaWinnipeg,
  [Timezone.CanadaEastern]: Timezone.AmericaToronto,
  [Timezone.CanadaMountain]: Timezone.AmericaEdmonton,
  [Timezone.CanadaNewfoundland]: Timezone.AmericaSt_Johns,
  [Timezone.CanadaPacific]: Timezone.AmericaVancouver,
  [Timezone.CanadaSaskatchewan]: Timezone.AmericaRegina,
  [Timezone.CanadaYukon]: Timezone.AmericaWhitehorse,
  [Timezone.ChileContinental]: Timezone.AmericaSantiago,
  [Timezone.ChileEasterIsland]: Timezone.PacificEaster,
  [Timezone.Cuba]: Timezone.AmericaHavana,
  [Timezone.Egypt]: Timezone.AfricaCairo,
  [Timezone.Eire]: Timezone.EuropeDublin,
  [Timezone.GB]: Timezone.EuropeLondon,
  [Timezone.GBEire]: Timezone.EuropeLondon,
  [Timezone.Hongkong]: Timezone.AsiaHong_Kong,
  [Timezone.Iceland]: Timezone.AtlanticReykjavik,
  [Timezone.Iran]: Timezone.AsiaTehran,
  [Timezone.Israel]: Timezone.AsiaJerusalem,
  [Timezone.Jamaica]: Timezone.AmericaJamaica,
  [Timezone.Japan]: Timezone.AsiaTokyo,
  [Timezone.Kwajalein]: Timezone.PacificKwajalein,
  [Timezone.Libya]: Timezone.AfricaTripoli,
  [Timezone.MexicoBajaNorte]: Timezone.AmericaTijuana,
  [Timezone.MexicoBajaSur]: Timezone.AmericaMazatlan,
  [Timezone.MexicoGeneral]: Timezone.AmericaMexico_City,
  [Timezone.Navajo]: Timezone.AmericaDenver,
  [Timezone.NZ]: Timezone.PacificAuckland,
  [Timezone.NZCHAT]: Timezone.PacificChatham,
  [Timezone.Poland]: Timezone.EuropeWarsaw,
  [Timezone.Portugal]: Timezone.EuropeLisbon,
  [Timezone.PRC]: Timezone.AsiaShanghai,
  [Timezone.ROC]: Timezone.AsiaTaipei,
  [Timezone.ROK]: Timezone.AsiaSeoul,
  [Timezone.Singapore]: Timezone.AsiaSingapore,
  [Timezone.Turkey]: Timezone.EuropeIstanbul,
  [Timezone.USAlaska]: Timezone.AmericaAnchorage,
  [Timezone.USAleutian]: Timezone.AmericaAdak,
  [Timezone.USArizona]: Timezone.AmericaPhoenix,
  [Timezone.USCentral]: Timezone.AmericaChicago,
  [Timezone.USEastIndiana]: Timezone.AmericaIndianaIndianapolis,
  [Timezone.USEastern]: Timezone.AmericaNew_York,
  [Timezone.USHawaii]: Timezone.PacificHonolulu,
  [Timezone.USIndianaStarke]: Timezone.AmericaIndianaKnox,
  [Timezone.USMichigan]: Timezone.AmericaDetroit,
  [Timezone.USMountain]: Timezone.AmericaDenver,
  [Timezone.USPacific]: Timezone.AmericaLos_Angeles,
  [Timezone.USSamoa]: Timezone.PacificPago_Pago,
  [Timezone.WSU]: Timezone.EuropeMoscow,
  // Two-part names tzdata split into three parts in 1995.
  [Timezone.AmericaBuenos_Aires]: Timezone.AmericaArgentinaBuenos_Aires,
  [Timezone.AmericaCatamarca]: Timezone.AmericaArgentinaCatamarca,
  [Timezone.AmericaCordoba]: Timezone.AmericaArgentinaCordoba,
  [Timezone.AmericaIndianapolis]: Timezone.AmericaIndianaIndianapolis,
  [Timezone.AmericaJujuy]: Timezone.AmericaArgentinaJujuy,
  [Timezone.AmericaKnox_IN]: Timezone.AmericaIndianaKnox,
  [Timezone.AmericaLouisville]: Timezone.AmericaKentuckyLouisville,
  [Timezone.AmericaMendoza]: Timezone.AmericaArgentinaMendoza,
  [Timezone.AmericaVirgin]: Timezone.AmericaSt_Thomas,
  [Timezone.PacificSamoa]: Timezone.PacificPago_Pago,
  // Old spellings of the same place: Calcutta, Saigon, Kiev, Godthab, ...
  [Timezone.AfricaAsmera]: Timezone.AfricaAsmara,
  [Timezone.AmericaGodthab]: Timezone.AmericaNuuk,
  [Timezone.AsiaAshkhabad]: Timezone.AsiaAshgabat,
  [Timezone.AsiaCalcutta]: Timezone.AsiaKolkata,
  [Timezone.AsiaChungking]: Timezone.AsiaShanghai,
  [Timezone.AsiaDacca]: Timezone.AsiaDhaka,
  [Timezone.AsiaIstanbul]: Timezone.EuropeIstanbul,
  [Timezone.AsiaKatmandu]: Timezone.AsiaKathmandu,
  [Timezone.AsiaMacao]: Timezone.AsiaMacau,
  [Timezone.AsiaRangoon]: Timezone.AsiaYangon,
  [Timezone.AsiaSaigon]: Timezone.AsiaHo_Chi_Minh,
  [Timezone.AsiaThimbu]: Timezone.AsiaThimphu,
  [Timezone.AsiaUjung_Pandang]: Timezone.AsiaMakassar,
  [Timezone.AsiaUlan_Bator]: Timezone.AsiaUlaanbaatar,
  [Timezone.AtlanticFaeroe]: Timezone.AtlanticFaroe,
  [Timezone.EuropeKiev]: Timezone.EuropeKyiv,
  [Timezone.EuropeNicosia]: Timezone.AsiaNicosia,
  [Timezone.PacificPonape]: Timezone.PacificPohnpei,
  [Timezone.PacificTruk]: Timezone.PacificChuuk,
  /*
   * Places tzdata dropped from zone.tab because their clocks have matched a
   * listed place since 1970 — America/Montreal keeps Toronto's time,
   * Asia/Chongqing keeps Shanghai's. tzdata calls them duplicates of that
   * location; the zone.tab name is the one offered.
   */
  [Timezone.AfricaTimbuktu]: Timezone.AfricaBamako,
  [Timezone.AmericaArgentinaComodRivadavia]: Timezone.AmericaArgentinaCatamarca,
  [Timezone.AmericaAtka]: Timezone.AmericaAdak,
  [Timezone.AmericaCoral_Harbour]: Timezone.AmericaAtikokan,
  [Timezone.AmericaEnsenada]: Timezone.AmericaTijuana,
  [Timezone.AmericaFort_Wayne]: Timezone.AmericaIndianaIndianapolis,
  [Timezone.AmericaMontreal]: Timezone.AmericaToronto,
  [Timezone.AmericaNipigon]: Timezone.AmericaToronto,
  [Timezone.AmericaPangnirtung]: Timezone.AmericaIqaluit,
  [Timezone.AmericaPorto_Acre]: Timezone.AmericaRio_Branco,
  [Timezone.AmericaRainy_River]: Timezone.AmericaWinnipeg,
  [Timezone.AmericaRosario]: Timezone.AmericaArgentinaCordoba,
  [Timezone.AmericaSanta_Isabel]: Timezone.AmericaTijuana,
  [Timezone.AmericaShiprock]: Timezone.AmericaDenver,
  [Timezone.AmericaThunder_Bay]: Timezone.AmericaToronto,
  [Timezone.AmericaYellowknife]: Timezone.AmericaEdmonton,
  [Timezone.AntarcticaSouth_Pole]: Timezone.AntarcticaMcMurdo,
  [Timezone.AsiaChoibalsan]: Timezone.AsiaUlaanbaatar,
  [Timezone.AsiaChongqing]: Timezone.AsiaShanghai,
  [Timezone.AsiaHarbin]: Timezone.AsiaShanghai,
  [Timezone.AsiaKashgar]: Timezone.AsiaUrumqi,
  [Timezone.AsiaTel_Aviv]: Timezone.AsiaJerusalem,
  [Timezone.AtlanticJan_Mayen]: Timezone.ArcticLongyearbyen,
  [Timezone.AustraliaCanberra]: Timezone.AustraliaSydney,
  [Timezone.AustraliaCurrie]: Timezone.AustraliaHobart,
  [Timezone.EuropeBelfast]: Timezone.EuropeLondon,
  [Timezone.EuropeTiraspol]: Timezone.EuropeChisinau,
  [Timezone.EuropeUzhgorod]: Timezone.EuropeKyiv,
  [Timezone.EuropeZaporozhye]: Timezone.EuropeKyiv,
  [Timezone.PacificEnderbury]: Timezone.PacificKanton,
  [Timezone.PacificJohnston]: Timezone.PacificHonolulu,
  [Timezone.PacificYap]: Timezone.PacificChuuk,
  /*
   * System V rule names. Since tzdata 2024b each is a plain link to a city,
   * and several were a trap to pick: "EST" never observes daylight saving,
   * so a New York user who chose it was an hour off every summer. Each maps
   * to the zone it has always matched, which keeps a stored value's clock
   * exactly as it was.
   */
  [Timezone.CET]: Timezone.EuropeBrussels,
  [Timezone.CST6CDT]: Timezone.AmericaChicago,
  [Timezone.EET]: Timezone.EuropeAthens,
  [Timezone.EST]: Timezone.AmericaPanama,
  [Timezone.EST5EDT]: Timezone.AmericaNew_York,
  [Timezone.HST]: Timezone.PacificHonolulu,
  [Timezone.MET]: Timezone.EuropeBrussels,
  [Timezone.MST]: Timezone.AmericaPhoenix,
  [Timezone.MST7MDT]: Timezone.AmericaDenver,
  [Timezone.PST8PDT]: Timezone.AmericaLos_Angeles,
  [Timezone.WET]: Timezone.EuropeLisbon,
  // The many spellings of UTC and GMT.
  [Timezone.EtcGMT]: Timezone.GMT,
  [Timezone.EtcGMTNegative0]: Timezone.GMT,
  [Timezone.EtcGMTPositive0]: Timezone.GMT,
  [Timezone.EtcGMT0]: Timezone.GMT,
  [Timezone.EtcGreenwich]: Timezone.GMT,
  [Timezone.EtcUCT]: Timezone.UTC,
  [Timezone.EtcUniversal]: Timezone.UTC,
  [Timezone.EtcUTC]: Timezone.UTC,
  [Timezone.EtcZulu]: Timezone.UTC,
  [Timezone.GMTNegative0]: Timezone.GMT,
  [Timezone.GMTPositive0]: Timezone.GMT,
  [Timezone.GMT0]: Timezone.GMT,
  [Timezone.Greenwich]: Timezone.GMT,
  [Timezone.UCT]: Timezone.UTC,
  [Timezone.Universal]: Timezone.UTC,
  [Timezone.Zulu]: Timezone.UTC,
  /*
   * Removed from tzdata in 2020b, so moment cannot resolve it at all. It was
   * a link to Los Angeles, and a stored value is read as that rather than
   * dropped.
   */
  [Timezone.USPacificNew]: Timezone.AmericaLos_Angeles,
};

type CanonicalIndex = Map<string, Timezone>;

/*
 * Every enum name, lower-cased, to its current name. moment matches zone
 * names case-insensitively, so "asia/calcutta" from an API caller or a
 * browser is a zone every reader accepts, and translating it should not
 * depend on how it was typed.
 */
const buildCanonicalIndex: () => CanonicalIndex = (): CanonicalIndex => {
  const index: CanonicalIndex = new Map<string, Timezone>();

  for (const timezone of Object.values(Timezone) as Array<Timezone>) {
    index.set(
      timezone.toLowerCase(),
      LEGACY_TIMEZONE_NAMES[timezone] || timezone,
    );
  }

  return index;
};

const CANONICAL_BY_LOWERCASE_NAME: CanonicalIndex = buildCanonicalIndex();

const LEGACY_LOWERCASE_NAMES: Set<string> = new Set<string>(
  Object.keys(LEGACY_TIMEZONE_NAMES).map((timezone: string): string => {
    return timezone.toLowerCase();
  }),
);

// Each current name to the legacy names that translate to it.
const buildLegacyNamesByCurrentName: () => Map<
  Timezone,
  Array<Timezone>
> = (): Map<Timezone, Array<Timezone>> => {
  const legacyNamesByCurrentName: Map<Timezone, Array<Timezone>> = new Map<
    Timezone,
    Array<Timezone>
  >();

  for (const legacyName of Object.keys(
    LEGACY_TIMEZONE_NAMES,
  ) as Array<Timezone>) {
    const currentName: Timezone = LEGACY_TIMEZONE_NAMES[legacyName]!;

    legacyNamesByCurrentName.set(currentName, [
      ...(legacyNamesByCurrentName.get(currentName) || []),
      legacyName,
    ]);
  }

  return legacyNamesByCurrentName;
};

const LEGACY_NAMES_BY_CURRENT_NAME: Map<
  Timezone,
  Array<Timezone>
> = buildLegacyNamesByCurrentName();

export default class TimezoneAlias {
  /*
   * True for a name kept only for backward compatibility — one the picker
   * does not offer because it offers the same clock under its current name.
   */
  public static isLegacyName(timezone: string | null | undefined): boolean {
    if (typeof timezone !== "string") {
      return false;
    }

    return LEGACY_LOWERCASE_NAMES.has(timezone.trim().toLowerCase());
  }

  /*
   * The name to store, display and match a timezone as.
   *
   * A legacy name comes back as its current name ("Singapore" ->
   * "Asia/Singapore"), a known name in any case or padding comes back in the
   * enum's spelling (" asia/singapore " -> "Asia/Singapore"), and anything
   * else — a zone newer than the enum, a typo, "" — comes back exactly as it
   * was given. This translates; it does not validate, and it never turns an
   * unknown value into a different unknown value.
   */
  public static getCanonicalTimezone(timezone: Timezone | string): Timezone {
    /*
     * Not a string at all is not a name to translate either. The types rule
     * it out, but browser storage is JSON-parsed on read, so a corrupt saved
     * value can arrive as a number or null, and it must come back as it was
     * rather than throw from whatever was reading it.
     */
    if (typeof timezone !== "string") {
      return timezone;
    }

    const canonical: Timezone | undefined = CANONICAL_BY_LOWERCASE_NAME.get(
      timezone.trim().toLowerCase(),
    );

    return canonical || (timezone as Timezone);
  }

  /*
   * The legacy names that translate to `timezone` — "Singapore" for
   * Asia/Singapore; US/Pacific, US/Pacific-New and PST8PDT for
   * America/Los_Angeles — or none. The picker lists them on the option so
   * that a stored legacy name still selects it.
   */
  public static getLegacyNamesOf(timezone: Timezone): Array<Timezone> {
    return [...(LEGACY_NAMES_BY_CURRENT_NAME.get(timezone) || [])];
  }

  /*
   * A list of timezones in their current names, with the duplicates that
   * translating produces removed: a status page subscribed in both
   * "Singapore" and "Asia/Singapore" lists one timezone, not the same one
   * twice. The first occurrence keeps its position.
   */
  public static getCanonicalTimezones(
    timezones: Array<Timezone | string>,
  ): Array<Timezone> {
    const seen: Set<Timezone> = new Set<Timezone>();
    const canonicalTimezones: Array<Timezone> = [];

    for (const timezone of timezones) {
      const canonical: Timezone = this.getCanonicalTimezone(timezone);

      if (seen.has(canonical)) {
        continue;
      }

      seen.add(canonical);
      canonicalTimezones.push(canonical);
    }

    return canonicalTimezones;
  }
}
