import {
  BREACH_DATA_ELEMENT_TYPES,
  BREACH_DATA_ELEMENTS,
  BREACH_LAW_RULES,
  BREACH_LAWS_CHECKED_ON,
  BREACH_PLACE_CHOICES,
  BREACH_PLACE_WORDS,
  BREACH_PLACES,
  CARD_BRAND_RULE_IDS,
  CARD_BRAND_RULES_CHECKED_ON,
  FOLLOW_UP_LAWS_CHECKED_ON,
  BreachCondition,
  BreachDataElement,
  BreachDeadlineStart,
  BreachDeadlineUnit,
  BreachLawFamily,
  BreachLawId,
  BreachLawRule,
  BreachPlace,
  COVERED_PLACES,
  EEA_COUNTRY_CODES,
  getBreachLawRule,
  getBreachPlaceOfCountry,
  isBreachLawId,
  isBreachPlace,
  isDeadlineWithoutLength,
  isUsStatePlace,
  isUsStateRule,
  ONLINE_ACCOUNT_TYPES,
  PASSWORD_TYPES,
  PERSON_NAME_TYPE,
  US_STATE_LAWS_CHECKED_ON,
} from "../../../Types/DataSecurity/BreachLaws";
import {
  applyBreachLaw,
  applyBreachLaws,
  BreachCheck,
  BreachCheckKind,
  BreachLawFacts,
  BreachObligation,
  BreachObligationStatus,
  BreachReason,
  BreachReasonKind,
  ExposureReads,
  ExposureReadsLogged,
  ExposureWhoseData,
  getMostUrgentObligation,
  getWhoseData,
} from "../../../Types/DataSecurity/ExposureAssessment";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BREACH LAWS TABLE (#10377): EVERY ROW HAS ITS SOURCE AND THE DAY IT
 * WAS CHECKED, AND EACH ROW SAYS - AND APPLIES - WHAT ITS SOURCE SAYS.
 *
 * Each row was read from its primary source on 2026-11-24. These tests pin
 * what the row holds: what triggers it, who must be told, its deadline in
 * its units and what that counts from, its conditions, and when it takes
 * effect; and they apply it to made-up facts, once where it may apply and
 * once where a fact rules it out. Changing a row means reading its source
 * again, and changing its test with it.
 */

// When every example exposure below was found: a Monday, 09:00 UTC.
const FOUND_AT: Date = new Date("2026-11-23T09:00:00.000Z");
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

function reads(logged: ExposureReadsLogged): ExposureReads {
  return {
    logged,
    isPublic: true,
    outsideAccounts: 0,
    outsideAccountsUsedInWindow: 0,
    isTreatedAsRead: logged !== ExposureReadsLogged.Logged,
  };
}

// A store's whose-data facts from its data types, its people's countries and where a person said they live.
function whose(data: {
  dataTypeIds: Array<string>;
  countries?: Array<string>;
  places?: Array<BreachPlace>;
  records?: number;
}): ExposureWhoseData {
  return getWhoseData({
    dataTypes: data.dataTypeIds.map((id: string) => {
      return {
        id,
        name: getBuiltInDataType(id)?.name || id,
        category: getBuiltInDataType(id)?.category || "",
      };
    }),
    estimatedRecords: data.records,
    subjectCountries: data.countries || [],
    placesNamed: data.places,
  });
}

function facts(
  data: Parameters<typeof whose>[0] & {
    logged?: ExposureReadsLogged;
    // When the exposure was found, when not FOUND_AT: which text of a law applies (#11425).
    foundAt?: Date;
    holdsForAnother?: boolean;
  },
  now: Date = NOW,
): BreachLawFacts {
  return {
    whose: whose(data),
    reads: reads(data.logged || ExposureReadsLogged.NotLogged),
    foundAt: data.foundAt || FOUND_AT,
    now,
    holdsForAnother: data.holdsForAnother,
  };
}

function apply(
  id: BreachLawId,
  data: Parameters<typeof facts>[0],
  now?: Date,
  dueAtOf?: ReadonlyMap<BreachLawId, Date>,
): BreachObligation {
  return applyBreachLaw(getBreachLawRule(id), facts(data, now), dueAtOf);
}

function checkKinds(obligation: BreachObligation): Array<BreachCheckKind> {
  return obligation.checks.map((check: BreachCheck): BreachCheckKind => {
    return check.kind;
  });
}

function conditions(obligation: BreachObligation): Array<BreachCondition> {
  return obligation.checks
    .filter((check: BreachCheck): boolean => {
      return check.kind === BreachCheckKind.Condition;
    })
    .map((check: BreachCheck): BreachCondition => {
      return check.condition!;
    });
}

function reasonKinds(obligation: BreachObligation): Array<BreachReasonKind> {
  return obligation.reasons.map((reason: BreachReason): BreachReasonKind => {
    return reason.kind;
  });
}

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// The days the table's rows were read from their sources, a batch at a time.
const TABLE_CHECK_DAYS: ReadonlyArray<string> = [
  BREACH_LAWS_CHECKED_ON,
  CARD_BRAND_RULES_CHECKED_ON,
  US_STATE_LAWS_CHECKED_ON,
  FOLLOW_UP_LAWS_CHECKED_ON,
];

/*
 * The US states' rows #10377 read first; every other state row is #10952's
 * (UsStateBreachLaws.test.ts), the first states' agencies' notices among them.
 */
const FIRST_STATE_ROWS: ReadonlyArray<BreachLawId> = [
  BreachLawId.CaliforniaResidents,
  BreachLawId.CaliforniaAttorneyGeneral,
  BreachLawId.ColoradoResidents,
  BreachLawId.ColoradoAttorneyGeneral,
  BreachLawId.FloridaIndividuals,
  BreachLawId.FloridaDepartment,
  BreachLawId.NewYorkResidents,
  BreachLawId.NewYorkAgencies,
  BreachLawId.TexasIndividuals,
  BreachLawId.TexasAttorneyGeneral,
  BreachLawId.WashingtonConsumers,
  BreachLawId.WashingtonAttorneyGeneral,
];

function after(ms: number): string {
  return new Date(FOUND_AT.getTime() + ms).toISOString();
}

describe("every row of the table", () => {
  test("has a unique id, a family, a law and a provision", () => {
    const ids: Array<string> = BREACH_LAW_RULES.map(
      (rule: BreachLawRule): string => {
        return rule.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...Object.values(BreachLawId)].sort());

    for (const rule of BREACH_LAW_RULES) {
      expect(Object.values(BreachLawFamily)).toContain(rule.family);
      expect(rule.law.trim().length).toBeGreaterThan(2);
      expect(rule.provision.trim().length).toBeGreaterThan(1);
    }
  });

  test.each(
    BREACH_LAW_RULES.map((rule: BreachLawRule): [string, BreachLawRule] => {
      return [rule.id, rule];
    }),
  )(
    "%s names its primary source, as a URL, and the day it was checked",
    (_id: string, rule: BreachLawRule) => {
      expect(rule.sourceUrl).toMatch(/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\//);
      expect(() => {
        return new URL(rule.sourceUrl);
      }).not.toThrow();
      expect(rule.sourceTitle.trim().length).toBeGreaterThan(5);
      expect(rule.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // One of the days the table was read on, each batch of rows on its own.
      expect(TABLE_CHECK_DAYS).toContain(rule.checkedOn);
      expect(Number.isNaN(new Date(rule.checkedOn).getTime())).toBe(false);
    },
  );

  test("each batch of rows was checked on its day: #10377's on 24 November 2026, the card brands' and the other US states' on 27 November, and #11424-#11427's on 28 November", () => {
    expect(BREACH_LAWS_CHECKED_ON).toBe("2026-11-24");
    expect(CARD_BRAND_RULES_CHECKED_ON).toBe("2026-11-27");
    expect(US_STATE_LAWS_CHECKED_ON).toBe("2026-11-27");
    expect(FOLLOW_UP_LAWS_CHECKED_ON).toBe("2026-11-28");

    for (const id of CARD_BRAND_RULE_IDS) {
      expect(getBreachLawRule(id).checkedOn).toBe(CARD_BRAND_RULES_CHECKED_ON);
    }

    for (const rule of BREACH_LAW_RULES) {
      if (isUsStateRule(rule)) {
        // Each later row's own day is held by its line in UsStateBreachLaws.test.ts.
        expect({ id: rule.id, checkedOn: rule.checkedOn }).toEqual({
          id: rule.id,
          checkedOn: FIRST_STATE_ROWS.includes(rule.id)
            ? BREACH_LAWS_CHECKED_ON
            : [US_STATE_LAWS_CHECKED_ON, FOLLOW_UP_LAWS_CHECKED_ON].includes(
                  rule.checkedOn,
                )
              ? rule.checkedOn
              : US_STATE_LAWS_CHECKED_ON,
        });
      }
    }

    // The processors' notices were read with #11427.
    for (const id of [BreachLawId.GdprProcessor, BreachLawId.UkGdprProcessor]) {
      expect(getBreachLawRule(id).checkedOn).toBe(FOLLOW_UP_LAWS_CHECKED_ON);
    }

    // Every day a row was read is a day some row was read: none left over.
    for (const day of TABLE_CHECK_DAYS) {
      expect(
        BREACH_LAW_RULES.some((rule: BreachLawRule): boolean => {
          return rule.checkedOn === day;
        }),
      ).toBe(true);
    }
  });

  test.each(
    BREACH_LAW_RULES.map((rule: BreachLawRule): [string, BreachLawRule] => {
      return [rule.id, rule];
    }),
  )(
    "%s says who must be told, what to do and a deadline that holds together",
    (_id: string, rule: BreachLawRule) => {
      expect(rule.action.trim().length).toBeGreaterThan(5);
      expect(rule.recipient.trim().length).toBeGreaterThan(5);
      expect(rule.dataElements.length).toBeGreaterThan(0);

      const unit: BreachDeadlineUnit = rule.deadline.unit;

      if (isDeadlineWithoutLength(unit)) {
        expect(rule.deadline.amount).toBeUndefined();
      } else {
        expect(typeof rule.deadline.amount).toBe("number");
        expect(rule.deadline.amount!).toBeGreaterThanOrEqual(0);
      }

      if (rule.deadline.start === BreachDeadlineStart.PeopleNotified) {
        expect(rule.deadline.afterRule).toBeDefined();
        expect(isBreachLawId(rule.deadline.afterRule)).toBe(true);
        expect(getBreachLawRule(rule.deadline.afterRule!).family).toBe(
          rule.family,
        );
      } else {
        expect(rule.deadline.afterRule).toBeUndefined();
      }

      for (const element of rule.nameFreeElements) {
        expect(rule.dataElements).toContain(element);
      }

      if (rule.inForceFrom) {
        expect(rule.inForceFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // A row replaced by a newer text ends the day a row of the same notice starts (#11425).
      if (rule.inForceUntil) {
        expect(rule.inForceUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(
          BREACH_LAW_RULES.some((other: BreachLawRule): boolean => {
            return (
              other.id !== rule.id &&
              other.family === rule.family &&
              other.provision === rule.provision &&
              other.inForceFrom === rule.inForceUntil
            );
          }),
        ).toBe(true);
      }
    },
  );

  test("every data element's data types are in the catalog", () => {
    for (const element of BREACH_DATA_ELEMENTS) {
      for (const id of BREACH_DATA_ELEMENT_TYPES[element]) {
        expect({ element, id, known: Boolean(getBuiltInDataType(id)) }).toEqual(
          { element, id, known: true },
        );
      }
    }

    for (const id of [
      ...ONLINE_ACCOUNT_TYPES,
      ...PASSWORD_TYPES,
      PERSON_NAME_TYPE,
    ]) {
      expect(getBuiltInDataType(id)).toBeDefined();
    }
  });

  test("getBreachLawRule finds every row and refuses an unknown one", () => {
    for (const id of Object.values(BreachLawId)) {
      expect(getBreachLawRule(id).id).toBe(id);
    }

    expect(() => {
      return getBreachLawRule("no-such-law" as BreachLawId);
    }).toThrow();
    expect(isBreachLawId("gdpr-art-33")).toBe(true);
    expect(isBreachLawId("gdpr")).toBe(false);
    expect(isBreachLawId(7)).toBe(false);
  });
});

describe("where the people live", () => {
  test("the EEA is the EU's 27 with Iceland, Liechtenstein and Norway", () => {
    expect(EEA_COUNTRY_CODES).toHaveLength(30);
    expect(new Set(EEA_COUNTRY_CODES).size).toBe(30);

    for (const code of ["DE", "FR", "IE", "NL", "IS", "LI", "NO", "HR"]) {
      expect(getBreachPlaceOfCountry(code)).toBe(BreachPlace.Eea);
    }

    // Switzerland and the UK are not in the EEA.
    expect(getBreachPlaceOfCountry("CH")).toBe(BreachPlace.Elsewhere);
    expect(getBreachPlaceOfCountry("GB")).toBe(BreachPlace.UnitedKingdom);
  });

  test("a country is the table's place, in any case of its code", () => {
    expect(getBreachPlaceOfCountry("gb")).toBe(BreachPlace.UnitedKingdom);
    expect(getBreachPlaceOfCountry("UK")).toBe(BreachPlace.UnitedKingdom);
    expect(getBreachPlaceOfCountry(" us ")).toBe(BreachPlace.UnitedStates);
    expect(getBreachPlaceOfCountry("BR")).toBe(BreachPlace.Brazil);
    expect(getBreachPlaceOfCountry("IN")).toBe(BreachPlace.India);
    expect(getBreachPlaceOfCountry("JP")).toBe(BreachPlace.Elsewhere);
    // Puerto Rico, Guam and the US Virgin Islands have codes of their own, and laws the table holds (#11424, #11426).
    expect(getBreachPlaceOfCountry("pr")).toBe(BreachPlace.PuertoRico);
    expect(getBreachPlaceOfCountry("GU")).toBe(BreachPlace.Guam);
    expect(getBreachPlaceOfCountry("VI")).toBe(BreachPlace.UsVirginIslands);
  });

  test("every place has its words and its choice, and the states are states", () => {
    for (const place of BREACH_PLACES) {
      expect(BREACH_PLACE_WORDS[place].length).toBeGreaterThan(2);
      expect(BREACH_PLACE_CHOICES[place].length).toBeGreaterThan(2);
      expect(isBreachPlace(place)).toBe(true);
    }

    expect(isBreachPlace("EU")).toBe(false);
    expect(isUsStatePlace(BreachPlace.Texas)).toBe(true);
    expect(isUsStatePlace(BreachPlace.OtherUsState)).toBe(true);
    expect(isUsStatePlace(BreachPlace.UnitedStates)).toBe(false);
    expect(COVERED_PLACES).not.toContain(BreachPlace.Elsewhere);
    expect(COVERED_PLACES).not.toContain(BreachPlace.OtherUsState);
  });
});

/*
 * ---------------------------------------------------------------------------
 * One test per row
 * ---------------------------------------------------------------------------
 */

describe("GDPR Article 33: the supervisory authority within 72 hours", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.GdprAuthority);

  test("says what Article 33(1) says", () => {
    expect(rule.law).toBe("GDPR");
    expect(rule.provision).toBe("Article 33");
    expect(rule.places).toEqual([BreachPlace.Eea]);
    expect(rule.dataElements).toEqual([BreachDataElement.PersonalData]);
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.conditions).toEqual([BreachCondition.RiskToPeople]);
    expect(rule.recipient).toContain("supervisory authority");
    expect(rule.deadlineNote).toContain("weekends and holidays included");
    expect(rule.sourceUrl).toBe(
      "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    );
  });

  test("may apply to EU people's emails, due 72 hours after it was found", () => {
    const obligation: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
      countries: ["DE"],
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.isPlaceKnown).toBe(true);
    expect(obligation.dueAt).toBe(after(72 * HOUR));
    expect(obligation.foundAt).toBe(FOUND_AT.toISOString());
    expect(reasonKinds(obligation)).toEqual([
      BreachReasonKind.PeopleIn,
      BreachReasonKind.Holds,
      BreachReasonKind.ReadsNotLogged,
    ]);
    expect(conditions(obligation)).toEqual([BreachCondition.RiskToPeople]);
  });

  test("is not triggered by a store with nothing personal in it", () => {
    const obligation: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["aws-secret-access-key"],
      countries: ["DE"],
    });

    expect(obligation.status).toBe(BreachObligationStatus.NotTriggered);
    expect(reasonKinds(obligation)).toEqual([BreachReasonKind.NoPersonalData]);
    expect(obligation.dueAt).toBeUndefined();
  });

  test("asks where the people live when nobody knows, and is ruled out when a person says elsewhere", () => {
    const unknown: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
    });

    expect(unknown.status).toBe(BreachObligationStatus.MayApply);
    expect(unknown.isPlaceKnown).toBe(false);
    expect(checkKinds(unknown)).toContain(BreachCheckKind.PeopleLiveIn);

    const elsewhere: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
      places: [BreachPlace.UnitedStates],
    });

    expect(elsewhere.status).toBe(BreachObligationStatus.NotTriggered);
    expect(reasonKinds(elsewhere)).toEqual([
      BreachReasonKind.PeopleNamedElsewhere,
    ]);
  });
});

