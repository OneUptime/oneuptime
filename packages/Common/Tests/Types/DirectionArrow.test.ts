import {
  getArrowBack,
  getArrowOn,
  joinWithArrowsInDirection,
  joinWithArrowsOn,
  LEFTWARDS_ARROW,
  RIGHTWARDS_ARROW,
} from "../../Types/DirectionArrow";
import {
  FIRST_STRONG_ISOLATE,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  RIGHT_TO_LEFT,
} from "../../Types/ReadingDirection";
import {
  drawLine,
  getDrawnText,
  ParagraphDirection,
} from "../Helpers/BidiLayout";
import { isolated } from "../Helpers/IsolateMarks";
import { getPathArrows, PathArrow } from "../Helpers/PathArrows";
import { describe, expect, test } from "@jest/globals";

/*
 * AN ARROW THAT POINTS THE WAY ITS LINE IS READ (#7666).
 *
 * A browser draws "→" and "←" as they are written, on a page read either
 * way. An arrow a component drew between two values pointed back on an
 * Arabic or Persian page; it is taken from here for the language its line
 * is read in: on to what comes next ("→", and "←" read from the right),
 * or back to what came before.
 */

const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);

// Whether each arrow of a line, laid out `direction`, points back.
const pointsBack: (
  line: string,
  direction: ParagraphDirection,
) => Array<boolean> = (
  line: string,
  direction: ParagraphDirection,
): Array<boolean> => {
  return getPathArrows(line, direction).map((arrow: PathArrow): boolean => {
    return arrow.pointsBack;
  });
};

describe("the arrow on, to what comes next", () => {
  test("points right in a language read from the left", () => {
    for (const language of ["en", "de", "ja", "zh-TW", "pt-BR", "en-US"]) {
      expect({ language, arrow: getArrowOn(language) }).toEqual({
        language,
        arrow: RIGHTWARDS_ARROW,
      });
    }
  });

  test("points left in a language read from the right", () => {
    for (const language of ["fa", "ar", "he", "fa-IR", "ar-EG", "ur"]) {
      expect({ language, arrow: getArrowOn(language) }).toEqual({
        language,
        arrow: LEFTWARDS_ARROW,
      });
    }
  });

  test("points right where no language is known", () => {
    expect(getArrowOn(undefined)).toBe(RIGHTWARDS_ARROW);
    expect(getArrowOn(null)).toBe(RIGHTWARDS_ARROW);
    expect(getArrowOn("")).toBe(RIGHTWARDS_ARROW);
  });

  test("is the two arrows a browser never turns round", () => {
    expect(RIGHTWARDS_ARROW.codePointAt(0)).toBe(0x2192);
    expect(LEFTWARDS_ARROW.codePointAt(0)).toBe(0x2190);
  });
});

describe("the arrow back, to what came before", () => {
  test("is the other arrow, in every language", () => {
    for (const language of ["en", "de", undefined]) {
      expect(getArrowBack(language)).toBe(LEFTWARDS_ARROW);
    }

    for (const language of ["fa", "ar", "he"]) {
      expect(getArrowBack(language)).toBe(RIGHTWARDS_ARROW);
    }
  });

  test("points back at what came before, drawn either way", () => {
    // "← Back" read from the left; "→ بازگشت" read from the right.
    expect(pointsBack(`Step ${getArrowBack("en")} Back`, "ltr")).toEqual([
      true,
    ]);
    expect(pointsBack(`مرحله ${getArrowBack("fa")} بازگشت`, "rtl")).toEqual([
      true,
    ]);
  });
});

