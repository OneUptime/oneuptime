import ComplianceFramework from "./ComplianceFramework";
import DataCategory from "./DataCategory";
import DataSensitivity from "./DataSensitivity";

/*
 * EVERY KIND OF SENSITIVE DATA DATA SECURITY KNOWS, AND WHAT IT MEANS.
 *
 * One entry per data type: a stable id (stored on findings, so never
 * renamed), the name and line the UI shows, its category and sensitivity,
 * whose data it is when the type belongs to one country (ISO 3166-1 alpha-2,
 * which residency and the country-bound frameworks read), the frameworks
 * that protect it, and the field names that hint at it.
 *
 * How each type is found lives with the detectors
 * (Common/Utils/DataSecurity/Detectors); this file only describes, so the
 * Dashboard can list and explain types without carrying a single pattern.
 * A type found only from field names - a person's name, religion - says so
 * (`foundBy: "name"`): no value pattern can tell "Alice" from a street.
 *
 * Name hints are written as lower-case words separated by spaces. A field
 * name is split into words the same way (FieldNameHints.ts: camelCase,
 * snake_case, kebab-case and digits all split), and a hint matches when its
 * words appear in the field's words, in order and next to each other - so
 * "date of birth" matches `customer_date_of_birth` but not `birth_city`.
 */

export interface DataTypeInfo {
  id: string;
  name: string;
  description: string;
  category: DataCategory;
  sensitivity: DataSensitivity;
  // Whose data it is, for a type that belongs to one country.
  country?: string | undefined;
  frameworks: ReadonlyArray<ComplianceFramework>;
  nameHints: ReadonlyArray<string>;
  // "value": values are checked; "name": found from field names only.
  foundBy: "value" | "name";
}

const PERSONAL: ReadonlyArray<ComplianceFramework> = [
  ComplianceFramework.GDPR,
  ComplianceFramework.CCPA,
];

const PAYMENT: ReadonlyArray<ComplianceFramework> = [
  ComplianceFramework.PCIDSS,
  ComplianceFramework.GDPR,
  ComplianceFramework.CCPA,
];

const HEALTH: ReadonlyArray<ComplianceFramework> = [
  ComplianceFramework.HIPAA,
  ComplianceFramework.GDPR,
  ComplianceFramework.CCPA,
];

const NONE: ReadonlyArray<ComplianceFramework> = [];

// Personal data of one country: the general frameworks, and its own.
function personalOf(country: string): ReadonlyArray<ComplianceFramework> {
  if (country === "BR") {
    return [...PERSONAL, ComplianceFramework.LGPD];
  }

  if (country === "IN") {
    return [...PERSONAL, ComplianceFramework.DPDP];
  }

  return PERSONAL;
}

interface EntryOptions {
  country?: string | undefined;
  frameworks?: ReadonlyArray<ComplianceFramework> | undefined;
  nameHints?: ReadonlyArray<string> | undefined;
  foundBy?: "value" | "name" | undefined;
}

function entry(
  id: string,
  name: string,
  category: DataCategory,
  sensitivity: DataSensitivity,
  description: string,
  options: EntryOptions = {},
): DataTypeInfo {
  return {
    id,
    name,
    description,
    category,
    sensitivity,
    country: options.country,
    frameworks:
      options.frameworks ||
      (options.country ? personalOf(options.country) : NONE),
    nameHints: options.nameHints || [],
    foundBy: options.foundBy || "value",
  };
}

const C: typeof DataCategory = DataCategory;
const S: typeof DataSensitivity = DataSensitivity;

function governmentId(
  id: string,
  name: string,
  country: string,
  description: string,
  nameHints: ReadonlyArray<string>,
): DataTypeInfo {
  return entry(id, name, C.GovernmentId, S.Restricted, description, {
    country,
    nameHints,
  });
}

function secret(
  id: string,
  name: string,
  description: string,
  nameHints: ReadonlyArray<string> = [],
): DataTypeInfo {
  return entry(id, name, C.SecretsAndCredentials, S.Restricted, description, {
    nameHints,
  });
}

