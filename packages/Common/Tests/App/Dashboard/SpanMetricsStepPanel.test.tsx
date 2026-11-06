import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import SpanMetricsStepPanel, {
  SPAN_METRICS_STEP_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepPanel";
import {
  SPAN_METRICS_STEP_COPY,
  SPAN_METRICS_STEP_NAMES,
  SPAN_METRICS_STEP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepCopy";
import { DOCS_URL } from "../../../UI/Config";
import {
  SEND_THROUGH_COLLECTOR_DOCS_PATH,
  SPAN_METRICS_CALLS_METRIC,
  SPAN_METRICS_COLLECTOR_STEP,
  SPAN_METRICS_CONNECTOR,
  SPAN_METRICS_DOCS_PATH,
  SPAN_METRICS_DURATION_METRIC,
  SPAN_METRICS_ONEUPTIME_EXPORTER,
  SPAN_METRICS_PROCESSOR,
  SPAN_METRICS_RECEIVER,
} from "../../../Utils/Metrics/SpanMetricsCollectorStep";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * "Without changing code" on a Missing Metrics or Missing Request Metrics
 * finding (SpanMetricsStepPanel): one sentence and one button in the
 * finding's rail, and the collector's span metrics step in a dialog - the
 * lines to add, in the numbered steps every setup guide uses, what a
 * service that sends straight to OneUptime does first, and the docs. The
 * finding page decides when it is offered (AIInsightViewMetricFix); this
 * suite pins what it says and does, in English, German and Persian.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const GERMAN: Record<string, string> = readLocale("de");
const PERSIAN: Record<string, string> = readLocale("fa");

// Every language the Dashboard is translated into.
const JSON_EXTENSION: string = ".json";
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(JSON_EXTENSION) && file !== "en.json";
  })
  .map((file: string): string => {
    return file.slice(0, -JSON_EXTENSION.length);
  });

// A step's sentence, the template with the names it draws as code, by slot.
type StepSentenceCase = [string, Readonly<Record<string, string>>, string];

const STEP_SENTENCES: Array<StepSentenceCase> = [
  [
    SPAN_METRICS_STEP_COPY.addStepDescription,
    SPAN_METRICS_STEP_NAMES.addStep,
    SPAN_METRICS_STEP_TEST_IDS.addSentence,
  ],
  [
    SPAN_METRICS_STEP_COPY.restartDescription,
    SPAN_METRICS_STEP_NAMES.restart,
    SPAN_METRICS_STEP_TEST_IDS.restartSentence,
  ],
];

/*
 * A step's sentence as it reads with its names in it - what the dialog
 * draws, the names as code - from the template in a language's words.
 */
function filled(
  template: string,
  names: Readonly<Record<string, string>>,
): string {
  let sentence: string = template;

  for (const [slot, name] of Object.entries(names)) {
    sentence = sentence.split(`{{${slot}}}`).join(name);
  }

  return sentence;
}

// The names a sentence draws as code, in the order it draws them.
function codeNames(sentence: HTMLElement): Array<string> {
  return Array.from(sentence.querySelectorAll("code")).map(
    (code: Element): string => {
      return code.textContent || "";
    },
  );
}

// The panel's words, and the dialog's, as the reader's language has them.
const WORDS: Array<string> = [
  SPAN_METRICS_STEP_COPY.panelTitle,
  SPAN_METRICS_STEP_COPY.panelDescription,
  SPAN_METRICS_STEP_COPY.showStep,
  SPAN_METRICS_STEP_COPY.modalTitle,
  SPAN_METRICS_STEP_COPY.modalDescription,
  SPAN_METRICS_STEP_COPY.addStepTitle,
  SPAN_METRICS_STEP_COPY.addStepDescription,
  SPAN_METRICS_STEP_COPY.restartTitle,
  SPAN_METRICS_STEP_COPY.restartDescription,
  SPAN_METRICS_STEP_COPY.noCollector,
  SPAN_METRICS_STEP_COPY.noCollectorLink,
  SPAN_METRICS_STEP_COPY.learnMore,
  SPAN_METRICS_STEP_COPY.close,
];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: GERMAN },
      fa: { translation: PERSIAN },
    },
    interpolation: { escapeValue: false },
  });
});

/*
 * React's DOM nesting warnings (a div inside a p, as the Icon draws one)
 * arrive as console errors: the panel and its dialog draw none.
 */
let consoleErrors: Array<string> = [];

beforeEach(() => {
  consoleErrors = [];
  jest
    .spyOn(console, "error")
    .mockImplementation((...parts: Array<unknown>) => {
      consoleErrors.push(parts.map(String).join(" "));
    });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  jest.restoreAllMocks();
  expect(
    consoleErrors.filter((message: string): boolean => {
      return message.includes("validateDOMNesting");
    }),
  ).toEqual([]);
});

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.show));

  return screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.modal);
}

