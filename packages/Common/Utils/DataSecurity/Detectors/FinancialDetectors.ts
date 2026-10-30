import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  alphanumericUpper,
  containsAny,
  DataTypeDetector,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
} from "../Detector";
import {
  base58Check,
  base58Version,
  bech32,
  ibanMod97,
  luhn,
  weightedDigitSum,
} from "../Validators";

/*
 * FINANCIAL DATA: CARDS, BANK ACCOUNTS AND WALLETS.
 *
 * A card number is the single most regulated value a store can hold (PCI
 * DSS puts every system that touches one in scope), so the card detector
 * asks the most of a candidate: the Luhn check, a real brand's number range
 * and that brand's length, and - when the number is written in groups - the
 * brand's grouping. A 16-digit order ID passes Luhn one time in ten; it
 * rarely passes all four.
 */

interface CardBrand {
  name: string;
  // Inclusive ranges of the number's leading digits.
  ranges: ReadonlyArray<[string, string]>;
  lengths: ReadonlyArray<number>;
}

// The issuer ranges of the brands that matter, from the brands' own rules.
const CARD_BRANDS: ReadonlyArray<CardBrand> = [
  { name: "Visa", ranges: [["4", "4"]], lengths: [13, 16, 19] },
  {
    name: "Mastercard",
    ranges: [
      ["51", "55"],
      ["2221", "2720"],
    ],
    lengths: [16],
  },
  {
    name: "American Express",
    ranges: [
      ["34", "34"],
      ["37", "37"],
    ],
    lengths: [15],
  },
  {
    name: "Discover",
    ranges: [
      ["6011", "6011"],
      ["644", "649"],
      ["65", "65"],
    ],
    lengths: [16, 17, 18, 19],
  },
  {
    name: "Diners Club",
    ranges: [
      ["300", "305"],
      ["36", "36"],
      ["38", "39"],
    ],
    lengths: [14, 15, 16, 17, 18, 19],
  },
  { name: "JCB", ranges: [["3528", "3589"]], lengths: [16, 17, 18, 19] },
  { name: "UnionPay", ranges: [["62", "62"]], lengths: [16, 17, 18, 19] },
  {
    name: "Maestro",
    ranges: [
      ["50", "50"],
      ["56", "69"],
    ],
    lengths: [12, 13, 14, 15, 16, 17, 18, 19],
  },
  {
    name: "RuPay",
    ranges: [
      ["60", "60"],
      ["81", "82"],
      ["508", "508"],
    ],
    lengths: [16],
  },
];

export function getCardBrand(digits: string): string | null {
  for (const brand of CARD_BRANDS) {
    if (!brand.lengths.includes(digits.length)) {
      continue;
    }

    for (const [low, high] of brand.ranges) {
      const prefix: string = digits.slice(0, low.length);

      if (prefix >= low && prefix <= high) {
        return brand.name;
      }
    }
  }

  return null;
}

export function isValidCardNumber(digits: string): boolean {
  return (
    digits.length >= 12 &&
    digits.length <= 19 &&
    !isPlaceholderDigits(digits) &&
    getCardBrand(digits) !== null &&
    luhn(digits)
  );
}

/*
 * Published test numbers of the large processors (Stripe, Braintree,
 * Adyen, PayPal) and the card brands. They pass every check above - that is
 * their purpose - and a store full of them is a test environment, not a
 * breach.
 */
const TEST_CARD_NUMBERS: ReadonlySet<string> = new Set([
  "4242424242424242",
  "4000056655665556",
  "4000000000000002",
  "4000000000009995",
  "4000000000000069",
  "4000000000000127",
  "4000000000000119",
  "4000002500003155",
  "4000002760003184",
  "4000000000003220",
  "4000000000000077",
  "4111111111111111",
  "4012888888881881",
  "4222222222222",
  "4005519200000004",
  "4009348888881881",
  "4012000033330026",
  "4012000077777777",
  "4217651111111119",
  "4500600000000061",
  "4917610000000000",
  "5555555555554444",
  "2223003122003222",
  "5200828282828210",
  "5105105105105100",
  "5431111111111111",
  "5454545454545454",
  "2222400070000005",
  "5555341244441115",
  "378282246310005",
  "371449635398431",
  "378734493671000",
  "341111111111111",
  "370000000000002",
  "6011111111111117",
  "6011000990139424",
  "6011601160116611",
  "6445644564456445",
  "3056930009020004",
  "36227206271667",
  "30569309025904",
  "38520000023237",
  "3566002020360505",
  "3530111333300000",
  "3566111111111113",
  "6200000000000005",
  "6205500000000000004",
  "6759649826438453",
]);