describe("GDPR Article 34: the people, without undue delay, when the risk is high", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.GdprPeople);

  test("says what Article 34(1) says", () => {
    expect(rule.provision).toBe("Article 34");
    expect(rule.deadline.unit).toBe(BreachDeadlineUnit.WithoutUndueDelay);
    expect(rule.conditions).toEqual([BreachCondition.HighRiskToPeople]);
    expect(rule.note).toContain("Article 34(3)");
  });

  test("may apply with no due moment, and the high risk left to a person", () => {
    const obligation: BreachObligation = apply(BreachLawId.GdprPeople, {
      dataTypeIds: ["email-address", "person-name"],
      countries: ["FR"],
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.dueAt).toBeUndefined();
    expect(conditions(obligation)).toEqual([BreachCondition.HighRiskToPeople]);
  });
});

describe("UK GDPR Article 33: the Information Commission within 72 hours", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.UkGdprAuthority);

  test("names the Information Commission, which replaced the ICO on 30 September 2026", () => {
    expect(rule.law).toBe("UK GDPR");
    expect(rule.places).toEqual([BreachPlace.UnitedKingdom]);
    expect(rule.recipient).toContain("Information Commission");
    expect(rule.recipient).toContain("30 September 2026");
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.sourceUrl).toBe(
      "https://www.legislation.gov.uk/eur/2016/679/article/33",
    );
  });

  test("may apply to people in the UK, and not to EU people alone", () => {
    expect(
      apply(BreachLawId.UkGdprAuthority, {
        dataTypeIds: ["uk-nino"],
        countries: ["GB"],
      }).dueAt,
    ).toBe(after(72 * HOUR));

    const eu: BreachObligation = apply(BreachLawId.UkGdprAuthority, {
      dataTypeIds: ["email-address"],
      countries: ["DE"],
    });

    // EU people known does not rule the UK out: nobody said where the rest live.
    expect(eu.status).toBe(BreachObligationStatus.MayApply);
    expect(eu.isPlaceKnown).toBe(false);
  });
});

