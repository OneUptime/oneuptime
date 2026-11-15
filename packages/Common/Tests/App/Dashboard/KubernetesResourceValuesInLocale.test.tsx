import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import KubernetesContainersTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesContainersTab";
import {
  formatK8sResourceValue,
  KUBERNETES_CPU_CORES,
  KubernetesResourceReading,
  readKubernetesResourceValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceQuantity";
import { KubernetesContainerSpec } from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CONTAINER'S REQUESTS AND LIMITS IN THE READER'S WORDS (issue #7304).
 *
 * A pod's and a workload's Containers tab lists each container's requests
 * and limits as Kubernetes writes them, and says what they mean: "250m
 * (0.25 CPU cores)", "512Mi (512 MB)". The meaning was built by hand in
 * English with toFixed, so a German, Persian or Arabic page showed an
 * English phrase and English decimals inside a translated table. It is a
 * translated plural for CPU and a size in the reader's digits for memory
 * now, Kubernetes' own value kept as written and set apart. English reads
 * as it did.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const LATIN_LETTER: RegExp = /[A-Za-z]/;

const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

const english: (key: string, value: string) => string = (
  key: string,
  value: string,
): string => {
  return formatK8sResourceValue(key, value, dashboardTranslator("en"));
};

const inLanguage: (language: string, key: string, value: string) => string = (
  language: string,
  key: string,
  value: string,
): string => {
  return withoutIsolateMarks(
    formatK8sResourceValue(key, value, dashboardTranslator(language)),
  );
};

/*
 * What the tab wrote before, by hand: kept here only as the negative
 * control, to show the hand-built text fails the German and Persian cases.
 */
const handBuiltCpu: (millis: number) => string = (millis: number): string => {
  return `${millis}m (${(millis / 1000).toFixed(2)} CPU cores)`;
};

describe("formatK8sResourceValue in English, as the tab always wrote it", () => {
  test.each([
    ["cpu", "250m", "250m (0.25 CPU cores)"],
    ["cpu", "1500m", "1500m (1.5 CPU cores)"],
    ["cpu", "2", "2 (2 CPU cores)"],
    ["cpu", "1", "1 (1 CPU core)"],
    ["CPU", "4", "4 (4 CPU cores)"],
    ["memory", "512Mi", "512Mi (512 MB)"],
    ["memory", "256Mi", "256Mi (256 MB)"],
    ["memory", "1536Mi", "1536Mi (1.5 GB)"],
    ["memory", "500Ki", "500Ki (0.49 MB)"],
    ["memory", "2048Ki", "2048Ki (2.0 MB)"],
    ["memory", "2Gi", "2Gi (2 GB)"],
    ["memory", "1Ti", "1Ti (1 TB)"],
    ["ephemeral-storage", "10G", "10G (10 GB)"],
    ["ephemeral-storage", "1500M", "1500M (1.5 GB)"],
    ["ephemeral-storage", "500M", "500M (500 MB)"],
    ["ephemeral-storage", "500K", "500K (0.50 MB)"],
    ["ephemeral-storage", "2T", "2T (2 TB)"],
  ])("%s %s reads %p", (key: string, value: string, text: string) => {
    expect(english(key, value)).toBe(text);
  });

  test("a value it cannot read, or none, is drawn as written with nothing beside it", () => {
    expect(english("cpu", "0.5")).toBe("0.5");
    expect(english("cpu", "1e3")).toBe("1e3");
    expect(english("memory", "1.5Gi")).toBe("1.5Gi");
    expect(english("cpu", "")).toBe("");
    // "250m" is CPU only: a memory of 250 millibytes is no core count.
    expect(english("memory", "250m")).toBe("250m");
    expect(english("nvidia.com/gpu", "1")).toBe("1");
  });

  /*
   * Decided with the fix: a millicore is a thousandth of a core, so the
   * cores are exact to three decimals, and one core is "1 CPU core".
   */
  test("cores are exact: 125m is 0.125, 500m is 0.5, 1000m is one core", () => {
    expect(english("cpu", "125m")).toBe("125m (0.125 CPU cores)");
    expect(english("cpu", "500m")).toBe("500m (0.5 CPU cores)");
    expect(english("cpu", "100m")).toBe("100m (0.1 CPU cores)");
    expect(english("cpu", "5m")).toBe("5m (0.005 CPU cores)");
    expect(english("cpu", "1000m")).toBe("1000m (1 CPU core)");
  });
});

describe("formatK8sResourceValue in the reader's language", () => {
  test("German: its decimal comma and its own words", () => {
    expect(inLanguage("de", "cpu", "250m")).toBe("250m (0,25 CPU-Kerne)");
    expect(inLanguage("de", "cpu", "1")).toBe("1 (1 CPU-Kern)");
    expect(inLanguage("de", "cpu", "2")).toBe("2 (2 CPU-Kerne)");
    expect(inLanguage("de", "memory", "1536Mi")).toBe("1536Mi (1,5 GB)");
    expect(inLanguage("de", "memory", "500Ki")).toBe("500Ki (0,49 MB)");
    expect(inLanguage("de", "cpu", "250m")).not.toContain("CPU cores");
  });

  test("Persian: Persian digits and no English word in what it means", () => {
    const reading: KubernetesResourceReading = readKubernetesResourceValue({
      key: "cpu",
      value: "250m",
      translator: dashboardTranslator("fa"),
    });

    // Kubernetes' own value, as written.
    expect(reading.quantity).toBe("250m");
    expect(reading.meaning).toBe("۰٫۲۵ هستهٔ پردازنده");
    expect(reading.meaning).not.toMatch(LATIN_DIGIT);
    expect(reading.meaning).not.toMatch(LATIN_LETTER);

    expect(inLanguage("fa", "cpu", "2")).toBe("2 (۲ هستهٔ پردازنده)");
    // A size keeps its unit as written, its figure in Persian digits.
    expect(inLanguage("fa", "memory", "1536Mi")).toBe("1536Mi (۱٫۵ GB)");
    expect(inLanguage("fa", "memory", "512Mi")).toBe("512Mi (۵۱۲ MB)");
  });

  test("Arabic: Latin digits, its label-and-count form for any count", () => {
    expect(inLanguage("ar", "cpu", "250m")).toBe("250m (أنوية CPU: 0.25)");
    expect(inLanguage("ar", "cpu", "1")).toBe("1 (1 نواة CPU)");
    expect(inLanguage("ar", "cpu", "8")).toBe("8 (أنوية CPU: 8)");
  });

  test("French says a quarter of a core in its 'one' form, as French does", () => {
    expect(inLanguage("fr", "cpu", "250m")).toBe("250m (0,25 cœur CPU)");
    expect(inLanguage("fr", "cpu", "2")).toBe("2 (2 cœurs CPU)");
  });

  test("every language writes the cores' figure as it writes numbers", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const reading: KubernetesResourceReading = readKubernetesResourceValue({
        key: "cpu",
        value: "250m",
        translator: dashboardTranslator(language),
      });

      expect({
        language,
        hasFigure: withoutIsolateMarks(reading.meaning || "").includes(
          dashboardTranslator(language).formatNumber(0.25),
        ),
      }).toEqual({ language, hasFigure: true });
    }
  });

  test("the negative control: the hand-built English fails the German and Persian cases", () => {
    const handBuilt: string = handBuiltCpu(250);

    expect(handBuilt).toBe(english("cpu", "250m"));
    expect(handBuilt).not.toBe(inLanguage("de", "cpu", "250m"));
    expect(handBuilt).not.toBe(inLanguage("fa", "cpu", "250m"));
    expect(handBuilt).toContain("0.25");
    expect(inLanguage("fa", "cpu", "250m")).toMatch(PERSIAN_DIGIT);
  });
});

