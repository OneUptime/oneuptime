import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  alphanumericUpper,
  containsAny,
  DataTypeDetector,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
} from "../Detector";
import { isRealDate } from "../Validators";

/*
 * CONTACT AND IDENTITY: WHO SOMEONE IS AND HOW TO REACH THEM.
 *
 * These are the most common personal data in any store and in any log, so
 * each detector errs toward proof: an email's domain must end in a real
 * top-level label (not ".png"), an IP address must be public, a date counts
 * as a birth date only next to words that say so.
 */

// Reserved for documentation and testing (RFC 2606, RFC 6761).
const RESERVED_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
]);

const RESERVED_EMAIL_SUFFIXES: ReadonlyArray<string> = [
  ".example",
  ".test",
  ".invalid",
  ".localhost",
  ".example.com",
  ".example.org",
  ".example.net",
];

/*
 * Labels after the last dot that are file extensions, not top-level
 * domains: "logo@2x.png" is an image asset, "icon@3x.webp" too.
 */
const FILE_EXTENSION_LABELS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "map",
  "json",
  "html",
  "htm",
  "txt",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "scss",
  "less",
  "md",
  "yml",
  "yaml",
  "lock",
]);

const EMAIL_PATTERN: RegExp =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;

export function isValidEmail(email: string): boolean {
  const at: number = email.lastIndexOf("@");

  if (at < 1) {
    return false;
  }

  const local: string = email.slice(0, at);
  const domain: string = email.slice(at + 1);

  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain.includes("..")
  ) {
    return false;
  }

  const labels: Array<string> = domain.split(".");

  for (const label of labels) {
    if (
      label.length === 0 ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return false;
    }
  }

  return !FILE_EXTENSION_LABELS.has(labels[labels.length - 1]!.toLowerCase());
}

export function isTestEmail(email: string): boolean {
  const domain: string = email.slice(email.lastIndexOf("@") + 1).toLowerCase();

  if (RESERVED_EMAIL_DOMAINS.has(domain) || domain === "localhost") {
    return true;
  }

  return RESERVED_EMAIL_SUFFIXES.some((suffix: string) => {
    return domain.endsWith(suffix);
  });
}

