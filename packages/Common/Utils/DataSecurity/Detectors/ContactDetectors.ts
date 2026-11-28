import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  alphanumericUpper,
  containsAny,
  DataTypeDetector,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
  withEveryReading,
} from "../Detector";
import { isRealDate } from "../Validators";
import { isTestStreetAddress } from "../Model/RecognizedEntity";
import PercentDecodedText from "../PercentDecodedText";
import IpCanonicalUtil from "../../IpCanonicalUtil";

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

/*
 * An address in one spelling: its percent-escapes read (jos%C3%A9 is josé,
 * #11032), lower case, and its accents composed (é as one character, not e
 * and a mark) - so an encoded address and the same address written plainly
 * are one value, to a fingerprint, an allowed value and a test value alike.
 */
function normalizeEmail(value: string): string {
  return PercentDecodedText.readableOf(value).normalize("NFC").toLowerCase();
}

const emailDetector: DataTypeDetector = {
  dataTypeId: "email-address",
  quickCheck: containsAny(["@"]),
  pattern: EMAIL_PATTERN,
  normalize: normalizeEmail,
  validate: (normalized: string): boolean => {
    return isValidEmail(normalized);
  },
  keywords: ["email", "e-mail", "mail", "contact", "to:", "from:", "cc:"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  isTestValue: isTestEmail,
  /*
   * An address in a percent-encoded URL: jane.doe%40acmecorp.io in
   * /signup?email=jane.doe%40acmecorp.io, as browsers and HTTP clients
   * write a query string (#10935). Read decoded, its "@" (%40), dots (%2E)
   * and plus signs (%2B) are what they stand for, and the finding - and
   * what an Email Address rule hides - is the encoded address whole.
   */
  readsPercentEncoded: true,
  /*
   * An address typed in fullwidth, as an input method in fullwidth mode
   * types one (#11385): ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ, and jane＠example.com
   * with its "@" alone in fullwidth. Read with the fullwidth ASCII block
   * read as ASCII, it is jane@example.com, found on the characters it is
   * typed with.
   */
  readsFullwidthLetters: true,
};

/*
 * An email address in any script, as RFC 6531 allows one (#10960):
 * josé@example.com, 张伟@example.com, user@例え.jp, почта@пример.рф, and one
 * whose top-level domain is punycode (user@пример.xn--p1ai). EMAIL_PATTERN
 * reads a name, a domain and a top-level domain in ASCII alone, so none of
 * them was found. Read as the OneUptime Android agent's redactor reads one
 * (Utils/Host/AndroidAgentRedactor.ts, EMAIL_ADDRESS, #10937), so the two
 * agree on what an address is:
 *
 *  - its name is Latin, in ASCII or not (josé, müller), or in the letters
 *    of other scripts (张伟, почта), each with digits, marks and "._%+-",
 *    but not both: where the two meet is where an address begins, so a
 *    letter of another script right before an ASCII address is no part of
 *    it (邮箱jane@example.com is jane@example.com). Each starts right after
 *    none of its own characters, and a name in another script holds at
 *    least one of their letters;
 *  - neither starts with a digit right after a digit and a space: that is
 *    the next group of a number, and a card written in groups keeps its
 *    last one (4111 1111 1111 1111é@例え.jp);
 *  - its domain holds the letters, marks and digits of any script, or
 *    punycode (例え is xn--r8jz45g), and its top-level domain is ASCII
 *    letters, punycode - which always holds a letter, so "xn--4111" is none
 *    - or another script's letters (рф, 中国);
 *  - it ends right before no ASCII letter, digit, "_" or "-", so a letter
 *    of another script after an ASCII top-level domain is no part of it
 *    (jane@example.com已发送). One in another script takes in the letters
 *    of its script written right after it: nothing tells where it ends.
 *
 * Where the redactor writes a domain as labels repeated without bound, this
 * reads it as EMAIL_PATTERN does, one run of at most 253 characters with
 * its dots, and isValidEmail judges its labels. The database cannot run
 * Unicode classes as JavaScript reads them (DetectorPrefilter writes no u
 * pattern), so it narrows by an "@" beside a character beyond ASCII: an
 * address this alone finds holds one, and an ASCII one is narrowed by
 * EMAIL_PATTERN's expression.
 */
const UNICODE_EMAIL_PATTERN: RegExp =
  /(?<!\p{Nd} (?=\p{Nd}))(?:(?<![\p{sc=Latin}\p{M}\p{Nd}._%+-])[\p{sc=Latin}\p{M}\p{Nd}._%+-]{1,64}|(?<![\p{M}\p{Nd}._%+-]|[^\P{L}\p{sc=Latin}])(?=[\p{M}\p{Nd}._%+-]{0,63}[^\P{L}\p{sc=Latin}])(?:[^\P{L}\p{sc=Latin}]|[\p{M}\p{Nd}._%+-]){1,64})@[\p{L}\p{M}\p{Nd}.-]{1,253}\.(?:[A-Za-z]{2,24}|[Xx][Nn]--(?=[A-Za-z0-9-]{0,58}[A-Za-z])[A-Za-z0-9-]{1,59}|[\p{L}\p{M}]{2,24})(?![A-Za-z0-9_-])/gu;

/*
 * A character beyond ASCII, then up to an address's name of anything but
 * "@" and a space, then "@"; or "@", then up to a domain and its top-level
 * domain of the same, then a character beyond ASCII. Written as
 * DetectorPrefilter writes RE2: each character as \x{...}.
 */
const UNICODE_EMAIL_PREFILTER: string =
  "[^\\x{0}-\\x{7F}][^\\x{40}\\x{9}-\\x{D}\\x{20}]{0,64}\\x{40}|\\x{40}[^\\x{40}\\x{9}-\\x{D}\\x{20}]{0,280}[^\\x{0}-\\x{7F}]";

const unicodeEmailDetector: DataTypeDetector = {
  ...emailDetector,
  pattern: UNICODE_EMAIL_PATTERN,
  prefilter: UNICODE_EMAIL_PREFILTER,
};

/*
 * WHAT DATA SECURITY CALLS AN EMAIL ADDRESS: an address in ASCII, and one
 * in any script, each read percent-encoded too. An Email Address scrub rule
 * hides what these find, as well as what its own pattern does
 * (Utils/Telemetry/ScrubBuiltInPatterns.ts), so a finding and the rule that
 * covers it never disagree on what an address is.
 */
export const EMAIL_ADDRESS_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  emailDetector,
  unicodeEmailDetector,
];

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

