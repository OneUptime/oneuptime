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

// The day the table's first rows (#10377) were read from their sources.
export const BREACH_LAWS_CHECKED_ON: string = "2026-11-24";

/*
 * The day the card brands' rows (#10953) were read from each brand's own
 * published rules: the version each row cites was the current one then.
 */
export const CARD_BRAND_RULES_CHECKED_ON: string = "2026-11-27";

/*
 * The day the other US states' rows (#10952) were read, each from its
 * statute's own text on the state's official code site or, where the code
 * is published only by a vendor, from the legislature's own copies of the
 * acts that enacted and amended it.
 */
export const US_STATE_LAWS_CHECKED_ON: string = "2026-11-27";

/*
 * The day the rows of #11424 to #11427 that were not read on
 * US_STATE_LAWS_CHECKED_ON were read: Vermont's text in force from
 * 1 January 2027 and the act that made it (#11425); Puerto Rico's law,
 * from the Legislative Assembly's copies of its act and of the act that
 * amended it, in Spanish (#11424); Guam's, from the Compiler of Laws, and
 * the US Virgin Islands', from the Legislature's copy of its act (#11426);
 * and the notices to the data's owner (#11427) whose text was read that
 * day: California's, New York's and the processor's under GDPR and UK GDPR.
 */
export const FOLLOW_UP_LAWS_CHECKED_ON: string = "2026-11-28";

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
  /*
   * Each state, the District of Columbia and Puerto Rico, by its ISO
   * 3166-2:US code (#10952), and Guam and the US Virgin Islands (#11426):
   * every one is a place a person can say the people live in, whether or
   * not the table has rows for its law yet.
   */
  Alabama = "US-AL",
  Alaska = "US-AK",
  Arizona = "US-AZ",
  Arkansas = "US-AR",
  California = "US-CA",
  Colorado = "US-CO",
  Connecticut = "US-CT",
  Delaware = "US-DE",
  DistrictOfColumbia = "US-DC",
  Florida = "US-FL",
  Georgia = "US-GA",
  Guam = "US-GU",
  Hawaii = "US-HI",
  Idaho = "US-ID",
  Illinois = "US-IL",
  Indiana = "US-IN",
  Iowa = "US-IA",
  Kansas = "US-KS",
  Kentucky = "US-KY",
  Louisiana = "US-LA",
  Maine = "US-ME",
  Maryland = "US-MD",
  Massachusetts = "US-MA",
  Michigan = "US-MI",
  Minnesota = "US-MN",
  Mississippi = "US-MS",
  Missouri = "US-MO",
  Montana = "US-MT",
  Nebraska = "US-NE",
  Nevada = "US-NV",
  NewHampshire = "US-NH",
  NewJersey = "US-NJ",
  NewMexico = "US-NM",
  NewYork = "US-NY",
  NorthCarolina = "US-NC",
  NorthDakota = "US-ND",
  Ohio = "US-OH",
  Oklahoma = "US-OK",
  Oregon = "US-OR",
  Pennsylvania = "US-PA",
  PuertoRico = "US-PR",
  RhodeIsland = "US-RI",
  SouthCarolina = "US-SC",
  SouthDakota = "US-SD",
  Tennessee = "US-TN",
  Texas = "US-TX",
  UsVirginIslands = "US-VI",
  Utah = "US-UT",
  Vermont = "US-VT",
  Virginia = "US-VA",
  Washington = "US-WA",
  WestVirginia = "US-WV",
  Wisconsin = "US-WI",
  Wyoming = "US-WY",
  /*
   * A US state the table did not cover, as a person said it before #10952
   * named every state: kept for the answers that hold it, no longer offered.
   */
  OtherUsState = "US-OTHER",
  Brazil = "BR",
  India = "IN",
  // Anywhere the table does not cover.
  Elsewhere = "OTHER",
}

export const BREACH_PLACES: ReadonlyArray<BreachPlace> =
  Object.values(BreachPlace);

/*
 * Every US state, the District of Columbia, Puerto Rico, Guam and the US
 * Virgin Islands, in alphabetical order.
 */
export const US_JURISDICTION_PLACES: ReadonlyArray<BreachPlace> = [
  BreachPlace.Alabama,
  BreachPlace.Alaska,
  BreachPlace.Arizona,
  BreachPlace.Arkansas,
  BreachPlace.California,
  BreachPlace.Colorado,
  BreachPlace.Connecticut,
  BreachPlace.Delaware,
  BreachPlace.DistrictOfColumbia,
  BreachPlace.Florida,
  BreachPlace.Georgia,
  BreachPlace.Guam,
  BreachPlace.Hawaii,
  BreachPlace.Idaho,
  BreachPlace.Illinois,
  BreachPlace.Indiana,
  BreachPlace.Iowa,
  BreachPlace.Kansas,
  BreachPlace.Kentucky,
  BreachPlace.Louisiana,
  BreachPlace.Maine,
  BreachPlace.Maryland,
  BreachPlace.Massachusetts,
  BreachPlace.Michigan,
  BreachPlace.Minnesota,
  BreachPlace.Mississippi,
  BreachPlace.Missouri,
  BreachPlace.Montana,
  BreachPlace.Nebraska,
  BreachPlace.Nevada,
  BreachPlace.NewHampshire,
  BreachPlace.NewJersey,
  BreachPlace.NewMexico,
  BreachPlace.NewYork,
  BreachPlace.NorthCarolina,
  BreachPlace.NorthDakota,
  BreachPlace.Ohio,
  BreachPlace.Oklahoma,
  BreachPlace.Oregon,
  BreachPlace.Pennsylvania,
  BreachPlace.PuertoRico,
  BreachPlace.RhodeIsland,
  BreachPlace.SouthCarolina,
  BreachPlace.SouthDakota,
  BreachPlace.Tennessee,
  BreachPlace.Texas,
  BreachPlace.UsVirginIslands,
  BreachPlace.Utah,
  BreachPlace.Vermont,
  BreachPlace.Virginia,
  BreachPlace.Washington,
  BreachPlace.WestVirginia,
  BreachPlace.Wisconsin,
  BreachPlace.Wyoming,
];

// The places that are a part of the United States: every jurisdiction, and the old "another US state".
export const US_STATE_PLACES: ReadonlyArray<BreachPlace> = [
  ...US_JURISDICTION_PLACES,
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
  [BreachPlace.Alabama]: translationKey("Alabama"),
  [BreachPlace.Alaska]: translationKey("Alaska"),
  [BreachPlace.Arizona]: translationKey("Arizona"),
  [BreachPlace.Arkansas]: translationKey("Arkansas"),
  [BreachPlace.California]: translationKey("California"),
  [BreachPlace.Colorado]: translationKey("Colorado"),
  [BreachPlace.Connecticut]: translationKey("Connecticut"),
  [BreachPlace.Delaware]: translationKey("Delaware"),
  [BreachPlace.DistrictOfColumbia]: translationKey("the District of Columbia"),
  [BreachPlace.Florida]: translationKey("Florida"),
  [BreachPlace.Georgia]: translationKey("Georgia (US state)"),
  [BreachPlace.Guam]: translationKey("Guam"),
  [BreachPlace.Hawaii]: translationKey("Hawaii"),
  [BreachPlace.Idaho]: translationKey("Idaho"),
  [BreachPlace.Illinois]: translationKey("Illinois"),
  [BreachPlace.Indiana]: translationKey("Indiana"),
  [BreachPlace.Iowa]: translationKey("Iowa"),
  [BreachPlace.Kansas]: translationKey("Kansas"),
  [BreachPlace.Kentucky]: translationKey("Kentucky"),
  [BreachPlace.Louisiana]: translationKey("Louisiana"),
  [BreachPlace.Maine]: translationKey("Maine"),
  [BreachPlace.Maryland]: translationKey("Maryland"),
  [BreachPlace.Massachusetts]: translationKey("Massachusetts"),
  [BreachPlace.Michigan]: translationKey("Michigan"),
  [BreachPlace.Minnesota]: translationKey("Minnesota"),
  [BreachPlace.Mississippi]: translationKey("Mississippi"),
  [BreachPlace.Missouri]: translationKey("Missouri"),
  [BreachPlace.Montana]: translationKey("Montana"),
  [BreachPlace.Nebraska]: translationKey("Nebraska"),
  [BreachPlace.Nevada]: translationKey("Nevada"),
  [BreachPlace.NewHampshire]: translationKey("New Hampshire"),
  [BreachPlace.NewJersey]: translationKey("New Jersey"),
  [BreachPlace.NewMexico]: translationKey("New Mexico"),
  [BreachPlace.NewYork]: translationKey("New York"),
  [BreachPlace.NorthCarolina]: translationKey("North Carolina"),
  [BreachPlace.NorthDakota]: translationKey("North Dakota"),
  [BreachPlace.Ohio]: translationKey("Ohio"),
  [BreachPlace.Oklahoma]: translationKey("Oklahoma"),
  [BreachPlace.Oregon]: translationKey("Oregon"),
  [BreachPlace.Pennsylvania]: translationKey("Pennsylvania"),
  [BreachPlace.PuertoRico]: translationKey("Puerto Rico"),
  [BreachPlace.RhodeIsland]: translationKey("Rhode Island"),
  [BreachPlace.SouthCarolina]: translationKey("South Carolina"),
  [BreachPlace.SouthDakota]: translationKey("South Dakota"),
  [BreachPlace.Tennessee]: translationKey("Tennessee"),
  [BreachPlace.Texas]: translationKey("Texas"),
  [BreachPlace.UsVirginIslands]: translationKey("the US Virgin Islands"),
  [BreachPlace.Utah]: translationKey("Utah"),
  [BreachPlace.Vermont]: translationKey("Vermont"),
  [BreachPlace.Virginia]: translationKey("Virginia"),
  [BreachPlace.Washington]: translationKey("Washington"),
  [BreachPlace.WestVirginia]: translationKey("West Virginia"),
  [BreachPlace.Wisconsin]: translationKey("Wisconsin"),
  [BreachPlace.Wyoming]: translationKey("Wyoming"),
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
  [BreachPlace.Alabama]: translationKey("Alabama"),
  [BreachPlace.Alaska]: translationKey("Alaska"),
  [BreachPlace.Arizona]: translationKey("Arizona"),
  [BreachPlace.Arkansas]: translationKey("Arkansas"),
  [BreachPlace.California]: translationKey("California"),
  [BreachPlace.Colorado]: translationKey("Colorado"),
  [BreachPlace.Connecticut]: translationKey("Connecticut"),
  [BreachPlace.Delaware]: translationKey("Delaware"),
  [BreachPlace.DistrictOfColumbia]: translationKey("District of Columbia"),
  [BreachPlace.Florida]: translationKey("Florida"),
  [BreachPlace.Georgia]: translationKey("Georgia (US state)"),
  [BreachPlace.Guam]: translationKey("Guam"),
  [BreachPlace.Hawaii]: translationKey("Hawaii"),
  [BreachPlace.Idaho]: translationKey("Idaho"),
  [BreachPlace.Illinois]: translationKey("Illinois"),
  [BreachPlace.Indiana]: translationKey("Indiana"),
  [BreachPlace.Iowa]: translationKey("Iowa"),
  [BreachPlace.Kansas]: translationKey("Kansas"),
  [BreachPlace.Kentucky]: translationKey("Kentucky"),
  [BreachPlace.Louisiana]: translationKey("Louisiana"),
  [BreachPlace.Maine]: translationKey("Maine"),
  [BreachPlace.Maryland]: translationKey("Maryland"),
  [BreachPlace.Massachusetts]: translationKey("Massachusetts"),
  [BreachPlace.Michigan]: translationKey("Michigan"),
  [BreachPlace.Minnesota]: translationKey("Minnesota"),
  [BreachPlace.Mississippi]: translationKey("Mississippi"),
  [BreachPlace.Missouri]: translationKey("Missouri"),
  [BreachPlace.Montana]: translationKey("Montana"),
  [BreachPlace.Nebraska]: translationKey("Nebraska"),
  [BreachPlace.Nevada]: translationKey("Nevada"),
  [BreachPlace.NewHampshire]: translationKey("New Hampshire"),
  [BreachPlace.NewJersey]: translationKey("New Jersey"),
  [BreachPlace.NewMexico]: translationKey("New Mexico"),
  [BreachPlace.NewYork]: translationKey("New York"),
  [BreachPlace.NorthCarolina]: translationKey("North Carolina"),
  [BreachPlace.NorthDakota]: translationKey("North Dakota"),
  [BreachPlace.Ohio]: translationKey("Ohio"),
  [BreachPlace.Oklahoma]: translationKey("Oklahoma"),
  [BreachPlace.Oregon]: translationKey("Oregon"),
  [BreachPlace.Pennsylvania]: translationKey("Pennsylvania"),
  [BreachPlace.PuertoRico]: translationKey("Puerto Rico"),
  [BreachPlace.RhodeIsland]: translationKey("Rhode Island"),
  [BreachPlace.SouthCarolina]: translationKey("South Carolina"),
  [BreachPlace.SouthDakota]: translationKey("South Dakota"),
  [BreachPlace.Tennessee]: translationKey("Tennessee"),
  [BreachPlace.Texas]: translationKey("Texas"),
  [BreachPlace.UsVirginIslands]: translationKey("US Virgin Islands"),
  [BreachPlace.Utah]: translationKey("Utah"),
  [BreachPlace.Vermont]: translationKey("Vermont"),
  [BreachPlace.Virginia]: translationKey("Virginia"),
  [BreachPlace.Washington]: translationKey("Washington"),
  [BreachPlace.WestVirginia]: translationKey("West Virginia"),
  [BreachPlace.Wisconsin]: translationKey("Wisconsin"),
  [BreachPlace.Wyoming]: translationKey("Wyoming"),
  [BreachPlace.OtherUsState]: translationKey("Another US state"),
  [BreachPlace.Brazil]: translationKey("Brazil"),
  [BreachPlace.India]: translationKey("India"),
  [BreachPlace.Elsewhere]: translationKey("Somewhere else"),
};

/*
 * The places a person picks from, as the picker offers them: the countries
 * and regions as choices of their own, every US jurisdiction in a list of
 * its own. "Another US state" is no longer offered: every state is.
 */
export const BREACH_PLACE_REGION_CHOICES: ReadonlyArray<BreachPlace> = [
  BreachPlace.Eea,
  BreachPlace.UnitedKingdom,
  BreachPlace.UnitedStates,
  BreachPlace.Brazil,
  BreachPlace.India,
  BreachPlace.Elsewhere,
];

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
 * does not cover is Elsewhere. Puerto Rico, Guam and the US Virgin Islands
 * have codes of their own, and laws the table holds (#11424, #11426): data
 * that places its people there places them in that territory.
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
    case "PR":
      return BreachPlace.PuertoRico;
    case "GU":
      return BreachPlace.Guam;
    case "VI":
      return BreachPlace.UsVirginIslands;
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
  [BreachDataElement.MedicalInformation]: translationKey("medical information"),
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
  // A card brand's own rules: the exposed card data includes that brand's cards.
  CardsOfTheBrand = "CardsOfTheBrand",
  // CERT-In: the organization is one its directions cover.
  CertInEntity = "CertInEntity",
  /*
   * The other US states' (#10952), each as its statute words the test. Most
   * excuse the notice when an investigation finds harm is not likely.
   */
  LikelyHarm = "LikelyHarm",
  // The District of Columbia: the same, after consulting its attorney general and federal law enforcement.
  LikelyHarmAfterConsulting = "LikelyHarmAfterConsulting",
  // Alabama: only when it is reasonably likely to cause substantial harm.
  SubstantialHarm = "SubstantialHarm",
  // Arizona: unless it has not resulted, and is not likely to result, in substantial economic loss.
  SubstantialEconomicLoss = "SubstantialEconomicLoss",
  // Hawaii: illegal use has occurred, or is reasonably likely, and creates a risk of harm.
  LikelyIllegalUse = "LikelyIllegalUse",
  // Indiana: it has resulted, or could result, in identity deception, identity theft or fraud.
  IdentityTheftOrFraud = "IdentityTheftOrFraud",
  // Georgia: its law covers information brokers and state or local agencies, and no one else.
  InformationBrokerOrAgency = "InformationBrokerOrAgency",
  // Iowa: unless no reasonable likelihood of financial harm, determined in writing and kept five years.
  FinancialHarmInWriting = "FinancialHarmInWriting",
  // Kentucky: a breach that causes, or is reasonably believed to cause, identity theft or fraud.
  CausesIdentityTheftOrFraud = "CausesIdentityTheftOrFraud",
  // Maine: unless misuse has not occurred and is not reasonably possible.
  PossibleMisuse = "PossibleMisuse",
  // Massachusetts: a substantial risk of identity theft or fraud, or data acquired or used without right.
  SubstantialRiskOfIdentityTheft = "SubstantialRiskOfIdentityTheft",
  // Michigan: unless not likely to cause substantial loss or injury, or identity theft.
  SubstantialLossOrIdentityTheft = "SubstantialLossOrIdentityTheft",
  // Missouri: unless identity theft or other fraud is not reasonably likely, in writing kept five years.
  IdentityTheftOrFraudInWriting = "IdentityTheftOrFraudInWriting",
  // Montana: a breach that causes, or is reasonably believed to cause, loss or injury.
  LossOrInjury = "LossOrInjury",
  // Nebraska: use for an unauthorized purpose has occurred or is reasonably likely.
  LikelyUnauthorizedUse = "LikelyUnauthorizedUse",
  // New Hampshire: unless misuse is not reasonably likely; owed while it cannot be determined.
  MisuseOrUndetermined = "MisuseOrUndetermined",
  // New Jersey: unless misuse is established not reasonably possible, in writing kept five years.
  MisuseNotPossibleInWriting = "MisuseNotPossibleInWriting",
  // New Mexico: unless it gives rise to no significant risk of identity theft or fraud.
  SignificantRiskOfIdentityTheft = "SignificantRiskOfIdentityTheft",
  // North and South Carolina: illegal use has occurred or is reasonably likely, or a material risk of harm.
  IllegalUseOrMaterialRisk = "IllegalUseOrMaterialRisk",
  // Ohio: a material risk of identity theft or other fraud.
  MaterialRiskOfIdentityTheft = "MaterialRiskOfIdentityTheft",
  // Oregon: unless the people are unlikely to suffer harm, determined in writing and kept five years.
  UnlikelyHarmInWriting = "UnlikelyHarmInWriting",
  // Rhode Island: a breach that poses a significant risk of identity theft.
  PosesSignificantRiskOfIdentityTheft = "PosesSignificantRiskOfIdentityTheft",
  // South Dakota: unless, after telling the attorney general, harm is not likely, in writing kept three years.
  LikelyHarmAfterTellingAg = "LikelyHarmAfterTellingAg",
  // Utah: an investigation finds misuse for identity theft or fraud has occurred or is reasonably likely.
  MisuseForIdentityTheftOrFraud = "MisuseForIdentityTheftOrFraud",
  // Vermont: unless misuse is not reasonably possible, with that determination explained to the attorney general.
  MisuseNotPossibleTellAg = "MisuseNotPossibleTellAg",
  // Wisconsin: unless the acquisition creates no material risk of identity theft or fraud.
  NoMaterialRiskOfIdentityTheft = "NoMaterialRiskOfIdentityTheft",
  // Wyoming: an investigation finds misuse has occurred or is reasonably likely.
  InvestigationFindsMisuse = "InvestigationFindsMisuse",
  /*
   * The notices an organization that holds the data for another owes the
   * data's owner (#11427), where a statute puts a test of its own on them.
   */
  // Colorado, Idaho, Nebraska and Utah: misuse of the data has occurred or is likely.
  MisuseOccurredOrLikely = "MisuseOccurredOrLikely",
  // Mississippi: the data was acquired by someone not allowed to, for fraudulent purposes.
  AcquiredForFraud = "AcquiredForFraud",
  // Georgia: the data is held for an information broker, or for a state or local agency.
  HeldForBrokerOrAgency = "HeldForBrokerOrAgency",
  // Wisconsin: the organization has no contract with the data's owner.
  NoContractWithOwner = "NoContractWithOwner",
  // Puerto Rico: the organization resells, or provides access to, the databases that hold the data.
  ResellsOrProvidesAccess = "ResellsOrProvidesAccess",
}

