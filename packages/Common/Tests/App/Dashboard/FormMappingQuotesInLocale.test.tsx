import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE FORM MAPPING CARD QUOTES A QUESTION THE READER'S WAY (#7726).
 *
 * The On Submit page's mapping card says where a field's value comes from:
 * "Answer to the question: “What happened?”". The quotes were English
 * curly ones, drawn in code around the question on every page, where
 * German writes „…“, Japanese 「…」 and Persian «…». The line is one
 * sentence now, the quotes in it the language's own, and the question is
 * set apart (IsolatedText): one typed in another language than the page's
 * keeps its full stop or question mark at its own end.
 *
 * The project's records the card reads are stubbed; the card, its rows and
 * the locale files are the real ones.
 */

const loadReferenceMock: MockFunction = getJestMockFunction();
const loadCustomFieldsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      loadFormReferenceData: (...args: Array<unknown>): unknown => {
        return loadReferenceMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return {
      __esModule: true,
      loadFormCustomFields: (...args: Array<unknown>): unknown => {
        return loadCustomFieldsMock(...args);
      },
      loadFormRecordOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

import FormMappingCard, {
  ANSWER_TO_THE_QUESTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingCard";
import { FormReferenceData } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import { FormTargetSettingReferenceModel } from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000bb";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const REGION_FIELD_ID: string = "b0000000-0000-4000-8000-000000000001";

const REFERENCE: FormReferenceData = {
  lists: {
    [FormTargetSettingReferenceModel.IncidentSeverity]: [
      { id: SEVERITY_ID, name: "Major" },
    ],
    [FormTargetSettingReferenceModel.IncidentTemplate]: [],
    [FormTargetSettingReferenceModel.Label]: [],
    [FormTargetSettingReferenceModel.Monitor]: [],
    [FormTargetSettingReferenceModel.OnCallDutyPolicy]: [],
    [FormTargetSettingReferenceModel.User]: [],
    [FormTargetSettingReferenceModel.Team]: [],
    [FormTargetSettingReferenceModel.StatusPage]: [],
  },
  templateIdsWithSeverity: [],
};

// The question a title is answered by, and the one filling the Region field.
const TITLE_QUESTION: string = "What happened?";
const REGION_QUESTION: string = "Where?";

// The quotes each language puts a question in.
const QUOTES: Record<string, [string, string]> = {
  en: ["“", "”"],
  de: ["„", "“"],
  ja: ["「", "」"],
  fa: ["«", "»"],
};

const LANGUAGES: Array<string> = Object.keys(QUOTES);

// An isolate's marks, as a bdi draws its text: by its dir, or its first strong letter.
const LRI: string = String.fromCodePoint(0x2066);
const RLI: string = String.fromCodePoint(0x2067);
const FSI: string = String.fromCodePoint(0x2068);
const PDI: string = String.fromCodePoint(0x2069);

// A line's text as the browser lays it out: each bdi an isolate.
const withIsolates: (node: Node) => string = (node: Node): string => {
  if (node.nodeType === node.TEXT_NODE) {
    return node.textContent || "";
  }

  const inner: string = Array.from(node.childNodes)
    .map((child: ChildNode): string => {
      return withIsolates(child);
    })
    .join("");

  if (node.nodeName !== "BDI") {
    return inner;
  }

  const direction: string | null = (node as Element).getAttribute("dir");
  const opener: string =
    direction === "ltr" ? LRI : direction === "rtl" ? RLI : FSI;

  return `${opener}${inner}${PDI}`;
};

// The answer line in the sentence `language` words, quotes and all.
const sentenceIn: (language: string, question: string) => string = (
  language: string,
  question: string,
): string => {
  const template: string | undefined =
    readDashboardLocale(language)[ANSWER_TO_THE_QUESTION];

  expect({ language, worded: Boolean(template) }).toEqual({
    language,
    worded: true,
  });

  return (template as string).replace("{{question}}", question);
};

const renderCardIn: (
  language: string,
  titleQuestion?: string,
) => Promise<void> = async (
  language: string,
  titleQuestion: string = TITLE_QUESTION,
): Promise<void> => {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const fields: Array<FormField> = [
    ...getDefaultFormFields(FormTargetType.Incident).map(
      (field: FormField): FormField => {
        return field.targetField === "title"
          ? { ...field, label: titleQuestion }
          : field;
      },
    ),
    {
      id: "region",
      source: FormFieldSource.TargetCustomField,
      customFieldId: REGION_FIELD_ID,
      label: REGION_QUESTION,
      isRequired: false,
    },
  ];

  await act(async (): Promise<void> => {
    render(
      <FormMappingCard
        formId={new ObjectID(FORM_ID)}
        targetType={FormTargetType.Incident}
        fields={fields}
        targetSettings={{ incidentSeverityId: SEVERITY_ID }}
        onSaved={() => {}}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("form-mapping-rows")).toBeInTheDocument();
  });
};

// The title row's answer line.
const titleAnswer: () => HTMLElement = (): HTMLElement => {
  return within(screen.getByTestId("form-mapping-row-title")).getByTestId(
    "form-mapping-answer",
  );
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  loadReferenceMock.mockReset();
  loadReferenceMock.mockImplementation(async (): Promise<unknown> => {
    return REFERENCE;
  });

  loadCustomFieldsMock.mockReset();
  loadCustomFieldsMock.mockImplementation(async (): Promise<unknown> => {
    return [
      {
        id: REGION_FIELD_ID,
        name: "Region",
        customFieldType: "Dropdown",
        dropdownOptions: "EU",
      },
    ];
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  // The question as `language` quotes it.
  const quoted: (question: string) => string = (question: string): string => {
    const quotes: [string, string] = QUOTES[language] as [string, string];

    return `${quotes[0]}${question}${quotes[1]}`;
  };

  test("a built-in field's answer line is the language's sentence, the question in its quotes", async () => {
    await renderCardIn(language);

    const line: string = withoutIsolateMarks(titleAnswer().textContent || "");

    expect(line).toBe(sentenceIn(language, TITLE_QUESTION));
    expect(line).toContain(quoted(TITLE_QUESTION));
  });

  test("a custom field's line says the same, after the field it fills", async () => {
    await renderCardIn(language);

    const row: string = withoutIsolateMarks(
      screen.getByTestId("form-mapping-row-customFields").textContent || "",
    );

    expect(row).toContain("Region");
    expect(row).toContain(sentenceIn(language, REGION_QUESTION));
    expect(row).toContain(quoted(REGION_QUESTION));
  });
});

describe("the question reads the way it is written", () => {
  test("Persian page, English question: its question mark stays at its end", async () => {
    await renderCardIn("fa");

    const text: string = withIsolates(titleAnswer());
    const at: number = text.indexOf(TITLE_QUESTION);

    expect(at).toBeGreaterThan(-1);
    expect(
      isDrawnAsWritten(drawLine(text, "rtl"), at, at + TITLE_QUESTION.length),
    ).toBe(true);
  });

  test("German page, Persian question: its full stop stays at its end, on the left", async () => {
    const question: string = "مشکل را شرح دهید.";

    await renderCardIn("de", question);

    const drawn: string = getDrawnText(
      drawLine(withIsolates(titleAnswer()), "ltr"),
    );

    // Drawn from the right as one piece: the full stop at its left end.
    expect(drawn).toContain(Array.from(question).reverse().join(""));
    expect(withoutIsolateMarks(titleAnswer().textContent || "")).toBe(
      sentenceIn("de", question),
    );
  });
});
