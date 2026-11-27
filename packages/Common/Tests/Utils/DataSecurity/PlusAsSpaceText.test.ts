import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import PercentDecodedText from "../../../Utils/DataSecurity/PercentDecodedText";
import PlusAsSpaceText, {
  isEscapedPlusASpace,
  isWrittenPlusASpace,
  withWrittenPlusesAsSpaces,
} from "../../../Utils/DataSecurity/PlusAsSpaceText";

/*
 * A TEXT AS A URL'S QUERY STRING READS IT: A "+" FOR A SPACE (#11199).
 *
 * A form, URLSearchParams and most code that builds a query string write a
 * value's spaces as "+": card=4111+1111+1111+1111. Data Security's
 * detectors of a value written in groups, a Custom Regex rule and the
 * built-in rules on the detectors read a text this way beside the others,
 * so such a value is found and hidden on the characters it is written
 * with. These tests read the reading itself: which "+" it reads as a space
 * - one written, and one an escape is read as in a URL inside a query
 * string - what it leaves, and where every position of it is written.
 */

// The written characters a part of the reading stands for.
function writtenOf(text: string, part: string): string {
  const read: PlusAsSpaceText = PlusAsSpaceText.read(text)!;
  const start: number = read.readable.indexOf(part);

  expect(start).toBeGreaterThanOrEqual(0);

  return text.slice(read.toWritten(start), read.toWritten(start + part.length));
}

describe("which '+' written in a text a query string means a space by", () => {
  test.each([
    ["between two digits", "4111+1111", 4],
    ["between two letters", "Jane+Doe", 4],
    ["between a letter and a digit", "SW1A+1AA", 4],
    ["between a digit and a letter", "12+March", 2],
    ["between digits of another script", "٤١١١+١١١١", 4],
    ["between fullwidth digits", "４１１１+１１１１", 4],
    ["between letters of another script", "张伟+王芳", 2],
    ["between accented letters", "José+García", 4],
    ["after a closing parenthesis", "(415)+555-2671", 5],
    ["after a closing bracket", "[1]+2", 3],
    ["before an opening parenthesis", "+44+(0)20", 3],
    ["after a letter beyond U+FFFF", "\u{1D400}+x", 2],
    ["after an escape's last character", "%2B44+20", 5],
    ["before an escape", "4111+%31111", 4],
    // A form writes every space so: beside punctuation, a quote, another space.
    ["after a colon, before a quote", '"card":+"4111"', 7],
    ["after a comma, before a letter", "a,+b", 2],
    ["before a comma", "a+,b", 1],
    ["between spaces", "2 + 2", 2],
    ["at the text's end", "x+", 1],
    ["at a value's start, before a letter", "q=+foo", 2],
    ["before a percent sign alone", "5+%", 1],
    // A form's "07 - 2027": the "+" after the dash is its second space, no sign.
    ["after a dash, before a digit", "07+-+2027", 4],
    ["after a full stop, before a digit", "No.+5", 3],
    ["after a currency sign, before a digit", "€+5", 1],
  ])("%s: %s", (_label: string, text: string, at: number) => {
    expect(text[at]).toBe("+");
    expect(isWrittenPlusASpace(text, at)).toBe(true);
  });

  /*
   * A number's own sign - a digit after it, and before it the text's
   * start, a space or what a value starts after - and a "+" of a run of
   * them, which no form writes for one space.
   */
  test.each([
    ["at the text's start", "+44 20 7946 0958", 0],
    ["at a value's start, after its key", "phone=+44", 6],
    ["after an opening parenthesis", "(+44)", 1],
    ["after an opening bracket", "[+1]", 1],
    ["after an opening brace", "{+1}", 1],
    ["after a quote", '"+44 20"', 1],
    ["after a space", "call +44", 5],
    ["after a colon", "tz=+05:30", 3],
    ["after a comma", "a,+5", 2],
    ["after a semicolon", "a;+5", 2],
    ["after an ampersand", "a&+5", 2],
    ["after a query's start", "?+5", 1],
    ["before a digit of another script", "+٤٤", 0],
    ["the first of a run", "C++", 1],
    ["the last of a run", "C++", 2],
    ["of a run before a number", "call ++44 20", 5],
    ["of a run before a number, its second", "call ++44 20", 6],
  ])("not %s: %s", (_label: string, text: string, at: number) => {
    expect(text[at]).toBe("+");
    expect(isWrittenPlusASpace(text, at)).toBe(false);
  });

  test("a character that is no '+' is never read as a space", () => {
    expect(isWrittenPlusASpace("a b", 1)).toBe(false);
    expect(isWrittenPlusASpace("a-b", 1)).toBe(false);
    expect(isWrittenPlusASpace("", 0)).toBe(false);
    expect(isWrittenPlusASpace("a+b", -1)).toBe(false);
    expect(isWrittenPlusASpace("a+b", 5)).toBe(false);
  });
});