/*
 * The words that name a phone number by themselves (#11496): beside one of
 * them, nine to twelve digits are a number to call.
 */
const PHONE_NAMING_WORDS: ReadonlyArray<string> = [
  "phone",
  "telephone",
  "tel",
  "mobile",
  "cellphone",
  "sms",
  "whatsapp",
  "fax",
];

/*
 * Words that say a phone number only some of the time (#11496): "call
 * started at 1732752000" is a Unix time, "cell 104857600" a size in bytes,
 * "contact 123456789" an id. Beside one of them a run of digits is a phone
 * number only when it is written as a national one is dialled - with its
 * trunk prefix, 0, first (trunkNationalPhoneDetector) - or when a word
 * after them names a number (PHONE_NUMBER_PHRASES).
 */
const PHONE_SOMETIMES_WORDS: ReadonlyArray<string> = [
  "call",
  "cell",
  "contact",
];

/*
 * Those words with one after them that names a number (#11496): "call me
 * on 2012345678", "contact number: 612345678".
 */
const PHONE_NUMBER_PHRASES: ReadonlyArray<string> = [
  "call me on",
  "call me at",
  "call us on",
  "call us at",
  "call back on",
  "call back at",
  "callback number",
  "call-back number",
  "contact number",
  "contact no",
  "contact #",
  "cell number",
  "cell no",
  "cell #",
];

/*
 * The words a national number with no other shape needs beside it: one
 * that names a phone number, or a phrase that does (#11496).
 */
const NATIONAL_PHONE_KEYWORDS: ReadonlyArray<string> = [
  ...PHONE_NAMING_WORDS,
  ...PHONE_NUMBER_PHRASES,
];

/*
 * Every word that says a value may be a phone number: what raises a phone
 * number of its own shape's confidence beside it.
 */