export const BREACH_CONDITION_WORDS: Readonly<Record<BreachCondition, string>> =
  {
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
    [BreachCondition.CardsOfTheBrand]: translationKey(
      "If the exposed card data includes this brand's cards.",
    ),
    [BreachCondition.CertInEntity]: translationKey(
      "If your organization is a service provider, intermediary, data centre, body corporate or government organisation CERT-In's directions cover.",
    ),
    [BreachCondition.LikelyHarm]: translationKey(
      "Unless, after an investigation, you determine the breach is not likely to result in harm to the people.",
    ),
    [BreachCondition.LikelyHarmAfterConsulting]: translationKey(
      "Unless, after an investigation and consulting the attorney general and federal law enforcement, you determine the breach will likely not result in harm to the people.",
    ),
    [BreachCondition.SubstantialHarm]: translationKey(
      "If the breach is reasonably likely to cause substantial harm to the people.",
    ),
    [BreachCondition.SubstantialEconomicLoss]: translationKey(
      "Unless an investigation finds the breach has not resulted, and is not reasonably likely to result, in substantial economic loss to the people.",
    ),
    [BreachCondition.LikelyIllegalUse]: translationKey(
      "If the data has been, or is reasonably likely to be, used illegally in a way that creates a risk of harm to the people.",
    ),
    [BreachCondition.IdentityTheftOrFraud]: translationKey(
      "If the breach has resulted, or could result, in identity deception, identity theft or fraud.",
    ),
    [BreachCondition.InformationBrokerOrAgency]: translationKey(
      "If your organization is an information broker, collecting personal information for fees to furnish it to others, or a state or local agency: the law covers no one else.",
    ),
    [BreachCondition.FinancialHarmInWriting]: translationKey(
      "Unless, after an investigation or consulting law enforcement, you determine there is no reasonable likelihood of financial harm to the people, in writing kept for five years.",
    ),
    [BreachCondition.CausesIdentityTheftOrFraud]: translationKey(
      "If the breach has caused, or you reasonably believe it has caused or will cause, identity theft or fraud.",
    ),
    [BreachCondition.PossibleMisuse]: translationKey(
      "Unless an investigation finds the data was not misused and its misuse is not reasonably possible.",
    ),
    [BreachCondition.SubstantialRiskOfIdentityTheft]: translationKey(
      "If the breach creates a substantial risk of identity theft or fraud, or the data was acquired or used by someone not allowed to.",
    ),
    [BreachCondition.SubstantialLossOrIdentityTheft]: translationKey(
      "Unless you determine the breach has not caused, and is not likely to cause, substantial loss or injury to, or identity theft for, the people.",
    ),
    [BreachCondition.IdentityTheftOrFraudInWriting]: translationKey(
      "Unless, after an investigation or consulting law enforcement, you determine identity theft or other fraud is not reasonably likely, in writing kept for five years.",
    ),
    [BreachCondition.LossOrInjury]: translationKey(
      "If the breach causes, or is reasonably believed to cause, loss or injury to the people.",
    ),
    [BreachCondition.LikelyUnauthorizedUse]: translationKey(
      "If an investigation finds the data was, or is reasonably likely to be, used for an unauthorized purpose.",
    ),
    [BreachCondition.MisuseOrUndetermined]: translationKey(
      "Unless you determine the data was not misused and its misuse is not reasonably likely: while you cannot tell, the notice is due.",
    ),
    [BreachCondition.MisuseNotPossibleInWriting]: translationKey(
      "Unless you establish that misuse of the data is not reasonably possible, in writing kept for five years.",
    ),
    [BreachCondition.SignificantRiskOfIdentityTheft]: translationKey(
      "Unless, after an investigation, you determine the breach does not give rise to a significant risk of identity theft or fraud.",
    ),
    [BreachCondition.IllegalUseOrMaterialRisk]: translationKey(
      "If the data has been, or is reasonably likely to be, used illegally, or the breach creates a material risk of harm to the people.",
    ),
    [BreachCondition.MaterialRiskOfIdentityTheft]: translationKey(
      "If the breach causes, or is reasonably believed to cause, a material risk of identity theft or other fraud to the people.",
    ),
    [BreachCondition.UnlikelyHarmInWriting]: translationKey(
      "Unless, after an investigation or consulting law enforcement, you determine the people are unlikely to suffer harm, in writing kept for five years.",
    ),
    [BreachCondition.PosesSignificantRiskOfIdentityTheft]: translationKey(
      "If the breach poses a significant risk of identity theft to the people.",
    ),
    [BreachCondition.LikelyHarmAfterTellingAg]: translationKey(
      "Unless, after an investigation and telling the attorney general, you determine the breach will not likely result in harm to the people, in writing kept for three years.",
    ),
    [BreachCondition.MisuseForIdentityTheftOrFraud]: translationKey(
      "If an investigation finds the data was, or is reasonably likely to be, misused for identity theft or fraud.",
    ),
    [BreachCondition.MisuseNotPossibleTellAg]: translationKey(
      "Unless you establish that misuse of the data is not reasonably possible, and send that determination, with a detailed explanation, to the attorney general.",
    ),
    [BreachCondition.NoMaterialRiskOfIdentityTheft]: translationKey(
      "Unless the acquisition does not create a material risk of identity theft or fraud to the people.",
    ),
    [BreachCondition.InvestigationFindsMisuse]: translationKey(
      "If an investigation finds the data was, or is reasonably likely to be, misused.",
    ),
    [BreachCondition.MisuseOccurredOrLikely]: translationKey(
      "If the data was misused, or its misuse is likely.",
    ),
    [BreachCondition.AcquiredForFraud]: translationKey(
      "If the data was, or is reasonably believed to have been, acquired by someone not allowed to, for fraudulent purposes.",
    ),
    [BreachCondition.HeldForBrokerOrAgency]: translationKey(
      "If you hold the data for an information broker, or for a state or local agency: the law covers no other owner's data.",
    ),
    [BreachCondition.NoContractWithOwner]: translationKey(
      "If you have no contract with the data's owner.",
    ),
    [BreachCondition.ResellsOrProvidesAccess]: translationKey(
      "If you resell, or provide access to, the digital databases that hold the data.",
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
  /*
   * No length of time, as most US states word it: "in the most expedient
   * time possible and without unreasonable delay" (#10952).
   */
  WithoutUnreasonableDelay = "WithoutUnreasonableDelay",
  /*
   * No length of time, as the notices to the data's owner word it (#11427):
   * "immediately following discovery", and "as soon as practicable".
   */
  Immediately = "Immediately",
  AsSoonAsPracticable = "AsSoonAsPracticable",
}

// Whether a deadline has no length of time: it sets no due moment.
export function isDeadlineWithoutLength(unit: BreachDeadlineUnit): boolean {
  return (
    unit === BreachDeadlineUnit.WithoutUndueDelay ||
    unit === BreachDeadlineUnit.WithoutUnreasonableDelay ||
    unit === BreachDeadlineUnit.NoFixedTime ||
    unit === BreachDeadlineUnit.Immediately ||
    unit === BreachDeadlineUnit.AsSoonAsPracticable
  );
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
  // The card brands' own rules (#10953), each from its published document.
  VisaCompromise = "visa-wtdic-a-1",
  MastercardAdcEvent = "mastercard-spme-10-3-1",
  AmericanExpressDataIncident = "amex-dsop-3-1",
  // The other US states' (#10952), each from its statute's own text.
  AlabamaResidents = "al-8-38-5-residents",
  AlabamaAttorneyGeneral = "al-8-38-6-attorney-general",
  AlaskaResidents = "ak-45-48-010-residents",
  ArizonaResidents = "az-18-552-b-1-residents",
  ArizonaAttorneyGeneral = "az-18-552-b-2-attorney-general",
  ArkansasResidents = "ar-4-110-105-a-residents",
  ArkansasAttorneyGeneral = "ar-4-110-105-b-attorney-general",
  ConnecticutResidents = "ct-36a-701b-b-1-residents",
  ConnecticutAttorneyGeneral = "ct-36a-701b-b-2-attorney-general",
  DelawareResidents = "de-12b-102-a-residents",
  DelawareAttorneyGeneral = "de-12b-102-d-attorney-general",
  DistrictOfColumbiaResidents = "dc-28-3852-a-residents",
  DistrictOfColumbiaAttorneyGeneral = "dc-28-3852-b-1-attorney-general",
  GeorgiaResidents = "ga-10-1-912-a-residents",
  HawaiiResidents = "hi-487n-2-a-residents",
  HawaiiConsumerProtection = "hi-487n-2-f-consumer-protection",
  IdahoResidents = "id-28-51-105-residents",
  IllinoisResidents = "il-530-10-a-residents",
  IllinoisAttorneyGeneral = "il-530-10-e-attorney-general",
  IndianaResidents = "in-24-4-9-3-1-a-residents",
  IndianaAttorneyGeneral = "in-24-4-9-3-1-c-attorney-general",
  IowaResidents = "ia-715c-2-1-residents",
  IowaAttorneyGeneral = "ia-715c-2-8-attorney-general",
  KansasResidents = "ks-50-7a02-residents",
  KentuckyResidents = "ky-365-732-residents",
  LouisianaResidents = "la-51-3074-residents",
  LouisianaAttorneyGeneral = "la-lac-16-iii-701-attorney-general",
  MaineResidents = "me-10-1348-1-residents",
  MaineAttorneyGeneral = "me-10-1348-5-attorney-general",
  MarylandResidents = "md-cl-14-3504-b-residents",
  MarylandAttorneyGeneral = "md-cl-14-3504-h-attorney-general",
  MassachusettsResidents = "ma-93h-3-b-residents",
  MassachusettsAttorneyGeneral = "ma-93h-3-b-attorney-general",
  MichiganResidents = "mi-445-72-residents",
  MinnesotaResidents = "mn-325e-61-residents",
  MississippiResidents = "ms-75-24-29-residents",
  MissouriResidents = "mo-407-1500-residents",
  MissouriAttorneyGeneral = "mo-407-1500-attorney-general",
  MontanaResidents = "mt-30-14-1704-residents",
  MontanaAttorneyGeneral = "mt-30-14-1704-attorney-general",
  NebraskaResidents = "ne-87-803-1-residents",
  NebraskaAttorneyGeneral = "ne-87-803-2-attorney-general",
  NevadaResidents = "nv-603a-220-residents",
  NewHampshireResidents = "nh-359-c-20-residents",
  NewHampshireAttorneyGeneral = "nh-359-c-20-attorney-general",
  NewJerseyResidents = "nj-56-8-163-residents",
  NewJerseyStatePolice = "nj-56-8-163-state-police",
  NewMexicoResidents = "nm-57-12c-6-residents",
  NewMexicoAttorneyGeneral = "nm-57-12c-10-attorney-general",
  AlabamaConsumerReportingAgencies = "al-8-38-7-consumer-reporting-agencies",
  AlaskaConsumerReportingAgencies = "ak-45-48-040-consumer-reporting-agencies",
  ArizonaConsumerReportingAgencies = "az-18-552-b-2-a-consumer-reporting-agencies",
  DistrictOfColumbiaConsumerReportingAgencies = "dc-28-3852-c-consumer-reporting-agencies",
  GeorgiaConsumerReportingAgencies = "ga-10-1-912-d-consumer-reporting-agencies",
  HawaiiConsumerReportingAgencies = "hi-487n-2-f-consumer-reporting-agencies",
  IndianaConsumerReportingAgencies = "in-24-4-9-3-1-b-consumer-reporting-agencies",
  KansasConsumerReportingAgencies = "ks-50-7a02-f-consumer-reporting-agencies",
  KentuckyConsumerReportingAgencies = "ky-365-732-7-consumer-reporting-agencies",
  MaineConsumerReportingAgencies = "me-10-1348-4-consumer-reporting-agencies",
  MarylandConsumerReportingAgencies = "md-cl-14-3506-consumer-reporting-agencies",
  MichiganConsumerReportingAgencies = "mi-445-72-8-consumer-reporting-agencies",
  MinnesotaConsumerReportingAgencies = "mn-325e-61-2-consumer-reporting-agencies",
  MissouriConsumerReportingAgencies = "mo-407-1500-consumer-reporting-agencies",
  NevadaConsumerReportingAgencies = "nv-603a-220-6-consumer-reporting-agencies",
  NewHampshireConsumerReportingAgencies = "nh-359-c-20-vi-consumer-reporting-agencies",
  NewJerseyConsumerReportingAgencies = "nj-56-8-163-f-consumer-reporting-agencies",
  NewMexicoConsumerReportingAgencies = "nm-57-12c-10-consumer-reporting-agencies",
  FloridaConsumerReportingAgencies = "fl-501-171-5-consumer-reporting-agencies",
  NewYorkConsumerReportingAgencies = "ny-gbl-899-aa-8-b-consumer-reporting-agencies",
  NorthCarolinaResidents = "nc-75-65-a-residents",
  NorthCarolinaAttorneyGeneral = "nc-75-65-e1-attorney-general",
  NorthDakotaResidents = "nd-51-30-02-residents",
  NorthDakotaAttorneyGeneral = "nd-51-30-02-attorney-general",
  OhioResidents = "oh-1349-19-b-residents",
  OklahomaResidents = "ok-24-163-a-residents",
  OklahomaAttorneyGeneral = "ok-24-163-e-attorney-general",
  OregonResidents = "or-646a-604-1-a-residents",
  OregonAttorneyGeneral = "or-646a-604-1-b-attorney-general",
  PennsylvaniaResidents = "pa-act-94-3-a-residents",
  PennsylvaniaAttorneyGeneral = "pa-act-94-3-c1-attorney-general",
  RhodeIslandResidents = "ri-11-49-3-4-a-residents",
  RhodeIslandAttorneyGeneral = "ri-11-49-3-4-a-2-attorney-general",
  SouthCarolinaResidents = "sc-39-1-90-a-residents",
  SouthCarolinaConsumerAffairs = "sc-39-1-90-k-consumer-affairs",
  SouthDakotaResidents = "sd-22-40-20-residents",
  SouthDakotaAttorneyGeneral = "sd-22-40-20-attorney-general",
  TennesseeResidents = "tn-47-18-2107-b-residents",
  NorthCarolinaConsumerReportingAgencies = "nc-75-65-f-consumer-reporting-agencies",
  OhioConsumerReportingAgencies = "oh-1349-19-g-consumer-reporting-agencies",
  OregonConsumerReportingAgencies = "or-646a-604-6-consumer-reporting-agencies",
  PennsylvaniaConsumerReportingAgencies = "pa-act-94-5-consumer-reporting-agencies",
  RhodeIslandConsumerReportingAgencies = "ri-11-49-3-4-consumer-reporting-agencies",
  SouthCarolinaConsumerReportingAgencies = "sc-39-1-90-k-consumer-reporting-agencies",
  SouthDakotaConsumerReportingAgencies = "sd-22-40-24-consumer-reporting-agencies",
  TennesseeConsumerReportingAgencies = "tn-47-18-2107-g-consumer-reporting-agencies",
  UtahResidents = "ut-13-44-202-1-b-residents",
  UtahAttorneyGeneral = "ut-13-44-202-1-c-attorney-general",
  VermontResidents = "vt-9-2435-b-1-residents",
  VermontAttorneyGeneral = "vt-9-2435-b-3-attorney-general",
  VirginiaResidents = "va-18-2-186-6-b-residents",
  VirginiaAttorneyGeneral = "va-18-2-186-6-b-attorney-general",
  UtahConsumerReportingAgencies = "ut-13-44-202-1-d-consumer-reporting-agencies",
  VermontConsumerReportingAgencies = "vt-9-2435-c-consumer-reporting-agencies",
  VirginiaConsumerReportingAgencies = "va-18-2-186-6-e-consumer-reporting-agencies",
  WisconsinResidents = "wi-134-98-2-residents",
  WisconsinConsumerReportingAgencies = "wi-134-98-2-br-consumer-reporting-agencies",
  WyomingResidents = "wy-40-12-502-a-residents",
  ColoradoConsumerReportingAgencies = "co-6-1-716-2-d-consumer-reporting-agencies",
  MassachusettsConsumerReportingAgencies = "ma-93h-3-b-consumer-reporting-agencies",
  TexasConsumerReportingAgencies = "tx-521-053-h-consumer-reporting-agencies",
  /*
   * Vermont's text in force from 1 January 2027 (#11425), beside the rows
   * of the text in force until then, which stay for exposures found before.
   */
  VermontResidentsFrom2027 = "vt-9-2435-b-1-residents-2027",
  VermontAttorneyGeneralFrom2027 = "vt-9-2435-b-3-attorney-general-2027",
  VermontConsumerReportingAgenciesFrom2027 = "vt-9-2435-c-consumer-reporting-agencies-2027",
  // Puerto Rico (#11424), Guam and the US Virgin Islands (#11426).
  PuertoRicoResidents = "pr-act-111-2005-3-residents",
  PuertoRicoConsumerAffairs = "pr-act-111-2005-3-consumer-affairs",
  GuamResidents = "gu-9-gca-48-30-a-residents",
  UsVirginIslandsResidents = "vi-14-vic-2209-a-residents",
  /*
   * The notice an organization that holds the data for another owes the
   * data's owner (#11427): a processor's to its controller, and each US
   * jurisdiction's whose statute asks for one.
   */
  GdprProcessor = "gdpr-art-33-2-processor",
  UkGdprProcessor = "uk-gdpr-art-33-2-processor",
  AlabamaDataOwner = "al-8-38-8-data-owner",
  AlaskaDataOwner = "ak-45-48-070-data-owner",
  ArizonaDataOwner = "az-18-552-c-data-owner",
  ArkansasDataOwner = "ar-4-110-105-b-data-owner",
  CaliforniaDataOwner = "ca-civ-1798-82-b-data-owner",
  ColoradoDataOwner = "co-6-1-716-2-b-data-owner",
  ConnecticutDataOwner = "ct-36a-701b-c-data-owner",
  DelawareDataOwner = "de-12b-102-b-data-owner",
  DistrictOfColumbiaDataOwner = "dc-28-3852-b-data-owner",
  FloridaDataOwner = "fl-501-171-6-data-owner",
  GeorgiaDataOwner = "ga-10-1-912-b-data-owner",
  GuamDataOwner = "gu-9-gca-48-30-c-data-owner",
  HawaiiDataOwner = "hi-487n-2-b-data-owner",
  IdahoDataOwner = "id-28-51-105-2-data-owner",
  IllinoisDataOwner = "il-530-10-b-data-owner",
  IndianaDataOwner = "in-24-4-9-3-2-data-owner",
  IowaDataOwner = "ia-715c-2-2-data-owner",
  KansasDataOwner = "ks-50-7a02-b-data-owner",
  KentuckyDataOwner = "ky-365-732-3-data-owner",
  LouisianaDataOwner = "la-51-3074-d-data-owner",
  MaineDataOwner = "me-10-1348-2-data-owner",
  MarylandDataOwner = "md-cl-14-3504-c-data-owner",
  MassachusettsDataOwner = "ma-93h-3-a-data-owner",
  MichiganDataOwner = "mi-445-72-2-data-owner",
  MinnesotaDataOwner = "mn-325e-61-1-b-data-owner",
  MississippiDataOwner = "ms-75-24-29-4-data-owner",
  MissouriDataOwner = "mo-407-1500-2-2-data-owner",
  MontanaDataOwner = "mt-30-14-1704-2-data-owner",
  NebraskaDataOwner = "ne-87-803-3-data-owner",
  NevadaDataOwner = "nv-603a-220-2-data-owner",
  NewHampshireDataOwner = "nh-359-c-20-i-c-data-owner",
  NewJerseyDataOwner = "nj-56-8-163-b-data-owner",
  NewMexicoDataOwner = "nm-57-12c-6-c-data-owner",
  NewYorkDataOwner = "ny-gbl-899-aa-3-data-owner",
  NorthCarolinaDataOwner = "nc-75-65-b-data-owner",
  NorthDakotaDataOwner = "nd-51-30-03-data-owner",
  OhioDataOwner = "oh-1349-19-c-data-owner",
  OklahomaDataOwner = "ok-24-163-c-data-owner",
  OregonDataOwner = "or-646a-604-2-data-owner",
  PennsylvaniaDataOwner = "pa-act-94-3-c-data-owner",
  PuertoRicoDataOwner = "pr-act-111-2005-3-data-owner",
  SouthCarolinaDataOwner = "sc-39-1-90-b-data-owner",
  TennesseeDataOwner = "tn-47-18-2107-c-data-owner",
  TexasDataOwner = "tx-521-053-c-data-owner",
  UsVirginIslandsDataOwner = "vi-14-vic-2209-b-data-owner",
  UtahDataOwner = "ut-13-44-202-3-data-owner",
  VermontDataOwner = "vt-9-2435-b-2-data-owner",
  VermontDataOwnerFrom2027 = "vt-9-2435-b-2-data-owner-2027",
  VirginiaDataOwner = "va-18-2-186-6-d-data-owner",
  WashingtonDataOwner = "wa-19-255-010-2-data-owner",
  WisconsinDataOwner = "wi-134-98-2-bm-data-owner",
  WyomingDataOwner = "wy-40-12-502-g-data-owner",
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
  Visa = "Visa",
  Mastercard = "Mastercard",
  AmericanExpress = "American Express",
  // The other US states (#10952), each by its own name.
  Alabama = "Alabama",
  Alaska = "Alaska",
  Arizona = "Arizona",
  Arkansas = "Arkansas",
  Connecticut = "Connecticut",
  Delaware = "Delaware",
  DistrictOfColumbia = "District of Columbia",
  Georgia = "Georgia",
  Hawaii = "Hawaii",
  Idaho = "Idaho",
  Illinois = "Illinois",
  Indiana = "Indiana",
  Iowa = "Iowa",
  Kansas = "Kansas",
  Kentucky = "Kentucky",
  Louisiana = "Louisiana",
  Maine = "Maine",
  Maryland = "Maryland",
  Massachusetts = "Massachusetts",
  Michigan = "Michigan",
  Minnesota = "Minnesota",
  Mississippi = "Mississippi",
  Missouri = "Missouri",
  Montana = "Montana",
  Nebraska = "Nebraska",
  Nevada = "Nevada",
  NewHampshire = "New Hampshire",
  NewJersey = "New Jersey",
  NewMexico = "New Mexico",
  NorthCarolina = "North Carolina",
  NorthDakota = "North Dakota",
  Ohio = "Ohio",
  Oklahoma = "Oklahoma",
  Oregon = "Oregon",
  Pennsylvania = "Pennsylvania",
  RhodeIsland = "Rhode Island",
  SouthCarolina = "South Carolina",
  SouthDakota = "South Dakota",
  Tennessee = "Tennessee",
  Utah = "Utah",
  Vermont = "Vermont",
  Virginia = "Virginia",
  Wisconsin = "Wisconsin",
  Wyoming = "Wyoming",
  // Puerto Rico (#11424), Guam and the US Virgin Islands (#11426).
  PuertoRico = "Puerto Rico",
  Guam = "Guam",
  UsVirginIslands = "US Virgin Islands",
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
  /*
   * The day a newer text replaced it, YYYY-MM-DD (#11425): the first day
   * the row of the newer text is in force. Which text an exposure follows
   * is decided by the day it was found (ExposureAssessment.applyBreachLaws):
   * a row applies to exposures found from its inForceFrom up to the day
   * before this.
   */
  inForceUntil?: string | undefined;
  /*
   * A notice an organization that holds the data for another owes the
   * data's owner (#11427): applied only once a person says the organization
   * holds this data for another (BreachLawFacts.holdsForAnother), and left
   * out of the assessment otherwise.
   */
  forDataHolders?: boolean | undefined;
}

const GDPR_SOURCE: string = "https://eur-lex.europa.eu/eli/reg/2016/679/oj";
const HIPAA_SOURCE: string =
  "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D";
const CALIFORNIA_SOURCE: string =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82";
const COLORADO_SOURCE: string =
  "https://coag.gov/resources/data-protection-laws/";
const FLORIDA_SOURCE: string =
  "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html";
// The same page over https, as #10952 read it again for the agencies' notice.
const FLORIDA_HTTPS_SOURCE: string =
  "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html";
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
// The card brands' own published rules, each the version current when checked.
const VISA_WTDIC_SOURCE: string =
  "https://usa.visa.com/dam/VCOM/download/merchants/cisp-what-to-do-if-compromised.pdf";
const MASTERCARD_SPME_SOURCE: string =
  "https://www.mastercard.com/content/dam/mccom/shared/business/support/rules-pdfs/SPME-Manual.pdf";
const AMEX_DSOP_SOURCE: string =
  "https://www.americanexpress.com/content/dam/amex/us/merchant/new-data-security/DSOP_United_States_EN.pdf";

/*
 * The other US states' statutes (#10952), each on the state's own code site,
 * or the legislature's copy of the act where only a vendor publishes the
 * code (Arkansas, Georgia).
 */
const ALABAMA_RESIDENTS_SOURCE: string =
  "https://alison.legislature.state.al.us/code-of-alabama?section=8-38-5";
const ALABAMA_ATTORNEY_GENERAL_SOURCE: string =
  "https://alison.legislature.state.al.us/code-of-alabama?section=8-38-6";
const ALASKA_SOURCE: string =
  "https://www.akleg.gov/basis/statutes.asp?media=print&secStart=45.48.010&secEnd=45.48.995";
const ARIZONA_SOURCE: string = "https://www.azleg.gov/ars/18/00552.htm";
const ARKANSAS_ACT_1526_SOURCE: string =
  "https://www.arkleg.state.ar.us/Acts/FTPDocument?path=%2FACTS%2F2005%2FPublic%2F&file=1526.pdf&ddBienniumSession=2005%2FR";
const ARKANSAS_ACT_1030_SOURCE: string =
  "https://www.arkleg.state.ar.us/Acts/FTPDocument?path=%2FACTS%2F2019R%2FPublic%2F&file=1030.pdf&ddBienniumSession=2019%2F2019R";
const CONNECTICUT_SOURCE: string =
  "https://www.cga.ct.gov/current/pub/chap_669.htm#sec_36a-701b";
const DELAWARE_SOURCE: string =
  "https://delcode.delaware.gov/title6/c012b/index.html";
const DISTRICT_OF_COLUMBIA_SOURCE: string =
  "https://code.dccouncil.gov/us/dc/council/code/sections/28-3852";
const GEORGIA_SOURCE: string =
  "https://www.legis.ga.gov/api/legislation/document/20072008/75800";
const HAWAII_SOURCE: string =
  "https://data.capitol.hawaii.gov/hrscurrent/Vol11_Ch0476-0490/HRS0487N/HRS_0487N-0002.htm";
const IDAHO_SOURCE: string =
  "https://legislature.idaho.gov/statutesrules/idstat/Title28/T28CH51/SECT28-51-105/";
const ILLINOIS_SOURCE: string =
  "https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2702&ChapterID=67";
const INDIANA_SOURCE: string =
  "https://iga.in.gov/ic/2026/Title_24/Article_4.9/Chapter_3.pdf";
const IOWA_SOURCE: string = "https://www.legis.iowa.gov/docs/code/715C.pdf";
const KANSAS_SOURCE: string =
  "https://www.ksrevisor.gov/statutes/chapters/ch50/050_007a_0002.html";
const KENTUCKY_SOURCE: string =
  "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=43326";
const LOUISIANA_SOURCE: string =
  "https://legis.la.gov/legis/LawPrint.aspx?d=322030";
// The attorney general's rule, as the Office of the State Register publishes Title 16.
const LOUISIANA_RULE_SOURCE: string =
  "https://www.doa.la.gov/media/oz2lmv1v/16.docx";
const MAINE_SOURCE: string =
  "https://legislature.maine.gov/statutes/10/title10sec1348.html";
const MARYLAND_SOURCE: string =
  "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-3504&enactments=false";
const MASSACHUSETTS_SOURCE: string =
  "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93H/Section3";
const MICHIGAN_SOURCE: string =
  "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-445-72";
const MINNESOTA_SOURCE: string =
  "https://www.revisor.mn.gov/statutes/cite/325E.61";
const MISSISSIPPI_SOURCE: string =
  "https://billstatus.ls.state.ms.us/documents/2021/html/HB/0200-0299/HB0277SG.htm";
const MISSOURI_SOURCE: string =
  "https://revisor.mo.gov/main/OneSection.aspx?section=407.1500";
const MONTANA_SOURCE: string =
  "https://leg.mt.gov/bills/mca/title_0300/chapter_0140/part_0170/section_0040/0300-0140-0170-0040.html";
const NEBRASKA_SOURCE: string =
  "https://nebraskalegislature.gov/laws/statutes.php?statute=87-803";
const NEVADA_SOURCE: string = "https://www.leg.state.nv.us/NRS/NRS-603A.html";
const NEW_HAMPSHIRE_SOURCE: string =
  "https://www.gencourt.state.nh.us/rsa/html/XXXI/359-C/359-C-20.htm";
// The statutes database serves a section inside a search: this is its search for 56:8-163.
const NEW_JERSEY_SOURCE: string =
  "https://lis.njleg.state.nj.us/nxt/gateway.dll?xhitlist_vq=56%3A8-163+Disclosure+of+breach+of+security+to+customers.&f=xhitlist&xhitlist_q=%5BRank+100%5D%5BDomain%3A+56%3A8-163+Disclosure+of+breach+of+security+to+customers.%5D56%3A8-163+Disclosure+of+breach+of+security+to+customers.&xhitlist_x=advanced&xhitlist_s=relevance-weight&xhitlist_mh=99999&xhitlist_d=&xhitlist_hc=%5BXML%5D%5BKwic%2C25%5D&xhitlist_xsl=xhitlist.xsl&xhitlist_vpc=first&xhitlist_vps=20&xhitlist_sel=title%3Bpath%3Brelevance-weight%3Bcontent-type%3Bhome-title%3Bitem-bookmark%3Btitle-path%3Bhit-context&vid=Publish%3A10.1048%2FEnu";
const NEW_MEXICO_SOURCE: string =
  "https://www.nmonesource.com/nmos/nmsa/en/4423/1/document.do";
const NORTH_CAROLINA_SOURCE: string =
  "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_75/GS_75-65.html";
const NORTH_DAKOTA_SOURCE: string =
  "https://www.ndlegis.gov/cencode/t51c30.pdf";
const OHIO_SOURCE: string =
  "https://codes.ohio.gov/ohio-revised-code/section-1349.19";
const OKLAHOMA_SOURCE: string =
  "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os24.pdf";
const OREGON_SOURCE: string =
  "https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html";
const PENNSYLVANIA_SOURCE: string =
  "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?txtType=HTM&SessYr=2005&ActNum=0094.&SessInd=0";
const RHODE_ISLAND_SOURCE: string =
  "https://webserver.rilegislature.gov/Statutes/TITLE11/11-49.3/11-49.3-4.htm";
const SOUTH_CAROLINA_SOURCE: string =
  "https://www.scstatehouse.gov/code/t39c001.php";
const SOUTH_DAKOTA_SOURCE: string = "https://sdlegislature.gov/Statutes/22-40";
// The code is published only by a vendor: the legislature's copy of the act that replaced the section.
const TENNESSEE_SOURCE: string =
  "https://capitol.tn.gov/Bills/110/Bill/SB0547.pdf";
const UTAH_SOURCE: string =
  "https://le.utah.gov/xcode/Title13/Chapter44/C13-44-S202_2024050120240501.html";
const VERMONT_SOURCE: string =
  "https://legislature.vermont.gov/statutes/section/09/062/02435";
const VIRGINIA_SOURCE: string =
  "https://law.lis.virginia.gov/vacode/title18.2/chapter6/section18.2-186.6/";
const WISCONSIN_SOURCE: string =
  "https://docs.legis.wisconsin.gov/statutes/statutes/134/98";
const WYOMING_SOURCE: string =
  "https://wyoleg.gov/statutes/compress/title40.pdf";
/*
 * Colorado's and Texas's statutes, as #10952 read them for the agencies'
 * notices: the rows #10377 took from the attorneys general's guidance agree
 * with them, and keep their sources.
 */
const COLORADO_STATUTE_SOURCE: string =
  "https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-06.pdf";
const TEXAS_STATUTE_SOURCE: string =
  "https://tcss.legis.texas.gov/resources/BC/htm/BC.521.htm";
// Alabama's third-party agent's notice (#11427) is a section of its own, on the same site.
const ALABAMA_THIRD_PARTY_AGENT_SOURCE: string =
  "https://alison.legislature.state.al.us/code-of-alabama?section=8-38-8";
/*
 * Puerto Rico (#11424). The Laws of Puerto Rico Annotated are published
 * only by a vendor, and the Oficina de Gerencia y Presupuesto's library
 * refused every connection, so the law is read from the Legislative
 * Assembly's own copies, in Spanish, its official text, on the Sistema
 * Único de Trámite Legislativo: the act (Ley Núm. 111 de 7 de septiembre de
 * 2005) and the act that amended it (Ley Núm. 97 de 19 de junio de 2008),
 * the only amendment the Assembly's records and the OGP's compilation
 * (revised 15 April 2024) list.
 */
const PUERTO_RICO_ACT_111_SOURCE: string =
  "https://sutra.oslpr.org/SutraFiles/anejos_conv/od/files/docs/%7BDC284477-FFA1-457B-880E-14B9444D80F2%7D.doc";
const PUERTO_RICO_ACT_97_SOURCE: string =
  "https://sutra.oslpr.org/SutraFiles/anejos_conv/od/files/docs/%7BD055CA3B-83AB-4F82-89FA-E9E802705CD9%7D.doc";
/*
 * Guam (#11426): 9 GCA Chapter 48 as the Judiciary of Guam's Compiler of
 * Laws publishes it; Title 9's contents, updated through P.L. 38-136
 * (28 August 2026), still list the chapter as P.L. 30-004 enacted it.
 */
const GUAM_SOURCE: string =
  "https://col.guamcourts.gov/sites/default/files/9gc048.pdf";
/*
 * The US Virgin Islands (#11426). The Virgin Islands Code is published
 * only by a vendor, so it is read from the Legislature's own copy of the
 * act that enacted it, Act No. 6789 of 2005 (Bill No. 26-0091), approved
 * on 17 October 2005: a scan, read page by page. The Legislature's bill
 * records list no later act amending 14 V.I.C. § 2209.
 */
const US_VIRGIN_ISLANDS_SOURCE: string =
  "https://billtracking.legvi.org/pdf/?file_name=RTpcaW5ldHB1Ylx3d3dyb290XEJpbGxUcmFja2luZzIwMnhCYWNrZW5kXEJpbGxUcmFja2luZ1BERlxBY3RcNjc4OS5wZGY=";

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

// "government-issued identification number" covers a taxpayer identification number too (GENERIC_GOVERNMENT_IDS).
const TEXAS_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
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

// The numbers the shortest of the states' lists name: a Social Security number, a driver's license, an account.
const US_STATE_CORE: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.SocialSecurityNumber,
  BreachDataElement.DriversLicense,
  BreachDataElement.FinancialAccount,
];

