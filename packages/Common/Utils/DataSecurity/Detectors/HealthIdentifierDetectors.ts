import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataTypeDetector,
  alphanumericUpper,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
} from "../Detector";
import { digitAt, luhn, weightedDigitSum } from "../Validators";

/*
 * HEALTH IDENTIFIERS: THE NUMBERS A HEALTH SYSTEM GIVES ITS PATIENTS AND
 * ITS PRESCRIBERS.
 *
 * A national health number names a patient as surely as a passport does,
 * and in a record it sits next to what is wrong with them - so HIPAA, and
 * GDPR's special category, cover it. Like the government IDs
 * (GovernmentIdDetectors.ts), most carry a check digit, and a candidate is
 * a finding only when the check holds. A plain run of ten digits that a
 * single check digit proves (an NHS number, an Australian Medicare number,
 * an NPI) passes for one random number in ten or eleven, and ten digits
 * starting with 1 are a Unix timestamp, so those count only beside a word
 * that names them. Record numbers and member IDs, which have no shape of
 * their own, are HealthRecordDetectors.ts's.
 */

// A plain run of digits that is not 0000000000 or 1234567890.
function isNotPlaceholder(value: string): boolean {
  return !isPlaceholderDigits(digitsOnly(value));
}

// An NHS number: ten digits, usually typed 943 476 5919.
const UK_NHS_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{4}(?![A-Za-z0-9]|[-.][0-9])/g;

const UK_NHS_NUMBER_WEIGHTS: ReadonlyArray<number> = [
  10, 9, 8, 7, 6, 5, 4, 3, 2,
];

/*
 * 11 less the weighted sum modulo 11, where 11 is written 0 and 10 means
 * the number is never issued.
 */
function isUkNhsNumber(digits: string): boolean {
  if (digits.length !== 10 || isPlaceholderDigits(digits)) {
    return false;
  }

  const check: number =
    11 - (weightedDigitSum(digits, UK_NHS_NUMBER_WEIGHTS) % 11);

  return (check === 11 ? 0 : check) === digitAt(digits, 9);
}

/*
 * NHS England keeps the numbers that start with 999 for testing, and
 * 943 476 5919 is the example of its documentation.
 */
function isNhsTestNumber(digits: string): boolean {
  return digits.startsWith("999") || digits === "9434765919";
}

/*
 * A Medicare Beneficiary Identifier: eleven characters in a fixed layout
 * of digits and letters, the letters never S, L, O, I, B or Z (which read
 * like digits), often shown as 1EG4-TE5-MK73.
 */
const US_MEDICARE_MBI_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-?[AC-HJKMNP-RT-Y]{2}[0-9]{2}(?![A-Za-z0-9])/g;

/*
 * An Australian Medicare number: eight digits, the check digit and the
 * card's issue number, often followed by the person's reference number on
 * the card (1-9): 2123 45670 1 2.
 */
const AU_MEDICARE_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[2-6][0-9]{3}[ -]?[0-9]{5}[ -]?[0-9](?:[ -][1-9]|[1-9])?(?![A-Za-z0-9]|[-.][0-9])/g;

const AU_MEDICARE_NUMBER_WEIGHTS: ReadonlyArray<number> = [
  1, 3, 7, 9, 1, 3, 7, 9,
];

function isAuMedicareNumber(digits: string): boolean {
  return (
    (digits.length === 10 || digits.length === 11) &&
    !isPlaceholderDigits(digits.slice(0, 9)) &&
    weightedDigitSum(digits, AU_MEDICARE_NUMBER_WEIGHTS) % 10 ===
      digitAt(digits, 8)
  );
}

// The KVNR: a letter, eight digits and the check digit.
const DE_HEALTH_INSURANCE_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z][0-9]{9}(?![A-Za-z0-9])/g;

/*
 * The letter becomes its place in the alphabet as two digits (A is 01),
 * then those ten digits are weighted 1, 2, 1, 2 ..., a two-digit product
 * counting as the sum of its digits; the check digit is the total
 * modulo 10.
 */
function isDeHealthInsuranceNumber(value: string): boolean {
  if (value.length !== 10 || isPlaceholderDigits(value.slice(1))) {
    return false;
  }

  const letter: number = value.charCodeAt(0) - 64;
  const digits: string =
    String(Math.floor(letter / 10)) + String(letter % 10) + value.slice(1, 9);
  let sum: number = 0;

  for (let index: number = 0; index < 10; index++) {
    let product: number = digitAt(digits, index) * (index % 2 === 0 ? 1 : 2);

    if (product > 9) {
      product -= 9;
    }

    sum += product;
  }

  return sum % 10 === digitAt(value, 9);
}

// An NPI: ten digits starting with 1 or 2.
const US_NPI_PATTERN: RegExp =
  /(?<![A-Za-z0-9]|[0-9][-.])[12][0-9]{9}(?![A-Za-z0-9]|[-.][0-9])/g;

/*
 * The NPI is a card number of the health industry (ISO 7812): Luhn over
 * 80840, the industry's prefix, and the ten digits.
 */
