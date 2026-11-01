import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import FINANCIAL_DETECTORS, {
  getCardBrand,
  isTestCardNumber,
  isValidCardNumber,
  isValidIban,
  isValidRoutingNumber,
} from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { luhn } from "../../../Utils/DataSecurity/Validators";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * CARDS, BANK ACCOUNTS AND WALLETS, AS THE SCANNER FINDS THEM.
 *
 * Card numbers are made here from a brand's prefix, random digits and the
 * Luhn digit that completes them, so none is anyone's card; the processors'
 * published test numbers are found and counted apart. Every type is also
 * refused when it is nearly the thing: a check digit off, a digit short,
 * inside a longer run, or missing the words a context-bound type needs.
 */

interface Found {
  dataTypeId: string;
  value: string;
  confidence: DataConfidence;
  isTestValue: boolean;
}

function scan(text: string): Array<Found> {
  return findSensitiveValues(text, { detectors: FINANCIAL_DETECTORS }).map(
    (match: TextMatch) => {
      return {
        dataTypeId: match.dataTypeId,
        value: text.slice(match.start, match.end),
        confidence: match.confidence,
        isTestValue: match.isTestValue,
      };
    },
  );
}

function found(
  dataTypeId: string,
  value: string,
  confidence: DataConfidence,
  isTestValue: boolean = false,
): Found {
  return { dataTypeId, value, confidence, isTestValue };
}

function expectFound(text: string, expected: Array<Found>): void {
  expect([text, scan(text)]).toEqual([text, expected]);
}

function expectNothingOf(dataTypeId: string, texts: Array<string>): void {
  for (const text of texts) {
    expect([
      text,
      scan(text).filter((match: Found) => {
        return match.dataTypeId === dataTypeId;
      }),
    ]).toEqual([text, []]);
  }
}

function classified(
  fieldPath: string,
  values: Array<unknown>,
  dataTypeId: string,
): FieldClassification | undefined {
  return classifyField(fieldPath, values, {
    detectors: FINANCIAL_DETECTORS,
  }).find((result: FieldClassification) => {
    return result.dataTypeId === dataTypeId;
  });
}

// A prefix, random digits, and the Luhn digit that completes the number.
function cardNumber(
  random: SeededRandom,
  prefix: string,
  length: number,
): string {
  let digits: string = prefix;

  while (digits.length < length - 1) {
    digits += String(random(10));
  }

  for (let check: number = 0; check < 10; check++) {
    if (luhn(digits + String(check))) {
      return digits + String(check);
    }
  }

  throw new Error("No Luhn digit completes " + digits);
}

// The same number with its last digit changed, so the Luhn check fails.
function offByOne(digits: string): string {
  return digits.slice(0, -1) + String((Number(digits.slice(-1)) + 1) % 10);
}

function grouped(
  digits: string,
  sizes: Array<number>,
  separator: string,
): string {
  const groups: Array<string> = [];
  let at: number = 0;

  for (const size of sizes) {
    groups.push(digits.slice(at, at + size));
    at += size;
  }

  return groups.join(separator);
}

const H: DataConfidence = DataConfidence.High;
const M: DataConfidence = DataConfidence.Medium;
const L: DataConfidence = DataConfidence.Low;

const random: SeededRandom = seededRandom(4532);
const VISA: string = cardNumber(random, "4", 16);
const VISA_19: string = cardNumber(random, "4", 19);
const MASTERCARD: string = cardNumber(random, "2221", 16);
const AMEX: string = cardNumber(random, "37", 15);
const DINERS: string = cardNumber(random, "36", 14);