/*
 * A statute that covers government ID numbers in general words - "other
 * government identification number" (New Hampshire), "government-issued
 * identification number" (New Mexico), "other unique identification number
 * created or collected by a government body" (Iowa, Missouri, South
 * Dakota; "entity", Oklahoma), "numbers or information issued by a
 * governmental or regulatory entity that uniquely will identify an
 * individual" (South Carolina): by its terms a passport number and a
 * taxpayer identification number too, though it names neither.
 */
const GENERIC_GOVERNMENT_IDS: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.PassportNumber,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
];

const ALABAMA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

const ARIZONA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

const ARKANSAS_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.MedicalInformation,
  BreachDataElement.Biometric,
  // A DNA profile is among its biometric data.
  BreachDataElement.Genetic,
];

const CONNECTICUT_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.Geolocation,
  BreachDataElement.OnlineCredentials,
];

const DELAWARE_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  // A DNA profile is in its medical information.
  BreachDataElement.Genetic,
  BreachDataElement.OnlineCredentials,
];

const DISTRICT_OF_COLUMBIA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.Genetic,
  BreachDataElement.OnlineCredentials,
];

const ILLINOIS_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

const IOWA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
  BreachDataElement.Biometric,
];

const LOUISIANA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.PassportNumber,
  BreachDataElement.Biometric,
];

const MARYLAND_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
  BreachDataElement.Biometric,
  BreachDataElement.Genetic,
  BreachDataElement.OnlineCredentials,
];