const PHONE_KEYWORDS: ReadonlyArray<string> = [
  ...PHONE_NAMING_WORDS,
  ...PHONE_SOMETIMES_WORDS,
];

/*
 * "+44 20 7946 0958", "+1 (415) 555-2671": a calling code and 7 to 14
 * digits, set apart by spaces - a no-break space too, as typeset text writes
 * them (#11025) - hyphens, dots and parentheses.
 */
const INTERNATIONAL_PHONE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+])\+[1-9][0-9 \u00A0().-]{6,22}[0-9](?![0-9])/g;

// A calling code in parentheses, "(+44) 20 7946 0958": its ")" closes the "(" before the "+".
const CALLING_CODE_IN_PARENTHESES: RegExp = /^\+[1-9][0-9]{0,2}\)/;

function hasSaneSeparators(raw: string): boolean {
  let open: number = CALLING_CODE_IN_PARENTHESES.test(raw) ? 1 : 0;
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

    if (
      character === " " ||
      character === "\u00A0" ||
      character === "-" ||
      character === "."
    ) {
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

// A run of digits of a "+" number, and whether it is in parentheses.
interface PhoneGroup {
  digits: number;
  inParentheses: boolean;
  // The value of its digits, while it has at most three.
  value: number;
}

function phoneGroupsOf(raw: string): Array<PhoneGroup> {
  const groups: Array<PhoneGroup> = [];
  let inParentheses: boolean = CALLING_CODE_IN_PARENTHESES.test(raw);
  let current: PhoneGroup | null = null;

  for (const character of raw) {
    if (character >= "0" && character <= "9") {
      if (!current) {
        current = { digits: 0, inParentheses, value: 0 };
        groups.push(current);
      }

      current.digits++;
      current.value =
        current.digits <= 3 ? current.value * 10 + Number(character) : 1000;
      continue;
    }

    current = null;

    if (character === "(") {
      inParentheses = true;
    } else if (character === ")") {
      inParentheses = false;
    }
  }

  return groups;
}

// "+192.168.10.20": a plus sign, then digits set apart by dots and nothing else.
const DIGITS_AND_DOTS_ONLY: RegExp = /^\+[0-9.]+$/;

// A date in its ISO order, 2026-11-24: what a time zone's offset is written beside.
const ISO_DATE_PATTERN: RegExp =
  /(?<![0-9])(?:19|20)[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])(?![0-9])/;

/*
 * WHETHER A "+" NUMBER IS WRITTEN AS A PHONE NUMBER IS (#11025).
 *
 * A Phone Number scrub rule hides what this detector finds, wherever the
 * rule runs and with no word around the value to weigh (Utils/Telemetry/
 * ScrubBuiltInPatterns.ts), so what it finds is held to the shapes people
 * write a phone number in - as grouping v4 holds the numbers it folds out of
 * an exception's message (Server/Utils/Telemetry/ExceptionSanitizer.ts,
 * foldSeparatedNumbersV4) - and the numbers that only look like one are
 * left alone:
 *
 *  - its groups are set apart by spaces, hyphens and parentheses, or by
 *    dots - two or more, beside no hyphen: one dot is a decimal or a
 *    coordinate (+51.507217), and dots beside a hyphen are a coordinate
 *    pair (+40.6894-074.0447). Four groups of at most three digits up to
 *    255, by dots alone, are an IPv4 address;
 *  - a group of one digit comes right after the calling code
 *    (+33 1 23 45 67 89) or in parentheses (+44 (0)20 7946 0958), and
 *    nowhere else: +1 2 3 4 5 6 7 8 is a count;
 *  - no date is in it: +1 2026-11-24 is a time zone's offset and a date.
 */
function isWrittenAsPhoneNumber(raw: string): boolean {
  const dots: number = raw.split(".").length - 1;

  if (dots === 1 || (dots > 1 && raw.includes("-"))) {
    return false;
  }

  const groups: Array<PhoneGroup> = phoneGroupsOf(raw);

  if (
    DIGITS_AND_DOTS_ONLY.test(raw) &&
    groups.length === 4 &&
    groups.every((group: PhoneGroup) => {
      return group.digits <= 3 && group.value <= 255;
    })
  ) {
    return false;
  }

  for (let index: number = 2; index < groups.length; index++) {
    if (groups[index]!.digits === 1 && !groups[index]!.inParentheses) {
      return false;
    }
  }

  return !ISO_DATE_PATTERN.test(raw);
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
      hasSaneSeparators(raw) &&
      isWrittenAsPhoneNumber(raw)
    );
  },
  keywords: PHONE_KEYWORDS,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isTestPhoneNumber,
  /*
   * In a percent-encoded URL too - /callback?phone=%2B44%2020%207946%200958
   * - and in every script's digits (#11030), as a query string writes it, a
   * "+" for each space and its own "+" escaped (#11199):
   * phone=%2B44+20+7946+0958, and typed wholly in fullwidth, as Japanese
   * and Chinese text writes one, its plus sign, hyphens, parentheses and
   * ideographic spaces too (#11115): ＋８１ ３－１２３４－５６７８ - its groups
   * set apart by another dash as well, ＋８１ ３ー１２３４ー５６７８ or
   * +44 20 7946‑0958, and the words beside it typed in fullwidth, ＴＥＬ
   * (#11385). What a Phone Number rule hides, it finds in every reading
   * (ScrubBuiltInPatterns).
   */
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
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
  // In every reading, as internationalPhoneDetector.
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
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
  // In every reading, as internationalPhoneDetector.
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
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
  keywords: NATIONAL_PHONE_KEYWORDS,
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  isTestValue: isTestPhoneNumber,
  fieldValuePattern: /^\+?[0-9][0-9 ().-]{6,22}[0-9]$/,
  // In every reading, as internationalPhoneDetector: phone+number=... is its words.
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
};