describe("card brands", () => {
  test("getCardBrand knows each brand's ranges and lengths", () => {
    const brandRandom: SeededRandom = seededRandom(77);

    expect(getCardBrand(cardNumber(brandRandom, "4", 13))).toBe("Visa");
    expect(getCardBrand(VISA)).toBe("Visa");
    expect(getCardBrand(VISA_19)).toBe("Visa");
    expect(getCardBrand(cardNumber(brandRandom, "53", 16))).toBe("Mastercard");
    expect(getCardBrand(cardNumber(brandRandom, "2720", 16))).toBe(
      "Mastercard",
    );
    expect(getCardBrand(cardNumber(brandRandom, "34", 15))).toBe(
      "American Express",
    );
    expect(getCardBrand(cardNumber(brandRandom, "6011", 16))).toBe("Discover");
    expect(getCardBrand(cardNumber(brandRandom, "647", 16))).toBe("Discover");
    expect(getCardBrand(cardNumber(brandRandom, "303", 14))).toBe(
      "Diners Club",
    );
    expect(getCardBrand(cardNumber(brandRandom, "3530", 16))).toBe("JCB");
    expect(getCardBrand(cardNumber(brandRandom, "62", 16))).toBe("UnionPay");
    expect(getCardBrand(cardNumber(brandRandom, "5018", 12))).toBe("Maestro");
    expect(getCardBrand(cardNumber(brandRandom, "81", 16))).toBe("RuPay");
  });

  test("getCardBrand refuses prefixes and lengths no brand issues", () => {
    expect(getCardBrand("9" + "0".repeat(15))).toBeNull();
    expect(getCardBrand("1" + "0".repeat(15))).toBeNull();
    expect(getCardBrand(VISA.slice(0, 14))).toBeNull();
    expect(getCardBrand(cardNumber(seededRandom(5), "2219", 16))).toBeNull();
    expect(getCardBrand(cardNumber(seededRandom(5), "37", 16))).toBeNull();
  });

  test("isValidCardNumber asks for a brand, a length and the Luhn check, and refuses placeholders", () => {
    expect(isValidCardNumber(VISA)).toBe(true);
    expect(isValidCardNumber(offByOne(VISA))).toBe(false);
    expect(isValidCardNumber("1111111111111111")).toBe(false);
    expect(isValidCardNumber("0000000000000000")).toBe(false);
    expect(isValidCardNumber(cardNumber(seededRandom(9), "9", 16))).toBe(false);
    expect(isValidCardNumber("4" + "2".repeat(10))).toBe(false);
  });

  test("isTestCardNumber knows the processors' published numbers", () => {
    expect(isTestCardNumber("4242424242424242")).toBe(true);
    expect(isTestCardNumber("4111111111111111")).toBe(true);
    expect(isTestCardNumber("378282246310005")).toBe(true);
    expect(isTestCardNumber(VISA)).toBe(false);
  });
});