describe("UK GDPR Article 34: the people, without undue delay", () => {
  test("says what Article 34(1) says", () => {
    const rule: BreachLawRule = getBreachLawRule(BreachLawId.UkGdprPeople);

    expect(rule.deadline.unit).toBe(BreachDeadlineUnit.WithoutUndueDelay);
    expect(rule.conditions).toEqual([BreachCondition.HighRiskToPeople]);
    expect(rule.sourceUrl).toBe(
      "https://www.legislation.gov.uk/eur/2016/679/article/34",
    );
    expect(
      apply(BreachLawId.UkGdprPeople, {
        dataTypeIds: ["email-address"],
        countries: ["GB"],
      }).status,
    ).toBe(BreachObligationStatus.MayApply);
  });
});

describe("HIPAA 164.404: the people within 60 calendar days", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.HipaaPeople);

  test("says what 45 CFR 164.404(b) says", () => {
    expect(rule.law).toBe("HIPAA");
    expect(rule.provision).toBe("45 CFR 164.404");
    expect(rule.places).toBeNull();
    expect(rule.dataElements).toEqual([
      BreachDataElement.MedicalInformation,
      BreachDataElement.HealthInsurance,
    ]);
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.conditions).toEqual([BreachCondition.HipaaCoveredEntity]);
    expect(rule.note).toContain("164.402");
  });

  test("may apply to health data wherever the people live, if a covered entity holds it", () => {
    const obligation: BreachObligation = apply(BreachLawId.HipaaPeople, {
      dataTypeIds: ["medical-record-number"],
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.isPlaceKnown).toBe(true);
    expect(obligation.dueAt).toBe(after(60 * DAY));
    expect(conditions(obligation)).toEqual([
      BreachCondition.HipaaCoveredEntity,
    ]);
  });

  test("is not triggered without health data", () => {
    expect(
      apply(BreachLawId.HipaaPeople, { dataTypeIds: ["us-ssn"] }).status,
    ).toBe(BreachObligationStatus.NotTriggered);
  });
});

