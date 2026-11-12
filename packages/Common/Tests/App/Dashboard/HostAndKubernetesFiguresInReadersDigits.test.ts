import { afterEach, describe, expect, test } from "@jest/globals";
import {
  setDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { Translator } from "../../../Types/Translator";
import {
  formatHostBytes,
  formatHostUsagePercent,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/HostFacts";
import KubernetesResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils";
import { formatKubernetesCount } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCount";
import {
  formatCost,
  formatEfficiency,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils";
import {
  formatCpuValue,
  formatMemoryValue,
  writeCountInReaderDigits,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import {
  figureInSentence,
  withSentenceDigits,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/SentenceDigits";
import {
  formatHostLoad,
  formatHostPercent,
} from "../../../Types/Host/HostHealth";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A HOST'S AND A KUBERNETES CLUSTER'S FIGURES, IN THE READER'S DIGITS
 * (issue #7106).
 *
 * A figure standing on its own - a tile's "97.5%", a cell's "16 GiB", a
 * pod's "0.4%", a Deployment's "2/3" - was written with toFixed or as the
 * raw number, so a Persian page put Latin digits beside the Persian ones
 * of its sentences ("فعال در ۳۹ از ۴۰ نمونه" over "97.5%"). Each formatter
 * writes the number in the reader's digits, decimal sign and percent sign
 * now, keeping its rounding and its unit: "۹۷٫۵٪", "۱۶ GiB", "97,5 %" in
 * German, Latin digits in Arabic. English reads exactly as before - each
 * English case below is what the formatter wrote before the change.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

const ARABIC_INDIC_DIGIT: RegExp = /[\u0660-\u0669]/;

const KIB: number = 1024;
const MIB: number = 1024 * KIB;
const GIB: number = 1024 * MIB;

afterEach(() => {
  setDateDisplayLanguage("en");
});

function inLanguage<T>(language: string, work: () => T): T {
  return withDateDisplayLanguage(language, work);
}

// Each formatter, with the figures it is handed and what English reads.
type FormatterCase = [string, () => string, string];

const ENGLISH_CASES: Array<FormatterCase> = [
  [
    "formatHostUsagePercent(0)",
    () => {
      return formatHostUsagePercent(0);
    },
    "0%",
  ],
  [
    "formatHostUsagePercent(4.25)",
    () => {
      return formatHostUsagePercent(4.25);
    },
    "4.3%",
  ],
  [
    "formatHostUsagePercent(9.94)",
    () => {
      return formatHostUsagePercent(9.94);
    },
    "9.9%",
  ],
  [
    "formatHostUsagePercent(97.5)",
    () => {
      return formatHostUsagePercent(97.5);
    },
    "98%",
  ],
  [
    "formatHostUsagePercent(100)",
    () => {
      return formatHostUsagePercent(100);
    },
    "100%",
  ],
  [
    "formatHostBytes(512)",
    () => {
      return formatHostBytes(512);
    },
    "512 B",
  ],
  [
    "formatHostBytes(1023)",
    () => {
      return formatHostBytes(1023);
    },
    "1023 B",
  ],
  [
    "formatHostBytes(1.5 KiB)",
    () => {
      return formatHostBytes(1.5 * KIB);
    },
    "1.5 KiB",
  ],
  [
    "formatHostBytes(16 GiB)",
    () => {
      return formatHostBytes(16 * GIB);
    },
    "16 GiB",
  ],
  [
    "formatHostBytes(9.96 GiB)",
    () => {
      return formatHostBytes(9.96 * GIB);
    },
    "10.0 GiB",
  ],
  [
    "Kubernetes formatCpuValue(0.4)",
    () => {
      return KubernetesResourceUtils.formatCpuValue(0.4);
    },
    "0.4%",
  ],
  [
    "Kubernetes formatCpuValue(12.345)",
    () => {
      return KubernetesResourceUtils.formatCpuValue(12.345);
    },
    "12.3%",
  ],
  [
    "Kubernetes formatMemoryValue(512)",
    () => {
      return KubernetesResourceUtils.formatMemoryValue(512);
    },
    "512 B",
  ],
  [
    "Kubernetes formatMemoryValue(2 KiB)",
    () => {
      return KubernetesResourceUtils.formatMemoryValue(2 * KIB);
    },
    "2.0 KB",
  ],
  [
    "Kubernetes formatMemoryValue(512 MiB)",
    () => {
      return KubernetesResourceUtils.formatMemoryValue(512 * MIB);
    },
    "512.0 MB",
  ],
  [
    "Kubernetes formatMemoryValue(3 GiB)",
    () => {
      return KubernetesResourceUtils.formatMemoryValue(3 * GIB);
    },
    "3.00 GB",
  ],
  [
    "formatKubernetesCount(3)",
    () => {
      return formatKubernetesCount(3);
    },
    "3",
  ],
  [
    "ResourceTable formatCpuValue(55.55)",
    () => {
      return formatCpuValue(55.55);
    },
    "55.5%",
  ],
  [
    "ResourceTable formatMemoryValue(471 MiB)",
    () => {
      return formatMemoryValue(471 * MIB);
    },
    "471.0 MB",
  ],
  [
    "formatCost(1234.5)",
    () => {
      return formatCost(1234.5);
    },
    "$1,234.50",
  ],
  [
    "formatCost(0.001)",
    () => {
      return formatCost(0.001);
    },
    "$0.0010",
  ],
  [
    "formatCost(12, EUR)",
    () => {
      return formatCost(12, "EUR");
    },
    "EUR 12.00",
  ],
  [
    "formatEfficiency(0.873)",
    () => {
      return formatEfficiency(0.873);
    },
    "87%",
  ],
];

describe("in English, every figure reads exactly as before", () => {
  test.each(ENGLISH_CASES)(
    "%s reads as it always has",
    (_name: string, write: () => string, english: string) => {
      expect(inLanguage("en", write)).toBe(english);
      // An English variant of the reader's language reads the same.
      expect(inLanguage("en-GB", write)).toBe(english);
    },
  );

  test("no figure, no number: the dashes and N/A stay", () => {
    expect(formatHostBytes(null)).toBe("—");
    expect(KubernetesResourceUtils.formatCpuValue(null)).toBe("N/A");
    expect(KubernetesResourceUtils.formatMemoryValue(null)).toBe("N/A");
    expect(formatKubernetesCount(undefined)).toBe("N/A");
    expect(formatKubernetesCount(null)).toBe("N/A");
    expect(formatKubernetesCount("Unknown")).toBe("Unknown");
    expect(formatEfficiency(null)).toBe("-");
  });
});

describe("in Persian, every figure is in Persian digits, with the same rounding", () => {
  test.each(ENGLISH_CASES)(
    "%s",
    (_name: string, write: () => string, english: string) => {
      const persian: string = inLanguage("fa", write);

      expect({ persian, latin: LATIN_DIGIT.test(persian) }).toEqual({
        persian,
        latin: false,
      });
      expect(persian).toMatch(PERSIAN_DIGIT);
      // The same figure: Persian's digits, decimal sign and percent sign back to English's.
      expect(toEnglishFigure(persian)).toBe(toEnglishFigure(english));
    },
  );

  test("the figures a Persian page draws", () => {
    inLanguage("fa", () => {
      expect(formatHostUsagePercent(4.25)).toBe("۴٫۳٪");
      expect(formatHostUsagePercent(97.5)).toBe("۹۸٪");
      expect(formatHostBytes(16 * GIB)).toBe("۱۶ GiB");
      expect(formatHostBytes(1023)).toBe("۱٬۰۲۳ B");
      expect(KubernetesResourceUtils.formatCpuValue(0.4)).toBe("۰٫۴٪");
      expect(KubernetesResourceUtils.formatMemoryValue(512 * MIB)).toBe(
        "۵۱۲٫۰ MB",
      );
      expect(formatKubernetesCount(12)).toBe("۱۲");
      expect(formatEfficiency(0.873)).toBe("۸۷٪");
    });
  });
});

/*
 * Persian's figure written back in English's marks: its digits, its
 * decimal and thousands signs, its percent sign, and Intl's marks around a
 * currency, so the two can be compared for the same rounding.
 */
function toEnglishFigure(text: string): string {
  const PERSIAN_ZERO: number = 0x06f0;
  let out: string = "";

  for (const char of text) {
    const code: number = char.codePointAt(0) || 0;

    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (char === "٫") {
      out += ".";
    } else if (char === "٬" || char === ",") {
      // A thousands sign: English's "1023 B" groups no digits.
    } else if (char === "٪") {
      out += "%";
    } else if (char === "\u{200E}" || char === "\u{00A0}" || char === " ") {
      // Intl's direction mark and spaces around a currency.
    } else {
      out += char;
    }
  }

  // Intl writes the euro and the dollar with their signs, English with the code.
  return out.replace("US$", "$").replace("€", "EUR");
}

describe("in German and Arabic", () => {
  test("German writes its decimal comma, its thousands point and its percent", () => {
    inLanguage("de", () => {
      expect(formatHostUsagePercent(4.25)).toBe("4,3\u{00A0}%");
      expect(formatHostBytes(1023)).toBe("1.023 B");
      expect(formatHostBytes(1.5 * KIB)).toBe("1,5 KiB");
      expect(KubernetesResourceUtils.formatMemoryValue(3 * GIB)).toBe(
        "3,00 GB",
      );
      expect(formatCost(1234.5)).toBe("1.234,50\u{00A0}$");
      expect(formatEfficiency(0.873)).toBe("87\u{00A0}%");
    });
  });

  test("Arabic writes Latin digits, never Arabic-Indic ones", () => {
    inLanguage("ar", () => {
      for (const [name, write] of ENGLISH_CASES) {
        const text: string = write();

        expect({ name, arabicIndic: ARABIC_INDIC_DIGIT.test(text) }).toEqual({
          name,
          arabicIndic: false,
        });
        expect({ name, persian: PERSIAN_DIGIT.test(text) }).toEqual({
          name,
          persian: false,
        });
      }
    });
  });
});

describe("a count column's value: 3, or ready out of desired", () => {
  const persian: Translator = dashboardTranslator("fa");
  const english: Translator = dashboardTranslator("en");

  test.each([
    ["2/3", "۲/۳", "2/3"],
    ["12", "۱۲", "12"],
    ["0/0", "۰/۰", "0/0"],
    ["1200", "۱٬۲۰۰", "1,200"],
  ])(
    "%p reads %p in Persian, %p in English",
    (value: string, fa: string, en: string) => {
      expect(writeCountInReaderDigits(value, persian)).toBe(fa);
      expect(writeCountInReaderDigits(value, english)).toBe(en);
    },
  );

  test.each(["-", "N/A", "", "1.5", "2/3/4", "v2", "3 pods", "-1"])(
    "anything that is not a count stays as written: %p",
    (value: string) => {
      expect(writeCountInReaderDigits(value, persian)).toBe(value);
    },
  );
});

describe("an uptime's figure in its sentence takes the sentence's language", () => {
  const uptime: (translator: Translator, percent: number) => string = (
    translator: Translator,
    percent: number,
  ): string => {
    return withoutIsolateMarks(
      translator.translateTemplate("{{percent}}% uptime", {
        percent: figureInSentence(percent, {
          decimals: percent >= 99.95 ? 1 : 2,
        }),
      }),
    );
  };

  test("Persian, German and English", () => {
    expect(uptime(dashboardTranslator("fa"), 99.5)).toBe("۹۹٫۵۰٪ در دسترس");
    expect(uptime(dashboardTranslator("de"), 99.5)).toBe("99,50 % verfügbar");
    expect(uptime(dashboardTranslator("en"), 99.5)).toBe("99.50% uptime");
    expect(uptime(dashboardTranslator("en"), 99.99)).toBe("100.0% uptime");
  });

  test("a sentence the reader's language has not worded yet reads in English, its figure too", () => {
    const fallback: string = withoutIsolateMarks(
      dashboardTranslator("fa").translateTemplate(
        "{{percent}} of a sentence no locale has",
        { percent: figureInSentence(12.5, { decimals: 1 }) },
      ),
    );

    expect(fallback).toBe("12.5 of a sentence no locale has");
  });

  test("the page's own language does not leak into a sentence's figure", () => {
    // A Persian page, a German sentence: German's comma.
    inLanguage("fa", () => {
      expect(uptime(dashboardTranslator("de"), 99.5)).toBe("99,50 % verfügbar");
    });
  });
});

/*
 * A REASON'S PERCENTAGE AND DECIMALS, IN THE SENTENCE'S DIGITS.
 *
 * A host's rules write their values as plain figures ("96%", "9.6"), and
 * the Needs attention card, the hosts list and the hero drew them as
 * written: a Persian page read "/var 96% پر" under the Filesystem tile's
 * "۹۶٫۴٪", and German "/var zu 96% voll" beside the tile's "96,4 %".
 * withSentenceDigits writes a percentage or a figure with decimals in the
 * sentence's language now, as it writes a whole number, keeping the
 * decimals it was written with. Each case fills a sentence as the Needs
 * attention card does.
 */
describe("a reason's percentage and decimals take the sentence's language", () => {
  const LOAD_ON_CORES: { one: string; other: string } = {
    one: "15-minute load {{load}} on {{count}} core",
    other: "15-minute load {{load}} on {{count}} cores",
  };

  const filled: (
    translator: Translator,
    template: string,
    values: Record<string, string>,
  ) => string = (
    translator: Translator,
    template: string,
    values: Record<string, string>,
  ): string => {
    return withoutIsolateMarks(
      translator.translateTemplate(template, withSentenceDigits(values), {
        setsValuesApart: true,
      }),
    );
  };

  const full: (translator: Translator) => string = (
    translator: Translator,
  ): string => {
    return filled(translator, "{{mount}} {{percent}} full", {
      mount: "/var",
      percent: formatHostPercent(96.4),
    });
  };

  const loaded: (translator: Translator, cores: number) => string = (
    translator: Translator,
    cores: number,
  ): string => {
    return withoutIsolateMarks(
      translator.translatePlural(
        LOAD_ON_CORES,
        cores,
        withSentenceDigits({ load: formatHostLoad(9.62) }),
        { setsValuesApart: true },
      ),
    );
  };

  test("Persian writes Persian digits, its decimal sign and its percent sign", () => {
    expect(full(dashboardTranslator("fa"))).toBe("/var ۹۶٪ پر");
    expect(loaded(dashboardTranslator("fa"), 4)).toBe(
      "بار ۱۵ دقیقه‌ای ۹٫۶ روی ۴ هسته",
    );
  });

  test("German writes its decimal comma and its spaced percent", () => {
    expect(full(dashboardTranslator("de"))).toBe("/var zu 96 % voll");
    expect(loaded(dashboardTranslator("de"), 4)).toBe(
      "15-Minuten-Last 9,6 auf 4 Kernen",
    );
  });

  test("English reads exactly as the rules wrote it", () => {
    expect(full(dashboardTranslator("en"))).toBe("/var 96% full");
    expect(loaded(dashboardTranslator("en"), 1)).toBe(
      "15-minute load 9.6 on 1 core",
    );
  });

  test("Arabic writes Latin digits, never Arabic-Indic ones", () => {
    const arabic: string = full(dashboardTranslator("ar"));

    expect(ARABIC_INDIC_DIGIT.test(arabic)).toBe(false);
    // Intl's own left-to-right marks keep "96%" in its order.
    expect(arabic.replace(/‎/g, "")).toBe("/var ممتلئ بنسبة 96%");
  });

  test("a figure keeps the decimals it was written with", () => {
    const persian: Translator = dashboardTranslator("fa");
    const german: Translator = dashboardTranslator("de");

    expect(filled(persian, "{{percent}} full", { percent: "4.20%" })).toBe(
      "۴٫۲۰٪ پر",
    );
    expect(filled(persian, "{{percent}} full", { percent: "100%" })).toBe(
      "۱۰۰٪ پر",
    );
    expect(filled(german, "{{percent}} full", { percent: "0.5%" })).toBe(
      "0,5 % voll",
    );
  });

  test("a value that is not a plain figure is drawn as written", () => {
    const persian: Translator = dashboardTranslator("fa");

    for (const value of [
      "10.0.1.21",
      "1.29.3",
      "500m",
      "12 GiB",
      "OOMKilled",
      "-5%",
      "96 %",
      ".5",
      "5.",
      "1e3",
    ]) {
      expect({
        value,
        drawn: filled(persian, "{{percent}} full", { percent: value }),
      }).toEqual({ value, drawn: `${value} پر` });
    }
  });

  test("a sentence the reader's language has not worded yet reads in English, its figure too", () => {
    expect(
      filled(
        dashboardTranslator("fa"),
        "{{percent}} of a sentence no locale has",
        { percent: "96%" },
      ),
    ).toBe("96% of a sentence no locale has");
  });
});
