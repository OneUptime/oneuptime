import Phone from "Common/Types/Phone";

/*
 * THE CASES THE PROVIDER'S PHONE NUMBERS ARE CHECKED AGAINST.
 *
 * OneUptime keeps a phone number as it is written when Phone.ts's E.123
 * check takes it ("+14155550100", "(415) 555-0100"), and any other number of
 * 8 to 15 digits as its digits: "+1 415 555 0100" is kept as "+14155550100".
 * It refuses anything else. The provider has to read numbers exactly as the
 * server does (StaticFiles/phone.go, OneUptime/oneuptime#7777):
 *   - if it reads less, an apply that wrote "+1 415 555 0100" fails with
 *     "Provider produced inconsistent result after apply";
 *   - if it reads more, it plans no change where OneUptime keeps a different
 *     number, and refuses at plan time a number the server takes.
 *
 * So the generator writes these cases into the provider
 * (internal/provider/testdata/phone_numbers.json), each stored number
 * computed here by the server's own code, and the provider's Go test reads
 * each written number as the server does or fails. The cases cover:
 *   - numbers kept as written: the E.123 check's separators and brackets,
 *     its shortest and longest numbers, and its edge cases;
 *   - numbers kept as their digits: grouped the way people say them, from
 *     8 to 15 digits, and up to the column's length;
 *   - white space the server trims and drops, which is JavaScript's (no-break
 *     and ideographic spaces, the byte order mark), and the white space Go
 *     takes that JavaScript does not (U+0085);
 *   - numbers the server refuses: too few or too many digits, too long,
 *     letters, other separators, other digits.
 */

export interface PhoneCase {
  written: string;
  // What OneUptime keeps for it, or null when it refuses it.
  stored: string | null;
}

export interface PhoneCases {
  about: string;
  cases: Array<PhoneCase>;
}

const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);
const NARROW_NO_BREAK_SPACE: string = String.fromCharCode(0x202f);
const IDEOGRAPHIC_SPACE: string = String.fromCharCode(0x3000);
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);
const EN_SPACE: string = String.fromCharCode(0x2002);
// White space to Go (unicode.IsSpace), and not to JavaScript.
const NEXT_LINE: string = String.fromCharCode(0x0085);

function grouped(groups: Array<string>, separator: string): string {
  return groups.join(separator);
}

// Each of these digits in another script: "0" is U+FF10 in full width.
function inOtherDigits(number: string, zero: number): string {
  return number.replace(/[0-9]/g, (digit: string): string => {
    return String.fromCharCode(zero + Number(digit));
  });
}

export const WRITTEN_PHONE_NUMBERS: Array<string> = [
  // Kept as written: the E.123 check takes them.
  "+14155550100",
  "4155550100",
  "14155550100",
  "(415) 555-0100",
  "(415)555-0100",
  "415.555.0100",
  "415-555-0100",
  "415 555 0100",
  "415-555.0100",
  "+(415) 555-0100",
  "(415 555 0100",
  "415) 555-0100",
  "+1234567890123",
  "123-456-7890123",
  grouped(["415", "555", "0100"], "\t"),
  grouped(["415", "555", "0100"], NO_BREAK_SPACE),
  grouped(["415", "555", "0100"], IDEOGRAPHIC_SPACE),

  // Kept as their digits.
  "+1 415 555 0100",
  "+44 20 7946 0958",
  "07911 123456",
  "+1 (415) 555-0100",
  "+1-555-123-4567",
  "+1.415.555.0100",
  "1 415 555 0100",
  "+91 98765 43210",
  "+49 30 901820",
  "0044 20 7946 0958",
  "415  555 0100",
  "415 - 555 - 0100",
  "12345678",
  "1234 5678",
  "123 456 789",
  "+123456789012345",
  "1 2 3 4 5 6 7 8 9 0 1 2 3 4 5",
  "+1 2 3 4 5 6 7 8 9 0 1 2 3 4 5",
  grouped(
    [
      "+1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ],
    IDEOGRAPHIC_SPACE,
  ),
  grouped(["+1", "415", "555", "0100"], NO_BREAK_SPACE),
  grouped(["+1", "415", "555", "0100"], NARROW_NO_BREAK_SPACE),
  grouped(["+1", "415", "555", "0100"], EN_SPACE),
  grouped(["+1", "415", "555", "0100"], "\t"),

  // Trimmed first.
  " +14155550100 ",
  "\t+1 415 555 0100\n",
  `${BYTE_ORDER_MARK}+14155550100`,
  `${IDEOGRAPHIC_SPACE}+44 20 7946 0958${IDEOGRAPHIC_SPACE}`,

  // Refused.
  "",
  "   ",
  "+",
  "1234567",
  "+1234567890123456",
  "+ 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5",
  "++14155550100",
  "+1 415 555 CALL",
  "tel:+14155550100",
  "+1 415 555 0100 ext. 5",
  "+1/415/555/0100",
  "+1_415_555_0100",
  `${NEXT_LINE}+14155550100`,
  grouped(["+1", "415", "555", "0100"], NEXT_LINE),
  inOtherDigits("+14155550100", 0xff10),
  inOtherDigits("+14155550100", 0x0660),
];

export function buildPhoneCases(): PhoneCases {
  return {
    about:
      "Phone numbers as written, and what OneUptime keeps for each (null: refused), computed by Common/Types/Phone.ts. Written by Scripts/TerraformProvider/Core/PhoneCases.ts; read by phone_test.go.",
    cases: WRITTEN_PHONE_NUMBERS.map((written: string): PhoneCase => {
      let stored: string | null = null;

      try {
        stored = new Phone(written).toString();
      } catch {
        stored = null;
      }

      return { written: written, stored: stored };
    }),
  };
}

// The file's name, in the provider's internal/provider/testdata.
export const PHONE_CASES_FILE: string = "phone_numbers.json";

const BACKSLASH: string = String.fromCharCode(92);

/*
 * JSON with every character outside printable ASCII escaped, so that a no-break
 * space or a byte order mark shows in a diff.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character: string): string => {
      return `${BACKSLASH}u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    },
  );
}

/*
 * The file the provider's Go test reads, as the generator writes it: one
 * case a line.
 */
export function phoneCasesFile(): string {
  const phoneCases: PhoneCases = buildPhoneCases();
  const lines: Array<string> = [
    "{",
    `  "about": ${asciiJson(phoneCases.about)},`,
    `  "cases": [`,
  ];

  phoneCases.cases.forEach((phoneCase: PhoneCase, index: number): void => {
    const comma: string = index < phoneCases.cases.length - 1 ? "," : "";
    lines.push(`    ${asciiJson(phoneCase)}${comma}`);
  });

  lines.push("  ]", "}");

  return `${lines.join("\n")}\n`;
}
