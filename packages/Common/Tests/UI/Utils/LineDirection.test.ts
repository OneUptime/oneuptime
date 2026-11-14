import {
  getLineDirection,
  getOneWayLineDirection,
  getTranslatedLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import {
  FIRST_STRONG_ISOLATE,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  RIGHT_TO_LEFT,
} from "../../../Types/ReadingDirection";
import { describe, expect, test } from "@jest/globals";

/*
 * A line cut short with "..." is cut at the end of the line, and a line
 * ends where the page's lines do: on a Persian page an English name lost
 * its start ("...negro de la Vega"). The box that cuts it reads the way its
 * value does - only when that is not the page's way - and lines up as the
 * page's lines do.
 */

describe("getLineDirection", () => {
  test("a value in Latin letters on a Persian page reads left to right", () => {
    expect(getLineDirection("José Ignacio Negro de la Vega", "fa")).toBe("ltr");
    expect(getLineDirection("k.morgan@acme-commerce.example", "fa")).toBe(
      "ltr",
    );
    expect(getLineDirection("fa-IR", "fa-IR")).toBe("ltr");
  });

  test("a value in Persian letters on an English or German page reads right to left", () => {
    expect(getLineDirection("سارا احمدی", "en")).toBe("rtl");
    expect(getLineDirection("پنل مدیریت فروشگاه", "de")).toBe("rtl");
  });

  test("a value that reads the page's way needs nothing of its own", () => {
    expect(getLineDirection("Checkout API", "en")).toBeUndefined();
    expect(getLineDirection("Checkout API", "de")).toBeUndefined();
    expect(getLineDirection("سارا احمدی", "fa")).toBeUndefined();
  });

  test("most letters decide: a Persian sentence that starts with an English word reads right to left", () => {
    expect(getLineDirection("API پرداخت از کار افتاده", "en")).toBe("rtl");
    expect(getLineDirection("API پرداخت از کار افتاده", "fa")).toBeUndefined();
  });

  test("a value with no letters, or none at all, follows the page", () => {
    expect(getLineDirection("8080", "fa")).toBeUndefined();
    expect(getLineDirection("10.0.0.1", "fa")).toBeUndefined();
    expect(getLineDirection("", "fa")).toBeUndefined();
    expect(getLineDirection(undefined, "fa")).toBeUndefined();
    expect(getLineDirection(null, "en")).toBeUndefined();
  });

  test("a page whose language is not known reads left to right", () => {
    expect(getLineDirection("سارا", undefined)).toBe("rtl");
    expect(getLineDirection("Sara", undefined)).toBeUndefined();
  });
});

/*
 * A line of the product's own words - a help line, an empty state's
 * sentence, an error - in the reader's language. Read by most of its
 * letters, an Arabic or Persian line that names more products in Latin
 * letters than it has words of its own read left to right, and laid out
 * from the left its words came out in the wrong order.
 */
describe("getTranslatedLineDirection", () => {
  const FSI: string = String.fromCharCode(0x2068);
  const PDI: string = String.fromCharCode(0x2069);
  const ARABIC_TEAMS: string = "Microsoft Teams غير متصل بعد!";
  const PERSIAN_SMTP: string =
    "نام میزبان سرور SMTP. نمونه‌ها: smtp.office365.com (Microsoft 365)، smtp.gmail.com (Google)";

  test("an Arabic or Persian line follows its page, however many names it gives in Latin letters", () => {
    // By most letters, both read left to right.
    expect(getLineDirection(ARABIC_TEAMS, "ar")).toBe("ltr");
    expect(getLineDirection(PERSIAN_SMTP, "fa")).toBe("ltr");

    expect(getTranslatedLineDirection(ARABIC_TEAMS, "ar")).toBeUndefined();
    expect(getTranslatedLineDirection(PERSIAN_SMTP, "fa")).toBeUndefined();
    expect(getTranslatedLineDirection(PERSIAN_SMTP, "fa-IR")).toBeUndefined();
  });

  test("an English line not worded yet reads left to right on a page read from the right", () => {
    expect(
      getTranslatedLineDirection("Turn this on to page the team.", "fa"),
    ).toBe("ltr");
    expect(
      getTranslatedLineDirection(
        "Something went wrong on the server. Please try again.",
        "ar",
      ),
    ).toBe("ltr");
  });

  /*
   * The server's answers are English and quote names people typed, often
   * in Arabic or Persian letters on such a page. Drawn the page's way, the
   * English came out of order, its full stop first.
   */
  test("an English answer that quotes a name typed in Arabic or Persian reads by most of its letters", () => {
    expect(
      getTranslatedLineDirection(
        "A custom channel named قناة الطوارئ already exists. Give this one another name, so people can tell them apart.",
        "ar",
      ),
    ).toBe("ltr");
    expect(
      getTranslatedLineDirection('Runner "کانال اضطراری" is offline.', "fa"),
    ).toBe("ltr");
    expect(
      getTranslatedLineDirection(
        '"قناة الطوارئ" is a built-in measurement and cannot be deleted. Disable it instead.',
        "ar",
      ),
    ).toBe("ltr");
  });

  test("an Arabic or Persian line whose names hold small English words still follows its page", () => {
    // By most letters, both read left to right.
    const OPENSTACK: string =
      "Red Hat OpenStack Services on OpenShift، مع Telemetry Operator الخاص به.";
    const POLICY: string = "ضمن «Alert on every device and port» فعّلها.";

    expect(getLineDirection(OPENSTACK, "ar")).toBe("ltr");
    expect(getLineDirection(POLICY, "ar")).toBe("ltr");

    expect(getTranslatedLineDirection(OPENSTACK, "ar")).toBeUndefined();
    expect(getTranslatedLineDirection(POLICY, "ar")).toBeUndefined();
  });

  test("an English line round a Persian name it sets apart is still English", () => {
    expect(
      getTranslatedLineDirection(
        `Paged ${FSI}سرویس پرداخت فروشگاه اینترنتی مرکزی${PDI} again.`,
        "fa",
      ),
    ).toBe("ltr");
  });

  test("on a page read from the left, a line reads by most of its letters, as getLineDirection says", () => {
    for (const text of [
      ARABIC_TEAMS,
      PERSIAN_SMTP,
      "سارا احمدی",
      "API پرداخت از کار افتاده",
      "Checkout API",
    ]) {
      for (const language of ["en", "de", undefined]) {
        expect({
          text,
          language,
          direction: getTranslatedLineDirection(text, language),
        }).toEqual({
          text,
          language,
          direction: getLineDirection(text, language),
        });
      }
    }
  });

  test("a line with no letters, or none at all, follows the page", () => {
    expect(getTranslatedLineDirection("8080", "fa")).toBeUndefined();
    expect(getTranslatedLineDirection("", "ar")).toBeUndefined();
    expect(getTranslatedLineDirection(undefined, "fa")).toBeUndefined();
    expect(getTranslatedLineDirection(null, "en")).toBeUndefined();
  });
});

/*
 * A line read one way on every page - the user flow map's two pages and
 * the arrow between them, drawn from the left in every language - is read
 * that way whatever its letters. Each page is set apart in it, so by the
 * letters in its isolates a transition between two folds named in Arabic
 * read from the right on an Arabic page, its arrow pointing back.
 */
describe("getOneWayLineDirection", () => {
  const FOLD: string = `${FIRST_STRONG_ISOLATE}صفحات أخرى${POP_DIRECTIONAL_ISOLATE}`;
  const BETWEEN_TWO_FOLDS: string = `${FOLD} → ${FOLD}`;

  test("a line read from the left reads so on a page read from the right, whatever its letters", () => {
    expect(getLineDirection(BETWEEN_TWO_FOLDS, "ar")).toBeUndefined();
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, "ar")).toBe("ltr");
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, "fa")).toBe("ltr");
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, "fa-IR")).toBe("ltr");
  });

  test("on a page that reads the same way it needs nothing of its own, as getLineDirection gives", () => {
    expect(getLineDirection(BETWEEN_TWO_FOLDS, "en")).toBe("rtl");
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, "en")).toBeUndefined();
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, "de")).toBeUndefined();
    expect(getOneWayLineDirection(LEFT_TO_RIGHT, undefined)).toBeUndefined();
    expect(getOneWayLineDirection(RIGHT_TO_LEFT, "ar")).toBeUndefined();
  });

  test("a line read from the right reads so on a page read from the left", () => {
    expect(getOneWayLineDirection(RIGHT_TO_LEFT, "en")).toBe("rtl");
    expect(getOneWayLineDirection(RIGHT_TO_LEFT, null)).toBe("rtl");
  });
});

describe("the line's alignment", () => {
  /*
   * A box gets a dir of its own only when it reads the other way from the
   * page, so the page's start is the box's end: a short English value in a
   * Persian cell still starts at the right, under its column's name.
   */
  test("is the box's end, which is the page's start", () => {
    expect(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME).toBe("text-end");
  });
});