/*
 * A NATIONAL NUMBER IN THE GROUPS PEOPLE WRITE IT IN (#11493).
 *
 * A national number is written in groups as often as in one run: Tokyo's
 * 03-1234-5678, London's 020 7946 0958, Paris's 06 12 34 56 78 or
 * 06.12.34.56.78, Madrid's 612 34 56 78, Sydney's (02) 1234 5678, Berlin's
 * 030 12345678. Each is two to five groups - the first of two to five
 * digits, each after it of two to eight - set apart by one kind of
 * separator throughout - a space, a hyphen or a dot - or an area code in
 * parentheses first, then a space or a hyphen between the rest. Another
 * dash between two digits reads as a hyphen (readsFullwidthForms, #11385),
 * so 03ー1234ー5678 is found too. It ends before no other group of it, so a
 * group is never cut from a longer run.
 */
const GROUPED_NATIONAL_PHONE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+./:-])(?:\(0?[1-9][0-9]{0,3}\)[ ]?[0-9]{2,8}(?:[ -][0-9]{2,8}){0,3}|[0-9]{2,5}(?:[ ][0-9]{2,8}){1,4}|[0-9]{2,5}(?:-[0-9]{2,8}){1,4}|[0-9]{2,5}(?:\.[0-9]{2,8}){1,4})(?![0-9]|[ .:/-][0-9])/g;

// A run of digits of a number written in groups.
const DIGIT_GROUP: RegExp = /[0-9]+/g;

// The area code a number written in groups starts with, in parentheses.
const AREA_CODE_IN_PARENTHESES: RegExp = /^\(([0-9]+)\)/;

// The runs of digits a number is written in, as numbers' texts.
function digitGroupsOf(raw: string): Array<string> {
  return raw.match(DIGIT_GROUP) || [];
}

function isYear(group: string): boolean {
  return (
    group.length === 4 && (group.startsWith("19") || group.startsWith("20"))
  );
}

function isMonth(group: string): boolean {
  const month: number = Number(group);

  return group.length <= 2 && month >= 1 && month <= 12;
}

function isDay(group: string): boolean {
  const day: number = Number(group);

  return group.length <= 2 && day >= 1 && day <= 31;
}

/*
 * WHETHER A NUMBER WRITTEN IN GROUPS IS WRITTEN AS A NATIONAL PHONE NUMBER
 * IS (#11493): 9 to 12 digits in all, and none of what only looks like one
 * - a date, read year first or day first, with a time or a count after it
 * (2024-11-28-1030), an IPv4 address (192.168.100.200), a range of two
 * numbers of one length (10000-20000), a run of small counts no trunk
 * prefix starts (10 20 30 40 50), a US Social Security number's groups
 * (536-22-8731), a North American area code in parentheses, which the
 * North American detector reads ((718) 487-63058) - nor a placeholder. A
 * time (10:30:00) and a version
 * (1.2.3) are never written so: a colon sets no group apart, and every
 * group has two digits at least.
 */
