import { describe, expect, test } from "@jest/globals";
import {
  ARABIC_LIST_SEPARATOR,
  getListSeparator,
  IDEOGRAPHIC_LIST_SEPARATOR,
  LIST_SEPARATOR,
} from "../../../UI/Utils/ListSeparator";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * What goes between two names listed one after another - a form's folded
 * More fields line names what it holds this way ("More fields ·
 * Description, Labels") - written the way the names' script writes a list.
 */
describe("getListSeparator", () => {
  test("a comma and a space between names in a Latin or Cyrillic script", () => {
    expect(LIST_SEPARATOR).toBe(", ");
    expect(getListSeparator(["Description", "Labels"])).toBe(", ");
    expect(getListSeparator(["Beschreibung", "Labels"])).toBe(", ");
    expect(getListSeparator(["Описание", "Метки"])).toBe(", ");
    // Korean and Hindi write a comma too.
    expect(getListSeparator(["설명", "레이블"])).toBe(", ");
    expect(getListSeparator(["विवरण", "लेबल"])).toBe(", ");
  });

  test("the ideographic comma, with no space after it, in Chinese and Japanese", () => {
    expect(IDEOGRAPHIC_LIST_SEPARATOR).toBe("、");
    expect(getListSeparator(["描述", "标签"])).toBe("、");
    expect(getListSeparator(["說明", "標籤"])).toBe("、");
    // Kanji, hiragana and katakana alike.
    expect(getListSeparator(["説明", "ラベル"])).toBe("、");
    expect(getListSeparator(["その他"])).toBe("、");
  });

  test("the Arabic comma and a space in Persian", () => {
    expect(ARABIC_LIST_SEPARATOR).toBe("، ");
    expect(getListSeparator(["توضیحات", "برچسب‌ها"])).toBe("، ");
  });

  test("one name in the script decides: a translated list may hold a name typed in English", () => {
    expect(getListSeparator(["Customer Tier", "ラベル"])).toBe("、");
    expect(getListSeparator(["Customer Tier", "برچسب‌ها"])).toBe("، ");
  });

  test("names nobody translated keep their English commas", () => {
    expect(getListSeparator(["Customer Tier", "Customer Impact"])).toBe(", ");
    expect(getListSeparator([])).toBe(", ");
    expect(getListSeparator([""])).toBe(", ");
  });

  test("reads a long list in time that grows with it", () => {
    const names: Array<string> = Array.from(
      { length: 20000 },
      (_value: unknown, index: number): string => {
        return `Field ${index}`;
      },
    );

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(getListSeparator([...names, "ラベル"])).toBe("、");
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