export const DATA_TYPE_CATALOG: ReadonlyArray<DataTypeInfo> = [
  // Contact and identity.
  entry(
    "email-address",
    "Email address",
    C.ContactAndIdentity,
    S.Confidential,
    "A person's email address.",
    {
      frameworks: PERSONAL,
      nameHints: ["email", "e mail", "mail address", "email address"],
    },
  ),
  entry(
    "phone-number",
    "Phone number",
    C.ContactAndIdentity,
    S.Confidential,
    "A phone number in international or national format.",
    {
      frameworks: PERSONAL,
      nameHints: ["phone", "telephone", "mobile", "cell", "msisdn", "tel"],
    },
  ),
  entry(
    "person-name",
    "Person name",
    C.ContactAndIdentity,
    S.Confidential,
    "A person's first, last or full name, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: [
        "first name",
        "last name",
        "full name",
        "given name",
        "family name",
        "middle name",
        "maiden name",
        "surname",
        "forename",
        "firstname",
        "lastname",
        "fullname",
        "fname",
        "lname",
        "customer name",
        "patient name",
        "contact name",
        "cardholder name",
      ],
    },
  ),
  entry(
    "postal-address",
    "Street address",
    C.ContactAndIdentity,
    S.Confidential,
    "A street address: a number, a street name and a street type.",
    {
      frameworks: PERSONAL,
      nameHints: [
        "address",
        "street",
        "address line",
        "street address",
        "billing address",
        "shipping address",
        "home address",
        "addr",
      ],
    },
  ),
  entry(
    "postal-code",
    "Postal code",
    C.ContactAndIdentity,
    S.Internal,
    "A postal code. On its own it narrows where someone lives.",
    {
      frameworks: PERSONAL,
      nameHints: ["zip", "zip code", "zipcode", "postcode", "postal code"],
    },
  ),
  entry(
    "date-of-birth",
    "Date of birth",
    C.ContactAndIdentity,
    S.Confidential,
    "A date next to words that say it is someone's birth date.",
    {
      frameworks: PERSONAL,
      nameHints: [
        "dob",
        "date of birth",
        "birth date",
        "birthdate",
        "birthday",
      ],
    },
  ),
  entry(
    "ip-address",
    "IP address",
    C.ContactAndIdentity,
    S.Confidential,
    "A public IPv4 or IPv6 address, which GDPR treats as personal data.",
    {
      frameworks: PERSONAL,
      nameHints: [
        "ip",
        "ip address",
        "client ip",
        "remote addr",
        "remote address",
        "x forwarded for",
        "source ip",
      ],
    },
  ),
  entry(
    "mac-address",
    "MAC address",
    C.ContactAndIdentity,
    S.Confidential,
    "A network card's hardware address, which identifies a device.",
    { frameworks: PERSONAL, nameHints: ["mac", "mac address", "hwaddr"] },
  ),
  entry(
    "advertising-id",
    "Advertising ID",
    C.ContactAndIdentity,
    S.Confidential,
    "A mobile advertising ID (IDFA, GAID, AAID) that tracks one device.",
    {
      frameworks: PERSONAL,
      nameHints: ["idfa", "gaid", "aaid", "advertising id", "ad id", "adid"],
    },
  ),
  entry(
    "geolocation",
    "Precise location",
    C.ContactAndIdentity,
    S.Confidential,
    "A latitude and longitude precise enough to find a building.",
    {
      frameworks: PERSONAL,
      nameHints: [
        "lat",
        "lng",
        "lon",
        "latitude",
        "longitude",
        "geo",
        "coordinates",
        "gps",
        "geolocation",
      ],
    },
  ),
  entry(
    "username",
    "Username",
    C.ContactAndIdentity,
    S.Confidential,
    "A person's sign-in or account name, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["username", "user name", "login name", "screen name"],
    },
  ),
  entry(
    "gender",
    "Gender",
    C.ContactAndIdentity,
    S.Confidential,
    "A person's gender or sex, found from the field's name.",
    { frameworks: PERSONAL, foundBy: "name", nameHints: ["gender", "sex"] },
  ),
  entry(
    "nationality",
    "Nationality",
    C.ContactAndIdentity,
    S.Confidential,
    "A person's nationality or citizenship, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["nationality", "citizenship", "country of birth"],
    },
  ),
  entry(
    "vehicle-identification-number",
    "Vehicle identification number",
    C.ContactAndIdentity,
    S.Confidential,
    "A 17-character VIN with a valid check digit.",
    {
      frameworks: PERSONAL,
      nameHints: ["vin", "vehicle identification number", "chassis number"],
    },
  ),

  // Government IDs.
  governmentId(
    "us-ssn",
    "US Social Security number",
    "US",
    "A US Social Security number.",
    ["ssn", "social security", "social security number", "ss number"],
  ),
  governmentId(
    "us-itin",
    "US taxpayer ID (ITIN)",
    "US",
    "A US Individual Taxpayer Identification Number.",
    ["itin", "taxpayer id", "taxpayer identification number"],
  ),
  entry(
    "us-ein",
    "US employer ID (EIN)",
    C.GovernmentId,
    S.Confidential,
    "A US Employer Identification Number, next to words that say so.",
    { country: "US", nameHints: ["ein", "employer id", "fein", "tax id"] },
  ),
  governmentId(
    "us-passport",
    "US passport number",
    "US",
    "A US passport number, next to words that say so.",
    ["us passport", "usa passport"],
  ),
  governmentId(
    "us-drivers-license",
    "US driver's license number",
    "US",
    "A US driver's license number, next to words that say so.",
    ["drivers license", "driver license", "dl number", "license number"],
  ),
  governmentId(
    "uk-nino",
    "UK National Insurance number",
    "GB",
    "A UK National Insurance number.",
    ["nino", "national insurance", "ni number", "national insurance number"],
  ),
  governmentId(
    "uk-passport",
    "UK passport number",
    "GB",
    "A UK passport number, next to words that say so.",
    ["uk passport", "gb passport", "british passport"],
  ),
  governmentId(
    "uk-driving-licence",
    "UK driving licence number",
    "GB",
    "A 16-character UK driving licence number.",
    ["driving licence", "driving license", "licence number"],
  ),
  governmentId(
    "ca-sin",
    "Canada Social Insurance number",
    "CA",
    "A Canadian Social Insurance Number with a valid check digit.",
    ["sin", "social insurance", "social insurance number"],
  ),
  governmentId(
    "mx-curp",
    "Mexico CURP",
    "MX",
    "A Mexican Clave Única de Registro de Población.",
    ["curp"],
  ),
  governmentId(
    "mx-rfc",
    "Mexico RFC",
    "MX",
    "A Mexican Registro Federal de Contribuyentes tax ID.",
    ["rfc"],
  ),
  governmentId(
    "br-cpf",
    "Brazil CPF",
    "BR",
    "A Brazilian Cadastro de Pessoas Físicas number.",
    ["cpf"],
  ),
  entry(
    "br-cnpj",
    "Brazil CNPJ",
    C.GovernmentId,
    S.Confidential,
    "A Brazilian company registration number (CNPJ).",
    { country: "BR", nameHints: ["cnpj"] },
  ),
  governmentId(
    "ar-cuit",
    "Argentina CUIT / CUIL",
    "AR",
    "An Argentine tax or labour identification code.",
    ["cuit", "cuil"],
  ),
  governmentId(
    "cl-rut",
    "Chile RUT",
    "CL",
    "A Chilean Rol Único Tributario with a valid check digit.",
    ["rut", "run"],
  ),
  governmentId(
    "es-dni",
    "Spain DNI",
    "ES",
    "A Spanish national identity document number with its check letter.",
    ["dni", "documento nacional"],
  ),
  governmentId(
    "es-nie",
    "Spain NIE",
    "ES",
    "A Spanish foreigner identity number with its check letter.",
    ["nie"],
  ),
  governmentId(
    "pt-nif",
    "Portugal NIF",
    "PT",
    "A Portuguese tax identification number.",
    ["nif", "contribuinte"],
  ),
  governmentId(
    "fr-nir",
    "France social security number (NIR)",
    "FR",
    "A French INSEE number with its two-digit key.",
    ["nir", "insee", "numero de securite sociale", "secu"],
  ),
  governmentId(
    "de-tax-id",
    "Germany tax ID",
    "DE",
    "A German Steuerliche Identifikationsnummer.",
    ["steuer id", "steuernummer", "steueridentifikationsnummer", "tax id"],
  ),
  governmentId(
    "it-codice-fiscale",
    "Italy codice fiscale",
    "IT",
    "An Italian fiscal code with a valid check character.",
    ["codice fiscale", "cf"],
  ),
  governmentId(
    "nl-bsn",
    "Netherlands BSN",
    "NL",
    "A Dutch citizen service number that passes the eleven test.",
    ["bsn", "burgerservicenummer"],
  ),
  governmentId(
    "be-national-number",
    "Belgium national number",
    "BE",
    "A Belgian national register number.",
    ["rijksregisternummer", "numero national", "national number"],
  ),
  governmentId(
    "pl-pesel",
    "Poland PESEL",
    "PL",
    "A Polish national identification number.",
    ["pesel"],
  ),
  governmentId(
    "se-personnummer",
    "Sweden personal identity number",
    "SE",
    "A Swedish personnummer with a valid check digit.",
    ["personnummer"],
  ),
  governmentId(
    "no-fodselsnummer",
    "Norway national identity number",
    "NO",
    "A Norwegian fødselsnummer with both check digits.",
    ["fodselsnummer", "personnummer"],
  ),
  governmentId(
    "dk-cpr",
    "Denmark CPR number",
    "DK",
    "A Danish civil registration number, next to words that say so.",
    ["cpr", "cpr nummer", "personnummer"],
  ),
  governmentId(
    "fi-hetu",
    "Finland personal identity code",
    "FI",
    "A Finnish henkilötunnus with its check character.",
    ["hetu", "henkilotunnus"],
  ),
  governmentId(
    "ie-ppsn",
    "Ireland PPS number",
    "IE",
    "An Irish Personal Public Service Number.",
    ["ppsn", "pps number", "pps"],
  ),
  governmentId(
    "ch-ahv",
    "Switzerland AHV number",
    "CH",
    "A Swiss social security number (AHV / AVS).",
    ["ahv", "avs", "ahv number"],
  ),
  governmentId(
    "ro-cnp",
    "Romania CNP",
    "RO",
    "A Romanian personal numeric code.",
    ["cnp"],
  ),
  governmentId(
    "bg-egn",
    "Bulgaria EGN",
    "BG",
    "A Bulgarian uniform civil number.",
    ["egn"],
  ),
  governmentId(
    "hr-oib",
    "Croatia OIB",
    "HR",
    "A Croatian personal identification number.",
    ["oib"],
  ),
  governmentId(
    "gr-amka",
    "Greece AMKA",
    "GR",
    "A Greek social security number.",
    ["amka"],
  ),
  governmentId(
    "tr-tckn",
    "Turkey identity number",
    "TR",
    "A Turkish T.C. Kimlik number.",
    ["tc kimlik", "tckn", "kimlik no"],
  ),
  governmentId(
    "il-teudat-zehut",
    "Israel identity number",
    "IL",
    "An Israeli Teudat Zehut number.",
    ["teudat zehut", "israeli id"],
  ),
  governmentId(
    "za-id",
    "South Africa ID number",
    "ZA",
    "A South African identity number with a valid date and check digit.",
    ["sa id", "rsa id", "id number"],
  ),
  governmentId(
    "ae-emirates-id",
    "UAE Emirates ID",
    "AE",
    "A United Arab Emirates identity card number.",
    ["emirates id", "eid"],
  ),
  governmentId(
    "sa-national-id",
    "Saudi Arabia national ID",
    "SA",
    "A Saudi national ID or iqama number.",
    ["iqama", "saudi id", "national id"],
  ),
  governmentId(
    "in-aadhaar",
    "India Aadhaar number",
    "IN",
    "A 12-digit Aadhaar number that passes the Verhoeff check.",
    ["aadhaar", "aadhar", "uid number"],
  ),
  governmentId(
    "in-pan",
    "India PAN",
    "IN",
    "An Indian Permanent Account Number.",
    ["pan", "pan number", "permanent account number"],
  ),
  governmentId(
    "cn-resident-id",
    "China resident identity number",
    "CN",
    "An 18-character Chinese resident identity card number.",
    ["resident id", "shenfenzheng", "id card"],
  ),
  governmentId(
    "jp-my-number",
    "Japan My Number",
    "JP",
    "A Japanese individual number with a valid check digit.",
    ["my number", "mynumber", "kojin bango"],
  ),
  governmentId(
    "kr-rrn",
    "South Korea resident registration number",
    "KR",
    "A Korean resident registration number.",
    ["rrn", "resident registration", "jumin"],
  ),
  governmentId(
    "sg-nric",
    "Singapore NRIC / FIN",
    "SG",
    "A Singapore identity card or foreign identification number.",
    ["nric", "fin"],
  ),
  governmentId(
    "hk-hkid",
    "Hong Kong identity card number",
    "HK",
    "A Hong Kong identity card number with its check digit.",
    ["hkid", "hong kong id"],
  ),
  governmentId(
    "tw-national-id",
    "Taiwan national ID",
    "TW",
    "A Taiwanese national identification number.",
    ["taiwan id", "national id"],
  ),
  governmentId(
    "th-national-id",
    "Thailand national ID",
    "TH",
    "A Thai citizen identification number.",
    ["thai id", "citizen id"],
  ),
  governmentId(
    "my-mykad",
    "Malaysia MyKad number",
    "MY",
    "A Malaysian identity card number.",
    ["mykad", "nric", "ic number"],
  ),
  governmentId(
    "id-nik",
    "Indonesia NIK",
    "ID",
    "An Indonesian population identity number.",
    ["nik", "nomor induk kependudukan"],
  ),
  governmentId(
    "au-tfn",
    "Australia tax file number",
    "AU",
    "An Australian tax file number with a valid check.",
    ["tfn", "tax file number"],
  ),
  governmentId(
    "nz-ird",
    "New Zealand IRD number",
    "NZ",
    "A New Zealand Inland Revenue number with a valid check digit.",
    ["ird", "ird number"],
  ),
  governmentId(
    "ru-snils",
    "Russia SNILS",
    "RU",
    "A Russian insurance account number with its check number.",
    ["snils"],
  ),
  governmentId(
    "ru-inn",
    "Russia INN",
    "RU",
    "A Russian taxpayer identification number.",
    ["inn"],
  ),
  entry(
    "passport-number",
    "Passport number",
    C.GovernmentId,
    S.Restricted,
    "A passport number from any country, next to words that say so.",
    { frameworks: PERSONAL, nameHints: ["passport", "passport number"] },
  ),

  // Financial.
  entry(
    "credit-card-number",
    "Card number",
    C.Financial,
    S.Restricted,
    "A payment card number that passes the Luhn check and belongs to a card brand.",
    {
      frameworks: PAYMENT,
      nameHints: [
        "card number",
        "credit card",
        "cc number",
        "pan",
        "card no",
        "ccnum",
      ],
    },
  ),
  entry(
    "card-verification-code",
    "Card security code",
    C.Financial,
    S.Restricted,
    "A CVV or CVC, which PCI DSS forbids keeping after a payment is authorised.",
    {
      frameworks: PAYMENT,
      nameHints: ["cvv", "cvc", "cvv 2", "card verification", "security code"],
    },
  ),
  entry(
    "card-expiration-date",
    "Card expiry date",
    C.Financial,
    S.Confidential,
    "A card's expiry date, next to words that say so.",
    {
      frameworks: PAYMENT,
      nameHints: ["expiry", "expiration", "exp date", "card expiry"],
    },
  ),
  entry(
    "iban",
    "IBAN",
    C.Financial,
    S.Restricted,
    "An international bank account number that passes the mod-97 check.",
    { frameworks: PERSONAL, nameHints: ["iban"] },
  ),
  entry(
    "bank-account-number",
    "Bank account number",
    C.Financial,
    S.Restricted,
    "A bank account number, next to words that say so.",
    {
      frameworks: PERSONAL,
      nameHints: ["account number", "bank account", "acct number", "acct no"],
    },
  ),
  entry(
    "swift-bic",
    "SWIFT / BIC code",
    C.Financial,
    S.Internal,
    "A bank's SWIFT or BIC code, next to words that say so.",
    { nameHints: ["swift", "bic", "swift code"] },
  ),
  entry(
    "us-bank-routing-number",
    "US bank routing number",
    C.Financial,
    S.Internal,
    "An ABA routing number with a valid checksum, next to words that say so.",
    { country: "US", nameHints: ["routing number", "aba", "routing"] },
  ),
  entry(
    "uk-sort-code",
    "UK sort code",
    C.Financial,
    S.Internal,
    "A UK bank sort code, next to words that say so.",
    { country: "GB", nameHints: ["sort code", "sortcode"] },
  ),
  entry(
    "in-ifsc",
    "India IFSC",
    C.Financial,
    S.Internal,
    "An Indian Financial System Code that names a bank branch.",
    { country: "IN", nameHints: ["ifsc"] },
  ),
  entry(
    "au-bsb",
    "Australia BSB",
    C.Financial,
    S.Internal,
    "An Australian bank-state-branch number, next to words that say so.",
    { country: "AU", nameHints: ["bsb"] },
  ),
  entry(
    "bitcoin-address",
    "Bitcoin address",
    C.Financial,
    S.Confidential,
    "A Bitcoin address with a valid checksum.",
    { frameworks: PERSONAL, nameHints: ["btc", "bitcoin", "wallet"] },
  ),
  entry(
    "ethereum-address",
    "Ethereum address",
    C.Financial,
    S.Confidential,
    "An Ethereum address, next to words that say so.",
    { frameworks: PERSONAL, nameHints: ["eth", "ethereum", "wallet"] },
  ),

  // Health.
  entry(
    "uk-nhs-number",
    "UK NHS number",
    C.Health,
    S.Restricted,
    "A UK National Health Service number with a valid check digit.",
    { country: "GB", frameworks: HEALTH, nameHints: ["nhs", "nhs number"] },
  ),
  entry(
    "us-medicare-mbi",
    "US Medicare beneficiary ID",
    C.Health,
    S.Restricted,
    "A US Medicare Beneficiary Identifier.",
    {
      country: "US",
      frameworks: HEALTH,
      nameHints: ["mbi", "medicare", "medicare number"],
    },
  ),
  entry(
    "au-medicare-number",
    "Australia Medicare number",
    C.Health,
    S.Restricted,
    "An Australian Medicare card number with a valid check digit.",
    { country: "AU", frameworks: HEALTH, nameHints: ["medicare"] },
  ),
  entry(
    "de-health-insurance-number",
    "Germany health insurance number",
    C.Health,
    S.Restricted,
    "A German Krankenversichertennummer with a valid check digit.",
    {
      country: "DE",
      frameworks: HEALTH,
      nameHints: ["kvnr", "krankenversichertennummer", "versichertennummer"],
    },
  ),
  entry(
    "medical-record-number",
    "Medical record number",
    C.Health,
    S.Restricted,
    "A patient's medical record number, next to words that say so.",
    {
      frameworks: HEALTH,
      nameHints: ["mrn", "medical record", "patient id", "chart number"],
    },
  ),
  entry(
    "health-plan-id",
    "Health plan member ID",
    C.Health,
    S.Restricted,
    "A health insurance member or policy number, next to words that say so.",
    {
      frameworks: HEALTH,
      nameHints: [
        "member id",
        "policy number",
        "insurance id",
        "subscriber id",
      ],
    },
  ),
  entry(
    "diagnosis-code",
    "Diagnosis code (ICD-10)",
    C.Health,
    S.Restricted,
    "An ICD-10 diagnosis code, next to words that say so.",
    {
      frameworks: HEALTH,
      nameHints: ["icd", "icd 10", "diagnosis code", "dx"],
    },
  ),
  entry(
    "drug-code",
    "Drug code (NDC)",
    C.Health,
    S.Confidential,
    "A US National Drug Code, next to words that say so.",
    { frameworks: HEALTH, nameHints: ["ndc", "drug code"] },
  ),
  entry(
    "us-dea-number",
    "US DEA number",
    C.Health,
    S.Confidential,
    "A prescriber's Drug Enforcement Administration number with a valid check digit.",
    { country: "US", frameworks: HEALTH, nameHints: ["dea", "dea number"] },
  ),
  entry(
    "us-npi",
    "US provider ID (NPI)",
    C.Health,
    S.Internal,
    "A National Provider Identifier. It names a care provider, not a patient.",
    { country: "US", frameworks: HEALTH, nameHints: ["npi"] },
  ),
  entry(
    "health-information",
    "Health information",
    C.Health,
    S.Restricted,
    "Diagnoses, conditions, medications and other health details, found from the field's name.",
    {
      frameworks: HEALTH,
      foundBy: "name",
      nameHints: [
        "diagnosis",
        "condition",
        "medication",
        "prescription",
        "allergy",
        "allergies",
        "treatment",
        "symptom",
        "symptoms",
        "disease",
        "medical history",
        "blood type",
        "disability",
        "pregnancy",
      ],
    },
  ),

  // Secrets and credentials.
  secret(
    "aws-access-key-id",
    "AWS access key ID",
    "The public half of an AWS access key. With its secret it signs AWS requests.",
    ["aws access key id", "access key id"],
  ),
  secret(
    "aws-secret-access-key",
    "AWS secret access key",
    "The secret half of an AWS access key, next to words that say so.",
    ["aws secret access key", "secret access key"],
  ),
  secret("google-api-key", "Google API key", "A Google Cloud or Maps API key."),
  secret(
    "google-service-account-key",
    "Google service account key",
    "A Google Cloud service account key file with its private key.",
  ),
  secret(
    "google-oauth-client-secret",
    "Google OAuth client secret",
    "A Google OAuth client secret.",
  ),
  secret(
    "azure-storage-account-key",
    "Azure storage account key",
    "An Azure storage account key or a connection string carrying one.",
  ),
  secret(
    "azure-sas-token",
    "Azure SAS token",
    "An Azure shared access signature, which grants access without a sign-in.",
  ),
  secret(
    "azure-client-secret",
    "Azure client secret",
    "A Microsoft Entra ID application client secret.",
  ),
  secret(
    "github-token",
    "GitHub token",
    "A GitHub personal access, OAuth, app or fine-grained token.",
  ),
  secret("gitlab-token", "GitLab token", "A GitLab personal access token."),
  secret("slack-token", "Slack token", "A Slack bot, user or app token."),
  secret(
    "slack-webhook-url",
    "Slack webhook URL",
    "A Slack incoming webhook, which lets anyone post to a channel.",
  ),
  secret(
    "stripe-secret-key",
    "Stripe secret key",
    "A Stripe live secret or restricted key, which can move money.",
  ),
  secret(
    "twilio-api-key",
    "Twilio API key",
    "A Twilio API key SID with secret.",
  ),
  secret("sendgrid-api-key", "SendGrid API key", "A SendGrid API key."),
  secret("mailgun-api-key", "Mailgun API key", "A Mailgun API key."),
  secret("mailchimp-api-key", "Mailchimp API key", "A Mailchimp API key."),
  secret(
    "openai-api-key",
    "OpenAI API key",
    "An OpenAI API key, which spends the account's credit.",
  ),
  secret("anthropic-api-key", "Anthropic API key", "An Anthropic API key."),
  secret("huggingface-token", "Hugging Face token", "A Hugging Face token."),
  secret(
    "npm-token",
    "npm token",
    "An npm access token, which can publish packages.",
  ),
  secret("pypi-token", "PyPI token", "A PyPI upload token."),
  secret(
    "docker-hub-token",
    "Docker Hub token",
    "A Docker Hub personal access token.",
  ),
  secret("shopify-token", "Shopify token", "A Shopify access or app token."),
  secret("square-token", "Square token", "A Square access token or secret."),
  secret(
    "braintree-access-token",
    "Braintree access token",
    "A Braintree production access token.",
  ),
  secret(
    "digitalocean-token",
    "DigitalOcean token",
    "A DigitalOcean personal access token.",
  ),
  secret("new-relic-api-key", "New Relic API key", "A New Relic user API key."),
  secret(
    "datadog-api-key",
    "Datadog API key",
    "A Datadog API or application key, next to words that say so.",
  ),
  secret(
    "vault-token",
    "HashiCorp Vault token",
    "A HashiCorp Vault service token.",
  ),
  secret(
    "terraform-cloud-token",
    "Terraform Cloud token",
    "A Terraform Cloud or Enterprise API token.",
  ),
  secret(
    "atlassian-api-token",
    "Atlassian API token",
    "An Atlassian API token.",
  ),
  secret("linear-api-key", "Linear API key", "A Linear API key."),
  secret(
    "json-web-token",
    "JSON web token",
    "A signed JWT, often a session or access token.",
    ["jwt", "id token", "access token"],
  ),
  secret(
    "private-key",
    "Private key",
    "A PEM, OpenSSH or PGP private key block.",
    ["private key", "privatekey"],
  ),
  secret(
    "password-in-url",
    "Password in a URL",
    "A URL that carries a user name and password, such as a database connection string.",
  ),
  secret(
    "connection-string-password",
    "Password in a connection string",
    "A Password= or Pwd= value in a connection string.",
  ),
  secret(
    "authorization-header",
    "Authorization header",
    "A Basic or Bearer credential copied from an HTTP Authorization header.",
    ["authorization", "auth header"],
  ),
  secret(
    "generic-secret",
    "Password or secret",
    "A value assigned to a password, secret, API key or token, that looks random enough to be real.",
    [
      "password",
      "passwd",
      "pwd",
      "secret",
      "api key",
      "apikey",
      "access token",
      "auth token",
      "client secret",
      "private token",
    ],
  ),
  secret(
    "bitcoin-private-key",
    "Bitcoin private key",
    "A Bitcoin private key in wallet import format, with a valid checksum.",
  ),

  // Special category (GDPR Article 9) and criminal offences (Article 10).
  entry(
    "racial-or-ethnic-origin",
    "Racial or ethnic origin",
    C.SpecialCategory,
    S.Restricted,
    "Race or ethnicity, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["race", "ethnicity", "ethnic origin", "ethnic group"],
    },
  ),
  entry(
    "religious-belief",
    "Religious belief",
    C.SpecialCategory,
    S.Restricted,
    "Religion or belief, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["religion", "religious", "faith", "belief"],
    },
  ),
  entry(
    "sexual-orientation",
    "Sexual orientation",
    C.SpecialCategory,
    S.Restricted,
    "Sexual orientation, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["sexual orientation", "orientation", "sexuality"],
    },
  ),
  entry(
    "political-opinion",
    "Political opinion",
    C.SpecialCategory,
    S.Restricted,
    "Political opinions or party membership, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["political", "political party", "party affiliation"],
    },
  ),
  entry(
    "trade-union-membership",
    "Trade union membership",
    C.SpecialCategory,
    S.Restricted,
    "Trade union membership, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["union membership", "trade union", "union member"],
    },
  ),
  entry(
    "biometric-data",
    "Biometric data",
    C.SpecialCategory,
    S.Restricted,
    "Fingerprints, face templates, voice prints and other biometrics, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: [
        "fingerprint",
        "biometric",
        "biometrics",
        "face template",
        "face encoding",
        "iris",
        "voiceprint",
        "retina",
      ],
    },
  ),
  entry(
    "genetic-data",
    "Genetic data",
    C.SpecialCategory,
    S.Restricted,
    "DNA and genome data, found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: ["dna", "genome", "genetic", "genotype", "snp"],
    },
  ),
  entry(
    "criminal-record",
    "Criminal record",
    C.SpecialCategory,
    S.Restricted,
    "Criminal convictions and offences (GDPR Article 10), found from the field's name.",
    {
      frameworks: PERSONAL,
      foundBy: "name",
      nameHints: [
        "criminal record",
        "conviction",
        "convictions",
        "offence",
        "offense",
        "background check",
      ],
    },
  ),

  // Business confidential.
  entry(
    "privileged-document",
    "Legally privileged document",
    C.BusinessConfidential,
    S.Restricted,
    "A document marked attorney-client privileged or legally privileged.",
  ),
  entry(
    "confidential-document",
    "Document marked confidential",
    C.BusinessConfidential,
    S.Confidential,
    "A document marked confidential, strictly confidential or a trade secret.",
  ),
  entry(
    "internal-document",
    "Document marked internal",
    C.BusinessConfidential,
    S.Internal,
    "A document marked internal use only or not for distribution.",
  ),
];

const DATA_TYPES_BY_ID: ReadonlyMap<string, DataTypeInfo> = new Map(
  DATA_TYPE_CATALOG.map((info: DataTypeInfo) => {
    return [info.id, info];
  }),
);

export function getBuiltInDataType(id: string): DataTypeInfo | undefined {
  return DATA_TYPES_BY_ID.get(id);
}

export function isBuiltInDataType(id: string): boolean {
  return DATA_TYPES_BY_ID.has(id);
}