describe("the CPU cores sentence in every Dashboard language", () => {
  const englishWords: Record<string, string> = readDashboardLocale("en");

  test("is a key of en.json, with its one form", () => {
    expect(englishWords[KUBERNETES_CPU_CORES.other]).toBe(
      "{{count}} CPU cores",
    );
    expect(englishWords[`${KUBERNETES_CPU_CORES.other}_one`]).toBe(
      "{{count}} CPU core",
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words both forms, each keeping its count once",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        KUBERNETES_CPU_CORES.other,
        `${KUBERNETES_CPU_CORES.other}_one`,
      ]) {
        const worded: string | undefined = words[key];

        expect({ language, key, worded: typeof worded }).toEqual({
          language,
          key,
          worded: "string",
        });
        expect(worded).not.toBe(englishWords[key]);
        expect((worded as string).split("{{count}}").length - 1).toBe(1);
      }
    },
  );

  test("the negative control: an English value left in a locale would be caught", () => {
    const leftInEnglish: Record<string, string> = {
      ...readDashboardLocale("de"),
      [KUBERNETES_CPU_CORES.other]: "{{count}} CPU cores",
    };

    expect(leftInEnglish[KUBERNETES_CPU_CORES.other]).toBe(
      englishWords[KUBERNETES_CPU_CORES.other],
    );
  });
});

/*
 * The tab drawn: each value's two parts set apart, so on a Persian page
 * Kubernetes' "250m" reads left to right and what it means right to left.
 */