describe("credit-card-number", () => {
  test("is High on its own when written in its brand's groups", () => {
    for (const [digits, sizes] of [
      [VISA, [4, 4, 4, 4]],
      [VISA_19, [4, 4, 4, 4, 3]],
      [AMEX, [4, 6, 5]],
      [DINERS, [4, 6, 4]],
    ] as Array<[string, Array<number>]>) {
      for (const separator of [" ", "-"]) {
        const text: string = grouped(digits, sizes, separator);

        expectFound(`charged ${text} at 10:15`, [
          found("credit-card-number", text, H),
        ]);
      }
    }
  });

  test("finds a grouped card that a code or an amount follows", () => {
    // Three digits that do not make the 19-digit number valid as well.
    const tail: string = ["123", "200", "456", "789"].find((digits: string) => {
      return !luhn(VISA + digits);
    })!;
    const card: string = grouped(VISA, [4, 4, 4, 4], " ");

    expectFound(`card ${card} ${tail} exp`, [
      found("credit-card-number", card, H),
    ]);
    expectFound(`${grouped(VISA, [4, 4, 4, 4], "-")}-${tail}`, [
      found("credit-card-number", grouped(VISA, [4, 4, 4, 4], "-"), H),
    ]);
  });

  test("refuses groups that mix separators or follow no brand's grouping", () => {
    expectNothingOf("credit-card-number", [
      grouped(VISA, [4, 4, 4, 4], " ").replace(" ", "-"),
      grouped(VISA, [4, 6, 6], " "),
      grouped(VISA, [4, 4, 4, 4], ". "),
    ]);
  });

  test("is Medium as one run of digits, High next to card words, Low next to order words", () => {
    expectFound(`${VISA},2026-10-27,EUR`, [
      found("credit-card-number", VISA, M),
    ]);
    expectFound(`{"pan":"${MASTERCARD}"}`, [
      found("credit-card-number", MASTERCARD, H),
    ]);
    expectFound(`card number ${VISA}`, [found("credit-card-number", VISA, H)]);
    expectFound(`order id ${VISA}`, [found("credit-card-number", VISA, L)]);
    expectFound(`tracking ${VISA}`, [found("credit-card-number", VISA, L)]);
  });

  test("reads card words as words: 'pan' is in 'card pan:', not in 'company'", () => {
    expectFound(`card pan: ${VISA}`, [found("credit-card-number", VISA, H)]);
    expectFound(`company ${VISA}`, [found("credit-card-number", VISA, M)]);
  });

  test("refuses a wrong check digit, a wrong length and a run inside a longer one", () => {
    expectNothingOf("credit-card-number", [
      offByOne(VISA),
      VISA.slice(0, 15),
      "9" + VISA,
      VISA + "0" + "1",
      grouped(offByOne(VISA), [4, 4, 4, 4], " "),
    ]);
  });

  test("refuses placeholder digit runs", () => {
    expectNothingOf("credit-card-number", [
      "card 1111111111111111",
      "card 0000 0000 0000 0000",
      "card 4444444444444444",
    ]);
  });

  test("counts the processors' test cards as test values", () => {
    expectFound("card: 4242 4242 4242 4242", [
      found("credit-card-number", "4242 4242 4242 4242", H, true),
    ]);
    expectFound("5555555555554444", [
      found("credit-card-number", "5555555555554444", M, true),
    ]);
    expectFound("amex 3782 822463 10005", [
      found("credit-card-number", "3782 822463 10005", H, true),
    ]);
  });

  test("is normalized to its digits", () => {
    expect(
      findSensitiveValues(grouped(VISA, [4, 4, 4, 4], "-"), {
        detectors: FINANCIAL_DETECTORS,
      })[0]?.normalized,
    ).toBe(VISA);
  });

  test("is found in a card column however its digits are spaced", () => {
    const result: FieldClassification | undefined = classified(
      "card_number",
      [
        VISA.slice(0, 4) + " " + VISA.slice(4),
        MASTERCARD,
        grouped(AMEX, [4, 6, 5], " "),
      ],
      "credit-card-number",
    );

    expect(result).toMatchObject({
      confidence: H,
      matchCount: 3,
      valuesWithMatch: 3,
      nameHinted: true,
    });
  });
});

describe("card-verification-code", () => {
  test("is three or four digits right after the words that label it", () => {
    expectFound("cvv: 123", [found("card-verification-code", "123", H)]);
    expectFound('CVC2="456"', [found("card-verification-code", "456", H)]);
    expectFound("security code: 9876", [
      found("card-verification-code", "9876", H),
    ]);
    expectFound('{"cvv":"321","amount":5}', [
      found("card-verification-code", "321", H),
    ]);
  });

  test("refuses other lengths and digits the label does not reach", () => {
    expectNothingOf("card-verification-code", [
      "cvv 12",
      "cvv 12345",
      "the cvv is unknown 123",
      "123",
    ]);
  });

  test("reads its label as a word, not the end of another one or of a token", () => {
    // A random token that happens to hold "cvv" and three digits.
    const token: string = ["Fk7Qz2", "Hauc", "vV241", "fcXq5S7h"].join("");

    expectNothingOf("card-verification-code", [
      "acid 123",
      "lucid: 456",
      `api_key=${token}`,
      "xcsc 1234",
    ]);
    expectFound("card cvc 456", [found("card-verification-code", "456", H)]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified("cvv", ["123", "4567", 890], "card-verification-code"),
    ).toMatchObject({ confidence: H, matchCount: 3, nameHinted: true });
    expect(
      classified("quantity", ["123", "456"], "card-verification-code"),
    ).toBeUndefined();
  });
});

