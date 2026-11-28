import {
  BREACH_LAW_RULES,
  BREACH_PLACE_CHOICES,
  BREACH_PLACE_REGION_CHOICES,
  BREACH_PLACE_WORDS,
  BreachCondition,
  BreachDataElement,
  BreachDeadlineStart,
  BreachDeadlineUnit,
  BreachLawFamily,
  BreachLawId,
  BreachLawRule,
  BreachPeopleThreshold,
  BreachPlace,
  COVERED_PLACES,
  COVERED_US_STATES,
  FOLLOW_UP_LAWS_CHECKED_ON,
  getBreachLawRule,
  getBreachPlaceOfCountry,
  isDeadlineWithoutLength,
  isUsStatePlace,
  isUsStateRule,
  UNCOVERED_US_STATES,
  US_JURISDICTION_PLACES,
  US_STATE_LAWS_CHECKED_ON,
  US_STATE_PLACES,
} from "../../../Types/DataSecurity/BreachLaws";
import {
  addBusinessDays,
  applyBreachLaw,
  applyBreachLaws,
  BreachCheck,
  BreachCheckKind,
  BreachLawFacts,
  BreachObligation,
  BreachObligationStatus,
  BreachReason,
  BreachReasonKind,
  ExposureReadsLogged,
  getWhoseData,
  isBreachLawForFacts,
  isBreachLawInForce,
} from "../../../Types/DataSecurity/ExposureAssessment";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import { withMeaningKeyAsItsWord } from "../../../Types/MeaningKeys";
import { describe, expect, test } from "@jest/globals";

/*
 * THE OTHER US STATES' BREACH LAWS (#10952): ONE TEST PER ROW, EACH FROM
 * THE STATUTE'S OWN TEXT.
 *
 * Every row below was read on 27 November 2026 from the state's own code
 * site, or - where only a vendor publishes the code (Arkansas, Georgia) -
 * from the legislature's own copies of the acts that enacted and amended
 * it. This file writes down, by hand and apart from the table, what each
 * statute says: who is told, of what data, with or without a name, for how
 * many people, by when and counted from what, what a person still checks,
 * and where its text is. Each row is held to it, and applied to made-up
 * facts: it may apply to the state's people, is ruled out when a person
 * says they live elsewhere, and waits on a person's answer while nobody
 * has said which state. Changing a row means reading its statute again,
 * and changing its line here with it.
 */

// When every example exposure was found: a Monday, 09:00 UTC.
const FOUND_AT: Date = new Date("2026-11-23T09:00:00.000Z");
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
/*
 * An exposure found after a newer text took effect (#11425): Monday
 * 4 January 2027, 09:00 UTC, and the next day.
 */
