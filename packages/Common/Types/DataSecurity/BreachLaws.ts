import { translationKey } from "../Translator";

/*
 * WHAT THE LAW MAY ASK AFTER A DATA EXPOSURE (#10377): THE TABLE.
 *
 * When a store of personal data was open to people who should not have
 * read it, breach laws may ask the organization to tell a regulator, the
 * people the data is about, or both, by a deadline. This is the table plain
 * code applies to an exposure's facts (ExposureAssessment.applyBreachLaws):
 * one row per notice a law asks for, with
 *
 *   - what triggers it: where the people live (places), what data
 *     (dataElements, each a set of the catalog's data types), whether the
 *     data must be held with people's names, and how many people;
 *   - what plain code cannot decide, said as a condition a person checks:
 *     whether the risk to the people is high, whether the organization is
 *     a HIPAA covered entity, whether it handles card data;
 *   - who must be told, and the deadline: its length, its unit (hours,
 *     calendar days, business days) and what it counts from;
 *   - the primary source it was read from - the regulation's or statute's
 *     own text, or the regulator's own guidance where the statute's site
 *     could not be read - and the day it was checked.
 *
 * Every row was read from its source on BREACH_LAWS_CHECKED_ON, and its
 * test (BreachLaws.test.ts) pins what the row says. A row whose source
 * could not be verified is left out, and the assessment says, in plain
 * words, what the table does not cover (getUncoveredLaws), so nobody reads
 * silence as "no obligation". Deadlines count from when Data Security
 * found the exposure: the earliest moment the organization could be said
 * to know, so the dates are never later than the law's.
 *
 * It is not legal advice: it says which rules may apply to the facts, and
 * a person, usually with counsel, decides.
 *
 * Pure data, for the server and the Dashboard alike; every word a person
 * reads is a key (translationKey) the Dashboard words in the reader's
 * language, while a law's own name and provision stay as written.
 */

// The day every row below was read from its source.
export const BREACH_LAWS_CHECKED_ON: string = "2026-11-24";

/*
 * Where the people a store's data is about live, as the table covers
 * places. Stored on an assessment when a person says where the people
 * live: never rename one.
 */
export enum BreachPlace {
  // The 27 EU member states, Iceland, Liechtenstein and Norway.
  Eea = "EEA",
  UnitedKingdom = "GB",
  // The United States, when nobody said which states.
  UnitedStates = "US",
  California = "US-CA",
  Colorado = "US-CO",
  Florida = "US-FL",
  NewYork = "US-NY",
  Texas = "US-TX",
  Washington = "US-WA",
  // A US state the table does not cover.
  OtherUsState = "US-OTHER",
  Brazil = "BR",
  India = "IN",
  // Anywhere the table does not cover.
  Elsewhere = "OTHER",
}

export const BREACH_PLACES: ReadonlyArray<BreachPlace> =
  Object.values(BreachPlace);

export const US_STATE_PLACES: ReadonlyArray<BreachPlace> = [
  BreachPlace.California,
  BreachPlace.Colorado,
  BreachPlace.Florida,
  BreachPlace.NewYork,
  BreachPlace.Texas,
  BreachPlace.Washington,
  BreachPlace.OtherUsState,
];

export function isBreachPlace(value: unknown): value is BreachPlace {
  return (
    typeof value === "string" &&
    (BREACH_PLACES as ReadonlyArray<string>).includes(value)
  );
}

export function isUsStatePlace(place: BreachPlace): boolean {
  return US_STATE_PLACES.includes(place);
}

// A place in words, for a sentence: "people in {{places}}".
export const BREACH_PLACE_WORDS: Readonly<Record<BreachPlace, string>> = {
  [BreachPlace.Eea]: translationKey("the EU or EEA"),
  [BreachPlace.UnitedKingdom]: translationKey("the United Kingdom"),
  [BreachPlace.UnitedStates]: translationKey("the United States"),
  [BreachPlace.California]: translationKey("California"),
  [BreachPlace.Colorado]: translationKey("Colorado"),
  [BreachPlace.Florida]: translationKey("Florida"),
  [BreachPlace.NewYork]: translationKey("New York"),
  [BreachPlace.Texas]: translationKey("Texas"),
  [BreachPlace.Washington]: translationKey("Washington"),
  [BreachPlace.OtherUsState]: translationKey("another US state"),
  [BreachPlace.Brazil]: translationKey("Brazil"),
  [BreachPlace.India]: translationKey("India"),
  [BreachPlace.Elsewhere]: translationKey("somewhere else"),
};

// The same place as a choice a person picks: "Where do the people live?"
export const BREACH_PLACE_CHOICES: Readonly<Record<BreachPlace, string>> = {
  [BreachPlace.Eea]: translationKey("EU or EEA"),
  [BreachPlace.UnitedKingdom]: translationKey("United Kingdom"),
  [BreachPlace.UnitedStates]: translationKey("United States, state not known"),
  [BreachPlace.California]: translationKey("California"),
  [BreachPlace.Colorado]: translationKey("Colorado"),
  [BreachPlace.Florida]: translationKey("Florida"),
  [BreachPlace.NewYork]: translationKey("New York"),
  [BreachPlace.Texas]: translationKey("Texas"),
  [BreachPlace.Washington]: translationKey("Washington"),
  [BreachPlace.OtherUsState]: translationKey("Another US state"),
  [BreachPlace.Brazil]: translationKey("Brazil"),
  [BreachPlace.India]: translationKey("India"),
  [BreachPlace.Elsewhere]: translationKey("Somewhere else"),
};