describe("card-expiration-date", () => {
  test("is a month and year right after the words that label it", () => {
    expectFound("exp 04/27", [found("card-expiration-date", "04/27", H)]);
    expectFound("Expiry: 04 / 2027", [
      found("card-expiration-date", "04 / 2027", H),
    ]);
    expectFound("valid thru 12/29", [
      found("card-expiration-date", "12/29", M),
    ]);
  });

  test("refuses a month that does not exist, digits without a separator, and no label", () => {
    expectNothingOf("card-expiration-date", [
      "exp 13/27",
      "exp date 0427",
      "04/27",
    ]);
  });

  test("reads its label as a word, not the end of another one", () => {
    expectNothingOf("card-expiration-date", ["regexp 04/27", "timexp: 12/29"]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified(
        "card_expiry",
        ["04/27", "11/2029", "01 / 30"],
        "card-expiration-date",
      ),
    ).toMatchObject({ confidence: H, matchCount: 3 });
  });
});

describe("iban", () => {
  test("is found with or without its spaces, High on its own", () => {
    expectFound("Pay to DE44500105175407324931 by Friday", [
      found("iban", "DE44500105175407324931", H),
    ]);
    expectFound("IBAN: DE44 5001 0517 5407 3249 31", [
      found("iban", "DE44 5001 0517 5407 3249 31", H),
    ]);
  });

  test("refuses a wrong check, a wrong length, an unknown country and a longer token", () => {
    expectNothingOf("iban", [
      "DE44500105175407324932",
      "DE4450010517540732493",
      "DE445001051754073249311",
      "XX44500105175407324931",
      "aDE44500105175407324931",
      "de44500105175407324931",
    ]);
  });

  test("counts the examples banks print as test values", () => {
    expectFound("IBAN: GB82 WEST 1234 5698 7654 32", [
      found("iban", "GB82 WEST 1234 5698 7654 32", H, true),
    ]);
    expectFound("GB29NWBK60161331926819", [
      found("iban", "GB29NWBK60161331926819", H, true),
    ]);
  });

  test("isValidIban checks the country's length as well as mod 97", () => {
    expect(isValidIban("DE44500105175407324931")).toBe(true);
    expect(isValidIban("NO9386011117947")).toBe(true);
    expect(isValidIban("DE4450010517540732493")).toBe(false);
  });
});

describe("bank-account-number", () => {
  test("is a run of digits right after the words that name one", () => {
    expectFound("account number 12345679", [
      found("bank-account-number", "12345679", H),
    ]);
    expectFound("acct: 004211339", [
      found("bank-account-number", "004211339", H),
    ]);
  });

  test("is nothing without those words, too short or a placeholder", () => {
    expectNothingOf("bank-account-number", [
      "invoice 12345679",
      "12345679",
      "account number 123",
      "account number 1111111",
      "account number 12345678",
    ]);
  });

  test("is refused when the words are too far before it", () => {
    expectNothingOf("bank-account-number", [
      "account number on file; the balance after 3 days is 12345679",
    ]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified(
        "bank_account",
        ["004211339", "73925501", 81726354],
        "bank-account-number",
      ),
    ).toMatchObject({ confidence: H, matchCount: 3, nameHinted: true });
  });
});

describe("swift-bic", () => {
  test("is a bank code with a real country part, next to words that say so", () => {
    expectFound("swift DEUTDEFF", [found("swift-bic", "DEUTDEFF", H)]);
    expectFound("BIC: DEUTDEFF500", [found("swift-bic", "DEUTDEFF500", H)]);
  });

  test("refuses an unknown country part, lower case and no context", () => {
    expectNothingOf("swift-bic", [
      "swift DEUTXXFF",
      "swift deutdeff",
      "DEUTDEFF",
    ]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified("swift_code", ["DEUTDEFF", "BARCGB22"], "swift-bic"),
    ).toMatchObject({
      confidence: H,
      matchCount: 2,
    });
  });
});

