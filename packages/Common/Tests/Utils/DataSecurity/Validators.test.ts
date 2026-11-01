import { describe, expect, test } from "@jest/globals";
import {
  base58Check,
  base58Decode,
  base58Version,
  bech32,
  decimalStringMod,
  digitAt,
  ean13,
  ibanMod97,
  isRealDate,
  isRealTwoDigitYearDate,
  iso7064Mod11Mod10,
  luhn,
  shannonEntropy,
  twoDigits,
  verhoeff,
  weightedDigitSum,
} from "../../../Utils/DataSecurity/Validators";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * THE CHECKSUMS EVERY DETECTOR LEANS ON.
 *
 * Each validator is held to its standard's own examples, to the single
 * mistakes it exists to catch (one digit wrong, two swapped), and - over
 * seeded random numbers - to a second implementation written here from the
 * standard, so a table typo in either shows up as a disagreement.
 */

function randomDigits(random: SeededRandom, length: number): string {
  let digits: string = "";

  for (let index: number = 0; index < length; index++) {
    digits += String(random(10));
  }

  return digits;
}

// Every value with exactly one digit changed.
function singleDigitChanges(digits: string): Array<string> {
  const changed: Array<string> = [];

  for (let index: number = 0; index < digits.length; index++) {
    for (let digit: number = 0; digit < 10; digit++) {
      if (String(digit) !== digits[index]) {
        changed.push(
          digits.slice(0, index) + String(digit) + digits.slice(index + 1),
        );
      }
    }
  }

  return changed;
}

// Every value with two neighbouring, different digits swapped.
function adjacentSwaps(digits: string): Array<string> {
  const swapped: Array<string> = [];

  for (let index: number = 0; index + 1 < digits.length; index++) {
    if (digits[index] !== digits[index + 1]) {
      swapped.push(
        digits.slice(0, index) +
          digits[index + 1] +
          digits[index] +
          digits.slice(index + 2),
      );
    }
  }

  return swapped;
}

// The Luhn check digit for a payload, doubling every second digit from the right.
function luhnCheckDigit(payload: string): string {
  let sum: number = 0;

  for (let index: number = 0; index < payload.length; index++) {
    const fromRight: number = payload.length - index;
    let value: number = Number(payload[index]);

    if (fromRight % 2 === 1) {
      value = value * 2 > 9 ? value * 2 - 9 : value * 2;
    }

    sum += value;
  }

  return String((10 - (sum % 10)) % 10);
}