/*
 * A "+" an escape was read as (%2B): in a flat query string, the "+" a
 * value holds; in a URL inside a query string, the space that URL's own
 * query string wrote - between two characters of a value.
 */
describe("which '+' an escape was read as is the space of a query string inside the URL", () => {
  test.each([
    ["between two digits", "4111+1111", 4],
    ["between two letters", "Jane+Doe", 4],
    ["after a closing parenthesis", "(415)+555", 5],
    ["before an opening parenthesis", "4111+(0)", 4],
    ["between digits of another script", "٤١١١+١١١١", 4],
  ])("%s: %s", (_label: string, readable: string, at: number) => {
    expect(isEscapedPlusASpace(readable, at)).toBe(true);
  });

  test.each([
    ["a number's sign at a value's start", "phone=+44", 6],
    ["a number's sign at the text's start", "+44", 0],
    ["before a comma", "a+,b", 1],
    ["after a space", "a +b", 2],
    ["at the text's end", "a+", 1],
    ["no '+'", "a b", 1],
  ])("not %s: %s", (_label: string, readable: string, at: number) => {
    expect(isEscapedPlusASpace(readable, at)).toBe(false);
  });
});

describe("the text with its written '+'s for spaces as spaces", () => {
  test("each '+' a query string means a space by is one, and nothing else changes", () => {
    expect(withWrittenPlusesAsSpaces("card=4111+1111+1111+1111&step=2")).toBe(
      "card=4111 1111 1111 1111&step=2",
    );
    expect(withWrittenPlusesAsSpaces("phone=%2B44+20+7946+0958")).toBe(
      "phone=%2B44 20 7946 0958",
    );
    expect(withWrittenPlusesAsSpaces("C++ and 2 + 2 and x+y")).toBe(
      "C++ and 2   2 and x y",
    );
    expect(withWrittenPlusesAsSpaces("phone=+44+20+7946+0958")).toBe(
      "phone=+44 20 7946 0958",
    );
  });

  test("is as long as the text", () => {
    for (const text of [
      "4111+1111",
      "a+b+c+d",
      "٤١١١+١١١١",
      "\u{1D400}+x+\u{1D400}",
    ]) {
      expect(withWrittenPlusesAsSpaces(text)!.length).toBe(text.length);
    }
  });

  test("is null when no '+' is read as a space: none, each a number's sign, or runs", () => {
    expect(withWrittenPlusesAsSpaces("")).toBeNull();
    expect(withWrittenPlusesAsSpaces("no plus here")).toBeNull();
    expect(withWrittenPlusesAsSpaces("+44 20 7946 0958")).toBeNull();
    expect(
      withWrittenPlusesAsSpaces(
        "call (+44) 20 7946 0958 at tz=+05:30, or +1 555",
      ),
    ).toBeNull();
    expect(withWrittenPlusesAsSpaces("C++ and ++44 20")).toBeNull();
  });
});