const emailDetector: DataTypeDetector = {
  dataTypeId: "email-address",
  quickCheck: containsAny(["@"]),
  pattern: EMAIL_PATTERN,
  normalize: (value: string): string => {
    return value.toLowerCase();
  },
  validate: (normalized: string): boolean => {
    return isValidEmail(normalized);
  },
  keywords: ["email", "e-mail", "mail", "contact", "to:", "from:", "cc:"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  isTestValue: isTestEmail,
};

/*
 * ITU-T E.164 country calling codes that are in use. A "+" number whose
 * first one to three digits are none of these is no phone number.
 */
const COUNTRY_CALLING_CODES: ReadonlySet<string> = new Set([
  "1",
  "7",
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
  "211",
  "212",
  "213",
  "216",
  "218",
  "220",
  "221",
  "222",
  "223",
  "224",
  "225",
  "226",
  "227",
  "228",
  "229",
  "230",
  "231",
  "232",
  "233",
  "234",
  "235",
  "236",
  "237",
  "238",
  "239",
  "240",
  "241",
  "242",
  "243",
  "244",
  "245",
  "246",
  "248",
  "249",
  "250",
  "251",
  "252",
  "253",
  "254",
  "255",
  "256",
  "257",
  "258",
  "260",
  "261",
  "262",
  "263",
  "264",
  "265",
  "266",
  "267",
  "268",
  "269",
  "290",
  "291",
  "297",
  "298",
  "299",
  "350",
  "351",
  "352",
  "353",
  "354",
  "355",
  "356",
  "357",
  "358",
  "359",
  "370",
  "371",
  "372",
  "373",
  "374",
  "375",
  "376",
  "377",
  "378",
  "380",
  "381",
  "382",
  "383",
  "385",
  "386",
  "387",
  "389",
  "420",
  "421",
  "423",
  "500",
  "501",
  "502",
  "503",
  "504",
  "505",
  "506",
  "507",
  "508",
  "509",
  "590",
  "591",
  "592",
  "593",
  "594",
  "595",
  "596",
  "597",
  "598",
  "599",
  "670",
  "672",
  "673",
  "674",
  "675",
  "676",
  "677",
  "678",
  "679",
  "680",
  "681",
  "682",
  "683",
  "685",
  "686",
  "687",
  "688",
  "689",
  "690",
  "691",
  "692",
  "850",
  "852",
  "853",
  "855",
  "856",
  "880",
  "886",
  "960",
  "961",
  "962",
  "963",
  "964",
  "965",
  "966",
  "967",
  "968",
  "970",
  "971",
  "972",
  "973",
  "974",
  "975",
  "976",
  "977",
  "992",
  "993",
  "994",
  "995",
  "996",
  "998",
]);

export function hasCountryCallingCode(digits: string): boolean {
  for (let length: number = 1; length <= 3; length++) {
    if (COUNTRY_CALLING_CODES.has(digits.slice(0, length))) {
      return true;
    }
  }

  return false;
}

/*
 * Numbers set aside for fiction and examples: North America's 555-0100 to
 * 555-0199, and Ofcom's drama ranges (07700 900000 to 900999, 020 7946 0000
 * to 0999).
 */
export function isTestPhoneNumber(digits: string): boolean {
  const national: string =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (national.length === 10 && national.slice(3, 7) === "5550") {
    const line: number = Number(national.slice(6, 10));

    return line >= 100 && line <= 199;
  }

  const uk: string = digits.startsWith("44") ? "0" + digits.slice(2) : digits;

  return uk.startsWith("07700900") || uk.startsWith("02079460");
}

const PHONE_KEYWORDS: ReadonlyArray<string> = [
  "phone",
  "tel",
  "mobile",
  "cell",
  "call",
  "sms",
  "whatsapp",
  "fax",
  "contact",
];

// "+44 20 7946 0958", "+1 (415) 555-2671": a calling code and 7 to 14 digits.
const INTERNATIONAL_PHONE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+])\+[1-9][0-9 ().-]{6,22}[0-9](?![0-9])/g;

function hasSaneSeparators(raw: string): boolean {
  let open: number = 0;
  let separatorRun: number = 0;

  for (const character of raw) {
    if (character === "(") {
      open++;
    } else if (character === ")") {
      open--;

      if (open < 0) {
        return false;
      }
    }

    if (character === " " || character === "-" || character === ".") {
      separatorRun++;

      if (separatorRun > 2) {
        return false;
      }
    } else {
      separatorRun = 0;
    }
  }

  return open === 0;
}

const internationalPhoneDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: containsAny(["+"]),
  pattern: INTERNATIONAL_PHONE_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string, raw: string): boolean => {
    return (
      digits.length >= 8 &&
      digits.length <= 15 &&
      hasCountryCallingCode(digits) &&
      !isPlaceholderDigits(digits.slice(1)) &&
      hasSaneSeparators(raw)
    );
  },
  keywords: PHONE_KEYWORDS,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isTestPhoneNumber,
};

/*
 * North America written the way people write it - "(415) 555-2671",
 * "415-555-2671", "415.555.2671": the area code and exchange start 2 to 9
 * and are not N11 service codes.
 */
const NANP_FORMATTED_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:\([2-9][0-9]{2}\)[ ]?|[2-9][0-9]{2}[-.])[2-9][0-9]{2}[-.][0-9]{4}(?![0-9])/g;

function isValidNanp(digits: string): boolean {
  const national: string =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (national.length !== 10) {
    return false;
  }

  // N11 codes (211, 311 ... 911) are services, never an area or exchange.
  return (
    national.slice(1, 3) !== "11" &&
    national.slice(4, 6) !== "11" &&
    national[0]! >= "2" &&
    national[3]! >= "2"
  );
}

const nanpFormattedDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: hasDigit,
  pattern: NANP_FORMATTED_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return isValidNanp(digits) && !isPlaceholderDigits(digits);
  },
  keywords: PHONE_KEYWORDS,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isTestPhoneNumber,
};