export function isWrittenAsNationalPhoneNumber(
  digits: string,
  raw: string,
): boolean {
  if (digits.length < 9 || digits.length > 12 || isPlaceholderDigits(digits)) {
    return false;
  }

  const groups: Array<string> = digitGroupsOf(raw);

  if (groups.length < 2) {
    return false;
  }

  const [first, second, third] = groups as [string, string, string | undefined];

  // A date: 2024-11-28 or 2024.11.28, and 28-11-2024 or 28.11.2024.
  if (
    third !== undefined &&
    ((isYear(first) && isMonth(second) && isDay(third)) ||
      (isDay(first) && isMonth(second) && isYear(third)) ||
      (isMonth(first) && isDay(second) && isYear(third)))
  ) {
    return false;
  }

  /*
   * A US Social Security number as it is written, three digits, two and
   * four, by hyphens, dots or spaces: an SSN's own groups, which no
   * country writes its numbers in. Read as a national number, an SSN a
   * phone word happened to be near - "phone 201234567 for SSN
   * 536.22.8731" - was a phone number to a Phone Number rule, which hid it
   * before the SSN rule could mask it as one.
   */
  if (
    groups.length === 3 &&
    first.length === 3 &&
    second.length === 2 &&
    third!.length === 4
  ) {
    return false;
  }

  /*
   * A North American area code in parentheses, three digits with no trunk
   * prefix - (718): the North American detector reads a number written so,
   * three digits and four after it, and one written otherwise - (718)
   * 487-63058 - is no number. A country that writes its area code in
   * parentheses without a trunk prefix writes two digits, as Brazil's (11)
   * 91234-5678 and Mexico's (55) 1234 5678.
   */
  const area: RegExpMatchArray | null = raw.match(AREA_CODE_IN_PARENTHESES);

  if (area && area[1]!.length === 3 && !area[1]!.startsWith("0")) {
    return false;
  }

  // An IPv4 address: four groups of at most three digits, none over 255.
  if (
    raw.includes(".") &&
    groups.length === 4 &&
    groups.every((group: string): boolean => {
      return group.length <= 3 && Number(group) <= 255;
    })
  ) {
    return false;
  }

  // A range: two numbers of one length, no trunk prefix, joined by a hyphen.
  if (
    groups.length === 2 &&
    raw.includes("-") &&
    first.length === second.length &&
    !first.startsWith("0") &&
    !second.startsWith("0")
  ) {
    return false;
  }

  // Counts of two digits each, which no national number's trunk prefix starts.
  return (
    first.startsWith("0") ||
    groups.some((group: string): boolean => {
      return group.length > 2;
    })
  );
}

const groupedNationalPhoneDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: hasDigit,
  pattern: GROUPED_NATIONAL_PHONE_PATTERN,
  normalize: digitsOnly,
  validate: isWrittenAsNationalPhoneNumber,
  keywords: NATIONAL_PHONE_KEYWORDS,
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  isTestValue: isTestPhoneNumber,
  // In every reading, as nationalPhoneDetector: another dash between its groups too.
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
};

/*
 * A NATIONAL NUMBER WITH ITS TRUNK PREFIX, BESIDE A WORD THAT SAYS A PHONE
 * NUMBER ONLY SOME OF THE TIME (#11496).
 *
 * "call", "cell" and "contact" say a phone number in "call 020 7946 0958"
 * and "cell: 0612345678", and nothing of the kind in "call started at
 * 1732752000" or "cell 104857600". A national number dialled at home starts
 * with its trunk prefix, 0, as no Unix time, size or id does: beside one
 * of those words, a run of digits or a number in groups is one only so.
 */