describe("values joined with the arrow on", () => {
  test("an English page writes two names in Latin letters as it always has", () => {
    expect(joinWithArrowsOn(["m5.2xlarge", "m5.xlarge"], "en")).toBe(
      "m5.2xlarge → m5.xlarge",
    );
    expect(joinWithArrowsOn(["10.0.0.1", "10.0.0.2", "10.0.0.3"], "en")).toBe(
      "10.0.0.1 → 10.0.0.2 → 10.0.0.3",
    );
  });

  test("an English page sets a Persian name apart, so the arrow stays the line's", () => {
    const line: string = joinWithArrowsOn(["سارا", "Checkout API"], "en");

    expect(line).toBe(`${isolated("سارا")} → Checkout API`);
    expect(pointsBack(line, "ltr")).toEqual([false]);
  });

  test("a Persian page points each value on to the next, the first drawn at the right", () => {
    const line: string = joinWithArrowsOn(["Declared", "Acknowledged"], "fa");

    expect(line).toBe(
      `${RIGHT_TO_LEFT_ISOLATE}${isolated("Declared")} ← ${isolated("Acknowledged")}${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(getDrawnText(drawLine(line, "rtl"))).toBe("Acknowledged ← Declared");
    expect(pointsBack(line, "rtl")).toEqual([false]);
  });

  test("a Persian page leaves Persian values as they are, and the arrow points on", () => {
    const line: string = joinWithArrowsOn(["اعلام‌شده", "تأییدشده"], "fa");

    expect(line).toBe(
      `${RIGHT_TO_LEFT_ISOLATE}اعلام‌شده ← تأییدشده${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(pointsBack(line, "rtl")).toEqual([false]);
  });

  test("an Arabic page sets apart a count, a time and a name", () => {
    const line: string = joinWithArrowsOn(
      ["412", "09:05", "Checkout API"],
      "ar",
    );

    expect(line).toBe(
      `${RIGHT_TO_LEFT_ISOLATE}${isolated("412")} ← ${isolated("09:05")} ← ${isolated("Checkout API")}${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(getDrawnText(drawLine(line, "rtl"))).toBe(
      "Checkout API ← 09:05 ← 412",
    );
    expect(pointsBack(line, "rtl")).toEqual([false, false]);
  });

  /*
   * A joined line can be a value of another sentence, set apart in a
   * first-strong isolate (setsValuesApart) or drawn in a box read from
   * the left: with no letter of its own outside its values, it would read
   * from the left there, and every arrow in it would point back again.
   */
  test("read from the right wherever it is put", () => {
    const line: string = joinWithArrowsOn(["Declared", "Acknowledged"], "fa");

    for (const [placed, direction] of [
      [line, "ltr"],
      [`${FIRST_STRONG_ISOLATE}${line}${POP_DIRECTIONAL_ISOLATE}`, "rtl"],
      [`${FIRST_STRONG_ISOLATE}${line}${POP_DIRECTIONAL_ISOLATE}`, "ltr"],
    ] as Array<[string, ParagraphDirection]>) {
      expect({
        direction,
        drawn: getDrawnText(drawLine(placed, direction)),
        pointsBack: pointsBack(placed, direction),
      }).toEqual({
        direction,
        drawn: "Acknowledged ← Declared",
        pointsBack: [false],
      });
    }
  });

  test("one value is only set apart, and none is nothing", () => {
    expect(joinWithArrowsOn(["m5.xlarge"], "fa")).toBe(isolated("m5.xlarge"));
    expect(joinWithArrowsOn(["m5.xlarge"], "en")).toBe("m5.xlarge");
    expect(joinWithArrowsOn([], "fa")).toBe("");
    expect(joinWithArrowsOn([], "en")).toBe("");
  });
});

/*
 * A line read one way on every page: the user flow map is drawn from the
 * left on an Arabic page too, so a band between two of its pages is named
 * the map's way there, its arrow pointing right.
 */
describe("values joined with the arrow on, in a line read one way on every page", () => {
  test("read from the left, two page paths are written as the map draws them", () => {
    const line: string = joinWithArrowsInDirection(
      ["/home", "/cart"],
      LEFT_TO_RIGHT,
    );

    expect(line).toBe("/home → /cart");
    expect(pointsBack(line, "ltr")).toEqual([false]);
  });

  test("read from the left, an Arabic page name is set apart, so the arrow stays the line's", () => {
    const line: string = joinWithArrowsInDirection(
      ["/home", "الدفع"],
      LEFT_TO_RIGHT,
    );

    expect(line).toBe(`/home → ${isolated("الدفع")}`);
    expect(pointsBack(line, "ltr")).toEqual([false]);
  });

  test("is the line a page read the same way joins", () => {
    for (const values of [
      ["Declared", "Acknowledged"],
      ["412", "09:05", "Checkout API"],
      ["اعلام‌شده", "تأییدشده"],
      ["m5.xlarge"],
      [],
    ]) {
      expect({
        values,
        fromTheLeft: joinWithArrowsInDirection(values, LEFT_TO_RIGHT),
        fromTheRight: joinWithArrowsInDirection(values, RIGHT_TO_LEFT),
      }).toEqual({
        values,
        fromTheLeft: joinWithArrowsOn(values, "en"),
        fromTheRight: joinWithArrowsOn(values, "ar"),
      });
    }
  });
});
