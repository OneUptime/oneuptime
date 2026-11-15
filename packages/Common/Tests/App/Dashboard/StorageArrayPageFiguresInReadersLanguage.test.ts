// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import i18next from "i18next";
import StorageArrayResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  formatIops as formatWidgetIops,
  formatLatencyUsec as formatWidgetLatencyUsec,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE STORAGE ARRAYS PAGES' FIGURES, IN THE READER'S DIGITS (#8272).
 *
 * A dashboard's storage widgets wrote a volume's size, latency and IOPS
 * in the reader's digits (#7521), and the Storage Arrays pages those cells
 * open wrote the same figures with toFixed: a Persian reader who clicked
 * "۳٫۵ TiB" landed on a page that said "3.5 TiB". Each figure a page
 * writes is in the reader's digits, decimal sign and percent sign now,
 * the page's language when no translator is handed in (a list column's
 * getElement), English exactly as it always read.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

const TIB: number = 1024 ** 4;
const GIB: number = 1024 ** 3;

function spaced(text: string): string {
  return withoutIsolateMarks(text).replace(/[\u00a0\u202f]/g, " ");
}

// Every figure a Storage Arrays page writes, through the translator given.
function figures(translator?: Translator): Array<string> {
  const u: typeof StorageArrayResourceUtils = StorageArrayResourceUtils;

  return [
    u.formatBytes(512, translator),
    u.formatBytes(3.5 * TIB, translator),
    u.formatBytes(200 * GIB, translator),
    u.formatBytesPerSec(1.2 * GIB, translator),
    u.formatPercent(92.4, translator),
    u.formatCount(1234, translator),
    u.formatCount(2_500_000, translator),
    u.formatCount(42, translator),
    u.formatIops(0.5, translator),
    u.formatIops(12500, translator),
    u.formatLatencyUsec(245.4, translator),
    u.formatLatencyUsec(2350, translator),
    u.formatRatio(4.24, translator),
    u.formatTemperature(27.4, translator),
  ].map(spaced);
}

const ENGLISH: Array<string> = [
  "512 B",
  "3.5 TiB",
  "200 GiB",
  "1.2 GiB/s",
  "92.4%",
  "1.2K",
  "2.5M",
  "42",
  "0.5/s",
  "12.5K/s",
  "245 µs",
  "2.35 ms",
  "4.2:1",
  "27 °C",
];

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the Storage Arrays pages' figures", () => {
  test("English reads exactly as it always did, with a translator or none", () => {
    expect(figures()).toEqual(ENGLISH);
    expect(figures(dashboardTranslator("en"))).toEqual(ENGLISH);
  });

  test("German: a decimal comma, its own percent sign and units", () => {
    expect(figures(dashboardTranslator("de"))).toEqual([
      "512 B",
      "3,5 TiB",
      "200 GiB",
      "1,2 GiB/s",
      "92,4 %",
      "1,2K",
      "2,5M",
      "42",
      "0,5/s",
      "12,5K/s",
      "245 μs",
      "2,35 ms",
      "4,2:1",
      "27 °C",
    ]);
  });

  test("Persian: no Latin digit in any figure", () => {
    for (const figure of figures(dashboardTranslator("fa"))) {
      expect(figure).toMatch(PERSIAN_DIGIT);
      expect(figure).not.toMatch(LATIN_DIGIT);
    }
    expect(figures(dashboardTranslator("fa"))[1]).toBe("۳٫۵ TiB");
    expect(figures(dashboardTranslator("fa"))[12]).toBe("۴٫۲:۱");
  });

  test("Arabic: Latin digits, as the product writes them in Arabic", () => {
    const arabic: Array<string> = figures(dashboardTranslator("ar"));

    expect(arabic[1]).toBe("3.5 TiB");
    expect(arabic[5]).toBe("1.2K");
  });

  test("a page's column, handed no translator, writes the page's language", async () => {
    await i18next.changeLanguage("fa");

    for (const figure of figures()) {
      expect(figure).not.toMatch(LATIN_DIGIT);
    }

    await i18next.changeLanguage("de");

    expect(spaced(StorageArrayResourceUtils.formatBytes(3.5 * TIB))).toBe(
      "3,5 TiB",
    );
  });

  test("a volume reads the same on the dashboard widget and on its page", () => {
    const fa: Translator = dashboardTranslator("fa");

    expect(spaced(StorageArrayResourceUtils.formatLatencyUsec(2350, fa))).toBe(
      spaced(formatWidgetLatencyUsec(2350, fa)),
    );
    expect(StorageArrayResourceUtils.formatIops(12500, fa)).not.toMatch(
      LATIN_DIGIT,
    );
    expect(formatWidgetIops(12500, fa)).not.toMatch(LATIN_DIGIT);
  });

  test("two figures in one cell are each set apart on a page read from the right", () => {
    const fa: Translator = dashboardTranslator("fa");
    const joined: string = StorageArrayResourceUtils.joinFiguresOfACell(
      [
        StorageArrayResourceUtils.formatBytesPerSec(1536, fa),
        StorageArrayResourceUtils.formatBytesPerSec(2048, fa),
      ],
      fa,
    );

    expect(joined).toContain(" / ");
    // Each figure is isolated, so its unit stays after its number.
    expect(joined).toMatch(/[⁦-⁨]/);
    expect(withoutIsolateMarks(joined)).toBe("۱٫۵ KiB/s / ۲٫۰ KiB/s");
    // In English the cell reads as it always did.
    expect(
      StorageArrayResourceUtils.joinFiguresOfACell(
        ["1.5 KiB/s", "2.0 KiB/s"],
        dashboardTranslator("en"),
      ),
    ).toBe("1.5 KiB/s / 2.0 KiB/s");
  });

  test("what is not a figure reads as a missing one", () => {
    const fa: Translator = dashboardTranslator("fa");

    expect(StorageArrayResourceUtils.formatBytes(null, fa)).toBe("—");
    expect(StorageArrayResourceUtils.formatPercent(Number.NaN, fa)).toBe("—");
    expect(StorageArrayResourceUtils.formatRatio(undefined, fa)).toBe("—");
    expect(StorageArrayResourceUtils.formatTemperature(null, fa)).toBe("—");
    expect(StorageArrayResourceUtils.formatIops(undefined, fa)).toBe("—");
  });
});