const MISSISSIPPI_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.OtherGovernmentId,
];

const MISSOURI_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
  ...HEALTH_DATA,
];

const MONTANA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.MedicalInformation,
];

const NEBRASKA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

const NEVADA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.HealthInsurance,
  BreachDataElement.OnlineCredentials,
];

const NEW_HAMPSHIRE_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
];

const NEW_JERSEY_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.OnlineCredentials,
];

const NEW_MEXICO_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
  BreachDataElement.Biometric,
];

const NORTH_CAROLINA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.FinancialAccount,
  BreachDataElement.Biometric,
  BreachDataElement.OnlineCredentials,
];

const NORTH_DAKOTA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.DateOfBirth,
  ...HEALTH_DATA,
];

const OKLAHOMA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
  BreachDataElement.Biometric,
];

// "passport number or other identification number issued by the United States": the IRS's taxpayer numbers too.
const OREGON_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  BreachDataElement.Biometric,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

// Medical information counts only in a state agency's hands: a business's is health insurance alone.
const PENNSYLVANIA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.HealthInsurance,
  BreachDataElement.OnlineCredentials,
];

const RHODE_ISLAND_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.OtherGovernmentId,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

const SOUTH_CAROLINA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
];

const SOUTH_DAKOTA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  ...GENERIC_GOVERNMENT_IDS,
  BreachDataElement.MedicalInformation,
  BreachDataElement.OnlineCredentials,
];

const VERMONT_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  BreachDataElement.Biometric,
  BreachDataElement.Genetic,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

// Medical information counts only in a public body's hands, under a law of its own.
const VIRGINIA_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
];

const WISCONSIN_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.Genetic,
  BreachDataElement.Biometric,
];

const WYOMING_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  BreachDataElement.Biometric,
  ...HEALTH_DATA,
  BreachDataElement.OnlineCredentials,
];

/*
 * Puerto Rico's personal information file (Ley 111-2005, Article 2(a)): a
 * Social Security number; a driver's license, voter card "u otra
 * Identificación Oficial" number, which a passport's is; a bank or
 * financial account number, with or without its codes; a user name with its
 * password; medical information HIPAA protects, as HIPAA's rows read it;
 * "información contributiva", which a taxpayer number is; and employment
 * evaluations, which no data type of the catalog is.
 */
const PUERTO_RICO_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_IDS,
  BreachDataElement.TaxIdNumber,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.FinancialAccount,
  ...HEALTH_DATA,
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