// The countries the EU's GDPR covers people in: the EU's 27, and Iceland, Liechtenstein and Norway.
export const EEA_COUNTRY_CODES: ReadonlyArray<string> = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
];

/*
 * The place a country is, as the table covers places: an ISO 3166-1
 * alpha-2 code, as a store's subjectCountries hold it. A country the table
 * does not cover is Elsewhere.
 */
export function getBreachPlaceOfCountry(country: string): BreachPlace {
  const code: string = country.trim().toUpperCase();

  if (EEA_COUNTRY_CODES.includes(code)) {
    return BreachPlace.Eea;
  }

  switch (code) {
    case "GB":
    case "UK":
      return BreachPlace.UnitedKingdom;
    case "US":
      return BreachPlace.UnitedStates;
    case "BR":
      return BreachPlace.Brazil;
    case "IN":
      return BreachPlace.India;
    default:
      return BreachPlace.Elsewhere;
  }
}

/*
 * What a breach law is triggered by, in the words of the laws below, each
 * matched to the catalog's data types (BREACH_DATA_ELEMENT_TYPES).
 */
export enum BreachDataElement {
  // Any personal data: what GDPR, UK GDPR, LGPD and DPDP cover.
  PersonalData = "PersonalData",
  SocialSecurityNumber = "SocialSecurityNumber",
  DriversLicense = "DriversLicense",
  PassportNumber = "PassportNumber",
  TaxIdNumber = "TaxIdNumber",
  // Another identification number issued on a government document.
  OtherGovernmentId = "OtherGovernmentId",
  // A bank account or card number, which the laws cover with any code needed to use it.
  FinancialAccount = "FinancialAccount",
  // A payment card's number or its verification code: what PCI DSS covers.
  CardData = "CardData",
  MedicalInformation = "MedicalInformation",
  HealthInsurance = "HealthInsurance",
  Biometric = "Biometric",
  Genetic = "Genetic",
  DateOfBirth = "DateOfBirth",
  Geolocation = "Geolocation",
  // An email address or username together with a password.
  OnlineCredentials = "OnlineCredentials",
}

export const BREACH_DATA_ELEMENTS: ReadonlyArray<BreachDataElement> =
  Object.values(BreachDataElement);

// What each element is, in words: "It holds {{elements}}."
export const BREACH_DATA_ELEMENT_WORDS: Readonly<
  Record<BreachDataElement, string>
> = {
  [BreachDataElement.PersonalData]: translationKey("personal data"),
  [BreachDataElement.SocialSecurityNumber]: translationKey(
    "Social Security numbers",
  ),
  [BreachDataElement.DriversLicense]: translationKey(
    "driver's license numbers",
  ),
  [BreachDataElement.PassportNumber]: translationKey("passport numbers"),
  [BreachDataElement.TaxIdNumber]: translationKey(
    "taxpayer identification numbers",
  ),
  [BreachDataElement.OtherGovernmentId]: translationKey(
    "other government ID numbers",
  ),
  [BreachDataElement.FinancialAccount]: translationKey(
    "bank account or card numbers",
  ),
  [BreachDataElement.CardData]: translationKey("payment card data"),
  [BreachDataElement.MedicalInformation]: translationKey(
    "medical information",
  ),
  [BreachDataElement.HealthInsurance]: translationKey(
    "health insurance numbers",
  ),
  [BreachDataElement.Biometric]: translationKey("biometric data"),
  [BreachDataElement.Genetic]: translationKey("genetic data"),
  [BreachDataElement.DateOfBirth]: translationKey("dates of birth"),
  [BreachDataElement.Geolocation]: translationKey("geolocation"),
  [BreachDataElement.OnlineCredentials]: translationKey(
    "email addresses or usernames with passwords",
  ),
};

/*
 * The catalog's data types each element is found by (DataTypeCatalog). An
 * element with no types here is found another way: PersonalData by a data
 * type's category, OnlineCredentials by an email address or username held
 * with a password (getBreachDataElements).
 */
export const BREACH_DATA_ELEMENT_TYPES: Readonly<
  Record<BreachDataElement, ReadonlyArray<string>>