const TRUNK_NATIONAL_PHONE_PATTERN: RegExp =
  /(?<![A-Za-z0-9+./:-])(?:0[1-9][0-9]{8,11}|\(0[1-9][0-9]{0,3}\)[ ]?[0-9]{2,8}(?:[ -][0-9]{2,8}){0,3}|0[0-9]{1,4}(?:[ ][0-9]{2,8}){1,4}|0[0-9]{1,4}(?:-[0-9]{2,8}){1,4}|0[0-9]{1,4}(?:\.[0-9]{2,8}){1,4})(?![0-9]|[ .:/-][0-9])/g;

const trunkNationalPhoneDetector: DataTypeDetector = {
  dataTypeId: "phone-number",
  quickCheck: hasDigit,
  pattern: TRUNK_NATIONAL_PHONE_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string, raw: string): boolean => {
    return (
      digits.startsWith("0") &&
      (digitGroupsOf(raw).length === 1
        ? !isPlaceholderDigits(digits)
        : isWrittenAsNationalPhoneNumber(digits, raw))
    );
  },
  keywords: PHONE_SOMETIMES_WORDS,
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  isTestValue: isTestPhoneNumber,
  // In every reading, as nationalPhoneDetector.
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
};

/*
 * WHAT DATA SECURITY CALLS A PHONE NUMBER: an international number, a
 * North American one written as people write it, and a UK mobile, each on
 * its own - and a national number of 9 to 12 digits of no other shape,
 * beside a word that names it ("tel 02012345678", nationalPhoneDetector).
 * A Phone Number scrub rule hides what these find, as well as what its
 * own pattern does (Utils/Telemetry/ScrubBuiltInPatterns.ts, #11030), in
 * every reading they ask for: the national number only with one of its
 * words near it in the value the rule reads, as the scanner judges it
 * (TextReadings.findDetectorRanges, #11114), so "order 02012345678" keeps
 * its digits.
 */
export const PHONE_NUMBER_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  internationalPhoneDetector,
  nanpFormattedDetector,
  ukMobileDetector,
  nationalPhoneDetector,
  groupedNationalPhoneDetector,
  trunkNationalPhoneDetector,
];

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
  // 123 Main Street and the other placeholders: as the names-and-addresses model counts them.
  isTestValue: isTestStreetAddress,
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
  // An address in a percent-encoded URL: 8%2E8%2E8%2E8 (#10467).
  readsPercentEncoded: true,
};

/*
 * Whether text is an IPv6 address that names one host on the internet: an
 * address at all (IpCanonicalUtil.getIpv6Groups reads it as Node does - its
 * "::" and an IPv4 tail too), and none of the unspecified and loopback
 * addresses, link-local, unique-local, multicast or anything else under
 * ::/16. IPv4-mapped addresses are under ::/16 as well: an IPv4 address
 * written as IPv6 (::ffff:8.8.8.8) is judged as the IPv4 address it is, by
 * isIpv6AddressData. The first group is the address's own, so "::abcd" is
 * under ::/16, not a host of abcd::/16.
 */
export function isPublicIpv6(address: string): boolean {
  const groups: Array<number> | null = IpCanonicalUtil.getIpv6Groups(address);

  if (!groups) {
    return false;
  }

  const first: number = groups[0]!;

  return !(
    first === 0 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00
  );
}

// 2001:db8::/32, however its groups are written: 2001:db8:: or 2001:0db8:...
export function isDocumentationIpv6(address: string): boolean {
  const groups: Array<number> | null = IpCanonicalUtil.getIpv6Groups(address);

  return groups !== null && groups[0] === 0x2001 && groups[1] === 0x0db8;
}

/*
 * An address with one group each side of "::" (2001::1, 2a00::1, 2606::1),
 * as a server or a hand-assigned address is often written (#10466), or
 * with an IPv4 address after the "::" (2001::8.8.8.8). Every address the
 * internet routes is global unicast, 2000::/3, so written this way its
 * first group is four characters from 2000 to 3fff. Nothing else of three
 * parts is: a clock (12:30:45) has no "::", and a scope of a program
 * (Abc::Def, a::b, dead::beef, std::vector) is named by an identifier,
 * which never starts with a digit.
 */
const ONE_GROUP_EACH_SIDE: RegExp =
  /^[23][0-9A-Fa-f]{3}::(?:[0-9A-Fa-f]{1,4}|[0-9]{1,3}(?:\.[0-9]{1,3}){3})$/;