function docsLink(docsPath: string): string {
  return `${DOCS_URL.toString()}${docsPath}`;
}

describe("the panel in a finding's rail", () => {
  test("one sentence and one button, and no dialog until it is asked for", () => {
    render(<SpanMetricsStepPanel />);

    const panel: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.panel,
    );

    expect(
      within(panel).getByRole("heading", {
        name: SPAN_METRICS_STEP_COPY.panelTitle,
      }),
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent(SPAN_METRICS_STEP_COPY.panelDescription);
    expect(
      within(panel).getByRole("button", {
        name: SPAN_METRICS_STEP_COPY.showStep,
      }),
    ).toBeInTheDocument();
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByTestId(SPAN_METRICS_STEP_TEST_IDS.modal),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("says whose metrics it records, and never promises the finding goes away by itself", () => {
    expect(SPAN_METRICS_STEP_COPY.panelDescription).toBe(
      "An OpenTelemetry Collector can record this service's request metrics from its traces.",
    );
    // A finding stays open until someone resolves it: the last step says so.
    expect(SPAN_METRICS_STEP_COPY.restartDescription).toMatch(
      /Then resolve this finding\.$/u,
    );
    expect(SPAN_METRICS_STEP_COPY.restartDescription).not.toMatch(
      /no longer finds/u,
    );
  });

  test("names the steps for what they add, never a step inside a step", () => {
    // "Step 1: Add the span metrics step" said step twice.
    expect(SPAN_METRICS_STEP_COPY.addStepTitle).toBe(
      "Add the span metrics connector",
    );
    expect(SPAN_METRICS_STEP_COPY.learnMore).toBe(
      "How the span metrics connector works",
    );

    for (const words of [
      SPAN_METRICS_STEP_COPY.addStepTitle,
      SPAN_METRICS_STEP_COPY.addStepDescription,
      SPAN_METRICS_STEP_COPY.restartTitle,
      SPAN_METRICS_STEP_COPY.restartDescription,
      SPAN_METRICS_STEP_COPY.learnMore,
    ]) {
      expect(words).not.toMatch(/\bstep\b/iu);
    }

    // The lines add a connector, as they say.
    expect(SPAN_METRICS_COLLECTOR_STEP.split("\n")[0]).toBe("connectors:");
  });
});

describe("the collector step's dialog", () => {
  test("names what it does, then the two steps in order: the lines to add, then a restart", () => {
    render(<SpanMetricsStepPanel />);

    const dialog: HTMLElement = openDialog();
    const modal: HTMLElement = screen.getByRole("dialog");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      SPAN_METRICS_STEP_COPY.modalTitle,
    );
    expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
      SPAN_METRICS_STEP_COPY.modalDescription,
    );

    const first: HTMLElement = within(dialog).getByTestId("setup-guide-step-1");
    const second: HTMLElement =
      within(dialog).getByTestId("setup-guide-step-2");

    expect(first).toHaveTextContent(SPAN_METRICS_STEP_COPY.addStepTitle);
    expect(first).toHaveTextContent(
      filled(
        SPAN_METRICS_STEP_COPY.addStepDescription,
        SPAN_METRICS_STEP_NAMES.addStep,
      ),
    );
    expect(second).toHaveTextContent(SPAN_METRICS_STEP_COPY.restartTitle);
    expect(second).toHaveTextContent(
      filled(
        SPAN_METRICS_STEP_COPY.restartDescription,
        SPAN_METRICS_STEP_NAMES.restart,
      ),
    );
    expect(
      within(dialog).queryByTestId("setup-guide-step-3"),
    ).not.toBeInTheDocument();

    // The lines to add are the first step's, not the second's.
    expect(
      within(first).getByTestId(SPAN_METRICS_STEP_TEST_IDS.code),
    ).toBeInTheDocument();
    expect(
      within(second).queryByTestId(SPAN_METRICS_STEP_TEST_IDS.code),
    ).not.toBeInTheDocument();
  });

  test("each step's sentence draws the collector's own names as code, as the lines to add write them", () => {
    render(<SpanMetricsStepPanel />);

    const dialog: HTMLElement = openDialog();
    const add: HTMLElement = within(dialog).getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.addSentence,
    );
    const restart: HTMLElement = within(dialog).getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.restartSentence,
    );

    // Only the connector is new: the receiver, processor and exporter are the reader's own.
    expect(codeNames(add)).toEqual([
      SPAN_METRICS_CONNECTOR,
      SPAN_METRICS_RECEIVER,
      SPAN_METRICS_PROCESSOR,
      SPAN_METRICS_ONEUPTIME_EXPORTER,
    ]);
    expect(codeNames(restart)).toEqual([
      SPAN_METRICS_CALLS_METRIC,
      SPAN_METRICS_DURATION_METRIC,
    ]);

    // Each name the first sentence draws is one the lines write.
    for (const name of codeNames(add)) {
      expect(SPAN_METRICS_COLLECTOR_STEP).toContain(name);
    }

    for (const sentence of [add, restart]) {
      for (const code of Array.from(sentence.querySelectorAll("code"))) {
        expect(code.className).toBe(SPAN_METRICS_STEP_NAME_CLASS_NAME);
      }
    }

    // Each sentence is its step's, the first one before the lines to add.
    expect(within(dialog).getByTestId("setup-guide-step-1")).toContainElement(
      add,
    );
    expect(within(dialog).getByTestId("setup-guide-step-2")).toContainElement(
      restart,
    );
    expect(
      add.compareDocumentPosition(
        within(dialog).getByTestId(SPAN_METRICS_STEP_TEST_IDS.code),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("it opens on itself, not on its first link, and Tab still reaches the links and the copy button", () => {
    render(<SpanMetricsStepPanel />);

    const show: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.show,
    );

    show.focus();
    fireEvent.click(show);

    /*
     * The Enter that opened it, held a moment too long, would otherwise
     * open its first link's docs in a new tab.
     */
    const collectorDocs: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.collectorDocs,
    );

    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(collectorDocs).not.toHaveFocus();

    for (const reachable of [
      collectorDocs,
      within(screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.code)).getByRole(
        "button",
        { name: /copy/iu },
      ),
      screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.docs),
    ]) {
      expect(reachable).not.toHaveAttribute("tabindex", "-1");
    }
  });

  test("the lines to add are the step exactly, left to right, with a copy button", () => {
    render(<SpanMetricsStepPanel />);
    openDialog();

    const code: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.code,
    );

    expect(code).toHaveAttribute("dir", "ltr");
    expect(code.querySelector("code")?.textContent).toBe(
      SPAN_METRICS_COLLECTOR_STEP,
    );
    expect(
      within(code).getByRole("button", { name: /copy/iu }),
    ).toBeInTheDocument();
  });

  test("what a service that sends straight to OneUptime does first comes before the steps, with the docs that say how", () => {
    render(<SpanMetricsStepPanel />);

    const dialog: HTMLElement = openDialog();
    const first: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.noCollector,
    );

    expect(first).toHaveTextContent(SPAN_METRICS_STEP_COPY.noCollector);
    expect(
      first.compareDocumentPosition(
        within(dialog).getByTestId("setup-guide-step-1"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const collectorDocs: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.collectorDocs,
    );

    expect(collectorDocs).toHaveTextContent(
      SPAN_METRICS_STEP_COPY.noCollectorLink,
    );
    expect(collectorDocs).toHaveAttribute(
      "href",
      docsLink(SEND_THROUGH_COLLECTOR_DOCS_PATH),
    );
    expect(collectorDocs).toHaveAttribute("target", "_blank");
  });

  test("ends with the docs on the step, in a new tab", () => {
    render(<SpanMetricsStepPanel />);
    openDialog();

    const docs: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.docs,
    );

    expect(docs).toHaveTextContent(SPAN_METRICS_STEP_COPY.learnMore);
    expect(docs).toHaveAttribute("href", docsLink(SPAN_METRICS_DOCS_PATH));
    expect(docs).toHaveAttribute("target", "_blank");
  });

  test("Close, the corner's close and Escape each close it, and the button opens it again", () => {
    render(<SpanMetricsStepPanel />);

    openDialog();
    fireEvent.click(
      within(screen.getByTestId("modal-footer")).getByRole("button", {
        name: SPAN_METRICS_STEP_COPY.close,
      }),
    );
    expect(
      screen.queryByTestId(SPAN_METRICS_STEP_TEST_IDS.modal),
    ).not.toBeInTheDocument();

    openDialog();
    fireEvent.click(screen.getByTestId("close-button"));
    expect(
      screen.queryByTestId(SPAN_METRICS_STEP_TEST_IDS.modal),
    ).not.toBeInTheDocument();

    openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId(SPAN_METRICS_STEP_TEST_IDS.modal),
    ).not.toBeInTheDocument();

    // The panel stays where it was.
    expect(
      screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.panel),
    ).toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  test.each([["de"], ["fa"]])(
    "every word of the panel and the dialog is translated in %s",
    (language: string) => {
      const locale: Record<string, string> =
        language === "de" ? GERMAN : PERSIAN;

      for (const words of WORDS) {
        expect(typeof locale[words]).toBe("string");
        expect(locale[words]).not.toBe(words);
      }
    },
  );

  test("in German the panel and its dialog read German, and the lines to add are left as written", async () => {
    await readIn("de");
    render(<SpanMetricsStepPanel />);

    const panel: HTMLElement = screen.getByTestId(
      SPAN_METRICS_STEP_TEST_IDS.panel,
    );

    expect(GERMAN[SPAN_METRICS_STEP_COPY.panelTitle]).toBe("Ohne Codeänderung");
    expect(panel).toHaveTextContent(GERMAN[SPAN_METRICS_STEP_COPY.panelTitle]!);
    expect(panel).toHaveTextContent(
      GERMAN[SPAN_METRICS_STEP_COPY.panelDescription]!,
    );

    const dialog: HTMLElement = openDialog();

    for (const words of [
      SPAN_METRICS_STEP_COPY.modalTitle,
      SPAN_METRICS_STEP_COPY.addStepTitle,
      SPAN_METRICS_STEP_COPY.restartTitle,
      SPAN_METRICS_STEP_COPY.noCollector,
      SPAN_METRICS_STEP_COPY.noCollectorLink,
      SPAN_METRICS_STEP_COPY.learnMore,
    ]) {
      expect(document.body).toHaveTextContent(GERMAN[words]!);
      expect(document.body).not.toHaveTextContent(words);
    }

    // The sentences read German, the collector's names in them as written.
    for (const [template, names, testId] of STEP_SENTENCES) {
      const sentence: HTMLElement = within(dialog).getByTestId(testId);

      expect(sentence).toHaveTextContent(filled(GERMAN[template]!, names));
      expect(sentence).not.toHaveTextContent(filled(template, names));
      expect([...codeNames(sentence)].sort()).toEqual(
        Object.values(names).sort(),
      );
      expect(sentence).toHaveAttribute("dir", "ltr");
    }

    expect(
      within(dialog)
        .getByTestId(SPAN_METRICS_STEP_TEST_IDS.code)
        .querySelector("code")?.textContent,
    ).toBe(SPAN_METRICS_COLLECTOR_STEP);
    expect(
      within(screen.getByTestId("modal-footer")).getByRole("button", {
        name: GERMAN[SPAN_METRICS_STEP_COPY.close]!,
      }),
    ).toBeInTheDocument();
  });

  test("on a Persian page each step's sentence reads right to left, and the lines to add left to right", async () => {
    await readIn("fa");
    render(
      <div dir="rtl">
        <SpanMetricsStepPanel />
      </div>,
    );

    const dialog: HTMLElement = openDialog();

    STEP_SENTENCES.forEach(
      ([template, names, testId]: StepSentenceCase, index: number): void => {
        const sentence: HTMLElement = within(dialog).getByTestId(testId);

        // Each step's first paragraph is its sentence, read right to left.
        expect(
          within(dialog)
            .getByTestId(`setup-guide-step-${index + 1}`)
            .querySelector("p"),
        ).toBe(sentence);
        expect(sentence).toHaveAttribute("dir", "rtl");
        expect(withoutIsolateMarks(sentence.textContent || "")).toBe(
          filled(PERSIAN[template]!, names),
        );

        /*
         * Its Latin names are set apart from the Persian words around them,
         * so no comma or full stop jumps across one.
         */
        expect(sentence.textContent).not.toBe(
          withoutIsolateMarks(sentence.textContent || ""),
        );
        expect([...codeNames(sentence)].sort()).toEqual(
          Object.values(names).sort(),
        );
      },
    );

    expect(screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.code)).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a sentence a right-to-left language has no words for yet reads English, left to right", async () => {
    // Arabic reads right to left, and the Dashboard has no words of its own in it.
    i18next.addResourceBundle("ar", "translation", {}, true, true);
    await readIn("ar");
    render(
      <div dir="rtl">
        <SpanMetricsStepPanel />
      </div>,
    );

    const dialog: HTMLElement = openDialog();

    for (const [template, names, testId] of STEP_SENTENCES) {
      const sentence: HTMLElement = within(dialog).getByTestId(testId);

      expect(sentence).toHaveAttribute("dir", "ltr");
      expect(withoutIsolateMarks(sentence.textContent || "")).toBe(
        filled(template, names),
      );
    }
  });

  test("every language keeps each name of a step's sentence once, or its reader would get English", () => {
    expect(LANGUAGES).toHaveLength(16);

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const [template, names] of STEP_SENTENCES) {
        const translated: string = locale[template] || "";

        expect([language, translated.length > 0]).toEqual([language, true]);
        expect([language, translated === template]).toEqual([language, false]);

        for (const slot of Object.keys(names)) {
          expect([
            language,
            slot,
            translated.split(`{{${slot}}}`).length,
          ]).toEqual([language, slot, 2]);
        }

        // No name is written into the words in place of its placeholder.
        for (const name of Object.values(names)) {
          expect([language, name, translated.includes(name)]).toEqual([
            language,
            name,
            false,
          ]);
        }
      }
    }
  });
});