> = {
  [BreachDataElement.PersonalData]: [],
  [BreachDataElement.SocialSecurityNumber]: ["us-ssn"],
  [BreachDataElement.DriversLicense]: [
    "us-drivers-license",
    "uk-driving-licence",
  ],
  [BreachDataElement.PassportNumber]: [
    "us-passport",
    "uk-passport",
    "passport-number",
  ],
  [BreachDataElement.TaxIdNumber]: ["us-itin"],
  // Every other government ID: a country's national, tax or social number.
  [BreachDataElement.OtherGovernmentId]: [],
  [BreachDataElement.FinancialAccount]: [
    "credit-card-number",
    "bank-account-number",
    "iban",
  ],
  [BreachDataElement.CardData]: [
    "credit-card-number",
    "card-verification-code",
  ],
  [BreachDataElement.MedicalInformation]: [
    "medical-record-number",
    "diagnosis-code",
    "drug-code",
    "health-information",
    "uk-nhs-number",
  ],
  [BreachDataElement.HealthInsurance]: [
    "health-plan-id",
    "us-medicare-mbi",
    "au-medicare-number",
    "de-health-insurance-number",
  ],
  [BreachDataElement.Biometric]: ["biometric-data"],
  [BreachDataElement.Genetic]: ["genetic-data"],
  [BreachDataElement.DateOfBirth]: ["date-of-birth"],
  [BreachDataElement.Geolocation]: ["geolocation"],
  [BreachDataElement.OnlineCredentials]: [],
};

// The data types that make an email address or username a login, held with a password.
export const ONLINE_ACCOUNT_TYPES: ReadonlyArray<string> = [
  "email-address",
  "username",
];
export const PASSWORD_TYPES: ReadonlyArray<string> = ["generic-secret"];
// A person's name: what most US state laws need held with a number.
export const PERSON_NAME_TYPE: string = "person-name";

/*
 * What a law asks that plain code cannot decide from the facts: each a
 * condition a person, usually with counsel, checks.
 */
export enum BreachCondition {
  // GDPR Art. 33(1): unless the breach is unlikely to result in a risk.
  RiskToPeople = "RiskToPeople",
  // GDPR Art. 34(1): when it is likely to result in a high risk.
  HighRiskToPeople = "HighRiskToPeople",
  // LGPD Art. 48 and ANPD Resolution 15 Art. 5: relevant risk or damage.
  RelevantRiskToPeople = "RelevantRiskToPeople",
  // Washington: unless not reasonably likely to subject consumers to a risk of harm.
  RiskOfHarm = "RiskOfHarm",
  // Colorado: unless an investigation finds it was not and is not likely to be misused.
  LikelyMisuse = "LikelyMisuse",
  // Florida: unless it has not and will not likely result in identity theft or financial harm.
  IdentityTheftOrFinancialHarm = "IdentityTheftOrFinancialHarm",
  // HIPAA: the organization is a covered entity, and the data is protected health information.
  HipaaCoveredEntity = "HipaaCoveredEntity",
  // HIPAA 164.410: the organization is a business associate of a covered entity.
  HipaaBusinessAssociate = "HipaaBusinessAssociate",
  // PCI DSS: the organization stores, processes or transmits payment card data.
  HandlesCardData = "HandlesCardData",
  // CERT-In: the organization is one its directions cover.
  CertInEntity = "CertInEntity",
}

export const BREACH_CONDITION_WORDS: Readonly<
  Record<BreachCondition, string>
> = {
  [BreachCondition.RiskToPeople]: translationKey(
    "Unless the breach is unlikely to result in a risk to the people's rights and freedoms.",
  ),
  [BreachCondition.HighRiskToPeople]: translationKey(
    "If the breach is likely to result in a high risk to the people's rights and freedoms.",
  ),
  [BreachCondition.RelevantRiskToPeople]: translationKey(
    "If the incident may cause relevant risk or damage to the people, as ANPD Resolution 15 Article 5 sets out.",
  ),
  [BreachCondition.RiskOfHarm]: translationKey(
    "Unless the breach is not reasonably likely to subject the people to a risk of harm.",
  ),
  [BreachCondition.LikelyMisuse]: translationKey(
    "Unless an investigation finds the data was not misused and is not reasonably likely to be.",
  ),
  [BreachCondition.IdentityTheftOrFinancialHarm]: translationKey(
    "Unless you determine, in writing, that it will not likely result in identity theft or financial harm.",
  ),
  [BreachCondition.HipaaCoveredEntity]: translationKey(
    "If your organization is a HIPAA covered entity and the data is protected health information.",
  ),
  [BreachCondition.HipaaBusinessAssociate]: translationKey(
    "If your organization is a business associate of a HIPAA covered entity.",
  ),
  [BreachCondition.HandlesCardData]: translationKey(
    "If your organization stores, processes or transmits payment card data.",
  ),
  [BreachCondition.CertInEntity]: translationKey(
    "If your organization is a service provider, intermediary, data centre, body corporate or government organisation CERT-In's directions cover.",
  ),
};

export enum BreachDeadlineUnit {
  Hours = "Hours",
  CalendarDays = "CalendarDays",
  BusinessDays = "BusinessDays",
  // No length of time: "without undue delay".
  WithoutUndueDelay = "WithoutUndueDelay",
  // The law sets none: another agreement or rule does.
  NoFixedTime = "NoFixedTime",
}

// What a deadline counts from.
export enum BreachDeadlineStart {
  // When the exposure was found.
  Found = "Found",
  // When the people were told (another row's notice).
  PeopleNotified = "PeopleNotified",
  // The end of the calendar year the exposure was found in.
  EndOfCalendarYear = "EndOfCalendarYear",
}

