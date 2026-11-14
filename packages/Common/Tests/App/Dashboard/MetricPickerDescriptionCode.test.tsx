// UX rule: Docs/ux/README.md#help-text
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import MetricPickerDescription, {
  getMetricDescriptionParts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricPickerDescription";
import KubernetesMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMetricPicker";
import OpenStackMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMetricPicker";
import VMwareMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMetricPicker";
import { LEFT_TO_RIGHT_ISOLATE } from "../../../Types/CodeInSentence";
import { getAllKubernetesMetrics } from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  getAllOpenStackMetrics,
  getOpenStackMetricById,
} from "../../../Types/Monitor/OpenStackMetricCatalog";
import { getAllVMwareMetrics } from "../../../Types/Monitor/VMwareMetricCatalog";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * A METRIC'S DESCRIPTION UNDER ITS PICKER DRAWS ITS CODE AS CODE (#7883).
 *
 * The VMware, OpenStack and Kubernetes catalogs write what a reader types in
 * backticks: the datapoint attribute a series is fanned out by, a filter, a
 * metric's name. Their pickers drew the description as plain text, so the
 * backticks showed under the dropdown in fifty descriptions. Each picker
 * draws the line through MetricPickerDescription now, which draws each
 * backticked part as code: every one of those descriptions is drawn here,
 * with no backtick left and each name in a <code>.
 *
 * In Arabic and Persian each piece of code reads from the left. The line is
 * laid out as a page read from the right lays it out (Tests/Helpers/
 * BidiLayout), with each element that has a dir as the isolate the browser
 * makes of it. A catalog's description is English on every page today, so
 * its code reads from the left inside it; a description worded in the
 * page's own language puts its code among words read from the right, and
 * there a flag's dashes read at its other end ("help--"). Drawn without the
 * code-in-sentence rules (a sentence asked for before they arrive is handed
 * back as written, CodeReadsAsWritten), it is MetricPickerDescription's own
 * isolate that keeps the flag as written: laid out without it - the
 * negative control - the same line draws it the wrong way round.
 */

const LINE_TEST_ID: string = "metric-picker-description";

const LINE_TEMPLATE: string = "{{description}} — Metric: {{metric}}";

// The parts of a description between backticks, read on their own.
const BACKTICKED_REGEX: RegExp = /`([^`]+)`/g;

const backtickedParts: (description: string) => Array<string> = (
  description: string,
): Array<string> => {
  return Array.from(
    description.matchAll(BACKTICKED_REGEX),
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

const withoutBackticks: (text: string) => string = (text: string): string => {
  return text.split("`").join("");
};

interface CatalogMetric {
  id: string;
  description: string;
  metricName: string;
}

interface PickerCase {
  name: string;
  metrics: Array<CatalogMetric>;
  draw: (metricId: string) => ReactElement;
}

const doNothing: () => void = (): void => {};

