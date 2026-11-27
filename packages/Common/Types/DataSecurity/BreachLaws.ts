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
   * 3166-2:US code (#10952): every one is a place a person can say the
   * people live in, whether or not the table has rows for its law yet.
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

// Every US state, the District of Columbia and Puerto Rico, in alphabetical order.
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
}

// Whether a deadline has no length of time: it sets no due moment.
export function isDeadlineWithoutLength(unit: BreachDeadlineUnit): boolean {
  return (
    unit === BreachDeadlineUnit.WithoutUndueDelay ||
    unit === BreachDeadlineUnit.WithoutUnreasonableDelay ||
    unit === BreachDeadlineUnit.NoFixedTime
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
const COLORADO_SOURCE: string =
  "https://coag.gov/resources/data-protection-laws/";
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

// The numbers the shortest of the states' lists name: a Social Security number, a driver's license, an account.
const US_STATE_CORE: ReadonlyArray<BreachDataElement> = [
  BreachDataElement.SocialSecurityNumber,
  BreachDataElement.DriversLicense,
  BreachDataElement.FinancialAccount,
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
  BreachDataElement.OtherGovernmentId,
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
  BreachDataElement.OtherGovernmentId,
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
  BreachDataElement.OtherGovernmentId,
];

const NEW_JERSEY_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.OnlineCredentials,
];

const NEW_MEXICO_ELEMENTS: ReadonlyArray<BreachDataElement> = [
  ...US_STATE_CORE,
  BreachDataElement.OtherGovernmentId,
  BreachDataElement.Biometric,
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
const BEFORE_THE_PEOPLE_ARE_TOLD: string = translationKey(
  "Before the people are told.",
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
  /*
   * ---- The other US states (#10952) ----
   *
   * Each from its statute's own text, read on US_STATE_LAWS_CHECKED_ON: the
   * notice to the residents and, where the statute asks it of a business,
   * the one to the attorney general or another state office. A notice the
   * statute asks only of a state's own agencies is left out, and so are the
   * notices to the consumer reporting agencies (getUncoveredLaws says so).
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
    sourceUrl: MONTANA_SOURCE,
    sourceTitle: "Montana Code Annotated 2025, 30-14-1704(1) and (4)",
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
