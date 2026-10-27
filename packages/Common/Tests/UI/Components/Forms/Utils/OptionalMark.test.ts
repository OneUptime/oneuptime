import {
  OPTIONAL_MARK,
  splitTitleOptionalMark,
  TitleOptionalMark,
  titleHasOwnOptionalMark,
} from "../../../../../UI/Components/Forms/Utils/OptionalMark";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Forms/Utils/OptionalMark: a field title that says "(Optional)" itself -
 * "DNS Server (Optional)", the LLM budgets' "Service (optional)" - is split
 * from its mark, so FieldLabel draws the one mark, in the title's own words
 * in the reader's language, instead of "DNS Server (Optional) (Optional)".
 */

describe("titleHasOwnOptionalMark", () => {
  test.each([
    "DNS Server (Optional)",
    "Service (optional)",
    "Target Prefix (optional)  ",
    "Notes (OPTIONAL)",
  ])("%p says it", (title: string) => {
    expect(titleHasOwnOptionalMark(title)).toBe(true);
  });

  test.each([
    "DNS Server",
    "Optional Settings",
    "Optional",
    "Port (default 53)",
    "(Optional) Notes",
  ])("%p does not", (title: string) => {
    expect(titleHasOwnOptionalMark(title)).toBe(false);
  });

  test("the label's own mark is the English it looks up", () => {
    expect(OPTIONAL_MARK).toBe("(Optional)");
  });
});

describe("splitTitleOptionalMark", () => {
  test("English: the title and its mark, the space kept with the title", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "DNS Server (Optional)",
        drawnTitle: "DNS Server (Optional)",
      }),
    ).toEqual({ title: "DNS Server ", mark: "(Optional)" });
  });

  test("each language's own words for it, whatever they are", () => {
    const cases: Array<[string, string, string]> = [
      ["DNS-Server (Optional)", "DNS-Server ", "(Optional)"],
      ["Serveur DNS (facultatif)", "Serveur DNS ", "(facultatif)"],
      ["Server DNS (opzionale)", "Server DNS ", "(opzionale)"],
      ["DNS-сервер (необязательно)", "DNS-сервер ", "(необязательно)"],
      ["سرور DNS (اختیاری)", "سرور DNS ", "(اختیاری)"],
      ["DNS 서버(선택 사항)", "DNS 서버", "(선택 사항)"],
    ];

    for (const [drawn, title, mark] of cases) {
      expect(
        splitTitleOptionalMark({
          englishTitle: "DNS Server (Optional)",
          drawnTitle: drawn,
        }),
      ).toEqual({ title, mark });
    }
  });

  test("full-width brackets (Chinese, Japanese) are split the same way, with no space added", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "DNS Server (Optional)",
        drawnTitle: "DNS 服务器（可选）",
      }),
    ).toEqual({ title: "DNS 服务器", mark: "（可选）" });

    expect(
      splitTitleOptionalMark({
        englishTitle: "Telegram Handle (optional)",
        drawnTitle: "Telegram ハンドル (任意)",
      }),
    ).toEqual({ title: "Telegram ハンドル ", mark: "(任意)" });
  });

  test("a title that carries no mark comes back whole", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "Port",
        drawnTitle: "Port (Optional)",
      }),
    ).toEqual({ title: "Port (Optional)", mark: null });
  });

  test("a translation that left the mark out comes back whole", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "Service (optional)",
        drawnTitle: "Dienst",
      }),
    ).toEqual({ title: "Dienst", mark: null });
  });

  test("a title that is only the mark is not split into nothing", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "(Optional)",
        drawnTitle: "(Optional)",
      }),
    ).toEqual({ title: "(Optional)", mark: null });
  });

  test("a mark is found at the end only, past brackets earlier in the title", () => {
    expect(
      splitTitleOptionalMark({
        englishTitle: "Interface (e.g. Gi0/1) (Optional)",
        drawnTitle: "Interface (e.g. Gi0/1) (Optional)",
      }),
    ).toEqual({ title: "Interface (e.g. Gi0/1) ", mark: "(Optional)" });
  });

  /*
   * A custom field's title is written by a person. 400,000 characters of
   * brackets - the shape that would make a pattern try every one - are
   * split with lastIndexOf, in a few milliseconds.
   */
  test("a long title is split in time that grows with it", () => {
    const longTitle: string = `${"(a) ".repeat(100000)}(Optional)`;

    const split: FastestRun<TitleOptionalMark> = fastestRun({
      run: (): TitleOptionalMark => {
        return splitTitleOptionalMark({
          englishTitle: longTitle,
          drawnTitle: longTitle,
        });
      },
      limitInMs: 2000,
    });

    expect(split.result.mark).toBe("(Optional)");
    expect(split.inMs).toBeLessThan(2000);
  });
});