export function isTestCardNumber(digits: string): boolean {
  return TEST_CARD_NUMBERS.has(digits);
}

const CARD_KEYWORDS: ReadonlyArray<string> = [
  "card",
  "credit",
  "debit",
  "visa",
  "mastercard",
  "amex",
  "american express",
  "discover",
  "payment",
  "pan",
  "cc",
  "cardholder",
];

/*
 * A card number written in its brand's groups: 4-4-4-4, or 4-6-5 for
 * American Express and 4-6-4 for Diners Club. Writing it that way is itself
 * evidence, so this one is High on its own.
 */
const GROUPED_CARD_PATTERN: RegExp =
  /(?<![0-9])(?:[0-9]{4}([ -])[0-9]{4}\1[0-9]{4}\1[0-9]{4}|[0-9]{4}([ -])[0-9]{6}\2[0-9]{4,5})(?![0-9])/g;

/*
 * 19 digits as 4-4-4-4-3, on a pattern of its own: as an optional tail of
 * the one above, "4539 1488 0343 6467 123" - a card and its code, or an
 * amount - matched as 19 digits, failed the Luhn check, and the 16-digit
 * card in it was never tried.
 */
const GROUPED_19_DIGIT_CARD_PATTERN: RegExp =
  /(?<![0-9])[0-9]{4}([ -])[0-9]{4}\1[0-9]{4}\1[0-9]{4}\1[0-9]{3}(?![0-9])/g;

const groupedCardDetector: DataTypeDetector = {
  dataTypeId: "credit-card-number",
  quickCheck: hasDigit,
  pattern: GROUPED_CARD_PATTERN,
  normalize: digitsOnly,
  validate: isValidCardNumber,
  keywords: CARD_KEYWORDS,
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: isTestCardNumber,
};

const grouped19DigitCardDetector: DataTypeDetector = {
  ...groupedCardDetector,
  pattern: GROUPED_19_DIGIT_CARD_PATTERN,
};

// A card number as one run of digits: Medium alone, High near card words.
const CONTIGUOUS_CARD_PATTERN: RegExp = /(?<![0-9])[0-9]{12,19}(?![0-9])/g;

const contiguousCardDetector: DataTypeDetector = {
  dataTypeId: "credit-card-number",
  quickCheck: hasDigit,
  pattern: CONTIGUOUS_CARD_PATTERN,
  // A match is all digits; a card column's value can carry separators.
  normalize: digitsOnly,
  validate: isValidCardNumber,
  keywords: CARD_KEYWORDS,
  negativeKeywords: [
    "order",
    "tracking",
    "invoice",
    "transaction id",
    "request id",
    "trace",
    "span",
    "timestamp",
  ],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 3,
  isTestValue: isTestCardNumber,
  fieldValuePattern: /^[0-9][0-9 -]{10,22}[0-9]$/,
};

/*
 * A card security code, only where it is labelled: three or four digits
 * right after "cvv", "cvc" or "security code" - the word itself, not the
 * end of another ("acid 123", a token's "...xcvv241"). PCI DSS forbids
 * keeping it after authorisation at all, so finding one is always an issue.
 */