describe("what the reading reads", () => {
  test.each([
    [
      "a card typed into a form",
      "card=4539+1488+0343+6467&step=2",
      "card=4539 1488 0343 6467&step=2",
    ],
    [
      "an IBAN typed into a form",
      "iban=DE44+5001+0517+5407+3249+31",
      "iban=DE44 5001 0517 5407 3249 31",
    ],
    ["a postcode", "postcode=SW1A+1AA", "postcode=SW1A 1AA"],
    [
      "a phone number, its own '+' escaped",
      "phone=%2B44+20+7946+0958",
      "phone=+44 20 7946 0958",
    ],
    [
      "a phone number, its own '+' as written",
      "phone=+44+20+7946+0958",
      "phone=+44 20 7946 0958",
    ],
    [
      "a phone number in parentheses",
      "phone=%28415%29+555-2671",
      "phone=(415) 555-2671",
    ],
    [
      "the words before a value",
      "date+of+birth=12%2F03%2F1985",
      "date of birth=12/03/1985",
    ],
    [
      "a name, its letters' UTF-8 bytes escaped",
      "name=Jos%C3%A9+Garc%C3%ADa",
      "name=José García",
    ],
    [
      "a card in a URL inside a query string, its '+'s escaped",
      "next=%2Fpay%3Fcard%3D4539%2B1488%2B0343%2B6467",
      "next=/pay?card=4539 1488 0343 6467",
    ],
    [
      "in a text a form wrote, an escaped '+' beside a written one: the '+' it escaped",
      "q=4111%2B1111+1111",
      "q=4111+1111 1111",
    ],
    [
      "a centenarian's personnummer a form wrote, its own '+' escaped",
      "pnr=19991231%2B1234&name=Ada+Lovelace",
      "pnr=19991231+1234&name=Ada Lovelace",
    ],
    [
      "an escape escaped again",
      "next=%252Fpay%253Fcard%253D4111+1111",
      "next=/pay?card=4111 1111",
    ],
    ["a digit escaped, before a '+'", "card=4111%31+1111", "card=41111 1111"],
    [
      "a JSON text a form wrote, its spaces beside punctuation",
      "data=%7B%22card%22%3A+%224539+1488+0343+6467%22%7D",
      'data={"card": "4539 1488 0343 6467"}',
    ],
    [
      "a phone number a form wrote after its words, its '+' escaped",
      "note=contact%3A+%2B44+20+7946+0958",
      "note=contact: +44 20 7946 0958",
    ],
  ])("%s: %s reads %s", (_label: string, text: string, readable: string) => {
    expect(PlusAsSpaceText.read(text)!.readable).toBe(readable);
    expect(PlusAsSpaceText.readableOf(text)).toBe(readable);
  });

  test("an escaped '+' that starts a value is a '+', as a phone number's own is", () => {
    expect(PlusAsSpaceText.readableOf("phone=%2B44%2020%207946%200958")).toBe(
      "phone=+44 20 7946 0958",
    );
    expect(PlusAsSpaceText.read("phone=%2B44%2020%207946%200958")).toBeNull();
    expect(PlusAsSpaceText.readableOf("to=%2B447700900123")).toBe(
      "to=+447700900123",
    );
  });

  test("a text with no '+' for a space reads as its escapes read", () => {
    expect(PlusAsSpaceText.read("card=4111%201111")).toBeNull();
    expect(PlusAsSpaceText.readableOf("card=4111%201111")).toBe(
      PercentDecodedText.readableOf("card=4111%201111"),
    );
    expect(PlusAsSpaceText.readableOf("+44 20 7946 0958")).toBe(
      "+44 20 7946 0958",
    );
    expect(PlusAsSpaceText.readableOf("")).toBe("");
  });

  test("the reading keeps the text it was read from", () => {
    const read: PlusAsSpaceText = PlusAsSpaceText.read("a+b")!;

    expect(read.written).toBe("a+b");
    expect(read.readable).toBe("a b");
  });

  test("says whether a form wrote the text, or a query string inside the URL holds its '+'s", () => {
    // Written "+"s for spaces: a form's.
    expect(PlusAsSpaceText.read("card=4111+1111")!.isFormWritten).toBe(true);
    expect(PlusAsSpaceText.read("q=a%2Bb+c")!.isFormWritten).toBe(true);
    // Only escaped ones, between two characters of a value: a URL's inside the query string.
    expect(
      PlusAsSpaceText.read("next=%2Fpay%3Fcard%3D4111%2B1111")!.isFormWritten,
    ).toBe(false);
    // An escaped "+" that is a number's sign is no space of any query string.
    expect(PlusAsSpaceText.read("phone=%2B44%2020")).toBeNull();
  });
});