/*
 * Whether an IPv6 candidate is what the IP address type means: a public
 * address, or one of the documentation prefix (counted as a test value), so
 * a test with 2001:db8::1 shows a rule working. An IPv4 address written as
 * IPv6 (::ffff:203.0.113.7) is judged as that IPv4 address. An address has
 * four parts or more, or one global group each side of "::": a clock reads
 * 12:30:45, and C++ names a scope Abc::Def.
 */
export function isIpv6AddressData(address: string): boolean {
  if (address.split(":").length < 4 && !ONE_GROUP_EACH_SIDE.test(address)) {
    return false;
  }

  const ipv4: string | null = IpCanonicalUtil.getIpv4OfMappedAddress(address);

  if (ipv4 !== null) {
    return isPublicIpv4(ipv4) || isDocumentationIpv4(ipv4);
  }

  return isPublicIpv6(address) || isDocumentationIpv6(address);
}

// A documentation address in IPv6: 2001:db8::/32, or ::ffff: and an RFC 5737 one.
function isDocumentationIpv6Value(address: string): boolean {
  const ipv4: string | null = IpCanonicalUtil.getIpv4OfMappedAddress(address);

  return ipv4 !== null
    ? isDocumentationIpv4(ipv4)
    : isDocumentationIpv6(address);
}

/*
 * An IPv6 address as telemetry writes it, never inside a longer run of hex
 * digits and colons: groups and colons, the last group written out or after
 * a "::" that may end the address (2001:db8::) or lead to more groups
 * (2001:db8::8a2e:370:7334); one that starts with "::" (::ffff:808:808);
 * or one whose last 32 bits are an IPv4 address (::ffff:8.8.8.8,
 * 64:ff9b::192.0.2.1, 2001:db8::1.2.3.4) - what a dual-stack server logs
 * for an IPv4 client - found whole, so it is hidden whole. In brackets with
 * a port ([2001:db8::1]:443) the brackets and the port are left out, and a
 * zone (fe80::1%eth0) too. A candidate followed by ".digit" is part of
 * something else.
 *
 * One group each side of "::" (2001::1) is read apart: only a global
 * group first (ONE_GROUP_EACH_SIDE), and only standing on its own - no
 * letter, digit, "_" or "." right before it, no letter, digit, "_" or ":"
 * right after - so v1::api, Api2023::face and Release_2024::Beta hold no
 * address (#10466). The other forms never take that shape: it is refused
 * at their start.
 *
 * Where it may start (#10936): never inside a word - no letter, digit or
 * "_" right before it, as no other detector starts inside one - nor inside
 * a longer run of groups and colons, but right after a key's colon, as
 * logfmt and syslog lines write one: peer ip:2a00:1450:4001:82a::200e,
 * remote:2a00:..., addr:2001:db8::7, client_ip:2a02:... A colon ends a key
 * when the word before it holds a letter no hex group has (g to z) or a
 * "_" within its last 63 characters, so after "ip:", "ip6:" or "remote:"
 * an address starts at its first group - "remote:" no longer lends it its
 * "e", nor "node:" its "de" or "ip6:" its "6" - while inside 2001:db8::1 no
 * candidate starts at db8, as every group before a colon there is hex. A
 * clock, a MAC address or a ratio after a key's colon (time:12:30:45,
 * mac:00:1a:2b:3c:4d:5e, ratio:3:1) is still no address: isIpv6AddressData
 * judges them as anywhere else. A key of hex letters alone (cafe:2001::1)
 * cannot be told from an address's first group, which it is read as.
 *
 * Bounded, so a long run of colons and digits is read in time in line
 * with its length.
 */
const IPV6_PATTERN: RegExp =
  /(?<![0-9A-Za-z_]|(?<![G-Zg-z_][0-9A-Za-z_.-]{0,62}):)(?:(?![0-9A-Fa-f]{1,4}::[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:]))(?:[0-9A-Fa-f]{1,4}:){1,7}(?:[0-9A-Fa-f]{1,4}|:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5})?)(?![0-9A-Fa-f:])|::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?(?![0-9A-Fa-f:])|(?:(?:[0-9A-Fa-f]{1,4}:){1,6}|(?:[0-9A-Fa-f]{1,4}:){1,5}:(?:[0-9A-Fa-f]{1,4}:){0,4}|::(?:[0-9A-Fa-f]{1,4}:){0,5})(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}|(?<![A-Za-z_.])[23][0-9A-Fa-f]{3}::[0-9A-Fa-f]{1,4}(?![A-Za-z_:]))(?![0-9]|\.[0-9])/g;