export interface BreachDeadline {
  unit: BreachDeadlineUnit;
  // Hours or days; absent for no length of time.
  amount?: number | undefined;
  start: BreachDeadlineStart;
  // The notice to the people a PeopleNotified deadline follows.
  afterRule?: BreachLawId | undefined;
}

// A threshold of people: "500 or more", or "more than 500".
export interface BreachPeopleThreshold {
  count: number;
  isMoreThan: boolean;
}

/*
 * Each row's id. Stored with an assessment's facts and drafts: never
 * rename one.
 */
export enum BreachLawId {
  GdprAuthority = "gdpr-art-33",
  GdprPeople = "gdpr-art-34",
  UkGdprAuthority = "uk-gdpr-art-33",
  UkGdprPeople = "uk-gdpr-art-34",
  HipaaPeople = "hipaa-164-404",
  HipaaMedia = "hipaa-164-406",
  HipaaSecretaryLarge = "hipaa-164-408-b",
  HipaaSecretarySmall = "hipaa-164-408-c",
  HipaaBusinessAssociate = "hipaa-164-410",
  CaliforniaResidents = "ca-civ-1798-82-residents",
  CaliforniaAttorneyGeneral = "ca-civ-1798-82-attorney-general",
  ColoradoResidents = "co-6-1-716-residents",
  ColoradoAttorneyGeneral = "co-6-1-716-attorney-general",
  FloridaIndividuals = "fl-501-171-individuals",
  FloridaDepartment = "fl-501-171-department",
  NewYorkResidents = "ny-gbl-899-aa-residents",
  NewYorkAgencies = "ny-gbl-899-aa-agencies",
  TexasIndividuals = "tx-521-053-individuals",
  TexasAttorneyGeneral = "tx-521-053-attorney-general",
  WashingtonConsumers = "wa-19-255-010-consumers",
  WashingtonAttorneyGeneral = "wa-19-255-010-attorney-general",
  LgpdAuthority = "lgpd-anpd",
  LgpdPeople = "lgpd-people",
  DpdpPeople = "dpdp-rule-7-people",
  DpdpBoard = "dpdp-rule-7-board",
  CertIn = "cert-in-6-hours",
  PciDss = "pci-dss-12-10-1",
}

/*
 * Which law a row is of, as a draft may name it: a draft that names a law
 * none of its facts names is dropped (ExposureAssessment.getUnfoundedLaws).
 */
export enum BreachLawFamily {
  Gdpr = "GDPR",
  UkGdpr = "UK GDPR",
  Hipaa = "HIPAA",
  California = "California",
  Colorado = "Colorado",
  Florida = "Florida",
  NewYork = "New York",
  Texas = "Texas",
  Washington = "Washington",
  Lgpd = "LGPD",
  Dpdp = "DPDP",
  CertIn = "CERT-In",
  PciDss = "PCI DSS",
}

export interface BreachLawRule {
  id: BreachLawId;
  family: BreachLawFamily;
  // The law's name and provision, as written, in every language.
  law: string;
  provision: string;
  /*
   * Where the people must live for it to apply; null when it applies
   * wherever they live (HIPAA, PCI DSS: who the organization is decides).
   */
  places: ReadonlyArray<BreachPlace> | null;
  // Any one of these triggers it.
  dataElements: ReadonlyArray<BreachDataElement>;
  /*
   * Whether the law covers its numbers only when held with a person's
   * name, and the elements it covers without one (a login).
   */
  needsName: boolean;
  nameFreeElements: ReadonlyArray<BreachDataElement>;
  // How many people it takes, and fewer than how many (HIPAA's two notices to the Secretary).
  minimumPeople?: BreachPeopleThreshold | undefined;
  fewerPeopleThan?: number | undefined;
  conditions: ReadonlyArray<BreachCondition>;
  // What to do, and who must be told: keys, in the reader's language.
  action: string;
  recipient: string;
  deadline: BreachDeadline;
  // How the law words its deadline beyond its length, when it says more.
  deadlineNote?: string | undefined;
  // A line about the rule a person should read, when it has one.
  note?: string | undefined;
  sourceUrl: string;
  // The source, as written: the instrument and where in it.
  sourceTitle: string;
  checkedOn: string;
  // The day it takes effect, YYYY-MM-DD, when that is still to come or recent.
  inForceFrom?: string | undefined;
}

const GDPR_SOURCE: string = "https://eur-lex.europa.eu/eli/reg/2016/679/oj";
const HIPAA_SOURCE: string =
  "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D";
const CALIFORNIA_SOURCE: string =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82";
const COLORADO_SOURCE: string = "https://coag.gov/resources/data-protection-laws/";
const FLORIDA_SOURCE: string =
  "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html";
const NEW_YORK_SOURCE: string =
  "https://www.nysenate.gov/legislation/laws/GBS/899-AA";
const TEXAS_SOURCE: string =
  "https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/identity-theft-enforcement-and-protection-act";
