import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormSummary from "../../../../UI/Components/Forms/FormSummary";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * A STEPPED FORM COUNTS ITS STEPS IN THE READER'S DIGITS (#7933).
 *
 * Below the large-screen breakpoint a form with steps says where the reader
 * is - "Step 1 of 2" - in place of the step list beside it. Its sentence was
 * translated, its figures were not: a plain number goes into a sentence as
 * String() writes it, so a Persian create dialog on a phone read
 * "مرحله 1 از 2" beside Persian digits everywhere else on the page. The
 * figures are the translator's now (formatNumber): Persian digits in
 * Persian, Latin ones in Arabic (OneUptime writes Arabic in Latin digits,
 * Locales/ARABIC.md) and in every other language.
 *
 * The review's "File 2", for a file with nothing else to name it by, is
 * counted the same way.
 *
 * i18next is set up once for this file, from the Dashboard's shipped locale
 * files, as the Dashboard sets it up; each jest file has its own module
 * registry, so it reaches no other suite.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

/*
 * Steps whose titles hold no digit, so a digit in the line is the count's.
 * Each step has one optional field, so Next walks on without a value.
 */
function stepsOf(count: number): Array<FormStep<JSONObject>> {
  const titles: ReadonlyArray<string> = [
    "Details",
    "Settings",
    "Advanced",
    "Review",
    "Summary",
  ];

  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return {
      title: titles[index % titles.length] as string,
      id: `step-${index}`,
    };
  });
}

function fieldsFor(steps: Array<FormStep<JSONObject>>): Fields<JSONObject> {
  return steps.map((step: FormStep<JSONObject>, index: number) => {
    return {
      field: { [`field${index}`]: true },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      stepId: step.id,
    };
  });
}

function renderSteppedForm(stepCount: number): void {
  const steps: Array<FormStep<JSONObject>> = stepsOf(stepCount);

  render(
    <BasicForm
      id="step-count-form"
      fields={fieldsFor(steps)}
      steps={steps}
      onSubmit={() => {}}
      submitButtonText="Create"
      disableAutofocus={true}
    />,
  );
}

// The narrow screen's line: "Step 1 of 2", the step's title under it.
async function stepLine(): Promise<HTMLElement> {
  const words: Record<string, string> = readDashboardLocale(
    i18next.language,
  ) as Record<string, string>;
  const template: string =
    words["Step {{current}} of {{total}}"] || "Step {{current}} of {{total}}";
  const opening: string = template.split("{{current}}")[0] as string;

  return waitFor(() => {
    const line: HTMLElement | undefined = screen
      .getAllByRole("status")
      .find((element: HTMLElement): boolean => {
        return (element.textContent || "").startsWith(opening);
      });

    expect(line).toBeDefined();

    return line as HTMLElement;
  });
}

// The count alone: the line without the step's title under it.
async function countOnLine(): Promise<string> {
  const line: HTMLElement = await stepLine();
  const title: string =
    line.querySelector("span")?.textContent || "this has no title";

  return withoutIsolateMarks(
    (line.textContent || "").slice(
      0,
      (line.textContent || "").length - title.length,
    ),
  );
}

async function goNext(): Promise<void> {
  const words: Record<string, string> = readDashboardLocale(
    i18next.language,
  ) as Record<string, string>;

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: words["Next"] || "Next" }),
    );
  });
}