const CONTAINER: KubernetesContainerSpec = {
  name: "app",
  image: "nginx:1.27",
  command: [],
  args: [],
  env: [],
  ports: [],
  resources: {
    requests: { cpu: "250m", memory: "512Mi" },
    limits: { cpu: "2", memory: "1536Mi" },
  },
  volumeMounts: [],
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

interface DrawnValue {
  text: string;
  quantity: string;
  quantityDirection: string | null;
  meaning: string;
  meaningDirection: string | null;
}

const drawValues: (language: string) => Array<DrawnValue> = (
  language: string,
): Array<DrawnValue> => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <KubernetesContainersTab containers={[CONTAINER]} initContainers={[]} />
    </I18nextProvider>,
  );

  return screen
    .getAllByTestId("kubernetes-resource-value")
    .map((value: HTMLElement): DrawnValue => {
      const quantity: HTMLElement | null = value.querySelector(
        '[data-testid="kubernetes-resource-quantity"]',
      );
      const meaning: Element | null = value.querySelector(
        '[data-testid="kubernetes-resource-meaning"] bdi',
      );

      return {
        text: withoutIsolateMarks(value.textContent || ""),
        quantity: quantity?.textContent || "",
        quantityDirection: quantity?.getAttribute("dir") || null,
        meaning: withoutIsolateMarks(meaning?.textContent || ""),
        meaningDirection: meaning?.getAttribute("dir") || null,
      };
    });
};

describe("the Containers tab, drawn", () => {
  test("in English, every request and limit as it read", () => {
    expect(
      drawValues("en").map((value: DrawnValue): string => {
        return value.text;
      }),
    ).toEqual([
      "250m (0.25 CPU cores)",
      "512Mi (512 MB)",
      "2 (2 CPU cores)",
      "1536Mi (1.5 GB)",
    ]);
  });

  test("in German, with German's words and decimal comma", () => {
    expect(
      drawValues("de").map((value: DrawnValue): string => {
        return value.text;
      }),
    ).toEqual([
      "250m (0,25 CPU-Kerne)",
      "512Mi (512 MB)",
      "2 (2 CPU-Kerne)",
      "1536Mi (1,5 GB)",
    ]);
  });

  test("in Persian, Kubernetes' value reads left to right, the cores right to left in Persian digits", () => {
    const values: Array<DrawnValue> = drawValues("fa");

    expect(values[0]).toEqual({
      text: "250m (۰٫۲۵ هستهٔ پردازنده)",
      quantity: "250m",
      quantityDirection: "ltr",
      meaning: "۰٫۲۵ هستهٔ پردازنده",
      meaningDirection: "rtl",
    });

    // A size keeps its unit after its figure: "۵۱۲ MB", never "MB ۵۱۲".
    expect(values[1]).toEqual({
      text: "512Mi (۵۱۲ MB)",
      quantity: "512Mi",
      quantityDirection: "ltr",
      meaning: "۵۱۲ MB",
      meaningDirection: "ltr",
    });

    for (const value of values) {
      expect(value.meaning).not.toMatch(LATIN_DIGIT);
      expect(value.meaning).toMatch(PERSIAN_DIGIT);
    }
  });

  test("in Arabic, the cores read right to left beside Kubernetes' own value", () => {
    const values: Array<DrawnValue> = drawValues("ar");

    expect(values[0]!.quantityDirection).toBe("ltr");
    expect(values[0]!.meaning).toBe("أنوية CPU: 0.25");
    expect(values[0]!.meaningDirection).toBe("rtl");
  });

  /*
   * The Restarts card beside the requests: a count, in the reader's digits
   * as the cores are - a Persian card read "12" beside "۰٫۲۵".
   */
  test.each([
    ["en", "12"],
    ["de", "12"],
    ["ar", "12"],
    ["fa", "۱۲"],
  ])(
    "in %s, the restarts are counted in the reader's digits: %s",
    (language: string, restarts: string) => {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <KubernetesContainersTab
            containers={[CONTAINER]}
            initContainers={[]}
            containerStatuses={[
              {
                name: "app",
                ready: true,
                restartCount: 12,
                state: "running",
                reason: "",
                image: "nginx:1.27",
              },
            ]}
          />
        </I18nextProvider>,
      );

      expect(screen.getByText(restarts)).toBeInTheDocument();

      if (language === "fa") {
        expect(screen.queryByText("12")).toBeNull();
      }
    },
  );

  test("a value with nothing to add draws Kubernetes' value alone", () => {
    render(
      <I18nextProvider i18n={instances["fa"]!}>
        <KubernetesContainersTab
          containers={[
            {
              ...CONTAINER,
              resources: { requests: { cpu: "0.5" }, limits: {} },
            },
          ]}
          initContainers={[]}
        />
      </I18nextProvider>,
    );

    const value: HTMLElement = screen.getByTestId("kubernetes-resource-value");

    expect(value.textContent).toBe("0.5");
    expect(
      value.querySelector('[data-testid="kubernetes-resource-meaning"]'),
    ).toBeNull();
  });
});
