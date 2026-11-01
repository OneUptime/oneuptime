import { sha256 } from "./Sha256";

/*
 * THE CHECKSUMS AND RULES THAT TURN A SHAPE INTO A FINDING.
 *
 * Most identifiers carry a check digit so that a typo is caught where it is
 * typed; the same arithmetic tells a real card or ID number from any other
 * run of digits of the same length. Each function takes the value already
 * normalized (digits only, or letters and digits upper-cased) and answers
 * whether it passes. All of them are pure and run in time in line with the
 * value's length.
 */

// Luhn (ISO/IEC 7812-1): cards, Canada's SIN, South Africa's ID, IMEIs.
export function luhn(digits: string): boolean {
  if (digits.length < 2) {
    return false;
  }

  let sum: number = 0;
  let double: boolean = false;

  for (let index: number = digits.length - 1; index >= 0; index--) {
    const code: number = digits.charCodeAt(index) - 48;

    if (code < 0 || code > 9) {
      return false;
    }

    let value: number = code;

    if (double) {
      value *= 2;

      if (value > 9) {
        value -= 9;
      }
    }

    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

// The remainder of a long decimal string divided by a small number.
export function decimalStringMod(digits: string, divisor: number): number {
  let remainder: number = 0;

  for (let index: number = 0; index < digits.length; index++) {
    const code: number = digits.charCodeAt(index) - 48;

    if (code < 0 || code > 9) {
      return -1;
    }

    remainder = (remainder * 10 + code) % divisor;
  }

  return remainder;
}

/*
 * ISO 7064 MOD 97-10 as IBANs use it: the first four characters move to the
 * end, letters become 10 to 35, and the number must leave 1 when divided by
 * 97.
 */
export function ibanMod97(iban: string): boolean {
  const rearranged: string = iban.slice(4) + iban.slice(0, 4);
  let digits: string = "";

  for (let index: number = 0; index < rearranged.length; index++) {
    const code: number = rearranged.charCodeAt(index);

    if (code >= 48 && code <= 57) {
      digits += rearranged[index];
    } else if (code >= 65 && code <= 90) {
      digits += String(code - 55);
    } else {
      return false;
    }
  }

  return decimalStringMod(digits, 97) === 1;
}

// Verhoeff: India's Aadhaar.
const VERHOEFF_MULTIPLY: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_PERMUTE: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeff(digits: string): boolean {
  // A check digit with nothing to check: "" would pass, and so would "0".
  if (digits.length < 2) {
    return false;
  }

  let check: number = 0;

  for (let position: number = 0; position < digits.length; position++) {
    const code: number = digits.charCodeAt(digits.length - 1 - position) - 48;

    if (code < 0 || code > 9) {
      return false;
    }

    check = VERHOEFF_MULTIPLY[check]![VERHOEFF_PERMUTE[position % 8]![code]!]!;
  }

  return check === 0;
}

/*
 * The weighted sum of a value's leading digits: digit i times weights[i].
 * Returns -1 when a character is not a digit.
 */
export function weightedDigitSum(
  digits: string,
  weights: ReadonlyArray<number>,
): number {
  let sum: number = 0;

  for (let index: number = 0; index < weights.length; index++) {
    const code: number = digits.charCodeAt(index) - 48;

    if (Number.isNaN(code) || code < 0 || code > 9) {
      return -1;
    }

    sum += code * weights[index]!;
  }

  return sum;
}

// The digit at a position, or -1.
export function digitAt(digits: string, index: number): number {
  const code: number = digits.charCodeAt(index) - 48;

  return code >= 0 && code <= 9 ? code : -1;
}

/*
 * ISO 7064 MOD 11,10 (a hybrid system): Germany's tax ID, Croatia's OIB.
 * The last digit is the check digit.
 */
export function iso7064Mod11Mod10(digits: string): boolean {
  let product: number = 10;

  for (let index: number = 0; index < digits.length - 1; index++) {
    const code: number = digitAt(digits, index);

    if (code < 0) {
      return false;
    }

    let sum: number = (code + product) % 10;

    if (sum === 0) {
      sum = 10;
    }

    product = (sum * 2) % 11;
  }

  let check: number = 11 - product;

  if (check === 10) {
    check = 0;
  }

  return check === digitAt(digits, digits.length - 1);
}

/*
 * The EAN-13 / GTIN check digit (weights 1 and 3 from the left): the Swiss
 * AHV number is an EAN-13 with the prefix 756.
 */
export function ean13(digits: string): boolean {
  if (digits.length !== 13) {
    return false;
  }

  let sum: number = 0;

  for (let index: number = 0; index < 12; index++) {
    const code: number = digitAt(digits, index);

    if (code < 0) {
      return false;
    }

    sum += code * (index % 2 === 0 ? 1 : 3);
  }

  return (10 - (sum % 10)) % 10 === digitAt(digits, 12);
}

const DAYS_IN_MONTH: ReadonlyArray<number> = [
  31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

// Whether year-month-day is a real calendar date.
export function isRealDate(year: number, month: number, day: number): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  if (day > DAYS_IN_MONTH[month - 1]!) {
    return false;
  }

  if (month === 2 && day === 29) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  return true;
}

// Two digits of a string as a number, or -1.
export function twoDigits(value: string, index: number): number {
  const tens: number = digitAt(value, index);
  const ones: number = digitAt(value, index + 1);

  return tens < 0 || ones < 0 ? -1 : tens * 10 + ones;
}

/*
 * Whether a YYMMDD date (a two-digit year in either century) is real. Used
 * by IDs that start with a birth date and do not say which century.
 */
export function isRealTwoDigitYearDate(
  twoDigitYear: number,
  month: number,
  day: number,
): boolean {
  return (
    isRealDate(1900 + twoDigitYear, month, day) ||
    isRealDate(2000 + twoDigitYear, month, day)
  );
}

const BASE58_ALPHABET: string =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Decodes base58 into bytes, or null if a character is outside the alphabet.
export function base58Decode(value: string): Uint8Array | null {
  // The number so far, least significant byte first.
  const bytes: Array<number> = [];

  for (let index: number = 0; index < value.length; index++) {
    const digit: number = BASE58_ALPHABET.indexOf(value[index]!);

    if (digit < 0) {
      return null;
    }

    let carry: number = digit;

    for (let byte: number = 0; byte < bytes.length; byte++) {
      carry += bytes[byte]! * 58;
      bytes[byte] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading "1" is a leading zero byte.
  for (
    let index: number = 0;
    index < value.length && value[index] === "1";
    index++
  ) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

/*
 * Base58Check, as Bitcoin addresses and wallet-import keys use it: the last
 * four bytes are the first four of SHA-256(SHA-256(payload)).
 */
export function base58Check(value: string): boolean {
  const bytes: Uint8Array | null = base58Decode(value);

  if (!bytes || bytes.length < 5) {
    return false;
  }

  const payload: Uint8Array = bytes.slice(0, bytes.length - 4);
  const checksum: Uint8Array = sha256(sha256(payload)).slice(0, 4);

  for (let index: number = 0; index < 4; index++) {
    if (checksum[index] !== bytes[bytes.length - 4 + index]) {
      return false;
    }
  }

  return true;
}

// The leading version byte of a Base58Check value, or -1.
export function base58Version(value: string): number {
  const bytes: Uint8Array | null = base58Decode(value);

  return bytes && bytes.length > 0 ? bytes[0]! : -1;
}

const BECH32_CHARSET: string = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR: ReadonlyArray<number> = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];

function bech32Polymod(values: ReadonlyArray<number>): number {
  let checksum: number = 1;

  for (const value of values) {
    const top: number = checksum >>> 25;

    checksum = ((checksum & 0x1ffffff) << 5) ^ value;

    for (let bit: number = 0; bit < 5; bit++) {
      if ((top >>> bit) & 1) {
        checksum ^= BECH32_GENERATOR[bit]!;
      }
    }
  }

  return checksum >>> 0;
}

/*
 * Bech32 (BIP 173) and Bech32m (BIP 350), as Bitcoin's bc1 addresses use
 * them: the polymod over the expanded prefix and the data must equal 1
 * (Bech32) or 0x2bc830a3 (Bech32m). Takes the address in lower case.
 */
export function bech32(address: string): boolean {
  const separator: number = address.lastIndexOf("1");

  if (separator < 1 || separator + 7 > address.length || address.length > 90) {
    return false;
  }

  const prefix: string = address.slice(0, separator);
  const values: Array<number> = [];

  for (let index: number = 0; index < prefix.length; index++) {
    values.push(prefix.charCodeAt(index) >> 5);
  }

  values.push(0);

  for (let index: number = 0; index < prefix.length; index++) {
    values.push(prefix.charCodeAt(index) & 31);
  }

  for (let index: number = separator + 1; index < address.length; index++) {
    const value: number = BECH32_CHARSET.indexOf(address[index]!);

    if (value < 0) {
      return false;
    }

    values.push(value);
  }

  const polymod: number = bech32Polymod(values);

  return polymod === 1 || polymod === 0x2bc830a3;
}

/*
 * Shannon entropy of a string in bits per character: random secrets sit
 * above 3.5, words and placeholders well below.
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const counts: Map<string, number> = new Map();
  // Characters as iterated - code points - so "😀" is one, not two halves.
  let total: number = 0;

  for (const character of value) {
    counts.set(character, (counts.get(character) || 0) + 1);
    total++;
  }

  let entropy: number = 0;

  for (const count of counts.values()) {
    const probability: number = count / total;

    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}
