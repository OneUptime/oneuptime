import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataTypeDetector,
  alphanumericUpper,
  containsAny,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
} from "../Detector";
import {
  decimalStringMod,
  digitAt,
  ean13,
  isRealDate,
  isRealTwoDigitYearDate,
  iso7064Mod11Mod10,
  luhn,
  twoDigits,
  verhoeff,
  weightedDigitSum,
} from "../Validators";

/*
 * GOVERNMENT IDS: HOW EACH COUNTRY'S NUMBER IS TOLD FROM ANY OTHER RUN OF
 * DIGITS.
 *
 * Most national IDs carry their own proof - a check digit worked out from
 * the rest (Luhn, a mod 11 or mod 97 sum, ISO 7064, Verhoeff, a letter
 * table), and often the holder's birth date, sex or region written in. A
 * candidate is a finding only when that arithmetic and those dates hold, so
 * twelve digits are not an Aadhaar number unless Verhoeff says so. Each
 * detector's comment says what proves it.
 *
 * How sure a value is on its own follows from what proves it:
 *
 *  - High: a check digit on a shape no other number shares - letters or a
 *    fixed prefix (a CURP, a codice fiscale, 756 for a Swiss AHV number).
 *  - Medium: a check digit on a shape other numbers share - eleven digits,
 *    even with a birth date in them.
 *  - Low: the format alone (an SSN's ranges, a passport number). Nothing in
 *    the value proves what it is.
 *
 * Some count only beside a word that names them (`requiresContext`): a
 * number with no check and a common shape (a passport, a driver's license,
 * an EIN), and a plain run of nine to thirteen digits that a single check
 * digit proves - one random number in ten or eleven passes, and Unix
 * timestamps and phone numbers have those lengths. Where the grouped form
 * is distinctive and the bare one is not (an SSN as 123-45-6789 or as
 * 123456789), the type has a detector for each. Every detector refuses
 * placeholders (000000000, 123456789), and the samples that agencies and
 * documentation publish are counted apart as test values.
 *
 * Patterns keep Detector.ts's rules: global, every quantifier bounded, never
 * inside a longer token. A number typed in groups is also not taken from a
 * longer chain of groups: 123-45-6789-01 holds no SSN.
 */

/*
 * The value upper-cased without the spaces, dashes, dots and slashes people
 * group it with - keeping the Ñ and & of a Mexican RFC, which
 * alphanumericUpper would drop.
 */
function withoutSeparators(value: string): string {
  let kept: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;

    if (
      character !== " " &&
      character !== "-" &&
      character !== "." &&
      character !== "/"
    ) {
      kept += character;
    }
  }

  return kept.toUpperCase();
}

// An isTestValue check: whether a normalized value is one of these samples.
function sampleValues(
  values: ReadonlyArray<string>,
): (normalized: string) => boolean {
  const samples: ReadonlySet<string> = new Set(values);

  return (normalized: string): boolean => {
    return samples.has(normalized);
  };
}

/*
 * The check digit most mod 11 schemes share: 11 less the remainder of the
 * weighted sum, where a remainder of 0 or 1 gives 0 (Brazil's CPF and CNPJ,
 * Portugal's NIF, Japan's My Number).
 */
function mod11CheckDigit(sum: number): number {
  const remainder: number = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

// A value with no placeholder digits: neither 000000000 nor 123456789.
function isNotPlaceholder(value: string): boolean {
  return !isPlaceholderDigits(digitsOnly(value));
}

// NORTH AMERICA.

/*
 * The SSA's rules for an SSN, which has no check digit: no area 000, 666
 * or 900-999 (never issued - 9xx is the ITIN's), no group 00, no serial
 * 0000.
 */
function isUsSsn(digits: string): boolean {
  if (digits.length !== 9 || isPlaceholderDigits(digits)) {
    return false;
  }

  const area: number = Number(digits.slice(0, 3));

  return (
    area !== 0 &&
    area !== 666 &&
    area < 900 &&
    digits.slice(3, 5) !== "00" &&
    digits.slice(5) !== "0000"
  );
}

/*
 * SSNs printed where everyone could copy them: the Woolworth wallet card
 * (078-05-1120), a 1940 Social Security pamphlet (219-09-9999) and
 * LifeLock's advertisements (457-55-5462). The advertising range
 * 987-65-4320 to 4329 is 9xx, which no SSN has.
 */
const US_SSN_SAMPLES: (normalized: string) => boolean = sampleValues([
  "078051120",
  "219099999",
  "457555462",
]);

// An SSN in its groups, AAA-GG-SSSS, with dashes, dots or spaces.
const US_SSN_GROUPED_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-. ])[0-9]{3}(?:-[0-9]{2}-|\.[0-9]{2}\.| [0-9]{2} )[0-9]{4}(?![A-Za-z0-9]|[-. ][0-9])/g;

// An SSN as nine digits in a row.
const US_SSN_BARE_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{9}(?![A-Za-z0-9]|[-.][0-9])/g;

const US_SSN_KEYWORDS: ReadonlyArray<string> = [
  "ssn",
  "social security",
  "social security number",
  "ss number",
  "ss no",
  "soc sec",
];

// The groups the IRS issues ITINs in, after the leading 9xx.
function isItinGroup(group: number): boolean {
  return (
    (group >= 50 && group <= 65) ||
    (group >= 70 && group <= 88) ||
    (group >= 90 && group <= 92) ||
    (group >= 94 && group <= 99)
  );
}

function isUsItin(digits: string): boolean {
  return (
    digits.length === 9 &&
    digits[0] === "9" &&
    isItinGroup(twoDigits(digits, 3)) &&
    !isPlaceholderDigits(digits)
  );
}

/*
 * The range advertisements print for a made-up SSN, 987-65-4320 to 4329:
 * its group, 65, is one ITINs are issued in.
 */
function isAdvertisingNumber(digits: string): boolean {
  return digits.startsWith("98765432");
}

const US_ITIN_GROUPED_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-. ])9[0-9]{2}(?:-[0-9]{2}-|\.[0-9]{2}\.| [0-9]{2} )[0-9]{4}(?![A-Za-z0-9]|[-. ][0-9])/g;

const US_ITIN_BARE_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])9[0-9]{8}(?![A-Za-z0-9]|[-.][0-9])/g;

const US_ITIN_KEYWORDS: ReadonlyArray<string> = [
  "itin",
  "taxpayer id",
  "taxpayer identification number",
  "individual taxpayer",
];

// EIN prefixes the IRS never gave a campus, so no EIN starts with them.
const US_EIN_UNUSED_PREFIXES: ReadonlySet<string> = new Set([
  "00",
  "07",
  "08",
  "09",
  "17",
  "18",
  "19",
  "28",
  "29",
  "49",
  "69",
  "70",
  "78",
  "79",
  "89",
  "96",
  "97",
]);

const US_EIN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}-?[0-9]{7}(?![A-Za-z0-9]|[-.][0-9])/g;

function isUsEin(digits: string): boolean {
  return (
    digits.length === 9 &&
    !US_EIN_UNUSED_PREFIXES.has(digits.slice(0, 2)) &&
    !isPlaceholderDigits(digits)
  );
}

// Nine digits, or since 2021 a letter and eight digits.
const US_PASSPORT_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:[A-Za-z][0-9]{8}|[0-9]{9})(?![A-Za-z0-9])/g;

/*
 * The shapes the states use: one or two letters and digits (California's
 * A1234567, New York's 9 digits, Illinois' letter and 11), a plain run of
 * digits, and Florida's and Wisconsin's grouped letter-and-digits forms.
 */
const US_DRIVERS_LICENSE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:[A-Za-z]{1,2}[0-9]{5,14}|[0-9]{7,12}|[A-Za-z][0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{3}-[0-9]|[A-Za-z][0-9]{3}-[0-9]{4}-[0-9]{4}-[0-9]{2})(?![A-Za-z0-9]|-[0-9])/g;

// Canada's SIN, in groups of three or as nine digits.
const CA_SIN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{3}(?:-[0-9]{3}-| [0-9]{3} |\.[0-9]{3}\.|[0-9]{3})[0-9]{3}(?![A-Za-z0-9]|[-.][0-9])/g;

/*
 * The first digit says who holds a SIN: 1-7 a province, 9 a temporary
 * resident. 0 and 8 are never a person's (8 is a business number).
 */
function isCaSin(digits: string): boolean {
  const first: number = digitAt(digits, 0);

  return (
    digits.length === 9 &&
    first !== 0 &&
    first !== 8 &&
    !isPlaceholderDigits(digits) &&
    luhn(digits)
  );
}

