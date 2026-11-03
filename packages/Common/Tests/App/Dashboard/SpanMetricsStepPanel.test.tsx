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
import SpanMetricsStepPanel from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepPanel";
import {
  SPAN_METRICS_STEP_COPY,
  SPAN_METRICS_STEP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepCopy";
import { DOCS_URL } from "../../../UI/Config";
import {
  SEND_THROUGH_COLLECTOR_DOCS_PATH,
  SPAN_METRICS_COLLECTOR_STEP,
  SPAN_METRICS_DOCS_PATH,
} from "../../../Utils/Metrics/SpanMetricsCollectorStep";

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
  jest.spyOn(console, "error").mockImplementation((...parts: Array<unknown>) => {
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
    expect(first).toHaveTextContent(SPAN_METRICS_STEP_COPY.addStepDescription);
    expect(second).toHaveTextContent(SPAN_METRICS_STEP_COPY.restartTitle);
    expect(second).toHaveTextContent(
      SPAN_METRICS_STEP_COPY.restartDescription,
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

    expect(GERMAN[SPAN_METRICS_STEP_COPY.panelTitle]).toBe(
      "Ohne Codeänderung",
    );
    expect(panel).toHaveTextContent(
      GERMAN[SPAN_METRICS_STEP_COPY.panelTitle]!,
    );
    expect(panel).toHaveTextContent(
      GERMAN[SPAN_METRICS_STEP_COPY.panelDescription]!,
    );

    const dialog: HTMLElement = openDialog();

    for (const words of [
      SPAN_METRICS_STEP_COPY.modalTitle,
      SPAN_METRICS_STEP_COPY.addStepTitle,
      SPAN_METRICS_STEP_COPY.addStepDescription,
      SPAN_METRICS_STEP_COPY.restartTitle,
      SPAN_METRICS_STEP_COPY.restartDescription,
      SPAN_METRICS_STEP_COPY.noCollector,
      SPAN_METRICS_STEP_COPY.noCollectorLink,
      SPAN_METRICS_STEP_COPY.learnMore,
    ]) {
      expect(document.body).toHaveTextContent(GERMAN[words]!);
      expect(document.body).not.toHaveTextContent(words);
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

    for (const step of [1, 2]) {
      const description: HTMLElement = within(dialog)
        .getByTestId(`setup-guide-step-${step}`)
        .querySelector("p") as HTMLElement;

      // Its metric names are Latin letters, most of its letters Persian.
      expect(description).toHaveAttribute("dir", "rtl");
    }

    expect(
      within(dialog).getByTestId("setup-guide-step-2"),
    ).toHaveTextContent(PERSIAN[SPAN_METRICS_STEP_COPY.restartDescription]!);
    expect(screen.getByTestId(SPAN_METRICS_STEP_TEST_IDS.code)).toHaveAttribute(
      "dir",
      "ltr",
    );
  });
});