describe("HIPAA 164.406: the media, for more than 500 residents of a state", () => {
  test("says what 45 CFR 164.406 says, and leaves the count to a person", () => {
    const rule: BreachLawRule = getBreachLawRule(BreachLawId.HipaaMedia);

    expect(rule.minimumPeople).toEqual({ count: 500, isMoreThan: true });
    expect(rule.deadline.amount).toBe(60);
    expect(rule.deadline.unit).toBe(BreachDeadlineUnit.CalendarDays);

    const obligation: BreachObligation = apply(BreachLawId.HipaaMedia, {
      dataTypeIds: ["health-plan-id"],
      records: 12000,
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(checkKinds(obligation)).toContain(BreachCheckKind.PeopleCount);
    expect(reasonKinds(obligation)).toContain(BreachReasonKind.Records);
    expect(
      obligation.reasons.find((reason: BreachReason): boolean => {
        return reason.kind === BreachReasonKind.Records;
      })?.records,
    ).toBe(12000);
  });
});

describe("HIPAA 164.408(b): the Secretary with the notice, for 500 or more", () => {
  test("says what 45 CFR 164.408(b) says", () => {
    const rule: BreachLawRule = getBreachLawRule(
      BreachLawId.HipaaSecretaryLarge,
    );

    expect(rule.minimumPeople).toEqual({ count: 500, isMoreThan: false });
    expect(rule.deadlineNote).toContain(
      "same time as the notice to the people",
    );
    expect(
      apply(BreachLawId.HipaaSecretaryLarge, {
        dataTypeIds: ["diagnosis-code"],
      }).dueAt,
    ).toBe(after(60 * DAY));
  });
});

describe("HIPAA 164.408(c): the Secretary yearly, for fewer than 500", () => {
  test("is due 60 days after the end of the calendar year it was found in", () => {
    const rule: BreachLawRule = getBreachLawRule(
      BreachLawId.HipaaSecretarySmall,
    );

    expect(rule.fewerPeopleThan).toBe(500);
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.EndOfCalendarYear,
    });

    const obligation: BreachObligation = apply(
      BreachLawId.HipaaSecretarySmall,
      {
        dataTypeIds: ["drug-code"],
      },
    );

    // 2027 is no leap year: the 60th day after 31 December 2026 is 1 March 2027.
    expect(obligation.dueAt).toBe("2027-03-01T23:59:00.000Z");
    expect(checkKinds(obligation)).toContain(BreachCheckKind.FewerPeopleThan);
  });
});

describe("HIPAA 164.410: a business associate tells the covered entity", () => {
  test("says what 45 CFR 164.410(b) says", () => {
    const rule: BreachLawRule = getBreachLawRule(
      BreachLawId.HipaaBusinessAssociate,
    );

    expect(rule.conditions).toEqual([BreachCondition.HipaaBusinessAssociate]);
    expect(rule.deadline.amount).toBe(60);

    const obligation: BreachObligation = apply(
      BreachLawId.HipaaBusinessAssociate,
      { dataTypeIds: ["health-information"] },
    );

    expect(obligation.dueAt).toBe(after(60 * DAY));
    expect(conditions(obligation)).toEqual([
      BreachCondition.HipaaBusinessAssociate,
    ]);
  });

  test("is a notice a business that holds the data for another owes, so it waits on that answer (#11427)", () => {
    const rule: BreachLawRule = getBreachLawRule(
      BreachLawId.HipaaBusinessAssociate,
    );
    const held: (holdsForAnother?: boolean) => boolean = (
      holdsForAnother?: boolean,
    ): boolean => {
      return applyBreachLaws(
        facts({ dataTypeIds: ["health-information"], holdsForAnother }),
      ).some((obligation: BreachObligation): boolean => {
        return obligation.ruleId === rule.id;
      });
    };

    expect(rule.forDataHolders).toBe(true);
    expect(held()).toBe(false);
    expect(held(false)).toBe(false);
    expect(held(true)).toBe(true);
  });
});

describe("GDPR and UK GDPR Article 33(2): a processor tells its controller without undue delay (#11427)", () => {
  const ROWS: ReadonlyArray<[BreachLawId, BreachPlace, BreachLawFamily]> = [
    [BreachLawId.GdprProcessor, BreachPlace.Eea, BreachLawFamily.Gdpr],
    [
      BreachLawId.UkGdprProcessor,
      BreachPlace.UnitedKingdom,
      BreachLawFamily.UkGdpr,
    ],
  ];

  test.each(ROWS)(
    "%s says what Article 33(2) says, read on 28 November 2026",
    (id: BreachLawId, place: BreachPlace, family: BreachLawFamily) => {
      const rule: BreachLawRule = getBreachLawRule(id);

      expect({
        family: rule.family,
        provision: rule.provision,
        places: rule.places,
        dataElements: rule.dataElements,
        needsName: rule.needsName,
        conditions: rule.conditions,
        deadline: rule.deadline,
        forDataHolders: rule.forDataHolders,
      }).toEqual({
        family,
        provision: "Article 33(2)",
        places: [place],
        dataElements: [BreachDataElement.PersonalData],
        needsName: false,
        // No risk test: the controller weighs the risk; the processor tells it either way.
        conditions: [],
        deadline: {
          unit: BreachDeadlineUnit.WithoutUndueDelay,
          start: BreachDeadlineStart.Found,
        },
        forDataHolders: true,
      });
      expect(rule.action).toBe("Notify the controller");
      expect(rule.recipient).toBe("The controller you process the data for");
      expect(rule.sourceTitle).toContain("Article 33(2)");
      expect(rule.checkedOn).toBe(FOLLOW_UP_LAWS_CHECKED_ON);
    },
  );

  test.each(ROWS)(
    "%s may apply to its people's personal data once the data is held for another, and is left out until then",
    (id: BreachLawId, place: BreachPlace) => {
      const example: Parameters<typeof facts>[0] = {
        dataTypeIds: ["email-address", "person-name"],
        places: [place],
      };
      const find: (holdsForAnother?: boolean) => BreachObligation | undefined =
        (holdsForAnother?: boolean): BreachObligation | undefined => {
          return applyBreachLaws(facts({ ...example, holdsForAnother })).find(
            (obligation: BreachObligation): boolean => {
              return obligation.ruleId === id;
            },
          );
        };

      expect(find()).toBeUndefined();
      expect(find(false)).toBeUndefined();

      const held: BreachObligation = find(true)!;

      expect(held.status).toBe(BreachObligationStatus.MayApply);
      expect(held.isPlaceKnown).toBe(true);
      // Without undue delay: no due moment to count to.
      expect(held.dueAt).toBeUndefined();
      expect(conditions(held)).toEqual([]);
      // Nothing personal, no notice.
      expect(
        apply(id, {
          dataTypeIds: ["aws-secret-access-key"],
          places: [place],
          holdsForAnother: true,
        }).status,
      ).toBe(BreachObligationStatus.NotTriggered);
    },
  );
});