const FOUND_IN_2027: Date = new Date("2027-01-04T09:00:00.000Z");
const NOW_IN_2027: Date = new Date("2027-01-05T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const SSN: BreachDataElement = BreachDataElement.SocialSecurityNumber;
const DL: BreachDataElement = BreachDataElement.DriversLicense;
const PASSPORT: BreachDataElement = BreachDataElement.PassportNumber;
const TAX_ID: BreachDataElement = BreachDataElement.TaxIdNumber;
const OTHER_ID: BreachDataElement = BreachDataElement.OtherGovernmentId;
const ACCOUNT: BreachDataElement = BreachDataElement.FinancialAccount;
const MEDICAL: BreachDataElement = BreachDataElement.MedicalInformation;
const INSURANCE: BreachDataElement = BreachDataElement.HealthInsurance;
const BIOMETRIC: BreachDataElement = BreachDataElement.Biometric;
const GENETIC: BreachDataElement = BreachDataElement.Genetic;
const GEOLOCATION: BreachDataElement = BreachDataElement.Geolocation;
const DATE_OF_BIRTH: BreachDataElement = BreachDataElement.DateOfBirth;
const LOGIN: BreachDataElement = BreachDataElement.OnlineCredentials;

// What a statute says, as read from it: the row is held to this.
interface StatuteSays {
  id: BreachLawId;
  family: BreachLawFamily;
  place: BreachPlace;
  law: string;
  provision: string;
  elements: Array<BreachDataElement>;
  needsName: boolean;
  nameFree: Array<BreachDataElement>;
  minimumPeople?: BreachPeopleThreshold;
  conditions: Array<BreachCondition>;
  unit: BreachDeadlineUnit;
  amount?: number;
  start: BreachDeadlineStart;
  afterRule?: BreachLawId;
  // The host of the official site its text is on.
  host: string;
  // The day its text was read: US_STATE_LAWS_CHECKED_ON unless it says (#11424-#11427).
  checkedOn?: string;
  // The days its text is in force, where the table holds two texts of a law (#11425).
  inForceFrom?: string;
  inForceUntil?: string;
  // A notice to the data's owner, applied only when the data is held for another (#11427).
  forDataHolders?: boolean;
}

const RESIDENTS: BreachDeadlineStart = BreachDeadlineStart.PeopleNotified;
const FOUND: BreachDeadlineStart = BreachDeadlineStart.Found;

const STATUTES: ReadonlyArray<StatuteSays> = [
  // Code of Alabama 1975, 8-38-2, 8-38-5 and 8-38-6 (Act 2018-396).
  {
    id: BreachLawId.AlabamaResidents,
    family: BreachLawFamily.Alabama,
    place: BreachPlace.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-5",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SubstantialHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "alison.legislature.state.al.us",
  },
  {
    id: BreachLawId.AlabamaAttorneyGeneral,
    family: BreachLawFamily.Alabama,
    place: BreachPlace.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-6",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "alison.legislature.state.al.us",
  },
  // Alaska Statutes 45.48.010 and 45.48.090.
  {
    id: BreachLawId.AlaskaResidents,
    family: BreachLawFamily.Alaska,
    place: BreachPlace.Alaska,
    law: "Alaska Statutes",
    provision: "45.48.010",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.akleg.gov",
  },
  // Arizona Revised Statutes 18-551 and 18-552.
  {
    id: BreachLawId.ArizonaResidents,
    family: BreachLawFamily.Arizona,
    place: BreachPlace.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(1)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.SubstantialEconomicLoss],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.azleg.gov",
  },
  {
    id: BreachLawId.ArizonaAttorneyGeneral,
    family: BreachLawFamily.Arizona,
    place: BreachPlace.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(2)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialEconomicLoss],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.azleg.gov",
  },
  // Arkansas Code 4-110-103 and 4-110-105: Act 1526 of 2005, Act 1030 of 2019.
  {
    id: BreachLawId.ArkansasResidents,
    family: BreachLawFamily.Arkansas,
    place: BreachPlace.Arkansas,
    law: "Arkansas Code",
    provision: "4-110-105(a)",
    elements: [SSN, DL, ACCOUNT, MEDICAL, BIOMETRIC, GENETIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.arkleg.state.ar.us",
  },
  {
    id: BreachLawId.ArkansasAttorneyGeneral,
    family: BreachLawFamily.Arkansas,
    place: BreachPlace.Arkansas,
    law: "Arkansas Code",
    provision: "4-110-105(b)(2)",
    elements: [SSN, DL, ACCOUNT, MEDICAL, BIOMETRIC, GENETIC],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.arkleg.state.ar.us",
  },
  // General Statutes of Connecticut 36a-701b.
  {
    id: BreachLawId.ConnecticutResidents,
    family: BreachLawFamily.Connecticut,
    place: BreachPlace.Connecticut,
    law: "General Statutes of Connecticut",
    provision: "36a-701b(b)(1)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GEOLOCATION,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
    host: "www.cga.ct.gov",
  },
  {
    id: BreachLawId.ConnecticutAttorneyGeneral,
    family: BreachLawFamily.Connecticut,
    place: BreachPlace.Connecticut,
    law: "General Statutes of Connecticut",
    provision: "36a-701b(b)(2)(A)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GEOLOCATION,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.ConnecticutResidents,
    host: "www.cga.ct.gov",
  },
  // Delaware Code, Title 6, 12B-101 and 12B-102, as 85 Del. Laws c. 464 amended them.
  {
    id: BreachLawId.DelawareResidents,
    family: BreachLawFamily.Delaware,
    place: BreachPlace.Delaware,
    law: "Delaware Code, Title 6",
    provision: "12B-102(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
    host: "delcode.delaware.gov",
  },
  {
    id: BreachLawId.DelawareAttorneyGeneral,
    family: BreachLawFamily.Delaware,
    place: BreachPlace.Delaware,
    law: "Delaware Code, Title 6",
    provision: "12B-102(d)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.DelawareResidents,
    host: "delcode.delaware.gov",
  },
  // D.C. Code 28-3851, 28-3852 and 28-3852.02 (D.C. Law 23-98).
  {
    id: BreachLawId.DistrictOfColumbiaResidents,
    family: BreachLawFamily.DistrictOfColumbia,
    place: BreachPlace.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "code.dccouncil.gov",
  },
  {
    id: BreachLawId.DistrictOfColumbiaAttorneyGeneral,
    family: BreachLawFamily.DistrictOfColumbia,
    place: BreachPlace.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(b-1)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    // "If the breach affects 50 or more District residents".
    minimumPeople: { count: 50, isMoreThan: false },
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.DistrictOfColumbiaResidents,
    host: "code.dccouncil.gov",
  },
  // Official Code of Georgia 10-1-911 and 10-1-912, as 2007 SB 236 (Act 241) restates them.
  {
    id: BreachLawId.GeorgiaResidents,
    family: BreachLawFamily.Georgia,
    place: BreachPlace.Georgia,
    law: "Official Code of Georgia",
    provision: "10-1-912(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.InformationBrokerOrAgency],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.legis.ga.gov",
  },
  // Hawaii Revised Statutes 487N-1 and 487N-2.
  {
    id: BreachLawId.HawaiiResidents,
    family: BreachLawFamily.Hawaii,
    place: BreachPlace.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyIllegalUse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "data.capitol.hawaii.gov",
  },
  {
    id: BreachLawId.HawaiiConsumerProtection,
    family: BreachLawFamily.Hawaii,
    place: BreachPlace.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(f)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyIllegalUse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "data.capitol.hawaii.gov",
  },
  // Idaho Code 28-51-104 and 28-51-105.
  {
    id: BreachLawId.IdahoResidents,
    family: BreachLawFamily.Idaho,
    place: BreachPlace.Idaho,
    law: "Idaho Code",
    provision: "28-51-105(1)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "legislature.idaho.gov",
  },
  // Personal Information Protection Act, 815 ILCS 530/5, 530/10 and 530/50.
  {
    id: BreachLawId.IllinoisResidents,
    family: BreachLawFamily.Illinois,
    place: BreachPlace.Illinois,
    law: "815 ILCS 530",
    provision: "10(a)",
    elements: [SSN, DL, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ilga.gov",
  },
  {
    id: BreachLawId.IllinoisAttorneyGeneral,
    family: BreachLawFamily.Illinois,
    place: BreachPlace.Illinois,
    law: "815 ILCS 530",
    provision: "10(e)(2)",
    elements: [SSN, DL, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.IllinoisResidents,
    host: "www.ilga.gov",
  },
  // Indiana Code 24-4.9-2-10, 24-4.9-3-1 and 24-4.9-3-3 (Indiana Code 2026).
  {
    id: BreachLawId.IndianaResidents,
    family: BreachLawFamily.Indiana,
    place: BreachPlace.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [SSN],
    conditions: [BreachCondition.IdentityTheftOrFraud],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "iga.in.gov",
  },
  {
    id: BreachLawId.IndianaAttorneyGeneral,
    family: BreachLawFamily.Indiana,
    place: BreachPlace.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(c)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [SSN],
    conditions: [BreachCondition.IdentityTheftOrFraud],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "iga.in.gov",
  },
  // Iowa Code 715C.1 and 715C.2 (Iowa Code 2026).
  {
    id: BreachLawId.IowaResidents,
    family: BreachLawFamily.Iowa,
    place: BreachPlace.Iowa,
    law: "Iowa Code",
    provision: "715C.2(1)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.FinancialHarmInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.legis.iowa.gov",
  },
  {
    id: BreachLawId.IowaAttorneyGeneral,
    family: BreachLawFamily.Iowa,
    place: BreachPlace.Iowa,
    law: "Iowa Code",
    provision: "715C.2(8)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    // "more than five hundred residents of this state".
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.FinancialHarmInWriting],
    // "within five business days after giving notice of the breach of security to any consumer".
    unit: BreachDeadlineUnit.BusinessDays,
    amount: 5,
    start: RESIDENTS,
    afterRule: BreachLawId.IowaResidents,
    host: "www.legis.iowa.gov",
  },
  // Kansas Statutes Annotated 50-7a01 and 50-7a02.
  {
    id: BreachLawId.KansasResidents,
    family: BreachLawFamily.Kansas,
    place: BreachPlace.Kansas,
    law: "Kansas Statutes Annotated",
    provision: "50-7a02(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ksrevisor.gov",
  },
  // Kentucky Revised Statutes 365.732 (the business law; the agencies' KRS 61.931 to 61.934 are left out).
  {
    id: BreachLawId.KentuckyResidents,
    family: BreachLawFamily.Kentucky,
    place: BreachPlace.Kentucky,
    law: "Kentucky Revised Statutes",
    provision: "365.732(2)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "apps.legislature.ky.gov",
  },
  // Louisiana Revised Statutes 51:3073 and 51:3074, and the attorney general's rule, LAC 16:III.701.
  {
    id: BreachLawId.LouisianaResidents,
    family: BreachLawFamily.Louisiana,
    place: BreachPlace.Louisiana,
    law: "Louisiana Revised Statutes",
    provision: "51:3074",
    elements: [SSN, DL, ACCOUNT, PASSPORT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    // "no later than sixty days from the discovery of the breach".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
    host: "legis.la.gov",
  },
  {
    id: BreachLawId.LouisianaAttorneyGeneral,
    family: BreachLawFamily.Louisiana,
    place: BreachPlace.Louisiana,
    law: "Louisiana Administrative Code",
    provision: "16:III.701",
    elements: [SSN, DL, ACCOUNT, PASSPORT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    // "within 10 days of distribution of notice to Louisiana citizens".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: RESIDENTS,
    afterRule: BreachLawId.LouisianaResidents,
    host: "www.doa.la.gov",
  },
  // Maine Revised Statutes, Title 10, 1347 and 1348.
  {
    id: BreachLawId.MaineResidents,
    family: BreachLawFamily.Maine,
    place: BreachPlace.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(1)",
    elements: [SSN, DL, ACCOUNT],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.PossibleMisuse],
    // "no more than 30 days after the person ... becomes aware of a breach of security and identifies its scope".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 30,
    start: FOUND,
    host: "legislature.maine.gov",
  },
  {
    id: BreachLawId.MaineAttorneyGeneral,
    family: BreachLawFamily.Maine,
    place: BreachPlace.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(5)",
    elements: [SSN, DL, ACCOUNT],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.PossibleMisuse],
    unit: BreachDeadlineUnit.NoFixedTime,
    start: FOUND,
    host: "legislature.maine.gov",
  },
  // Maryland Code, Commercial Law 14-3501 and 14-3504.
  {
    id: BreachLawId.MarylandResidents,
    family: BreachLawFamily.Maryland,
    place: BreachPlace.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3504(b)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyMisuse],
    // "not later than 45 days after the business discovers or is notified of the breach".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "mgaleg.maryland.gov",
  },
  {
    id: BreachLawId.MarylandAttorneyGeneral,
    family: BreachLawFamily.Maryland,
    place: BreachPlace.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3504(h)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyMisuse],
    // "Prior to giving the notification required under subsection (b)".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.MarylandResidents,
    host: "mgaleg.maryland.gov",
  },
  // General Laws of Massachusetts, chapter 93H, sections 1, 3 and 3A.
  {
    id: BreachLawId.MassachusettsResidents,
    family: BreachLawFamily.Massachusetts,
    place: BreachPlace.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "malegislature.gov",
  },
  {
    id: BreachLawId.MassachusettsAttorneyGeneral,
    family: BreachLawFamily.Massachusetts,
    place: BreachPlace.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "malegislature.gov",
  },
  // Michigan Compiled Laws 445.63 and 445.72.
  {
    id: BreachLawId.MichiganResidents,
    family: BreachLawFamily.Michigan,
    place: BreachPlace.Michigan,
    law: "Michigan Compiled Laws",
    provision: "445.72(1)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.legislature.mi.gov",
  },
  // Minnesota Statutes 2026, 325E.61.
  {
    id: BreachLawId.MinnesotaResidents,
    family: BreachLawFamily.Minnesota,
    place: BreachPlace.Minnesota,
    law: "Minnesota Statutes",
    provision: "325E.61, subdivision 1",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    // No risk-of-harm exception.
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.revisor.mn.gov",
  },
  // Mississippi Code 75-24-29, as 2021 HB 277 restates it.
  {
    id: BreachLawId.MississippiResidents,
    family: BreachLawFamily.Mississippi,
    place: BreachPlace.Mississippi,
    law: "Mississippi Code",
    provision: "75-24-29",
    elements: [SSN, DL, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "billstatus.ls.state.ms.us",
  },
  // Revised Statutes of Missouri 407.1500.
  {
    id: BreachLawId.MissouriResidents,
    family: BreachLawFamily.Missouri,
    place: BreachPlace.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(1)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "revisor.mo.gov",
  },
  {
    id: BreachLawId.MissouriAttorneyGeneral,
    family: BreachLawFamily.Missouri,
    place: BreachPlace.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(8)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [],
    // "more than one thousand consumers at one time".
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "revisor.mo.gov",
  },
  // Montana Code Annotated 2025, 30-14-1704.
  {
    id: BreachLawId.MontanaResidents,
    family: BreachLawFamily.Montana,
    place: BreachPlace.Montana,
    law: "Montana Code Annotated",
    provision: "30-14-1704(1)",
    elements: [SSN, DL, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "leg.mt.gov",
  },
  {
    id: BreachLawId.MontanaAttorneyGeneral,
    family: BreachLawFamily.Montana,
    place: BreachPlace.Montana,
    law: "Montana Code Annotated",
    provision: "30-14-1704(8)",
    elements: [SSN, DL, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LossOrInjury],
    // "shall simultaneously submit an electronic copy of the notification".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.MontanaResidents,
    host: "leg.mt.gov",
  },
  // Nebraska Revised Statutes 87-802 and 87-803.
  {
    id: BreachLawId.NebraskaResidents,
    family: BreachLawFamily.Nebraska,
    place: BreachPlace.Nebraska,
    law: "Nebraska Revised Statutes",
    provision: "87-803(1)",
    elements: [SSN, DL, ACCOUNT, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyUnauthorizedUse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "nebraskalegislature.gov",
  },
  {
    id: BreachLawId.NebraskaAttorneyGeneral,
    family: BreachLawFamily.Nebraska,
    place: BreachPlace.Nebraska,
    law: "Nebraska Revised Statutes",
    provision: "87-803(2)",
    elements: [SSN, DL, ACCOUNT, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.LikelyUnauthorizedUse],
    // "not later than the time when notice is provided to the Nebraska resident".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.NebraskaResidents,
    host: "nebraskalegislature.gov",
  },
  // Nevada Revised Statutes 603A.040 and 603A.220.
  {
    id: BreachLawId.NevadaResidents,
    family: BreachLawFamily.Nevada,
    place: BreachPlace.Nevada,
    law: "Nevada Revised Statutes",
    provision: "603A.220",
    elements: [SSN, DL, ACCOUNT, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.leg.state.nv.us",
  },
  // New Hampshire Revised Statutes 359-C:19 and 359-C:20.
  {
    id: BreachLawId.NewHampshireResidents,
    family: BreachLawFamily.NewHampshire,
    place: BreachPlace.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, I(a)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MisuseOrUndetermined],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.gencourt.state.nh.us",
  },
  {
    id: BreachLawId.NewHampshireAttorneyGeneral,
    family: BreachLawFamily.NewHampshire,
    place: BreachPlace.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, I(b)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MisuseOrUndetermined],
    unit: BreachDeadlineUnit.NoFixedTime,
    start: FOUND,
    host: "www.gencourt.state.nh.us",
  },
  // New Jersey Statutes 56:8-161 and 56:8-163.
  {
    id: BreachLawId.NewJerseyResidents,
    family: BreachLawFamily.NewJersey,
    place: BreachPlace.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(a)",
    elements: [SSN, DL, ACCOUNT, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "lis.njleg.state.nj.us",
  },
  {
    id: BreachLawId.NewJerseyStatePolice,
    family: BreachLawFamily.NewJersey,
    place: BreachPlace.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(c)(1)",
    elements: [SSN, DL, ACCOUNT, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    // "in advance of the disclosure to the customer".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.NewJerseyResidents,
    host: "lis.njleg.state.nj.us",
  },
  // New Mexico Statutes Annotated 1978, 57-12C-2, 57-12C-6 and 57-12C-10.
  {
    id: BreachLawId.NewMexicoResidents,
    family: BreachLawFamily.NewMexico,
    place: BreachPlace.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-6",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    // "no later than forty-five calendar days following discovery of the security breach".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.nmonesource.com",
  },
  {
    id: BreachLawId.NewMexicoAttorneyGeneral,
    family: BreachLawFamily.NewMexico,
    place: BreachPlace.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-10",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    // "more than one thousand New Mexico residents as a result of a single security breach".
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.nmonesource.com",
  },
  // North Carolina General Statutes 75-61 and 75-65.
  {
    id: BreachLawId.NorthCarolinaResidents,
    family: BreachLawFamily.NorthCarolina,
    place: BreachPlace.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(a)",
    elements: [SSN, DL, PASSPORT, TAX_ID, ACCOUNT, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ncleg.gov",
  },
  {
    id: BreachLawId.NorthCarolinaAttorneyGeneral,
    family: BreachLawFamily.NorthCarolina,
    place: BreachPlace.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(e1)",
    elements: [SSN, DL, PASSPORT, TAX_ID, ACCOUNT, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [],
    // Whenever a business tells an affected person: no threshold.
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ncleg.gov",
  },
  // North Dakota Century Code 51-30-01 and 51-30-02.
  {
    id: BreachLawId.NorthDakotaResidents,
    family: BreachLawFamily.NorthDakota,
    place: BreachPlace.NorthDakota,
    law: "North Dakota Century Code",
    provision: "51-30-02",
    elements: [SSN, DL, ACCOUNT, DATE_OF_BIRTH, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [],
    // No risk-of-harm exception.
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ndlegis.gov",
  },
  {
    id: BreachLawId.NorthDakotaAttorneyGeneral,
    family: BreachLawFamily.NorthDakota,
    place: BreachPlace.NorthDakota,
    law: "North Dakota Century Code",
    provision: "51-30-02 (attorney general)",
    elements: [SSN, DL, ACCOUNT, DATE_OF_BIRTH, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [],
    // "that exceeds two hundred fifty individuals".
    minimumPeople: { count: 250, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ndlegis.gov",
  },
  // Ohio Revised Code 1349.19.
  {
    id: BreachLawId.OhioResidents,
    family: BreachLawFamily.Ohio,
    place: BreachPlace.Ohio,
    law: "Ohio Revised Code",
    provision: "1349.19(B)(1)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    // "not later than forty-five days following its discovery or notification of the breach".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "codes.ohio.gov",
  },
  // Oklahoma Statutes, Title 24, 162 and 163, as Laws 2025, c. 406 amended them (in force since 1 January 2026).
  {
    id: BreachLawId.OklahomaResidents,
    family: BreachLawFamily.Oklahoma,
    place: BreachPlace.Oklahoma,
    law: "Oklahoma Statutes, Title 24",
    provision: "163(A)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.oklegislature.gov",
    // As SB 626 (Laws 2025, c. 406) amended it, from 1 January 2026.
    inForceFrom: "2026-01-01",
  },
  {
    id: BreachLawId.OklahomaAttorneyGeneral,
    family: BreachLawFamily.Oklahoma,
    place: BreachPlace.Oklahoma,
    law: "Oklahoma Statutes, Title 24",
    provision: "163(E)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    // "fewer than five hundred (500) residents ... shall be exempt".
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    // "in no event more than sixty (60) days after providing notice to impacted residents".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: RESIDENTS,
    afterRule: BreachLawId.OklahomaResidents,
    host: "www.oklegislature.gov",
    // New with SB 626, from 1 January 2026.
    inForceFrom: "2026-01-01",
  },
  // Oregon Revised Statutes 646A.602 and 646A.604.
  {
    id: BreachLawId.OregonResidents,
    family: BreachLawFamily.Oregon,
    place: BreachPlace.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(1)(a)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC, MEDICAL, INSURANCE, LOGIN],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.UnlikelyHarmInWriting],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.oregonlegislature.gov",
  },
  {
    id: BreachLawId.OregonAttorneyGeneral,
    family: BreachLawFamily.Oregon,
    place: BreachPlace.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(1)(b)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC, MEDICAL, INSURANCE, LOGIN],
    needsName: false,
    nameFree: [],
    // "exceeds 250".
    minimumPeople: { count: 250, isMoreThan: true },
    conditions: [BreachCondition.UnlikelyHarmInWriting],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.oregonlegislature.gov",
  },
  // Pennsylvania Breach of Personal Information Notification Act (Act 94 of 2005), as amended.
  {
    id: BreachLawId.PennsylvaniaResidents,
    family: BreachLawFamily.Pennsylvania,
    place: BreachPlace.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 3(a)",
    elements: [SSN, DL, ACCOUNT, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.palegis.us",
  },
  {
    id: BreachLawId.PennsylvaniaAttorneyGeneral,
    family: BreachLawFamily.Pennsylvania,
    place: BreachPlace.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 3(c.1)",
    elements: [SSN, DL, ACCOUNT, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LossOrInjury],
    // "concurrently with the notice to affected individuals".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.PennsylvaniaResidents,
    host: "www.palegis.us",
  },
  // General Laws of Rhode Island 11-49.3-3 and 11-49.3-4.
  {
    id: BreachLawId.RhodeIslandResidents,
    family: BreachLawFamily.RhodeIsland,
    place: BreachPlace.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)",
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    // "no later than forty-five (45) calendar days after confirmation of the breach".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "webserver.rilegislature.gov",
  },
  {
    id: BreachLawId.RhodeIslandAttorneyGeneral,
    family: BreachLawFamily.RhodeIsland,
    place: BreachPlace.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)(2)(ii)",
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    // "without delaying notice to affected Rhode Island residents".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.RhodeIslandResidents,
    host: "webserver.rilegislature.gov",
  },
  // Code of Laws of South Carolina 39-1-90.
  {
    id: BreachLawId.SouthCarolinaResidents,
    family: BreachLawFamily.SouthCarolina,
    place: BreachPlace.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(A)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.scstatehouse.gov",
  },
  {
    id: BreachLawId.SouthCarolinaConsumerAffairs,
    family: BreachLawFamily.SouthCarolina,
    place: BreachPlace.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(K)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    // "more than one thousand persons at one time".
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.scstatehouse.gov",
  },
  // South Dakota Codified Laws 22-40-19 to 22-40-24.
  {
    id: BreachLawId.SouthDakotaResidents,
    family: BreachLawFamily.SouthDakota,
    place: BreachPlace.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-20",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, LOGIN],
    needsName: true,
    nameFree: [ACCOUNT, LOGIN],
    conditions: [BreachCondition.LikelyHarmAfterTellingAg],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
    host: "sdlegislature.gov",
  },
  {
    id: BreachLawId.SouthDakotaAttorneyGeneral,
    family: BreachLawFamily.SouthDakota,
    place: BreachPlace.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-20 (attorney general)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, LOGIN],
    needsName: true,
    nameFree: [ACCOUNT, LOGIN],
    // "any breach of system security that exceeds two hundred fifty residents".
    minimumPeople: { count: 250, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
    host: "sdlegislature.gov",
  },
  // Tennessee Code Annotated 47-18-2107, as 2017 Public Chapter 91 replaced it.
  {
    id: BreachLawId.TennesseeResidents,
    family: BreachLawFamily.Tennessee,
    place: BreachPlace.Tennessee,
    law: "Tennessee Code Annotated",
    provision: "47-18-2107(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "capitol.tn.gov",
  },
  // Utah Code 13-44-102 and 13-44-202.
  {
    id: BreachLawId.UtahResidents,
    family: BreachLawFamily.Utah,
    place: BreachPlace.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "le.utah.gov",
  },
  {
    id: BreachLawId.UtahAttorneyGeneral,
    family: BreachLawFamily.Utah,
    place: BreachPlace.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(c)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    // "relating to 500 or more Utah residents".
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "le.utah.gov",
  },
  // Vermont Statutes, Title 9, 2430 and 2435, as in force until 1 January 2027.
  {
    id: BreachLawId.VermontResidents,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(1)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    // "not later than 45 days after the discovery or notification".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "legislature.vermont.gov",
    // The text in force until 1 January 2027 (#11425).
    inForceUntil: "2027-01-01",
  },
  {
    id: BreachLawId.VermontAttorneyGeneral,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(3)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    // No threshold.
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    // "a preliminary description of the breach within 14 business days".
    unit: BreachDeadlineUnit.BusinessDays,
    amount: 14,
    start: FOUND,
    host: "legislature.vermont.gov",
    // The text in force until 1 January 2027 (#11425).
    inForceUntil: "2027-01-01",
  },
  // Code of Virginia 18.2-186.6.
  {
    id: BreachLawId.VirginiaResidents,
    family: BreachLawFamily.Virginia,
    place: BreachPlace.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(B)",
    elements: [SSN, DL, PASSPORT, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "law.lis.virginia.gov",
  },
  {
    id: BreachLawId.VirginiaAttorneyGeneral,
    family: BreachLawFamily.Virginia,
    place: BreachPlace.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(B) (attorney general)",
    elements: [SSN, DL, PASSPORT, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    // Every breach the residents are told of: no threshold.
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "law.lis.virginia.gov",
  },
  // Wisconsin Statutes 134.98.
  {
    id: BreachLawId.WisconsinResidents,
    family: BreachLawFamily.Wisconsin,
    place: BreachPlace.Wisconsin,
    law: "Wisconsin Statutes",
    provision: "134.98(2)",
    elements: [SSN, DL, ACCOUNT, GENETIC, BIOMETRIC],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.NoMaterialRiskOfIdentityTheft],
    // "within a reasonable time, not to exceed 45 days after the entity learns of the acquisition".
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "docs.legis.wisconsin.gov",
  },
  // Wyoming Statutes 40-12-501 and 40-12-502, and the data elements of 6-3-901(b).
  {
    id: BreachLawId.WyomingResidents,
    family: BreachLawFamily.Wyoming,
    place: BreachPlace.Wyoming,
    law: "Wyoming Statutes",
    provision: "40-12-502(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      BIOMETRIC,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    // "causes or is reasonably believed to cause loss or injury", and an investigation that finds misuse.
    conditions: [
      BreachCondition.LossOrInjury,
      BreachCondition.InvestigationFindsMisuse,
    ],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "wyoleg.gov",
  },
  /*
   * The consumer reporting agencies' notices, each statute's own: owed once
   * more than a number of residents are told, as the statute counts them.
   * Florida's and New York's were read again for theirs.
   */
  {
    id: BreachLawId.AlabamaConsumerReportingAgencies,
    family: BreachLawFamily.Alabama,
    place: BreachPlace.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-7",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "alison.legislature.state.al.us",
  },
  {
    id: BreachLawId.AlaskaConsumerReportingAgencies,
    family: BreachLawFamily.Alaska,
    place: BreachPlace.Alaska,
    law: "Alaska Statutes",
    provision: "45.48.040",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.akleg.gov",
  },
  {
    id: BreachLawId.ArizonaConsumerReportingAgencies,
    family: BreachLawFamily.Arizona,
    place: BreachPlace.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(2)(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialEconomicLoss],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.azleg.gov",
  },
  {
    id: BreachLawId.DistrictOfColumbiaConsumerReportingAgencies,
    family: BreachLawFamily.DistrictOfColumbia,
    place: BreachPlace.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(c)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "code.dccouncil.gov",
  },
  {
    id: BreachLawId.GeorgiaConsumerReportingAgencies,
    family: BreachLawFamily.Georgia,
    place: BreachPlace.Georgia,
    law: "Official Code of Georgia",
    provision: "10-1-912(d)",
    elements: [SSN, DL, ACCOUNT],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 10000, isMoreThan: true },
    conditions: [BreachCondition.InformationBrokerOrAgency],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.legis.ga.gov",
  },
  {
    id: BreachLawId.HawaiiConsumerReportingAgencies,
    family: BreachLawFamily.Hawaii,
    place: BreachPlace.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(f)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyIllegalUse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "data.capitol.hawaii.gov",
  },
  {
    id: BreachLawId.IndianaConsumerReportingAgencies,
    family: BreachLawFamily.Indiana,
    place: BreachPlace.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [SSN],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraud],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "iga.in.gov",
  },
  {
    id: BreachLawId.KansasConsumerReportingAgencies,
    family: BreachLawFamily.Kansas,
    place: BreachPlace.Kansas,
    law: "Kansas Statutes Annotated",
    provision: "50-7a02(f)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ksrevisor.gov",
  },
  {
    id: BreachLawId.KentuckyConsumerReportingAgencies,
    family: BreachLawFamily.Kentucky,
    place: BreachPlace.Kentucky,
    law: "Kentucky Revised Statutes",
    provision: "365.732(7)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "apps.legislature.ky.gov",
  },
  {
    id: BreachLawId.MaineConsumerReportingAgencies,
    family: BreachLawFamily.Maine,
    place: BreachPlace.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(4)",
    elements: [SSN, DL, ACCOUNT],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.PossibleMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "legislature.maine.gov",
  },
  {
    id: BreachLawId.MarylandConsumerReportingAgencies,
    family: BreachLawFamily.Maryland,
    place: BreachPlace.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3506(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.LikelyMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "mgaleg.maryland.gov",
  },
  {
    id: BreachLawId.MichiganConsumerReportingAgencies,
    family: BreachLawFamily.Michigan,
    place: BreachPlace.Michigan,
    law: "Michigan Compiled Laws",
    provision: "445.72(8)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.legislature.mi.gov",
  },
  {
    id: BreachLawId.MinnesotaConsumerReportingAgencies,
    family: BreachLawFamily.Minnesota,
    place: BreachPlace.Minnesota,
    law: "Minnesota Statutes",
    provision: "325E.61, subdivision 2",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.Hours,
    amount: 48,
    start: FOUND,
    host: "www.revisor.mn.gov",
  },
  {
    id: BreachLawId.MissouriConsumerReportingAgencies,
    family: BreachLawFamily.Missouri,
    place: BreachPlace.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(8)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "revisor.mo.gov",
  },
  {
    id: BreachLawId.NevadaConsumerReportingAgencies,
    family: BreachLawFamily.Nevada,
    place: BreachPlace.Nevada,
    law: "Nevada Revised Statutes",
    provision: "603A.220(6)",
    elements: [SSN, DL, ACCOUNT, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.leg.state.nv.us",
  },
  {
    id: BreachLawId.NewHampshireConsumerReportingAgencies,
    family: BreachLawFamily.NewHampshire,
    place: BreachPlace.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, VI(a)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseOrUndetermined],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.gencourt.state.nh.us",
  },
  {
    id: BreachLawId.NewJerseyConsumerReportingAgencies,
    family: BreachLawFamily.NewJersey,
    place: BreachPlace.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(f)",
    elements: [SSN, DL, ACCOUNT, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "lis.njleg.state.nj.us",
  },
  {
    id: BreachLawId.NewMexicoConsumerReportingAgencies,
    family: BreachLawFamily.NewMexico,
    place: BreachPlace.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-10",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "www.nmonesource.com",
  },
  {
    id: BreachLawId.FloridaConsumerReportingAgencies,
    family: BreachLawFamily.Florida,
    place: BreachPlace.Florida,
    law: "Florida Statutes",
    provision: "501.171(5)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GEOLOCATION,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFinancialHarm],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.leg.state.fl.us",
  },
  {
    id: BreachLawId.NewYorkConsumerReportingAgencies,
    family: BreachLawFamily.NewYork,
    place: BreachPlace.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(8)(b)",
    elements: [SSN, DL, ACCOUNT, BIOMETRIC, MEDICAL, INSURANCE, LOGIN],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 5000, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.NewYorkResidents,
    host: "www.nysenate.gov",
  },
  {
    id: BreachLawId.NorthCarolinaConsumerReportingAgencies,
    family: BreachLawFamily.NorthCarolina,
    place: BreachPlace.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(f)",
    elements: [SSN, DL, PASSPORT, TAX_ID, ACCOUNT, BIOMETRIC, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.ncleg.gov",
  },
  {
    id: BreachLawId.OhioConsumerReportingAgencies,
    family: BreachLawFamily.Ohio,
    place: BreachPlace.Ohio,
    law: "Ohio Revised Code",
    provision: "1349.19(G)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "codes.ohio.gov",
  },
  {
    id: BreachLawId.OregonConsumerReportingAgencies,
    family: BreachLawFamily.Oregon,
    place: BreachPlace.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(6)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, BIOMETRIC, INSURANCE, MEDICAL, LOGIN],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.oregonlegislature.gov",
  },
  {
    id: BreachLawId.PennsylvaniaConsumerReportingAgencies,
    family: BreachLawFamily.Pennsylvania,
    place: BreachPlace.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 5",
    elements: [SSN, DL, ACCOUNT, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.palegis.us",
  },
  {
    id: BreachLawId.RhodeIslandConsumerReportingAgencies,
    family: BreachLawFamily.RhodeIsland,
    place: BreachPlace.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)(2)(ii)",
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, LOGIN],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 0,
    start: RESIDENTS,
    afterRule: BreachLawId.RhodeIslandResidents,
    host: "webserver.rilegislature.gov",
  },
  {
    id: BreachLawId.SouthCarolinaConsumerReportingAgencies,
    family: BreachLawFamily.SouthCarolina,
    place: BreachPlace.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(K)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "www.scstatehouse.gov",
  },
  {
    id: BreachLawId.SouthDakotaConsumerReportingAgencies,
    family: BreachLawFamily.SouthDakota,
    place: BreachPlace.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-24",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, LOGIN],
    needsName: true,
    nameFree: [ACCOUNT, LOGIN],
    conditions: [BreachCondition.LikelyHarmAfterTellingAg],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "sdlegislature.gov",
  },
  {
    id: BreachLawId.TennesseeConsumerReportingAgencies,
    family: BreachLawFamily.Tennessee,
    place: BreachPlace.Tennessee,
    law: "Tennessee Code Annotated",
    provision: "47-18-2107(g)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "capitol.tn.gov",
  },
  {
    id: BreachLawId.UtahConsumerReportingAgencies,
    family: BreachLawFamily.Utah,
    place: BreachPlace.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(d)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "le.utah.gov",
  },
  {
    id: BreachLawId.VermontConsumerReportingAgencies,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(c)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "legislature.vermont.gov",
    // The text in force until 1 January 2027 (#11425).
    inForceUntil: "2027-01-01",
  },
  {
    id: BreachLawId.VirginiaConsumerReportingAgencies,
    family: BreachLawFamily.Virginia,
    place: BreachPlace.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(E)",
    elements: [SSN, DL, PASSPORT, OTHER_ID, ACCOUNT],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "law.lis.virginia.gov",
  },
  {
    id: BreachLawId.WisconsinConsumerReportingAgencies,
    family: BreachLawFamily.Wisconsin,
    place: BreachPlace.Wisconsin,
    law: "Wisconsin Statutes",
    provision: "134.98(2)(br)",
    elements: [SSN, DL, ACCOUNT, GENETIC, BIOMETRIC],
    needsName: true,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.NoMaterialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "docs.legis.wisconsin.gov",
  },
  {
    id: BreachLawId.ColoradoConsumerReportingAgencies,
    family: BreachLawFamily.Colorado,
    place: BreachPlace.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716(2)(d)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN, ACCOUNT],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyMisuse],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "content.leg.colorado.gov",
  },
  {
    id: BreachLawId.MassachusettsConsumerReportingAgencies,
    family: BreachLawFamily.Massachusetts,
    place: BreachPlace.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "malegislature.gov",
  },
  {
    id: BreachLawId.TexasConsumerReportingAgencies,
    family: BreachLawFamily.Texas,
    place: BreachPlace.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053(h)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [MEDICAL, INSURANCE],
    minimumPeople: { count: 10000, isMoreThan: true },
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "tcss.legis.texas.gov",
  },
  /*
   * Vermont Statutes, Title 9, 2430 and 2435, as 2025, No. 138 (Adj. Sess.)
   * amended them, in force from 1 January 2027 (#11425). 2430(13)(C): the
   * data "does not require a consumer's first name or first initial and
   * last name if any of the data elements ... is sufficient to perform or
   * attempt to perform identity theft" - so no name is needed. The deadlines
   * and the agencies' threshold are as before.
   */
  {
    id: BreachLawId.VermontResidentsFrom2027,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(1)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
    host: "legislature.vermont.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  {
    id: BreachLawId.VermontAttorneyGeneralFrom2027,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(3)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.BusinessDays,
    amount: 14,
    start: FOUND,
    host: "legislature.vermont.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  {
    id: BreachLawId.VermontConsumerReportingAgenciesFrom2027,
    family: BreachLawFamily.Vermont,
    place: BreachPlace.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(c)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "legislature.vermont.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  /*
   * Puerto Rico: Ley 111-2005, Articles 2 and 3, as Ley 97-2008 amended
   * them, in Spanish (#11424). The personal information file: the name or
   * first initial and paternal surname with a Social Security number, a
   * driver's license, voter card "u otra Identificación Oficial" number, an
   * account number, a user name and password, HIPAA-protected medical
   * information, "información contributiva" or employment evaluations. The
   * citizens "de la manera más expedita posible"; the Department of Consumer
   * Affairs "dentro de un plazo improrrogable de diez (10) días de
   * detectarse".
   */
  {
    id: BreachLawId.PuertoRicoResidents,
    family: BreachLawFamily.PuertoRico,
    place: BreachPlace.PuertoRico,
    law: "Puerto Rico Citizen Information on Data Banks Security Act",
    provision: "Section 3",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "sutra.oslpr.org",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.PuertoRicoConsumerAffairs,
    family: BreachLawFamily.PuertoRico,
    place: BreachPlace.PuertoRico,
    law: "Puerto Rico Citizen Information on Data Banks Security Act",
    provision: "Section 3 (Department of Consumer Affairs)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      LOGIN,
    ],
    needsName: true,
    nameFree: [],
    // No threshold: every breach.
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: FOUND,
    host: "sutra.oslpr.org",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  /*
   * Guam Code Annotated, Title 9, 48.20 and 48.30(a) (#11426): the name with
   * a Social Security number, a driver's license or the Guam identification
   * card number issued in lieu of one, or an account or card number with its
   * code; a breach "causes, or the individual or entity reasonably believes
   * has caused or will cause, identity theft or other fraud".
   */
  {
    id: BreachLawId.GuamResidents,
    family: BreachLawFamily.Guam,
    place: BreachPlace.Guam,
    law: "Guam Code Annotated, Title 9",
    provision: "48.30(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "col.guamcourts.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  /*
   * Virgin Islands Code, Title 14, 2209(a), (d) and (e), as Act No. 6789
   * (2005) enacted them (#11426): the name with a Social Security number, a
   * driver's license number or an account or card number with its code; "in
   * the most expedient time possible and without unreasonable delay".
   */
  {
    id: BreachLawId.UsVirginIslandsResidents,
    family: BreachLawFamily.UsVirginIslands,
    place: BreachPlace.UsVirginIslands,
    law: "Virgin Islands Code, Title 14",
    provision: "2209(a)",
    elements: [SSN, DL, ACCOUNT],
    needsName: true,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "billtracking.legvi.org",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
];

/*
 * The notice to the data's owner (#11427): each jurisdiction's, as its
 * statute words it. It covers the data the jurisdiction's personal
 * information does - the same definition its people's notice reads - so it
 * takes that line's data and name rule; the rest is said here, by hand: its
 * subsection, its deadline, the tests of harm that hold for it, and its site.
 */
type OwnerNoticeSays = Omit<
  StatuteSays,
  "family" | "place" | "law" | "elements" | "needsName" | "nameFree" | "host"
> &
  Partial<Pick<StatuteSays, "host">>;

function ownerNotice(
  peoples: BreachLawId,
  says: OwnerNoticeSays,
): StatuteSays {
  const people: StatuteSays | undefined = STATUTES.find(
    (statute: StatuteSays): boolean => {
      return statute.id === peoples;
    },
  );

  if (!people) {
    throw new Error(`No line for ${peoples}.`);
  }

  return {
    family: people.family,
    place: people.place,
    law: people.law,
    elements: people.elements,
    needsName: people.needsName,
    nameFree: people.nameFree,
    host: people.host,
    forDataHolders: true,
    ...says,
  };
}

const OWNER_STATUTES: ReadonlyArray<StatuteSays> = [
  // "as expeditiously as possible and without unreasonable delay, but no later than 10 days" (8-38-8).
  ownerNotice(BreachLawId.AlabamaResidents, {
    id: BreachLawId.AlabamaDataOwner,
    provision: "8-38-8",
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: FOUND,
  }),
  // "immediately after the information recipient discovers the breach" (45.48.070(a)).
  ownerNotice(BreachLawId.AlaskaResidents, {
    id: BreachLawId.AlaskaDataOwner,
    provision: "45.48.070(a)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "as soon as practicable"; exception J covers subsection B's notices alone (18-552(C)).
  ownerNotice(BreachLawId.ArizonaResidents, {
    id: BreachLawId.ArizonaDataOwner,
    provision: "18-552(C)",
    conditions: [],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // "immediately following discovery"; (d) excuses "Notification under this section".
  ownerNotice(BreachLawId.ArkansasResidents, {
    id: BreachLawId.ArkansasDataOwner,
    provision: "4-110-105(b)(1)",
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following its discovery" (36a-701b(c)).
  ownerNotice(BreachLawId.ConnecticutResidents, {
    id: BreachLawId.ConnecticutDataOwner,
    provision: "36a-701b(c)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following determination of the breach of security" (12B-102(b)).
  ownerNotice(BreachLawId.DelawareResidents, {
    id: BreachLawId.DelawareDataOwner,
    provision: "12B-102(b)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "in the most expedient time possible following discovery"; harm is in the breach's definition.
  ownerNotice(BreachLawId.DistrictOfColumbiaResidents, {
    id: BreachLawId.DistrictOfColumbiaDataOwner,
    provision: "28-3852(b)",
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
  }),
  // "within 24 hours following discovery", for data held for an information broker or data collector.
  ownerNotice(BreachLawId.GeorgiaResidents, {
    id: BreachLawId.GeorgiaDataOwner,
    provision: "10-1-912(b)",
    conditions: [BreachCondition.HeldForBrokerOrAgency],
    unit: BreachDeadlineUnit.Hours,
    amount: 24,
    start: FOUND,
  }),
  // "as soon as practicable following discovery"; identity theft or fraud is in the breach's definition.
  ownerNotice(BreachLawId.GuamResidents, {
    id: BreachLawId.GuamDataOwner,
    provision: "48.30(c)",
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  }),
  // "immediately following discovery of the breach"; illegal use is in the definition of a security breach.
  ownerNotice(BreachLawId.HawaiiResidents, {
    id: BreachLawId.HawaiiDataOwner,
    provision: "487N-2(b)",
    conditions: [BreachCondition.LikelyIllegalUse],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery of a breach if misuse ... occurred or is reasonably likely to occur".
  ownerNotice(BreachLawId.IdahoResidents, {
    id: BreachLawId.IdahoDataOwner,
    provision: "28-51-105(2)",
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery" (530/10(b)).
  ownerNotice(BreachLawId.IllinoisResidents, {
    id: BreachLawId.IllinoisDataOwner,
    provision: "10(b)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // 3-2's notice, "without unreasonable delay, but not more than forty-five (45) days" (3-3(a)).
  ownerNotice(BreachLawId.IndianaResidents, {
    id: BreachLawId.IndianaDataOwner,
    provision: "24-4.9-3-2",
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
  }),
  // "immediately following discovery of such breach of security" (715C.2(2)).
  ownerNotice(BreachLawId.IowaResidents, {
    id: BreachLawId.IowaDataOwner,
    provision: "715C.2(2)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "following discovery of a breach", no time; identity theft is in the definition (50-7a01(h)).
  ownerNotice(BreachLawId.KansasResidents, {
    id: BreachLawId.KansasDataOwner,
    provision: "50-7a02(b)",
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.NoFixedTime,
    start: FOUND,
  }),
  // "as soon as reasonably practicable following discovery"; identity theft or fraud is in the definition.
  ownerNotice(BreachLawId.KentuckyResidents, {
    id: BreachLawId.KentuckyDataOwner,
    provision: "365.732(3)",
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // (D) and (E): "not later than sixty days from the discovery"; (I) excuses "Notification as provided in this Section".
  ownerNotice(BreachLawId.LouisianaResidents, {
    id: BreachLawId.LouisianaDataOwner,
    provision: "51:3074(D)",
    conditions: [BreachCondition.LikelyHarm],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 60,
    start: FOUND,
  }),
  // "immediately following discovery" (1348(2)).
  ownerNotice(BreachLawId.MaineResidents, {
    id: BreachLawId.MaineDataOwner,
    provision: "1348(2)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "as soon as reasonably practicable, but not later than 10 days" (14-3504(c)(2)).
  ownerNotice(BreachLawId.MarylandResidents, {
    id: BreachLawId.MarylandDataOwner,
    provision: "14-3504(c)",
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: FOUND,
  }),
  // "as soon as practicable and without unreasonable delay", on the people's notice's two triggers.
  ownerNotice(BreachLawId.MassachusettsResidents, {
    id: BreachLawId.MassachusettsDataOwner,
    provision: "3(a)",
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // 445.72(2)'s own exception, and (4): "any notice required under this section without unreasonable delay".
  ownerNotice(BreachLawId.MichiganResidents, {
    id: BreachLawId.MichiganDataOwner,
    provision: "445.72(2)",
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
  }),
  // "immediately following discovery" (325E.61, subdivision 1(b)).
  ownerNotice(BreachLawId.MinnesotaResidents, {
    id: BreachLawId.MinnesotaDataOwner,
    provision: "325E.61, subdivision 1(b)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "as soon as practicable following its discovery", if acquired "for fraudulent purposes" ((4)).
  ownerNotice(BreachLawId.MississippiResidents, {
    id: BreachLawId.MississippiDataOwner,
    provision: "75-24-29(4)",
    conditions: [BreachCondition.AcquiredForFraud],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // "immediately following discovery of the breach"; (5) excuses subdivisions (1) and (2) alike.
  ownerNotice(BreachLawId.MissouriResidents, {
    id: BreachLawId.MissouriDataOwner,
    provision: "407.1500.2(2)",
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery"; loss or injury is in the breach's definition.
  ownerNotice(BreachLawId.MontanaResidents, {
    id: BreachLawId.MontanaDataOwner,
    provision: "30-14-1704(2)",
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "when it becomes aware of a breach if use ... for an unauthorized purpose occurred or is reasonably likely".
  ownerNotice(BreachLawId.NebraskaResidents, {
    id: BreachLawId.NebraskaDataOwner,
    provision: "87-803(3)",
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery" (603A.220(2)).
  ownerNotice(BreachLawId.NevadaResidents, {
    id: BreachLawId.NevadaDataOwner,
    provision: "603A.220(2)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery" (359-C:20, I(c)).
  ownerNotice(BreachLawId.NewHampshireResidents, {
    id: BreachLawId.NewHampshireDataOwner,
    provision: "359-C:20, I(c)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery" (56:8-163(b)).
  ownerNotice(BreachLawId.NewJerseyResidents, {
    id: BreachLawId.NewJerseyDataOwner,
    provision: "56:8-163(b)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "not later than forty-five calendar days following discovery", with its own significant-risk exception.
  ownerNotice(BreachLawId.NewMexicoResidents, {
    id: BreachLawId.NewMexicoDataOwner,
    provision: "57-12C-6(C)",
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
  }),
  // "immediately following discovery of the breach"; illegal use or material risk is in the definition.
  ownerNotice(BreachLawId.NorthCarolinaResidents, {
    id: BreachLawId.NorthCarolinaDataOwner,
    provision: "75-65(b)",
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following the discovery" (51-30-03).
  ownerNotice(BreachLawId.NorthDakotaResidents, {
    id: BreachLawId.NorthDakotaDataOwner,
    provision: "51-30-03",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "in an expeditious manner", if it causes or is believed to cause a material risk of identity theft or fraud.
  ownerNotice(BreachLawId.OhioResidents, {
    id: BreachLawId.OhioDataOwner,
    provision: "1349.19(C)",
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // "as soon as practicable following determination"; identity theft or fraud is in the definition.
  ownerNotice(BreachLawId.OklahomaResidents, {
    id: BreachLawId.OklahomaDataOwner,
    provision: "163(C)",
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
    inForceFrom: "2026-01-01",
  }),
  // "as soon as is practicable but not later than 10 days after discovering the breach" ((2)(a)).
  ownerNotice(BreachLawId.OregonResidents, {
    id: BreachLawId.OregonDataOwner,
    provision: "646A.604(2)",
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: FOUND,
  }),
  // "following discovery by the vendor", no time; loss or injury is in the breach's definition.
  ownerNotice(BreachLawId.PennsylvaniaResidents, {
    id: BreachLawId.PennsylvaniaDataOwner,
    provision: "Section 3(c)",
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.NoFixedTime,
    start: FOUND,
  }),
  // Article 3's second paragraph: an entity that resells or provides access to the databases; no time.
  ownerNotice(BreachLawId.PuertoRicoResidents, {
    id: BreachLawId.PuertoRicoDataOwner,
    provision: "Section 3 (resellers and access providers)",
    conditions: [BreachCondition.ResellsOrProvidesAccess],
    unit: BreachDeadlineUnit.NoFixedTime,
    start: FOUND,
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  }),
  // "immediately following discovery"; illegal use or material risk is in the definition.
  ownerNotice(BreachLawId.SouthCarolinaResidents, {
    id: BreachLawId.SouthCarolinaDataOwner,
    provision: "39-1-90(B)",
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "no later than forty-five (45) days from the discovery or notification" ((c)).
  ownerNotice(BreachLawId.TennesseeResidents, {
    id: BreachLawId.TennesseeDataOwner,
    provision: "47-18-2107(c)",
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 45,
    start: FOUND,
  }),
  // "immediately following discovery" (2209(b)).
  ownerNotice(BreachLawId.UsVirginIslandsResidents, {
    id: BreachLawId.UsVirginIslandsDataOwner,
    provision: "2209(b)",
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  }),
  // "immediately following the person's discovery of the breach if misuse ... occurs or is reasonably likely".
  ownerNotice(BreachLawId.UtahResidents, {
    id: BreachLawId.UtahDataOwner,
    provision: "13-44-202(3)",
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
  }),
  // "immediately following discovery of the breach"; (d) excuses any notice under subsection (b).
  ownerNotice(BreachLawId.VermontResidents, {
    id: BreachLawId.VermontDataOwner,
    provision: "2435(b)(2)",
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    inForceUntil: "2027-01-01",
  }),
  // The same subsection in the text from 1 January 2027, where no name is needed.
  ownerNotice(BreachLawId.VermontResidentsFrom2027, {
    id: BreachLawId.VermontDataOwnerFrom2027,
    provision: "2435(b)(2)",
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  }),
  // "without unreasonable delay following discovery"; identity theft or fraud is in the definition.
  ownerNotice(BreachLawId.VirginiaResidents, {
    id: BreachLawId.VirginiaDataOwner,
    provision: "18.2-186.6(D)",
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
  }),
  // "as soon as practicable", without a contract with the owner; (2)(cm) excuses (bm) too.
  ownerNotice(BreachLawId.WisconsinResidents, {
    id: BreachLawId.WisconsinDataOwner,
    provision: "134.98(2)(bm)",
    conditions: [
      BreachCondition.NoContractWithOwner,
      BreachCondition.NoMaterialRiskOfIdentityTheft,
    ],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  // "as soon as practicable following the determination"; loss or injury is in the definition.
  ownerNotice(BreachLawId.WyomingResidents, {
    id: BreachLawId.WyomingDataOwner,
    provision: "40-12-502(g)",
    conditions: [BreachCondition.LossOrInjury],
    unit: BreachDeadlineUnit.AsSoonAsPracticable,
    start: FOUND,
  }),
  /*
   * The states #10377 read first, whose people's lines are in
   * BreachLaws.test.ts: their data written out here.
   */
  // California Civil Code 1798.82(b), as SB 446 left it: "immediately following discovery".
  {
    id: BreachLawId.CaliforniaDataOwner,
    family: BreachLawFamily.California,
    place: BreachPlace.California,
    law: "California Civil Code",
    provision: "1798.82(b)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      TAX_ID,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GENETIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    host: "leginfo.legislature.ca.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  // Colorado Revised Statutes 6-1-716(2)(b): "in the most expedient time possible, and without unreasonable delay".
  {
    id: BreachLawId.ColoradoDataOwner,
    family: BreachLawFamily.Colorado,
    place: BreachPlace.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716(2)(b)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN, ACCOUNT],
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
    start: FOUND,
    host: "content.leg.colorado.gov",
    forDataHolders: true,
  },
  // Florida Statutes 501.171(6)(a): "as expeditiously as practicable, but no later than 10 days".
  {
    id: BreachLawId.FloridaDataOwner,
    family: BreachLawFamily.Florida,
    place: BreachPlace.Florida,
    law: "Florida Statutes",
    provision: "501.171(6)(a)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      OTHER_ID,
      ACCOUNT,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      GEOLOCATION,
      LOGIN,
    ],
    needsName: true,
    nameFree: [LOGIN],
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 10,
    start: FOUND,
    host: "www.leg.state.fl.us",
    forDataHolders: true,
  },
  // New York General Business Law 899-aa(3): "immediately", "within thirty days following discovery".
  {
    id: BreachLawId.NewYorkDataOwner,
    family: BreachLawFamily.NewYork,
    place: BreachPlace.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(3)",
    elements: [SSN, DL, ACCOUNT, BIOMETRIC, MEDICAL, INSURANCE, LOGIN],
    needsName: false,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.CalendarDays,
    amount: 30,
    start: FOUND,
    host: "www.nysenate.gov",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  // Texas Business and Commerce Code 521.053(c): "immediately after discovering the breach".
  {
    id: BreachLawId.TexasDataOwner,
    family: BreachLawFamily.Texas,
    place: BreachPlace.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053(c)",
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
    needsName: true,
    nameFree: [MEDICAL, INSURANCE],
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    host: "tcss.legis.texas.gov",
    forDataHolders: true,
  },
  // Revised Code of Washington 19.255.010(2): "immediately following discovery".
  {
    id: BreachLawId.WashingtonDataOwner,
    family: BreachLawFamily.Washington,
    place: BreachPlace.Washington,
    law: "Revised Code of Washington",
    provision: "19.255.010(2)",
    elements: [
      SSN,
      DL,
      PASSPORT,
      ACCOUNT,
      DATE_OF_BIRTH,
      MEDICAL,
      INSURANCE,
      BIOMETRIC,
      LOGIN,
    ],
    needsName: false,
    nameFree: [],
    conditions: [],
    unit: BreachDeadlineUnit.Immediately,
    start: FOUND,
    host: "app.leg.wa.gov",
    forDataHolders: true,
  },
];

// Every line of this file: the people's, the offices', the agencies' and the data owner's notices.
const ALL_STATUTES: ReadonlyArray<StatuteSays> = [
  ...STATUTES,
  ...OWNER_STATUTES,
];

// The states #10377 read first, and their rows: those rows' tests are in BreachLaws.test.ts.
const FIRST_STATE_FAMILIES: ReadonlyArray<BreachLawFamily> = [
  BreachLawFamily.California,
  BreachLawFamily.Colorado,
  BreachLawFamily.Florida,
  BreachLawFamily.NewYork,
  BreachLawFamily.Texas,
  BreachLawFamily.Washington,
];

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

/*
 * A store's facts: what it holds (catalog data type ids), where a person
 * said the people live, the countries its data places them in, when it was
 * found, and whether a person said the organization holds it for another.
 */
function factsOf(data: {
  dataTypeIds: Array<string>;
  places?: Array<BreachPlace>;
  countries?: Array<string>;
  records?: number;
  foundAt?: Date;
  now?: Date;
  holdsForAnother?: boolean;
}): BreachLawFacts {
  return {
    whose: getWhoseData({
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
    }),
    reads: {
      logged: ExposureReadsLogged.NotLogged,
      isPublic: true,
      outsideAccounts: 0,
      outsideAccountsUsedInWindow: 0,
      isTreatedAsRead: true,
    },
    foundAt: data.foundAt || FOUND_AT,
    now: data.now || NOW,
    holdsForAnother: data.holdsForAnother,
  };
}

// A row applied with the whole table, so a notice counted from the residents' has their deadline.
function applied(
  id: BreachLawId,
  data: Parameters<typeof factsOf>[0],
): BreachObligation {
  return applyBreachLaws(factsOf(data)).find(
    (obligation: BreachObligation): boolean => {
      return obligation.ruleId === id;
    },
  )!;
}

// Whether the whole table, applied to the facts, holds a row at all.
function holds(id: BreachLawId, data: Parameters<typeof factsOf>[0]): boolean {
  return applyBreachLaws(factsOf(data)).some(
    (obligation: BreachObligation): boolean => {
      return obligation.ruleId === id;
    },
  );
}

/*
 * The day a line's example exposure is found, and the day it is assessed:
 * a text in force from a later day is applied to an exposure found once it
 * is in force; and a notice to the data's owner, once a person says the
 * organization holds the data for another.
 */
function exampleOf(statute: StatuteSays): {
  foundAt: Date;
  now: Date;
  holdsForAnother?: boolean;
} {
  const startsLater: boolean = Boolean(
    statute.inForceFrom &&
      new Date(`${statute.inForceFrom}T00:00:00.000Z`).getTime() >
        FOUND_AT.getTime(),
  );

  return {
    foundAt: startsLater ? FOUND_IN_2027 : FOUND_AT,
    now: startsLater ? NOW_IN_2027 : NOW,
    ...(statute.forDataHolders ? { holdsForAnother: true } : {}),
  };
}

// The action of every notice to the people: the shared words the residents' rows use.
const TELL_THE_PEOPLE_ACTION: string = getBreachLawRule(
  BreachLawId.AlabamaResidents,
).action;

function checkKinds(obligation: BreachObligation): Array<BreachCheckKind> {
  return obligation.checks.map((check: BreachCheck): BreachCheckKind => {
    return check.kind;
  });
}

function conditionsOf(obligation: BreachObligation): Array<BreachCondition> {
  return obligation.checks
    .filter((check: BreachCheck): boolean => {
      return check.kind === BreachCheckKind.Condition;
    })
    .map((check: BreachCheck): BreachCondition => {
      return check.condition!;
    });
}

describe("every US state, the District of Columbia, Puerto Rico, Guam and the US Virgin Islands is a place", () => {
  test("54 places, each by its ISO 3166-2:US code, in alphabetical order", () => {
    expect(US_JURISDICTION_PLACES).toHaveLength(54);
    expect(new Set(US_JURISDICTION_PLACES).size).toBe(54);

    for (const place of US_JURISDICTION_PLACES) {
      expect(place).toMatch(/^US-[A-Z]{2}$/);
      expect(isUsStatePlace(place)).toBe(true);
    }

    const names: Array<string> = US_JURISDICTION_PLACES.map(
      (place: BreachPlace): string => {
        return withMeaningKeyAsItsWord(BREACH_PLACE_CHOICES[place]);
      },
    );

    expect(names).toEqual(
      [...names].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
    expect(US_JURISDICTION_PLACES).toContain(BreachPlace.DistrictOfColumbia);
    expect(US_JURISDICTION_PLACES).toContain(BreachPlace.PuertoRico);
    // Guam and the US Virgin Islands, by their ISO codes (#11426).
    expect(BreachPlace.Guam).toBe("US-GU");
    expect(BreachPlace.UsVirginIslands).toBe("US-VI");
    expect(US_JURISDICTION_PLACES).toContain(BreachPlace.Guam);
    expect(US_JURISDICTION_PLACES).toContain(BreachPlace.UsVirginIslands);
  });

  test("Guam and the US Virgin Islands are named as places and as choices", () => {
    expect(BREACH_PLACE_WORDS[BreachPlace.Guam]).toBe("Guam");
    expect(BREACH_PLACE_CHOICES[BreachPlace.Guam]).toBe("Guam");
    expect(BREACH_PLACE_WORDS[BreachPlace.UsVirginIslands]).toBe(
      "the US Virgin Islands",
    );
    expect(BREACH_PLACE_CHOICES[BreachPlace.UsVirginIslands]).toBe(
      "US Virgin Islands",
    );
  });

  test("data that places its people in Puerto Rico, Guam or the US Virgin Islands by country code places them in that territory", () => {
    expect(getBreachPlaceOfCountry("PR")).toBe(BreachPlace.PuertoRico);
    expect(getBreachPlaceOfCountry(" gu ")).toBe(BreachPlace.Guam);
    expect(getBreachPlaceOfCountry("VI")).toBe(BreachPlace.UsVirginIslands);
    // The British Virgin Islands are a country of their own, which the table does not cover.
    expect(getBreachPlaceOfCountry("VG")).toBe(BreachPlace.Elsewhere);

    const obligation: BreachObligation = applied(
      BreachLawId.PuertoRicoConsumerAffairs,
      { dataTypeIds: ["us-ssn", "person-name"], countries: ["PR"] },
    );

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.isPlaceKnown).toBe(true);
    expect(obligation.reasons).toContainEqual({
      kind: BreachReasonKind.PeopleIn,
      places: [BreachPlace.PuertoRico],
    });
  });

  test("the states the table had before stay as they were, so answers already saved keep their meaning", () => {
    expect(BreachPlace.California).toBe("US-CA");
    expect(BreachPlace.Colorado).toBe("US-CO");
    expect(BreachPlace.Florida).toBe("US-FL");
    expect(BreachPlace.NewYork).toBe("US-NY");
    expect(BreachPlace.Texas).toBe("US-TX");
    expect(BreachPlace.Washington).toBe("US-WA");
    // "Another US state" is still a place an answer may hold, and still a state.
    expect(BreachPlace.OtherUsState).toBe("US-OTHER");
    expect(US_STATE_PLACES).toContain(BreachPlace.OtherUsState);
    expect(US_JURISDICTION_PLACES).not.toContain(BreachPlace.OtherUsState);
  });

  test("a person picks the regions as chips, and every state from a list of its own", () => {
    expect(BREACH_PLACE_REGION_CHOICES).toEqual([
      BreachPlace.Eea,
      BreachPlace.UnitedKingdom,
      BreachPlace.UnitedStates,
      BreachPlace.Brazil,
      BreachPlace.India,
      BreachPlace.Elsewhere,
    ]);

    for (const place of BREACH_PLACE_REGION_CHOICES) {
      expect(isUsStatePlace(place)).toBe(false);
    }
  });

  test("Georgia the state is a key of its own, so it never reads as the country", () => {
    expect(BREACH_PLACE_CHOICES[BreachPlace.Georgia]).toBe(
      "Georgia (US state)",
    );
    expect(BREACH_PLACE_WORDS[BreachPlace.Georgia]).toBe("Georgia (US state)");
    // English reads the word alone.
    expect(
      withMeaningKeyAsItsWord(BREACH_PLACE_WORDS[BreachPlace.Georgia]),
    ).toBe("Georgia");
    expect(BREACH_PLACE_WORDS[BreachPlace.DistrictOfColumbia]).toBe(
      "the District of Columbia",
    );
    expect(BREACH_PLACE_CHOICES[BreachPlace.DistrictOfColumbia]).toBe(
      "District of Columbia",
    );
  });

  test("the table covers a place exactly when some row names it, and names every state it leaves out", () => {
    for (const place of COVERED_PLACES) {
      expect(
        BREACH_LAW_RULES.some((rule: BreachLawRule): boolean => {
          return Boolean(rule.places?.includes(place));
        }),
      ).toBe(true);
    }

    expect(COVERED_PLACES).not.toContain(BreachPlace.Elsewhere);
    expect(COVERED_PLACES).not.toContain(BreachPlace.OtherUsState);
    expect(COVERED_PLACES).not.toContain(BreachPlace.UnitedStates);
    expect([...COVERED_US_STATES, ...UNCOVERED_US_STATES].sort()).toEqual(
      [...US_JURISDICTION_PLACES].sort(),
    );

    // Every state this file holds a statute for is covered; every other state is said to be left out.
    const read: Set<BreachPlace> = new Set(
      ALL_STATUTES.map((statute: StatuteSays): BreachPlace => {
        return statute.place;
      }),
    );

    for (const family of FIRST_STATE_FAMILIES) {
      const rule: BreachLawRule | undefined = BREACH_LAW_RULES.find(
        (candidate: BreachLawRule): boolean => {
          return candidate.family === family;
        },
      );

      read.add(rule!.places![0]!);
    }

    expect([...COVERED_US_STATES].sort()).toEqual([...read].sort());
  });

  test("West Virginia is the one jurisdiction left out: its code could not be read from its official site", () => {
    expect(UNCOVERED_US_STATES).toEqual([BreachPlace.WestVirginia]);
    expect(COVERED_US_STATES).toContain(BreachPlace.PuertoRico);
    expect(COVERED_US_STATES).toContain(BreachPlace.Guam);
    expect(COVERED_US_STATES).toContain(BreachPlace.UsVirginIslands);
    expect(
      BREACH_LAW_RULES.some((rule: BreachLawRule): boolean => {
        return Boolean(rule.places?.includes(BreachPlace.WestVirginia));
      }),
    ).toBe(false);
  });
});

describe("the other US states' rows, as a set", () => {
  const STATE_ROWS: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
    (rule: BreachLawRule): boolean => {
      return isUsStateRule(rule) && !FIRST_STATE_ROWS.includes(rule.id);
    },
  );

  test("every row is in this file, and every row this file holds is in the table", () => {
    expect(
      STATE_ROWS.map((rule: BreachLawRule): BreachLawId => {
        return rule.id;
      }).sort(),
    ).toEqual(
      ALL_STATUTES.map((statute: StatuteSays): BreachLawId => {
        return statute.id;
      }).sort(),
    );
    expect(new Set(ALL_STATUTES).size).toBe(ALL_STATUTES.length);
  });

  test("each was read on the day its line says - 27 November 2026, or 28 November for #11424 to #11427's - and applies in its own state alone", () => {
    expect(US_STATE_LAWS_CHECKED_ON).toBe("2026-11-27");
    expect(FOLLOW_UP_LAWS_CHECKED_ON).toBe("2026-11-28");

    for (const rule of STATE_ROWS) {
      const statute: StatuteSays = ALL_STATUTES.find(
        (each: StatuteSays): boolean => {
          return each.id === rule.id;
        },
      )!;

      expect({ id: rule.id, checkedOn: rule.checkedOn }).toEqual({
        id: rule.id,
        checkedOn: statute.checkedOn || US_STATE_LAWS_CHECKED_ON,
      });
      expect(rule.places).toHaveLength(1);
      expect(US_JURISDICTION_PLACES).toContain(rule.places![0]);
    }
  });

  test("a row's days in force are its line's: Vermont's two texts meet on 1 January 2027, and no other row has an end", () => {
    for (const statute of ALL_STATUTES) {
      const rule: BreachLawRule = getBreachLawRule(statute.id);

      expect({
        id: rule.id,
        inForceFrom: rule.inForceFrom,
        inForceUntil: rule.inForceUntil,
      }).toEqual({
        id: statute.id,
        inForceFrom: statute.inForceFrom,
        inForceUntil: statute.inForceUntil,
      });
    }

    const ending: Array<BreachLawId> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return Boolean(rule.inForceUntil);
      },
    ).map((rule: BreachLawRule): BreachLawId => {
      return rule.id;
    });

    expect(ending.sort()).toEqual(
      [
        BreachLawId.VermontResidents,
        BreachLawId.VermontAttorneyGeneral,
        BreachLawId.VermontConsumerReportingAgencies,
        BreachLawId.VermontDataOwner,
      ].sort(),
    );
  });

  test("a state's notices are one family, named as the state is", () => {
    for (const rule of STATE_ROWS) {
      expect(rule.family as string).toBe(
        withMeaningKeyAsItsWord(BREACH_PLACE_CHOICES[rule.places![0]!]),
      );
    }
  });

  test("a state's notice to the consumer reporting agencies covers the data its people's notice does, and has a threshold wherever its statute sets one", () => {
    const agencies: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return (
          isUsStateRule(rule) &&
          rule.id.endsWith("-consumer-reporting-agencies")
        );
      },
    );

    expect(agencies.length).toBeGreaterThan(20);

    for (const rule of agencies) {
      const residents: BreachLawRule = BREACH_LAW_RULES.find(
        (candidate: BreachLawRule): boolean => {
          return (
            candidate.family === rule.family &&
            candidate.action ===
              getBreachLawRule(BreachLawId.AlabamaResidents).action &&
            candidate.inForceFrom === rule.inForceFrom
          );
        },
      )!;
      const statute: StatuteSays = STATUTES.find(
        (each: StatuteSays): boolean => {
          return each.id === rule.id;
        },
      )!;

      expect({ id: rule.id, elements: rule.dataElements }).toEqual({
        id: rule.id,
        elements: residents.dataElements,
      });
      // South Dakota's and Massachusetts' are owed whenever the residents are told.
      expect({ id: rule.id, threshold: rule.minimumPeople }).toEqual({
        id: rule.id,
        threshold: statute.minimumPeople,
      });
      expect(rule.recipient.toLowerCase()).toContain("reporting agencies");
    }

    expect(
      getBreachLawRule(BreachLawId.SouthDakotaConsumerReportingAgencies)
        .minimumPeople,
    ).toBeUndefined();
    expect(
      getBreachLawRule(BreachLawId.MassachusettsConsumerReportingAgencies)
        .minimumPeople,
    ).toBeUndefined();
  });

  test("what a statute adds beyond its deadline is said on its row, in its own terms", () => {
    const said: (id: BreachLawId) => string = (id: BreachLawId): string => {
      const rule: BreachLawRule = getBreachLawRule(id);

      return [rule.recipient, rule.deadlineNote || "", rule.note || ""].join(
        " | ",
      );
    };

    // Wisconsin: an organization based there tells everyone, wherever they live.
    expect(said(BreachLawId.WisconsinResidents)).toContain(
      "if you are based in Wisconsin or hold the data there, everyone the data is about",
    );
    expect(said(BreachLawId.WisconsinResidents)).toContain(
      "Within a reasonable time",
    );
    // Massachusetts: the agencies are the ones its director names.
    expect(said(BreachLawId.MassachusettsConsumerReportingAgencies)).toContain(
      "the Director of Consumer Affairs and Business Regulation names",
    );
    // Colorado: the agencies hear when, and about how many.
    expect(said(BreachLawId.ColoradoConsumerReportingAgencies)).toContain(
      "with when the residents will be told and about how many",
    );
    expect(said(BreachLawId.ColoradoConsumerReportingAgencies)).toContain(
      "Gramm-Leach-Bliley",
    );
    // Montana: a notice that points to an agency is coordinated with it.
    expect(said(BreachLawId.MontanaResidents)).toContain(
      "coordinate its timing, content and distribution with that agency",
    );
    // Vermont: a preliminary description first; the 2027 text is said.
    expect(said(BreachLawId.VermontAttorneyGeneral)).toContain(
      "First a preliminary description",
    );
    expect(said(BreachLawId.VermontResidents)).toContain("1 January 2027");
    // Virginia: an employer's own notice of a taxpayer number taken.
    expect(said(BreachLawId.VirginiaAttorneyGeneral)).toContain(
      "payroll service provider",
    );
    // Utah: the attorney general and the Cyber Center together.
    expect(said(BreachLawId.UtahAttorneyGeneral)).toContain(
      "Utah Cyber Center",
    );
    // Texas: the agencies only past 10,000 people at one time.
    expect(
      getBreachLawRule(BreachLawId.TexasConsumerReportingAgencies)
        .minimumPeople,
    ).toEqual({ count: 10000, isMoreThan: true });
    // Vermont from 2027: no name needed where the data is enough for identity theft; HIPAA entities still tell the attorney general.
    expect(said(BreachLawId.VermontResidentsFrom2027)).toContain(
      "enough to attempt identity theft",
    );
    expect(said(BreachLawId.VermontAttorneyGeneralFrom2027)).toContain(
      "written certification that it followed HIPAA's breach notification rule",
    );
    expect(said(BreachLawId.VermontAttorneyGeneralFrom2027)).toContain(
      "swore its security policies",
    );
    expect(said(BreachLawId.VermontConsumerReportingAgenciesFrom2027)).toContain(
      "Title 8",
    );
    // Puerto Rico: a custodian tells the people too; the Department announces it within 24 hours, in a time that cannot be extended.
    expect(said(BreachLawId.PuertoRicoResidents)).toContain(
      "keeps the data in its custody for another too",
    );
    expect(said(BreachLawId.PuertoRicoResidents)).toContain(
      "law enforcement's need to secure evidence",
    );
    expect(said(BreachLawId.PuertoRicoConsumerAffairs)).toContain(
      "announces the breach publicly within 24 hours",
    );
    expect(said(BreachLawId.PuertoRicoConsumerAffairs)).toContain(
      "cannot be extended",
    );
    // The notices to the data's owner (#11427): what each statute adds.
    expect(said(BreachLawId.AlabamaDataOwner)).toContain(
      "may agree, by contract, that you send the notices",
    );
    expect(said(BreachLawId.AlaskaDataOwner)).toContain(
      "You need not tell the people yourself",
    );
    expect(said(BreachLawId.ArizonaDataOwner)).toContain(
      "only if your agreement with the data's owner says you do",
    );
    expect(said(BreachLawId.OregonDataOwner)).toContain(
      "tells the attorney general when more than 250 consumers",
    );
    expect(said(BreachLawId.PennsylvaniaDataOwner)).toContain(
      "makes the law's determinations",
    );
    expect(said(BreachLawId.WyomingDataOwner)).toContain(
      "may agree which of you tells the people",
    );
    expect(said(BreachLawId.GeorgiaDataOwner)).toContain(
      "The information broker or agency you hold the data for",
    );
    expect(said(BreachLawId.PuertoRicoDataOwner)).toContain(
      "The data's owner, custodian or holder",
    );
    expect(said(BreachLawId.PuertoRicoDataOwner)).toContain(
      "The law sets no time for this notice.",
    );
    expect(said(BreachLawId.NewYorkDataOwner)).toContain("Immediately");
    expect(said(BreachLawId.NebraskaDataOwner)).toContain(
      "When you become aware of the breach.",
    );
    expect(said(BreachLawId.OhioDataOwner)).toContain(
      "In an expeditious manner",
    );
    for (const id of [
      BreachLawId.KansasDataOwner,
      BreachLawId.PennsylvaniaDataOwner,
    ]) {
      expect(said(id)).toContain("the law sets no time for it");
    }
  });
});

describe("Vermont's two texts: until 1 January 2027, and from that day (#11425)", () => {
  // Each row of the text until then, and the row of the text from then that replaces it.
  const PAIRS: ReadonlyArray<[BreachLawId, BreachLawId]> = [
    [BreachLawId.VermontResidents, BreachLawId.VermontResidentsFrom2027],
    [
      BreachLawId.VermontAttorneyGeneral,
      BreachLawId.VermontAttorneyGeneralFrom2027,
    ],
    [
      BreachLawId.VermontConsumerReportingAgencies,
      BreachLawId.VermontConsumerReportingAgenciesFrom2027,
    ],
    [BreachLawId.VermontDataOwner, BreachLawId.VermontDataOwnerFrom2027],
  ];
  const SSN_WITH_NAME: Array<string> = ["us-ssn", "person-name"];
  const IN_VERMONT: Array<BreachPlace> = [BreachPlace.Vermont];

  test("each old row ends the day its new row starts, and they are the same notice", () => {
    for (const [old, next] of PAIRS) {
      const before: BreachLawRule = getBreachLawRule(old);
      const after: BreachLawRule = getBreachLawRule(next);

      expect(before.inForceUntil).toBe("2027-01-01");
      expect(before.inForceFrom).toBeUndefined();
      expect(after.inForceFrom).toBe("2027-01-01");
      expect(after.inForceUntil).toBeUndefined();
      // The same notice of the same law: who, what, when and what a person checks.
      expect({
        family: after.family,
        law: after.law,
        provision: after.provision,
        places: after.places,
        dataElements: after.dataElements,
        minimumPeople: after.minimumPeople,
        conditions: after.conditions,
        action: after.action,
        recipient: after.recipient,
        deadline: after.deadline,
        deadlineNote: after.deadlineNote,
        forDataHolders: after.forDataHolders,
      }).toEqual({
        family: before.family,
        law: before.law,
        provision: before.provision,
        places: before.places,
        dataElements: before.dataElements,
        minimumPeople: before.minimumPeople,
        conditions: before.conditions,
        action: before.action,
        recipient: before.recipient,
        deadline: before.deadline,
        deadlineNote: before.deadlineNote,
        forDataHolders: before.forDataHolders,
      });
      // What changes: a name is no longer needed.
      expect(before.needsName).toBe(true);
      expect(after.needsName).toBe(false);
      // Read from the same statute page, which sets out both texts, and cited as the act amended it.
      expect(after.sourceUrl).toBe(before.sourceUrl);
      expect(before.sourceTitle).toContain("until 1 January 2027");
      expect(after.sourceTitle).toContain("2025, No. 138 (Adj. Sess.)");
      expect(after.sourceTitle).toContain("from 1 January 2027");
      expect(after.checkedOn).toBe(FOLLOW_UP_LAWS_CHECKED_ON);
    }
  });

  test("found on the last day of 2026, the text in force until 1 January 2027 applies", () => {
    const facts: Parameters<typeof factsOf>[0] = {
      dataTypeIds: SSN_WITH_NAME,
      places: IN_VERMONT,
      foundAt: new Date("2026-12-31T23:59:59.000Z"),
      now: new Date("2026-12-31T23:59:59.000Z"),
      holdsForAnother: true,
    };

    for (const [old, next] of PAIRS) {
      expect(applied(old, facts).status).toBe(BreachObligationStatus.MayApply);

      const notYet: BreachObligation = applied(next, facts);

      expect(notYet.status).toBe(BreachObligationStatus.NotYetInForce);
      expect(notYet.reasons).toEqual([
        { kind: BreachReasonKind.NotInForce, date: "2027-01-01" },
      ]);
    }

    // The residents' 45 days count from when it was found.
    expect(applied(BreachLawId.VermontResidents, facts).dueAt).toBe(
      "2027-02-14T23:59:59.000Z",
    );
  });

  test("found on 1 January 2027, the new text applies, and the old one is not this exposure's at all", () => {
    const facts: Parameters<typeof factsOf>[0] = {
      dataTypeIds: SSN_WITH_NAME,
      places: IN_VERMONT,
      foundAt: new Date("2027-01-01T00:00:00.000Z"),
      now: new Date("2027-01-01T00:00:00.000Z"),
      holdsForAnother: true,
    };

    for (const [old, next] of PAIRS) {
      expect(holds(old, facts)).toBe(false);

      const obligation: BreachObligation = applied(next, facts);

      expect(obligation.status).toBe(BreachObligationStatus.MayApply);
      expect(obligation.isPlaceKnown).toBe(true);
    }

    expect(applied(BreachLawId.VermontResidentsFrom2027, facts).dueAt).toBe(
      "2027-02-15T00:00:00.000Z",
    );
    // 14 business days, Friday 1 January 2027 to Thursday 21 January.
    expect(
      applied(BreachLawId.VermontAttorneyGeneralFrom2027, facts).dueAt,
    ).toBe("2027-01-21T00:00:00.000Z");
  });

  test("found in December 2026 and assessed in 2027, it still follows the text in force when it was found", () => {
    const facts: Parameters<typeof factsOf>[0] = {
      dataTypeIds: SSN_WITH_NAME,
      places: IN_VERMONT,
      foundAt: new Date("2026-12-20T10:00:00.000Z"),
      now: new Date("2027-01-10T10:00:00.000Z"),
      holdsForAnother: true,
    };

    for (const [old, next] of PAIRS) {
      expect(applied(old, facts).status).toBe(BreachObligationStatus.MayApply);

      const later: BreachObligation = applied(next, facts);

      // In force now, but not on the day it was found: it does not apply, and says why.
      expect(later.status).toBe(BreachObligationStatus.NotTriggered);
      expect(later.reasons).toEqual([
        { kind: BreachReasonKind.InForceAfterFound, date: "2027-01-01" },
      ]);
      expect(later.dueAt).toBeUndefined();
    }
  });

  test("a Social Security number found without a name: the old text asks whether names were held, the new one does not", () => {
    const before: BreachObligation = applied(BreachLawId.VermontResidents, {
      dataTypeIds: ["us-ssn"],
      places: IN_VERMONT,
    });
    const after: BreachObligation = applied(
      BreachLawId.VermontResidentsFrom2027,
      {
        dataTypeIds: ["us-ssn"],
        places: IN_VERMONT,
        foundAt: FOUND_IN_2027,
        now: NOW_IN_2027,
      },
    );

    expect(checkKinds(before)).toContain(BreachCheckKind.HeldWithNames);
    expect(after.status).toBe(BreachObligationStatus.MayApply);
    expect(checkKinds(after)).not.toContain(BreachCheckKind.HeldWithNames);
    // Where the data is enough to attempt identity theft: said on the row.
    expect(
      getBreachLawRule(BreachLawId.VermontResidentsFrom2027).note,
    ).toContain("enough to attempt identity theft");
  });

  test("the day that decides is the day it was found, in UTC: one second before midnight is 2026", () => {
    const rule: BreachLawRule = getBreachLawRule(BreachLawId.VermontResidents);
    const next: BreachLawRule = getBreachLawRule(
      BreachLawId.VermontResidentsFrom2027,
    );
    const lastSecond: Parameters<typeof factsOf>[0] = {
      dataTypeIds: SSN_WITH_NAME,
      places: IN_VERMONT,
      foundAt: new Date("2026-12-31T23:59:59.999Z"),
      now: new Date("2027-03-01T00:00:00.000Z"),
    };
    const firstMoment: Parameters<typeof factsOf>[0] = {
      ...lastSecond,
      foundAt: new Date("2027-01-01T00:00:00.000Z"),
    };

    expect(isBreachLawForFacts(rule, factsOf(lastSecond))).toBe(true);
    expect(isBreachLawForFacts(rule, factsOf(firstMoment))).toBe(false);
    expect(isBreachLawForFacts(next, factsOf(lastSecond))).toBe(true);
    expect(isBreachLawForFacts(next, factsOf(firstMoment))).toBe(true);
    // Applied on its own past its end, the old row says a newer text replaced it.
    expect(applyBreachLaw(rule, factsOf(firstMoment)).reasons).toEqual([
      { kind: BreachReasonKind.ReplacedBeforeFound, date: "2027-01-01" },
    ]);
  });
});

describe("Puerto Rico, Guam and the US Virgin Islands (#11424, #11426)", () => {
  test("Puerto Rico's law is read in Spanish, from the Legislative Assembly's own copies of the act and its amendment", () => {
    const residents: BreachLawRule = getBreachLawRule(
      BreachLawId.PuertoRicoResidents,
    );
    const department: BreachLawRule = getBreachLawRule(
      BreachLawId.PuertoRicoConsumerAffairs,
    );

    for (const rule of [residents, department]) {
      expect(new URL(rule.sourceUrl).hostname).toBe("sutra.oslpr.org");
      expect(rule.sourceTitle).toContain(
        "Ley Núm. 111 de 7 de septiembre de 2005",
      );
      expect(rule.checkedOn).toBe(FOLLOW_UP_LAWS_CHECKED_ON);
    }

    // The first paragraph of Article 3 as Ley 97-2008 rewrote it: the residents' notice cites the amendment.
    expect(residents.sourceTitle).toContain(
      "Ley Núm. 97 de 19 de junio de 2008",
    );
    expect(residents.sourceUrl).not.toBe(department.sourceUrl);
  });

  test("Puerto Rico's Department of Consumer Affairs within 10 calendar days of detecting it, for every breach", () => {
    const obligation: BreachObligation = applied(
      BreachLawId.PuertoRicoConsumerAffairs,
      {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [BreachPlace.PuertoRico],
        records: 3,
      },
    );

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.dueAt).toBe("2026-12-03T09:00:00.000Z");
    // No threshold, and no test of harm: nothing for a person to weigh but whether it was read.
    expect(checkKinds(obligation)).toEqual([]);
  });

  test("Puerto Rico's personal information: a passport is an official identification, a taxpayer number tax information, and every item needs the name", () => {
    for (const id of ["us-passport", "us-itin"]) {
      const named: BreachObligation = applied(BreachLawId.PuertoRicoResidents, {
        dataTypeIds: [id, "person-name"],
        places: [BreachPlace.PuertoRico],
      });
      const nameless: BreachObligation = applied(
        BreachLawId.PuertoRicoResidents,
        { dataTypeIds: [id], places: [BreachPlace.PuertoRico] },
      );

      expect(named.status).toBe(BreachObligationStatus.MayApply);
      expect(checkKinds(named)).not.toContain(BreachCheckKind.HeldWithNames);
      expect(checkKinds(nameless)).toContain(BreachCheckKind.HeldWithNames);
    }

    // A user name and password count only with the name, like every item on its list.
    expect(
      checkKinds(
        applied(BreachLawId.PuertoRicoResidents, {
          dataTypeIds: ["email-address", "generic-secret"],
          places: [BreachPlace.PuertoRico],
        }),
      ),
    ).toContain(BreachCheckKind.HeldWithNames);
  });

  test("Guam's residents, where the breach causes or is believed to cause identity theft or fraud; no other notice", () => {
    const rows: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return Boolean(rule.places?.includes(BreachPlace.Guam));
      },
    );

    expect(
      rows
        .map((rule: BreachLawRule): BreachLawId => {
          return rule.id;
        })
        .sort(),
    ).toEqual(
      [BreachLawId.GuamResidents, BreachLawId.GuamDataOwner].sort(),
    );
    expect(new URL(rows[0]!.sourceUrl).hostname).toBe("col.guamcourts.gov");
    expect(
      conditionsOf(
        applied(BreachLawId.GuamResidents, {
          dataTypeIds: ["us-drivers-license", "person-name"],
          places: [BreachPlace.Guam],
        }),
      ),
    ).toEqual([BreachCondition.CausesIdentityTheftOrFraud]);
  });

  test("the US Virgin Islands' residents, with no test of harm; no other notice", () => {
    const rows: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return Boolean(rule.places?.includes(BreachPlace.UsVirginIslands));
      },
    );

    expect(
      rows
        .map((rule: BreachLawRule): BreachLawId => {
          return rule.id;
        })
        .sort(),
    ).toEqual(
      [
        BreachLawId.UsVirginIslandsResidents,
        BreachLawId.UsVirginIslandsDataOwner,
      ].sort(),
    );
    expect(new URL(rows[0]!.sourceUrl).hostname).toBe(
      "billtracking.legvi.org",
    );
    expect(rows[0]!.sourceTitle).toContain("Act No. 6789 (2005)");

    const obligation: BreachObligation = applied(
      BreachLawId.UsVirginIslandsResidents,
      {
        dataTypeIds: ["bank-account-number", "person-name"],
        places: [BreachPlace.UsVirginIslands],
      },
    );

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(conditionsOf(obligation)).toEqual([]);
  });
});

/*
 * A statute that covers government ID numbers in general words covers a
 * passport number and a taxpayer identification number by its terms,
 * though it names neither: New Hampshire's notice no longer missed an
 * exposure of passport numbers held with names. A statute that names its
 * government IDs one by one covers only those.
 */
describe("a statute's general words for government ID numbers cover a passport and a taxpayer number it does not name", () => {
  const PASSPORTS: ReadonlyArray<string> = [
    "us-passport",
    "uk-passport",
    "passport-number",
  ];
  const GENERIC: ReadonlyArray<[BreachLawId, string]> = [
    [
      BreachLawId.NewHampshireResidents,
      "other government identification number",
    ],
    [BreachLawId.NewMexicoResidents, "government-issued identification number"],
    [
      BreachLawId.IowaResidents,
      "other unique identification number created or collected by a government body",
    ],
    [
      BreachLawId.MissouriResidents,
      "other unique identification number created or collected by a government body",
    ],
    [
      BreachLawId.SouthDakotaResidents,
      "other unique identification number created or collected by a government body",
    ],
    [
      BreachLawId.OklahomaResidents,
      "other unique identification number created or collected by a government entity",
    ],
    [
      BreachLawId.SouthCarolinaResidents,
      "numbers or information issued by a governmental or regulatory entity that uniquely will identify an individual",
    ],
    [BreachLawId.TexasIndividuals, "government-issued identification number"],
  ];

  test.each(GENERIC)(
    "%s: \"%s\" - a passport number and a taxpayer number, each held with a name",
    (id: BreachLawId) => {
      const rule: BreachLawRule = getBreachLawRule(id);

      expect(rule.dataElements).toEqual(
        expect.arrayContaining([
          BreachDataElement.PassportNumber,
          BreachDataElement.TaxIdNumber,
          BreachDataElement.OtherGovernmentId,
        ]),
      );

      for (const type of [...PASSPORTS, "us-itin"]) {
        const obligation: BreachObligation = applied(id, {
          dataTypeIds: [type, "person-name"],
          places: [rule.places![0]!],
        });

        expect({ id, type, status: obligation.status }).toEqual({
          id,
          type,
          status: BreachObligationStatus.MayApply,
        });
        expect(obligation.reasons).toContainEqual({
          kind: BreachReasonKind.Holds,
          elements: [
            type === "us-itin"
              ? BreachDataElement.TaxIdNumber
              : BreachDataElement.PassportNumber,
          ],
        });
      }

      // Without the name, none of these lists counts it.
      expect(rule.needsName).toBe(true);
      expect(
        checkKinds(
          applied(id, {
            dataTypeIds: ["us-passport"],
            places: [rule.places![0]!],
          }),
        ),
      ).toContain(BreachCheckKind.HeldWithNames);
    },
  );

  test("every row of each of those states covers them, its notices to the attorney general, the agencies and the owner too", () => {
    const families: Array<BreachLawFamily> = GENERIC.map(
      ([id]: [BreachLawId, string]): BreachLawFamily => {
        return getBreachLawRule(id).family;
      },
    );

    for (const rule of BREACH_LAW_RULES.filter((each: BreachLawRule) => {
      return families.includes(each.family);
    })) {
      expect({
        id: rule.id,
        passport: rule.dataElements.includes(BreachDataElement.PassportNumber),
        taxId: rule.dataElements.includes(BreachDataElement.TaxIdNumber),
      }).toEqual({ id: rule.id, passport: true, taxId: true });
    }
  });

  test("Oregon's \"other identification number issued by the United States\" is the IRS's taxpayer number too", () => {
    for (const rule of BREACH_LAW_RULES.filter((each: BreachLawRule) => {
      return each.family === BreachLawFamily.Oregon;
    })) {
      expect({
        id: rule.id,
        taxId: rule.dataElements.includes(BreachDataElement.TaxIdNumber),
      }).toEqual({ id: rule.id, taxId: true });
    }

    expect(
      applied(BreachLawId.OregonResidents, {
        dataTypeIds: ["us-itin", "person-name"],
        places: [BreachPlace.Oregon],
      }).status,
    ).toBe(BreachObligationStatus.MayApply);
  });

  test("a statute that names its government IDs one by one covers only those: no passport where it names none", () => {
    // Mississippi, Rhode Island and Montana name a tribal ID card; New York names no other ID at all.
    for (const [id, place] of [
      [BreachLawId.MississippiResidents, BreachPlace.Mississippi],
      [BreachLawId.RhodeIslandResidents, BreachPlace.RhodeIsland],
      [BreachLawId.MontanaResidents, BreachPlace.Montana],
      [BreachLawId.NewYorkResidents, BreachPlace.NewYork],
    ] as Array<[BreachLawId, BreachPlace]>) {
      for (const type of PASSPORTS) {
        expect({
          id,
          type,
          status: applied(id, {
            dataTypeIds: [type, "person-name"],
            places: [place],
          }).status,
        }).toEqual({
          id,
          type,
          status: BreachObligationStatus.NotTriggered,
        });
      }
    }

    // Montana names the taxpayer number; Mississippi does not.
    expect(
      applied(BreachLawId.MontanaResidents, {
        dataTypeIds: ["us-itin", "person-name"],
        places: [BreachPlace.Montana],
      }).status,
    ).toBe(BreachObligationStatus.MayApply);
    expect(
      applied(BreachLawId.MississippiResidents, {
        dataTypeIds: ["us-itin", "person-name"],
        places: [BreachPlace.Mississippi],
      }).status,
    ).toBe(BreachObligationStatus.NotTriggered);
  });
});

describe("the notice to the data's owner (#11427)", () => {
  const OWNER_ROWS: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
    (rule: BreachLawRule): boolean => {
      return isUsStateRule(rule) && rule.forDataHolders === true;
    },
  );

  test("every US jurisdiction the table covers has one, but Rhode Island and South Dakota, whose statutes ask for none", () => {
    const places: Set<BreachPlace> = new Set(
      OWNER_ROWS.map((rule: BreachLawRule): BreachPlace => {
        return rule.places![0]!;
      }),
    );

    expect([...places].sort()).toEqual(
      COVERED_US_STATES.filter((place: BreachPlace): boolean => {
        return (
          place !== BreachPlace.RhodeIsland && place !== BreachPlace.SouthDakota
        );
      }).sort(),
    );
    expect(OWNER_ROWS).toHaveLength(OWNER_STATUTES.length);
  });

  test("each tells the data's owner and is applied only once a person says the organization holds the data for another", () => {
    for (const rule of OWNER_ROWS) {
      const statute: StatuteSays = OWNER_STATUTES.find(
        (each: StatuteSays): boolean => {
          return each.id === rule.id;
        },
      )!;
      const example: Parameters<typeof factsOf>[0] = {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [statute.place],
        foundAt: exampleOf(statute).foundAt,
        now: exampleOf(statute).now,
      };

      expect(rule.action).toMatch(/^Tell the data's owner$/);
      expect({ id: rule.id, held: holds(rule.id, example) }).toEqual({
        id: rule.id,
        held: false,
      });
      expect({
        id: rule.id,
        held: holds(rule.id, { ...example, holdsForAnother: false }),
      }).toEqual({ id: rule.id, held: false });
      expect({
        id: rule.id,
        held: holds(rule.id, { ...example, holdsForAnother: true }),
      }).toEqual({ id: rule.id, held: true });
    }
  });

  test("each covers the data its jurisdiction's notice to the people does, as the text in force that day reads it", () => {
    for (const rule of OWNER_ROWS) {
      const statute: StatuteSays = OWNER_STATUTES.find(
        (each: StatuteSays): boolean => {
          return each.id === rule.id;
        },
      )!;
      const day: Date = exampleOf(statute).foundAt;
      const people: BreachLawRule = BREACH_LAW_RULES.find(
        (candidate: BreachLawRule): boolean => {
          return (
            candidate.family === rule.family &&
            candidate.action === TELL_THE_PEOPLE_ACTION &&
            isBreachLawInForce(candidate, day)
          );
        },
      )!;

      expect({ id: rule.id, hasPeoplesNotice: Boolean(people) }).toEqual({
        id: rule.id,
        hasPeoplesNotice: true,
      });

      expect({
        id: rule.id,
        elements: rule.dataElements,
        needsName: rule.needsName,
        nameFree: rule.nameFreeElements,
      }).toEqual({
        id: rule.id,
        elements: people.dataElements,
        needsName: people.needsName,
        nameFree: people.nameFreeElements,
      });
      // No threshold of people: the owner is told of any breach.
      expect(rule.minimumPeople).toBeUndefined();
    }
  });

  test("a test of harm carries over only where the statute puts it on this notice", () => {
    // Arizona's exception covers the notices of subsection B alone, so its owner's has none.
    expect(getBreachLawRule(BreachLawId.ArizonaResidents).conditions).toEqual([
      BreachCondition.SubstantialEconomicLoss,
    ]);
    expect(getBreachLawRule(BreachLawId.ArizonaDataOwner).conditions).toEqual(
      [],
    );
    // Alabama's substantial harm is a test for the covered entity's notice alone.
    expect(getBreachLawRule(BreachLawId.AlabamaDataOwner).conditions).toEqual(
      [],
    );
    // Kentucky's, in the definition of a breach, holds for both.
    expect(
      getBreachLawRule(BreachLawId.KentuckyDataOwner).conditions,
    ).toEqual(getBreachLawRule(BreachLawId.KentuckyResidents).conditions);
    // Wisconsin's: only without a contract with the owner, and its exception covers it too.
    expect(
      conditionsOf(
        applied(BreachLawId.WisconsinDataOwner, {
          dataTypeIds: ["us-ssn", "person-name"],
          places: [BreachPlace.Wisconsin],
          holdsForAnother: true,
        }),
      ),
    ).toEqual([
      BreachCondition.NoContractWithOwner,
      BreachCondition.NoMaterialRiskOfIdentityTheft,
    ]);
  });

  test("the deadlines as the statutes word them: immediately, as soon as practicable, or a number of hours or days", () => {
    const unitOf: (id: BreachLawId) => BreachDeadlineUnit = (
      id: BreachLawId,
    ): BreachDeadlineUnit => {
      return getBreachLawRule(id).deadline.unit;
    };

    expect(unitOf(BreachLawId.CaliforniaDataOwner)).toBe(
      BreachDeadlineUnit.Immediately,
    );
    expect(unitOf(BreachLawId.MassachusettsDataOwner)).toBe(
      BreachDeadlineUnit.AsSoonAsPracticable,
    );
    expect(getBreachLawRule(BreachLawId.GeorgiaDataOwner).deadline).toEqual({
      unit: BreachDeadlineUnit.Hours,
      amount: 24,
      start: BreachDeadlineStart.Found,
    });

    const georgia: BreachObligation = applied(BreachLawId.GeorgiaDataOwner, {
      dataTypeIds: ["us-ssn"],
      places: [BreachPlace.Georgia],
      holdsForAnother: true,
    });

    expect(georgia.dueAt).toBe("2026-11-24T09:00:00.000Z");

    const immediately: BreachObligation = applied(
      BreachLawId.CaliforniaDataOwner,
      {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [BreachPlace.California],
        holdsForAnother: true,
      },
    );

    // Immediately sets no due moment: it is never put after one that has a length.
    expect(immediately.dueAt).toBeUndefined();
    expect(isDeadlineWithoutLength(BreachDeadlineUnit.Immediately)).toBe(true);
    expect(
      isDeadlineWithoutLength(BreachDeadlineUnit.AsSoonAsPracticable),
    ).toBe(true);
  });
});

describe.each(
  ALL_STATUTES.map((statute: StatuteSays): [string, StatuteSays] => {
    return [`${statute.id}: ${statute.law} ${statute.provision}`, statute];
  }),
)("%s", (_title: string, statute: StatuteSays) => {
  const rule: BreachLawRule = getBreachLawRule(statute.id);
  // When its example exposure is found and assessed, and whether the data is held for another.
  const example: ReturnType<typeof exampleOf> = exampleOf(statute);
  const foundAt: Date = example.foundAt;

  test("says what the statute says", () => {
    expect({
      family: rule.family,
      places: rule.places,
      law: rule.law,
      provision: rule.provision,
      elements: [...rule.dataElements].sort(),
      needsName: rule.needsName,
      nameFree: [...rule.nameFreeElements].sort(),
      minimumPeople: rule.minimumPeople,
      fewerPeopleThan: rule.fewerPeopleThan,
      conditions: rule.conditions,
      deadline: rule.deadline,
      inForceFrom: rule.inForceFrom,
      inForceUntil: rule.inForceUntil,
      forDataHolders: rule.forDataHolders === true,
    }).toEqual({
      family: statute.family,
      places: [statute.place],
      law: statute.law,
      provision: statute.provision,
      elements: [...statute.elements].sort(),
      needsName: statute.needsName,
      nameFree: [...statute.nameFree].sort(),
      minimumPeople: statute.minimumPeople,
      fewerPeopleThan: undefined,
      conditions: statute.conditions,
      deadline: {
        unit: statute.unit,
        ...(statute.amount === undefined ? {} : { amount: statute.amount }),
        start: statute.start,
        ...(statute.afterRule ? { afterRule: statute.afterRule } : {}),
      },
      inForceFrom: statute.inForceFrom,
      inForceUntil: statute.inForceUntil,
      forDataHolders: statute.forDataHolders === true,
    });
  });

  test("links to its text on the state's own site, and says the day it was read", () => {
    const url: URL = new URL(rule.sourceUrl);

    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(statute.host);
    expect(rule.checkedOn).toBe(statute.checkedOn || US_STATE_LAWS_CHECKED_ON);
    expect(rule.sourceTitle).toContain(
      statute.provision
        .split("(")[0]!
        .trim()
        .replace(/^Section /, ""),
    );
  });

  test(statute.forDataHolders
    ? "is left out of the assessment until a person says the organization holds the data for another"
    : "does not wait on whose data it is", () => {
    const data: Parameters<typeof factsOf>[0] = {
      dataTypeIds: ["us-ssn", "person-name"],
      places: [statute.place],
      foundAt,
      now: example.now,
    };

    expect(holds(statute.id, data)).toBe(!statute.forDataHolders);
    expect(holds(statute.id, { ...data, holdsForAnother: false })).toBe(
      !statute.forDataHolders,
    );
    expect(holds(statute.id, { ...data, holdsForAnother: true })).toBe(true);
  });

  test("may apply to the state's people's Social Security numbers held with names, with its deadline and what a person checks", () => {
    const obligation: BreachObligation = applied(statute.id, {
      dataTypeIds: ["us-ssn", "person-name"],
      places: [statute.place],
      ...example,
    });

    expect(obligation.status).toBe(BreachObligationStatus.MayApply);
    expect(obligation.isPlaceKnown).toBe(true);
    expect(obligation.reasons).toContainEqual({
      kind: BreachReasonKind.PeopleIn,
      places: [statute.place],
    });
    expect(conditionsOf(obligation)).toEqual(statute.conditions);
    expect(checkKinds(obligation).includes(BreachCheckKind.PeopleCount)).toBe(
      Boolean(statute.minimumPeople),
    );
    // Names were held: no check that they were.
    expect(checkKinds(obligation)).not.toContain(BreachCheckKind.HeldWithNames);

    if (isDeadlineWithoutLength(statute.unit)) {
      expect(obligation.dueAt).toBeUndefined();
    } else if (statute.start === BreachDeadlineStart.PeopleNotified) {
      // Due with the residents' notice, at the latest: when theirs has no length, neither has it.
      const residents: BreachObligation = applied(statute.afterRule!, {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [statute.place],
        ...example,
      });

      const after: string | undefined = residents.dueAt
        ? (statute.unit === BreachDeadlineUnit.BusinessDays
            ? addBusinessDays(new Date(residents.dueAt), statute.amount!)
            : new Date(
                new Date(residents.dueAt).getTime() + statute.amount! * DAY,
              )
          ).toISOString()
        : undefined;

      expect(obligation.dueAt).toBe(after);
      expect(obligation.isDueAtTheLatest).toBe(
        residents.dueAt ? true : undefined,
      );
    } else {
      expect(obligation.dueAt).toBe(
        (statute.unit === BreachDeadlineUnit.BusinessDays
          ? addBusinessDays(foundAt, statute.amount!)
          : new Date(
              foundAt.getTime() +
                statute.amount! *
                  (statute.unit === BreachDeadlineUnit.Hours ? HOUR : DAY),
            )
        ).toISOString(),
      );
    }
  });

  test("is ruled out where a person says the people live elsewhere, and waits on where they live while nobody says which state", () => {
    const elsewhere: BreachObligation = applied(statute.id, {
      dataTypeIds: ["us-ssn", "person-name"],
      places: [BreachPlace.UnitedKingdom],
      ...example,
    });

    expect(elsewhere.status).toBe(BreachObligationStatus.NotTriggered);
    expect(
      elsewhere.reasons.map((reason: BreachReason): BreachReasonKind => {
        return reason.kind;
      }),
    ).toEqual([BreachReasonKind.PeopleNamedElsewhere]);

    for (const places of [undefined, [BreachPlace.UnitedStates]]) {
      const unknown: BreachObligation = applied(statute.id, {
        dataTypeIds: ["us-ssn", "person-name"],
        ...(places ? { places } : {}),
        ...example,
      });

      expect(unknown.status).toBe(BreachObligationStatus.MayApply);
      expect(unknown.isPlaceKnown).toBe(false);
      expect(unknown.checks).toContainEqual({
        kind: BreachCheckKind.PeopleLiveIn,
        places: [statute.place],
      });
    }
  });

  test("covers no store that holds none of its data, and asks for names only where the statute does", () => {
    const emails: BreachObligation = applied(statute.id, {
      dataTypeIds: ["email-address"],
      places: [statute.place],
      ...example,
    });

    expect(emails.status).toBe(BreachObligationStatus.NotTriggered);

    // A Social Security number with no name found: checked where the statute needs a name for it.
    const nameless: BreachObligation = applied(statute.id, {
      dataTypeIds: ["us-ssn"],
      places: [statute.place],
      ...example,
    });

    expect(checkKinds(nameless).includes(BreachCheckKind.HeldWithNames)).toBe(
      statute.needsName && !statute.nameFree.includes(SSN),
    );
  });

  test(statute.inForceUntil || statute.inForceFrom
    ? "applies only to an exposure found while its text is in force"
    : "is in force whenever the exposure was found, so long ago as the table goes", () => {
    const day: (iso: string) => Parameters<typeof factsOf>[0] = (
      iso: string,
    ): Parameters<typeof factsOf>[0] => {
      return {
        dataTypeIds: ["us-ssn", "person-name"],
        places: [statute.place],
        foundAt: new Date(iso),
        now: new Date(iso),
        holdsForAnother: true,
      };
    };

    if (statute.inForceUntil) {
      const until: number = new Date(
        `${statute.inForceUntil}T00:00:00.000Z`,
      ).getTime();

      expect(holds(statute.id, day(new Date(until - 1).toISOString()))).toBe(
        true,
      );
      expect(holds(statute.id, day(new Date(until).toISOString()))).toBe(
        false,
      );
    }

    if (statute.inForceFrom) {
      const from: number = new Date(
        `${statute.inForceFrom}T00:00:00.000Z`,
      ).getTime();

      expect(
        applied(statute.id, day(new Date(from - 1).toISOString())).status,
      ).toBe(BreachObligationStatus.NotYetInForce);
      expect(applied(statute.id, day(new Date(from).toISOString())).status).toBe(
        BreachObligationStatus.MayApply,
      );
    }

    if (!statute.inForceUntil && !statute.inForceFrom) {
      expect(applied(statute.id, day("2020-01-06T09:00:00.000Z")).status).toBe(
        BreachObligationStatus.MayApply,
      );
    }
  });
});