// A UK mobile: 07 and nine more digits, often as 07xxx xxxxxx.
const UK_MOBILE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+])07[0-9]{3}[ ]?[0-9]{3}[ ]?[0-9]{3}(?![0-9])/g;

const ukMobileDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: containsAny(["07"]),
  pattern: UK_MOBILE_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return digits.length === 11 && !isPlaceholderDigits(digits.slice(2));
  },
  keywords: PHONE_KEYWORDS,
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 1,
  isTestValue: isTestPhoneNumber,
};

// Any national number of 9 to 12 digits, only next to phone words.
const NATIONAL_PHONE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+])0?[1-9][0-9]{8,11}(?![0-9])/g;

const nationalPhoneDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: hasDigit,
  pattern: NATIONAL_PHONE_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return !isPlaceholderDigits(digits);
  },
  keywords: PHONE_KEYWORDS,
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  isTestValue: isTestPhoneNumber,
  fieldValuePattern: /^\+?[0-9][0-9 ().-]{6,22}[0-9]$/,
};

/*
 * A street address in the English-speaking style: a house number, a street
 * name and a street type. Most addresses in most stores look like this, and
 * the street type is what keeps "12 apples" out.
 */
const STREET_ADDRESS_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[0-9]{1,6}[A-Za-z]?[ ](?:[A-Z][A-Za-z.'-]{1,24}[ ]){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Square|Sq|Trail|Close|Crescent|Grove|Gardens|Row|Mews)\.?(?![A-Za-z])/g;

const streetAddressDetector: DataTypeDetector = {
  dataTypeId: "postal-address",
  quickCheck: hasDigit,
  pattern: STREET_ADDRESS_PATTERN,
  keywords: [
    "address",
    "street",
    "ship to",
    "bill to",
    "deliver",
    "residence",
    "lives at",
  ],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{1,6}[A-Za-z]?[ ,].{3,120}$/,
};

// "SW1A 1AA", "EC1A 1BB": a UK postcode with its space.
const UK_POSTCODE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{1,2}[0-9][A-Z0-9]?[ ][0-9][A-BD-HJLNP-UW-Z]{2}(?![A-Za-z0-9])/g;

const ukPostcodeDetector: DataTypeDetector = {
  dataTypeId: "postal-code",
  quickCheck: hasDigit,
  pattern: UK_POSTCODE_PATTERN,
  keywords: ["postcode", "post code", "address", "zip"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
};

// "K1A 0B1": a Canadian postal code; D, F, I, O, Q and U never appear.
const CANADA_POSTAL_CODE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][ ]?[0-9][ABCEGHJ-NPRSTV-Z][0-9](?![A-Za-z0-9])/g;

const canadaPostalCodeDetector: DataTypeDetector = {
  dataTypeId: "postal-code",
  quickCheck: hasDigit,
  pattern: CANADA_POSTAL_CODE_PATTERN,
  keywords: ["postal code", "postal", "address", "zip"],
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 2,
};

// A US ZIP or ZIP+4, only next to words that say so.
const US_ZIP_PATTERN: RegExp = /(?<![0-9-])[0-9]{5}(?:-[0-9]{4})?(?![0-9-])/g;

const usZipDetector: DataTypeDetector = {
  dataTypeId: "postal-code",
  quickCheck: hasDigit,
  pattern: US_ZIP_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return digits.slice(0, 5) !== "00000";
  },
  keywords: ["zip", "zip code", "zipcode", "postal"],
  requiresContext: true,
  contextBefore: 24,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{5}(?:-[0-9]{4})?$/,
};

const BIRTH_KEYWORDS: ReadonlyArray<string> = [
  "dob",
  "d.o.b",
  "date of birth",
  "birth",
  "born",
  "birthday",
  "geboren",
  "geburtsdatum",
  "naissance",
  "nacimiento",
  "nascimento",
  "nascita",
  "fodselsdato",
];

const MONTH_NAMES: ReadonlyArray<string> = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/*
 * Whether a written date is a real one in a plausible birth year: from 1900
 * to this year. Reads ISO (1985-03-12), day-first (12/03/1985, 12.03.1985),
 * month-first (03/12/1985) and month names (12 March 1985, March 12, 1985);
 * an ambiguous numeric date counts when either reading is real.
 */
export function isPlausibleBirthDate(raw: string): boolean {
  const thisYear: number = new Date().getUTCFullYear();
  const lower: string = raw.toLowerCase();
  const numbers: Array<number> = (lower.match(/[0-9]{1,4}/g) || []).map(
    (part: string) => {
      return Number(part);
    },
  );

  const plausibleYear: (year: number) => boolean = (year: number): boolean => {
    return year >= 1900 && year <= thisYear;
  };

  const monthIndex: number = MONTH_NAMES.findIndex((month: string) => {
    return lower.includes(month);
  });

  if (monthIndex >= 0 && numbers.length === 2) {
    const day: number = numbers[0]! > 31 ? numbers[1]! : numbers[0]!;
    const year: number = numbers[0]! > 31 ? numbers[0]! : numbers[1]!;

    return plausibleYear(year) && isRealDate(year, monthIndex + 1, day);
  }

  if (numbers.length !== 3) {
    return false;
  }

  const [first, second, third] = numbers as [number, number, number];

  if (first >= 1000) {
    return plausibleYear(first) && isRealDate(first, second, third);
  }

  return (
    plausibleYear(third) &&
    (isRealDate(third, second, first) || isRealDate(third, first, second))
  );
}

const NUMERIC_DATE_PATTERN: RegExp =
  /(?<![0-9])(?:(?:19|20)[0-9]{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12][0-9]|3[01])|(?:0?[1-9]|[12][0-9]|3[01])[-/.](?:0?[1-9]|[12][0-9]|3[01])[-/.](?:19|20)[0-9]{2})(?![0-9])/g;