describe("where each part of the reading is written", () => {
  test("a value read with spaces is placed on its '+'s, whole", () => {
    const text: string = "GET /pay?card=4539+1488+0343+6467&step=2";

    expect(writtenOf(text, "4539 1488 0343 6467")).toBe("4539+1488+0343+6467");
  });

  test("a value read with spaces and escapes is placed on both, whole", () => {
    const text: string = "phone=%2B44+20+7946+0958&x=1";

    expect(writtenOf(text, "+44 20 7946 0958")).toBe("%2B44+20+7946+0958");
    expect(writtenOf(text, "x=1")).toBe("x=1");
  });

  test("every position of a reading with no escape is where it is written", () => {
    const text: string = "iban=DE44+5001+0517+5407+3249+31";
    const read: PlusAsSpaceText = PlusAsSpaceText.read(text)!;

    for (let position: number = 0; position <= text.length; position++) {
      expect(read.toWritten(position)).toBe(position);
    }
  });

  test("a character beyond U+FFFF before a '+' is placed whole", () => {
    const text: string = "\u{1D400}+\u{1D401}";
    const read: PlusAsSpaceText = PlusAsSpaceText.read(text)!;

    expect(read.readable).toBe("\u{1D400} \u{1D401}");
    expect(read.toWritten(read.readable.length)).toBe(text.length);
  });

  test("a card in a URL inside a query string is placed on its escapes, whole", () => {
    const text: string = "next=%2Fpay%3Fcard%3D4539%2B1488%2B0343%2B6467&x=1";

    expect(writtenOf(text, "4539 1488 0343 6467")).toBe(
      "4539%2B1488%2B0343%2B6467",
    );
  });

  test("the end of the reading is the end of the text", () => {
    for (const text of [
      "a+b",
      "phone=%2B44+20",
      "x%252Fa+y",
      "%C3%A9+5",
      "4111%2B1111",
    ]) {
      const read: PlusAsSpaceText = PlusAsSpaceText.read(text)!;

      expect(read.toWritten(read.readable.length)).toBe(text.length);
      expect(read.toWritten(0)).toBe(0);
    }
  });
});

describe("in time in line with the text's length", () => {
  const LENGTH: number = 400_000;
  const LIMIT_IN_MS: number = 2000;

  function repeat(unit: string): string {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  }

  test.each([
    ["'+'s without end", repeat("+")],
    ["'+'s for spaces without end", repeat("1+")],
    ["'+'s that are no space without end", repeat(" + ")],
    ["escaped '+'s and '+'s without end", repeat("%2B+")],
    ["escaped '+'s for spaces without end", repeat("4%2B")],
    ["'+'s before escapes without end", repeat("4+%20")],
    ["escaped '+'s escaped again without end", repeat("4%252B")],
    ["'+'s after parentheses without end", repeat(")+(")],
    ["'+'s between letters of another script without end", repeat("张+")],
    ["'+'s after letters beyond U+FFFF without end", repeat("\u{1D400}+")],
    [
      "a card typed into a form again and again",
      repeat("4111+1111+1111+1111&"),
    ],
  ])("reads %s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        const read: PlusAsSpaceText | null = PlusAsSpaceText.read(text);

        return read ? read.toWritten(read.readable.length) : text.length;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(timed.result).toBe(text.length);
  });
});