describe("us-bank-routing-number", () => {
  test("passes its checksum and district, next to words that say so", () => {
    expectFound("routing number 021000021", [
      found("us-bank-routing-number", "021000021", H),
    ]);
    expectFound("ABA 011000015", [
      found("us-bank-routing-number", "011000015", H),
    ]);
  });

  test("refuses a wrong checksum, a district that does not exist and no context", () => {
    expectNothingOf("us-bank-routing-number", [
      "routing 021000022",
      "routing 991000021",
      "021000021",
    ]);
    expect(isValidRoutingNumber("021000021")).toBe(true);
    expect(isValidRoutingNumber("111111111")).toBe(false);
  });

  test("is found in a column named for it", () => {
    expect(
      classified(
        "routing_number",
        ["021000021", "011000015"],
        "us-bank-routing-number",
      ),
    ).toMatchObject({ confidence: H, matchCount: 2 });
  });
});

describe("uk-sort-code", () => {
  test("is three pairs next to words that say so", () => {
    expectFound("sort code 40-47-84", [found("uk-sort-code", "40-47-84", H)]);
    expectNothingOf("uk-sort-code", [
      "40-47-84",
      "sort code 00-00-00",
      "sort code 404784",
    ]);
  });

  test("is found in a column named for it with or without dashes", () => {
    expect(
      classified("sort_code", ["404784", "20-00-00"], "uk-sort-code"),
    ).toMatchObject({
      confidence: H,
      matchCount: 2,
    });
  });
});

describe("in-ifsc", () => {
  test("is four letters, a zero and six characters; Low alone, Medium with its word", () => {
    expectFound("HDFC0000123", [found("in-ifsc", "HDFC0000123", L)]);
    expectFound("IFSC: HDFC0000123", [found("in-ifsc", "HDFC0000123", M)]);
    expectNothingOf("in-ifsc", [
      "HDFC1000123",
      "ifsc HDFC000012",
      "XHDFC0000123",
    ]);
  });
});

describe("au-bsb", () => {
  test("is six digits next to its word", () => {
    expectFound("BSB 062-000", [found("au-bsb", "062-000", H)]);
    expectFound("bsb: 062000", [found("au-bsb", "062000", H)]);
    expectNothingOf("au-bsb", ["062-000", "bsb 000-000"]);
  });

  test("is found in a column named for it", () => {
    expect(classified("bsb", ["062-000", "032001"], "au-bsb")).toMatchObject({
      confidence: H,
      matchCount: 2,
    });
  });
});

describe("bitcoin-address", () => {
  test("finds legacy and SegWit addresses whose checksums hold, High on their own", () => {
    expectFound("send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", [
      found("bitcoin-address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", H),
    ]);
    expectFound("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", [
      found("bitcoin-address", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", H),
    ]);
    expectFound('{"wallet":"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"}', [
      found("bitcoin-address", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", H),
    ]);
  });

  test("refuses corrupted checksums and addresses inside longer tokens", () => {
    expectNothingOf("bitcoin-address", [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb",
      "x1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5",
      "abc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    ]);
  });
});

describe("ethereum-address", () => {
  const address: string = "0x" + "52908400098527886E0F7030069857D2E4169EE7";

  test("is Low alone and Medium next to wallet words", () => {
    expectFound(address, [found("ethereum-address", address, L)]);
    expectFound(`eth wallet ${address}`, [
      found("ethereum-address", address, M),
    ]);
  });

  test("refuses the zero address and longer hex runs", () => {
    expectNothingOf("ethereum-address", [
      "0x" + "0".repeat(40),
      address + "1",
      "0x" + "52908400098527886E0F7030069857D2E4169EE",
    ]);
  });
});
