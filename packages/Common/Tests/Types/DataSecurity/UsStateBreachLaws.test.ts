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
  getBreachLawRule,
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, BIOMETRIC],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, BIOMETRIC],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, BIOMETRIC],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, BIOMETRIC],
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
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, LOGIN],
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
    elements: [SSN, DL, PASSPORT, TAX_ID, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, LOGIN],
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
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, GENETIC, LOGIN],
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
    elements: [SSN, DL, PASSPORT, TAX_ID, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, GENETIC, LOGIN],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT],
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
    elements: [SSN, DL, OTHER_ID, ACCOUNT, BIOMETRIC],
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
    elements: [SSN, DL, PASSPORT, OTHER_ID, ACCOUNT, MEDICAL, INSURANCE, BIOMETRIC, GEOLOCATION, LOGIN],
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

// A store's facts: what it holds (catalog data type ids) and where a person said the people live.
function factsOf(data: {
  dataTypeIds: Array<string>;
  places?: Array<BreachPlace>;
  records?: number;
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
      subjectCountries: [],
      placesNamed: data.places,
    }),
    reads: {
      logged: ExposureReadsLogged.NotLogged,
      isPublic: true,
      outsideAccounts: 0,
      outsideAccountsUsedInWindow: 0,
      isTreatedAsRead: true,
    },
    foundAt: FOUND_AT,
    now: NOW,
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

describe("every US state, the District of Columbia and Puerto Rico is a place", () => {
  test("52 places, each by its ISO 3166-2:US code, in alphabetical order", () => {
    expect(US_JURISDICTION_PLACES).toHaveLength(52);
    expect(new Set(US_JURISDICTION_PLACES).size).toBe(52);

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
      STATUTES.map((statute: StatuteSays): BreachPlace => {
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
      STATUTES.map((statute: StatuteSays): BreachLawId => {
        return statute.id;
      }).sort(),
    );
  });

  test("each was read on 27 November 2026, and applies in its own state alone", () => {
    expect(US_STATE_LAWS_CHECKED_ON).toBe("2026-11-27");

    for (const rule of STATE_ROWS) {
      expect({ id: rule.id, checkedOn: rule.checkedOn }).toEqual({
        id: rule.id,
        checkedOn: US_STATE_LAWS_CHECKED_ON,
      });
      expect(rule.places).toHaveLength(1);
      expect(US_JURISDICTION_PLACES).toContain(rule.places![0]);
    }
  });

  test("a state's notices are one family, named as the state is", () => {
    for (const rule of STATE_ROWS) {
      expect(rule.family as string).toBe(
        withMeaningKeyAsItsWord(BREACH_PLACE_CHOICES[rule.places![0]!]),
      );
    }
  });

  test("a notice to the consumer reporting agencies is owed only past a number of people, as each statute counts them", () => {
    const agencies: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return (
          isUsStateRule(rule) && rule.id.endsWith("-consumer-reporting-agencies")
        );
      },
    );

    expect(agencies.length).toBeGreaterThan(0);

    for (const rule of agencies) {
      expect({ id: rule.id, threshold: Boolean(rule.minimumPeople) }).toEqual({
        id: rule.id,
        threshold: true,
      });
      // Each of the state's: the same data and the same test as the people's own notice.
      const residents: BreachLawRule = BREACH_LAW_RULES.find(
        (candidate: BreachLawRule): boolean => {
          return (
            candidate.family === rule.family &&
            candidate.action === BREACH_LAW_RULES.find(
              (first: BreachLawRule): boolean => {
                return first.id === BreachLawId.AlabamaResidents;
              },
            )!.action
          );
        },
      )!;

      expect({ id: rule.id, elements: rule.dataElements }).toEqual({
        id: rule.id,
        elements: residents.dataElements,
      });
      expect({ id: rule.id, conditions: rule.conditions }).toEqual({
        id: rule.id,
        conditions: residents.conditions,
      });
    }
  });
});

describe.each(
  STATUTES.map((statute: StatuteSays): [string, StatuteSays] => {
    return [`${statute.id}: ${statute.law} ${statute.provision}`, statute];
  }),
)("%s", (_title: string, statute: StatuteSays) => {
  const rule: BreachLawRule = getBreachLawRule(statute.id);

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
    });
  });

  test("links to its text on the state's own site, and says the day it was read", () => {
    const url: URL = new URL(rule.sourceUrl);

    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(statute.host);
    expect(rule.checkedOn).toBe(US_STATE_LAWS_CHECKED_ON);
    expect(rule.sourceTitle).toContain(
      statute.provision.split("(")[0]!.replace(/^\d+ ILCS /, ""),
    );
  });

  test("may apply to the state's people's Social Security numbers held with names, with its deadline and what a person checks", () => {
    const obligation: BreachObligation = applied(statute.id, {
      dataTypeIds: ["us-ssn", "person-name"],
      places: [statute.place],
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
          ? addBusinessDays(FOUND_AT, statute.amount!)
          : new Date(
              FOUND_AT.getTime() +
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
        places,
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
    });

    expect(emails.status).toBe(BreachObligationStatus.NotTriggered);

    // A Social Security number with no name found: checked where the statute needs a name for it.
    const nameless: BreachObligation = applied(statute.id, {
      dataTypeIds: ["us-ssn"],
      places: [statute.place],
    });

    expect(checkKinds(nameless).includes(BreachCheckKind.HeldWithNames)).toBe(
      statute.needsName && !statute.nameFree.includes(SSN),
    );
  });
});