const WRITTEN_DATE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:[0-9]{1,2}[ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?[ ,]{1,2}(?:19|20)[0-9]{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?[ ][0-9]{1,2},?[ ](?:19|20)[0-9]{2})(?![A-Za-z0-9])/gi;

const numericBirthDateDetector: DataTypeDetector = {
  dataTypeId: "date-of-birth",
  quickCheck: hasDigit,
  pattern: NUMERIC_DATE_PATTERN,
  validate: (_normalized: string, raw: string): boolean => {
    return isPlausibleBirthDate(raw);
  },
  keywords: BIRTH_KEYWORDS,
  requiresContext: true,
  contextBefore: 40,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern:
    /^(?:(?:19|20)[0-9]{2}[-/.][0-9]{1,2}[-/.][0-9]{1,2}(?:[T ][0-9:.Z+-]{0,30})?|[0-9]{1,2}[-/.][0-9]{1,2}[-/.](?:19|20)[0-9]{2})$/,
};

const writtenBirthDateDetector: DataTypeDetector = {
  dataTypeId: "date-of-birth",
  quickCheck: hasDigit,
  pattern: WRITTEN_DATE_PATTERN,
  validate: (_normalized: string, raw: string): boolean => {
    return isPlausibleBirthDate(raw);
  },
  keywords: BIRTH_KEYWORDS,
  requiresContext: true,
  contextBefore: 40,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
};

/*
 * IPv4 addresses that point at no one: private, loopback, link-local,
 * carrier-grade NAT, multicast and reserved. GDPR counts an address as
 * personal data because it can be tied to a subscriber; these cannot.
 */
export function isPublicIpv4(address: string): boolean {
  const octets: Array<number> = address.split(".").map((part: string) => {
    return Number(part);
  });

  if (octets.length !== 4) {
    return false;
  }

  const [a, b] = octets as [number, number, number, number];

  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

// The ranges RFC 5737 sets aside for documentation.
export function isDocumentationIpv4(address: string): boolean {
  return (
    address.startsWith("192.0.2.") ||
    address.startsWith("198.51.100.") ||
    address.startsWith("203.0.113.")
  );
}

const IPV4_PATTERN: RegExp =
  /(?<![0-9.])(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}(?![0-9]|\.[0-9])/g;

const ipv4Detector: DataTypeDetector = {
  dataTypeId: "ip-address",
  quickCheck: containsAny(["."]),
  pattern: IPV4_PATTERN,
  validate: (normalized: string): boolean => {
    return isPublicIpv4(normalized) || isDocumentationIpv4(normalized);
  },
  keywords: ["ip", "address", "client", "remote", "forwarded", "src", "source"],
  negativeKeywords: ["version", "v.", "build", "release", "oid"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isDocumentationIpv4,
};

/*
 * Whether text is an IPv6 address that names one host on the internet:
 * eight groups, or fewer around a single "::", and none of loopback,
 * link-local, unique-local, multicast or the documentation prefix.
 */
export function isPublicIpv6(address: string): boolean {
  const lower: string = address.toLowerCase();
  const doubleColons: number = lower.split("::").length - 1;

  if (doubleColons > 1) {
    return false;
  }

  const groups: Array<string> = lower.split(":").filter((group: string) => {
    return group.length > 0;
  });

  if (doubleColons === 0 ? groups.length !== 8 : groups.length > 7) {
    return false;
  }

  for (const group of groups) {
    if (group.length > 4) {
      return false;
    }
  }

  const first: number = parseInt(groups[0] || "0", 16);

  return !(
    lower === "::" ||
    lower === "::1" ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    first === 0
  );
}

// 2001:db8::/32, however its groups are written: 2001:db8:: or 2001:0db8:...
function isDocumentationIpv6(address: string): boolean {
  const groups: Array<string> = address.split(":");

  return (
    groups.length > 2 &&
    groups[1]!.length > 0 &&
    parseInt(groups[0]!, 16) === 0x2001 &&
    parseInt(groups[1]!, 16) === 0x0db8
  );
}

/*
 * Groups and colons, the last group either written out or after a "::"
 * that may end the address (2001:db8::) or lead to up to six more groups
 * (2001:db8::8a2e:370:7334) - the way addresses are usually written.
 */
const IPV6_PATTERN: RegExp =
  /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,7}(?:[0-9A-Fa-f]{1,4}|:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5})?)(?![0-9A-Fa-f:])/g;

