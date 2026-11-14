import { describe, expect, test } from "@jest/globals";
import {
  ARABIC_CLAUSE_SEPARATOR,
  ARABIC_LIST_SEPARATOR,
  CLAUSE_SEPARATOR,
  getClauseSeparator,
  getListSeparator,
  IDEOGRAPHIC_CLAUSE_SEPARATOR,
  IDEOGRAPHIC_LIST_SEPARATOR,
  joinClauses,
  joinList,
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

/*
 * What goes between two clauses of one line - the Template sync settings
 * summary's steps, a list of notes, a schedule's spans - written the way the
 * clauses' script writes a semicolon (#7607).
 */
describe("getClauseSeparator and joinClauses", () => {
  test("a semicolon and a space between clauses in a Latin or Cyrillic script", () => {
    expect(CLAUSE_SEPARATOR).toBe("; ");
    expect(
      joinClauses(["Step 1: Monitor destination", "Step 2: Retry count"]),
    ).toBe("Step 1: Monitor destination; Step 2: Retry count");
    expect(
      joinClauses(["Paso 1: Destino del monitor", "Paso 2: Reintentos"]),
    ).toBe("Paso 1: Destino del monitor; Paso 2: Reintentos");
    expect(joinClauses(["Шаг 1: Цель монитора", "Шаг 2: Число повторов"])).toBe(
      "Шаг 1: Цель монитора; Шаг 2: Число повторов",
    );
    // Korean and Hindi write a semicolon too.
    expect(getClauseSeparator(["1단계: 모니터 대상", "2단계: 재시도"])).toBe(
      "; ",
    );
    expect(
      getClauseSeparator(["चरण 1: मॉनिटर गंतव्य", "चरण 2: पुनः प्रयास"]),
    ).toBe("; ");
  });

  test("the fullwidth semicolon, with no space after it, in Chinese and Japanese", () => {
    expect(IDEOGRAPHIC_CLAUSE_SEPARATOR).toBe("；");
    // Han.
    expect(joinClauses(["第 1 步：监视目标", "第 2 步：重试次数"])).toBe(
      "第 1 步：监视目标；第 2 步：重试次数",
    );
    expect(joinClauses(["第 1 步：監控目標", "第 2 步：重試次數"])).toBe(
      "第 1 步：監控目標；第 2 步：重試次數",
    );
    // Kana alone decides as well as kanji.
    expect(joinClauses(["ステップ 1: ポート", "ステップ 2: リトライ"])).toBe(
      "ステップ 1: ポート；ステップ 2: リトライ",
    );
  });

  test("the Arabic semicolon and a space in Persian and Arabic", () => {
    expect(ARABIC_CLAUSE_SEPARATOR).toBe("؛ ");
    expect(
      joinClauses(["مرحله 1: هدف مانیتور", "مرحله 2: تعداد تلاش مجدد"]),
    ).toBe("مرحله 1: هدف مانیتور؛ مرحله 2: تعداد تلاش مجدد");
    expect(
      joinClauses(["الخطوة 1: وجهة المراقبة", "الخطوة 2: المحاولات"]),
    ).toBe("الخطوة 1: وجهة المراقبة؛ الخطوة 2: المحاولات");
  });

  test("one clause in the script decides: a translated line may hold a name typed in English", () => {
    expect(getClauseSeparator(["Customer Tier", "第 2 步：重试次数"])).toBe(
      "；",
    );
    expect(
      getClauseSeparator(["Customer Tier", "مرحله 2: تعداد تلاش مجدد"]),
    ).toBe("؛ ");
  });

  test("clauses nobody translated keep their English semicolon", () => {
    expect(
      joinClauses(["Step 1: Customer Tier", "Step 2: Customer Impact"]),
    ).toBe("Step 1: Customer Tier; Step 2: Customer Impact");
    expect(getClauseSeparator([])).toBe("; ");
    expect(getClauseSeparator([""])).toBe("; ");
    expect(joinClauses([])).toBe("");
    expect(joinClauses(["Step 1: Monitor destination"])).toBe(
      "Step 1: Monitor destination",
    );
  });

  test("clauses that list names take the comma and the semicolon of one script", () => {
    const step: (number: number, names: Array<string>) => string = (
      number: number,
      names: Array<string>,
    ): string => {
      return `第 ${number} 步：${joinList(names)}`;
    };

    expect(
      joinClauses([step(1, ["监视目标", "端口"]), step(2, ["重试次数"])]),
    ).toBe("第 1 步：监视目标、端口；第 2 步：重试次数");

    const samples: Array<[Array<string>, string, string]> = [
      [["Description", "Labels"], ", ", "; "],
      [["描述", "标签"], "、", "；"],
      [["توضیحات", "مالکان"], "، ", "؛ "],
    ];

    for (const [texts, comma, semicolon] of samples) {
      expect([getListSeparator(texts), getClauseSeparator(texts)]).toEqual([
        comma,
        semicolon,
      ]);
    }
  });

  test("reads a long line in time that grows with it", () => {
    const clauses: Array<string> = Array.from(
      { length: 20000 },
      (_value: unknown, index: number): string => {
        return `Step ${index}: Field ${index}`;
      },
    );

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(getClauseSeparator([...clauses, "第 2 步"])).toBe("；");
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