const PICKERS: Array<PickerCase> = [
  {
    name: "VMware",
    metrics: getAllVMwareMetrics(),
    draw: (metricId: string): ReactElement => {
      return (
        <VMwareMetricPicker
          selectedMetricId={metricId}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "OpenStack",
    metrics: getAllOpenStackMetrics(),
    draw: (metricId: string): ReactElement => {
      return (
        <OpenStackMetricPicker
          selectedMetricId={metricId}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Kubernetes",
    metrics: getAllKubernetesMetrics(),
    draw: (metricId: string): ReactElement => {
      return (
        <KubernetesMetricPicker
          selectedMetricId={metricId}
          onMetricSelected={doNothing}
        />
      );
    },
  },
];

const metricsWithCode: (picker: PickerCase) => Array<CatalogMetric> = (
  picker: PickerCase,
): Array<CatalogMetric> => {
  return picker.metrics.filter((metric: CatalogMetric): boolean => {
    return metric.description.includes("`");
  });
};

/*
 * A description in the page's own language whose code has signs at its
 * ends: each locale's own sentence, from the Dashboard's locale files, with
 * the flag it names written as code, as a catalog writes it.
 */
interface WordedDescription {
  english: string;
  flag: string;
}

const WORDED_DESCRIPTIONS: Record<string, WordedDescription> = {
  ar: {
    english:
      "Counted per region. Per project, these come from Neutron's quotas, which the agent leaves off: delete the --disable-metric=neutron-quota_network line from the exporter to see them.",
    flag: "--disable-metric=neutron-quota_network",
  },
  fa: {
    english:
      "Every command the CLI has for these. Add --help to any of them for its flags.",
    flag: "--help",
  },
};

const LOCALES: Record<string, Record<string, unknown>> = {
  ar: arabicLocale as Record<string, unknown>,
  fa: persianLocale as Record<string, unknown>,
};

const asCode: (sentence: string, flag: string) => string = (
  sentence: string,
  flag: string,
): string => {
  return sentence.split(flag).join(`\`${flag}\``);
};

const describedInEnglish: (language: string) => string = (
  language: string,
): string => {
  const worded: WordedDescription = WORDED_DESCRIPTIONS[
    language
  ] as WordedDescription;

  return asCode(worded.english, worded.flag);
};

const describedInLanguage: (language: string) => string = (
  language: string,
): string => {
  const worded: WordedDescription = WORDED_DESCRIPTIONS[
    language
  ] as WordedDescription;
  const sentence: unknown = (LOCALES[language] as Record<string, unknown>)[
    worded.english
  ];

  if (typeof sentence !== "string" || !sentence.includes(worded.flag)) {
    throw new Error(
      `${language}.json no longer words "${worded.english}" with ${worded.flag} in it: borrow another of the Dashboard's sentences that names a flag.`,
    );
  }

  return asCode(sentence, worded.flag);
};

// Each locale file, with the worded descriptions as keys of their own.
const resources: () => Record<
  string,
  { translation: Record<string, unknown> }
> = (): Record<string, { translation: Record<string, unknown> }> => {
  return {
    en: { translation: englishLocale as Record<string, unknown> },
    ar: {
      translation: {
        ...(arabicLocale as Record<string, unknown>),
        [describedInEnglish("ar")]: describedInLanguage("ar"),
      },
    },
    fa: {
      translation: {
        ...(persianLocale as Record<string, unknown>),
        [describedInEnglish("fa")]: describedInLanguage("fa"),
      },
    },
  };
};

// As the Dashboard sets i18next up (Utils/i18n.ts): its post-processors set code apart.
const dashboardI18n: i18n = createInstance();
// Without them: a sentence handed back as written, before the rules arrive.
const rulesNotYetHereI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("ar");
  await dashboardI18n
    .use(productNamePostProcessor)
    .use(codeReadsAsWrittenPostProcessor)
    .init({
      lng: "en",
      fallbackLng: "en",
      postProcess: getTranslationPostProcess(),
      resources: resources(),
      interpolation: { escapeValue: false },
    });
  await rulesNotYetHereI18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: resources(),
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

const drawIn: (
  language: string,
  element: ReactElement,
  instance?: i18n,
) => HTMLElement = (
  language: string,
  element: ReactElement,
  instance: i18n = dashboardI18n,
): HTMLElement => {
  void instance.changeLanguage(language);
  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);

  return screen.getByTestId(LINE_TEST_ID);
};

const codesIn: (line: HTMLElement) => Array<HTMLElement> = (
  line: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(line.querySelectorAll("code"));
};

interface CodeInLine {
  text: string;
  from: number;
  to: number;
}

interface LaidOutLine {
  text: string;
  codes: Array<CodeInLine>;
}

/*
 * The line an element's text makes, as the browser lays it out: the
 * isolates' marks a sentence holds are in its text, and an element with a
 * dir is an isolate of its own (the HTML stylesheet's unicode-bidi:
 * isolate), LRI for ltr, FSI for auto. With `withElementIsolates` false,
 * every element is laid out as plain text: a <code> with no dir.
 */
const layOut: (
  root: HTMLElement,
  withElementIsolates: boolean,
) => LaidOutLine = (
  root: HTMLElement,
  withElementIsolates: boolean,
): LaidOutLine => {
  const laidOut: LaidOutLine = { text: "", codes: [] };

  const walk: (node: Node) => void = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      laidOut.text += node.textContent || "";
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element: Element = node as Element;
    const dir: string | null = withElementIsolates
      ? element.getAttribute("dir")
      : null;

    if (dir) {
      laidOut.text +=
        dir === "ltr" ? LEFT_TO_RIGHT_ISOLATE : FIRST_STRONG_ISOLATE;
    }

    const from: number = laidOut.text.length;

    element.childNodes.forEach(walk);

    if (element.tagName === "CODE") {
      laidOut.codes.push({
        text: element.textContent || "",
        from: from,
        to: laidOut.text.length,
      });
    }

    if (dir) {
      laidOut.text += POP_DIRECTIONAL_ISOLATE;
    }
  };

  walk(root);

  return laidOut;
};

// Whether each piece of code is drawn as it is written, on a page read from the right.
const codesDrawnAsWritten: (laidOut: LaidOutLine) => Array<boolean> = (
  laidOut: LaidOutLine,
): Array<boolean> => {
  const drawn: DrawnLine = drawLine(laidOut.text, "rtl");

  return laidOut.codes.map((code: CodeInLine): boolean => {
    return isDrawnAsWritten(drawn, code.from, code.to);
  });
};

describe("getMetricDescriptionParts", () => {
  test("cuts a description at its backticks: code between each pair, words around", () => {
    expect(
      getMetricDescriptionParts(
        "Fanned out by the `status` attribute; filter `status = red`.",
      ),
    ).toEqual([
      { text: "Fanned out by the ", isCode: false },
      { text: "status", isCode: true },
      { text: " attribute; filter ", isCode: false },
      { text: "status = red", isCode: true },
      { text: ".", isCode: false },
    ]);
  });

  test("keeps code at either end, with no empty words beside it", () => {
    expect(
      getMetricDescriptionParts("`direction` is receive or transmit"),
    ).toEqual([
      { text: "direction", isCode: true },
      { text: " is receive or transmit", isCode: false },
    ]);
    expect(getMetricDescriptionParts("Filter on `disk_state`")).toEqual([
      { text: "Filter on ", isCode: false },
      { text: "disk_state", isCode: true },
    ]);
  });

  test("leaves a text with no backtick, or backticks that do not pair, as words", () => {
    expect(getMetricDescriptionParts("Number of datastores.")).toEqual([
      { text: "Number of datastores.", isCode: false },
    ]);
    expect(getMetricDescriptionParts("A `status and a `type` label.")).toEqual([
      { text: "A `status and a `type` label.", isCode: false },
    ]);
    expect(getMetricDescriptionParts("")).toEqual([]);
  });
});

describe.each(PICKERS)("the $name metric picker", (picker: PickerCase) => {
  const metrics: Array<CatalogMetric> = metricsWithCode(picker);

  test("has descriptions that write code in backticks", () => {
    expect(metrics.length).toBeGreaterThan(0);
  });

  test.each(
    metrics.map((metric: CatalogMetric): [string, CatalogMetric] => {
      return [metric.id, metric];
    }),
  )(
    "draws %s's code as code, with no backtick",
    (_id: string, metric: CatalogMetric) => {
      const line: HTMLElement = drawIn("en", picker.draw(metric.id));

      expect(line.textContent).not.toContain("`");
      expect(line.textContent).toBe(
        `${withoutBackticks(metric.description)} — Metric: ${metric.metricName}`,
      );
      expect(
        codesIn(line).map((code: HTMLElement): string => {
          return code.textContent || "";
        }),
      ).toEqual([...backtickedParts(metric.description), metric.metricName]);

      for (const code of codesIn(line)) {
        expect(code).toHaveAttribute("dir", "ltr");
      }
    },
  );

  describe.each(["ar", "fa"])("in %s", (language: string) => {
    const locale: Record<string, unknown> = LOCALES[language] as Record<
      string,
      unknown
    >;
    // What the language's line says between the description and the metric.
    const between: string = (locale[LINE_TEMPLATE] as string)
      .split("{{description}}")
      .join("")
      .split("{{metric}}")
      .join("");

    test.each(
      metrics.map((metric: CatalogMetric): [string, CatalogMetric] => {
        return [metric.id, metric];
      }),
    )(
      "draws %s's code as code, each piece read from the left",
      (_id: string, metric: CatalogMetric) => {
        const line: HTMLElement = drawIn(language, picker.draw(metric.id));
        const shown: string = withoutIsolates(line.textContent || "");

        expect(between.trim()).not.toBe("");
        expect(shown).toBe(
          `${withoutBackticks(metric.description)}${between}${metric.metricName}`,
        );
        expect(
          codesIn(line).map((code: HTMLElement): string => {
            return withoutIsolates(code.textContent || "");
          }),
        ).toEqual([...backtickedParts(metric.description), metric.metricName]);
        expect(codesDrawnAsWritten(layOut(line, true))).toEqual(
          codesIn(line).map((): boolean => {
            return true;
          }),
        );
      },
    );
  });
});

describe("MetricPickerDescription", () => {
  const metricName: string = getOpenStackMetricById(
    "openstack-neutron-quota-network",
  )?.metricName as string;

  test("draws the metric's own name as code too", () => {
    const line: HTMLElement = drawIn(
      "en",
      <MetricPickerDescription
        description="A project's network quota."
        metricName={metricName}
      />,
    );

    expect(line.textContent).toBe(
      `A project's network quota. — Metric: ${metricName}`,
    );
    expect(codesIn(line).length).toBe(1);
    expect(codesIn(line)[0]).toHaveTextContent(metricName);
    expect(codesIn(line)[0]).toHaveAttribute("dir", "ltr");
  });

  describe.each(["ar", "fa"])(
    "with a description worded in %s",
    (language: string) => {
      const flag: string = (WORDED_DESCRIPTIONS[language] as WordedDescription)
        .flag;
      const backwards: string = `${flag.replace(/^-+/, "")}--`;

      test("draws its words and its code, with no backtick", () => {
        const line: HTMLElement = drawIn(
          language,
          <MetricPickerDescription
            description={describedInEnglish(language)}
            metricName={metricName}
          />,
        );

        expect(line.textContent).not.toContain("`");
        expect(withoutIsolates(line.textContent || "")).toContain(
          withoutBackticks(describedInLanguage(language)),
        );
        expect(withoutIsolates(codesIn(line)[0]?.textContent || "")).toBe(flag);
      });

      test("draws the flag as it is written, as the Dashboard sets its words up", () => {
        const line: HTMLElement = drawIn(
          language,
          <MetricPickerDescription
            description={describedInEnglish(language)}
            metricName={metricName}
          />,
        );
        const laidOut: LaidOutLine = layOut(line, true);

        expect(codesDrawnAsWritten(laidOut)).toEqual([true, true]);
        expect(getDrawnText(drawLine(laidOut.text, "rtl"))).not.toContain(
          backwards,
        );
      });

      test("draws the flag as it is written before the code-in-sentence rules arrive: its own isolate keeps it so", () => {
        const line: HTMLElement = drawIn(
          language,
          <MetricPickerDescription
            description={describedInEnglish(language)}
            metricName={metricName}
          />,
          rulesNotYetHereI18n,
        );

        // Handed back as written: no mark of the rules' in the flag.
        expect(codesIn(line)[0]?.textContent).toBe(flag);

        const laidOut: LaidOutLine = layOut(line, true);

        expect(codesDrawnAsWritten(laidOut)).toEqual([true, true]);
        expect(getDrawnText(drawLine(laidOut.text, "rtl"))).not.toContain(
          backwards,
        );

        // The negative control: the same line with its code laid out as plain text.
        const asText: LaidOutLine = layOut(line, false);

        expect(codesDrawnAsWritten(asText)[0]).toBe(false);
        expect(getDrawnText(drawLine(asText.text, "rtl"))).toContain(backwards);
      });
    },
  );
});
