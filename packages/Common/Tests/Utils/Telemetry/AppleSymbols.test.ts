import { describe, expect, test } from "@jest/globals";
import {
  APPLE_SYMBOLS_HEADER,
  AppleSymbol,
  AppleSymbolTable,
  MAX_APPLE_SYMBOL_NAME_LENGTH,
  countStoredAppleSymbols,
  decodeAppleSymbols,
  encodeAppleSymbols,
  lookupAppleSymbol,
  normalizeAppleDebugId,
} from "../../../Utils/Telemetry/AppleSymbols";

/*
 * #9922: a build's function symbols as OneUptime keeps them - one compact
 * text a binary, read back into a table a frame's offset is looked up in.
 */

const CHECKOUT: string = "$s5MyApp18CartViewControllerC8checkoutyyF";

const SYMBOLS: Array<AppleSymbol> = [
  { offset: 0x4e20, name: "main" },
  { offset: 0x24a10, name: "$s5MyApp4CartV3addyyAA4ItemVF" },
  { offset: 0x2dfd0, name: "$s5MyApp18CartViewControllerC4loadyyKF" },
  { offset: 0x37ec8, name: CHECKOUT },
];

function table(
  symbols: Array<AppleSymbol>,
  textEndOffset: number,
): AppleSymbolTable {
  return decodeAppleSymbols(encodeAppleSymbols({ symbols, textEndOffset }))!;
}

describe("a binary's UUID, in one form", () => {
  test("MetricKit's, KSCrash's and dwarfdump's forms of one UUID are one", () => {
    for (const written of [
      "70B89F27-1634-3580-A695-57CDB41D7743",
      "70b89f2716343580a69557cdb41d7743",
      "{70B89F27-1634-3580-A695-57CDB41D7743}",
      " 70b89f27-1634-3580-a695-57cdb41d7743 ",
    ]) {
      expect(normalizeAppleDebugId(written)).toBe(
        "70B89F27-1634-3580-A695-57CDB41D7743",
      );
    }
  });

  test("anything else is none", () => {
    for (const written of [
      "",
      "70B89F27-1634-3580-A695-57CDB41D774",
      "70B89F27-1634-3580-A695-57CDB41D77433",
      "70B89F27-1634-3580-A695-57CDB41D774G",
      42,
      null,
      undefined,
      { uuid: "70B89F27-1634-3580-A695-57CDB41D7743" },
    ]) {
      expect(normalizeAppleDebugId(written)).toBe(null);
    }
  });
});