const NORTH_AMERICA: ReadonlyArray<DataTypeDetector> = [
  /*
   * US Social Security number as AAA-GG-SSSS: the SSA's area, group and
   * serial rules, and nothing else - no check digit. The groups make it
   * worth showing (Low) even with no word around it.
   */
  {
    dataTypeId: "us-ssn",
    quickCheck: hasDigit,
    pattern: US_SSN_GROUPED_PATTERN,
    normalize: digitsOnly,
    validate: isUsSsn,
    keywords: US_SSN_KEYWORDS,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    isTestValue: US_SSN_SAMPLES,
  },
  /*
   * An SSN as nine bare digits: the same rules, but nine digits are
   * everywhere, so only beside a word that says SSN.
   */
  {
    dataTypeId: "us-ssn",
    quickCheck: hasDigit,
    pattern: US_SSN_BARE_PATTERN,
    normalize: digitsOnly,
    validate: isUsSsn,
    keywords: US_SSN_KEYWORDS,
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    isTestValue: US_SSN_SAMPLES,
  },
  /*
   * US ITIN, 9XX-GG-SSSS: always a 9 first, and a group the IRS issues in
   * (50-65, 70-88, 90-92, 94-99). No check digit.
   */
  {
    dataTypeId: "us-itin",
    quickCheck: hasDigit,
    pattern: US_ITIN_GROUPED_PATTERN,
    normalize: digitsOnly,
    validate: isUsItin,
    keywords: US_ITIN_KEYWORDS,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    isTestValue: isAdvertisingNumber,
  },
  // An ITIN as nine bare digits, only beside a word that says so.
  {
    dataTypeId: "us-itin",
    quickCheck: hasDigit,
    pattern: US_ITIN_BARE_PATTERN,
    normalize: digitsOnly,
    validate: isUsItin,
    keywords: US_ITIN_KEYWORDS,
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    isTestValue: isAdvertisingNumber,
  },
  /*
   * US EIN, XX-XXXXXXX: a prefix some IRS campus was given, no check digit.
   * Nine digits with a dash after two are common enough that only a word
   * beside it makes it one.
   */
  {
    dataTypeId: "us-ein",
    quickCheck: hasDigit,
    pattern: US_EIN_PATTERN,
    normalize: digitsOnly,
    validate: isUsEin,
    keywords: [
      "ein",
      "employer id",
      "employer identification number",
      "fein",
      "tax id",
      "federal tax id",
      "tax identification number",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * US passport number: nine digits, or a letter and eight. Nothing in it
   * is checked, and a UK number has the same shape, so it counts only
   * beside words that name a US passport; beside "passport" alone it is a
   * passport number of no country (passport-number).
   */
  {
    dataTypeId: "us-passport",
    quickCheck: hasDigit,
    pattern: US_PASSPORT_PATTERN,
    normalize: alphanumericUpper,
    validate: isNotPlaceholder,
    keywords: [
      "us passport",
      "u.s. passport",
      "usa passport",
      "united states passport",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    // Named for its country, it is a surer claim than a passport of none.
    specificity: 2,
  },
  /*
   * US driver's license number: every state has its own format and none a
   * public check digit, so any of their shapes, beside words that say so.
   */
  {
    dataTypeId: "us-drivers-license",
    quickCheck: hasDigit,
    pattern: US_DRIVERS_LICENSE_PATTERN,
    normalize: alphanumericUpper,
    validate: isNotPlaceholder,
    keywords: [
      "drivers license",
      "driver license",
      "driver's license",
      "drivers licence",
      "driving license",
      "dl number",
      "dl no",
      "dl#",
      "license number",
      "licence number",
      "license no",
      "dln",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * Canada Social Insurance Number: nine digits that pass Luhn, first digit
   * 1-7 or 9. One nine-digit number in ten passes Luhn, so beside a word.
   */
  {
    dataTypeId: "ca-sin",
    quickCheck: hasDigit,
    pattern: CA_SIN_PATTERN,
    normalize: digitsOnly,
    validate: isCaSin,
    keywords: [
      "sin",
      "social insurance",
      "social insurance number",
      "numero d'assurance sociale",
      "numéro d'assurance sociale",
      "nas",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
];

// UNITED KINGDOM.

/*
 * A NINO: two prefix letters (never D, F, I, Q, U or V first; never D, F,
 * I, O, Q, U or V second), six digits and a suffix A-D, often typed in
 * pairs: AB 12 34 56 C.
 */
const UK_NINO_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-CEGHJ-PR-TW-Za-ceghj-pr-tw-z][A-CEGHJ-NPR-TW-Za-ceghj-npr-tw-z] ?[0-9]{2} ?[0-9]{2} ?[0-9]{2} ?[A-Da-d](?![A-Za-z0-9])/g;

// Prefixes HMRC never allocates.
const UK_NINO_UNUSED_PREFIXES: ReadonlySet<string> = new Set([
  "BG",
  "GB",
  "KN",
  "NK",
  "NT",
  "TN",
  "ZZ",
]);

function isUkNino(value: string): boolean {
  return (
    value.length === 9 &&
    !UK_NINO_UNUSED_PREFIXES.has(value.slice(0, 2)) &&
    !isPlaceholderDigits(value.slice(2, 8))
  );
}

// Nine digits, or newer books' letters and digits.
const UK_PASSPORT_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:[A-Za-z]{1,2}[0-9]{7,8}|[0-9]{9})(?![A-Za-z0-9])/g;

/*
 * A DVLA licence number: five letters of the surname (padded with 9s), the
 * birth date as decade, month (plus 50 for women), day and year, two
 * initials (or one and a 9), a digit and two check characters, sometimes
 * typed in its groups: MORGA 657054 SM9 IJ.
 */
const UK_DRIVING_LICENCE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Za-z][A-Za-z9]{4} ?[0-9][0156][0-9][0-3][0-9]{2} ?[A-Za-z][A-Za-z9][0-9] ?[A-Za-z0-9]{2}(?![A-Za-z0-9])/g;

function isUkDrivingLicence(value: string): boolean {
  if (value.length !== 16) {
    return false;
  }

  // A short surname is padded with 9s, and nothing follows the padding.
  let padded: boolean = false;

  for (let index: number = 1; index < 5; index++) {
    if (value[index] === "9") {
      padded = true;
    } else if (padded) {
      return false;
    }
  }

  let month: number = twoDigits(value, 6);

  if (month > 50) {
    month -= 50;
  }

  const year: number = digitAt(value, 5) * 10 + digitAt(value, 10);

  return isRealTwoDigitYearDate(year, month, twoDigits(value, 8));
}

const UNITED_KINGDOM: ReadonlyArray<DataTypeDetector> = [
  /*
   * UK National Insurance number: HMRC's prefix and suffix rules. It has no
   * check digit, but the shape is its own, so it shows (Low) on its own.
   */
  {
    dataTypeId: "uk-nino",
    quickCheck: hasDigit,
    pattern: UK_NINO_PATTERN,
    normalize: alphanumericUpper,
    validate: isUkNino,
    keywords: [
      "nino",
      "national insurance",
      "ni number",
      "ni no",
      "national insurance number",
      "nat ins",
    ],
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * UK passport number: nine digits (newer books may start with letters),
   * with nothing to check and a US number's shape, so only beside words
   * that name a UK passport; beside "passport" alone it is a passport
   * number of no country (passport-number).
   */
  {
    dataTypeId: "uk-passport",
    quickCheck: hasDigit,
    pattern: UK_PASSPORT_PATTERN,
    normalize: alphanumericUpper,
    validate: isNotPlaceholder,
    keywords: [
      "uk passport",
      "british passport",
      "hm passport",
      "hmpo",
      "gb passport",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    // Named for its country, it is a surer claim than a passport of none.
    specificity: 2,
  },
  /*
   * UK driving licence number: its sixteen characters must hold a real
   * birth date and a properly padded surname. The two check characters'
   * algorithm is the DVLA's own, so the format is all there is (Low).
   */
  {
    dataTypeId: "uk-driving-licence",
    quickCheck: hasDigit,
    pattern: UK_DRIVING_LICENCE_PATTERN,
    normalize: alphanumericUpper,
    validate: isUkDrivingLicence,
    keywords: [
      "driving licence",
      "driving license",
      "licence number",
      "licence no",
      "dvla",
      "driver number",
    ],
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    // The licence on the DVLA's specimen photocard.
    isTestValue: sampleValues(["MORGA657054SM9IJ"]),
  },
];

// LATIN AMERICA.

/*
 * A CURP: four letters of the names (the second a vowel), the birth date,
 * H, M or X, the state of birth (NE born abroad), three consonants, a
 * homoclave (a digit before 2000, a letter after) and the check digit.
 */
const MX_CURP_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z][AEIOUX][A-Z]{2}[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[HMX](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z][0-9](?![A-Za-z0-9])/g;

// The CURP check alphabet: digits, then letters with Ñ (written &) after N.
const MX_CURP_ALPHABET: string = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ";

function isMxCurp(value: string): boolean {
  if (value.length !== 18) {
    return false;
  }

  const century: number = digitAt(value, 16) >= 0 ? 1900 : 2000;

  if (
    !isRealDate(
      century + twoDigits(value, 4),
      twoDigits(value, 6),
      twoDigits(value, 8),
    )
  ) {
    return false;
  }

  let sum: number = 0;

  for (let index: number = 0; index < 17; index++) {
    sum += MX_CURP_ALPHABET.indexOf(value[index]!) * (18 - index);
  }

  return (10 - (sum % 10)) % 10 === digitAt(value, 17);
}

/*
 * An RFC: three letters (a company) or four (a person, Ñ and & included),
 * the date of birth or founding, and a three-character homoclave whose last
 * character is 0-9 or A.
 */
const MX_RFC_PATTERN: RegExp =
  /(?<![A-Za-z0-9&Ñ])[A-Z&Ñ]{3,4}[- ]?[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[- ]?[A-Z0-9]{2}[0-9A](?![A-Za-z0-9])/g;

function isMxRfc(value: string): boolean {
  if (value.length !== 12 && value.length !== 13) {
    return false;
  }

  const date: number = value.length - 9;

  return isRealTwoDigitYearDate(
    twoDigits(value, date),
    twoDigits(value, date + 2),
    twoDigits(value, date + 4),
  );
}

const BR_CPF_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-./])[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}(?![A-Za-z0-9]|[-./][0-9])/g;

const BR_CPF_FIRST_WEIGHTS: ReadonlyArray<number> = [
  10, 9, 8, 7, 6, 5, 4, 3, 2,
];
const BR_CPF_SECOND_WEIGHTS: ReadonlyArray<number> = [
  11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
];

function isBrCpf(digits: string): boolean {
  return (
    digits.length === 11 &&
    !isPlaceholderDigits(digits) &&
    mod11CheckDigit(weightedDigitSum(digits, BR_CPF_FIRST_WEIGHTS)) ===
      digitAt(digits, 9) &&
    mod11CheckDigit(weightedDigitSum(digits, BR_CPF_SECOND_WEIGHTS)) ===
      digitAt(digits, 10)
  );
}

/*
 * A CNPJ: digits with their usual dots, slash and dash optional - or, since
 * July 2026, letters among the first twelve, which the Receita Federal
 * only ever writes grouped (12.ABC.345/01DE-35).
 */
const BR_CNPJ_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-./])(?:[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/?[0-9]{4}-?[0-9]{2}|[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2})(?![A-Za-z0-9]|[-./][0-9])/g;

const BR_CNPJ_FIRST_WEIGHTS: ReadonlyArray<number> = [
  5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2,
];
const BR_CNPJ_SECOND_WEIGHTS: ReadonlyArray<number> = [
  6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2,
];

/*
 * A CNPJ check digit. Each character counts as its character code less 48:
 * a digit as itself and a letter of the new CNPJ from 17 (A) up, as the
 * Receita Federal defines it.
 */
function brCnpjCheckDigit(
  value: string,
  weights: ReadonlyArray<number>,
): number {
  let sum: number = 0;

  for (let index: number = 0; index < weights.length; index++) {
    sum += (value.charCodeAt(index) - 48) * weights[index]!;
  }

  return mod11CheckDigit(sum);
}

function isBrCnpj(value: string): boolean {
  return (
    value.length === 14 &&
    !isPlaceholderDigits(value) &&
    brCnpjCheckDigit(value, BR_CNPJ_FIRST_WEIGHTS) === digitAt(value, 12) &&
    brCnpjCheckDigit(value, BR_CNPJ_SECOND_WEIGHTS) === digitAt(value, 13)
  );
}

/*
 * A CUIT or CUIL: the kind of holder (20, 23, 24, 27 people; 30, 33, 34
 * companies; 50, 51, 55 international), the DNI and the check digit.
 */
const AR_CUIT_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-./])(?:20|23|24|27|30|33|34|50|51|55)[- ]?[0-9]{8}[- ]?[0-9](?![A-Za-z0-9]|[-./][0-9])/g;

const AR_CUIT_WEIGHTS: ReadonlyArray<number> = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

// 11 less the remainder, where 11 gives 0 and 10 gives 9.
function arCuitCheckDigit(digits: string): number {
  const remainder: number = weightedDigitSum(digits, AR_CUIT_WEIGHTS) % 11;

  if (remainder === 0) {
    return 0;
  }

  return remainder === 1 ? 9 : 11 - remainder;
}

function isArCuit(digits: string): boolean {
  if (digits.length !== 11 || isPlaceholderDigits(digits.slice(2, 10))) {
    return false;
  }

  if (arCuitCheckDigit(digits) === digitAt(digits, 10)) {
    return true;
  }

  /*
   * Where a woman's number (27) would need the check digit 10, AFIP issues
   * it with the prefix 23 and the check digit 4 instead.
   */
  return (
    digits.startsWith("23") &&
    digitAt(digits, 10) === 4 &&
    weightedDigitSum("27" + digits.slice(2), AR_CUIT_WEIGHTS) % 11 === 1
  );
}

// A RUT: 12.345.678-5, 12345678-5 or 123456785, the check digit 0-9 or K.
const CL_RUT_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[0-9]{1,2}\.[0-9]{3}\.[0-9]{3}|[0-9]{7,8})-?[0-9Kk](?![A-Za-z0-9]|[-.][0-9])/g;

/*
 * The RUT check: the body's digits from the right times 2, 3, 4, 5, 6, 7,
 * 2, 3 ...; 11 less the remainder, where 11 is 0 and 10 is K.
 */
function isClRut(value: string): boolean {
  const body: string = value.slice(0, -1);

  if (body.length < 7 || body.length > 8 || isPlaceholderDigits(body)) {
    return false;
  }

  let sum: number = 0;
  let weight: number = 2;

  for (let index: number = body.length - 1; index >= 0; index--) {
    sum += digitAt(body, index) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }

  const check: number = 11 - (sum % 11);
  let expected: string = String(check);

  if (check === 11) {
    expected = "0";
  } else if (check === 10) {
    expected = "K";
  }

  return value.endsWith(expected);
}

const LATIN_AMERICA: ReadonlyArray<DataTypeDetector> = [
  /*
   * Mexico CURP: its eighteen characters' layout, a real birth date and
   * the mod 10 check digit over the other seventeen.
   */
  {
    dataTypeId: "mx-curp",
    quickCheck: hasDigit,
    pattern: MX_CURP_PATTERN,
    normalize: alphanumericUpper,
    validate: isMxCurp,
    keywords: [
      "curp",
      "clave unica de registro de poblacion",
      "clave única de registro de población",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
    // RENAPO's and python-stdnum's published examples.
    isTestValue: sampleValues(["HEGG560427MVZRRL04", "BOXW310820HNERXN09"]),
  },
  /*
   * Mexico RFC: its layout and a real date. The SAT issued numbers whose
   * last character fails its own check, so the check is not held against
   * one, and the format alone needs a word beside it.
   */
  {
    dataTypeId: "mx-rfc",
    quickCheck: hasDigit,
    pattern: MX_RFC_PATTERN,
    normalize: withoutSeparators,
    validate: isMxRfc,
    keywords: ["rfc", "registro federal de contribuyentes", "r.f.c."],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    // The SAT's generic RFCs for the general public and for foreigners.
    isTestValue: sampleValues(["XAXX010101000", "XEXX010101000"]),
  },
  /*
   * Brazil CPF: two mod 11 check digits, and never one digit repeated
   * (111.111.111-11 passes the arithmetic).
   */
  {
    dataTypeId: "br-cpf",
    quickCheck: hasDigit,
    pattern: BR_CPF_PATTERN,
    normalize: digitsOnly,
    validate: isBrCpf,
    keywords: [
      "cpf",
      "cadastro de pessoas fisicas",
      "cadastro de pessoas físicas",
      "cpf/mf",
      "rg",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The examples every CPF validator's documentation uses.
    isTestValue: sampleValues(["12345678909", "11144477735", "52998224725"]),
  },
  /*
   * Brazil CNPJ: two mod 11 check digits over fourteen characters, letters
   * of the alphanumeric CNPJ included.
   */
  {
    dataTypeId: "br-cnpj",
    quickCheck: hasDigit,
    pattern: BR_CNPJ_PATTERN,
    normalize: alphanumericUpper,
    validate: isBrCnpj,
    keywords: [
      "cnpj",
      "cnpj/mf",
      "cadastro nacional da pessoa juridica",
      "cadastro nacional da pessoa jurídica",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    /*
     * The textbook example, Banco do Brasil's head office (used in samples
     * everywhere) and the Receita Federal's alphanumeric example.
     */
    isTestValue: sampleValues([
      "11222333000181",
      "00000000000191",
      "12ABC34501DE35",
    ]),
  },
  /*
   * Argentina CUIT / CUIL: the holder-kind prefix and the mod 11 check
   * digit, with AFIP's 23-and-4 exception.
   */
  {
    dataTypeId: "ar-cuit",
    quickCheck: hasDigit,
    pattern: AR_CUIT_PATTERN,
    normalize: digitsOnly,
    validate: isArCuit,
    keywords: [
      "cuit",
      "cuil",
      "cdi",
      "clave unica de identificacion tributaria",
      "clave única de identificación tributaria",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 3,
  },
  /*
   * Chile RUT / RUN: the mod 11 check digit (K for 10). Seven or eight
   * digits and one check pass for one number in eleven, so beside a word.
   */
  {
    dataTypeId: "cl-rut",
    quickCheck: hasDigit,
    pattern: CL_RUT_PATTERN,
    normalize: alphanumericUpper,
    validate: isClRut,
    keywords: [
      "rut",
      "run",
      "rol unico tributario",
      "rol único tributario",
      "rol unico nacional",
      "rol único nacional",
      "cedula de identidad",
      "cédula de identidad",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
];

// WESTERN AND CENTRAL EUROPE.

// The DNI and NIE check letters, by the number's remainder modulo 23.
const ES_ID_LETTERS: string = "TRWAGMYFPDXBNJZSQVHLCKE";

// Eight digits (12.345.678 too) and the check letter, which is never I, O or U.
const ES_DNI_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[0-9]{8}|[0-9]{2}\.[0-9]{3}\.[0-9]{3})[- ]?[A-HJ-NP-TV-Z](?![A-Za-z0-9])/g;

function isEsDni(value: string): boolean {
  const digits: string = value.slice(0, 8);

  return (
    value.length === 9 &&
    !isPlaceholderDigits(digits) &&
    ES_ID_LETTERS[Number(digits) % 23] === value[8]
  );
}

const ES_NIE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[XYZxyz][- ]?[0-9]{7}[- ]?[A-HJ-NP-TV-Z](?![A-Za-z0-9])/g;

// X, Y and Z stand for 0, 1 and 2 in front of the seven digits.
function isEsNie(value: string): boolean {
  if (value.length !== 9 || isPlaceholderDigits(value.slice(1, 8))) {
    return false;
  }

  const number: number = Number(
    String("XYZ".indexOf(value[0]!)) + value.slice(1, 8),
  );

  return ES_ID_LETTERS[number % 23] === value[8];
}

/*
 * A NIF: nine digits whose first says who holds it - 1-3 people, 45
 * non-resident people, 5 companies, 6 the state, 7-9 other bodies.
 */
const PT_NIF_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[1-35-9][0-9]|45)[0-9] ?[0-9]{3} ?[0-9]{3}(?![A-Za-z0-9]|[-.][0-9])/g;

const PT_NIF_WEIGHTS: ReadonlyArray<number> = [9, 8, 7, 6, 5, 4, 3, 2];

function isPtNif(digits: string): boolean {
  return (
    digits.length === 9 &&
    !isPlaceholderDigits(digits) &&
    mod11CheckDigit(weightedDigitSum(digits, PT_NIF_WEIGHTS)) ===
      digitAt(digits, 8)
  );
}

/*
 * A NIR: sex (1 or 2; 3, 4, 7 and 8 for numbers given before a birth is
 * registered), year, month, department (2A and 2B for Corsica), commune,
 * order number and the two-digit key, often typed in its groups:
 * 1 85 05 78 006 084 36.
 */
const FR_NIR_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[1-478] ?[0-9]{2} ?[0-9]{2} ?(?:[0-9]{2}|2[ABab]) ?[0-9]{3} ?[0-9]{3} ?[0-9]{2}(?![A-Za-z0-9]|[-.][0-9])/g;

function isFrNir(value: string): boolean {
  if (value.length !== 15) {
    return false;
  }

  // A month 01-12, or one of the codes INSEE uses when it is not known.
  const month: number = twoDigits(value, 3);

  if (
    !(
      (month >= 1 && month <= 12) ||
      (month >= 20 && month <= 42) ||
      month >= 50
    )
  ) {
    return false;
  }

  // In the key Corsica's 2A counts as 19 and 2B as 18.
  const department: string = value.slice(5, 7);
  let number: string = value.slice(0, 13);

  if (department === "2A") {
    number = value.slice(0, 5) + "19" + value.slice(7, 13);
  } else if (department === "2B") {
    number = value.slice(0, 5) + "18" + value.slice(7, 13);
  }

  return (
    !isPlaceholderDigits(number) &&
    97 - decimalStringMod(number, 97) === twoDigits(value, 13)
  );
}

const DE_TAX_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-./])[1-9][0-9] ?[0-9]{3} ?[0-9]{3} ?[0-9]{3}(?![A-Za-z0-9]|[-./][0-9])/g;

/*
 * The Bundeszentralamt für Steuern's rule for the first ten digits: exactly
 * one digit appears twice or three times and every other at most once, and
 * a digit that appears three times never three in a row.
 */
function hasDeTaxIdDigits(digits: string): boolean {
  const counts: Array<number> = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (let index: number = 0; index < 10; index++) {
    const digit: number = digitAt(digits, index);

    counts[digit] = (counts[digit] || 0) + 1;
  }

  let repeated: number = -1;

  for (let digit: number = 0; digit < 10; digit++) {
    const count: number = counts[digit]!;

    if (count > 3 || (count > 1 && repeated >= 0)) {
      return false;
    }

    if (count > 1) {
      repeated = digit;
    }
  }

  if (repeated < 0) {
    return false;
  }

  for (let index: number = 0; index + 2 < 10; index++) {
    if (
      digitAt(digits, index) === repeated &&
      digitAt(digits, index + 1) === repeated &&
      digitAt(digits, index + 2) === repeated
    ) {
      return false;
    }
  }

  return true;
}

function isDeTaxId(digits: string): boolean {
  return (
    digits.length === 11 &&
    digits[0] !== "0" &&
    hasDeTaxIdDigits(digits) &&
    iso7064Mod11Mod10(digits)
  );
}

/*
 * A codice fiscale: three letters of the surname and three of the name,
 * the birth year, a month letter, the day (plus 40 for women), the
 * Belfiore code of the place of birth and the check letter. Where two
 * people's codes would be the same, digits are swapped for the letters
 * LMNPQRSTUV (omocodia).
 */
const IT_CODICE_FISCALE_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Za-z]{6}[0-9LMNP-Vlmnp-v]{2}[A-EHLMPR-Ta-ehlmpr-t][0-9LMNP-Vlmnp-v]{2}[A-Za-z][0-9LMNP-Vlmnp-v]{3}[A-Za-z](?![A-Za-z0-9])/g;

const IT_MONTH_LETTERS: string = "ABCDEHLMPRST";
const IT_DIGIT_LETTERS: string = "LMNPQRSTUV";

/*
 * What a character in an odd place (the first, third ...) adds to the
 * check: a digit counts as the letter in its place, 0 as A.
 */
const IT_ODD_PLACE_VALUES: ReadonlyArray<number> = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10,
  22, 25, 24, 23,
];

// Two digits of a codice fiscale, either of which may be an omocodia letter.
function itTwoDigits(value: string, index: number): number {
  let number: number = 0;

  for (let place: number = index; place < index + 2; place++) {
    let digit: number = digitAt(value, place);

    if (digit < 0) {
      digit = IT_DIGIT_LETTERS.indexOf(value[place]!);
    }

    if (digit < 0) {
      return -1;
    }

    number = number * 10 + digit;
  }

  return number;
}

function isItCodiceFiscale(value: string): boolean {
  if (value.length !== 16) {
    return false;
  }

  const year: number = itTwoDigits(value, 6);
  let day: number = itTwoDigits(value, 9);

  if (day > 40) {
    day -= 40;
  }

  if (
    year < 0 ||
    !isRealTwoDigitYearDate(year, IT_MONTH_LETTERS.indexOf(value[8]!) + 1, day)
  ) {
    return false;
  }

  let sum: number = 0;

  for (let index: number = 0; index < 15; index++) {
    const code: number = value.charCodeAt(index);
    const place: number = code <= 57 ? code - 48 : code - 65;

    sum += index % 2 === 0 ? IT_ODD_PLACE_VALUES[place]! : place;
  }

  return value.charCodeAt(15) === 65 + (sum % 26);
}

// A BSN: nine digits, or in the dotted form 1234.56.782.
const NL_BSN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[0-9]{4}\.[0-9]{2}\.[0-9]{3}|[0-9]{3}[ .]?[0-9]{3}[ .]?[0-9]{3})(?![A-Za-z0-9]|[-.][0-9])/g;