// The other US states' shared words (#10952).
const EACH_STATE_RESIDENT: string = translationKey(
  "Each affected resident of the state",
);
const THE_STATE_ATTORNEY_GENERAL: string = translationKey(
  "The state's attorney general",
);
const WITHIN_THE_DAYS_OF_DISCOVERY: string = translationKey(
  "Without unreasonable delay, and no later than that after the breach was discovered.",
);
const KEEP_THE_DETERMINATION_FIVE_YEARS: string = translationKey(
  "Keep the written determination, and what supports it, for five years: the attorney general may ask for a copy, due within 30 days of the request.",
);
const NOT_FOR_GLBA_OR_HIPAA: string = translationKey(
  "The law does not apply to an organization subject to the Gramm-Leach-Bliley Act or HIPAA.",
);
const WISCONSIN_EXEMPTIONS: string = translationKey(
  "Not owed by an organization that complies with the Gramm-Leach-Bliley Act's privacy and security rules and has a breach policy, or by a HIPAA covered entity that complies with HIPAA's privacy and security rules.",
);
const BEFORE_THE_PEOPLE_ARE_TOLD: string = translationKey(
  "Before the people are told.",
);
// The consumer reporting agencies' notices (#10952).
const TELL_THE_CONSUMER_REPORTING_AGENCIES: string = translationKey(
  "Tell the consumer reporting agencies",
);
const THE_CONSUMER_REPORTING_AGENCIES: string = translationKey(
  "The nationwide consumer reporting agencies, with the notices' timing, distribution and content",
);
const NOT_FOR_GLBA: string = translationKey(
  "Not owed by an organization subject to the Gramm-Leach-Bliley Act.",
);
const AFTER_THE_PEOPLE_ARE_TOLD: string = translationKey(
  "After the people are told.",
);
const WITHOUT_DELAYING_THE_PEOPLE: string = translationKey(
  "Without delaying the notice to the people, with its timing, content and distribution.",
);
const IN_THE_MOST_EXPEDIENT_TIME_WITHIN: string = translationKey(
  "In the most expedient time possible, and within that time after the breach was discovered.",
);
// Vermont's notices, in its text until 1 January 2027 and in its text from then (#11425).
const VERMONT_ATTORNEY_GENERAL: string = translationKey(
  "The Vermont Attorney General or, for an organization the Department of Financial Regulation regulates, the Department",
);
const VERMONT_PRELIMINARY_DESCRIPTION: string = translationKey(
  "First a preliminary description, sooner if the people are told sooner; then the number of residents told and a copy of their notice, when they are told.",
);
const VERMONT_SWORN_STATEMENT: string = translationKey(
  "An organization that swore its security policies to the attorney general before the breach sends the preliminary description before the people are told instead.",
);
const VERMONT_NOT_FOR_TITLE_8_LICENSEES: string = translationKey(
  "Not owed by a person the Department of Financial Regulation licenses or registers under Title 8.",
);
const VERMONT_NAME_NOT_NEEDED: string = translationKey(
  "Without a name, the data the law lists counts where it is enough to attempt identity theft against the person.",
);
// The notices to the data's owner (#11427).
const THE_CONTROLLER: string = translationKey(
  "The controller you process the data for",
);
const AFTER_BECOMING_AWARE: string = translationKey(
  "Counted from when you became aware of the breach.",
);
const TELL_THE_DATA_OWNER: string = translationKey("Tell the data's owner");
const THE_DATA_OWNER: string = translationKey(
  "The organization that owns the data, or licensed it to you",
);
const AS_SOON_AS_PRACTICABLE_WITHIN: string = translationKey(
  "As soon as practicable, and no later than that after the breach was discovered.",
);
const AFTER_DISCOVERY_NO_TIME: string = translationKey(
  "After the breach is discovered: the law sets no time for it.",
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
  /*
   * ---- A processor's notice to its controller (#11427) ----
   *
   * GDPR's and UK GDPR's Article 33(2), word for word the same: "The
   * processor shall notify the controller without undue delay after
   * becoming aware of a personal data breach." GDPR's was read from the
   * Official Journal text the Publications Office serves (EUR-Lex refused
   * automated readers), UK GDPR's from legislation.gov.uk. No risk test:
   * the controller weighs the risk, the processor tells it either way.
   */
  {
    id: BreachLawId.GdprProcessor,
    family: BreachLawFamily.Gdpr,
    law: "GDPR",
    provision: "Article 33(2)",
    places: [BreachPlace.Eea],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: translationKey("Notify the controller"),
    recipient: THE_CONTROLLER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUndueDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AFTER_BECOMING_AWARE,
    sourceUrl: GDPR_SOURCE,
    sourceTitle: "Regulation (EU) 2016/679, Article 33(2)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.UkGdprProcessor,
    family: BreachLawFamily.UkGdpr,
    law: "UK GDPR",
    provision: "Article 33(2)",
    places: [BreachPlace.UnitedKingdom],
    dataElements: [BreachDataElement.PersonalData],
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: translationKey("Notify the controller"),
    recipient: THE_CONTROLLER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUndueDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AFTER_BECOMING_AWARE,
    sourceUrl: "https://www.legislation.gov.uk/eur/2016/679/article/33",
    sourceTitle: "UK GDPR, Article 33(2)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
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
    recipient: translationKey(
      "Each person whose health information was exposed",
    ),
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
    // A business associate holds the health information for the covered entity (#11427).
    forDataHolders: true,
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
  {
    id: BreachLawId.ColoradoConsumerReportingAgencies,
    family: BreachLawFamily.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716(2)(d)",
    places: [BreachPlace.Colorado],
    dataElements: COLORADO_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.OnlineCredentials,
      BreachDataElement.FinancialAccount,
    ],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: translationKey(
      "The nationwide consumer reporting agencies, with when the residents will be told and about how many",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA,
    sourceUrl: COLORADO_STATUTE_SOURCE,
    sourceTitle: "Colorado Revised Statutes 2024, 6-1-716(2)(d)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
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
  {
    id: BreachLawId.FloridaConsumerReportingAgencies,
    family: BreachLawFamily.Florida,
    law: "Florida Statutes",
    provision: "501.171(5)",
    places: [BreachPlace.Florida],
    dataElements: FLORIDA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFinancialHarm],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: FLORIDA_HTTPS_SOURCE,
    sourceTitle: "Florida Statutes 501.171(5)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
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
    deadlineNote: IN_THE_MOST_EXPEDIENT_TIME_WITHIN,
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
    deadlineNote: WITHOUT_DELAYING_THE_PEOPLE,
    sourceUrl: NEW_YORK_SOURCE,
    sourceTitle: "New York General Business Law 899-aa(8)(a)",
    checkedOn: BREACH_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewYorkConsumerReportingAgencies,
    family: BreachLawFamily.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(8)(b)",
    places: [BreachPlace.NewYork],
    dataElements: NEW_YORK_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 5000, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.NewYorkResidents,
    },
    deadlineNote: WITHOUT_DELAYING_THE_PEOPLE,
    sourceUrl: NEW_YORK_SOURCE,
    sourceTitle: "New York General Business Law 899-aa(8)(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
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
  {
    id: BreachLawId.TexasConsumerReportingAgencies,
    family: BreachLawFamily.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053(h)",
    places: [BreachPlace.Texas],
    dataElements: TEXAS_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.MedicalInformation,
      BreachDataElement.HealthInsurance,
    ],
    minimumPeople: { count: 10000, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: TEXAS_STATUTE_SOURCE,
    sourceTitle: "Texas Business and Commerce Code 521.053(h)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
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
  /*
   * ---- The other US states (#10952) ----
   *
   * Each from its statute's own text, read on US_STATE_LAWS_CHECKED_ON: the
   * notice to the residents and, where the statute asks it of a business,
   * the one to the attorney general or another state office, and the one to
   * the consumer reporting agencies, each after its state's other rows. A
   * notice the statute asks only of a state's own agencies is left out.
   * Where a statute says "days" without saying which, they are counted as
   * calendar days, the longer reading never assumed.
   */
  // ---- Alabama (Code of Alabama 1975, 8-38-5 and 8-38-6) ----
  {
    id: BreachLawId.AlabamaResidents,
    family: BreachLawFamily.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-5",
    places: [BreachPlace.Alabama],
    dataElements: ALABAMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: ALABAMA_RESIDENTS_SOURCE,
    sourceTitle: "Code of Alabama 1975, 8-38-5 (Act 2018-396)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.AlabamaAttorneyGeneral,
    family: BreachLawFamily.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-6",
    places: [BreachPlace.Alabama],
    dataElements: ALABAMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: ALABAMA_ATTORNEY_GENERAL_SOURCE,
    sourceTitle: "Code of Alabama 1975, 8-38-6 (Act 2018-396)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.AlabamaConsumerReportingAgencies,
    family: BreachLawFamily.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-7",
    places: [BreachPlace.Alabama],
    dataElements: ALABAMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialHarm],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl:
      "https://alison.legislature.state.al.us/code-of-alabama?section=8-38-7",
    sourceTitle: "Code of Alabama 1975, 8-38-7 (Act 2018-396)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Alaska (Alaska Statutes 45.48.010) ----
  {
    id: BreachLawId.AlaskaResidents,
    family: BreachLawFamily.Alaska,
    law: "Alaska Statutes",
    provision: "45.48.010",
    places: [BreachPlace.Alaska],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "To rely on harm not being likely, tell the attorney general in writing first, and keep the determination in writing for five years.",
    ),
    sourceUrl: ALASKA_SOURCE,
    sourceTitle: "Alaska Statutes 45.48.010(a) and (c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.AlaskaConsumerReportingAgencies,
    family: BreachLawFamily.Alaska,
    law: "Alaska Statutes",
    provision: "45.48.040",
    places: [BreachPlace.Alaska],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA,
    sourceUrl: ALASKA_SOURCE,
    sourceTitle: "Alaska Statutes 45.48.040(a) and (c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Arizona (Arizona Revised Statutes 18-552) ----
  {
    id: BreachLawId.ArizonaResidents,
    family: BreachLawFamily.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(1)",
    places: [BreachPlace.Arizona],
    dataElements: ARIZONA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.SubstantialEconomicLoss],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: ARIZONA_SOURCE,
    sourceTitle: "Arizona Revised Statutes 18-552(B)(1) and (J)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.ArizonaAttorneyGeneral,
    family: BreachLawFamily.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(2)",
    places: [BreachPlace.Arizona],
    dataElements: ARIZONA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialEconomicLoss],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Arizona Attorney General and the Director of the Arizona Department of Homeland Security, in writing",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: ARIZONA_SOURCE,
    sourceTitle: "Arizona Revised Statutes 18-552(B)(2)(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.ArizonaConsumerReportingAgencies,
    family: BreachLawFamily.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(B)(2)(a)",
    places: [BreachPlace.Arizona],
    dataElements: ARIZONA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialEconomicLoss],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: translationKey(
      "The three largest nationwide consumer reporting agencies",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    sourceUrl: ARIZONA_SOURCE,
    sourceTitle: "Arizona Revised Statutes 18-552(B)(2)(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Arkansas (Arkansas Code 4-110-105) ----
  {
    id: BreachLawId.ArkansasResidents,
    family: BreachLawFamily.Arkansas,
    law: "Arkansas Code",
    provision: "4-110-105(a)",
    places: [BreachPlace.Arkansas],
    dataElements: ARKANSAS_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: KEEP_THE_DETERMINATION_FIVE_YEARS,
    sourceUrl: ARKANSAS_ACT_1526_SOURCE,
    sourceTitle:
      "Arkansas Code 4-110-105(a) and (d), as Act 1526 of 2005 enacted them; 4-110-103(7) as Act 1030 of 2019 amended it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.ArkansasAttorneyGeneral,
    family: BreachLawFamily.Arkansas,
    law: "Arkansas Code",
    provision: "4-110-105(b)(2)",
    places: [BreachPlace.Arkansas],
    dataElements: ARKANSAS_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "When the people are told, or within 45 days of determining harm is reasonably likely, whichever comes first.",
    ),
    note: translationKey(
      "The statute sets this notice beside the duty of a business that keeps data for its owner, and counts the individuals affected: read it with counsel.",
    ),
    sourceUrl: ARKANSAS_ACT_1030_SOURCE,
    sourceTitle: "Arkansas Code 4-110-105(b)(2), as Act 1030 of 2019 added it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Connecticut (General Statutes of Connecticut 36a-701b) ----
  {
    id: BreachLawId.ConnecticutResidents,
    family: BreachLawFamily.Connecticut,
    law: "General Statutes of Connecticut",
    provision: "36a-701b(b)(1)",
    places: [BreachPlace.Connecticut],
    dataElements: CONNECTICUT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    note: translationKey(
      "Where Social Security or taxpayer identification numbers were breached, offer identity theft prevention services at no cost for at least two years.",
    ),
    sourceUrl: CONNECTICUT_SOURCE,
    sourceTitle: "General Statutes of Connecticut 36a-701b(b)(1) and (2)(B)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.ConnecticutAttorneyGeneral,
    family: BreachLawFamily.Connecticut,
    law: "General Statutes of Connecticut",
    provision: "36a-701b(b)(2)(A)",
    places: [BreachPlace.Connecticut],
    dataElements: CONNECTICUT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.ConnecticutResidents,
    },
    sourceUrl: CONNECTICUT_SOURCE,
    sourceTitle: "General Statutes of Connecticut 36a-701b(b)(2)(A)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Delaware (Delaware Code, Title 6, 12B-102) ----
  {
    id: BreachLawId.DelawareResidents,
    family: BreachLawFamily.Delaware,
    law: "Delaware Code, Title 6",
    provision: "12B-102(a)",
    places: [BreachPlace.Delaware],
    dataElements: DELAWARE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: US_STATE_DETERMINATION_NOTE,
    note: translationKey(
      "Where Social Security numbers were breached, offer credit monitoring at no cost for one year.",
    ),
    sourceUrl: DELAWARE_SOURCE,
    sourceTitle:
      "Delaware Code, Title 6, 12B-102(a), (c) and (e), as 85 Del. Laws c. 464 amended them",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.DelawareAttorneyGeneral,
    family: BreachLawFamily.Delaware,
    law: "Delaware Code, Title 6",
    provision: "12B-102(d)",
    places: [BreachPlace.Delaware],
    dataElements: DELAWARE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.DelawareResidents,
    },
    sourceUrl: DELAWARE_SOURCE,
    sourceTitle: "Delaware Code, Title 6, 12B-102(d)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- The District of Columbia (D.C. Code 28-3852) ----
  {
    id: BreachLawId.DistrictOfColumbiaResidents,
    family: BreachLawFamily.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(a)",
    places: [BreachPlace.DistrictOfColumbia],
    dataElements: DISTRICT_OF_COLUMBIA_ELEMENTS,
    // A name, or any other personal identifier, or numbers enough for identity theft on their own.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected District of Columbia resident"),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Where Social Security or taxpayer identification numbers were released, offer identity theft protection at no cost for at least 18 months.",
    ),
    sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE,
    sourceTitle:
      "D.C. Code 28-3852(a), 28-3851(1)(B)(iii) and 28-3852.02 (D.C. Law 23-98)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.DistrictOfColumbiaAttorneyGeneral,
    family: BreachLawFamily.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(b-1)",
    places: [BreachPlace.DistrictOfColumbia],
    dataElements: DISTRICT_OF_COLUMBIA_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 50, isMoreThan: false },
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    action: translationKey("Tell the District's attorney general"),
    recipient: translationKey(
      "The Office of the Attorney General for the District of Columbia, in writing",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.DistrictOfColumbiaResidents,
    },
    deadlineNote: translationKey(
      "Promptly, and not delayed because the number of residents affected is not yet known.",
    ),
    sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE,
    sourceTitle: "D.C. Code 28-3852(b-1) and (b-2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.DistrictOfColumbiaConsumerReportingAgencies,
    family: BreachLawFamily.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(c)",
    places: [BreachPlace.DistrictOfColumbia],
    dataElements: DISTRICT_OF_COLUMBIA_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA,
    sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE,
    sourceTitle: "D.C. Code 28-3852(c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Georgia (Official Code of Georgia 10-1-912) ----
  {
    id: BreachLawId.GeorgiaResidents,
    family: BreachLawFamily.Georgia,
    law: "Official Code of Georgia",
    provision: "10-1-912(a)",
    places: [BreachPlace.Georgia],
    dataElements: US_STATE_CORE,
    // Without a name too, where the numbers would be enough for identity theft.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.InformationBrokerOrAgency],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: GEORGIA_SOURCE,
    sourceTitle:
      "Official Code of Georgia 10-1-911 and 10-1-912(a), as 2007 SB 236 (Act 241) restates them",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.GeorgiaConsumerReportingAgencies,
    family: BreachLawFamily.Georgia,
    law: "Official Code of Georgia",
    provision: "10-1-912(d)",
    places: [BreachPlace.Georgia],
    dataElements: US_STATE_CORE,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 10000, isMoreThan: true },
    conditions: [BreachCondition.InformationBrokerOrAgency],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: GEORGIA_SOURCE,
    sourceTitle:
      "Official Code of Georgia 10-1-912(d), as 2007 SB 236 (Act 241) restates it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Hawaii (Hawaii Revised Statutes 487N-2) ----
  {
    id: BreachLawId.HawaiiResidents,
    family: BreachLawFamily.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(a)",
    places: [BreachPlace.Hawaii],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyIllegalUse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: HAWAII_SOURCE,
    sourceTitle: "Hawaii Revised Statutes 487N-1 and 487N-2(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HawaiiConsumerProtection,
    family: BreachLawFamily.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(f)",
    places: [BreachPlace.Hawaii],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyIllegalUse],
    action: translationKey("Notify the Office of Consumer Protection"),
    recipient: translationKey(
      "The State of Hawaii's Office of Consumer Protection, in writing, with the notice's timing, distribution and content",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: HAWAII_SOURCE,
    sourceTitle: "Hawaii Revised Statutes 487N-2(f)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.HawaiiConsumerReportingAgencies,
    family: BreachLawFamily.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(f)",
    places: [BreachPlace.Hawaii],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyIllegalUse],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: HAWAII_SOURCE,
    sourceTitle: "Hawaii Revised Statutes 487N-2(f)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Idaho (Idaho Code 28-51-105) ----
  {
    id: BreachLawId.IdahoResidents,
    family: BreachLawFamily.Idaho,
    law: "Idaho Code",
    provision: "28-51-105(1)",
    places: [BreachPlace.Idaho],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: IDAHO_SOURCE,
    sourceTitle: "Idaho Code 28-51-104 and 28-51-105(1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Illinois (Personal Information Protection Act, 815 ILCS 530/10) ----
  {
    id: BreachLawId.IllinoisResidents,
    family: BreachLawFamily.Illinois,
    law: "815 ILCS 530",
    provision: "10(a)",
    places: [BreachPlace.Illinois],
    dataElements: ILLINOIS_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: ILLINOIS_SOURCE,
    sourceTitle:
      "Personal Information Protection Act, 815 ILCS 530/5 and 530/10(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.IllinoisAttorneyGeneral,
    family: BreachLawFamily.Illinois,
    law: "815 ILCS 530",
    provision: "10(e)(2)",
    places: [BreachPlace.Illinois],
    dataElements: ILLINOIS_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.IllinoisResidents,
    },
    note: translationKey(
      "A HIPAA covered entity or business associate tells the attorney general instead within five business days of telling the Secretary of Health and Human Services.",
    ),
    sourceUrl: ILLINOIS_SOURCE,
    sourceTitle:
      "Personal Information Protection Act, 815 ILCS 530/10(e) and 530/50",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Indiana (Indiana Code 24-4.9-3) ----
  {
    id: BreachLawId.IndianaResidents,
    family: BreachLawFamily.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(a)",
    places: [BreachPlace.Indiana],
    dataElements: US_STATE_CORE,
    needsName: true,
    // A Social Security number counts without a name.
    nameFreeElements: [BreachDataElement.SocialSecurityNumber],
    conditions: [BreachCondition.IdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    sourceUrl: INDIANA_SOURCE,
    sourceTitle:
      "Indiana Code 24-4.9-3-1(a) and 24-4.9-3-3 (Indiana Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.IndianaAttorneyGeneral,
    family: BreachLawFamily.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(c)",
    places: [BreachPlace.Indiana],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [BreachDataElement.SocialSecurityNumber],
    conditions: [BreachCondition.IdentityTheftOrFraud],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    sourceUrl: INDIANA_SOURCE,
    sourceTitle:
      "Indiana Code 24-4.9-3-1(c) and 24-4.9-3-3 (Indiana Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.IndianaConsumerReportingAgencies,
    family: BreachLawFamily.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-1(b)",
    places: [BreachPlace.Indiana],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [BreachDataElement.SocialSecurityNumber],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraud],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    sourceUrl: INDIANA_SOURCE,
    sourceTitle:
      "Indiana Code 24-4.9-3-1(b) and 24-4.9-3-3 (Indiana Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Iowa (Iowa Code 715C.2) ----
  {
    id: BreachLawId.IowaResidents,
    family: BreachLawFamily.Iowa,
    law: "Iowa Code",
    provision: "715C.2(1)",
    places: [BreachPlace.Iowa],
    dataElements: IOWA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.FinancialHarmInWriting],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: IOWA_SOURCE,
    sourceTitle: "Iowa Code 715C.1 and 715C.2(1) and (6) (Iowa Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.IowaAttorneyGeneral,
    family: BreachLawFamily.Iowa,
    law: "Iowa Code",
    provision: "715C.2(8)",
    places: [BreachPlace.Iowa],
    dataElements: IOWA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.FinancialHarmInWriting],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The director of the consumer protection division of the Iowa Attorney General's office, in writing",
    ),
    deadline: {
      unit: BreachDeadlineUnit.BusinessDays,
      amount: 5,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.IowaResidents,
    },
    sourceUrl: IOWA_SOURCE,
    sourceTitle: "Iowa Code 715C.2(8) (Iowa Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Kansas (Kansas Statutes 50-7a02) ----
  {
    id: BreachLawId.KansasResidents,
    family: BreachLawFamily.Kansas,
    law: "Kansas Statutes Annotated",
    provision: "50-7a02(a)",
    places: [BreachPlace.Kansas],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: KANSAS_SOURCE,
    sourceTitle: "Kansas Statutes Annotated 50-7a01 and 50-7a02(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.KansasConsumerReportingAgencies,
    family: BreachLawFamily.Kansas,
    law: "Kansas Statutes Annotated",
    provision: "50-7a02(f)",
    places: [BreachPlace.Kansas],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: KANSAS_SOURCE,
    sourceTitle: "Kansas Statutes Annotated 50-7a02(f)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Kentucky (Kentucky Revised Statutes 365.732) ----
  {
    id: BreachLawId.KentuckyResidents,
    family: BreachLawFamily.Kentucky,
    law: "Kentucky Revised Statutes",
    provision: "365.732(2)",
    places: [BreachPlace.Kentucky],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: KENTUCKY_SOURCE,
    sourceTitle: "Kentucky Revised Statutes 365.732(1) and (2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.KentuckyConsumerReportingAgencies,
    family: BreachLawFamily.Kentucky,
    law: "Kentucky Revised Statutes",
    provision: "365.732(7)",
    places: [BreachPlace.Kentucky],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: KENTUCKY_SOURCE,
    sourceTitle: "Kentucky Revised Statutes 365.732(7)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Louisiana (Louisiana Revised Statutes 51:3074, and the attorney general's rule) ----
  {
    id: BreachLawId.LouisianaResidents,
    family: BreachLawFamily.Louisiana,
    law: "Louisiana Revised Statutes",
    provision: "51:3074",
    places: [BreachPlace.Louisiana],
    dataElements: LOUISIANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "To delay it, tell the attorney general why in writing within the 60 days.",
    ),
    note: KEEP_THE_DETERMINATION_FIVE_YEARS,
    sourceUrl: LOUISIANA_SOURCE,
    sourceTitle:
      "Louisiana Revised Statutes 51:3073 and 51:3074(C), (E) and (I)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.LouisianaAttorneyGeneral,
    family: BreachLawFamily.Louisiana,
    law: "Louisiana Administrative Code",
    provision: "16:III.701",
    places: [BreachPlace.Louisiana],
    dataElements: LOUISIANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Consumer Protection Section of the Louisiana Attorney General's office, in writing",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.LouisianaResidents,
    },
    note: translationKey(
      "The attorney general's rule asks for this notice, with the names of the Louisiana residents affected.",
    ),
    sourceUrl: LOUISIANA_RULE_SOURCE,
    sourceTitle:
      "Louisiana Administrative Code 16:III.701, the attorney general's rule under Louisiana Revised Statutes 51:3077",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Maine (Maine Revised Statutes, Title 10, 1348) ----
  {
    id: BreachLawId.MaineResidents,
    family: BreachLawFamily.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(1)",
    places: [BreachPlace.Maine],
    dataElements: US_STATE_CORE,
    // Without a name too, where the numbers would let someone assume the person's identity.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.PossibleMisuse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "The law counts from when you know of the breach and its scope; this counts from when it was found, the earlier of the two.",
    ),
    sourceUrl: MAINE_SOURCE,
    sourceTitle: "Maine Revised Statutes, Title 10, 1347 and 1348(1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MaineAttorneyGeneral,
    family: BreachLawFamily.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(5)",
    places: [BreachPlace.Maine],
    dataElements: US_STATE_CORE,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.PossibleMisuse],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Maine Attorney General or, for an organization the Department of Professional and Financial Regulation regulates, its regulators there",
    ),
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MAINE_SOURCE,
    sourceTitle: "Maine Revised Statutes, Title 10, 1348(5)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MaineConsumerReportingAgencies,
    family: BreachLawFamily.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(4)",
    places: [BreachPlace.Maine],
    dataElements: US_STATE_CORE,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.PossibleMisuse],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MAINE_SOURCE,
    sourceTitle: "Maine Revised Statutes, Title 10, 1348(4)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Maryland (Maryland Code, Commercial Law 14-3504) ----
  {
    id: BreachLawId.MarylandResidents,
    family: BreachLawFamily.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3504(b)",
    places: [BreachPlace.Maryland],
    dataElements: MARYLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Keep the records of a determination not to tell them for three years.",
    ),
    sourceUrl: MARYLAND_SOURCE,
    sourceTitle: "Maryland Code, Commercial Law 14-3501 and 14-3504(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MarylandAttorneyGeneral,
    family: BreachLawFamily.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3504(h)",
    places: [BreachPlace.Maryland],
    dataElements: MARYLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.MarylandResidents,
    },
    deadlineNote: BEFORE_THE_PEOPLE_ARE_TOLD,
    sourceUrl: MARYLAND_SOURCE,
    sourceTitle: "Maryland Code, Commercial Law 14-3504(h)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MarylandConsumerReportingAgencies,
    family: BreachLawFamily.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3506(a)",
    places: [BreachPlace.Maryland],
    dataElements: MARYLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.LikelyMisuse],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl:
      "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-3506&enactments=false",
    sourceTitle: "Maryland Code, Commercial Law 14-3506(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Massachusetts (General Laws of Massachusetts, chapter 93H, section 3) ----
  {
    id: BreachLawId.MassachusettsResidents,
    family: BreachLawFamily.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    places: [BreachPlace.Massachusetts],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Where Social Security numbers were disclosed, offer credit monitoring at no cost for at least 18 months.",
    ),
    sourceUrl: MASSACHUSETTS_SOURCE,
    sourceTitle:
      "General Laws of Massachusetts, chapter 93H, sections 1, 3(b) and 3A",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MassachusettsAttorneyGeneral,
    family: BreachLawFamily.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    places: [BreachPlace.Massachusetts],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Massachusetts Attorney General and the Director of Consumer Affairs and Business Regulation",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MASSACHUSETTS_SOURCE,
    sourceTitle: "General Laws of Massachusetts, chapter 93H, section 3(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MassachusettsConsumerReportingAgencies,
    family: BreachLawFamily.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(b)",
    places: [BreachPlace.Massachusetts],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: translationKey(
      "The consumer reporting agencies and state agencies the Director of Consumer Affairs and Business Regulation names",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "As soon as practicable and without unreasonable delay, once the Director names them.",
    ),
    sourceUrl: MASSACHUSETTS_SOURCE,
    sourceTitle: "General Laws of Massachusetts, chapter 93H, section 3(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Michigan (Michigan Compiled Laws 445.72) ----
  {
    id: BreachLawId.MichiganResidents,
    family: BreachLawFamily.Michigan,
    law: "Michigan Compiled Laws",
    provision: "445.72(1)",
    places: [BreachPlace.Michigan],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MICHIGAN_SOURCE,
    sourceTitle: "Michigan Compiled Laws 445.63 and 445.72(1) and (3)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MichiganConsumerReportingAgencies,
    family: BreachLawFamily.Michigan,
    law: "Michigan Compiled Laws",
    provision: "445.72(8)",
    places: [BreachPlace.Michigan],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AFTER_THE_PEOPLE_ARE_TOLD,
    note: NOT_FOR_GLBA,
    sourceUrl: MICHIGAN_SOURCE,
    sourceTitle: "Michigan Compiled Laws 445.72(8)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Minnesota (Minnesota Statutes 325E.61) ----
  {
    id: BreachLawId.MinnesotaResidents,
    family: BreachLawFamily.Minnesota,
    law: "Minnesota Statutes",
    provision: "325E.61, subdivision 1",
    places: [BreachPlace.Minnesota],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MINNESOTA_SOURCE,
    sourceTitle: "Minnesota Statutes 2026, 325E.61, subdivision 1",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MinnesotaConsumerReportingAgencies,
    family: BreachLawFamily.Minnesota,
    law: "Minnesota Statutes",
    provision: "325E.61, subdivision 2",
    places: [BreachPlace.Minnesota],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 48,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MINNESOTA_SOURCE,
    sourceTitle: "Minnesota Statutes 2026, 325E.61, subdivision 2",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Mississippi (Mississippi Code 75-24-29) ----
  {
    id: BreachLawId.MississippiResidents,
    family: BreachLawFamily.Mississippi,
    law: "Mississippi Code",
    provision: "75-24-29",
    places: [BreachPlace.Mississippi],
    dataElements: MISSISSIPPI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSISSIPPI_SOURCE,
    sourceTitle:
      "Mississippi Code 75-24-29, as 2021 HB 277 (Laws 2021, ch. 378) restates it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Missouri (Revised Statutes of Missouri 407.1500) ----
  {
    id: BreachLawId.MissouriResidents,
    family: BreachLawFamily.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(1)",
    places: [BreachPlace.Missouri],
    dataElements: MISSOURI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSOURI_SOURCE,
    sourceTitle:
      "Revised Statutes of Missouri 407.1500.1 and 407.1500.2(1) and (5)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MissouriAttorneyGeneral,
    family: BreachLawFamily.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(8)",
    places: [BreachPlace.Missouri],
    dataElements: MISSOURI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSOURI_SOURCE,
    sourceTitle: "Revised Statutes of Missouri 407.1500.2(8)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MissouriConsumerReportingAgencies,
    family: BreachLawFamily.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(8)",
    places: [BreachPlace.Missouri],
    dataElements: MISSOURI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSOURI_SOURCE,
    sourceTitle: "Revised Statutes of Missouri 407.1500.2(8)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Montana (Montana Code Annotated 30-14-1704) ----
  {
    id: BreachLawId.MontanaResidents,
    family: BreachLawFamily.Montana,
    law: "Montana Code Annotated",
    provision: "30-14-1704(1)",
    places: [BreachPlace.Montana],
    dataElements: MONTANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "If your notice tells people they can get their credit file from a consumer reporting agency, coordinate its timing, content and distribution with that agency, without delaying the notice.",
    ),
    sourceUrl: MONTANA_SOURCE,
    sourceTitle: "Montana Code Annotated 2025, 30-14-1704(1), (4) and (7)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.MontanaAttorneyGeneral,
    family: BreachLawFamily.Montana,
    law: "Montana Code Annotated",
    provision: "30-14-1704(8)",
    places: [BreachPlace.Montana],
    dataElements: MONTANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Montana Attorney General's consumer protection office, with a copy of the notice and when and how it was sent",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.MontanaResidents,
    },
    sourceUrl: MONTANA_SOURCE,
    sourceTitle: "Montana Code Annotated 2025, 30-14-1704(8)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Nebraska (Nebraska Revised Statutes 87-803) ----
  {
    id: BreachLawId.NebraskaResidents,
    family: BreachLawFamily.Nebraska,
    law: "Nebraska Revised Statutes",
    provision: "87-803(1)",
    places: [BreachPlace.Nebraska],
    dataElements: NEBRASKA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyUnauthorizedUse],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEBRASKA_SOURCE,
    sourceTitle: "Nebraska Revised Statutes 87-802 and 87-803(1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NebraskaAttorneyGeneral,
    family: BreachLawFamily.Nebraska,
    law: "Nebraska Revised Statutes",
    provision: "87-803(2)",
    places: [BreachPlace.Nebraska],
    dataElements: NEBRASKA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.LikelyUnauthorizedUse],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.NebraskaResidents,
    },
    sourceUrl: NEBRASKA_SOURCE,
    sourceTitle: "Nebraska Revised Statutes 87-803(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Nevada (Nevada Revised Statutes 603A.220) ----
  {
    id: BreachLawId.NevadaResidents,
    family: BreachLawFamily.Nevada,
    law: "Nevada Revised Statutes",
    provision: "603A.220",
    places: [BreachPlace.Nevada],
    dataElements: NEVADA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEVADA_SOURCE,
    sourceTitle: "Nevada Revised Statutes 603A.040 and 603A.220",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NevadaConsumerReportingAgencies,
    family: BreachLawFamily.Nevada,
    law: "Nevada Revised Statutes",
    provision: "603A.220(6)",
    places: [BreachPlace.Nevada],
    dataElements: NEVADA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEVADA_SOURCE,
    sourceTitle: "Nevada Revised Statutes 603A.220(6)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- New Hampshire (New Hampshire Revised Statutes 359-C:20) ----
  {
    id: BreachLawId.NewHampshireResidents,
    family: BreachLawFamily.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, I(a)",
    places: [BreachPlace.NewHampshire],
    dataElements: NEW_HAMPSHIRE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseOrUndetermined],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_HAMPSHIRE_SOURCE,
    sourceTitle: "New Hampshire Revised Statutes 359-C:19 and 359-C:20, I(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewHampshireAttorneyGeneral,
    family: BreachLawFamily.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, I(b)",
    places: [BreachPlace.NewHampshire],
    dataElements: NEW_HAMPSHIRE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseOrUndetermined],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The New Hampshire Attorney General's office or, for trade subject to RSA 358-A:3, I, its primary regulator",
    ),
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "With the date the people are expected to be told, so before they are.",
    ),
    sourceUrl: NEW_HAMPSHIRE_SOURCE,
    sourceTitle: "New Hampshire Revised Statutes 359-C:20, I(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewHampshireConsumerReportingAgencies,
    family: BreachLawFamily.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, VI(a)",
    places: [BreachPlace.NewHampshire],
    dataElements: NEW_HAMPSHIRE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseOrUndetermined],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA,
    sourceUrl: NEW_HAMPSHIRE_SOURCE,
    sourceTitle: "New Hampshire Revised Statutes 359-C:20, VI",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- New Jersey (New Jersey Statutes 56:8-163) ----
  {
    id: BreachLawId.NewJerseyResidents,
    family: BreachLawFamily.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(a)",
    places: [BreachPlace.NewJersey],
    dataElements: NEW_JERSEY_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_JERSEY_SOURCE,
    sourceTitle: "New Jersey Statutes 56:8-161 and 56:8-163(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewJerseyStatePolice,
    family: BreachLawFamily.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(c)(1)",
    places: [BreachPlace.NewJersey],
    dataElements: NEW_JERSEY_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    action: translationKey("Report it to the Division of State Police"),
    recipient: translationKey(
      "The New Jersey Division of State Police, in the Department of Law and Public Safety",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.NewJerseyResidents,
    },
    deadlineNote: BEFORE_THE_PEOPLE_ARE_TOLD,
    sourceUrl: NEW_JERSEY_SOURCE,
    sourceTitle: "New Jersey Statutes 56:8-163(c)(1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewJerseyConsumerReportingAgencies,
    family: BreachLawFamily.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(f)",
    places: [BreachPlace.NewJersey],
    dataElements: NEW_JERSEY_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleInWriting],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_JERSEY_SOURCE,
    sourceTitle: "New Jersey Statutes 56:8-163(f)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- New Mexico (New Mexico Statutes 57-12C-6 and 57-12C-10) ----
  {
    id: BreachLawId.NewMexicoResidents,
    family: BreachLawFamily.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-6",
    places: [BreachPlace.NewMexico],
    dataElements: NEW_MEXICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: NEW_MEXICO_SOURCE,
    sourceTitle: "New Mexico Statutes Annotated 1978, 57-12C-2 and 57-12C-6",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewMexicoAttorneyGeneral,
    family: BreachLawFamily.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-10",
    places: [BreachPlace.NewMexico],
    dataElements: NEW_MEXICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The New Mexico Attorney General's office, with the number of residents told and a copy of their notice",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_MEXICO_SOURCE,
    sourceTitle: "New Mexico Statutes Annotated 1978, 57-12C-10",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NewMexicoConsumerReportingAgencies,
    family: BreachLawFamily.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-10",
    places: [BreachPlace.NewMexico],
    dataElements: NEW_MEXICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_MEXICO_SOURCE,
    sourceTitle: "New Mexico Statutes Annotated 1978, 57-12C-10",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- North Carolina (North Carolina General Statutes 75-65) ----
  {
    id: BreachLawId.NorthCarolinaResidents,
    family: BreachLawFamily.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(a)",
    places: [BreachPlace.NorthCarolina],
    dataElements: NORTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_CAROLINA_SOURCE,
    sourceTitle: "North Carolina General Statutes 75-61 and 75-65(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NorthCarolinaAttorneyGeneral,
    family: BreachLawFamily.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(e1)",
    places: [BreachPlace.NorthCarolina],
    dataElements: NORTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Consumer Protection Division of the North Carolina Attorney General's office",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_CAROLINA_SOURCE,
    sourceTitle: "North Carolina General Statutes 75-65(e1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NorthCarolinaConsumerReportingAgencies,
    family: BreachLawFamily.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(f)",
    places: [BreachPlace.NorthCarolina],
    dataElements: NORTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_CAROLINA_SOURCE,
    sourceTitle: "North Carolina General Statutes 75-65(f)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- North Dakota (North Dakota Century Code 51-30-02) ----
  {
    id: BreachLawId.NorthDakotaResidents,
    family: BreachLawFamily.NorthDakota,
    law: "North Dakota Century Code",
    provision: "51-30-02",
    places: [BreachPlace.NorthDakota],
    dataElements: NORTH_DAKOTA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_DAKOTA_SOURCE,
    sourceTitle: "North Dakota Century Code 51-30-01 and 51-30-02",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.NorthDakotaAttorneyGeneral,
    family: BreachLawFamily.NorthDakota,
    law: "North Dakota Century Code",
    provision: "51-30-02 (attorney general)",
    places: [BreachPlace.NorthDakota],
    dataElements: NORTH_DAKOTA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 250, isMoreThan: true },
    conditions: [],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_DAKOTA_SOURCE,
    sourceTitle: "North Dakota Century Code 51-30-02",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Ohio (Ohio Revised Code 1349.19) ----
  {
    id: BreachLawId.OhioResidents,
    family: BreachLawFamily.Ohio,
    law: "Ohio Revised Code",
    provision: "1349.19(B)(1)",
    places: [BreachPlace.Ohio],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    sourceUrl: OHIO_SOURCE,
    sourceTitle: "Ohio Revised Code 1349.19(A) and (B)(1)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.OhioConsumerReportingAgencies,
    family: BreachLawFamily.Ohio,
    law: "Ohio Revised Code",
    provision: "1349.19(G)",
    places: [BreachPlace.Ohio],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: OHIO_SOURCE,
    sourceTitle: "Ohio Revised Code 1349.19(G)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Oklahoma (Oklahoma Statutes, Title 24, 163, as Laws 2025, c. 406 amended it) ----
  {
    id: BreachLawId.OklahomaResidents,
    family: BreachLawFamily.Oklahoma,
    law: "Oklahoma Statutes, Title 24",
    provision: "163(A)",
    places: [BreachPlace.Oklahoma],
    dataElements: OKLAHOMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: OKLAHOMA_SOURCE,
    sourceTitle:
      "Oklahoma Statutes, Title 24, 162 and 163(A), as Laws 2025, c. 406 (SB 626) amended them",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceFrom: "2026-01-01",
  },
  {
    id: BreachLawId.OklahomaAttorneyGeneral,
    family: BreachLawFamily.Oklahoma,
    law: "Oklahoma Statutes, Title 24",
    provision: "163(E)",
    places: [BreachPlace.Oklahoma],
    dataElements: OKLAHOMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.OklahomaResidents,
    },
    deadlineNote: translationKey(
      "Without unreasonable delay, and no later than that after the people are told.",
    ),
    note: translationKey(
      "A credit bureau tells the attorney general only from 1,000 residents.",
    ),
    sourceUrl: OKLAHOMA_SOURCE,
    sourceTitle:
      "Oklahoma Statutes, Title 24, 163(E), as Laws 2025, c. 406 (SB 626) added it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceFrom: "2026-01-01",
  },
  // ---- Oregon (Oregon Revised Statutes 646A.604) ----
  {
    id: BreachLawId.OregonResidents,
    family: BreachLawFamily.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(1)(a)",
    places: [BreachPlace.Oregon],
    dataElements: OREGON_ELEMENTS,
    // Without a name too, where the data would be enough for identity theft.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.UnlikelyHarmInWriting],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: OREGON_SOURCE,
    sourceTitle:
      "Oregon Revised Statutes 646A.602 and 646A.604(1)(a), (3) and (8)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.OregonAttorneyGeneral,
    family: BreachLawFamily.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(1)(b)",
    places: [BreachPlace.Oregon],
    dataElements: OREGON_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 250, isMoreThan: true },
    conditions: [BreachCondition.UnlikelyHarmInWriting],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: OREGON_SOURCE,
    sourceTitle: "Oregon Revised Statutes 646A.604(1)(b) and (3)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.OregonConsumerReportingAgencies,
    family: BreachLawFamily.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(6)",
    places: [BreachPlace.Oregon],
    dataElements: OREGON_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHOUT_DELAYING_THE_PEOPLE,
    sourceUrl: OREGON_SOURCE,
    sourceTitle: "Oregon Revised Statutes 646A.604(6)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Pennsylvania (Breach of Personal Information Notification Act, 73 P.S. 2301 et seq.) ----
  {
    id: BreachLawId.PennsylvaniaResidents,
    family: BreachLawFamily.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 3(a)",
    places: [BreachPlace.Pennsylvania],
    dataElements: PENNSYLVANIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "Where Social Security, bank account or driver's license numbers were accessed with names, offer a free credit report and 12 months of credit monitoring.",
    ),
    sourceUrl: PENNSYLVANIA_SOURCE,
    sourceTitle:
      "Pennsylvania Breach of Personal Information Notification Act (Act 94 of 2005), Sections 2, 3(a) and 5.4, as amended",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.PennsylvaniaAttorneyGeneral,
    family: BreachLawFamily.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 3(c.1)",
    places: [BreachPlace.Pennsylvania],
    dataElements: PENNSYLVANIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.PennsylvaniaResidents,
    },
    note: translationKey(
      "An organization subject to Pennsylvania's insurance data security law does not owe this notice.",
    ),
    sourceUrl: PENNSYLVANIA_SOURCE,
    sourceTitle:
      "Pennsylvania Breach of Personal Information Notification Act (Act 94 of 2005), Section 3(c.1) and (c.2), as amended",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.PennsylvaniaConsumerReportingAgencies,
    family: BreachLawFamily.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 5",
    places: [BreachPlace.Pennsylvania],
    dataElements: PENNSYLVANIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: PENNSYLVANIA_SOURCE,
    sourceTitle:
      "Pennsylvania Breach of Personal Information Notification Act (Act 94 of 2005), Section 5",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Rhode Island (General Laws of Rhode Island 11-49.3-4) ----
  {
    id: BreachLawId.RhodeIslandResidents,
    family: BreachLawFamily.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)",
    places: [BreachPlace.RhodeIsland],
    dataElements: RHODE_ISLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "The law counts from when you confirm the breach and can say what the notice must; this counts from when it was found, the earlier of the two.",
    ),
    sourceUrl: RHODE_ISLAND_SOURCE,
    sourceTitle: "General Laws of Rhode Island 11-49.3-3 and 11-49.3-4(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.RhodeIslandAttorneyGeneral,
    family: BreachLawFamily.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)(2)(ii)",
    places: [BreachPlace.RhodeIsland],
    dataElements: RHODE_ISLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.RhodeIslandResidents,
    },
    deadlineNote: WITHOUT_DELAYING_THE_PEOPLE,
    sourceUrl: RHODE_ISLAND_SOURCE,
    sourceTitle: "General Laws of Rhode Island 11-49.3-4(a)(2)(ii)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.RhodeIslandConsumerReportingAgencies,
    family: BreachLawFamily.RhodeIsland,
    law: "General Laws of Rhode Island",
    provision: "11-49.3-4(a)(2)(ii)",
    places: [BreachPlace.RhodeIsland],
    dataElements: RHODE_ISLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: true },
    conditions: [BreachCondition.PosesSignificantRiskOfIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 0,
      start: BreachDeadlineStart.PeopleNotified,
      afterRule: BreachLawId.RhodeIslandResidents,
    },
    deadlineNote: WITHOUT_DELAYING_THE_PEOPLE,
    sourceUrl: RHODE_ISLAND_SOURCE,
    sourceTitle: "General Laws of Rhode Island 11-49.3-4(a)(2)(ii)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- South Carolina (Code of Laws of South Carolina 39-1-90) ----
  {
    id: BreachLawId.SouthCarolinaResidents,
    family: BreachLawFamily.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(A)",
    places: [BreachPlace.SouthCarolina],
    dataElements: SOUTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_CAROLINA_SOURCE,
    sourceTitle: "Code of Laws of South Carolina 39-1-90(A) and (D)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.SouthCarolinaConsumerAffairs,
    family: BreachLawFamily.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(K)",
    places: [BreachPlace.SouthCarolina],
    dataElements: SOUTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: translationKey("Notify the Department of Consumer Affairs"),
    recipient: translationKey(
      "The Consumer Protection Division of the South Carolina Department of Consumer Affairs, with the notice's timing, distribution and content",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_CAROLINA_SOURCE,
    sourceTitle: "Code of Laws of South Carolina 39-1-90(K)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.SouthCarolinaConsumerReportingAgencies,
    family: BreachLawFamily.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(K)",
    places: [BreachPlace.SouthCarolina],
    dataElements: SOUTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_CAROLINA_SOURCE,
    sourceTitle: "Code of Laws of South Carolina 39-1-90(K)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- South Dakota (South Dakota Codified Laws 22-40-20) ----
  {
    id: BreachLawId.SouthDakotaResidents,
    family: BreachLawFamily.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-20",
    places: [BreachPlace.SouthDakota],
    dataElements: SOUTH_DAKOTA_ELEMENTS,
    needsName: true,
    // Its "protected information": a login, or an account number with its code, on their own.
    nameFreeElements: [
      BreachDataElement.FinancialAccount,
      BreachDataElement.OnlineCredentials,
    ],
    conditions: [BreachCondition.LikelyHarmAfterTellingAg],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_DAKOTA_SOURCE,
    sourceTitle: "South Dakota Codified Laws 22-40-19 and 22-40-20",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.SouthDakotaAttorneyGeneral,
    family: BreachLawFamily.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-20 (attorney general)",
    places: [BreachPlace.SouthDakota],
    dataElements: SOUTH_DAKOTA_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.FinancialAccount,
      BreachDataElement.OnlineCredentials,
    ],
    minimumPeople: { count: 250, isMoreThan: true },
    // Owed past 250 residents whatever the harm: the attorney general is told before the exception is relied on.
    conditions: [],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_DAKOTA_SOURCE,
    sourceTitle: "South Dakota Codified Laws 22-40-20",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.SouthDakotaConsumerReportingAgencies,
    family: BreachLawFamily.SouthDakota,
    law: "South Dakota Codified Laws",
    provision: "22-40-24",
    places: [BreachPlace.SouthDakota],
    dataElements: SOUTH_DAKOTA_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.FinancialAccount,
      BreachDataElement.OnlineCredentials,
    ],
    conditions: [BreachCondition.LikelyHarmAfterTellingAg],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_DAKOTA_SOURCE,
    sourceTitle: "South Dakota Codified Laws 22-40-24",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Tennessee (Tennessee Code 47-18-2107, as 2017 Public Chapter 91 replaced it) ----
  {
    id: BreachLawId.TennesseeResidents,
    family: BreachLawFamily.Tennessee,
    law: "Tennessee Code Annotated",
    provision: "47-18-2107(b)",
    places: [BreachPlace.Tennessee],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: TENNESSEE_SOURCE,
    sourceTitle:
      "Tennessee Code Annotated 47-18-2107(a) and (b), as 2017 Public Chapter 91 (SB 547, with Senate Amendment 1) replaced the section",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.TennesseeConsumerReportingAgencies,
    family: BreachLawFamily.Tennessee,
    law: "Tennessee Code Annotated",
    provision: "47-18-2107(g)",
    places: [BreachPlace.Tennessee],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: TENNESSEE_SOURCE,
    sourceTitle: "Tennessee Code Annotated 47-18-2107(g)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Utah (Utah Code 13-44-202) ----
  {
    id: BreachLawId.UtahResidents,
    family: BreachLawFamily.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(b)",
    places: [BreachPlace.Utah],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: UTAH_SOURCE,
    sourceTitle: "Utah Code 13-44-102 and 13-44-202(1)(b) and (2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.UtahAttorneyGeneral,
    family: BreachLawFamily.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(c)",
    places: [BreachPlace.Utah],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 500, isMoreThan: false },
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: translationKey(
      "The Utah Attorney General's office and the Utah Cyber Center",
    ),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: UTAH_SOURCE,
    sourceTitle: "Utah Code 13-44-202(1)(c) and (6)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.UtahConsumerReportingAgencies,
    family: BreachLawFamily.Utah,
    law: "Utah Code",
    provision: "13-44-202(1)(d)",
    places: [BreachPlace.Utah],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.MisuseForIdentityTheftOrFraud],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: UTAH_SOURCE,
    sourceTitle: "Utah Code 13-44-202(1)(d)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  /*
   * ---- Vermont (Vermont Statutes, Title 9, 2435) ----
   *
   * Two texts (#11425): the one in force until 1 January 2027, and the one
   * 2025, No. 138 (Adj. Sess.), § 1 puts in force from that day, read from
   * the act and from the statute's own page, which sets out both. An
   * exposure follows the text in force on the day it was found. What the
   * new text changes for these notices: the data the law lists counts
   * without a name too, where it is enough to attempt identity theft
   * (2430(13)(C)), so - as for Georgia - no name is needed; biometric data
   * is defined anew (2430(2)), still biometric data; and a HIPAA covered
   * entity deemed in compliance still sends the attorney general its notice,
   * with a written certification (2435(e)(3)). The deadlines, the agencies'
   * threshold and the exception where misuse is not reasonably possible
   * stay as they were.
   */
  {
    id: BreachLawId.VermontResidents,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(1)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    note: translationKey(
      "From 1 January 2027, the data the law lists counts without a name too, where it is enough to attempt identity theft (2025, No. 138).",
    ),
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2430 and 2435(b)(1) and (d), as in force until 1 January 2027",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceUntil: "2027-01-01",
  },
  {
    id: BreachLawId.VermontAttorneyGeneral,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(3)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: VERMONT_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.BusinessDays,
      amount: 14,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: VERMONT_PRELIMINARY_DESCRIPTION,
    note: VERMONT_SWORN_STATEMENT,
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2435(b)(3), as in force until 1 January 2027",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceUntil: "2027-01-01",
  },
  {
    id: BreachLawId.VermontConsumerReportingAgencies,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(c)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: VERMONT_NOT_FOR_TITLE_8_LICENSEES,
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2435(c), as in force until 1 January 2027",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceUntil: "2027-01-01",
  },
  {
    id: BreachLawId.VermontResidentsFrom2027,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(1)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    // Without a name too, where the data is enough to attempt identity theft.
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    note: VERMONT_NAME_NOT_NEEDED,
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2430(13) and 2435(b)(1) and (d), as 2025, No. 138 (Adj. Sess.) amended them, in force from 1 January 2027",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  {
    id: BreachLawId.VermontAttorneyGeneralFrom2027,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(3)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: VERMONT_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.BusinessDays,
      amount: 14,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: VERMONT_PRELIMINARY_DESCRIPTION,
    note: translationKey(
      "An organization that swore its security policies to the attorney general before the breach sends the preliminary description before the people are told instead. A HIPAA covered entity whose breach touched only health information sends it too, with a written certification that it followed HIPAA's breach notification rule.",
    ),
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2435(b)(3) and (e), as 2025, No. 138 (Adj. Sess.) amended them, in force from 1 January 2027",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  {
    id: BreachLawId.VermontConsumerReportingAgenciesFrom2027,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(c)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: VERMONT_NOT_FOR_TITLE_8_LICENSEES,
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2435(c), as 2025, No. 138 (Adj. Sess.) amended it, in force from 1 January 2027",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
  },
  // ---- Virginia (Code of Virginia 18.2-186.6) ----
  {
    id: BreachLawId.VirginiaResidents,
    family: BreachLawFamily.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(B)",
    places: [BreachPlace.Virginia],
    dataElements: VIRGINIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: VIRGINIA_SOURCE,
    sourceTitle: "Code of Virginia 18.2-186.6(A) and (B)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.VirginiaAttorneyGeneral,
    family: BreachLawFamily.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(B) (attorney general)",
    places: [BreachPlace.Virginia],
    dataElements: VIRGINIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_ATTORNEY_GENERAL,
    recipient: THE_STATE_ATTORNEY_GENERAL,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "An employer or payroll service provider also tells the attorney general when an employee's taxpayer identification number was taken with the tax withheld.",
    ),
    sourceUrl: VIRGINIA_SOURCE,
    sourceTitle: "Code of Virginia 18.2-186.6(B) and (M)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.VirginiaConsumerReportingAgencies,
    family: BreachLawFamily.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(E)",
    places: [BreachPlace.Virginia],
    dataElements: VIRGINIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: true },
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: VIRGINIA_SOURCE,
    sourceTitle: "Code of Virginia 18.2-186.6(E)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Wisconsin (Wisconsin Statutes 134.98) ----
  {
    id: BreachLawId.WisconsinResidents,
    family: BreachLawFamily.Wisconsin,
    law: "Wisconsin Statutes",
    provision: "134.98(2)",
    places: [BreachPlace.Wisconsin],
    dataElements: WISCONSIN_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.NoMaterialRiskOfIdentityTheft],
    action: TELL_THE_PEOPLE,
    recipient: translationKey(
      "Each affected resident of the state or, if you are based in Wisconsin or hold the data there, everyone the data is about",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Within a reasonable time, and no later than that after you learn the data was taken.",
    ),
    note: WISCONSIN_EXEMPTIONS,
    sourceUrl: WISCONSIN_SOURCE,
    sourceTitle: "Wisconsin Statutes 134.98(1)(b), (2), (3)(a) and (3m)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.WisconsinConsumerReportingAgencies,
    family: BreachLawFamily.Wisconsin,
    law: "Wisconsin Statutes",
    provision: "134.98(2)(br)",
    places: [BreachPlace.Wisconsin],
    dataElements: WISCONSIN_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    minimumPeople: { count: 1000, isMoreThan: false },
    conditions: [BreachCondition.NoMaterialRiskOfIdentityTheft],
    action: TELL_THE_CONSUMER_REPORTING_AGENCIES,
    recipient: THE_CONSUMER_REPORTING_AGENCIES,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    note: WISCONSIN_EXEMPTIONS,
    sourceUrl: WISCONSIN_SOURCE,
    sourceTitle: "Wisconsin Statutes 134.98(2)(br)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  // ---- Wyoming (Wyoming Statutes 40-12-501 and 40-12-502) ----
  {
    id: BreachLawId.WyomingResidents,
    family: BreachLawFamily.Wyoming,
    law: "Wyoming Statutes",
    provision: "40-12-502(a)",
    places: [BreachPlace.Wyoming],
    dataElements: WYOMING_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [
      BreachCondition.LossOrInjury,
      BreachCondition.InvestigationFindsMisuse,
    ],
    action: TELL_THE_PEOPLE,
    recipient: EACH_STATE_RESIDENT,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: WYOMING_SOURCE,
    sourceTitle:
      "Wyoming Statutes 40-12-501(a)(i) and (vii), 40-12-502(a), and 6-3-901(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
  },
  /*
   * ---- Puerto Rico (Ley 111-2005, as Ley 97-2008 amended it) ----
   *
   * In Spanish, the official text (#11424). Article 3: an entity that owns
   * the database or keeps it in custody ("propietaria o custodia") tells the
   * citizens resident in Puerto Rico "de la manera más expedita posible",
   * allowing for law enforcement's need to secure evidence and for
   * restoring the system's security; and the responsible parties tell the
   * Department of Consumer Affairs "dentro de un plazo improrrogable de diez
   * (10) días de detectarse" the breach - unlabelled days, counted as
   * calendar days - which announces it publicly within 24 hours. No test of
   * harm and no threshold. The notice to the Office of the Citizen's
   * Ombudsman (Article 7, from Ley 97-2008) is asked of government agencies
   * and public corporations alone, so it is no row.
   */
  {
    id: BreachLawId.PuertoRicoResidents,
    family: BreachLawFamily.PuertoRico,
    law: "Puerto Rico Citizen Information on Data Banks Security Act",
    provision: "Section 3",
    places: [BreachPlace.PuertoRico],
    dataElements: PUERTO_RICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected Puerto Rico resident"),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "As quickly as possible, allowing for law enforcement's need to secure evidence and for restoring the system's security.",
    ),
    note: translationKey(
      "Owed by an organization that keeps the data in its custody for another too, not only by the data's owner.",
    ),
    sourceUrl: PUERTO_RICO_ACT_97_SOURCE,
    sourceTitle:
      "Ley Núm. 111 de 7 de septiembre de 2005, Artículos 2 y 3, según enmendada por la Ley Núm. 97 de 19 de junio de 2008",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  {
    id: BreachLawId.PuertoRicoConsumerAffairs,
    family: BreachLawFamily.PuertoRico,
    law: "Puerto Rico Citizen Information on Data Banks Security Act",
    provision: "Section 3 (Department of Consumer Affairs)",
    places: [BreachPlace.PuertoRico],
    dataElements: PUERTO_RICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: translationKey("Tell Puerto Rico's Department of Consumer Affairs"),
    recipient: translationKey(
      "The Department of Consumer Affairs (DACO), which announces the breach publicly within 24 hours",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from detecting the breach; the law says this time cannot be extended.",
    ),
    sourceUrl: PUERTO_RICO_ACT_111_SOURCE,
    sourceTitle:
      "Ley Núm. 111 de 7 de septiembre de 2005, Artículos 2 y 3, tercer párrafo",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  /*
   * ---- Guam (9 GCA Chapter 48) ----
   *
   * As the Compiler of Laws publishes it (#11426), unchanged since P.L.
   * 30-004 (2009). A breach is one that "causes, or the individual or entity
   * reasonably believes has caused or will cause, identity theft or other
   * fraud to any resident of Guam" (48.20(a)); its residents are told
   * "without unreasonable delay" (48.30(a)). No notice to a government
   * office or to the consumer reporting agencies. The chapter applies to a
   * breach discovered on or after it took effect (48.60): the day of
   * discovery decides which text applies, as it does for every row.
   */
  {
    id: BreachLawId.GuamResidents,
    family: BreachLawFamily.Guam,
    law: "Guam Code Annotated, Title 9",
    provision: "48.30(a)",
    places: [BreachPlace.Guam],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected Guam resident"),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: GUAM_SOURCE,
    sourceTitle: "Guam Code Annotated, Title 9, 48.20 and 48.30(a)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  /*
   * ---- The US Virgin Islands (14 V.I.C. 2209) ----
   *
   * From the act that enacted it, Act No. 6789 of 2005 (#11426): a person or
   * business that conducts business in the Virgin Islands tells its
   * residents "in the most expedient time possible and without unreasonable
   * delay" (2209(a)). No test of harm, and no notice to a government office
   * or to the consumer reporting agencies. 2208 asks the same of the
   * territory's own agencies, so it is no row.
   */
  {
    id: BreachLawId.UsVirginIslandsResidents,
    family: BreachLawFamily.UsVirginIslands,
    law: "Virgin Islands Code, Title 14",
    provision: "2209(a)",
    places: [BreachPlace.UsVirginIslands],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_PEOPLE,
    recipient: translationKey("Each affected US Virgin Islands resident"),
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: US_VIRGIN_ISLANDS_SOURCE,
    sourceTitle:
      "Virgin Islands Code, Title 14, 2209(a), (d) and (e), as Act No. 6789 (2005) enacted them",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
  },
  /*
   * ---- The notice to the data's owner (#11427) ----
   *
   * Almost every US jurisdiction's statute puts a duty on an organization
   * that holds data it does not own - a vendor, a service provider, a
   * third-party agent: tell the data's owner, which then tells the people.
   * Each row is that subsection, read from the same text as its
   * jurisdiction's other rows, with its deadline as the statute states it
   * and the data its personal information covers. A test of harm that is
   * part of the statute's definition of a breach, or an exception written
   * for the whole section, holds for this notice too; one that only excuses
   * the notice to the people does not. Rhode Island's and South Dakota's
   * statutes have no such notice - Rhode Island's asks whoever stores the
   * data to tell the people itself - and West Virginia's text could not be
   * read. Applied only once a person says the organization holds this data
   * for another (forDataHolders).
   */
  {
    id: BreachLawId.AlabamaDataOwner,
    family: BreachLawFamily.Alabama,
    law: "Code of Alabama 1975",
    provision: "8-38-8",
    places: [BreachPlace.Alabama],
    dataElements: ALABAMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AS_SOON_AS_PRACTICABLE_WITHIN,
    note: translationKey(
      "You and the data's owner may agree, by contract, that you send the notices the law asks of it.",
    ),
    sourceUrl: ALABAMA_THIRD_PARTY_AGENT_SOURCE,
    sourceTitle: "Code of Alabama 1975, 8-38-2(7) and 8-38-8",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.AlaskaDataOwner,
    family: BreachLawFamily.Alaska,
    law: "Alaska Statutes",
    provision: "45.48.070(a)",
    places: [BreachPlace.Alaska],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "You need not tell the people yourself: the data's owner does, as if the breach were its own.",
    ),
    sourceUrl: ALASKA_SOURCE,
    sourceTitle: "Alaska Statutes 45.48.070(a) and (b) and 45.48.090",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.ArizonaDataOwner,
    family: BreachLawFamily.Arizona,
    law: "Arizona Revised Statutes",
    provision: "18-552(C)",
    places: [BreachPlace.Arizona],
    dataElements: ARIZONA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "You tell the people yourself only if your agreement with the data's owner says you do.",
    ),
    sourceUrl: ARIZONA_SOURCE,
    sourceTitle: "Arizona Revised Statutes 18-552(C)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.ArkansasDataOwner,
    family: BreachLawFamily.Arkansas,
    law: "Arkansas Code",
    provision: "4-110-105(b)(1)",
    places: [BreachPlace.Arkansas],
    dataElements: ARKANSAS_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Its exception covers every notification "under this section" ((d)).
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    note: KEEP_THE_DETERMINATION_FIVE_YEARS,
    sourceUrl: ARKANSAS_ACT_1030_SOURCE,
    sourceTitle:
      "Arkansas Code 4-110-105(b)(1), as Act 1030 of 2019 amended it, and 4-110-105(d), as Act 1526 of 2005 enacted it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  /*
   * California's subsection (b), as SB 446 left it, read from the
   * Legislative Counsel's own data (its pubinfo_2025 download, the law
   * section table of 2 October 2026): the section's page refuses automated
   * readers.
   */
  {
    id: BreachLawId.CaliforniaDataOwner,
    family: BreachLawFamily.California,
    law: "California Civil Code",
    provision: "1798.82(b)",
    places: [BreachPlace.California],
    dataElements: CALIFORNIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: CALIFORNIA_SOURCE,
    sourceTitle:
      "California Civil Code 1798.82(b), as amended by SB 446 (Ch. 319, Stats. 2025)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.ColoradoDataOwner,
    family: BreachLawFamily.Colorado,
    law: "Colorado Revised Statutes",
    provision: "6-1-716(2)(b)",
    places: [BreachPlace.Colorado],
    dataElements: COLORADO_ELEMENTS,
    needsName: true,
    nameFreeElements: [
      BreachDataElement.OnlineCredentials,
      BreachDataElement.FinancialAccount,
    ],
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: COLORADO_STATUTE_SOURCE,
    sourceTitle: "Colorado Revised Statutes 2024, 6-1-716(1)(i) and (2)(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.ConnecticutDataOwner,
    family: BreachLawFamily.Connecticut,
    law: "General Statutes of Connecticut",
    provision: "36a-701b(c)",
    places: [BreachPlace.Connecticut],
    dataElements: CONNECTICUT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: CONNECTICUT_SOURCE,
    sourceTitle: "General Statutes of Connecticut 36a-701b(c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.DelawareDataOwner,
    family: BreachLawFamily.Delaware,
    law: "Delaware Code, Title 6",
    provision: "12B-102(b)",
    places: [BreachPlace.Delaware],
    dataElements: DELAWARE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: DELAWARE_SOURCE,
    sourceTitle: "Delaware Code, Title 6, 12B-102(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.DistrictOfColumbiaDataOwner,
    family: BreachLawFamily.DistrictOfColumbia,
    law: "D.C. Code",
    provision: "28-3852(b)",
    places: [BreachPlace.DistrictOfColumbia],
    dataElements: DISTRICT_OF_COLUMBIA_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    // Part of the definition of a breach (28-3851(1)(B)(iii)).
    conditions: [BreachCondition.LikelyHarmAfterConsulting],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE,
    sourceTitle: "D.C. Code 28-3852(b) and 28-3851(1)(B)(iii)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.FloridaDataOwner,
    family: BreachLawFamily.Florida,
    law: "Florida Statutes",
    provision: "501.171(6)(a)",
    places: [BreachPlace.Florida],
    dataElements: FLORIDA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AS_SOON_AS_PRACTICABLE_WITHIN,
    sourceUrl: FLORIDA_HTTPS_SOURCE,
    sourceTitle: "Florida Statutes 501.171(6)(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.GeorgiaDataOwner,
    family: BreachLawFamily.Georgia,
    law: "Official Code of Georgia",
    provision: "10-1-912(b)",
    places: [BreachPlace.Georgia],
    dataElements: US_STATE_CORE,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.HeldForBrokerOrAgency],
    action: TELL_THE_DATA_OWNER,
    recipient: translationKey(
      "The information broker or agency you hold the data for",
    ),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 24,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: GEORGIA_SOURCE,
    sourceTitle:
      "Official Code of Georgia 10-1-911 and 10-1-912(b), as 2007 SB 236 (Act 241) restates them",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.GuamDataOwner,
    family: BreachLawFamily.Guam,
    law: "Guam Code Annotated, Title 9",
    provision: "48.30(c)",
    places: [BreachPlace.Guam],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (48.20(a)).
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: GUAM_SOURCE,
    sourceTitle: "Guam Code Annotated, Title 9, 48.20(a) and 48.30(c)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.HawaiiDataOwner,
    family: BreachLawFamily.Hawaii,
    law: "Hawaii Revised Statutes",
    provision: "487N-2(b)",
    places: [BreachPlace.Hawaii],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a security breach (487N-1).
    conditions: [BreachCondition.LikelyIllegalUse],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: HAWAII_SOURCE,
    sourceTitle: "Hawaii Revised Statutes 487N-1 and 487N-2(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.IdahoDataOwner,
    family: BreachLawFamily.Idaho,
    law: "Idaho Code",
    provision: "28-51-105(2)",
    places: [BreachPlace.Idaho],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: IDAHO_SOURCE,
    sourceTitle: "Idaho Code 28-51-105(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.IllinoisDataOwner,
    family: BreachLawFamily.Illinois,
    law: "815 ILCS 530",
    provision: "10(b)",
    places: [BreachPlace.Illinois],
    dataElements: ILLINOIS_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: ILLINOIS_SOURCE,
    sourceTitle: "Personal Information Protection Act, 815 ILCS 530/10(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.IndianaDataOwner,
    family: BreachLawFamily.Indiana,
    law: "Indiana Code",
    provision: "24-4.9-3-2",
    places: [BreachPlace.Indiana],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [BreachDataElement.SocialSecurityNumber],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    sourceUrl: INDIANA_SOURCE,
    sourceTitle:
      "Indiana Code 24-4.9-3-2 and 24-4.9-3-3(a) (Indiana Code 2026)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.IowaDataOwner,
    family: BreachLawFamily.Iowa,
    law: "Iowa Code",
    provision: "715C.2(2)",
    places: [BreachPlace.Iowa],
    dataElements: IOWA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: IOWA_SOURCE,
    sourceTitle: "Iowa Code 715C.2(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.KansasDataOwner,
    family: BreachLawFamily.Kansas,
    law: "Kansas Statutes Annotated",
    provision: "50-7a02(b)",
    places: [BreachPlace.Kansas],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a security breach (50-7a01(h)): identity theft caused, or believed caused.
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AFTER_DISCOVERY_NO_TIME,
    sourceUrl: KANSAS_SOURCE,
    sourceTitle: "Kansas Statutes Annotated 50-7a01 and 50-7a02(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.KentuckyDataOwner,
    family: BreachLawFamily.Kentucky,
    law: "Kentucky Revised Statutes",
    provision: "365.732(3)",
    places: [BreachPlace.Kentucky],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (365.732(1)(a)).
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: KENTUCKY_SOURCE,
    sourceTitle: "Kentucky Revised Statutes 365.732(1) and (3)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.LouisianaDataOwner,
    family: BreachLawFamily.Louisiana,
    law: "Louisiana Revised Statutes",
    provision: "51:3074(D)",
    places: [BreachPlace.Louisiana],
    dataElements: LOUISIANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Its exception covers every notification "as provided in this Section" ((I)).
    conditions: [BreachCondition.LikelyHarm],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 60,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: WITHIN_THE_DAYS_OF_DISCOVERY,
    note: KEEP_THE_DETERMINATION_FIVE_YEARS,
    sourceUrl: LOUISIANA_SOURCE,
    sourceTitle: "Louisiana Revised Statutes 51:3074(D), (E) and (I)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MaineDataOwner,
    family: BreachLawFamily.Maine,
    law: "Maine Revised Statutes, Title 10",
    provision: "1348(2)",
    places: [BreachPlace.Maine],
    dataElements: US_STATE_CORE,
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MAINE_SOURCE,
    sourceTitle: "Maine Revised Statutes, Title 10, 1348(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MarylandDataOwner,
    family: BreachLawFamily.Maryland,
    law: "Maryland Code, Commercial Law",
    provision: "14-3504(c)",
    places: [BreachPlace.Maryland],
    dataElements: MARYLAND_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AS_SOON_AS_PRACTICABLE_WITHIN,
    sourceUrl: MARYLAND_SOURCE,
    sourceTitle: "Maryland Code, Commercial Law, 14-3504(c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MassachusettsDataOwner,
    family: BreachLawFamily.Massachusetts,
    law: "General Laws of Massachusetts, chapter 93H",
    provision: "3(a)",
    places: [BreachPlace.Massachusetts],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    // The same two triggers as the people's notice: a breach of security, or data acquired or used without right.
    conditions: [BreachCondition.SubstantialRiskOfIdentityTheft],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MASSACHUSETTS_SOURCE,
    sourceTitle:
      "General Laws of Massachusetts, chapter 93H, sections 1 and 3(a)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MichiganDataOwner,
    family: BreachLawFamily.Michigan,
    law: "Michigan Compiled Laws",
    provision: "445.72(2)",
    places: [BreachPlace.Michigan],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SubstantialLossOrIdentityTheft],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MICHIGAN_SOURCE,
    sourceTitle: "Michigan Compiled Laws 445.72(2) and (4)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MinnesotaDataOwner,
    family: BreachLawFamily.Minnesota,
    law: "Minnesota Statutes",
    provision: "325E.61, subdivision 1(b)",
    places: [BreachPlace.Minnesota],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MINNESOTA_SOURCE,
    sourceTitle: "Minnesota Statutes 2026, 325E.61, subdivision 1(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MississippiDataOwner,
    family: BreachLawFamily.Mississippi,
    law: "Mississippi Code",
    provision: "75-24-29(4)",
    places: [BreachPlace.Mississippi],
    dataElements: MISSISSIPPI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.AcquiredForFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSISSIPPI_SOURCE,
    sourceTitle:
      "Mississippi Code 75-24-29(4), as 2021 HB 277 (Laws 2021, ch. 378) restates it",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MissouriDataOwner,
    family: BreachLawFamily.Missouri,
    law: "Revised Statutes of Missouri",
    provision: "407.1500.2(2)",
    places: [BreachPlace.Missouri],
    dataElements: MISSOURI_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Its exception covers subdivisions (1) and (2) alike (407.1500.2(5)).
    conditions: [BreachCondition.IdentityTheftOrFraudInWriting],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MISSOURI_SOURCE,
    sourceTitle: "Revised Statutes of Missouri 407.1500.2(2) and (5)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.MontanaDataOwner,
    family: BreachLawFamily.Montana,
    law: "Montana Code Annotated",
    provision: "30-14-1704(2)",
    places: [BreachPlace.Montana],
    dataElements: MONTANA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (30-14-1704(4)).
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: MONTANA_SOURCE,
    sourceTitle: "Montana Code Annotated 2025, 30-14-1704(2) and (4)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NebraskaDataOwner,
    family: BreachLawFamily.Nebraska,
    law: "Nebraska Revised Statutes",
    provision: "87-803(3)",
    places: [BreachPlace.Nebraska],
    dataElements: NEBRASKA_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey("When you become aware of the breach."),
    sourceUrl: NEBRASKA_SOURCE,
    sourceTitle: "Nebraska Revised Statutes 87-803(3)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NevadaDataOwner,
    family: BreachLawFamily.Nevada,
    law: "Nevada Revised Statutes",
    provision: "603A.220(2)",
    places: [BreachPlace.Nevada],
    dataElements: NEVADA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEVADA_SOURCE,
    sourceTitle: "Nevada Revised Statutes 603A.220(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NewHampshireDataOwner,
    family: BreachLawFamily.NewHampshire,
    law: "New Hampshire Revised Statutes",
    provision: "359-C:20, I(c)",
    places: [BreachPlace.NewHampshire],
    dataElements: NEW_HAMPSHIRE_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_HAMPSHIRE_SOURCE,
    sourceTitle: "New Hampshire Revised Statutes 359-C:20, I(c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NewJerseyDataOwner,
    family: BreachLawFamily.NewJersey,
    law: "New Jersey Statutes",
    provision: "56:8-163(b)",
    places: [BreachPlace.NewJersey],
    dataElements: NEW_JERSEY_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NEW_JERSEY_SOURCE,
    sourceTitle: "New Jersey Statutes 56:8-163(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NewMexicoDataOwner,
    family: BreachLawFamily.NewMexico,
    law: "New Mexico Statutes Annotated 1978",
    provision: "57-12C-6(C)",
    places: [BreachPlace.NewMexico],
    dataElements: NEW_MEXICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.SignificantRiskOfIdentityTheft],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: IN_THE_MOST_EXPEDIENT_TIME_WITHIN,
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: NEW_MEXICO_SOURCE,
    sourceTitle: "New Mexico Statutes Annotated 1978, 57-12C-6(C)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NewYorkDataOwner,
    family: BreachLawFamily.NewYork,
    law: "New York General Business Law",
    provision: "899-aa(3)",
    places: [BreachPlace.NewYork],
    dataElements: NEW_YORK_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 30,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Immediately, and no later than that after the breach was discovered.",
    ),
    sourceUrl: NEW_YORK_SOURCE,
    sourceTitle: "New York General Business Law 899-aa(3)",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NorthCarolinaDataOwner,
    family: BreachLawFamily.NorthCarolina,
    law: "North Carolina General Statutes",
    provision: "75-65(b)",
    places: [BreachPlace.NorthCarolina],
    dataElements: NORTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a security breach (75-61(14)).
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_CAROLINA_SOURCE,
    sourceTitle: "North Carolina General Statutes 75-61 and 75-65(b)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.NorthDakotaDataOwner,
    family: BreachLawFamily.NorthDakota,
    law: "North Dakota Century Code",
    provision: "51-30-03",
    places: [BreachPlace.NorthDakota],
    dataElements: NORTH_DAKOTA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: NORTH_DAKOTA_SOURCE,
    sourceTitle: "North Dakota Century Code 51-30-03",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.OhioDataOwner,
    family: BreachLawFamily.Ohio,
    law: "Ohio Revised Code",
    provision: "1349.19(C)",
    places: [BreachPlace.Ohio],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MaterialRiskOfIdentityTheft],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey("In an expeditious manner, the law says."),
    sourceUrl: OHIO_SOURCE,
    sourceTitle: "Ohio Revised Code 1349.19(C)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.OklahomaDataOwner,
    family: BreachLawFamily.Oklahoma,
    law: "Oklahoma Statutes, Title 24",
    provision: "163(C)",
    places: [BreachPlace.Oklahoma],
    dataElements: OKLAHOMA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (162(1)).
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: OKLAHOMA_SOURCE,
    sourceTitle:
      "Oklahoma Statutes, Title 24, 162 and 163(C), as Laws 2025, c. 406 (SB 626) amended them",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    // The definitions it reads are SB 626's, as its people's notice's are.
    inForceFrom: "2026-01-01",
    forDataHolders: true,
  },
  {
    id: BreachLawId.OregonDataOwner,
    family: BreachLawFamily.Oregon,
    law: "Oregon Revised Statutes",
    provision: "646A.604(2)",
    places: [BreachPlace.Oregon],
    dataElements: OREGON_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: translationKey(
      "The covered entity, or the vendor, whose contract you hold the data under",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 10,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AS_SOON_AS_PRACTICABLE_WITHIN,
    note: translationKey(
      "A vendor also tells the attorney general when more than 250 consumers, or a number it cannot determine, were affected, unless the covered entity has.",
    ),
    sourceUrl: OREGON_SOURCE,
    sourceTitle: "Oregon Revised Statutes 646A.602 and 646A.604(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.PennsylvaniaDataOwner,
    family: BreachLawFamily.Pennsylvania,
    law: "Pennsylvania Breach of Personal Information Notification Act",
    provision: "Section 3(c)",
    places: [BreachPlace.Pennsylvania],
    dataElements: PENNSYLVANIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (section 2).
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: AFTER_DISCOVERY_NO_TIME,
    note: translationKey(
      "The organization you hold the data for makes the law's determinations, and sends the other notices it asks for.",
    ),
    sourceUrl: PENNSYLVANIA_SOURCE,
    sourceTitle:
      "Pennsylvania Breach of Personal Information Notification Act (Act 94 of 2005), Sections 2 and 3(c), as amended",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.PuertoRicoDataOwner,
    family: BreachLawFamily.PuertoRico,
    law: "Puerto Rico Citizen Information on Data Banks Security Act",
    provision: "Section 3 (resellers and access providers)",
    places: [BreachPlace.PuertoRico],
    dataElements: PUERTO_RICO_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.ResellsOrProvidesAccess],
    action: TELL_THE_DATA_OWNER,
    recipient: translationKey("The data's owner, custodian or holder"),
    deadline: {
      unit: BreachDeadlineUnit.NoFixedTime,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey("The law sets no time for this notice."),
    sourceUrl: PUERTO_RICO_ACT_111_SOURCE,
    sourceTitle:
      "Ley Núm. 111 de 7 de septiembre de 2005, Artículo 3, segundo párrafo",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.SouthCarolinaDataOwner,
    family: BreachLawFamily.SouthCarolina,
    law: "Code of Laws of South Carolina",
    provision: "39-1-90(B)",
    places: [BreachPlace.SouthCarolina],
    dataElements: SOUTH_CAROLINA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (39-1-90(D)(1)).
    conditions: [BreachCondition.IllegalUseOrMaterialRisk],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: SOUTH_CAROLINA_SOURCE,
    sourceTitle: "Code of Laws of South Carolina 39-1-90(B) and (D)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.TennesseeDataOwner,
    family: BreachLawFamily.Tennessee,
    law: "Tennessee Code Annotated",
    provision: "47-18-2107(c)",
    places: [BreachPlace.Tennessee],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 45,
      start: BreachDeadlineStart.Found,
    },
    note: NOT_FOR_GLBA_OR_HIPAA,
    sourceUrl: TENNESSEE_SOURCE,
    sourceTitle:
      "Tennessee Code Annotated 47-18-2107(c), as 2017 Public Chapter 91 (SB 547, with Senate Amendment 1) replaced the section",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.TexasDataOwner,
    family: BreachLawFamily.Texas,
    law: "Texas Business and Commerce Code",
    provision: "521.053(c)",
    places: [BreachPlace.Texas],
    dataElements: TEXAS_ELEMENTS,
    needsName: true,
    nameFreeElements: HEALTH_DATA,
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: TEXAS_STATUTE_SOURCE,
    sourceTitle: "Texas Business and Commerce Code 521.053(c)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.UsVirginIslandsDataOwner,
    family: BreachLawFamily.UsVirginIslands,
    law: "Virgin Islands Code, Title 14",
    provision: "2209(b)",
    places: [BreachPlace.UsVirginIslands],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: US_VIRGIN_ISLANDS_SOURCE,
    sourceTitle:
      "Virgin Islands Code, Title 14, 2209(b), as Act No. 6789 (2005) enacted it",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.UtahDataOwner,
    family: BreachLawFamily.Utah,
    law: "Utah Code",
    provision: "13-44-202(3)",
    places: [BreachPlace.Utah],
    dataElements: US_STATE_CORE,
    needsName: true,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseOccurredOrLikely],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: UTAH_SOURCE,
    sourceTitle: "Utah Code 13-44-202(3)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.VermontDataOwner,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(2)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: true,
    nameFreeElements: [BreachDataElement.OnlineCredentials],
    // Its exception covers every notice under subsection (b) ((d)(1)).
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2435(b)(2) and (d), as in force until 1 January 2027",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    inForceUntil: "2027-01-01",
    forDataHolders: true,
  },
  {
    id: BreachLawId.VermontDataOwnerFrom2027,
    family: BreachLawFamily.Vermont,
    law: "Vermont Statutes, Title 9",
    provision: "2435(b)(2)",
    places: [BreachPlace.Vermont],
    dataElements: VERMONT_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [BreachCondition.MisuseNotPossibleTellAg],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    note: VERMONT_NAME_NOT_NEEDED,
    sourceUrl: VERMONT_SOURCE,
    sourceTitle:
      "Vermont Statutes, Title 9, 2430(13) and 2435(b)(2) and (d), as 2025, No. 138 (Adj. Sess.) amended them, in force from 1 January 2027",
    checkedOn: FOLLOW_UP_LAWS_CHECKED_ON,
    inForceFrom: "2027-01-01",
    forDataHolders: true,
  },
  {
    id: BreachLawId.VirginiaDataOwner,
    family: BreachLawFamily.Virginia,
    law: "Code of Virginia",
    provision: "18.2-186.6(D)",
    places: [BreachPlace.Virginia],
    dataElements: VIRGINIA_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (18.2-186.6(A)).
    conditions: [BreachCondition.CausesIdentityTheftOrFraud],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.WithoutUnreasonableDelay,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: VIRGINIA_SOURCE,
    sourceTitle: "Code of Virginia 18.2-186.6(A) and (D)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.WashingtonDataOwner,
    family: BreachLawFamily.Washington,
    law: "Revised Code of Washington",
    provision: "19.255.010(2)",
    places: [BreachPlace.Washington],
    dataElements: WASHINGTON_ELEMENTS,
    needsName: false,
    nameFreeElements: [],
    conditions: [],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.Immediately,
      start: BreachDeadlineStart.Found,
    },
    sourceUrl: WASHINGTON_SOURCE,
    sourceTitle: "Revised Code of Washington 19.255.010(2)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.WisconsinDataOwner,
    family: BreachLawFamily.Wisconsin,
    law: "Wisconsin Statutes",
    provision: "134.98(2)(bm)",
    places: [BreachPlace.Wisconsin],
    dataElements: WISCONSIN_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Its exception covers (bm) too ((2)(cm)).
    conditions: [
      BreachCondition.NoContractWithOwner,
      BreachCondition.NoMaterialRiskOfIdentityTheft,
    ],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    note: WISCONSIN_EXEMPTIONS,
    sourceUrl: WISCONSIN_SOURCE,
    sourceTitle: "Wisconsin Statutes 134.98(2)(bm) and (2)(cm)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
  },
  {
    id: BreachLawId.WyomingDataOwner,
    family: BreachLawFamily.Wyoming,
    law: "Wyoming Statutes",
    provision: "40-12-502(g)",
    places: [BreachPlace.Wyoming],
    dataElements: WYOMING_ELEMENTS,
    needsName: true,
    nameFreeElements: [],
    // Part of the definition of a breach (40-12-501(a)(i)).
    conditions: [BreachCondition.LossOrInjury],
    action: TELL_THE_DATA_OWNER,
    recipient: THE_DATA_OWNER,
    deadline: {
      unit: BreachDeadlineUnit.AsSoonAsPracticable,
      start: BreachDeadlineStart.Found,
    },
    note: translationKey(
      "You and the business you hold the data for may agree which of you tells the people: one notice is owed, not two.",
    ),
    sourceUrl: WYOMING_SOURCE,
    sourceTitle: "Wyoming Statutes 40-12-501(a)(i) and 40-12-502(g)",
    checkedOn: US_STATE_LAWS_CHECKED_ON,
    forDataHolders: true,
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
  /*
   * ---- The card brands' own deadlines (#10953) ----
   *
   * Each from the brand's own published rules, in the version current on
   * CARD_BRAND_RULES_CHECKED_ON. They bind the brand's acquirers and
   * issuers, and a merchant or service provider through its agreements.
   * Discover, JCB and UnionPay publish no deadline of their own - Discover
   * gives only a number to call - so they are not rows: the assessment
   * says so (UncoveredLawKind.OtherCardBrands).
   */
  {
    id: BreachLawId.VisaCompromise,
    family: BreachLawFamily.Visa,
    law: "Visa What To Do If Compromised",
    provision: "Section A.1",
    places: null,
    dataElements: [BreachDataElement.CardData],
    needsName: false,
    nameFreeElements: [],
    conditions: [
      BreachCondition.HandlesCardData,
      BreachCondition.CardsOfTheBrand,
    ],
    action: translationKey("Notify Visa"),
    recipient: translationKey(
      "Visa's Global Risk Investigations group, and your acquiring bank at once",
    ),
    deadline: {
      unit: BreachDeadlineUnit.CalendarDays,
      amount: 3,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from evidence enough to suspect a compromise, not only to confirm one. An incident report to Visa and your acquirer is due within three calendar days after that.",
    ),
    sourceUrl: VISA_WTDIC_SOURCE,
    sourceTitle:
      "Visa What To Do If Compromised, Version 10.0 (effective 25 June 2026), Section A.1",
    checkedOn: CARD_BRAND_RULES_CHECKED_ON,
  },
  {
    id: BreachLawId.MastercardAdcEvent,
    family: BreachLawFamily.Mastercard,
    law: "Mastercard Security Rules and Procedures",
    provision: "Section 10.3.1",
    places: null,
    dataElements: [BreachDataElement.CardData],
    needsName: false,
    nameFreeElements: [],
    conditions: [
      BreachCondition.HandlesCardData,
      BreachCondition.CardsOfTheBrand,
    ],
    action: translationKey("Notify Mastercard"),
    recipient: translationKey("Mastercard, through your acquirer"),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 24,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Counted from when you knew, or with reasonable security practices should have known, of a potential compromise. Every account number at risk is due to Mastercard within 72 hours.",
    ),
    note: translationKey(
      "Mastercard's rules bind its acquirers and issuers and their agents; a merchant is held to them through its acquirer's agreement.",
    ),
    sourceUrl: MASTERCARD_SPME_SOURCE,
    sourceTitle:
      "Mastercard Security Rules and Procedures, Merchant Edition (4 August 2026), Section 10.3.1",
    checkedOn: CARD_BRAND_RULES_CHECKED_ON,
  },
  {
    id: BreachLawId.AmericanExpressDataIncident,
    family: BreachLawFamily.AmericanExpress,
    law: "American Express Data Security Operating Policy",
    provision: "Section 3.1",
    places: null,
    dataElements: [BreachDataElement.CardData],
    needsName: false,
    nameFreeElements: [],
    conditions: [
      BreachCondition.HandlesCardData,
      BreachCondition.CardsOfTheBrand,
    ],
    action: translationKey("Notify American Express"),
    recipient: translationKey(
      "American Express's Enterprise Incident Response Program",
    ),
    deadline: {
      unit: BreachDeadlineUnit.Hours,
      amount: 72,
      start: BreachDeadlineStart.Found,
    },
    deadlineNote: translationKey(
      "Immediately, and in no case later than that after you discover it. A suspected compromise of even one card number counts.",
    ),
    sourceUrl: AMEX_DSOP_SOURCE,
    sourceTitle:
      "American Express Data Security Operating Policy, United States edition (October 2026), Section 3.1",
    checkedOn: CARD_BRAND_RULES_CHECKED_ON,
  },
];