describe("California Civil Code 1798.82(a): residents within 30 calendar days", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.CaliforniaResidents);

  test("says what SB 446's 1798.82(a) says", () => {
    expect(rule.places).toEqual([BreachPlace.California]);
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.needsName).toBe(true);
    expect(rule.nameFreeElements).toEqual([
      BreachDataElement.OnlineCredentials,
    ]);
    expect(rule.note).toContain("SB 446");
    expect(rule.inForceFrom).toBe("2026-01-01");
    expect(rule.dataElements).toEqual(
      expect.arrayContaining([
        BreachDataElement.SocialSecurityNumber,
        BreachDataElement.DriversLicense,
        BreachDataElement.PassportNumber,
        BreachDataElement.TaxIdNumber,
        BreachDataElement.OtherGovernmentId,
        BreachDataElement.FinancialAccount,
        BreachDataElement.MedicalInformation,
        BreachDataElement.HealthInsurance,
        BreachDataElement.Biometric,
        BreachDataElement.Genetic,
        BreachDataElement.OnlineCredentials,
      ]),
    );
  });

  test("may apply to Californians' Social Security numbers held with names", () => {
    const obligation: BreachObligation = apply(
      BreachLawId.CaliforniaResidents,
      {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [BreachPlace.California],
      },
    );

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.dueAt).toBe(after(30 * DAY));
    expect(checkKinds(obligation)).not.toContain(BreachCheckKind.HeldWithNames);
  });

  test("asks whether names were held with the numbers when none were found", () => {
    expect(
      checkKinds(
        apply(BreachLawId.CaliforniaResidents, {
          dataTypeIds: ["us-ssn"],
          places: [BreachPlace.California],
        }),
      ),
    ).toContain(BreachCheckKind.HeldWithNames);

    // A login needs no name.
    expect(
      checkKinds(
        apply(BreachLawId.CaliforniaResidents, {
          dataTypeIds: ["email-address", "generic-secret"],
          places: [BreachPlace.California],
        }),
      ),
    ).not.toContain(BreachCheckKind.HeldWithNames);
  });

  test("is not triggered by emails alone, and not before it took effect", () => {
    expect(
      apply(BreachLawId.CaliforniaResidents, {
        dataTypeIds: ["email-address"],
        places: [BreachPlace.California],
      }).status,
    ).toBe(BreachObligationStatus.NotTriggered);

    // Found on the last evening of 2025, and assessed then: not yet in force.
    const before: BreachObligation = apply(
      BreachLawId.CaliforniaResidents,
      {
        dataTypeIds: ["us-ssn"],
        places: [BreachPlace.California],
        foundAt: new Date("2025-12-31T23:00:00.000Z"),
      },
      new Date("2025-12-31T23:00:00.000Z"),
    );

    expect(before.status).toBe(BreachObligationStatus.NotYetInForce);
    expect(before.reasons[0]).toEqual({
      kind: BreachReasonKind.NotInForce,
      date: "2026-01-01",
    });

    // Found then, and assessed once it took effect: the day it was found decides (#11425).
    const assessedLater: BreachObligation = apply(
      BreachLawId.CaliforniaResidents,
      {
        dataTypeIds: ["us-ssn"],
        places: [BreachPlace.California],
        foundAt: new Date("2025-12-31T23:00:00.000Z"),
      },
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(assessedLater.status).toBe(BreachObligationStatus.NotTriggered);
    expect(assessedLater.reasons).toEqual([
      { kind: BreachReasonKind.InForceAfterFound, date: "2026-01-01" },
    ]);

    // Found once it took effect, it may apply.
    expect(
      apply(
        BreachLawId.CaliforniaResidents,
        {
          dataTypeIds: ["us-ssn", "person-name"],
          places: [BreachPlace.California],
          foundAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        new Date("2026-01-02T00:00:00.000Z"),
      ).status,
    ).toBe(BreachObligationStatus.MayApply);
  });
});

describe("California Civil Code 1798.82(f): the attorney general's sample, 15 days after the people", () => {
  test("follows the residents' notice, for more than 500 Californians", () => {
    const rule: BreachLawRule = getBreachLawRule(
      BreachLawId.CaliforniaAttorneyGeneral,
    );

    expect(rule.minimumPeople).toEqual({ count: 500, isMoreThan: true });
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 15,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.CaliforniaResidents,
    });

    const residentsDue: Date = new Date(after(30 * DAY));
    const obligation: BreachObligation = apply(
      BreachLawId.CaliforniaAttorneyGeneral,
      {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [BreachPlace.California],
      },
      undefined,
      new Map([[BreachLawId.CaliforniaResidents, residentsDue]]),
    );

    expect(obligation.dueAt).toBe(after(45 * DAY));
    expect(obligation.isDueAtTheLatest).toBe(true);
    expect(checkKinds(obligation)).toContain(BreachCheckKind.PeopleCount);
  });
});

