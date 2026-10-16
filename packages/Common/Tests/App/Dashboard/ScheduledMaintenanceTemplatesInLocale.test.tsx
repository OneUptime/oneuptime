import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The scheduled maintenance templates' recurring schedule, in every language
 * the Dashboard ships, read from the locale files themselves:
 *
 *   - the list's Recurring Event column says when the next event is
 *     scheduled for a recurring template, and No for one turned off, in the
 *     reader's language - never the time a template turned off still holds;
 *   - "How often should this event recur?" says what its picker takes, as
 *     one translated sentence (the units it names are the picker's, which
 *     ScheduledMaintenanceTemplateForm checks in English).
 *
 * The list's table is replaced by a recorder so its columns can be read and
 * each cell drawn for real in the language.
 */

const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown): ReactElement => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

import ScheduledMaintenanceTemplates, {
  getTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import FieldLabelElement from "../../../UI/Components/Forms/Fields/FieldLabel";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const NEXT_EVENT: string = "Next event will be scheduled at {{date}}";
const NO: string = "No";
const INTERVAL_TITLE: string = "How often should this event recur?";
const INTERVAL_DESCRIPTION: string =
  "A number and a unit: hours, days, weeks, months or years.";

const NEXT_EVENT_AT: Date = new Date("2030-06-10T09:00:00.000Z");

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

interface Column {
  title?: string;
  field?: Record<string, unknown>;
  getElement?: (item: ScheduledMaintenanceTemplate) => ReactElement;
}

function template(
  isRecurringEvent: boolean,
  scheduleNextEventAt: Date,
): ScheduledMaintenanceTemplate {
  const model: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();

  model.isRecurringEvent = isRecurringEvent;
  model.scheduleNextEventAt = scheduleNextEventAt;

  return model;
}

// The list's Recurring Event column, as the page builds it in the language.
function recurringEventColumn(): Column {
  modelTableMock.mockClear();

  render(
    <ScheduledMaintenanceTemplates
      pageRoute={
        new Route("/dashboard/project/scheduled-maintenance-events/templates")
      }
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  const props: { columns: Array<Column> } = modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as { columns: Array<Column> };

  const column: Column | undefined = props.columns.find(
    (candidate: Column): boolean => {
      return candidate.title === "Recurring Event";
    },
  );

  expect(column?.field).toEqual({ scheduleNextEventAt: true });

  cleanup();

  return column!;
}

function cellText(column: Column, item: ScheduledMaintenanceTemplate): string {
  render(column.getElement!(item));

  const text: string =
    screen.getByTestId("template-recurring-event").textContent || "";

  cleanup();

  return text;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

describe.each(LANGUAGES)("in %s", (language: string) => {
  test("the list says when a recurring template's next event is scheduled, in the locale's words", async () => {
    await inLanguage(language);

    const sentence: string = LOCALES[language]![NEXT_EVENT]!;

    // Translated, with the date where the language puts it.
    expect({ language, translated: sentence !== NEXT_EVENT }).toEqual({
      language,
      translated: true,
    });
    expect(sentence).toContain("{{date}}");

    expect(
      cellText(recurringEventColumn(), template(true, NEXT_EVENT_AT)),
    ).toBe(
      sentence.replace(
        "{{date}}",
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(NEXT_EVENT_AT),
      ),
    );
  });

  test("the list says No for a template turned off, whatever time it still holds", async () => {
    await inLanguage(language);

    // Spanish and Italian say "No" as English does; the rest have a word of their own.
    const no: string = LOCALES[language]![NO]!;

    expect(no.trim().length).toBeGreaterThan(0);

    const text: string = cellText(
      recurringEventColumn(),
      template(false, NEXT_EVENT_AT),
    );

    expect(text).toBe(no);
    expect(text).not.toContain(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(NEXT_EVENT_AT),
    );
  });

  test("the recurrence field says what its picker takes, as one translated sentence", async () => {
    await inLanguage(language);

    const field: { description?: unknown } | undefined = getTemplateFormFields({
      isViewPage: false,
    }).find((candidate: { title?: string | undefined }): boolean => {
      return candidate.title === INTERVAL_TITLE;
    });

    expect(field?.description).toBe(INTERVAL_DESCRIPTION);

    const translated: string = LOCALES[language]![INTERVAL_DESCRIPTION]!;

    expect({
      language,
      translated: translated !== INTERVAL_DESCRIPTION,
    }).toEqual({ language, translated: true });

    render(
      <FieldLabelElement
        title={INTERVAL_TITLE}
        description={field!.description as string}
      />,
    );

    expect(screen.getByText(translated)).toBeInTheDocument();
    expect(screen.queryByText(INTERVAL_DESCRIPTION)).toBeNull();
  });
});
