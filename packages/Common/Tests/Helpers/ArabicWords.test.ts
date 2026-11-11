import { describe, expect, test } from "@jest/globals";
import { wordAsWrittenIn, foldedArabic } from "./ArabicWords";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
  DOCS_LANGUAGES,
  STATUS_PAGE_LANGUAGES,
} from "./TranslatedLanguages";

describe("wordAsWrittenIn", () => {
  test("Arabic names a format with its dot, as en.json writes it", () => {
    expect(wordAsWrittenIn("ar", ".txt")).toBe(".txt");
    expect(wordAsWrittenIn("ar", ".csv")).toBe(".csv");
    expect(wordAsWrittenIn("ar", ".env")).toBe(".env");
  });

  test("Arabic names a family of attributes by the name they start with", () => {
    expect(wordAsWrittenIn("ar", "browser.*")).toBe("browser");
    expect(wordAsWrittenIn("ar", "device.*")).toBe("device");
  });

  test("Arabic keeps every other word as written", () => {
    for (const word of [
      "svc-*",
      "*",
      "10.20.0.0/16",
      "service.name",
      "SHA-256",
      "'%vip_users%'",
      "alice@example.com, CFO",
      // A dot that starts no word, and one in the middle of a name.
      ". ",
      "k8s.pod.name",
    ]) {
      expect(wordAsWrittenIn("ar", word)).toBe(word);
    }
  });

  test("every other language writes the word as it is", () => {
    for (const language of [
      ...DASHBOARD_LANGUAGES.filter((code: string): boolean => {
        return code !== "ar";
      }),
      "en",
    ]) {
      expect(wordAsWrittenIn(language, ".txt")).toBe(".txt");
      expect(wordAsWrittenIn(language, "browser.*")).toBe("browser.*");
    }
  });
});

describe("foldedArabic", () => {
  test("drops the definite article, so a noun in a construct is found", () => {
    // The Add Widget picker says "المؤشر"; the data source's gauge "مؤشر".
    expect(foldedArabic("مؤشر مصدر البيانات")).toContain(
      foldedArabic("المؤشر"),
    );
    // The list says "عملية التقصي"; Save as Hunt "كعملية تقصٍّ".
    expect(foldedArabic("حفظ كعملية تقصٍّ")).toContain(
      foldedArabic("عملية التقصي"),
    );
  });

  test("drops the article after a letter joined to it", () => {
    expect(foldedArabic("بالحادثة")).toBe(foldedArabic("بحادثة"));
    expect(foldedArabic("والتنبيهات")).toBe(foldedArabic("وتنبيهات"));
    expect(foldedArabic("كالمعتاد")).toBe(foldedArabic("كمعتاد"));
  });

  test("drops the marks over and under the letters", () => {
    expect(foldedArabic("محفّز")).toBe(foldedArabic("محفز"));
    expect(foldedArabic("محفّزًا")).toBe(foldedArabic("محفزا"));
  });

  test("writes back the ي an indefinite noun drops", () => {
    expect(foldedArabic("تقصٍّ")).toBe(foldedArabic("تقصّي"));
    expect(foldedArabic("قاضٍ")).toBe(foldedArabic("قاضي"));
    // Its shadda on either side of the tanween, and before a comma.
    expect(foldedArabic("تقصّ\u064D، ثم")).toBe(foldedArabic("تقصي، ثم"));
    // A tanween in the middle of a word, or another one, is only a mark.
    expect(foldedArabic("محفّزًا")).toBe("محفزا");
  });

  test("keeps a word that only starts like the article", () => {
    // "ألوان" (colours) starts with "أل", whose alef carries a hamza.
    expect(foldedArabic("ألوان")).not.toBe(foldedArabic("وان"));
    expect(foldedArabic("ألوان").length).toBe(5);
  });

  test("leaves Latin words alone", () => {
    expect(foldedArabic("OpenTelemetry Collector")).toBe(
      "OpenTelemetry Collector",
    );
  });
});

describe("the translated languages", () => {
  test("every app offers Arabic, and none lists English", () => {
    for (const languages of [
      DASHBOARD_LANGUAGES,
      ADMIN_DASHBOARD_LANGUAGES,
      ACCOUNTS_LANGUAGES,
      STATUS_PAGE_LANGUAGES,
    ]) {
      expect(languages).toContain("ar");
      expect(languages).toContain("fa");
      expect(languages).not.toContain("en");
    }
  });

  test("the docs have no Arabic yet (#6466), and every docs language is the Dashboard's", () => {
    expect(DOCS_LANGUAGES).not.toContain("ar");
    expect(DOCS_LANGUAGES).not.toContain("en");

    for (const language of DOCS_LANGUAGES) {
      expect(DASHBOARD_LANGUAGES).toContain(language);
    }
  });
});