function isUsNpi(digits: string): boolean {
  return (
    digits.length === 10 &&
    !isPlaceholderDigits(digits) &&
    luhn("80840" + digits)
  );
}

/*
 * A DEA number: the kind of registrant (A, B, F and G practitioners, M
 * mid-level practitioners, P and R distributors, X for opioid treatment,
 * and the rest of the DEA's list), the first letter of the registrant's
 * surname (or 9 for a business), six digits and the check digit.
 */
const US_DEA_NUMBER_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[ABCDEFGHJKLMPRSTUX][A-Z9][0-9]{7}(?![A-Za-z0-9])/g;

/*
 * The first, third and fifth digits, plus twice the second, fourth and
 * sixth: the last digit of that is the check digit.
 */
function isUsDeaNumber(value: string): boolean {
  if (value.length !== 9 || isPlaceholderDigits(value.slice(2))) {
    return false;
  }

  const sum: number =
    digitAt(value, 2) +
    digitAt(value, 4) +
    digitAt(value, 6) +
    2 * (digitAt(value, 3) + digitAt(value, 5) + digitAt(value, 7));

  return sum % 10 === digitAt(value, 8);
}

export const HEALTH_IDENTIFIER_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  /*
   * UK NHS number: the mod 11 check digit. One ten-digit number in eleven
   * passes, so beside a word.
   */
  {
    dataTypeId: "uk-nhs-number",
    quickCheck: hasDigit,
    pattern: UK_NHS_NUMBER_PATTERN,
    normalize: digitsOnly,
    validate: isUkNhsNumber,
    keywords: ["nhs", "nhs number", "nhs no", "national health service"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    isTestValue: isNhsTestNumber,
  },
  /*
   * US Medicare Beneficiary Identifier: CMS's layout of digits and letters.
   * It has no check digit, but no other number is laid out like it, so it
   * shows (Low) on its own.
   */
  {
    dataTypeId: "us-medicare-mbi",
    quickCheck: hasDigit,
    pattern: US_MEDICARE_MBI_PATTERN,
    normalize: alphanumericUpper,
    validate: isNotPlaceholder,
    keywords: [
      "mbi",
      "medicare",
      "medicare number",
      "medicare beneficiary",
      "beneficiary id",
    ],
    confidenceWithoutContext: DataConfidence.Low,
    specificity: 1,
    // The example of CMS's MBI format specification.
    isTestValue: (value: string): boolean => {
      return value === "1EG4TE5MK73";
    },
  },
  /*
   * Australia Medicare number: a first digit of 2-6 and the check digit
   * weighted 1, 3, 7, 9 - one in ten passes, so beside a word.
   */
  {
    dataTypeId: "au-medicare-number",
    quickCheck: hasDigit,
    pattern: AU_MEDICARE_NUMBER_PATTERN,
    normalize: digitsOnly,
    validate: isAuMedicareNumber,
    keywords: [
      "medicare",
      "medicare number",
      "medicare no",
      "medicare card",
      "irn",
    ],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 2,
    // The card number in Services Australia's examples.
    isTestValue: (digits: string): boolean => {
      return digits.startsWith("2123456701");
    },
  },
  /*
   * Germany Krankenversichertennummer: a letter, eight digits and the
   * weighted check digit over the letter's two digits and the eight.
   */
  {
    dataTypeId: "de-health-insurance-number",
    quickCheck: hasDigit,
    pattern: DE_HEALTH_INSURANCE_NUMBER_PATTERN,
    validate: isDeHealthInsuranceNumber,
    keywords: [
      "kvnr",
      "krankenversichertennummer",
      "versichertennummer",
      "krankenversicherung",
      "egk",
    ],
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 3,
    // The example of the GKV-Spitzenverband's specification.
    isTestValue: (value: string): boolean => {
      return value === "A123456780";
    },
  },
  /*
   * US National Provider Identifier: Luhn with the 80840 prefix. Ten
   * digits starting with 1 are a Unix timestamp too, so beside a word.
   */
  {
    dataTypeId: "us-npi",
    quickCheck: hasDigit,
    pattern: US_NPI_PATTERN,
    normalize: digitsOnly,
    validate: isUsNpi,
    keywords: ["npi", "npi number", "national provider identifier"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 3,
    // The example of CMS's NPI check-digit document.
    isTestValue: (digits: string): boolean => {
      return digits === "1234567893";
    },
  },
  /*
   * US DEA number: the registrant-kind letter and the check digit. Two
   * letters and seven digits are a common shape for any code, and one in
   * ten passes, so beside a word.
   */
  {
    dataTypeId: "us-dea-number",
    quickCheck: hasDigit,
    pattern: US_DEA_NUMBER_PATTERN,
    validate: isUsDeaNumber,
    keywords: ["dea", "dea number", "dea no", "dea registration", "dea#"],
    requiresContext: true,
    confidenceWithoutContext: DataConfidence.Medium,
    specificity: 3,
    // The example every DEA check-digit explanation uses.
    isTestValue: (value: string): boolean => {
      return value === "AB1234563";
    },
  },
];

export default HEALTH_IDENTIFIER_DETECTORS;