// Verhoeff's tables, as published, and the inverse that makes a check digit.
const D: ReadonlyArray<ReadonlyArray<number>> = [
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
const P: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INVERSE: ReadonlyArray<number> = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffCheckDigit(payload: string): string {
  let check: number = 0;

  for (let position: number = 0; position < payload.length; position++) {
    const digit: number = Number(payload[payload.length - 1 - position]);

    check = D[check]![P[(position + 1) % 8]![digit]!]!;
  }

  return String(INVERSE[check]);
}

// ISO 7064 MOD 11,10: the digit that leaves the running product at 1.
function mod11Mod10CheckDigit(payload: string): string {
  let product: number = 10;

  for (const character of payload) {
    let sum: number = (Number(character) + product) % 10;

    if (sum === 0) {
      sum = 10;
    }

    product = (sum * 2) % 11;
  }

  return String((11 - product) % 10);
}

function ean13CheckDigit(payload: string): string {
  let sum: number = 0;

  for (let index: number = 0; index < 12; index++) {
    sum += Number(payload[index]) * (index % 2 === 0 ? 1 : 3);
  }

  return String((10 - (sum % 10)) % 10);
}

// An IBAN's two check digits, computed the way ISO 13616 says.
function ibanWithCheckDigits(country: string, bban: string): string {
  const rearranged: string = bban + country + "00";
  let digits: string = "";

  for (const character of rearranged) {
    const code: number = character.charCodeAt(0);

    digits += code >= 65 && code <= 90 ? String(code - 55) : character;
  }

  let remainder: number = 0;

  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return country + String(98 - remainder).padStart(2, "0") + bban;
}

describe("luhn", () => {
  test("passes the standard's example and refuses it with the wrong check digit", () => {
    expect(luhn("79927398713")).toBe(true);
    expect(luhn("79927398710")).toBe(false);
    expect(luhn("4539148803436467")).toBe(true);
  });

  test("refuses what is not a run of at least two digits", () => {
    expect(luhn("")).toBe(false);
    expect(luhn("0")).toBe(false);
    expect(luhn("7992739871a")).toBe(false);
    expect(luhn("7992 7398 713")).toBe(false);
  });

  test("catches every single wrong digit and agrees with the check digit it makes", () => {
    const random: SeededRandom = seededRandom(1702);

    for (let round: number = 0; round < 100; round++) {
      const payload: string = randomDigits(random, 11 + random(8));
      const number: string = payload + luhnCheckDigit(payload);

      expect([number, luhn(number)]).toEqual([number, true]);

      for (const changed of singleDigitChanges(number)) {
        expect([changed, luhn(changed)]).toEqual([changed, false]);
      }
    }
  });
});

describe("decimalStringMod", () => {
  test("divides decimal strings longer than a double holds", () => {
    expect(decimalStringMod("123456789", 97)).toBe(123456789 % 97);
    expect(decimalStringMod("0", 97)).toBe(0);
    expect(decimalStringMod("", 97)).toBe(0);
    // 10^30 + 1, far past a double's 2^53, against powers of ten taken mod 97.
    let powerOfTen: number = 1;

    for (let exponent: number = 0; exponent < 30; exponent++) {
      powerOfTen = (powerOfTen * 10) % 97;
    }

    expect(decimalStringMod("1" + "0".repeat(29) + "1", 97)).toBe(
      (powerOfTen + 1) % 97,
    );
  });

  test("is -1 for a character that is not a digit", () => {
    expect(decimalStringMod("12a", 97)).toBe(-1);
  });
});

describe("ibanMod97", () => {
  test("passes the examples banks print and refuses them a digit off", () => {
    expect(ibanMod97("GB82WEST12345698765432")).toBe(true);
    expect(ibanMod97("DE89370400440532013000")).toBe(true);
    expect(ibanMod97("GB83WEST12345698765432")).toBe(false);
    expect(ibanMod97("DE89370400440532013001")).toBe(false);
  });

  test("takes the value already upper-cased and without spaces", () => {
    expect(ibanMod97("gb82west12345698765432")).toBe(false);
    expect(ibanMod97("GB82 WEST 1234 5698 7654 32")).toBe(false);
    expect(ibanMod97("")).toBe(false);
  });

  test("passes check digits computed from the standard, and no other pair", () => {
    const random: SeededRandom = seededRandom(9713);

    for (let round: number = 0; round < 100; round++) {
      const iban: string = ibanWithCheckDigits("DE", randomDigits(random, 18));

      expect([iban, ibanMod97(iban)]).toEqual([iban, true]);

      const checkDigits: number = Number(iban.slice(2, 4));
      const other: string =
        iban.slice(0, 2) +
        String((checkDigits + 1 + random(90)) % 100).padStart(2, "0") +
        iban.slice(4);

      if (other !== iban) {
        expect([other, ibanMod97(other)]).toEqual([other, false]);
      }
    }
  });
});

describe("verhoeff", () => {
  test("passes the classic example and an Aadhaar-shaped number made here", () => {
    expect(verhoeff("2363")).toBe(true);
    expect(verhoeff("2364")).toBe(false);

    // Twelve digits that start 2 to 9, the last made with the inverse table.
    const random: SeededRandom = seededRandom(4012);
    const payload: string = String(2 + random(8)) + randomDigits(random, 10);
    const aadhaar: string = payload + verhoeffCheckDigit(payload);

    expect(aadhaar).toHaveLength(12);
    expect(verhoeff(aadhaar)).toBe(true);
  });

  test("catches every single wrong digit and every swap of neighbours", () => {
    const random: SeededRandom = seededRandom(4013);

    for (let round: number = 0; round < 80; round++) {
      const payload: string = String(2 + random(8)) + randomDigits(random, 10);
      const aadhaar: string = payload + verhoeffCheckDigit(payload);

      expect([aadhaar, verhoeff(aadhaar)]).toEqual([aadhaar, true]);

      for (const changed of [
        ...singleDigitChanges(aadhaar),
        ...adjacentSwaps(aadhaar),
      ]) {
        expect([changed, verhoeff(changed)]).toEqual([changed, false]);
      }
    }
  });

  test("refuses a value too short to carry a check and one that is not digits", () => {
    expect(verhoeff("")).toBe(false);
    expect(verhoeff("0")).toBe(false);
    expect(verhoeff("236a")).toBe(false);
  });
});

describe("iso7064Mod11Mod10", () => {
  test("passes Croatia's published OIB example and refuses it a digit off", () => {
    expect(iso7064Mod11Mod10("69435151530")).toBe(true);
    expect(iso7064Mod11Mod10("69435151531")).toBe(false);
  });

  test("agrees with the check digit the standard makes, and catches single mistakes", () => {
    const random: SeededRandom = seededRandom(1110);

    for (let round: number = 0; round < 80; round++) {
      const payload: string = String(1 + random(9)) + randomDigits(random, 9);
      const number: string = payload + mod11Mod10CheckDigit(payload);

      expect([number, iso7064Mod11Mod10(number)]).toEqual([number, true]);

      for (const changed of singleDigitChanges(number)) {
        expect([changed, iso7064Mod11Mod10(changed)]).toEqual([changed, false]);
      }
    }
  });

  test("refuses a character that is not a digit", () => {
    expect(iso7064Mod11Mod10("6943515153a")).toBe(false);
    expect(iso7064Mod11Mod10("69435x51530")).toBe(false);
    expect(iso7064Mod11Mod10("")).toBe(false);
  });
});

describe("ean13", () => {
  test("passes a GTIN and the Swiss AHV sample number, and refuses them a digit off", () => {
    expect(ean13("4006381333931")).toBe(true);
    expect(ean13("4006381333932")).toBe(false);
    // The number the Swiss social insurance office prints on its sample card.
    expect(ean13("7569217076985")).toBe(true);
    expect(ean13("7569217076986")).toBe(false);
  });

  test("takes exactly thirteen digits", () => {
    expect(ean13("756921707698")).toBe(false);
    expect(ean13("75692170769850")).toBe(false);
    expect(ean13("756921707698a")).toBe(false);
  });

  test("agrees with the check digit made here for random payloads", () => {
    const random: SeededRandom = seededRandom(1313);

    for (let round: number = 0; round < 300; round++) {
      const payload: string = randomDigits(random, 12);
      const number: string = payload + ean13CheckDigit(payload);

      expect([number, ean13(number)]).toEqual([number, true]);
      expect(
        ean13(payload + String((Number(ean13CheckDigit(payload)) + 1) % 10)),
      ).toBe(false);
    }
  });
});

describe("weightedDigitSum, digitAt and twoDigits", () => {
  test("sum, read and pair digits, and say -1 for anything else", () => {
    expect(weightedDigitSum("123", [3, 7, 1])).toBe(3 + 14 + 3);
    expect(weightedDigitSum("12", [3, 7, 1])).toBe(-1);
    expect(weightedDigitSum("1a3", [3, 7, 1])).toBe(-1);
    expect(digitAt("907", 1)).toBe(0);
    expect(digitAt("9x7", 1)).toBe(-1);
    expect(digitAt("9", 4)).toBe(-1);
    expect(twoDigits("851203", 2)).toBe(12);
    expect(twoDigits("85x203", 2)).toBe(-1);
  });
});

describe("isRealDate", () => {
  test("knows the leap years of the Gregorian calendar", () => {
    expect(isRealDate(2024, 2, 29)).toBe(true);
    expect(isRealDate(2000, 2, 29)).toBe(true);
    expect(isRealDate(2023, 2, 29)).toBe(false);
    expect(isRealDate(1900, 2, 29)).toBe(false);
    expect(isRealDate(2100, 2, 29)).toBe(false);
    expect(isRealDate(2023, 2, 28)).toBe(true);
  });

  test("knows how long each month is", () => {
    const lengths: Array<number> = [
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];

    for (let month: number = 1; month <= 12; month++) {
      expect([month, isRealDate(2023, month, lengths[month - 1]!)]).toEqual([
        month,
        true,
      ]);
      expect([month, isRealDate(2023, month, lengths[month - 1]! + 1)]).toEqual(
        [month, false],
      );
    }
  });

  test("refuses months and days out of range and parts that are not whole numbers", () => {
    expect(isRealDate(2026, 0, 1)).toBe(false);
    expect(isRealDate(2026, 13, 1)).toBe(false);
    expect(isRealDate(2026, 1, 0)).toBe(false);
    expect(isRealDate(2026, 1, 1.5)).toBe(false);
    expect(isRealDate(Number.NaN, 1, 1)).toBe(false);
  });
});

describe("isRealTwoDigitYearDate", () => {
  test("is real when the date is real in either century", () => {
    // 1900 was not a leap year, 2000 was.
    expect(isRealTwoDigitYearDate(0, 2, 29)).toBe(true);
    expect(isRealTwoDigitYearDate(96, 2, 29)).toBe(true);
    expect(isRealTwoDigitYearDate(1, 2, 29)).toBe(false);
    expect(isRealTwoDigitYearDate(85, 4, 31)).toBe(false);
    expect(isRealTwoDigitYearDate(85, 12, 31)).toBe(true);
  });
});

describe("base58Check and base58Version", () => {
  test("pass Bitcoin's genesis address and a script-hash address", () => {
    expect(base58Check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
    expect(base58Version("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(0);
    expect(base58Check("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true);
    expect(base58Version("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(5);
  });

  test("refuse the genesis address with any one character changed", () => {
    const address: string = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

    for (let index: number = 1; index < address.length; index++) {
      const replacement: string = address[index] === "z" ? "y" : "z";
      const corrupted: string =
        address.slice(0, index) + replacement + address.slice(index + 1);

      expect([corrupted, base58Check(corrupted)]).toEqual([corrupted, false]);
    }
  });

  test("refuse characters outside the alphabet and values too short for a checksum", () => {
    // 0, O, I and l are left out of base58 so they cannot be misread.
    expect(base58Decode("1A1z0")).toBeNull();
    expect(base58Check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNO")).toBe(false);
    expect(base58Check("")).toBe(false);
    expect(base58Check("1111")).toBe(false);
    expect(base58Version("")).toBe(-1);
  });

  test("decode leading ones as leading zero bytes", () => {
    expect(Array.from(base58Decode("11")!)).toEqual([0, 0]);
    expect(Array.from(base58Decode("15R")!)).toEqual([0, 0x01, 0x00]);
  });
});

describe("bech32", () => {
  test("passes the valid test vectors of BIP 173 and BIP 350", () => {
    for (const address of [
      "a12uel5l",
      "an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs",
      "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw",
      "11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j",
      "split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w",
      "?1ezyfcl",
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      // Bech32m, as Taproot addresses use it.
      "a1lqfn3a",
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    ]) {
      expect([address, bech32(address)]).toEqual([address, true]);
    }
  });

  test("refuses the invalid vectors and a corrupted address", () => {
    for (const address of [
      // The last character changed.
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5",
      // No separator, and an empty human-readable part.
      "pzry9x0s0muk",
      "1pzry9x0s0muk",
      // "b" is not in the data alphabet.
      "x1b4n0q5v",
      // A checksum shorter than six characters.
      "li1dgmt3",
      // Over 90 characters.
      "an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx",
      // It takes the address in lower case.
      "A12UEL5L",
    ]) {
      expect([address, bech32(address)]).toEqual([address, false]);
    }
  });
});

describe("shannonEntropy", () => {
  test("is the bits per character of the text", () => {
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("ab")).toBe(1);
    expect(shannonEntropy("aabb")).toBe(1);
    expect(shannonEntropy("abcd")).toBe(2);
    expect(shannonEntropy("0123456789abcdef")).toBe(4);
  });

  test("counts a character outside the BMP once, not as two halves", () => {
    expect(shannonEntropy("😀😀")).toBe(0);
    expect(shannonEntropy("😀a")).toBe(1);
  });

  test("puts random secrets above words and placeholders", () => {
    expect(shannonEntropy("Xk7Qz2Lp9Xw4Rt6Hy3Nc8Vb5")).toBeGreaterThan(3.5);
    expect(shannonEntropy("password")).toBeLessThan(3);
    expect(shannonEntropy("xxxxxxxxxxxxxxxx")).toBe(0);
  });
});
