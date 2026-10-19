import { describe, expect, test } from "@jest/globals";
import {
  formatCompactDurationInMinutes,
  getCompactDurationParts,
} from "../../FeatureSet/Dashboard/src/Utils/CompactDuration";
import fs from "fs";
import path from "path";

/*
 * The Security Overview's timing tiles (Mean Time to Acknowledge, Contain,
 * Close) say their durations in the reader's language: "51 min" and
 * "4 h 24 min" in English, as they always have, "4 ч 24 мин" in Russian,
 * "4 時間 24 分" in Japanese - not English unit names on a translated page.
 */
describe("formatCompactDurationInMinutes", () => {
  test("English keeps the overview's own text, word for word", () => {
    expect(formatCompactDurationInMinutes(51, "en")).toBe("51 min");
    expect(formatCompactDurationInMinutes(264, "en")).toBe("4 h 24 min");
    expect(formatCompactDurationInMinutes(240, "en-GB")).toBe("4 h");
    expect(formatCompactDurationInMinutes(24 * 60 * 3 + 300, "en")).toBe(
      "3 d 5 h",
    );
    expect(formatCompactDurationInMinutes(51, undefined)).toBe("51 min");
  });

  test("no value is a dash in every language", () => {
    expect(formatCompactDurationInMinutes(null, "de")).toBe("—");
    expect(formatCompactDurationInMinutes(Number.NaN, "ru")).toBe("—");
  });

  test("other languages use their own short unit names, the two largest units", () => {
    expect(formatCompactDurationInMinutes(264, "ru")).toBe("4 ч 24 мин");
    expect(formatCompactDurationInMinutes(51, "ru")).toBe("51 мин");
    expect(formatCompactDurationInMinutes(264, "ja")).toBe("4 時間 24 分");
    expect(formatCompactDurationInMinutes(264, "ko")).toBe("4시간 24분");

    // German: hours and minutes by their German abbreviations.
    const german: string = formatCompactDurationInMinutes(264, "de");
    expect(german).toContain("4 Std.");
    expect(german).toContain("24 Min.");
    expect(german).not.toContain(" h ");

    // Days and hours, never a third unit.
    const russianDays: string = formatCompactDurationInMinutes(
      24 * 60 * 3 + 300 + 7,
      "ru",
    );
    expect(russianDays).toContain("3");
    expect(russianDays).toContain("5 ч");
    expect(russianDays).not.toContain("мин");
  });

  test("its parts are the two largest units the English names", () => {
    expect(getCompactDurationParts(0)).toEqual([{ count: 0, unit: "minute" }]);
    expect(getCompactDurationParts(59.6)).toEqual([{ count: 1, unit: "hour" }]);
    expect(getCompactDurationParts(264)).toEqual([
      { count: 4, unit: "hour" },
      { count: 24, unit: "minute" },
    ]);
    expect(getCompactDurationParts(24 * 60 * 2 + 59)).toEqual([
      { count: 2, unit: "day" },
    ]);
  });

  test("the overview's three timing tiles say their durations this way", () => {
    const overview: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "SecurityEvents",
        "Overview.tsx",
      ),
      "utf8",
    );

    expect(overview).not.toContain("formatDurationInMinutes(");
    expect(overview.split("formatCompactDurationInMinutes(").length - 1).toBe(
      3,
    );
  });
});