const ipv6Detector: DataTypeDetector = {
  dataTypeId: "ip-address",
  quickCheck: containsAny([":"]),
  pattern: IPV6_PATTERN,
  validate: isIpv6AddressData,
  keywords: ["ip", "address", "client", "remote", "forwarded", "ipv6"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: isDocumentationIpv6Value,
  // An address in a percent-encoded URL: 2001%3Adb8%3A%3A1 (#10467).
  readsPercentEncoded: true,
};

/*
 * WHAT DATA SECURITY CALLS AN IP ADDRESS, AND WHAT AN IP ADDRESS SCRUB RULE
 * HIDES: the two detectors of the type, IPv6 first. A scrub rule's IP
 * Address pattern finds its matches with these very detectors - their
 * patterns, quick checks and validators (Utils/Telemetry/ScrubIpAddress.ts)
 * - so a finding and the rule that covers it can never disagree on what an
 * address is (#10393). Both read a text with its percent-escapes read too,
 * so an address in an encoded URL is found and hidden alike (#10467).
 */
export const IP_ADDRESS_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  ipv6Detector,
  ipv4Detector,
];

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

/*
 * WHAT DATA SECURITY CALLS A POSTAL CODE: a UK postcode and a Canadian
 * postal code, each on its own, and a US ZIP code or ZIP+4 only beside a
 * word that names it ("zip 94107") or alone under a key that names one
 * (`address.zip`). Each read however it is written (withEveryReading), as
 * a phone number is: in every script's digits (#11200) - a UK postcode's
 * digits in fullwidth ones its own - and in a URL (#11199):
 * postcode=SW1A+2AA. A Postal Code scrub rule hides what these find
 * (Utils/Telemetry/ScrubBuiltInPatterns.ts, #11502): the ZIP code only
 * with one of its words near it in the value the rule reads, or under a
 * key that names it, as the scanner judges it
 * (TextReadings.findDetectorRanges), so "order 94107" keeps its digits.
 */
export const POSTAL_CODE_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  withEveryReading(ukPostcodeDetector),
  withEveryReading(canadaPostalCodeDetector),
  withEveryReading(usZipDetector),
];

/*
 * WHAT DATA SECURITY CALLS A PRECISE LOCATION: a latitude and longitude
 * pair on its own, and one coordinate only beside a word that names it
 * ("lat 51.50722") or alone under a key that names one (`location.lat`),
 * each with at least four decimals. A Coordinates scrub rule hides what
 * these find (Utils/Telemetry/ScrubBuiltInPatterns.ts, #11502), the lone
 * coordinate as the scanner judges it, so "ratio 0.12345" keeps its digits.
 */
export const COORDINATE_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  coordinatePairDetector,
  singleCoordinateDetector,
];

/*
 * A postal code and a date of birth read however they are written
 * (withEveryReading), as a phone number is: in every script's digits
 * (#11200) - ١٩٨٥-٠٣-١٢ beside "date of birth" is the date it is, a UK
 * postcode's digits in fullwidth ones its own - and in a URL (#11199):
 * postcode=SW1A+2AA, dob=12%2F03%2F1985, date+of+birth=... And a street
 * address, whose words a URL writes apart by %20 or "+" too:
 * address=10+Downing+Street.
 */
export const CONTACT_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  emailDetector,
  unicodeEmailDetector,
  ...PHONE_NUMBER_DETECTORS,
  {
    ...streetAddressDetector,
    readsPercentEncoded: true,
    readsPlusAsSpace: true,
  },
  ...POSTAL_CODE_DETECTORS,
  withEveryReading(numericBirthDateDetector),
  withEveryReading(writtenBirthDateDetector),
  ipv4Detector,
  ipv6Detector,
  macDetector,
  advertisingIdDetector,
  ...COORDINATE_DETECTORS,
  vinDetector,
];

export default CONTACT_DETECTORS;
