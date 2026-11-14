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
 * What applies is set apart the same way (#7819): the default title "If it
 * is left empty:", the labels "Always added:", the on-call policies and the
 * owners. Joined to an Arabic or Persian line with a space, "Checkout
 * down." read ".Checkout down", and a list of names joined with an English
 * comma was laid out as one left-to-right run, read from its last name.
 * Each name is an isolate of its own now, and the names are separated the
 * reader's way (IsolatedTextList).
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

import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  drawLine,
  DrawnLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000bb";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const REGION_FIELD_ID: string = "b0000000-0000-4000-8000-000000000001";
const OPS_LABEL_ID: string = "c0000000-0000-4000-8000-000000000001";
const WEB_LABEL_ID: string = "c0000000-0000-4000-8000-000000000002";
const PRIMARY_POLICY_ID: string = "d0000000-0000-4000-8000-000000000001";
const BACKUP_POLICY_ID: string = "d0000000-0000-4000-8000-000000000002";
const OWNER_USER_ID: string = "e0000000-0000-4000-8000-000000000001";
const OWNER_TEAM_ID: string = "e0000000-0000-4000-8000-000000000002";

// What the settings name, as someone wrote it: a full stop, brackets.
const DEFAULT_TITLE: string = "Checkout down.";
const LABELS: Array<string> = ["Ops (EU)", "Web"];
const POLICIES: Array<string> = ["Primary (EU)", "Backup"];
// The owners: the person first, then the team, as the row lists them.
const OWNERS: Array<string> = ["Ada", "SRE (EU)"];

const REFERENCE: FormReferenceData = {
  lists: {
    [FormTargetSettingReferenceModel.IncidentSeverity]: [
      { id: SEVERITY_ID, name: "Major" },
    ],
    [FormTargetSettingReferenceModel.IncidentTemplate]: [],
    [FormTargetSettingReferenceModel.Label]: [
      { id: OPS_LABEL_ID, name: LABELS[0] as string },
      { id: WEB_LABEL_ID, name: LABELS[1] as string },
    ],
    [FormTargetSettingReferenceModel.Monitor]: [],
    [FormTargetSettingReferenceModel.OnCallDutyPolicy]: [
      { id: PRIMARY_POLICY_ID, name: POLICIES[0] as string },
      { id: BACKUP_POLICY_ID, name: POLICIES[1] as string },
    ],
    [FormTargetSettingReferenceModel.User]: [
      { id: OWNER_USER_ID, name: OWNERS[0] as string },
    ],
    [FormTargetSettingReferenceModel.Team]: [
      { id: OWNER_TEAM_ID, name: OWNERS[1] as string },
    ],
    [FormTargetSettingReferenceModel.StatusPage]: [],
  },
  templateIdsWithSeverity: [],
};

// Settings that name all of them: a default title, two labels, two policies, two owners.
const SETTINGS_NAMING_RECORDS: JSONObject = {
  defaultTitle: DEFAULT_TITLE,
  incidentSeverityId: SEVERITY_ID,
  labelIds: [OPS_LABEL_ID, WEB_LABEL_ID],
  onCallDutyPolicyIds: [PRIMARY_POLICY_ID, BACKUP_POLICY_ID],
  ownerUserIds: [OWNER_USER_ID],
  ownerTeamIds: [OWNER_TEAM_ID],
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

// The pages the card is drawn on: Arabic too, for its lists.
const PAGE_LANGUAGES: Array<string> = [...LANGUAGES, "ar"];

// An isolate's marks, as a bdi draws its text: by its dir, or its first strong letter.
const LRI: string = String.fromCodePoint(0x2066);
const RLI: string = String.fromCodePoint(0x2067);
const FSI: string = String.fromCodePoint(0x2068);
const PDI: string = String.fromCodePoint(0x2069);

// What Arabic and Persian put between two names of a list: "، ".
const ARABIC_LIST_SEPARATOR: string = `${String.fromCodePoint(0x060c)} `;

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

interface CardSetup {
  // How the form asks for the title: required (as it starts), optional, or not at all.
  title?: "required" | "optional" | "not asked" | undefined;
  // The form's On Submit settings: a severity, unless a test names more.
  targetSettings?: JSONObject | undefined;
}

const renderCardIn: (
  language: string,
  titleQuestion?: string,
  setup?: CardSetup,
) => Promise<void> = async (
  language: string,
  titleQuestion: string = TITLE_QUESTION,
  setup: CardSetup = {},
): Promise<void> => {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const fields: Array<FormField> = [
    ...getDefaultFormFields(FormTargetType.Incident)
      .filter((field: FormField): boolean => {
        return setup.title !== "not asked" || field.targetField !== "title";
      })
      .map((field: FormField): FormField => {
        if (field.targetField !== "title") {
          return field;
        }

        return setup.title === "optional"
          ? { ...field, label: titleQuestion, isRequired: false }
          : { ...field, label: titleQuestion };
      }),
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
        targetSettings={
          setup.targetSettings || { incidentSeverityId: SEVERITY_ID }
        }
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

/*
 * A row's line of one kind: what applies if it is left empty
 * ("form-mapping-fallback"), what is always added ("form-mapping-always"),
 * or its value ("form-mapping-value").
 */
const lineOf: (rowKey: string, testId: string) => HTMLElement = (
  rowKey: string,
  testId: string,
): HTMLElement => {
  return within(screen.getByTestId(`form-mapping-row-${rowKey}`)).getByTestId(
    testId,
  );
};

// One of the card's words, as `language`'s file words it.
const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const word: string | undefined = readDashboardLocale(language)[english];

  expect({ language, english, worded: Boolean(word) }).toEqual({
    language,
    english,
    worded: true,
  });

  return word as string;
};

// A line's isolates: each one's words, and the way it reads.
const isolatesOf: (line: HTMLElement) => Array<[string, string | null]> = (
  line: HTMLElement,
): Array<[string, string | null]> => {
  return Array.from(line.querySelectorAll("bdi")).map(
    (isolate: Element): [string, string | null] => {
      return [isolate.textContent || "", isolate.getAttribute("dir")];
    },
  );
};

/*
 * Whether a line read from the right draws `first` on the right of
 * `second`: where the line starts, so it is read first.
 */
const drawsFirstOnTheRight: (
  text: string,
  first: string,
  second: string,
) => boolean = (text: string, first: string, second: string): boolean => {
  const drawn: DrawnLine = drawLine(text, "rtl");

  return (
    (drawn.drawnAt[text.indexOf(first)] as number) >
    (drawn.drawnAt[text.indexOf(second)] as number)
  );
};

/*
 * A line of names on an Arabic page, after `words` (the page's own). Each
 * name is an isolate of its own, read left to right, and the names are
 * separated with "، ". Laid out from the right, each name is drawn as it
 * is written - "(EU)" with "Ops", its brackets not mirrored - and the
 * first name is on the right, where the line starts. Joined with ", " and
 * not set apart, as the line was drawn before, the names were one
 * left-to-right run: the first name on the left, read last.
 */
const expectNamesSetApartInArabic: (
  line: HTMLElement,
  words: string,
  names: Array<string>,
) => void = (line: HTMLElement, words: string, names: Array<string>): void => {
  const first: string = names[0] as string;
  const second: string = names[1] as string;

  expect(isolatesOf(line)).toEqual(
    names.map((name: string): [string, string] => {
      return [name, "ltr"];
    }),
  );
  expect(withoutIsolateMarks(line.textContent || "")).toBe(
    `${words}${names.join(ARABIC_LIST_SEPARATOR)}`,
  );

  const text: string = withIsolates(line);
  const drawn: DrawnLine = drawLine(text, "rtl");

  for (const name of names) {
    const at: number = text.indexOf(name);

    expect({
      name,
      asWritten: isDrawnAsWritten(drawn, at, at + name.length),
    }).toEqual({ name, asWritten: true });
  }

  expect(drawsFirstOnTheRight(text, first, second)).toBe(true);

  // Negative control: the line as it was drawn, the names one English string.
  expect(
    drawsFirstOnTheRight(`${words}${names.join(", ")}`, first, second),
  ).toBe(false);
};

/*
 * A value that ends in a full stop, on a Persian page, after `words` (the
 * page's own): one isolate, read left to right, drawn as it is written -
 * its full stop at its end. Not set apart, as it was drawn before, the
 * full stop stood at its start.
 */
const expectValueSetApartInPersian: (
  line: HTMLElement,
  words: string,
  value: string,
) => void = (line: HTMLElement, words: string, value: string): void => {
  expect(isolatesOf(line)).toEqual([[value, "ltr"]]);
  expect(withoutIsolateMarks(line.textContent || "")).toBe(`${words}${value}`);

  const text: string = withIsolates(line);
  const at: number = text.indexOf(value);

  expect(isDrawnAsWritten(drawLine(text, "rtl"), at, at + value.length)).toBe(
    true,
  );

  // Negative control: the line as it was drawn, the value not set apart.
  const asBefore: string = `${words}${value}`;
  const before: number = asBefore.indexOf(value);

  expect(
    isDrawnAsWritten(drawLine(asBefore, "rtl"), before, before + value.length),
  ).toBe(false);
  expect(getDrawnText(drawLine(asBefore, "rtl"))).toContain(
    `.${value.slice(0, -1)}`,
  );
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of PAGE_LANGUAGES) {
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

describe("what applies reads the way it is written (#7819)", () => {
  test('Persian page, default title "Checkout down." of an optional title question: one isolate, its full stop at its end', async () => {
    await renderCardIn("fa", TITLE_QUESTION, {
      title: "optional",
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expectValueSetApartInPersian(
      lineOf("title", "form-mapping-fallback"),
      `${wordIn("fa", FormsCopy.ifLeftEmpty)} `,
      DEFAULT_TITLE,
    );
  });

  test("Persian page, default title of a form that does not ask for one: one isolate, its full stop at its end", async () => {
    await renderCardIn("fa", TITLE_QUESTION, {
      title: "not asked",
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expectValueSetApartInPersian(
      lineOf("title", "form-mapping-value"),
      "",
      DEFAULT_TITLE,
    );
  });

  test('Arabic page, labels "Ops (EU)" and "Web" always added: each its own isolate, joined with "، ", "(EU)" with "Ops"', async () => {
    await renderCardIn("ar", TITLE_QUESTION, {
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expectNamesSetApartInArabic(
      lineOf("labels", "form-mapping-always"),
      `${wordIn("ar", FormsCopy.alwaysAdded)} `,
      LABELS,
    );
  });

  test('Arabic page, the on-call policies and the owners: each name its own isolate, joined with "، "', async () => {
    await renderCardIn("ar", TITLE_QUESTION, {
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expectNamesSetApartInArabic(
      lineOf("onCallPolicies", "form-mapping-value"),
      "",
      POLICIES,
    );
    expectNamesSetApartInArabic(
      lineOf("owners", "form-mapping-value"),
      "",
      OWNERS,
    );
  });

  test('Japanese page: the labels always added are separated with "、"', async () => {
    await renderCardIn("ja", TITLE_QUESTION, {
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    const line: HTMLElement = lineOf("labels", "form-mapping-always");

    expect(isolatesOf(line)).toEqual([
      ["Ops (EU)", "ltr"],
      ["Web", "ltr"],
    ]);
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      `${wordIn("ja", FormsCopy.alwaysAdded)} Ops (EU)${String.fromCodePoint(0x3001)}Web`,
    );
  });

  test("English page: every line reads as before, word for word", async () => {
    await renderCardIn("en", TITLE_QUESTION, {
      title: "optional",
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expect(lineOf("title", "form-mapping-fallback").textContent).toBe(
      "If it is left empty: Checkout down.",
    );
    expect(lineOf("labels", "form-mapping-always").textContent).toBe(
      "Always added: Ops (EU), Web",
    );
    expect(lineOf("onCallPolicies", "form-mapping-value").textContent).toBe(
      "Primary (EU), Backup",
    );
    expect(lineOf("owners", "form-mapping-value").textContent).toBe(
      "Ada, SRE (EU)",
    );
  });

  test("English page, a form that does not ask for a title: the default title as before", async () => {
    await renderCardIn("en", TITLE_QUESTION, {
      title: "not asked",
      targetSettings: SETTINGS_NAMING_RECORDS,
    });

    expect(lineOf("title", "form-mapping-value").textContent).toBe(
      "Checkout down.",
    );
  });
});

/*
 * A record the settings name that has been deleted since (#7857). The card
 * listed it as "Deleted", in English on every page: the rows put FormsCopy's
 * English word where its name goes, and a name is drawn as written. The rows
 * mark it now, and the card words it the reader's way, in its place in the
 * list: the page's own words, not a value set apart. A record's own name is
 * never translated: a label called "Deleted" reads "Deleted" on a German
 * page too.
 */
describe("a record deleted since is worded the reader's way (#7857)", () => {
  const GONE_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ff";
  const GONE_OWNER_ID: string = "e0000000-0000-4000-8000-0000000000ff";
  const LABEL_NAMED_DELETED_ID: string = "c0000000-0000-4000-8000-000000000003";

  // A label and an owner deleted since, each after one that is still there.
  const SETTINGS_NAMING_DELETED: JSONObject = {
    ...SETTINGS_NAMING_RECORDS,
    labelIds: [OPS_LABEL_ID, GONE_LABEL_ID],
    ownerUserIds: [OWNER_USER_ID, GONE_OWNER_ID],
  };

  // What each page calls a record deleted since.
  const DELETED: Record<string, string> = {
    de: "Gelöscht",
    fa: "حذف‌شده",
  };

  // What each page puts between two names.
  const SEPARATORS: Record<string, string> = {
    de: ", ",
    fa: ARABIC_LIST_SEPARATOR,
  };

  test.each(Object.keys(DELETED))(
    "%s page: a deleted label and a deleted owner are worded in the page's language, in their places",
    async (language: string) => {
      await renderCardIn(language, TITLE_QUESTION, {
        targetSettings: SETTINGS_NAMING_DELETED,
      });

      const deleted: string = wordIn(language, FormsCopy.deletedRecord);
      const separator: string = SEPARATORS[language] as string;

      expect(deleted).toBe(DELETED[language]);

      const labels: HTMLElement = lineOf("labels", "form-mapping-always");
      const owners: HTMLElement = lineOf("owners", "form-mapping-value");

      expect(withoutIsolateMarks(labels.textContent || "")).toBe(
        `${wordIn(language, FormsCopy.alwaysAdded)} ${["Ops (EU)", deleted].join(separator)}`,
      );
      expect(withoutIsolateMarks(owners.textContent || "")).toBe(
        ["Ada", deleted, "SRE (EU)"].join(separator),
      );

      // The names are set apart, as written; the word is the page's own.
      expect(isolatesOf(labels)).toEqual([["Ops (EU)", "ltr"]]);
      expect(isolatesOf(owners)).toEqual([
        ["Ada", "ltr"],
        ["SRE (EU)", "ltr"],
      ]);
    },
  );

  test('German page: a label called "Deleted" keeps its name, beside one deleted since', async () => {
    loadReferenceMock.mockImplementation(async (): Promise<unknown> => {
      return {
        ...REFERENCE,
        lists: {
          ...REFERENCE.lists,
          [FormTargetSettingReferenceModel.Label]: [
            ...(REFERENCE.lists[FormTargetSettingReferenceModel.Label] || []),
            { id: LABEL_NAMED_DELETED_ID, name: "Deleted" },
          ],
        },
      };
    });

    await renderCardIn("de", TITLE_QUESTION, {
      targetSettings: {
        ...SETTINGS_NAMING_RECORDS,
        labelIds: [LABEL_NAMED_DELETED_ID, GONE_LABEL_ID],
      },
    });

    const labels: HTMLElement = lineOf("labels", "form-mapping-always");

    expect(withoutIsolateMarks(labels.textContent || "")).toBe(
      `${wordIn("de", FormsCopy.alwaysAdded)} Deleted, ${DELETED["de"]}`,
    );
    expect(isolatesOf(labels)).toEqual([["Deleted", "ltr"]]);
  });

  test("English page: reads as before, word for word", async () => {
    await renderCardIn("en", TITLE_QUESTION, {
      targetSettings: SETTINGS_NAMING_DELETED,
    });

    expect(lineOf("labels", "form-mapping-always").textContent).toBe(
      "Always added: Ops (EU), Deleted",
    );
    expect(lineOf("owners", "form-mapping-value").textContent).toBe(
      "Ada, Deleted, SRE (EU)",
    );
  });
});