const ipv6Detector: DataTypeDetector = {
  dataTypeId: "ip-address",
  quickCheck: containsAny([":"]),
  pattern: IPV6_PATTERN,
  validate: (normalized: string): boolean => {
    return (
      (isPublicIpv6(normalized) || isDocumentationIpv6(normalized)) &&
      // A clock reads 12:30:45 - an address has hex letters or many groups.
      normalized.split(":").length >= 4
    );
  },
  keywords: ["ip", "address", "client", "remote", "forwarded", "ipv6"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isDocumentationIpv6,
};

const MAC_PATTERN: RegExp =
  /(?<![0-9A-Fa-f:-])[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){4}(?![0-9A-Fa-f:-])/g;

const macDetector: DataTypeDetector = {
  dataTypeId: "mac-address",
  quickCheck: containsAny([":", "-"]),
  pattern: MAC_PATTERN,
  normalize: (value: string): string => {
    return value.toLowerCase().replace(/-/g, ":");
  },
  validate: (normalized: string, raw: string): boolean => {
    // One separator throughout, and not all zeros or the broadcast address.
    const separators: Set<string> = new Set(raw.replace(/[0-9A-Fa-f]/g, ""));

    return (
      separators.size === 1 &&
      normalized !== "00:00:00:00:00:00" &&
      normalized !== "ff:ff:ff:ff:ff:ff"
    );
  },
  keywords: ["mac", "hwaddr", "ether", "device", "bssid"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
};

const UUID_PATTERN: RegExp =
  /(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f-])/g;

const advertisingIdDetector: DataTypeDetector = {
  dataTypeId: "advertising-id",
  quickCheck: containsAny(["-"]),
  pattern: UUID_PATTERN,
  normalize: (value: string): string => {
    return value.toLowerCase();
  },
  keywords: [
    "idfa",
    "gaid",
    "aaid",
    "adid",
    "advertising",
    "ad_id",
    "advertisingid",
  ],
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  // The zeroed ID a device reports when the person turned tracking off.
  isTestValue: (normalized: string): boolean => {
    return normalized === "00000000-0000-0000-0000-000000000000";
  },
  fieldValuePattern:
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/,
};

/*
 * A latitude and longitude pair with at least four decimals - about 11
 * metres, enough to find a building.
 */
const COORDINATE_PAIR_PATTERN: RegExp =
  /(?<![0-9.-])-?[0-9]{1,2}\.[0-9]{4,10}[ ]?,[ ]?-?[0-9]{1,3}\.[0-9]{4,10}(?![0-9])/g;

const coordinatePairDetector: DataTypeDetector = {
  dataTypeId: "geolocation",
  quickCheck: containsAny(["."]),
  pattern: COORDINATE_PAIR_PATTERN,
  validate: (normalized: string): boolean => {
    const [latitude, longitude] = normalized.split(",").map((part: string) => {
      return Number(part.trim());
    }) as [number, number];

    return (
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      !(latitude === 0 && longitude === 0)
    );
  },
  keywords: [
    "lat",
    "lng",
    "lon",
    "latitude",
    "longitude",
    "location",
    "coordinates",
    "geo",
    "gps",
  ],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
};

// One coordinate, only in a field named for it ("lat": 37.77493).
const SINGLE_COORDINATE_PATTERN: RegExp =
  /(?<![0-9.-])-?[0-9]{1,3}\.[0-9]{4,10}(?![0-9])/g;

const singleCoordinateDetector: DataTypeDetector = {
  dataTypeId: "geolocation",
  quickCheck: containsAny(["."]),
  pattern: SINGLE_COORDINATE_PATTERN,
  validate: (normalized: string): boolean => {
    return Math.abs(Number(normalized)) <= 180;
  },
  keywords: ["lat", "lng", "lon", "latitude", "longitude"],
  requiresContext: true,
  contextBefore: 16,
  contextAfter: 2,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^-?[0-9]{1,3}\.[0-9]{4,10}$/,
};

/*
 * The North American VIN check digit (position 9): letters transliterate to
 * numbers, positions carry fixed weights, and the sum modulo 11 is the
 * check digit (10 written as X). I, O and Q never appear.
 */
const VIN_TRANSLITERATION: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};