const WASHINGTON_SOURCE: string =
  "https://app.leg.wa.gov/RCW/default.aspx?cite=19.255.010";
const ANPD_SOURCE: string =
  "https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024";
const DPDP_SOURCE: string =
  "https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf";
const CERT_IN_SOURCE: string =
  "https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf";
const PCI_DSS_SOURCE: string =
  "https://www.pcisecuritystandards.org/document_library/";

// The data elements most US state laws name, held with a person's name.
const US_STATE_IDS: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.SocialSecurityNumber,
  BreachDataElement.DriversLicense,
  BreachDataElement.PassportNumber,
];

const HEALTH_DATA: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.MedicalInformation,
  BreachDataElement.HealthInsurance,
];

const CALIFORNIA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.Genetic,
  BreachDataElement.OnlineCredentials,
];

const COLORADO_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

const FLORIDA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.Geolocation,
  BreachDataElement.OnlineCredentials,
];

const NEW_YORK_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.SocialSecurityNumber,
  BreachDataElement.DriversLicense,
  BreachDataElement.FinancialAccount,
  BreachDataElement.Biometric,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

const TEXAS_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
];

const WASHINGTON_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.FinancialAccount,
  BreachDataElement.DateOfBirth,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

// Shared words of the rows.
const TELL_THE_PEOPLE: string = translationKey("Tell the people affected");
const THE_PEOPLE: string = translationKey("The people the data is about");
const TELL_THE_ATTORNEY_GENERAL: string = translationKey(
  "Tell the state's attorney general",
);
const HIPAA_DISCOVERY_NOTE: string = translationKey(
  "A breach counts as discovered on the first day anyone in the organization knew of it, or would have with reasonable diligence.",
);
const HIPAA_PRESUMED_NOTE: string = translationKey(
  "It is presumed a breach unless a risk assessment shows a low probability that the information was compromised (45 CFR 164.402).",
);
const US_STATE_DETERMINATION_NOTE: string = translationKey(
  "The law counts from when you determine a breach occurred; this counts from when it was found, the earlier of the two.",
);