const CARD_SECURITY_CODE_PATTERN: RegExp =
  /(?<=(?<![A-Za-z0-9])(?:cvv2?|cvc2?|cid|csc|card security code|security code|card verification(?: value| code)?)["']?[ ]{0,3}[:=]?[ ]{0,3}["']?)[0-9]{3,4}(?![0-9])/gi;

const cardSecurityCodeDetector: DataTypeDetector = {
  dataTypeId: "card-verification-code",
  quickCheck: containsAny([
    "cvv",
    "cvc",
    "cid",
    "csc",
    "security code",
    "verification",
  ]),
  quickCheckLowerCase: true,
  pattern: CARD_SECURITY_CODE_PATTERN,
  keywords: ["cvv", "cvc", "security code", "verification"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  fieldValuePattern: /^[0-9]{3,4}$/,
};

// A card expiry, only where it is labelled: "exp 04/27", "expiry: 04/2027".
const CARD_EXPIRY_PATTERN: RegExp =
  /(?<=(?<![A-Za-z0-9])(?:exp|expiry|expiration|expires|exp date|expiry date|expiration date|valid thru|good thru)["']?[ ]{0,3}[:=]?[ ]{0,3}["']?)(?:0[1-9]|1[0-2])[ ]?[/-][ ]?(?:20)?[0-9]{2}(?![0-9])/gi;

const cardExpiryDetector: DataTypeDetector = {
  dataTypeId: "card-expiration-date",
  quickCheck: containsAny(["exp", "valid thru", "good thru"]),
  quickCheckLowerCase: true,
  pattern: CARD_EXPIRY_PATTERN,
  keywords: ["card", "exp", "expiry", "expiration"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^(?:0[1-9]|1[0-2])[ ]?[/-][ ]?(?:20)?[0-9]{2}$/,
};

// The length of an IBAN in each country that issues them (ISO 13616).
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

export function isValidIban(iban: string): boolean {
  const expectedLength: number | undefined = IBAN_LENGTHS[iban.slice(0, 2)];

  return (
    expectedLength !== undefined &&
    iban.length === expectedLength &&
    ibanMod97(iban)
  );
}

// The examples banks and standards print, which pass every check.
const TEST_IBANS: ReadonlySet<string> = new Set([
  "GB82WEST12345698765432",
  "GB33BUKB20201555555555",
  "GB29NWBK60161331926819",
  "DE89370400440532013000",
  "DE75512108001245126199",
  "FR1420041010050500013M02606",
  "NL91ABNA0417164300",
  "ES9121000418450200051332",
  "IT60X0542811101000000123456",
  "CH9300762011623852957",
  "BE68539007547034",
]);

const IBAN_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g;

const ibanDetector: DataTypeDetector = {
  dataTypeId: "iban",
  quickCheck: hasDigit,
  pattern: IBAN_PATTERN,
  normalize: alphanumericUpper,
  validate: isValidIban,
  keywords: ["iban", "bank", "account", "sepa", "transfer"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    return TEST_IBANS.has(normalized);
  },
};

// An account number, only right after words that say it is one.
const BANK_ACCOUNT_PATTERN: RegExp = /(?<![0-9-])[0-9]{6,17}(?![0-9-])/g;

const bankAccountDetector: DataTypeDetector = {
  dataTypeId: "bank-account-number",
  quickCheck: hasDigit,
  pattern: BANK_ACCOUNT_PATTERN,
  validate: (digits: string): boolean => {
    return !isPlaceholderDigits(digits);
  },
  keywords: [
    "account number",
    "account no",
    "acct",
    "a/c",
    "bank account",
    "account #",
    "kontonummer",
    "numero de compte",
    "numero de cuenta",
    "conto",
  ],
  requiresContext: true,
  contextBefore: 28,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{6,17}$/,
};

// Every ISO 3166-1 alpha-2 code a BIC's country part can hold.
const BIC_COUNTRY_CODES: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS XK YE YT ZA ZM ZW"
  ).split(" "),
);

const BIC_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?(?![A-Za-z0-9])/g;

const bicDetector: DataTypeDetector = {
  dataTypeId: "swift-bic",
  pattern: BIC_PATTERN,
  validate: (normalized: string): boolean => {
    return BIC_COUNTRY_CODES.has(normalized.slice(4, 6));
  },
  keywords: ["swift", "bic", "swift code", "bank identifier"],
  requiresContext: true,
  contextBefore: 24,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/,
};

/*
 * An ABA routing number: nine digits whose first two are a Federal Reserve
 * district (00-12, 21-32, 61-72, 80) and whose weighted sum (3, 7, 1) is a
 * multiple of ten.
 */
export function isValidRoutingNumber(digits: string): boolean {
  if (digits.length !== 9 || isPlaceholderDigits(digits)) {
    return false;
  }

  const district: number = Number(digits.slice(0, 2));
  const validDistrict: boolean =
    district <= 12 ||
    (district >= 21 && district <= 32) ||
    (district >= 61 && district <= 72) ||
    district === 80;

  return (
    validDistrict &&
    weightedDigitSum(digits, [3, 7, 1, 3, 7, 1, 3, 7, 1]) % 10 === 0
  );
}

const ROUTING_NUMBER_PATTERN: RegExp = /(?<![0-9-])[0-9]{9}(?![0-9-])/g;

const routingNumberDetector: DataTypeDetector = {
  dataTypeId: "us-bank-routing-number",
  quickCheck: hasDigit,
  pattern: ROUTING_NUMBER_PATTERN,
  validate: isValidRoutingNumber,
  keywords: ["routing", "aba", "rtn", "transit number", "routing number"],
  requiresContext: true,
  contextBefore: 28,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  fieldValuePattern: /^[0-9]{9}$/,
};

const SORT_CODE_PATTERN: RegExp =
  /(?<![0-9-])[0-9]{2}-[0-9]{2}-[0-9]{2}(?![0-9-])/g;

const sortCodeDetector: DataTypeDetector = {
  dataTypeId: "uk-sort-code",
  quickCheck: containsAny(["-"]),
  pattern: SORT_CODE_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return digits !== "000000";
  },
  keywords: ["sort code", "sortcode", "sort-code"],
  requiresContext: true,
  contextBefore: 24,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$/,
};

// Four letters for the bank, a zero, then six characters for the branch.
const IFSC_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/g;

const ifscDetector: DataTypeDetector = {
  dataTypeId: "in-ifsc",
  pattern: IFSC_PATTERN,
  keywords: ["ifsc", "branch", "neft", "rtgs", "imps"],
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 2,
};

const BSB_PATTERN: RegExp = /(?<![0-9-])[0-9]{3}-?[0-9]{3}(?![0-9-])/g;

const bsbDetector: DataTypeDetector = {
  dataTypeId: "au-bsb",
  quickCheck: hasDigit,
  pattern: BSB_PATTERN,
  normalize: digitsOnly,
  validate: (digits: string): boolean => {
    return digits !== "000000";
  },
  keywords: ["bsb"],
  requiresContext: true,
  contextBefore: 16,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{3}-?[0-9]{3}$/,
};

/*
 * A legacy Bitcoin address: Base58Check with version 0 (pay to public key
 * hash, starting 1) or 5 (pay to script hash, starting 3).
 */
const BITCOIN_LEGACY_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[13][1-9A-HJ-NP-Za-km-z]{25,34}(?![A-Za-z0-9])/g;

const bitcoinLegacyDetector: DataTypeDetector = {
  dataTypeId: "bitcoin-address",
  pattern: BITCOIN_LEGACY_PATTERN,
  validate: (normalized: string): boolean => {
    const version: number = base58Version(normalized);

    return (version === 0 || version === 5) && base58Check(normalized);
  },
  keywords: ["btc", "bitcoin", "wallet", "address"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
};

// A SegWit or Taproot address: bc1 and a Bech32 or Bech32m checksum.
const BITCOIN_BECH32_PATTERN: RegExp =
  /(?<![A-Za-z0-9])bc1[02-9ac-hj-np-z]{11,71}(?![A-Za-z0-9])/g;

const bitcoinBech32Detector: DataTypeDetector = {
  dataTypeId: "bitcoin-address",
  quickCheck: containsAny(["bc1"]),
  pattern: BITCOIN_BECH32_PATTERN,
  validate: bech32,
  keywords: ["btc", "bitcoin", "wallet", "address"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
};

// 0x and 40 hex digits: an Ethereum address, or any other 160-bit value.
const ETHEREUM_PATTERN: RegExp =
  /(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

const ethereumDetector: DataTypeDetector = {
  dataTypeId: "ethereum-address",
  quickCheck: containsAny(["0x"]),
  pattern: ETHEREUM_PATTERN,
  normalize: (value: string): string => {
    return value.toLowerCase();
  },
  validate: (normalized: string): boolean => {
    return !isPlaceholderDigits(digitsOnly(normalized.slice(2)));
  },
  keywords: ["eth", "ethereum", "wallet", "address", "metamask"],
  confidenceWithoutContext: DataConfidence.Low,
  specificity: 1,
};

export const FINANCIAL_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  groupedCardDetector,
  grouped19DigitCardDetector,
  contiguousCardDetector,
  cardSecurityCodeDetector,
  cardExpiryDetector,
  ibanDetector,
  bankAccountDetector,
  bicDetector,
  routingNumberDetector,
  sortCodeDetector,
  ifscDetector,
  bsbDetector,
  bitcoinLegacyDetector,
  bitcoinBech32Detector,
  ethereumDetector,
];

export default FINANCIAL_DETECTORS;