describe("the text a table is kept as", () => {
  test("a header, the end of the code, and each symbol's distance from the one before it", () => {
    expect(
      encodeAppleSymbols({ symbols: SYMBOLS, textEndOffset: 0x40000 }).split(
        "\n",
      ),
    ).toEqual([
      APPLE_SYMBOLS_HEADER,
      "40000",
      "4e20 main",
      "1fbf0 $s5MyApp4CartV3addyyAA4ItemVF",
      "95c0 $s5MyApp18CartViewControllerC4loadyyKF",
      `9ef8 ${CHECKOUT}`,
    ]);
  });

  test("reads back to the symbols it was made from, in order", () => {
    const read: AppleSymbolTable = table(SYMBOLS, 0x40000);

    expect(read.offsets).toEqual([0x4e20, 0x24a10, 0x2dfd0, 0x37ec8]);
    expect(read.names).toEqual(
      SYMBOLS.map((symbol: AppleSymbol) => {
        return symbol.name;
      }),
    );
    expect(read.textEndOffset).toBe(0x40000);
  });

  test("sorts what came in any order, and keeps the first name given for an offset", () => {
    const read: AppleSymbolTable = table(
      [
        { offset: 300, name: "third" },
        { offset: 100, name: "first" },
        { offset: 200, name: "second" },
        { offset: 100, name: "alias of first" },
      ],
      1000,
    );

    expect(read.offsets).toEqual([100, 200, 300]);
    expect(read.names).toEqual(["first", "second", "third"]);
  });

  test("leaves out a symbol with no name or an offset that is not one, and keeps a name on one line, bounded", () => {
    const read: AppleSymbolTable = table(
      [
        { offset: -1, name: "negative" },
        { offset: 1.5, name: "fractional" },
        { offset: Number.MAX_SAFE_INTEGER + 2, name: "too large" },
        { offset: 10, name: "" },
        { offset: 20, name: "two\nlines" },
        { offset: 30, name: "x".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH + 10) },
      ],
      100,
    );

    expect(read.offsets).toEqual([20, 30]);
    expect(read.names[0]).toBe("two lines");
    expect(read.names[1]).toHaveLength(MAX_APPLE_SYMBOL_NAME_LENGTH);
  });

  test("counts its symbols without reading them", () => {
    expect(
      countStoredAppleSymbols(
        encodeAppleSymbols({ symbols: SYMBOLS, textEndOffset: 0x40000 }),
      ),
    ).toBe(4);
    expect(
      countStoredAppleSymbols(
        encodeAppleSymbols({ symbols: [], textEndOffset: 0x40000 }),
      ),
    ).toBe(0);
    expect(countStoredAppleSymbols("not a table\n1 a\n2 b")).toBe(0);
  });

  test("a text that is not a table is none, and a table cut short keeps the symbols before the cut", () => {
    expect(decodeAppleSymbols("")).toBe(null);
    expect(decodeAppleSymbols("1 main")).toBe(null);
    expect(decodeAppleSymbols(`${APPLE_SYMBOLS_HEADER}`)).toBe(null);
    expect(decodeAppleSymbols(`${APPLE_SYMBOLS_HEADER}\nzz`)).toBe(null);
    expect(decodeAppleSymbols(42 as unknown as string)).toBe(null);

    const cut: AppleSymbolTable = decodeAppleSymbols(
      [APPLE_SYMBOLS_HEADER, "1000", "10 first", "10 second", "garbage"].join(
        "\n",
      ),
    )!;

    expect(cut.offsets).toEqual([0x10, 0x20]);
    expect(cut.names).toEqual(["first", "second"]);

    // A later symbol at the same offset as the one before it is no table's.
    const repeated: AppleSymbolTable = decodeAppleSymbols(
      [APPLE_SYMBOLS_HEADER, "1000", "10 first", "0 again", "10 third"].join(
        "\n",
      ),
    )!;

    expect(repeated.names).toEqual(["first"]);
  });
});

describe("the function an offset is in", () => {
  const read: AppleSymbolTable = table(SYMBOLS, 0x40000);

  test("the symbol at or before it, and how far into it", () => {
    expect(lookupAppleSymbol(read, 0x37ec8)).toEqual({
      name: CHECKOUT,
      symbolOffset: 0,
    });
    expect(lookupAppleSymbol(read, 229796)).toEqual({
      name: CHECKOUT,
      symbolOffset: 229796 - 0x37ec8,
    });
    expect(lookupAppleSymbol(read, 0x2dfcf)).toEqual({
      name: "$s5MyApp4CartV3addyyAA4ItemVF",
      symbolOffset: 0x2dfcf - 0x24a10,
    });
    expect(lookupAppleSymbol(read, 20320)).toEqual({
      name: "main",
      symbolOffset: 20320 - 0x4e20,
    });
  });

  test("none before the first symbol, at or past the end of the code, or for no offset", () => {
    expect(lookupAppleSymbol(read, 0x4e1f)).toBe(null);
    expect(lookupAppleSymbol(read, 0x40000)).toBe(null);
    expect(lookupAppleSymbol(read, 0x50000)).toBe(null);
    expect(lookupAppleSymbol(read, -1)).toBe(null);
    expect(lookupAppleSymbol(read, NaN)).toBe(null);
    expect(lookupAppleSymbol(table([], 0x40000), 0x4e20)).toBe(null);
  });

  test("a table with no end of code bounds nothing past its last symbol", () => {
    expect(lookupAppleSymbol(table(SYMBOLS, 0), 0x90000)).toEqual({
      name: CHECKOUT,
      symbolOffset: 0x90000 - 0x37ec8,
    });
  });

  test("finds every symbol of a large table by binary search", () => {
    const many: Array<AppleSymbol> = [];

    for (let index: number = 0; index < 50_000; index++) {
      many.push({ offset: index * 16, name: `function_${index}` });
    }

    const large: AppleSymbolTable = table(many, 50_000 * 16);

    for (const index of [0, 1, 7, 24_999, 25_000, 49_998, 49_999]) {
      expect(lookupAppleSymbol(large, index * 16 + 5)).toEqual({
        name: `function_${index}`,
        symbolOffset: 5,
      });
    }
  });
});