const NL_BSN_WEIGHTS: ReadonlyArray<number> = [9, 8, 7, 6, 5, 4, 3, 2];

// The eleven test: 9, 8 ... 2 times the first eight, less the ninth.
function isNlBsn(digits: string): boolean {
  return (
    digits.length === 9 &&
    !isPlaceholderDigits(digits) &&
    (weightedDigitSum(digits, NL_BSN_WEIGHTS) - digitAt(digits, 8)) % 11 === 0
  );
}

// A national number: YY.MM.DD-SSS.CC, or eleven digits.
const BE_NATIONAL_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}\.?[0-9]{2}\.?[0-9]{2}[- ]?[0-9]{3}\.?[0-9]{2}(?![A-Za-z0-9]|[-.][0-9])/g;

function isBeNationalNumber(digits: string): boolean {
  if (digits.length !== 11 || isPlaceholderDigits(digits)) {
    return false;
  }

  /*
   * The key is 97 less the first nine digits modulo 97 - with a 2 in front
   * of them for people born from 2000.
   */
  const base: string = digits.slice(0, 9);
  const key: number = twoDigits(digits, 9);
  const before2000: boolean = 97 - decimalStringMod(base, 97) === key;
  const from2000: boolean = 97 - decimalStringMod("2" + base, 97) === key;
  const sequence: number = Number(digits.slice(6, 9));

  if ((!before2000 && !from2000) || sequence === 0 || sequence === 999) {
    return false;
  }

  // A BIS number adds 20 or 40 to the month.
  let month: number = twoDigits(digits, 2);
  const day: number = twoDigits(digits, 4);

  if (month >= 40) {
    month -= 40;
  } else if (month >= 20) {
    month -= 20;
  }

  if (month > 12 || day > 31) {
    return false;
  }

  // A birth date that is not known is written with a month or day of 00.
  if (month === 0 || day === 0) {
    return true;
  }

  const year: number = twoDigits(digits, 0);

  return (
    (before2000 && isRealDate(1900 + year, month, day)) ||
    (from2000 && isRealDate(2000 + year, month, day))
  );
}