export const BREACH_LAW_RULES: ReadonlyArray<BreachLawRule> = [
  // ---- EU GDPR ----
  {
    id: BreachLawId.GdprAuthority,
    family: BreachLawFamily.Gdpr,
    law: "GDPR",
    provision: "Article 33",
    places: [BreachPlace.Eea],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.RiskToPeople],
    action: translationKey("Notify the supervisory authority"),
    recipient: translationKey(
      "The competent supervisory authority: the lead authority, when the processing crosses borders",
    ),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Without undue delay, and where feasible within that time, weekends and holidays included. A later notice must give the reasons for the delay.",
    ),
    sourceUrl: GDPR_SOURCE,
    sourceTitle: "Regulation (EU) 2016/679, Article 33(1)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.GdprPeople,
    family: BreachLawFamily.Gdpr,
    law: "GDPR",
    provision: "Article 34",
    places: [BreachPlace.Eea],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HighRiskToPeople],
    action: TELL_THE_PEOPLE,
    recipient: THE_PEOPLE,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUndueDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Not needed if the data was unintelligible to anyone not allowed to read it, such as encrypted with a key that was not exposed (Article 34(3)).",
    ),
    sourceUrl: GDPR_SOURCE,
    sourceTitle: "Regulation (EU) 2016/679, Article 34(1)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- UK GDPR ----
  {
    id: BreachLawId.UkGdprAuthority,
    family: BreachLawFamily.UkGdpr,
    law: "UK GDPR",
    provision: "Article 33",
    places: [BreachPlace.UnitedKingdom],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.RiskToPeople],
    action: translationKey("Notify the Information Commission"),
    recipient: translationKey(
      "The Information Commission, which took over from the Information Commissioner's Office on 30 September 2026",
    ),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Without undue delay, and where feasible within that time, counted from when you discovered it. A later notice must give the reasons for the delay.",
    ),
    sourceUrl: "https://www.legislation.gov.uk/eur/2016/679/article/33",
    sourceTitle: "UK GDPR, Article 33(1)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.UkGdprPeople,
    family: BreachLawFamily.UkGdpr,
    law: "UK GDPR",
    provision: "Article 34",
    places: [BreachPlace.UnitedKingdom],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HighRiskToPeople],
    action: TELL_THE_PEOPLE,
    recipient: THE_PEOPLE,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUndueDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Not needed if the data was unintelligible to anyone not allowed to read it, such as encrypted with a key that was not exposed (Article 34(3)).",
    ),
    sourceUrl: "https://www.legislation.gov.uk/eur/2016/679/article/34",
    sourceTitle: "UK GDPR, Article 34(1)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- HIPAA (45 CFR 164.400-414) ----
  {
    id: BreachLawId.HipaaPeople,
    family: BreachLawFamily.Hipaa,
    law: "HIPAA",
    provision: "45 CFR 164.404",
    places: null,
    dataElements: HEALTH_DATA,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HipaaCoveredEntity],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each person whose health information was exposed"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: HIPAA_DISCOVERY_NOTE,
    note: HIPAA_PRESUMED_NOTE,
    sourceUrl: HIPAA_SOURCE,
    sourceTitle: "45 CFR 164.404(b)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HipaaMedia,
    family: BreachLawFamily.Hipaa,
    law: "HIPAA",
    provision: "45 CFR 164.406",
    places: null,
    dataElements: HEALTH_DATA,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.HipaaCoveredEntity],
    action: translationKey("Tell the media"),
    recipient: translationKey(
      "Prominent media outlets in each state or jurisdiction with more than 500 affected residents",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: HIPAA_DISCOVERY_NOTE,
    sourceUrl: HIPAA_SOURCE,
    sourceTitle: "45 CFR 164.406",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HipaaSecretaryLarge,
    family: BreachLawFamily.Hipaa,
    law: "HIPAA",
    provision: "45 CFR 164.408(b)",
    places: null,
    dataElements: HEALTH_DATA,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.HipaaCoveredEntity],
    action: translationKey("Notify the Secretary of Health and Human Services"),
    recipient: translationKey(
      "The Secretary of Health and Human Services, through the HHS breach portal",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "At the same time as the notice to the people, which is due no later than 60 calendar days after discovery.",
    ),
    sourceUrl: HIPAA_SOURCE,
    sourceTitle: "45 CFR 164.408(b)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HipaaSecretarySmall,
    family: BreachLawFamily.Hipaa,
    law: "HIPAA",
    provision: "45 CFR 164.408(c)",
    places: null,
    dataElements: HEALTH_DATA,
    needsName: false,
    nameFreeElements: [],
    fewerPeopleThan: 500,
    conditions: [BreachCondition.HipaaCoveredEntity],
    action: translationKey(
      "Log it, and notify the Secretary of Health and Human Services",
    ),
    recipient: translationKey(
      "The Secretary of Health and Human Services, through the HHS breach portal",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.EndOfCalendarYear,
    },
    sourceUrl: HIPAA_SOURCE,
    sourceTitle: "45 CFR 164.408(c)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HipaaBusinessAssociate,
    family: BreachLawFamily.Hipaa,
    law: "HIPAA",
    provision: "45 CFR 164.410",
    places: null,
    dataElements: HEALTH_DATA,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HipaaBusinessAssociate],
    action: translationKey("Tell the covered entity"),
    recipient: translationKey(
      "The covered entity whose health information it is",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: HIPAA_DISCOVERY_NOTE,
    sourceUrl: HIPAA_SOURCE,
    sourceTitle: "45 CFR 164.410(b)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- California (Civil Code 1798.82, as SB 446 amended it) ----
  {
    id: BreachLawId.CaliforniaResidents,
    family: BreachLawFamily.California,
    law: "California Civil Code",
    provision: "1798.82(a)",
    places: [BreachPlace.California],
    dataElements: CALIFORNIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey(
      "Each California resident whose personal information was, or is reasonably believed to have been, acquired",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from discovery or notification of the breach. A delay is allowed for law enforcement, or to find the breach's scope.",
    ),
    note: translationKey(
      "The 30-day limit came with SB 446 (Chapter 319, Statutes of 2025), in force since 1 January 2026.",
    ),
    sourceUrl: CALIFORNIA_SOURCE,
    sourceTitle:
      "California Civil Code 1798.82(a), as amended by SB 446 (Ch. 319, Stats. 2025)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
    inForceFrom: "2026-01-01",
  },
  {
    id: BreachLawId.CaliforniaAttorneyGeneral,
    family: BreachLawFamily.California,
    law: "California Civil Code",
    provision: "1798.82(f)",
    places: [BreachPlace.California],
    dataElements: CALIFORNIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [],
    action: translationKey("Send the attorney general a sample of the notice"),
    recipient: translationKey(
      "The California Attorney General, with a sample copy of the notice and no personal information",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 15,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.CaliforniaResidents,
    },
    sourceUrl: CALIFORNIA_SOURCE,
    sourceTitle:
      "California Civil Code 1798.82(f), as amended by SB 446 (Ch. 319, Stats. 2025)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
    inForceFrom: "2026-01-01",
  },
  // ---- Colorado (C.R.S. 6-1-716) ----
  {
    id: BreachLawId.ColoradoResidents,
    family: BreachLawFamily.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716",
    places: [BreachPlace.Colorado],
    dataElements: COLORADO_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.OnlineCredentials,
      BreachDataElement.FinancialAccount,
    ],
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected Colorado resident"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: COLORADO_SOURCE,
    sourceTitle:
      "C.R.S. 6-1-716, as the Colorado Attorney General's guidance states it",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.ColoradoAttorneyGeneral,
    family: BreachLawFamily.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716",
    places: [BreachPlace.Colorado],
    dataElements: COLORADO_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.OnlineCredentials,
      BreachDataElement.FinancialAccount,
    ],
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey("The Colorado Attorney General"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: COLORADO_SOURCE,
    sourceTitle:
      "C.R.S. 6-1-716, as the Colorado Attorney General's guidance states it",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- Florida (Fla. Stat. 501.171) ----
  {
    id: BreachLawId.FloridaIndividuals,
    family: BreachLawFamily.Florida,
    law: "Florida Statutes",
    provision: "501.171(4)",
    places: [BreachPlace.Florida],
    dataElements: FLORIDA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.IdentityTheftOrFinancialHarm],
    action: TELL_THE_PEOPLE,
    recipient: translationKey(
      "Each individual in Florida whose personal information was, or is reasonably believed to have been, accessed",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: FLORIDA_SOURCE,
    sourceTitle: "Florida Statutes 501.171(4)(a)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.FloridaDepartment,
    family: BreachLawFamily.Florida,
    law: "Florida Statutes",
    provision: "501.171(3)",
    places: [BreachPlace.Florida],
    dataElements: FLORIDA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [],
    action: translationKey("Notify the Department of Legal Affairs"),
    recipient: translationKey(
      "The Florida Department of Legal Affairs (the Attorney General)",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Fifteen more days are allowed if good cause for the delay is given to the department in writing within the 30 days.",
    ),
    sourceUrl: FLORIDA_SOURCE,
    sourceTitle: "Florida Statutes 501.171(3)(a)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- New York (General Business Law 899-aa) ----
  {
    id: BreachLawId.NewYorkResidents,
    family: BreachLawFamily.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(2)",
    places: [BreachPlace.NewYork],
    dataElements: NEW_YORK_ELEMENTS,
    // Its "personal information" is any identifier, not only a name.
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected New York resident"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "In the most expedient time possible, and within that time after the breach was discovered.",
    ),
    sourceUrl: NEW_YORK_SOURCE,
    sourceTitle: "New York General Business Law 899-aa(2)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewYorkAgencies,
    family: BreachLawFamily.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(8)(a)",
    places: [BreachPlace.NewYork],
    dataElements: NEW_YORK_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: translationKey("Notify the New York state agencies"),
    recipient: translationKey(
      "The New York Attorney General, Department of State, Division of State Police and Department of Financial Services",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.NewYorkResidents,
    },
    deadlineNote: translationKey(
      "Without delaying the notice to the people, with its timing, content and distribution.",
    ),
    sourceUrl: NEW_YORK_SOURCE,
    sourceTitle: "New York General Business Law 899-aa(8)(a)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- Texas (Business and Commerce Code 521.053) ----
  {
    id: BreachLawId.TexasIndividuals,
    family: BreachLawFamily.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053",
    places: [BreachPlace.Texas],
    dataElements: TEXAS_ELEMENTS,
    needsName: true,
    // Health information that identifies a person counts without a name.
    nameFreeElements: HEALTH_DATA,
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey(
      "Each person whose sensitive personal information was, or is reasonably believed to have been, acquired",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: TEXAS_SOURCE,
    sourceTitle:
      "Texas Business and Commerce Code 521.053, as the Texas Attorney General's guidance states it",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.TexasAttorneyGeneral,
    family: BreachLawFamily.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053",
    places: [BreachPlace.Texas],
    dataElements: TEXAS_ELEMENTS,
    needsName: true,
    nameFreeElements: HEALTH_DATA,
    minimumPeople: { count: 250, isMoreThan: false },
    conditions: [],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Texas Attorney General, through its data breach reporting form",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: TEXAS_SOURCE,
    sourceTitle:
      "Texas Business and Commerce Code 521.053, as the Texas Attorney General's guidance states it",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- Washington (RCW 19.255.010) ----
  {
    id: BreachLawId.WashingtonConsumers,
    family: BreachLawFamily.Washington,
    law: "Revised Code of Washington",
    provision: "19.255.010",
    places: [BreachPlace.Washington],
    dataElements: WASHINGTON_ELEMENTS,
    // Its elements count without a name too, where they would enable identity theft.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.RiskOfHarm],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected Washington resident"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "In the most expedient time possible, and no more than that after the breach was discovered.",
    ),
    sourceUrl: WASHINGTON_SOURCE,
    sourceTitle: "RCW 19.255.010(8)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.WashingtonAttorneyGeneral,
    family: BreachLawFamily.Washington,
    law: "Revised Code of Washington",
    provision: "19.255.010",
    places: [BreachPlace.Washington],
    dataElements: WASHINGTON_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.RiskOfHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey("The Washington Attorney General"),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: WASHINGTON_SOURCE,
    sourceTitle: "RCW 19.255.010(7)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- Brazil (LGPD Art. 48, ANPD Resolution 15/2024) ----
  {
    id: BreachLawId.LgpdAuthority,
    family: BreachLawFamily.Lgpd,
    law: "LGPD",
    provision: "Article 48",
    places: [BreachPlace.Brazil],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.RelevantRiskToPeople],
    action: translationKey("Notify the ANPD"),
    recipient: translationKey(
      "The ANPD, Brazil's National Data Protection Authority, through its electronic form",
    ),
    deadline: {
      unit: BreachDeadlineUnit.BusinessDays,
      amount: 3,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from when you learned the incident affected personal data. Weekends are skipped here; public holidays are not, so the law's date may be later.",
    ),
    note: translationKey(
      "Relevant risk means it may significantly affect the people's rights and involves sensitive data, data of children, adolescents or the elderly, financial data, authentication data, data under secrecy, or data at large scale.",
    ),
    sourceUrl: ANPD_SOURCE,
    sourceTitle:
      "Lei 13.709/2018 (LGPD), Article 48; ANPD Resolution CD/ANPD 15/2024, Article 6",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.LgpdPeople,
    family: BreachLawFamily.Lgpd,
    law: "LGPD",
    provision: "Article 48",
    places: [BreachPlace.Brazil],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.RelevantRiskToPeople],
    action: TELL_THE_PEOPLE,
    recipient: THE_PEOPLE,
    deadline: {
      unit: BreachDeadlineUnit.BusinessDays,
      amount: 3,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from when you learned the incident affected personal data. Weekends are skipped here; public holidays are not, so the law's date may be later.",
    ),
    sourceUrl: ANPD_SOURCE,
    sourceTitle:
      "Lei 13.709/2018 (LGPD), Article 48; ANPD Resolution CD/ANPD 15/2024, Article 9",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- India (DPDP Act 2023 s. 8(6), DPDP Rules 2025 Rule 7; CERT-In) ----
  {
    id: BreachLawId.DpdpPeople,
    family: BreachLawFamily.Dpdp,
    law: "DPDP Rules, 2025",
    provision: "Rule 7(1)",
    places: [BreachPlace.India],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected Data Principal"),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUndueDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Rule 7 takes effect eighteen months after the Rules were published in the Gazette on 13 November 2025.",
    ),
    sourceUrl: DPDP_SOURCE,
    sourceTitle:
      "Digital Personal Data Protection Rules, 2025 (G.S.R. 846(E)), Rule 7(1); DPDP Act, 2023, section 8(6)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
    inForceFrom: "2027-05-13",
  },
  {
    id: BreachLawId.DpdpBoard,
    family: BreachLawFamily.Dpdp,
    law: "DPDP Rules, 2025",
    provision: "Rule 7(2)",
    places: [BreachPlace.India],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: translationKey("Notify the Data Protection Board of India"),
    recipient: translationKey("The Data Protection Board of India"),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "A first notice without delay, then the detailed report within that time of becoming aware, or longer if the Board allows it in writing.",
    ),
    note: translationKey(
      "Rule 7 takes effect eighteen months after the Rules were published in the Gazette on 13 November 2025.",
    ),
    sourceUrl: DPDP_SOURCE,
    sourceTitle:
      "Digital Personal Data Protection Rules, 2025 (G.S.R. 846(E)), Rule 7(2)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
    inForceFrom: "2027-05-13",
  },
  {
    id: BreachLawId.CertIn,
    family: BreachLawFamily.CertIn,
    law: "CERT-In Directions",
    provision: "Direction (ii)",
    places: [BreachPlace.India],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.CertInEntity],
    action: translationKey("Report it to CERT-In"),
    recipient: translationKey(
      "CERT-In, India's computer emergency response team",
    ),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 6,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from noticing the incident. A data breach and a data leak are both incidents its directions list.",
    ),
    sourceUrl: CERT_IN_SOURCE,
    sourceTitle:
      "CERT-In Directions under section 70B(6) of the IT Act, 2000 (28 April 2022), direction (ii)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  // ---- PCI DSS v4.0.1 ----
  {
    id: BreachLawId.PciDss,
    family: BreachLawFamily.PciDss,
    law: "PCI DSS v4.0.1",
    provision: "Requirement 12.10.1",
    places: null,
    dataElements: [BreachDataElement.CardData],
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HandlesCardData],
    action: translationKey("Tell your acquirer and the card brands"),
    recipient: translationKey("Your acquirer and the payment card brands"),
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "PCI DSS sets no deadline of its own: your incident response plan, your agreements and each card brand's rules do.",
    ),
    sourceUrl: PCI_DSS_SOURCE,
    sourceTitle: "PCI DSS v4.0.1 (June 2024), Requirement 12.10.1",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
];

// A row, by its id: every id has one.
export function getBreachLawRule(id: BreachLawId): BreachLawRule {
  const rule: BreachLawRule | undefined = BREACH_LAW_RULES.find(
    (candidate: BreachLawRule): boolean => {
      return candidate.id === id;
    },
  );

  if (!rule) {
    throw new Error(`No breach law row ${id}.`);
  }

  return rule;
}

export function isBreachLawId(value: unknown): value is BreachLawId {
  return (
    typeof value === "string" &&
    (Object.values(BreachLawId) as Array<string>).includes(value)
  );
}

// The places the table covers, each with the laws it covers there, for "what this does not cover".
export const COVERED_PLACES: ReadonlyArray<BreachPlace> = [
  BreachPlace.Eea,
  BreachPlace.UnitedKingdom,
  BreachPlace.California,
  BreachPlace.Colorado,
  BreachPlace.Florida,
  BreachPlace.NewYork,
  BreachPlace.Texas,
  BreachPlace.Washington,
  BreachPlace.Brazil,
  BreachPlace.India,
];