const VIN_WEIGHTS: ReadonlyArray<number> = [
  8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2,
];

const ANY_DIGIT: RegExp = /[0-9]/;
const ANY_CAPITAL: RegExp = /[A-Z]/;

export function isValidVin(vin: string): boolean {
  if (vin.length !== 17 || !ANY_DIGIT.test(vin) || !ANY_CAPITAL.test(vin)) {
    return false;
  }

  let sum: number = 0;

  for (let index: number = 0; index < 17; index++) {
    const character: string = vin[index]!;
    const value: number | undefined =
      character >= "0" && character <= "9"
        ? Number(character)
        : VIN_TRANSLITERATION[character];

    if (value === undefined) {
      return false;
    }

    sum += value * VIN_WEIGHTS[index]!;
  }

  const check: number = sum % 11;

  return vin[8] === (check === 10 ? "X" : String(check));
}

const VIN_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Za-z0-9])/g;

const vinDetector: DataTypeDetector = {
  dataTypeId: "vehicle-identification-number",
  quickCheck: hasDigit,
  pattern: VIN_PATTERN,
  normalize: alphanumericUpper,
  validate: isValidVin,
  keywords: ["vin", "vehicle", "chassis", "car", "registration"],
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 2,
};

export const CONTACT_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  emailDetector,
  internationalPhoneDetector,
  nanpFormattedDetector,
  ukMobileDetector,
  nationalPhoneDetector,
  streetAddressDetector,
  ukPostcodeDetector,
  canadaPostalCodeDetector,
  usZipDetector,
  numericBirthDateDetector,
  writtenBirthDateDetector,
  ipv4Detector,
  ipv6Detector,
  macDetector,
  advertisingIdDetector,
  coordinatePairDetector,
  singleCoordinateDetector,
  vinDetector,
];

export default CONTACT_DETECTORS;