describe("Colorado 6-1-716: residents, and the attorney general for 500 or more, within 30 days", () => {
  test("says what the attorney general's guidance says", () => {
    const residents: BreachLawRule = getBreachLawRule(
      BreachLawId.ColoradoResidents,
    );
    const attorneyGeneral: BreachLawRule = getBreachLawRule(
      BreachLawId.ColoradoAttorneyGeneral,
    );

    expect(residents.places).toEqual([BreachPlace.Colorado]);
    expect(residents.deadline.amount).toBe(30);
    expect(residents.conditions).toEqual([BreachCondition.LikelyMisuse]);
    expect(residents.nameFreeElements).toEqual([
      BreachDataElement.OnlineCredentials,
      BreachDataElement.FinancialAccount,
    ]);
    expect(attorneyGeneral.minimumPeople).toEqual({
      count: 500,
      isMoreThan: false,
    });
    expect(residents.sourceUrl).toBe(
      "https://coag.gov/resources/data-protection-laws/",
    );
  });

  test("may apply to Coloradans' driver's licenses, due in 30 days", () => {
    expect(
      apply(BreachLawId.ColoradoResidents, {
        dataTypeIds: ["us-drivers-license", "person-name"],
        places: [BreachPlace.Colorado],
      }).dueAt,
    ).toBe(after(30 * DAY));
    expect(
      apply(BreachLawId.ColoradoAttorneyGeneral, {
        dataTypeIds: ["us-drivers-license", "person-name"],
        places: [BreachPlace.Colorado],
      }).dueAt,
    ).toBe(after(30 * DAY));
  });
});

describe("Florida 501.171: individuals and the Department of Legal Affairs within 30 days", () => {
  test("says what 501.171(3) and (4) say", () => {
    const individuals: BreachLawRule = getBreachLawRule(
      BreachLawId.FloridaIndividuals,
    );
    const department: BreachLawRule = getBreachLawRule(
      BreachLawId.FloridaDepartment,
    );

    expect(individuals.places).toEqual([BreachPlace.Florida]);
    expect(individuals.conditions).toEqual([
      BreachCondition.IdentityTheftOrFinancialHarm,
    ]);
    // Florida added geolocation and biometric data in 2026.
    expect(individuals.dataElements).toEqual(
      expect.arrayContaining([
        BreachDataElement.Geolocation,
        BreachDataElement.Biometric,
      ]),
    );
    expect(department.minimumPeople).toEqual({ count: 500, isMoreThan: false });
    expect(department.recipient).toContain("Department of Legal Affairs");
    expect(department.deadlineNote).toContain("Fifteen more days");
  });

  test("may apply to Floridians' geolocation held with names", () => {
    const obligation: BreachObligation = apply(BreachLawId.FloridaIndividuals, {
      dataTypeIds: ["geolocation", "person-name"],
      places: [BreachPlace.Florida],
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.dueAt).toBe(after(30 * DAY));
  });
});

describe("New York GBL 899-aa: residents within 30 days, and the state agencies with them", () => {
  test("says what 899-aa(2) and (8)(a) say", () => {
    const residents: BreachLawRule = getBreachLawRule(
      BreachLawId.NewYorkResidents,
    );
    const agencies: BreachLawRule = getBreachLawRule(
      BreachLawId.NewYorkAgencies,
    );

    expect(residents.deadline.amount).toBe(30);
    expect(residents.needsName).toBe(false);
    expect(agencies.recipient).toContain("Department of Financial Services");
    expect(agencies.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.NewYorkResidents,
    });
  });

  test("covers Social Security numbers with no name, and the agencies are due with the people", () => {
    const residents: BreachObligation = apply(BreachLawId.NewYorkResidents, {
      dataTypeIds: ["us-ssn"],
      places: [BreachPlace.NewYork],
    });

    expect(residents.status).toBe(BreachObligationStatus.MayApply);
    expect(checkKinds(residents)).not.toContain(BreachCheckKind.HeldWithNames);

    const agencies: BreachObligation = apply(
      BreachLawId.NewYorkAgencies,
      { dataTypeIds: ["us-ssn"], places: [BreachPlace.NewYork] },
      undefined,
      new Map([[BreachLawId.NewYorkResidents, new Date(residents.dueAt!)]]),
    );

    expect(agencies.dueAt).toBe(residents.dueAt);
  });

  test("does not cover a passport number", () => {
    expect(
      apply(BreachLawId.NewYorkResidents, {
        dataTypeIds: ["us-passport"],
        places: [BreachPlace.NewYork],
      }).status,
    ).toBe(BreachObligationStatus.NotTriggered);
  });
});

describe("Texas 521.053: individuals within 60 days, the attorney general within 30 for 250 or more", () => {
  test("says what the attorney general's guidance says", () => {
    const individuals: BreachLawRule = getBreachLawRule(
      BreachLawId.TexasIndividuals,
    );
    const attorneyGeneral: BreachLawRule = getBreachLawRule(
      BreachLawId.TexasAttorneyGeneral,
    );

    expect(individuals.deadline.amount).toBe(60);
    expect(attorneyGeneral.deadline.amount).toBe(30);
    expect(attorneyGeneral.minimumPeople).toEqual({
      count: 250,
      isMoreThan: false,
    });
    expect(individuals.nameFreeElements).toEqual([
      BreachDataElement.MedicalInformation,
      BreachDataElement.HealthInsurance,
    ]);
    expect(individuals.deadlineNote).toContain("determine a breach occurred");
  });

  test("covers health information without a name, and the attorney general is due first", () => {
    const individuals: BreachObligation = apply(BreachLawId.TexasIndividuals, {
      dataTypeIds: ["medical-record-number"],
      places: [BreachPlace.Texas],
    });
    const attorneyGeneral: BreachObligation = apply(
      BreachLawId.TexasAttorneyGeneral,
      { dataTypeIds: ["medical-record-number"], places: [BreachPlace.Texas] },
    );

    expect(checkKinds(individuals)).not.toContain(
      BreachCheckKind.HeldWithNames,
    );
    expect(individuals.dueAt).toBe(after(60 * DAY));
    expect(attorneyGeneral.dueAt).toBe(after(30 * DAY));
  });
});

describe("Washington 19.255.010: consumers and the attorney general within 30 days", () => {
  test("says what RCW 19.255.010(7) and (8) say", () => {
    const consumers: BreachLawRule = getBreachLawRule(
      BreachLawId.WashingtonConsumers,
    );
    const attorneyGeneral: BreachLawRule = getBreachLawRule(
      BreachLawId.WashingtonAttorneyGeneral,
    );

    expect(consumers.deadline.amount).toBe(30);
    expect(consumers.conditions).toEqual([BreachCondition.RiskOfHarm]);
    expect(consumers.dataElements).toContain(BreachDataElement.DateOfBirth);
    expect(attorneyGeneral.minimumPeople).toEqual({
      count: 500,
      isMoreThan: true,
    });
  });

  test("covers dates of birth, with or without names", () => {
    const obligation: BreachObligation = apply(
      BreachLawId.WashingtonConsumers,
      {
        dataTypeIds: ["date-of-birth"],
        places: [BreachPlace.Washington],
      },
    );

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.dueAt).toBe(after(30 * DAY));
    expect(checkKinds(obligation)).not.toContain(BreachCheckKind.HeldWithNames);
  });
});