// The card brands the table has rows for, each by the row of its own rules.
export const CARD_BRAND_RULE_IDS: ReadonlyArray<BreachLawId> = [
  BreachLawId.VisaCompromise,
  BreachLawId.MastercardAdcEvent,
  BreachLawId.AmericanExpressDataIncident,
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

/*
 * The places the table covers - each a place some row names - in the
 * places' order, for "what this does not cover".
 */
export const COVERED_PLACES: ReadonlyArray<BreachPlace> = BREACH_PLACES.filter(
  (place: BreachPlace): boolean => {
    return BREACH_LAW_RULES.some((rule: BreachLawRule): boolean => {
      return Boolean(rule.places?.includes(place));
    });
  },
);

/*
 * The US states, the District of Columbia and Puerto Rico the table has rows
 * for, and those it has none for: a state whose statute could not be read
 * from an official source is left out (#10952), and the assessment names it.
 */
export const COVERED_US_STATES: ReadonlyArray<BreachPlace> =
  US_JURISDICTION_PLACES.filter((place: BreachPlace): boolean => {
    return COVERED_PLACES.includes(place);
  });

export const UNCOVERED_US_STATES: ReadonlyArray<BreachPlace> =
  US_JURISDICTION_PLACES.filter((place: BreachPlace): boolean => {
    return !COVERED_PLACES.includes(place);
  });

// Whether a row is a US state's own law: every place it applies in is a state.
export function isUsStateRule(rule: BreachLawRule): boolean {
  return Boolean(
    rule.places &&
      rule.places.length > 0 &&
      rule.places.every((place: BreachPlace): boolean => {
        return isUsStatePlace(place);
      }),
  );
}