const PL_PESEL_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}[0-9][0-9][0-3][0-9][0-9]{5}(?![A-Za-z0-9]|[-.][0-9])/g;

const PL_PESEL_WEIGHTS: ReadonlyArray<number> = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];

// The century a PESEL's month carries: 01-12, 21-32, 41-52, 61-72, 81-92.
const PL_PESEL_CENTURIES: ReadonlyArray<number> = [
  1900, 2000, 2100, 2200, 1800,
];

function isPlPesel(digits: string): boolean {
  if (digits.length !== 11 || isPlaceholderDigits(digits)) {
    return false;
  }

  const month: number = twoDigits(digits, 2);
  const century: number = PL_PESEL_CENTURIES[Math.floor(month / 20)]!;

  return (
    isRealDate(
      century + twoDigits(digits, 0),
      month % 20,
      twoDigits(digits, 4),
    ) &&
    (10 - (weightedDigitSum(digits, PL_PESEL_WEIGHTS) % 10)) % 10 ===
      digitAt(digits, 10)
  );
}

const WESTERN_EUROPE: ReadonlyArray<DataTypeDetector> = [
  /*
   * Spain DNI: eight digits and the letter their remainder modulo 23 names.
   * The letter makes the shape unusual, though one in 23 values passes.
   */
  {
    dataTypeId: "es-dni",
    quickCheck: hasDigit,
    pattern: ES_DNI_PATTERN,
    normalize: alphanumericUpper,
    validate: isEsDni,
    keywords: [
      "dni",
      "documento nacional",
      "documento nacional de identidad",
      "nif",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * Spain NIE: X, Y or Z, seven digits and the DNI check letter of the
   * whole. The fixed first letter makes it distinctive.
   */
  {
    dataTypeId: "es-nie",
    quickCheck: hasDigit,
    pattern: ES_NIE_PATTERN,
    normalize: alphanumericUpper,
    validate: isEsNie,
    keywords: [
      "nie",
      "numero de identidad de extranjero",
      "número de identidad de extranjero",
      "nif",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
  /*
   * Portugal NIF: a holder-kind first digit and a mod 11 check digit - one
   * nine-digit number in eleven, so beside a word.
   */
  {
    dataTypeId: "pt-nif",
    quickCheck: hasDigit,
    pattern: PT_NIF_PATTERN,
    normalize: digitsOnly,
    validate: isPtNif,
    keywords: [
      "nif",
      "contribuinte",
      "numero de contribuinte",
      "número de contribuinte",
      "nipc",
      "numero fiscal",
      "número fiscal",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * France NIR: its sex, month and department, and the key - 97 less the
   * thirteen digits modulo 97, Corsica's 2A and 2B as 19 and 18.
   */
  {
    dataTypeId: "fr-nir",
    quickCheck: hasDigit,
    pattern: FR_NIR_PATTERN,
    normalize: alphanumericUpper,
    validate: isFrNir,
    keywords: [
      "nir",
      "insee",
      "numero de securite sociale",
      "numéro de sécurité sociale",
      "securite sociale",
      "sécurité sociale",
      "secu",
      "sécu",
      "carte vitale",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The example in the French Wikipedia's and INSEE's explanations.
    isTestValue: sampleValues(["255081416802538"]),
  },
  /*
   * Germany Steuer-ID: the digit-frequency rule (one digit twice or three
   * times) and the ISO 7064 MOD 11,10 check digit.
   */
  {
    dataTypeId: "de-tax-id",
    quickCheck: hasDigit,
    pattern: DE_TAX_ID_PATTERN,
    normalize: digitsOnly,
    validate: isDeTaxId,
    keywords: [
      "steuer id",
      "steuer-id",
      "steuerid",
      "steuernummer",
      "steueridentifikationsnummer",
      "identifikationsnummer",
      "idnr",
      "tax id",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The examples in the BZSt's and python-stdnum's documentation.
    isTestValue: sampleValues(["86095742719", "36574261809", "65929970489"]),
  },
  /*
   * Italy codice fiscale: a real birth date (omocodia letters decoded) and
   * the check letter from the odd- and even-place tables.
   */
  {
    dataTypeId: "it-codice-fiscale",
    quickCheck: hasDigit,
    pattern: IT_CODICE_FISCALE_PATTERN,
    normalize: alphanumericUpper,
    validate: isItCodiceFiscale,
    keywords: [
      "codice fiscale",
      "cf",
      "c.f.",
      "cod. fisc.",
      "tessera sanitaria",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
    // Mario Rossi, born in Rome on 1 January 1980: the textbook example.
    isTestValue: sampleValues(["RSSMRA80A01H501U"]),
  },
  /*
   * Netherlands BSN: the eleven test - one nine-digit number in eleven
   * passes it, so beside a word.
   */
  {
    dataTypeId: "nl-bsn",
    quickCheck: hasDigit,
    pattern: NL_BSN_PATTERN,
    normalize: digitsOnly,
    validate: isNlBsn,
    keywords: [
      "bsn",
      "burgerservicenummer",
      "sofinummer",
      "sofi nummer",
      "persoonsnummer",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The examples the government's own documentation uses.
    isTestValue: sampleValues(["123456782", "111222333"]),
  },
  /*
   * Belgium national number: the mod 97 key (with the 2 in front from
   * 2000) and a birth date in the century the key says.
   */
  {
    dataTypeId: "be-national-number",
    quickCheck: hasDigit,
    pattern: BE_NATIONAL_NUMBER_PATTERN,
    normalize: digitsOnly,
    validate: isBeNationalNumber,
    keywords: [
      "rijksregisternummer",
      "rijksregister",
      "numero national",
      "numéro national",
      "national number",
      "registre national",
      "insz",
      "niss",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The example the national register's documentation uses.
    isTestValue: sampleValues(["85073003328"]),
  },
  /*
   * Poland PESEL: a birth date whose month carries the century, and the
   * check digit weighted 1, 3, 7, 9.
   */
  {
    dataTypeId: "pl-pesel",
    quickCheck: hasDigit,
    pattern: PL_PESEL_PATTERN,
    normalize: digitsOnly,
    validate: isPlPesel,
    keywords: ["pesel", "numer pesel"],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The example in the PESEL article every reference repeats.
    isTestValue: sampleValues(["44051401359"]),
  },
];

// NORTHERN EUROPE.

/*
 * A personnummer: YYMMDD-NNNC (+ for those over 100), or with the century
 * as YYYYMMDD-NNNC. A coordination number adds 60 to the day.
 */
const SE_PERSONNUMMER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-+.])(?:19|20)?[0-9]{2}[01][0-9][0-9]{2}[-+]?[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

function isSePersonnummer(digits: string): boolean {
  if (digits.length !== 10 && digits.length !== 12) {
    return false;
  }

  // Luhn and the date are read from the ten digits without the century.
  const ten: string = digits.slice(digits.length - 10);
  const month: number = twoDigits(ten, 2);
  let day: number = twoDigits(ten, 4);

  if (day > 60) {
    day -= 60;
  }

  const realDate: boolean =
    digits.length === 12
      ? isRealDate(Number(digits.slice(0, 4)), month, day)
      : isRealTwoDigitYearDate(twoDigits(ten, 0), month, day);

  return realDate && !isPlaceholderDigits(ten) && luhn(ten);
}

const NO_FODSELSNUMMER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-7][0-9]{5} ?[0-9]{5}(?![A-Za-z0-9]|[-.][0-9])/g;

const NO_FIRST_WEIGHTS: ReadonlyArray<number> = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const NO_SECOND_WEIGHTS: ReadonlyArray<number> = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

// 11 less the remainder, 11 giving 0. A 10 means no number has these digits.
function noCheckDigit(sum: number): number {
  const check: number = 11 - (sum % 11);

  return check === 11 ? 0 : check;
}

function isNoFodselsnummer(digits: string): boolean {
  if (digits.length !== 11 || isPlaceholderDigits(digits)) {
    return false;
  }

  /*
   * A D-number adds 40 to the day, an H-number 40 to the month, and the
   * Tax Administration's synthetic test people 80 to the month.
   */
  let day: number = twoDigits(digits, 0);
  let month: number = twoDigits(digits, 2);

  if (day > 40) {
    day -= 40;
  }

  if (month > 80) {
    month -= 80;
  } else if (month > 40) {
    month -= 40;
  }

  return (
    isRealTwoDigitYearDate(twoDigits(digits, 4), month, day) &&
    noCheckDigit(weightedDigitSum(digits, NO_FIRST_WEIGHTS)) ===
      digitAt(digits, 9) &&
    noCheckDigit(weightedDigitSum(digits, NO_SECOND_WEIGHTS)) ===
      digitAt(digits, 10)
  );
}

// A Tenor synthetic test person: their birth month has 80 added.
function isNoSyntheticPerson(digits: string): boolean {
  return twoDigits(digits, 2) > 80;
}

const DK_CPR_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-3][0-9][01][0-9]{3}-?[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

function isDkCpr(digits: string): boolean {
  return (
    digits.length === 10 &&
    !isPlaceholderDigits(digits) &&
    isRealTwoDigitYearDate(
      twoDigits(digits, 4),
      twoDigits(digits, 2),
      twoDigits(digits, 0),
    )
  );
}

/*
 * A HETU: DDMMYY, the century sign (+ for the 1800s; -, U-Y for the 1900s;
 * A-F for the 2000s), the individual number and the check character.
 */
const FI_HETU_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[0-3][0-9][01][0-9]{3}[-+A-FU-Y][0-9]{3}[0-9A-FHJ-NPR-Y](?![A-Za-z0-9])/g;

// The check characters, by DDMMYYNNN modulo 31.
const FI_HETU_CHECK_CHARACTERS: string = "0123456789ABCDEFHJKLMNPRSTUVWXY";

function fiHetuCentury(sign: string): number {
  if (sign === "+") {
    return 1800;
  }

  if (sign === "-" || (sign >= "U" && sign <= "Y")) {
    return 1900;
  }

  return sign >= "A" && sign <= "F" ? 2000 : -1;
}

function isFiHetu(value: string): boolean {
  if (value.length !== 11) {
    return false;
  }

  const century: number = fiHetuCentury(value[6]!);

  return (
    century > 0 &&
    Number(value.slice(7, 10)) >= 2 &&
    isRealDate(
      century + twoDigits(value, 4),
      twoDigits(value, 2),
      twoDigits(value, 0),
    ) &&
    FI_HETU_CHECK_CHARACTERS[
      Number(value.slice(0, 6) + value.slice(7, 10)) % 31
    ] === value[10]
  );
}

/*
 * The Digital and Population Data Services Agency's test codes, whose
 * individual number is 900-999, and the example every reference uses.
 */
function isFiTestHetu(value: string): boolean {
  return Number(value.slice(7, 10)) >= 900 || value === "131052-308T";
}

/*
 * A PPS number: seven digits, the check letter and, since 2013, a second
 * letter A or B (W, T, X, E or H on older numbers).
 */
const IE_PPSN_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[0-9]{7}[A-Wa-w][ABEHTWXabehtwx]?(?![A-Za-z0-9])/g;

const IE_PPSN_LETTERS: string = "WABCDEFGHIJKLMNOPQRSTUV";
const IE_PPSN_WEIGHTS: ReadonlyArray<number> = [8, 7, 6, 5, 4, 3, 2];

function isIePpsn(value: string): boolean {
  if (
    (value.length !== 8 && value.length !== 9) ||
    isPlaceholderDigits(value.slice(0, 7))
  ) {
    return false;
  }

  // A second letter A or B counts in the check, at weight 9.
  let sum: number = weightedDigitSum(value, IE_PPSN_WEIGHTS);
  const second: string = value.slice(8);

  if (second === "A" || second === "B") {
    sum += 9 * IE_PPSN_LETTERS.indexOf(second);
  }

  return IE_PPSN_LETTERS[sum % 23] === value[7];
}

const CH_AHV_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])756[. ]?[0-9]{4}[. ]?[0-9]{4}[. ]?[0-9]{2}(?![A-Za-z0-9]|[-.][0-9])/g;

function isChAhv(digits: string): boolean {
  return (
    digits.length === 13 &&
    digits.startsWith("756") &&
    !isPlaceholderDigits(digits.slice(3, 12)) &&
    ean13(digits)
  );
}

const NORTHERN_EUROPE: ReadonlyArray<DataTypeDetector> = [
  /*
   * Sweden personnummer: a real birth date (coordination numbers too) and
   * Luhn over the ten digits, in its 10- and 12-digit forms.
   */
  {
    dataTypeId: "se-personnummer",
    quickCheck: hasDigit,
    pattern: SE_PERSONNUMMER_PATTERN,
    normalize: digitsOnly,
    validate: isSePersonnummer,
    keywords: [
      "personnummer",
      "personnr",
      "person nummer",
      "samordningsnummer",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // Skatteverket's example, 19121212-1212.
    isTestValue: (digits: string): boolean => {
      return digits.endsWith("1212121212");
    },
  },
  /*
   * Norway fødselsnummer: a real birth date (D- and H-numbers too) and
   * both mod 11 check digits.
   */
  {
    dataTypeId: "no-fodselsnummer",
    quickCheck: hasDigit,
    pattern: NO_FODSELSNUMMER_PATTERN,
    normalize: digitsOnly,
    validate: isNoFodselsnummer,
    keywords: [
      "fodselsnummer",
      "fødselsnummer",
      "personnummer",
      "fnr",
      "d-nummer",
      "d nummer",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    isTestValue: isNoSyntheticPerson,
  },
  /*
   * Denmark CPR number: a real birth date. Numbers issued since 2007 need
   * not pass the old mod 11 check, so the date is all there is, and the
   * number counts only beside a word.
   */
  {
    dataTypeId: "dk-cpr",
    quickCheck: hasDigit,
    pattern: DK_CPR_PATTERN,
    normalize: digitsOnly,
    validate: isDkCpr,
    keywords: [
      "cpr",
      "cpr nummer",
      "cpr-nummer",
      "cpr nr",
      "cprnr",
      "personnummer",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * Finland HETU: a real birth date in the century its sign says and the
   * mod 31 check character. The sign makes the shape its own.
   */
  {
    dataTypeId: "fi-hetu",
    quickCheck: hasDigit,
    pattern: FI_HETU_PATTERN,
    validate: isFiHetu,
    keywords: [
      "hetu",
      "henkilotunnus",
      "henkilötunnus",
      "personbeteckning",
      "sotu",
      "sosiaaliturvatunnus",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
    isTestValue: isFiTestHetu,
  },
  /*
   * Ireland PPS number: the mod 23 check letter, counting the 2013 second
   * letter where there is one.
   */
  {
    dataTypeId: "ie-ppsn",
    quickCheck: hasDigit,
    pattern: IE_PPSN_PATTERN,
    normalize: alphanumericUpper,
    validate: isIePpsn,
    keywords: [
      "ppsn",
      "pps number",
      "pps no",
      "pps",
      "personal public service",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * Switzerland AHV / AVS number: 756, Switzerland's EAN prefix, and the
   * EAN-13 check digit.
   */
  {
    dataTypeId: "ch-ahv",
    quickCheck: containsAny(["756"]),
    pattern: CH_AHV_PATTERN,
    normalize: digitsOnly,
    validate: isChAhv,
    keywords: [
      "ahv",
      "avs",
      "ahv number",
      "ahv-nr",
      "ahv nr",
      "avs no",
      "sozialversicherungsnummer",
      "numero avs",
      "numéro avs",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
];

// SOUTH-EAST EUROPE AND THE MIDDLE EAST.

// A CNP: sex and century, YYMMDD, the county, a serial and the check digit.
const RO_CNP_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[1-9][0-9]{2}[01][0-9][0-3][0-9]{7}(?![A-Za-z0-9]|[-.][0-9])/g;

const RO_CNP_WEIGHTS: ReadonlyArray<number> = [
  2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9,
];

/*
 * The century a CNP's first digit carries: 1-2 the 1900s, 3-4 the 1800s,
 * 5-6 the 2000s. 7-9 (residents and foreigners) do not say, so -1.
 */
function roCnpCentury(sex: number): number {
  if (sex === 1 || sex === 2) {
    return 1900;
  }

  if (sex === 3 || sex === 4) {
    return 1800;
  }

  return sex === 5 || sex === 6 ? 2000 : -1;
}

function isRoCnp(digits: string): boolean {
  if (digits.length !== 13 || isPlaceholderDigits(digits)) {
    return false;
  }

  const century: number = roCnpCentury(digitAt(digits, 0));
  const year: number = twoDigits(digits, 1);
  const month: number = twoDigits(digits, 3);
  const day: number = twoDigits(digits, 5);
  const realDate: boolean =
    century > 0
      ? isRealDate(century + year, month, day)
      : isRealTwoDigitYearDate(year, month, day);

  // Counties 01-52, and 70 and up for registrations made elsewhere.
  const county: number = twoDigits(digits, 7);

  if (
    !realDate ||
    county === 0 ||
    (county > 52 && county < 70) ||
    digits.slice(9, 12) === "000"
  ) {
    return false;
  }

  const remainder: number = weightedDigitSum(digits, RO_CNP_WEIGHTS) % 11;

  return (remainder === 10 ? 1 : remainder) === digitAt(digits, 12);
}

const BG_EGN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}[0-5][0-9][0-3][0-9]{5}(?![A-Za-z0-9]|[-.][0-9])/g;

const BG_EGN_WEIGHTS: ReadonlyArray<number> = [2, 4, 8, 5, 10, 9, 7, 3, 6];

function isBgEgn(digits: string): boolean {
  if (digits.length !== 10 || isPlaceholderDigits(digits)) {
    return false;
  }

  // The month has 20 added for the 1800s and 40 for the 2000s.
  let month: number = twoDigits(digits, 2);
  let century: number = 1900;

  if (month > 40) {
    month -= 40;
    century = 2000;
  } else if (month > 20) {
    month -= 20;
    century = 1800;
  }

  const remainder: number = weightedDigitSum(digits, BG_EGN_WEIGHTS) % 11;

  return (
    isRealDate(century + twoDigits(digits, 0), month, twoDigits(digits, 4)) &&
    (remainder === 10 ? 0 : remainder) === digitAt(digits, 9)
  );
}

// Eleven digits in a row, for Croatia's OIB and Greece's AMKA.
const ELEVEN_DIGITS_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{11}(?![A-Za-z0-9]|[-.][0-9])/g;

function isHrOib(digits: string): boolean {
  return (
    digits.length === 11 &&
    !isPlaceholderDigits(digits) &&
    iso7064Mod11Mod10(digits)
  );
}

function isGrAmka(digits: string): boolean {
  return (
    digits.length === 11 &&
    !isPlaceholderDigits(digits) &&
    isRealTwoDigitYearDate(
      twoDigits(digits, 4),
      twoDigits(digits, 2),
      twoDigits(digits, 0),
    ) &&
    luhn(digits)
  );
}

const TR_TCKN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[1-9][0-9]{10}(?![A-Za-z0-9]|[-.][0-9])/g;

/*
 * The two T.C. Kimlik checks: the tenth digit is seven times the sum of
 * the odd places less the sum of the even ones, modulo 10; the eleventh is
 * the sum of the first ten, modulo 10.
 */
function isTrTckn(digits: string): boolean {
  if (digits.length !== 11 || isPlaceholderDigits(digits)) {
    return false;
  }

  let odd: number = 0;
  let even: number = 0;

  for (let index: number = 0; index < 9; index++) {
    if (index % 2 === 0) {
      odd += digitAt(digits, index);
    } else {
      even += digitAt(digits, index);
    }
  }

  const tenth: number = digitAt(digits, 9);

  return (
    (((odd * 7 - even) % 10) + 10) % 10 === tenth &&
    (odd + even + tenth) % 10 === digitAt(digits, 10)
  );
}

const IL_TEUDAT_ZEHUT_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{8}-?[0-9](?![A-Za-z0-9]|[-.][0-9])/g;

function isIlTeudatZehut(digits: string): boolean {
  return digits.length === 9 && !isPlaceholderDigits(digits) && luhn(digits);
}

/*
 * A South African ID: YYMMDD, four digits for sex, citizenship (0 citizen,
 * 1 permanent resident, 2 refugee), a digit once used for race, and Luhn.
 */
const ZA_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}[01][0-9][0-3][0-9] ?[0-9]{4} ?[012][0-9]{2}(?![A-Za-z0-9]|[-.][0-9])/g;

function isZaId(digits: string): boolean {
  return (
    digits.length === 13 &&
    !isPlaceholderDigits(digits) &&
    digitAt(digits, 10) <= 2 &&
    isRealTwoDigitYearDate(
      twoDigits(digits, 0),
      twoDigits(digits, 2),
      twoDigits(digits, 4),
    ) &&
    luhn(digits)
  );
}

const SOUTH_EAST_EUROPE_AND_MIDDLE_EAST: ReadonlyArray<DataTypeDetector> = [
  /*
   * Romania CNP: a real birth date in the century the first digit says, a
   * county code and the check digit weighted 279146358279.
   */
  {
    dataTypeId: "ro-cnp",
    quickCheck: hasDigit,
    pattern: RO_CNP_PATTERN,
    normalize: digitsOnly,
    validate: isRoCnp,
    keywords: ["cnp", "cod numeric personal"],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * Bulgaria EGN: a real birth date in the century the month carries, and
   * the mod 11 check digit.
   */
  {
    dataTypeId: "bg-egn",
    quickCheck: hasDigit,
    pattern: BG_EGN_PATTERN,
    normalize: digitsOnly,
    validate: isBgEgn,
    keywords: ["egn", "егн", "единен граждански номер"],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The examples of the EGN's Wikipedia article.
    isTestValue: sampleValues(["7523169263", "7552010005"]),
  },
  /*
   * Croatia OIB: the ISO 7064 MOD 11,10 check digit and nothing else in
   * eleven digits, so beside a word.
   */
  {
    dataTypeId: "hr-oib",
    quickCheck: hasDigit,
    pattern: ELEVEN_DIGITS_PATTERN,
    normalize: digitsOnly,
    validate: isHrOib,
    keywords: ["oib", "osobni identifikacijski broj"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  // Greece AMKA: a real DDMMYY birth date and Luhn over the eleven digits.
  {
    dataTypeId: "gr-amka",
    quickCheck: hasDigit,
    pattern: ELEVEN_DIGITS_PATTERN,
    normalize: digitsOnly,
    validate: isGrAmka,
    keywords: ["amka", "αμκα"],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  // Turkey T.C. Kimlik number: no leading 0, and both of its check digits.
  {
    dataTypeId: "tr-tckn",
    quickCheck: hasDigit,
    pattern: TR_TCKN_PATTERN,
    normalize: digitsOnly,
    validate: isTrTckn,
    keywords: [
      "tc kimlik",
      "t.c. kimlik",
      "tckn",
      "kimlik no",
      "kimlik numarasi",
      "kimlik numarası",
      "tc no",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The values every T.C. Kimlik validator's documentation tries.
    isTestValue: sampleValues(["10000000146", "11111111110", "12345678950"]),
  },
  /*
   * Israel Teudat Zehut: Luhn over nine digits (shorter numbers padded with
   * zeros), which one number in ten passes, so beside a word.
   */
  {
    dataTypeId: "il-teudat-zehut",
    quickCheck: hasDigit,
    pattern: IL_TEUDAT_ZEHUT_PATTERN,
    normalize: digitsOnly,
    validate: isIlTeudatZehut,
    keywords: [
      "teudat zehut",
      "israeli id",
      "zehut",
      "mispar zehut",
      "תעודת זהות",
      "ת.ז",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * South Africa ID number: a real birth date, a citizenship digit of 0-2
   * and Luhn over the thirteen digits.
   */
  {
    dataTypeId: "za-id",
    quickCheck: hasDigit,
    pattern: ZA_ID_PATTERN,
    normalize: digitsOnly,
    validate: isZaId,
    keywords: [
      "sa id",
      "rsa id",
      "id number",
      "identity number",
      "south african id",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The number in the Department of Home Affairs' explanation of the ID.
    isTestValue: sampleValues(["8001015009087"]),
  },
];

// ASIA.

// An Emirates ID: 784, the year of birth, a serial and a Luhn digit.
const AE_EMIRATES_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])784[- ]?(?:19|20)[0-9]{2}[- ]?[0-9]{7}[- ]?[0-9](?![A-Za-z0-9]|[-.][0-9])/g;

function isAeEmiratesId(digits: string): boolean {
  return (
    digits.length === 15 &&
    digits.startsWith("784") &&
    Number(digits.slice(3, 7)) <= new Date().getFullYear() &&
    !isPlaceholderDigits(digits.slice(7, 14)) &&
    luhn(digits)
  );
}

// A Saudi ID: 1 for a citizen, 2 for a resident's iqama, then nine digits.
const SA_NATIONAL_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[12][0-9]{9}(?![A-Za-z0-9]|[-.][0-9])/g;

function isSaNationalId(digits: string): boolean {
  return (
    digits.length === 10 &&
    (digits[0] === "1" || digits[0] === "2") &&
    !isPlaceholderDigits(digits) &&
    luhn(digits)
  );
}

// An Aadhaar number as it is printed, in three groups of four.
const IN_AADHAAR_GROUPED_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-. ])[2-9][0-9]{3}(?: [0-9]{4} |-[0-9]{4}-)[0-9]{4}(?![A-Za-z0-9]|[-. ][0-9])/g;

const IN_AADHAAR_BARE_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[2-9][0-9]{11}(?![A-Za-z0-9]|[-.][0-9])/g;

const IN_AADHAAR_KEYWORDS: ReadonlyArray<string> = [
  "aadhaar",
  "aadhar",
  "uid number",
  "uidai",
  "आधार",
];

// UIDAI never issues 0 or 1 first, and the last digit is a Verhoeff check.
function isInAadhaar(digits: string): boolean {
  return (
    digits.length === 12 &&
    digitAt(digits, 0) >= 2 &&
    !isPlaceholderDigits(digits) &&
    verhoeff(digits)
  );
}

// The residents of UIDAI's authentication sandbox: 9999 9999 00xx.
function isAadhaarSandboxNumber(digits: string): boolean {
  return digits.startsWith("99999999");
}

/*
 * A PAN: five letters, four digits and a letter. The fourth letter is the
 * kind of holder - P a person, C a company, H a Hindu undivided family, F a
 * firm, A, B, G, J, K, L, T and E the other kinds the Income Tax
 * Department lists.
 */
const IN_PAN_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{3}[ABCEFGHJKLPT][A-Z][0-9]{4}[A-Z](?![A-Za-z0-9])/g;

function isInPan(value: string): boolean {
  return value.length === 10 && value.slice(5, 9) !== "0000";
}

/*
 * A resident identity number: the six-digit region code, the birth date
 * as YYYYMMDD, a sequence number and the check character (0-9 or X).
 */
const CN_RESIDENT_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[1-8][0-9]{5}(?:19|20)[0-9]{2}[01][0-9][0-3][0-9]{4}[0-9Xx](?![A-Za-z0-9])/g;

// The provinces a region code starts with (71 Taiwan, 81-83 HK, Macau, Taiwan residents).
const CN_PROVINCES: ReadonlySet<string> = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "21",
  "22",
  "23",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "50",
  "51",
  "52",
  "53",
  "54",
  "61",
  "62",
  "63",
  "64",
  "65",
  "71",
  "81",
  "82",
  "83",
]);

// ISO 7064 MOD 11-2, as GB 11643 writes it: the weights and check characters.
const CN_RESIDENT_ID_WEIGHTS: ReadonlyArray<number> = [
  7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2,
];
const CN_CHECK_CHARACTERS: string = "10X98765432";

function isCnResidentId(value: string): boolean {
  if (value.length !== 18 || !CN_PROVINCES.has(value.slice(0, 2))) {
    return false;
  }

  const year: number = Number(value.slice(6, 10));

  return (
    year <= new Date().getFullYear() &&
    isRealDate(year, twoDigits(value, 10), twoDigits(value, 12)) &&
    CN_CHECK_CHARACTERS[
      weightedDigitSum(value, CN_RESIDENT_ID_WEIGHTS) % 11
    ] === value[17]
  );
}

// Twelve digits, often in groups of four, for Japan's My Number.
const JP_MY_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

const JP_MY_NUMBER_WEIGHTS: ReadonlyArray<number> = [
  6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2,
];

function isJpMyNumber(digits: string): boolean {
  return (
    digits.length === 12 &&
    !isPlaceholderDigits(digits) &&
    mod11CheckDigit(weightedDigitSum(digits, JP_MY_NUMBER_WEIGHTS)) ===
      digitAt(digits, 11)
  );
}

// YYMMDD-SNNNNNN: the seventh digit carries sex and century.
const KR_RRN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}[01][0-9][0-3][0-9]-?[1-8][0-9]{6}(?![A-Za-z0-9]|[-.][0-9])/g;

function isKrRrn(digits: string): boolean {
  if (digits.length !== 13 || isPlaceholderDigits(digits)) {
    return false;
  }

  // 1, 2, 5 and 6 were born in the 1900s; 3, 4, 7 and 8 from 2000.
  const marker: number = digitAt(digits, 6);
  const century: number =
    marker === 3 || marker === 4 || marker === 7 || marker === 8 ? 2000 : 1900;

  return isRealDate(
    century + twoDigits(digits, 0),
    twoDigits(digits, 2),
    twoDigits(digits, 4),
  );
}

/*
 * An NRIC or FIN: S or T (citizens and permanent residents, born before or
 * from 2000), F or G (foreigners, likewise), M (foreigners from 2022), seven
 * digits and the check letter.
 */
const SG_NRIC_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[STFGMstfgm][0-9]{7}[A-Za-z](?![A-Za-z0-9])/g;

const SG_NRIC_WEIGHTS: ReadonlyArray<number> = [2, 7, 6, 5, 4, 3, 2];

// The check letters by remainder. M's table has J where F and G have M.
function sgNricCheckLetters(prefix: string): string {
  if (prefix === "S" || prefix === "T") {
    return "JZIHGFEDCBA";
  }

  return prefix === "M" ? "XWUTRQPNJLK" : "XWUTRQPNMLK";
}

// What the series adds to the weighted sum: 4 for T and G, 3 for M.
function sgNricOffset(prefix: string): number {
  if (prefix === "T" || prefix === "G") {
    return 4;
  }

  return prefix === "M" ? 3 : 0;
}

function isSgNric(value: string): boolean {
  if (value.length !== 9 || isPlaceholderDigits(value.slice(1, 8))) {
    return false;
  }

  const prefix: string = value[0]!;
  const remainder: number =
    (weightedDigitSum(value.slice(1), SG_NRIC_WEIGHTS) + sgNricOffset(prefix)) %
    11;

  return sgNricCheckLetters(prefix)[remainder] === value[8];
}

// An HKID: one or two letters, six digits and the check digit, as A123456(3).
const HK_HKID_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{1,2}[0-9]{6} ?(?:\([0-9A]\)|[0-9A])(?![A-Za-z0-9])/g;

/*
 * Letters count from 10 (A) and a single letter has a space (36) before
 * it; with the check digit (A for 10) the weighted sum is a multiple of 11.
 */
function isHkHkid(value: string): boolean {
  const letters: number = value.length - 7;

  if (
    (letters !== 1 && letters !== 2) ||
    isPlaceholderDigits(value.slice(letters, letters + 6))
  ) {
    return false;
  }

  let sum: number = letters === 1 ? 36 * 9 : (value.charCodeAt(0) - 55) * 9;

  sum += (value.charCodeAt(letters - 1) - 55) * 8;
  sum += weightedDigitSum(value.slice(letters), [7, 6, 5, 4, 3, 2]);

  const remainder: number = sum % 11;
  const check: number = remainder === 0 ? 0 : 11 - remainder;

  return value.endsWith(check === 10 ? "A" : String(check));
}

/*
 * A Taiwanese ID: the letter of the place of registration, 1 or 2 for sex
 * (8 or 9 on a resident foreigner's new number) and eight digits.
 */
const TW_NATIONAL_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Za-z][1289][0-9]{8}(?![A-Za-z0-9])/g;

// The first letters in the order of their values, 10 (A) to 35 (O).
const TW_LETTERS: string = "ABCDEFGHJKLMNPQRSTUVXYWZIO";

function isTwNationalId(value: string): boolean {
  const letter: number = TW_LETTERS.indexOf(value[0]!) + 10;

  if (
    value.length !== 10 ||
    letter < 10 ||
    isPlaceholderDigits(value.slice(2, 9))
  ) {
    return false;
  }

  const sum: number =
    Math.floor(letter / 10) +
    (letter % 10) * 9 +
    weightedDigitSum(value.slice(1), [8, 7, 6, 5, 4, 3, 2, 1, 1]);

  return sum % 10 === 0;
}

// A Thai ID: 1-2345-67890-12-1, the first digit the kind of holder (1-8).
const TH_NATIONAL_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[1-8][- ]?[0-9]{4}[- ]?[0-9]{5}[- ]?[0-9]{2}[- ]?[0-9](?![A-Za-z0-9]|[-.][0-9])/g;

const TH_NATIONAL_ID_WEIGHTS: ReadonlyArray<number> = [
  13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
];

function isThNationalId(digits: string): boolean {
  return (
    digits.length === 13 &&
    !isPlaceholderDigits(digits) &&
    (11 - (weightedDigitSum(digits, TH_NATIONAL_ID_WEIGHTS) % 11)) % 10 ===
      digitAt(digits, 12)
  );
}

// A MyKad number: YYMMDD-PB-NNNN, PB the place of birth.
const MY_MYKAD_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2}[01][0-9][0-3][0-9]-?[0-9]{2}-?[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

/*
 * Place-of-birth codes the National Registration Department uses: 01-16
 * and 21-59 the states, 60-68, 71-72, 74-79 and 82-93 other places, 98
 * and 99 the stateless and unknown.
 */
function isMyBirthPlace(code: number): boolean {
  return (
    (code >= 1 && code <= 16) ||
    (code >= 21 && code <= 68) ||
    code === 71 ||
    code === 72 ||
    (code >= 74 && code <= 79) ||
    (code >= 82 && code <= 93) ||
    code >= 98
  );
}

function isMyMykad(digits: string): boolean {
  return (
    digits.length === 12 &&
    !isPlaceholderDigits(digits) &&
    isRealTwoDigitYearDate(
      twoDigits(digits, 0),
      twoDigits(digits, 2),
      twoDigits(digits, 4),
    ) &&
    isMyBirthPlace(twoDigits(digits, 6)) &&
    digits.slice(8) !== "0000"
  );
}

/*
 * A NIK: province, regency and district codes, the birth date as DDMMYY
 * (40 added to a woman's day) and a serial.
 */
const ID_NIK_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[1-9][0-9]{5}[0-7][0-9][01][0-9]{3}[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

const ID_PROVINCES: ReadonlySet<string> = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "51",
  "52",
  "53",
  "61",
  "62",
  "63",
  "64",
  "65",
  "71",
  "72",
  "73",
  "74",
  "75",
  "76",
  "81",
  "82",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
]);

function isIdNik(digits: string): boolean {
  if (
    digits.length !== 16 ||
    !ID_PROVINCES.has(digits.slice(0, 2)) ||
    digits.slice(2, 4) === "00" ||
    digits.slice(4, 6) === "00" ||
    digits.slice(12) === "0000"
  ) {
    return false;
  }

  let day: number = twoDigits(digits, 6);

  if (day > 40) {
    day -= 40;
  }

  return isRealTwoDigitYearDate(
    twoDigits(digits, 10),
    twoDigits(digits, 8),
    day,
  );
}

const ASIA: ReadonlyArray<DataTypeDetector> = [
  /*
   * UAE Emirates ID: 784 (the UAE's ISO code), a year of birth that has
   * passed, and Luhn over the fifteen digits.
   */
  {
    dataTypeId: "ae-emirates-id",
    quickCheck: containsAny(["784"]),
    pattern: AE_EMIRATES_ID_PATTERN,
    normalize: digitsOnly,
    validate: isAeEmiratesId,
    keywords: ["emirates id", "eid", "emirates identity", "uae id"],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
  /*
   * Saudi national ID or iqama: a 1 or a 2 and Luhn. Ten digits starting
   * with 1 are what a Unix timestamp is, so beside a word.
   */
  {
    dataTypeId: "sa-national-id",
    quickCheck: hasDigit,
    pattern: SA_NATIONAL_ID_PATTERN,
    normalize: digitsOnly,
    validate: isSaNationalId,
    keywords: ["iqama", "saudi id", "national id", "muqeem", "هوية", "إقامة"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 3,
  },
  /*
   * India Aadhaar number, printed in groups of four: a first digit of 2-9
   * and the Verhoeff check digit.
   */
  {
    dataTypeId: "in-aadhaar",
    quickCheck: hasDigit,
    pattern: IN_AADHAAR_GROUPED_PATTERN,
    normalize: digitsOnly,
    validate: isInAadhaar,
    keywords: IN_AADHAAR_KEYWORDS,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    isTestValue: isAadhaarSandboxNumber,
  },
  // An Aadhaar number as twelve bare digits, only beside a word.
  {
    dataTypeId: "in-aadhaar",
    quickCheck: hasDigit,
    pattern: IN_AADHAAR_BARE_PATTERN,
    normalize: digitsOnly,
    validate: isInAadhaar,
    keywords: IN_AADHAAR_KEYWORDS,
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    isTestValue: isAadhaarSandboxNumber,
  },
  /*
   * India PAN: its layout and a holder kind the Income Tax Department
   * uses. The last letter is a check character whose algorithm is not
   * published, so the format is all there is (Low) - but it is its own.
   */
  {
    dataTypeId: "in-pan",
    quickCheck: hasDigit,
    pattern: IN_PAN_PATTERN,
    validate: isInPan,
    keywords: [
      "pan",
      "pan number",
      "pan no",
      "pan card",
      "permanent account number",
    ],
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    // The examples on the Income Tax Department's and NSDL's forms.
    isTestValue: sampleValues(["AAAPL1234C", "AAAPZ1234C"]),
  },
  /*
   * China resident identity number: a province code, a real birth date
   * that has passed and the ISO 7064 MOD 11-2 check character.
   */
  {
    dataTypeId: "cn-resident-id",
    quickCheck: hasDigit,
    pattern: CN_RESIDENT_ID_PATTERN,
    normalize: alphanumericUpper,
    validate: isCnResidentId,
    keywords: [
      "resident id",
      "shenfenzheng",
      "id card",
      "身份证",
      "身份证号",
      "公民身份号码",
    ],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
    // The example of GB 11643's Wikipedia article.
    isTestValue: sampleValues(["11010519491231002X"]),
  },
  /*
   * Japan My Number: the mod 11 check digit over twelve digits - one in
   * eleven passes, so beside a word.
   */
  {
    dataTypeId: "jp-my-number",
    quickCheck: hasDigit,
    pattern: JP_MY_NUMBER_PATTERN,
    normalize: digitsOnly,
    validate: isJpMyNumber,
    keywords: [
      "my number",
      "mynumber",
      "kojin bango",
      "個人番号",
      "マイナンバー",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The example the Digital Agency's and validators' documentation uses.
    isTestValue: sampleValues(["123456789018"]),
  },
  /*
   * South Korea RRN: a real birth date in the century the seventh digit
   * says. Numbers issued since October 2020 have no check digit, so the
   * date is all there is, and the number counts only beside a word.
   */
  {
    dataTypeId: "kr-rrn",
    quickCheck: hasDigit,
    pattern: KR_RRN_PATTERN,
    normalize: digitsOnly,
    validate: isKrRrn,
    keywords: [
      "rrn",
      "resident registration",
      "resident registration number",
      "jumin",
      "주민등록번호",
      "주민번호",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * Singapore NRIC / FIN: the series letter and the check letter its
   * weighted sum gives, in each series' own table.
   */
  {
    dataTypeId: "sg-nric",
    quickCheck: hasDigit,
    pattern: SG_NRIC_PATTERN,
    normalize: alphanumericUpper,
    validate: isSgNric,
    keywords: ["nric", "fin", "ic number", "identity card"],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
  // Hong Kong ID: its letters and the mod 11 check digit (A for 10).
  {
    dataTypeId: "hk-hkid",
    quickCheck: hasDigit,
    pattern: HK_HKID_PATTERN,
    normalize: alphanumericUpper,
    validate: isHkHkid,
    keywords: ["hkid", "hong kong id", "hong kong identity", "身份證"],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
  /*
   * Taiwan national ID: the place letter's value, the sex digit and the
   * mod 10 check over the weighted digits.
   */
  {
    dataTypeId: "tw-national-id",
    quickCheck: hasDigit,
    pattern: TW_NATIONAL_ID_PATTERN,
    normalize: alphanumericUpper,
    validate: isTwNationalId,
    keywords: ["taiwan id", "national id", "身分證", "身分證字號", "統一證號"],
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
  },
  /*
   * Thailand national ID: the mod 11 check digit over thirteen digits. One
   * in eleven passes and millisecond timestamps are thirteen digits too, so
   * beside a word.
   */
  {
    dataTypeId: "th-national-id",
    quickCheck: hasDigit,
    pattern: TH_NATIONAL_ID_PATTERN,
    normalize: digitsOnly,
    validate: isThNationalId,
    keywords: [
      "thai id",
      "citizen id",
      "national id",
      "เลขประจำตัวประชาชน",
      "บัตรประชาชน",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * Malaysia MyKad number: a real birth date and a place-of-birth code. No
   * check digit, so beside a word.
   */
  {
    dataTypeId: "my-mykad",
    quickCheck: hasDigit,
    pattern: MY_MYKAD_PATTERN,
    normalize: digitsOnly,
    validate: isMyMykad,
    keywords: [
      "mykad",
      "nric",
      "ic number",
      "ic no",
      "kad pengenalan",
      "no kp",
      "mykid",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
  /*
   * Indonesia NIK: a province code and a real birth date. No check digit,
   * and sixteen digits is a card number's length, so beside a word.
   */
  {
    dataTypeId: "id-nik",
    quickCheck: hasDigit,
    pattern: ID_NIK_PATTERN,
    normalize: digitsOnly,
    validate: isIdNik,
    keywords: [
      "nik",
      "nomor induk kependudukan",
      "ktp",
      "e-ktp",
      "no ktp",
      "nomor ktp",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
  },
];

// OCEANIA AND RUSSIA.

// A TFN: nine digits in threes, or an older eight-digit one.
const AU_TFN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{3}|[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{3})(?![A-Za-z0-9]|[-.][0-9])/g;

const AU_TFN_WEIGHTS: ReadonlyArray<number> = [1, 4, 3, 7, 5, 8, 6, 9, 10];
const AU_TFN_EIGHT_DIGIT_WEIGHTS: ReadonlyArray<number> = [
  10, 7, 8, 4, 6, 3, 5, 1,
];

function isAuTfn(digits: string): boolean {
  if (
    (digits.length !== 8 && digits.length !== 9) ||
    isPlaceholderDigits(digits)
  ) {
    return false;
  }

  const weights: ReadonlyArray<number> =
    digits.length === 9 ? AU_TFN_WEIGHTS : AU_TFN_EIGHT_DIGIT_WEIGHTS;

  return weightedDigitSum(digits, weights) % 11 === 0;
}

// An IRD number: eight or nine digits, typed 123-456-789 or 12-345-678.
const NZ_IRD_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{2,3}-?[0-9]{3}-?[0-9]{3}(?![A-Za-z0-9]|[-.][0-9])/g;

const NZ_IRD_PRIMARY_WEIGHTS: ReadonlyArray<number> = [3, 2, 7, 6, 5, 4, 3, 2];
const NZ_IRD_SECONDARY_WEIGHTS: ReadonlyArray<number> = [
  7, 4, 3, 2, 5, 2, 7, 6,
];

function nzIrdCheckDigit(
  digits: string,
  weights: ReadonlyArray<number>,
): number {
  const remainder: number = weightedDigitSum(digits, weights) % 11;

  return remainder === 0 ? 0 : 11 - remainder;
}

/*
 * Inland Revenue's check: numbers 10-000-000 to 150-000-000, the base
 * eight digits (an eight-digit number with a 0 in front) weighted
 * 3, 2, 7, 6, 5, 4, 3, 2; where that gives 10, the secondary weights
 * 7, 4, 3, 2, 5, 2, 7, 6 decide, and a 10 again is no number.
 */
function isNzIrd(digits: string): boolean {
  if (digits.length !== 8 && digits.length !== 9) {
    return false;
  }

  const padded: string = digits.length === 8 ? "0" + digits : digits;
  const number: number = Number(padded);

  if (number < 10000000 || number > 150000000 || isPlaceholderDigits(digits)) {
    return false;
  }

  let check: number = nzIrdCheckDigit(padded, NZ_IRD_PRIMARY_WEIGHTS);

  if (check === 10) {
    check = nzIrdCheckDigit(padded, NZ_IRD_SECONDARY_WEIGHTS);
  }

  return check === digitAt(padded, 8);
}

// A SNILS: XXX-XXX-XXX YY.
const RU_SNILS_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{3}-?[0-9]{3}-?[0-9]{3}[- ]?[0-9]{2}(?![A-Za-z0-9]|[-.][0-9])/g;

const RU_SNILS_WEIGHTS: ReadonlyArray<number> = [9, 8, 7, 6, 5, 4, 3, 2, 1];

/*
 * The check number is the weighted sum modulo 101, where 100 is written 00.
 * Numbers up to 001-001-998 were issued before there was a check number.
 */
function isRuSnils(digits: string): boolean {
  if (
    digits.length !== 11 ||
    isPlaceholderDigits(digits) ||
    Number(digits.slice(0, 9)) <= 1001998
  ) {
    return false;
  }

  const check: number = weightedDigitSum(digits, RU_SNILS_WEIGHTS) % 101;

  return (check === 100 ? 0 : check) === twoDigits(digits, 9);
}

// An INN: ten digits for an organisation, twelve for a person.
const RU_INN_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])(?:[0-9]{12}|[0-9]{10})(?![A-Za-z0-9]|[-.][0-9])/g;

const RU_INN_TEN_WEIGHTS: ReadonlyArray<number> = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const RU_INN_ELEVEN_WEIGHTS: ReadonlyArray<number> = [
  7, 2, 4, 10, 3, 5, 9, 4, 6, 8,
];
const RU_INN_TWELVE_WEIGHTS: ReadonlyArray<number> = [
  3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8,
];

// The weighted sum modulo 11, then modulo 10.
function ruInnCheckDigit(
  digits: string,
  weights: ReadonlyArray<number>,
): number {
  return (weightedDigitSum(digits, weights) % 11) % 10;
}

function isRuInn(digits: string): boolean {
  // The first two digits are a region code, never 00.
  if (isPlaceholderDigits(digits) || digits.startsWith("00")) {
    return false;
  }

  if (digits.length === 10) {
    return ruInnCheckDigit(digits, RU_INN_TEN_WEIGHTS) === digitAt(digits, 9);
  }

  return (
    digits.length === 12 &&
    ruInnCheckDigit(digits, RU_INN_ELEVEN_WEIGHTS) === digitAt(digits, 10) &&
    ruInnCheckDigit(digits, RU_INN_TWELVE_WEIGHTS) === digitAt(digits, 11)
  );
}

const OCEANIA_AND_RUSSIA: ReadonlyArray<DataTypeDetector> = [
  /*
   * Australia TFN: the ATO's weighted sum is a multiple of 11, for nine
   * digits and for the older eight. Nothing else is in it, so beside a word.
   */
  {
    dataTypeId: "au-tfn",
    quickCheck: hasDigit,
    pattern: AU_TFN_PATTERN,
    normalize: digitsOnly,
    validate: isAuTfn,
    keywords: ["tfn", "tax file number", "tax file no"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The example in the ATO's own guidance.
    isTestValue: sampleValues(["123456782"]),
  },
  /*
   * New Zealand IRD number: its range and the check digit from the primary
   * or the secondary weights, beside a word.
   */
  {
    dataTypeId: "nz-ird",
    quickCheck: hasDigit,
    pattern: NZ_IRD_PATTERN,
    normalize: digitsOnly,
    validate: isNzIrd,
    keywords: ["ird", "ird number", "ird no", "inland revenue"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The examples in Inland Revenue's specification of the check.
    isTestValue: sampleValues(["49091850", "136410132"]),
  },
  // Russia SNILS: the two-digit check number modulo 101.
  {
    dataTypeId: "ru-snils",
    quickCheck: hasDigit,
    pattern: RU_SNILS_PATTERN,
    normalize: digitsOnly,
    validate: isRuSnils,
    keywords: ["snils", "снилс", "страховой номер"],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
  },
  /*
   * Russia INN: one check digit for ten digits, two for twelve, each the
   * weighted sum modulo 11 and 10. Beside a word.
   */
  {
    dataTypeId: "ru-inn",
    quickCheck: hasDigit,
    pattern: RU_INN_PATTERN,
    normalize: digitsOnly,
    validate: isRuInn,
    keywords: ["inn", "инн", "taxpayer number"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // Sberbank's INN, the example every INN validator uses.
    isTestValue: sampleValues(["7707083893"]),
  },
];

// ANY COUNTRY.

// Six to nine letters and digits, the length of every country's passport numbers.
const PASSPORT_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Za-z0-9]{6,9}(?![A-Za-z0-9])/g;

// At least five digits and at most three letters, and no placeholder.
function isPassportNumber(value: string): boolean {
  const digits: string = digitsOnly(value);

  return (
    value.length >= 6 &&
    value.length <= 9 &&
    digits.length >= 5 &&
    value.length - digits.length <= 3 &&
    !isPlaceholderDigits(digits)
  );
}

/*
 * A passport number from anywhere: a country's numbers have no check
 * digit of their own (only the machine-readable zone carries one), so it
 * counts only beside "passport" in some language.
 */
const PASSPORT_NUMBER_DETECTOR: DataTypeDetector = {
  dataTypeId: "passport-number",
  quickCheck: hasDigit,
  pattern: PASSPORT_NUMBER_PATTERN,
  normalize: alphanumericUpper,
  validate: isPassportNumber,
  keywords: [
    "passport",
    "passport number",
    "passport no",
    "passeport",
    "reisepass",
    "pasaporte",
    "passaporto",
    "paspoort",
    "travel document",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 1,
  // The number on Germany's specimen passport.
  isTestValue: sampleValues(["C01X00T47"]),
};

export const GOVERNMENT_ID_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  ...NORTH_AMERICA,
  ...UNITED_KINGDOM,
  ...LATIN_AMERICA,
  ...WESTERN_EUROPE,
  ...NORTHERN_EUROPE,
  ...SOUTH_EAST_EUROPE_AND_MIDDLE_EAST,
  ...ASIA,
  ...OCEANIA_AND_RUSSIA,
  PASSPORT_NUMBER_DETECTOR,
];

export default GOVERNMENT_ID_DETECTORS;
