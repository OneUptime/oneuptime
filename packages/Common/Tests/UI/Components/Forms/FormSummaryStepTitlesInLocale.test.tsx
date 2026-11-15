import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import FormSummary from "../../../../UI/Components/Forms/FormSummary";
import Step from "../../../../UI/Components/Forms/Steps/Step";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  FormStep,
  FormStepState,
} from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";
import { DASHBOARD_LANGUAGES } from "../../../Helpers/TranslatedLanguages";

/*
 * The review's step headings in the reader's language (#7606's UI review).
 *
 * The last step of a form lists what is about to be saved under a heading
 * per step. The step list beside it, and the "Step 2 of 3" title narrow
 * screens show instead, look each title up in the reader's language; the
 * headings printed it as written, so a German Declare New Incident read
 * "Vorfalldetails" in the step list and "Incident Details" above the same
 * fields on the summary. Each heading is the step list's own title, in
 * every language the Dashboard ships, and a step named after a product
 * (isTitleProductName: Resend on the email provider form) keeps its name -
 * German "Erneut senden" is the word "resend", not the product.
 *
 * i18next is set up once for this file, from the Dashboard's own locale
 * files, as the Dashboard sets it up; each jest file has its own module
 * registry, so it reaches no other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Declare New Incident's steps (Pages/Incidents/Create.tsx), one field each.
const INCIDENT_STEPS: Array<FormStep<JSONObject>> = [
  { title: "Incident Details", id: "incident-details" },
  { title: "Resources Affected", id: "resources-affected" },
  { title: "On-Call & Roles", id: "on-call" },
];

const INCIDENT_FIELDS: Fields<JSONObject> = [
  {
    field: { title: true },
    title: "Title",
    fieldType: FormFieldSchemaType.Text,
    stepId: "incident-details",
  },
  {
    field: { monitors: true },
    title: "Monitors",
    fieldType: FormFieldSchemaType.Text,
    stepId: "resources-affected",
  },
  {
    field: { onCallPolicy: true },
    title: "On-Call Policy",
    fieldType: FormFieldSchemaType.Text,
    stepId: "on-call",
  },
];

const INCIDENT_VALUES: JSONObject = {
  title: "Checkout API is down",
  monitors: "Checkout API",
  onCallPolicy: "Platform on-call",
};

// The email provider form's steps (SmtpConfigFormFields), Resend picked.
const EMAIL_STEPS: Array<FormStep<JSONObject>> = [
  { title: "Provider", id: "provider" },
  { title: "Resend", id: "resend", isTitleProductName: true },
  { title: "Sender", id: "sender" },
];

const EMAIL_FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    stepId: "provider",
  },
  {
    field: { resendDomain: true },
    title: "Domain",
    fieldType: FormFieldSchemaType.Text,
    stepId: "resend",
  },
  {
    field: { fromEmail: true },
    title: "From Email",
    fieldType: FormFieldSchemaType.Text,
    stepId: "sender",
  },
];

const EMAIL_VALUES: JSONObject = {
  name: "Transactional mail",
  resendDomain: "mail.example.com",
  fromEmail: "status@example.com",
};

function renderSummary(
  steps: Array<FormStep<JSONObject>>,
  fields: Fields<JSONObject>,
  values: JSONObject,
): void {
  render(
    <div data-testid="summary">
      <FormSummary<JSONObject>
        formValues={values as FormValues<JSONObject>}
        formFields={fields}
        formSteps={steps}
      />
    </div>,
  );
}

function summaryHeadings(): Array<string> {
  return within(screen.getByTestId("summary"))
    .getAllByRole("heading", { level: 2 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

// The step list beside the form, every step done - as on the summary step.
function stepListTitles(steps: Array<FormStep<JSONObject>>): Array<string> {
  render(
    <ol data-testid="step-list">
      {steps.map((step: FormStep<JSONObject>) => {
        return (
          <Step<JSONObject>
            key={step.id}
            step={step}
            state={FormStepState.COMPLETED}
            onClick={(): void => {}}
          />
        );
      })}
    </ol>,
  );

  return within(screen.getByTestId("step-list"))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

async function readIn(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("de");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("The summary's step headings in the reader's language", () => {
  test("German: Declare New Incident's summary reads Vorfalldetails, as its step list does", () => {
    renderSummary(INCIDENT_STEPS, INCIDENT_FIELDS, INCIDENT_VALUES);

    expect(summaryHeadings()).toEqual([
      "Vorfalldetails",
      "Betroffene Ressourcen",
      "Bereitschaft & Rollen",
    ]);
    expect(
      screen.queryByRole("heading", { name: "Incident Details" }),
    ).not.toBeInTheDocument();
    // The values under them are the person's own, as typed.
    expect(screen.getByText("Checkout API is down")).toBeInTheDocument();
  });

  test("Arabic: the headings are the Arabic file's words", async () => {
    await readIn("ar");

    renderSummary(INCIDENT_STEPS, INCIDENT_FIELDS, INCIDENT_VALUES);

    const arabic: Record<string, string> = readLocale("ar");

    expect(summaryHeadings()).toEqual([
      arabic["Incident Details"],
      arabic["Resources Affected"],
      arabic["On-Call & Roles"],
    ]);
    expect(summaryHeadings()[0]).toBe("تفاصيل الحادثة");
  });

  test("a step named after a product keeps its name: Resend, never Erneut senden", () => {
    // The word is interface text too, so a lookup would turn the product into a verb.
    expect(readLocale("de")["Resend"]).toBe("Erneut senden");

    renderSummary(EMAIL_STEPS, EMAIL_FIELDS, EMAIL_VALUES);

    expect(summaryHeadings()).toEqual([
      readLocale("de")["Provider"],
      "Resend",
      readLocale("de")["Sender"],
    ]);
    expect(screen.queryByText("Erneut senden")).not.toBeInTheDocument();
  });

  test("each heading is the step list's own title, in every language the Dashboard ships", async () => {
    for (const language of LANGUAGES) {
      const words: Record<string, string> = readLocale(language);

      // Translated in every language, so a heading left in English shows.
      for (const step of INCIDENT_STEPS) {
        expect({
          language,
          title: step.title,
          isEnglish: words[step.title] === step.title,
        }).toEqual({
          language,
          title: step.title,
          isEnglish: false,
        });
      }

      await readIn(language);

      for (const [steps, fields, values] of [
        [INCIDENT_STEPS, INCIDENT_FIELDS, INCIDENT_VALUES],
        [EMAIL_STEPS, EMAIL_FIELDS, EMAIL_VALUES],
      ] as Array<
        [Array<FormStep<JSONObject>>, Fields<JSONObject>, JSONObject]
      >) {
        const listed: Array<string> = stepListTitles(steps);

        renderSummary(steps, fields, values);

        expect({ language, headings: summaryHeadings() }).toEqual({
          language,
          headings: listed,
        });

        cleanup();
      }
    }
  });

  test("English: as written", async () => {
    await readIn("en");

    renderSummary(INCIDENT_STEPS, INCIDENT_FIELDS, INCIDENT_VALUES);

    expect(summaryHeadings()).toEqual([
      "Incident Details",
      "Resources Affected",
      "On-Call & Roles",
    ]);
  });
});