describe("the step a reader is on, counted in their digits", () => {
  test("Persian: the first of two steps reads ۱ of ۲", async () => {
    await readIn("fa");
    renderSteppedForm(2);

    expect(await countOnLine()).toBe("مرحله ۱ از ۲");
  });

  test("Persian: Next moves the count to ۲ of ۲", async () => {
    await readIn("fa");
    renderSteppedForm(2);
    await stepLine();
    await goNext();

    await waitFor(async () => {
      expect(await countOnLine()).toBe("مرحله ۲ از ۲");
    });
  });

  test("Persian: a form of twelve steps writes both figures of ۱۲", async () => {
    await readIn("fa");
    renderSteppedForm(12);

    expect(await countOnLine()).toBe("مرحله ۱ از ۱۲");
  });

  test("Persian: no Latin digit anywhere on the line", async () => {
    await readIn("fa");
    renderSteppedForm(3);

    const line: HTMLElement = await stepLine();

    expect(line.textContent).not.toMatch(LATIN_DIGIT);
    expect(line.textContent).toMatch(PERSIAN_DIGIT);
  });

  test("Arabic keeps Latin digits, in its own words", async () => {
    await readIn("ar");
    renderSteppedForm(2);

    expect(await countOnLine()).toBe("الخطوة 1 من 2");
  });

  test("German keeps Latin digits, in its own words", async () => {
    await readIn("de");
    renderSteppedForm(2);

    expect(await countOnLine()).toBe("Schritt 1 von 2");
  });

  test("English reads as it always did", async () => {
    renderSteppedForm(2);

    expect(await countOnLine()).toBe("Step 1 of 2");
  });

  test("English: twelve steps, no thousands mark or other change", async () => {
    renderSteppedForm(12);

    expect(await countOnLine()).toBe("Step 1 of 12");
  });

  test.each(["en", "de", "ar"])(
    "%s: no Persian or Arabic-Indic digit on the line",
    async (language: string) => {
      await readIn(language);
      renderSteppedForm(3);

      const text: string = (await stepLine()).textContent || "";

      expect(text).not.toMatch(PERSIAN_DIGIT);
      expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
      expect(text).toMatch(LATIN_DIGIT);
    },
  );

  test("the check would find a Latin digit in a Persian line", () => {
    expect(LATIN_DIGIT.test("مرحله 1 از 2")).toBe(true);
    expect(LATIN_DIGIT.test("مرحله ۱ از ۲")).toBe(false);
  });
});

describe("the review's unnamed file, numbered in the reader's digits", () => {
  function renderFiles(files: Array<JSONObject>): void {
    render(
      <FormSummary<JSONObject>
        formValues={{ attachments: files } as FormValues<JSONObject>}
        formFields={[
          {
            field: { attachments: true },
            title: "Attachments",
            fieldType: FormFieldSchemaType.MultipleFiles,
          },
        ]}
        formSteps={undefined}
      />,
    );
  }

  // Each row's name: its first paragraph.
  function fileNames(): Array<string> {
    return screen.getAllByRole("listitem").map((row: HTMLElement): string => {
      return withoutIsolateMarks(row.querySelector("p")?.textContent || "");
    });
  }

  const FILES: Array<JSONObject> = [
    { name: "runbook.pdf" },
    { fileType: "image/png" },
    { fileType: "image/png" },
  ];

  test("Persian: فایل ۲ and فایل ۳", async () => {
    await readIn("fa");
    renderFiles(FILES);

    expect(fileNames()).toEqual(["runbook.pdf", "فایل ۲", "فایل ۳"]);
  });

  test("Arabic: Latin digits", async () => {
    await readIn("ar");
    renderFiles(FILES);

    expect(fileNames()).toEqual(["runbook.pdf", "الملف 2", "الملف 3"]);
  });

  test("German: Latin digits", async () => {
    await readIn("de");
    renderFiles(FILES);

    expect(fileNames()).toEqual(["runbook.pdf", "Datei 2", "Datei 3"]);
  });

  test("English reads as it always did", () => {
    renderFiles(FILES);

    expect(fileNames()).toEqual(["runbook.pdf", "File 2", "File 3"]);
  });

  test("a file's own name keeps its digits, in Persian too", async () => {
    await readIn("fa");
    renderFiles([{ name: "report-2026.pdf" }, { fileType: "image/png" }]);

    expect(fileNames()).toEqual(["report-2026.pdf", "فایل ۲"]);
  });
});