describe("LGPD and ANPD Resolution 15: the ANPD and the people within 3 business days", () => {
  test("says what Article 48 and Resolution 15's Articles 6 and 9 say", () => {
    const authority: BreachLawRule = getBreachLawRule(
      BreachLawId.LgpdAuthority,
    );
    const people: BreachLawRule = getBreachLawRule(BreachLawId.LgpdPeople);

    for (const rule of [authority, people]) {
      expect(rule.places).toEqual([BreachPlace.Brazil]);
      expect(rule.deadline).toEqual({
        unit: BreachDeadlineUnit.BusinessDays,
        amount: 3,
        start: BreachDeadlineStart.Found,
      });
      expect(rule.conditions).toEqual([BreachCondition.RelevantRiskToPeople]);
      expect(rule.sourceUrl).toContain("in.gov.br");
    }

    expect(authority.sourceTitle).toContain("Article 6");
    expect(people.sourceTitle).toContain("Article 9");
    expect(authority.note).toContain("large scale");
  });

  test("skips the weekend: found on a Friday, due on the Wednesday", () => {
    const friday: BreachLawFacts = {
      ...facts({ dataTypeIds: ["br-cpf"], countries: ["BR"] }),
      foundAt: new Date("2026-11-20T18:00:00.000Z"),
    };
    const obligation: BreachObligation = applyBreachLaw(
      getBreachLawRule(BreachLawId.LgpdAuthority),
      friday,
    );

    expect(obligation.dueAt).toBe("2026-11-25T18:00:00.000Z");
  });
});

describe("DPDP Rules 2025, Rule 7: the people and the Board, from 13 May 2027", () => {
  test("says what Rule 7 says, and when it takes effect", () => {
    const people: BreachLawRule = getBreachLawRule(BreachLawId.DpdpPeople);
    const board: BreachLawRule = getBreachLawRule(BreachLawId.DpdpBoard);

    expect(people.deadline.unit).toBe(BreachDeadlineUnit.WithoutUndueDelay);
    expect(board.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    });

    for (const rule of [people, board]) {
      expect(rule.inForceFrom).toBe("2027-05-13");
      expect(rule.places).toEqual([BreachPlace.India]);
      expect(rule.note).toContain("13 November 2025");
    }
  });

  test("is not in force today, and is for an exposure found once its day comes", () => {
    const today: BreachObligation = apply(BreachLawId.DpdpBoard, {
      dataTypeIds: ["in-aadhaar"],
      countries: ["IN"],
    });

    expect(today.status).toBe(BreachObligationStatus.NotYetInForce);
    expect(today.dueAt).toBeUndefined();

    const foundThatDay: Date = new Date("2027-05-13T00:00:00.000Z");
    const later: BreachObligation = apply(
      BreachLawId.DpdpBoard,
      { dataTypeIds: ["in-aadhaar"], countries: ["IN"], foundAt: foundThatDay },
      foundThatDay,
    );

    expect(later.status).toBe(BreachObligationStatus.MayApply);
    expect(later.dueAt).toBe(
      new Date(foundThatDay.getTime() + 72 * HOUR).toISOString(),
    );
  });

  test("an exposure found before its day follows the law of that day, though it is assessed later (#11425)", () => {
    const foundBefore: BreachObligation = apply(
      BreachLawId.DpdpBoard,
      { dataTypeIds: ["in-aadhaar"], countries: ["IN"] },
      new Date("2027-06-01T00:00:00.000Z"),
    );

    expect(foundBefore.status).toBe(BreachObligationStatus.NotTriggered);
    expect(foundBefore.reasons).toEqual([
      { kind: BreachReasonKind.InForceAfterFound, date: "2027-05-13" },
    ]);
    expect(foundBefore.dueAt).toBeUndefined();
  });
});

describe("CERT-In: report a data breach or leak within 6 hours of noticing it", () => {
  test("says what direction (ii) says", () => {
    const rule: BreachLawRule = getBreachLawRule(BreachLawId.CertIn);

    expect(rule.places).toEqual([BreachPlace.India]);
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 6,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.conditions).toEqual([BreachCondition.CertInEntity]);
    expect(rule.sourceUrl).toBe(
      "https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf",
    );
  });

  test("may apply to Indian people's data, due 6 hours after it was found", () => {
    expect(
      apply(BreachLawId.CertIn, {
        dataTypeIds: ["in-aadhaar"],
        countries: ["IN"],
      }).dueAt,
    ).toBe(after(6 * HOUR));
  });
});

