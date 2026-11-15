import { describe, expect, test } from "@jest/globals";
import { writeFigureInLanguage } from "../../Types/DateLanguage";

/*
 * A figure an English formatter wrote ("2.5k", "1.2K/s", "12%", "3.5 TiB"),
 * in the reader's digits, decimal sign and percent sign, its scale letter
 * and unit kept (#8060, #8349). English and no language come back as they
 * came, and so does anything that is not such a figure.
 */
describe("writeFigureInLanguage", () => {
  test("English, and no language, read exactly as written", () => {
    for (const english of ["0.025", "2.5k", "12%", "3.5 TiB", "1.2K/s", "-4"]) {
      expect(writeFigureInLanguage(english, "en")).toBe(english);
      expect(writeFigureInLanguage(english, "en-GB")).toBe(english);
      expect(writeFigureInLanguage(english, undefined)).toBe(english);
      expect(writeFigureInLanguage(english, null)).toBe(english);
      expect(writeFigureInLanguage(english, "")).toBe(english);
    }
  });

  test("German: a decimal comma and its own percent sign, the decimals kept", () => {
    expect(writeFigureInLanguage("0.025", "de")).toBe("0,025");
    expect(writeFigureInLanguage("0.250", "de")).toBe("0,250");
    expect(writeFigureInLanguage("2.5k", "de")).toBe("2,5k");
    expect(writeFigureInLanguage("1.2K/s", "de")).toBe("1,2K/s");
    expect(writeFigureInLanguage("12%", "de")).toBe("12 %");
    expect(writeFigureInLanguage("12.5%", "de")).toBe("12,5 %");
    expect(writeFigureInLanguage("3.5 TiB", "de")).toBe("3,5 TiB");
    expect(writeFigureInLanguage("1.5 MB/s", "de")).toBe("1,5 MB/s");
    expect(writeFigureInLanguage("27 °C", "de")).toBe("27 °C");
    // A big figure takes the language's grouping.
    expect(writeFigureInLanguage("1234", "de")).toBe("1.234");
  });

  test("Persian: Persian digits, decimal sign and percent sign, no Latin digit", () => {
    expect(writeFigureInLanguage("0.025", "fa")).toBe("۰٫۰۲۵");
    expect(writeFigureInLanguage("2.5k", "fa")).toBe("۲٫۵k");
    expect(writeFigureInLanguage("12%", "fa")).toBe("۱۲٪");
    expect(writeFigureInLanguage("3.5 TiB", "fa")).toBe("۳٫۵ TiB");
    expect(writeFigureInLanguage("1.2K/s", "fa")).toBe("۱٫۲K/s");
    expect(writeFigureInLanguage("42", "fa")).toBe("۴۲");
    // A negative figure takes Persian's own minus, before its digits.
    expect(writeFigureInLanguage("-4", "fa")).not.toMatch(/[0-9]/);
    expect(writeFigureInLanguage("-4", "fa")).toContain("۴");
  });

  test("Arabic: Latin digits, as the product writes them in Arabic", () => {
    expect(writeFigureInLanguage("0.025", "ar")).toBe("0.025");
    expect(writeFigureInLanguage("2.5k", "ar")).toBe("2.5k");
    expect(writeFigureInLanguage("3.5 TiB", "ar")).toBe("3.5 TiB");
    expect(writeFigureInLanguage("12%", "ar")).toMatch(/^12.*%/);
  });

  test("a percent of thousands keeps its sign as written", () => {
    expect(writeFigureInLanguage("2.5k%", "de")).toBe("2,5k%");
  });

  test("what is no English figure comes back as it came", () => {
    for (const text of [
      "—",
      "",
      "1e-7",
      "NaN",
      "abc",
      "4.2:1",
      "1,5",
      "۱٫۵",
      "v1.2.3",
      "10.0.0.1",
    ]) {
      expect(writeFigureInLanguage(text, "de")).toBe(text);
      expect(writeFigureInLanguage(text, "fa")).toBe(text);
    }
  });
});
