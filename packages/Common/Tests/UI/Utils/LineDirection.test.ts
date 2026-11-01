import {
  getLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
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
    expect(getLineDirection("José Ignacio Negro de la Vega", "fa")).toBe(
      "ltr",
    );
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