describe("PCI DSS 12.10.1: the acquirer and the card brands, as their rules say", () => {
  test("says what Requirement 12.10.1 says, and sets no deadline of its own", () => {
    const rule: BreachLawRule = getBreachLawRule(BreachLawId.PciDss);

    expect(rule.places).toBeNull();
    expect(rule.dataElements).toEqual([BreachDataElement.CardData]);
    expect(rule.deadline.unit).toBe(BreachDeadlineUnit.NoFixedTime);
    expect(rule.deadlineNote).toContain("no deadline of its own");
    expect(rule.conditions).toEqual([BreachCondition.HandlesCardData]);

    const obligation: BreachObligation = apply(BreachLawId.PciDss, {
      dataTypeIds: ["credit-card-number"],
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.isPlaceKnown).toBe(true);
    expect(obligation.dueAt).toBeUndefined();
  });

  test("is not triggered by a bank account number", () => {
    expect(
      apply(BreachLawId.PciDss, { dataTypeIds: ["bank-account-number"] })
        .status,
    ).toBe(BreachObligationStatus.NotTriggered);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The card brands' own deadlines (#10953): one row per brand that publishes
 * its rule, each from the brand's own document, read on 27 November 2026.
 * ---------------------------------------------------------------------------
 */

describe("the card brands' own rules, as a family", () => {
  test("are Visa, Mastercard and American Express: the brands that publish a deadline", () => {
    expect(
      CARD_BRAND_RULE_IDS.map((id: BreachLawId): BreachLawFamily => {
        return getBreachLawRule(id).family;
      }),
    ).toEqual([
      BreachLawFamily.Visa,
      BreachLawFamily.Mastercard,
      BreachLawFamily.AmericanExpress,
    ]);
  });

  test.each(
    CARD_BRAND_RULE_IDS.map((id: BreachLawId): [string, BreachLawId] => {
      return [id, id];
    }),
  )(
    "%s applies to card data wherever the people live, if the organization handles the brand's cards, from the brand's own document",
    (_id: string, id: BreachLawId) => {
      const rule: BreachLawRule = getBreachLawRule(id);

      expect(rule.places).toBeNull();
      expect(rule.dataElements).toEqual([BreachDataElement.CardData]);
      expect(rule.needsName).toBe(false);
      expect(rule.conditions).toEqual([
        BreachCondition.HandlesCardData,
        BreachCondition.CardsOfTheBrand,
      ]);
      expect(rule.deadline.start).toBe(BreachDeadlineStart.Found);
      expect(rule.checkedOn).toBe(CARD_BRAND_RULES_CHECKED_ON);
      // The brand's own domain: never a processor's or a law firm's copy.
      expect(new URL(rule.sourceUrl).hostname).toMatch(
        /(^|\.)(visa|mastercard|americanexpress)\.com$/,
      );

      const obligation: BreachObligation = apply(id, {
        dataTypeIds: ["credit-card-number", "card-verification-code"],
      });

      expect(obligation.status).toBe(BreachObligationStatus.MayApply);
      expect(obligation.isPlaceKnown).toBe(true);
      expect(conditions(obligation)).toEqual([
        BreachCondition.HandlesCardData,
        BreachCondition.CardsOfTheBrand,
      ]);
      // A bank account number is no card's.
      expect(
        apply(id, { dataTypeIds: ["bank-account-number", "person-name"] })
          .status,
      ).toBe(BreachObligationStatus.NotTriggered);
      expect(
        apply(id, { dataTypeIds: ["email-address"], countries: ["DE"] })
          .reasons,
      ).toEqual([
        {
          kind: BreachReasonKind.HoldsNoneOf,
          elements: [BreachDataElement.CardData],
        },
      ]);
    },
  );
});

describe("Visa What To Do If Compromised, Section A.1: Visa within three calendar days", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.VisaCompromise);

  test("says what Version 10.0's Section A.1 says", () => {
    expect(rule.family).toBe(BreachLawFamily.Visa);
    expect(rule.law).toBe("Visa What To Do If Compromised");
    expect(rule.provision).toBe("Section A.1");
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 3,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.recipient).toContain("Global Risk Investigations");
    // A.3: the acquiring bank is told at once.
    expect(rule.recipient).toContain("acquiring bank at once");
    // Counted from a reasonable suspicion, and the incident report three days on (A.2).
    expect(rule.deadlineNote).toContain("suspect a compromise");
    expect(rule.deadlineNote).toContain("incident report");
    expect(rule.sourceUrl).toBe(
      "https://usa.visa.com/dam/VCOM/download/merchants/cisp-what-to-do-if-compromised.pdf",
    );
    expect(rule.sourceTitle).toContain("Version 10.0");
    expect(rule.sourceTitle).toContain("25 June 2026");
  });

  test("is due three calendar days after the exposure was found, counted from the suspicion", () => {
    const obligation: BreachObligation = apply(BreachLawId.VisaCompromise, {
      dataTypeIds: ["credit-card-number"],
    });

    expect(obligation.dueAt).toBe(after(3 * DAY));
  });
});

describe("Mastercard Security Rules and Procedures, Section 10.3.1: Mastercard within 24 hours", () => {
  const rule: BreachLawRule = getBreachLawRule(BreachLawId.MastercardAdcEvent);

  test("says what the Merchant Edition of 4 August 2026 says", () => {
    expect(rule.family).toBe(BreachLawFamily.Mastercard);
    expect(rule.law).toBe("Mastercard Security Rules and Procedures");
    expect(rule.provision).toBe("Section 10.3.1");
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 24,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.recipient).toBe("Mastercard, through your acquirer");
    // Aware when known, or when reasonable security practices should have known.
    expect(rule.deadlineNote).toContain("should have known");
    // The account numbers at risk, within 72 hours.
    expect(rule.deadlineNote).toContain("72 hours");
    // Its rules bind acquirers and issuers; a merchant through its acquirer.
    expect(rule.note).toContain("acquirer's agreement");
    expect(rule.sourceUrl).toBe(
      "https://www.mastercard.com/content/dam/mccom/shared/business/support/rules-pdfs/SPME-Manual.pdf",
    );
    expect(rule.sourceTitle).toContain("4 August 2026");
  });

  test("is due 24 hours after it was found - first, beside PCI DSS's no fixed time", () => {
    const lawFacts: BreachLawFacts = facts({
      dataTypeIds: ["credit-card-number", "card-verification-code"],
    });
    const obligations: Array<BreachObligation> = applyBreachLaws(lawFacts);
    const first: BreachObligation | null = getMostUrgentObligation(obligations);

    expect(
      apply(BreachLawId.MastercardAdcEvent, {
        dataTypeIds: ["credit-card-number"],
      }).dueAt,
    ).toBe(after(24 * HOUR));
    expect(first?.ruleId).toBe(BreachLawId.MastercardAdcEvent);
    expect(
      obligations.find((obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.PciDss;
      })?.dueAt,
    ).toBeUndefined();
  });
});

describe("American Express Data Security Operating Policy, Section 3.1: American Express within 72 hours", () => {
  const rule: BreachLawRule = getBreachLawRule(
    BreachLawId.AmericanExpressDataIncident,
  );

  test("says what the October 2026 United States edition says", () => {
    expect(rule.family).toBe(BreachLawFamily.AmericanExpress);
    expect(rule.law).toBe("American Express Data Security Operating Policy");
    expect(rule.provision).toBe("Section 3.1");
    expect(rule.deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    });
    expect(rule.recipient).toContain("Enterprise Incident Response Program");
    // "Immediately and in no case later than 72 hours after discovery".
    expect(rule.deadlineNote).toContain("Immediately");
    // A suspected compromise of one card number is a Data Incident.
    expect(rule.deadlineNote).toContain("even one card number");
    expect(rule.sourceUrl).toBe(
      "https://www.americanexpress.com/content/dam/amex/us/merchant/new-data-security/DSOP_United_States_EN.pdf",
    );
    expect(rule.sourceTitle).toContain("October 2026");
  });

  test("is due 72 hours after it was found", () => {
    expect(
      apply(BreachLawId.AmericanExpressDataIncident, {
        dataTypeIds: ["credit-card-number"],
      }).dueAt,
    ).toBe(after(72 * HOUR));
  });
});

describe("whether anyone read it", () => {
  test("reads not logged are a reason it may apply; reads logged leave a check", () => {
    const notLogged: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
      countries: ["DE"],
    });
    const unknown: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
      countries: ["DE"],
      logged: ExposureReadsLogged.Unknown,
    });
    const logged: BreachObligation = apply(BreachLawId.GdprAuthority, {
      dataTypeIds: ["email-address"],
      countries: ["DE"],
      logged: ExposureReadsLogged.Logged,
    });

    expect(reasonKinds(notLogged)).toContain(BreachReasonKind.ReadsNotLogged);
    expect(reasonKinds(unknown)).toContain(BreachReasonKind.ReadsUnknown);
    expect(checkKinds(logged)).toContain(BreachCheckKind.ReadFromOutside);
    expect(logged.status).toBe(BreachObligationStatus.MayApply);
  });
});
