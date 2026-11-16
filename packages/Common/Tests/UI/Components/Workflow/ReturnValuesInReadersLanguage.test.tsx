/*
 * A WORKFLOW STEP'S RETURNED VALUES IN THE READER'S LANGUAGE (#8316).
 *
 * The builder drew a step's settings and outputs in the reader's language
 * (WorkflowStepNamesInReadersLanguage), and its returned values in
 * English: the settings panel's Returns list wrote "Response Body" beside
 * a copy button named in German, the value picker listed the same value
 * in English with "The whole Response Body" glued together in code, and a
 * reference's chip and the run log named it in English too. Each now
 * names it as the Dashboard's locale words it (ReturnValueNames), and the
 * reference a workflow stores keeps the value's id.
 *
 * These draw each place with the Dashboard's real German and Persian
 * locale files, so the docs can quote a returned value as drawn.
 */

// The step catalogue imports the database-model registry, which nothing here reads.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import {
  WHOLE_VALUE_TEMPLATE,
  returnValueDescription,
  returnValueName,
  wholeReturnValueLabel,
} from "../../../../UI/Components/Workflow/ReturnValueNames";
import StepTraceViewer from "../../../../UI/Components/Workflow/StepTraceViewer";
import {
  ReferenceDescription,
  describeReference,
} from "../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import { buildStepSampleGroups } from "../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  buildStepValueGroups,
  createStepValueSource,
} from "../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import {
  ValuePickerProvider,
  useValuePicker,
} from "../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import ValuePickerMenu from "../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
} from "../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../../Types/Dashboard/DashboardLanguage";
import { createTranslator, Translator } from "../../../../Types/Translator";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import {
  StepSample,
  StepSampleKind,
} from "../../../../Types/Workflow/StepSamples";
import {
  WorkflowStepStatus,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import { componentReturnValueReference } from "../../../../Types/Workflow/TemplateSyntax";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

function localeOf(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: Array<string> = ["en", "de", "fa"];
const LOCALES: Record<string, Record<string, string>> = {};
const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
    LOCALES[language] = localeOf(language);
  }

  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: LOCALES[language]! },
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

// A translator that reads a language's locale file, as the Dashboard's does.
function translatorFor(language: string): Translator {
  return createTranslator((text: string): string | undefined => {
    return LOCALES[language]?.[text];
  }, language);
}

// The words a language's Dashboard has for an English name, or the English.
function drawn(language: string, english: string): string {
  const value: string | undefined = LOCALES[language]?.[english];

  return language !== "en" && typeof value === "string" && value.trim()
    ? value
    : english;
}

function inLanguage(language: string, children: ReactNode): ReactElement {
  return (
    <I18nextProvider i18n={instances[language]!}>{children}</I18nextProvider>
  );
}

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
}

const API_POST: ComponentMetadata = metadataOf(ComponentID.ApiPost);
const WEBHOOK: ComponentMetadata = metadataOf(ComponentID.Webhook);

function returnValueOf(metadata: ComponentMetadata, id: string): ReturnValue {
  return metadata.returnValues.find((returnValue: ReturnValue): boolean => {
    return returnValue.id === id;
  }) as ReturnValue;
}

const RESPONSE_BODY: ReturnValue = returnValueOf(API_POST, "response-body");
const RESPONSE_HEADERS: ReturnValue = returnValueOf(
  API_POST,
  "response-headers",
);
const REQUEST_BODY: ReturnValue = returnValueOf(WEBHOOK, "request-body");

function stepOf(metadata: ComponentMetadata, id: string): NodeDataProp {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
}

const WEBHOOK_STEP: NodeDataProp = stepOf(WEBHOOK, "webhook-1");
const API_POST_STEP: NodeDataProp = stepOf(API_POST, "api-post-1");
const LOG_STEP: NodeDataProp = stepOf(metadataOf(ComponentID.Log), "log-1");

const BODY_REFERENCE: string = componentReturnValueReference(
  "webhook-1",
  "request-body",
);
const RESPONSE_BODY_REFERENCE: string = componentReturnValueReference(
  "api-post-1",
  "response-body",
);

describe("the catalogue and the locales", () => {
  test("the names these tests read are a step's returned values, and German and Persian word them", () => {
    expect(RESPONSE_BODY.name).toBe("Response Body");
    expect(RESPONSE_HEADERS.name).toBe("Response Headers");
    expect(REQUEST_BODY.name).toBe("Request Body");
    expect(WEBHOOK.title).toBe("Webhook");

    for (const name of ["Response Body", "Response Headers", "Request Body"]) {
      expect(LOCALES["en"]![name]).toBe(name);
      expect(drawn("de", name)).not.toBe(name);
      expect(drawn("fa", name)).not.toBe(name);
    }

    expect(drawn("de", "Response Body")).toBe("Antworttext");
    expect(drawn("fa", "Response Body")).toBe("بدنه پاسخ");
    expect(drawn("fa", "Webhook")).toBe("وب‌هوک");
  });

  test.each(
    SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s words the picker's whole-value sentence and the copy button's, each with its {{name}}",
    (language: string) => {
      for (const key of [
        WHOLE_VALUE_TEMPLATE,
        "Copy the reference to {{name}}",
      ]) {
        const wording: string | undefined = LOCALES[language]![key];

        expect({ language, key, wording: typeof wording }).toEqual({
          language,
          key,
          wording: "string",
        });
        expect({ language, key, english: wording === key }).toEqual({
          language,
          key,
          english: false,
        });
        expect(wording).toContain("{{name}}");
      }
    },
  );

  test("English holds the whole-value sentence as its own key", () => {
    expect(LOCALES["en"]![WHOLE_VALUE_TEMPLATE]).toBe("The whole {{name}}");
  });
});

describe("ReturnValueNames", () => {
  test("without a translator: the catalogue's English, and the id where it has no name", () => {
    expect(returnValueName(RESPONSE_BODY)).toBe("Response Body");
    expect(returnValueName({ id: "response-body", name: "" })).toBe(
      "response-body",
    );
    expect(wholeReturnValueLabel(RESPONSE_BODY)).toBe(
      "The whole Response Body",
    );
    expect(wholeReturnValueLabel({ id: "response-body", name: "" })).toBe(
      "The whole response-body",
    );
    expect(returnValueDescription(RESPONSE_BODY)).toBe(
      RESPONSE_BODY.description,
    );
    expect(returnValueDescription({ description: "" })).toBe("");
  });

  test("in German and Persian: the locale's words for the name and the sentence", () => {
    expect(returnValueName(RESPONSE_BODY, translatorFor("de"))).toBe(
      "Antworttext",
    );
    expect(wholeReturnValueLabel(RESPONSE_BODY, translatorFor("de"))).toBe(
      "Antworttext als Ganzes",
    );
    expect(returnValueName(RESPONSE_BODY, translatorFor("fa"))).toBe(
      "بدنه پاسخ",
    );
    expect(wholeReturnValueLabel(RESPONSE_BODY, translatorFor("fa"))).toBe(
      "کل بدنه پاسخ",
    );
  });

  test("a name the locale has no word for stays English", () => {
    // Every built-in step's names are worded now (#8359): one no catalogue has.
    const unworded: ReturnValue = {
      ...returnValueOf(API_POST, "response-status"),
      name: "A value nobody worded",
    };

    expect(LOCALES["de"]![unworded.name]).toBeUndefined();
    expect(returnValueName(unworded, translatorFor("de"))).toBe(unworded.name);
  });

  test("API Post's Response Status, drawn in English before #8359, reads in German and Persian", () => {
    const status: ReturnValue = returnValueOf(API_POST, "response-status");

    expect(returnValueName(status, translatorFor("de"))).toBe("Antwortstatus");
    expect(returnValueName(status, translatorFor("fa"))).toBe(
      drawn("fa", "Response Status"),
    );
    expect(returnValueName(status, translatorFor("fa"))).not.toBe(
      "Response Status",
    );
  });

  test("a language that words the name but not the sentence reads the sentence wholly in English", () => {
    const nameOnly: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Response Body" ? "Corps de la réponse" : undefined;
      },
      "fr",
    );

    expect(returnValueName(RESPONSE_BODY, nameOnly)).toBe(
      "Corps de la réponse",
    );
    expect(wholeReturnValueLabel(RESPONSE_BODY, nameOnly)).toBe(
      "The whole Response Body",
    );
  });
});

describe("the settings panel's Returns list", () => {
  function drawReturns(language: string): void {
    render(
      inLanguage(
        language,
        <ComponentReturnValueViewer
          name=""
          description=""
          componentId="api-post-1"
          returnValues={API_POST.returnValues}
        />,
      ),
    );
  }

  function names(): Array<string> {
    return screen
      .getAllByTestId("workflow-return-value-name")
      .map((name: HTMLElement): string => {
        return name.textContent || "";
      });
  }

  test.each(LANGUAGES)(
    "%s: API Post's values are named as the locale words them",
    (language: string) => {
      drawReturns(language);

      expect(names()).toEqual(
        API_POST.returnValues.map((returnValue: ReturnValue): string => {
          return drawn(language, returnValue.name);
        }),
      );
    },
  );

  test("de: Response Body reads Antworttext, beside a copy button that names it so", () => {
    drawReturns("de");

    expect(names()).toContain("Antworttext");
    expect(names()).toContain("Antwort-Header");
    expect(names()).not.toContain("Response Body");
    expect(
      screen.getByLabelText("Verweis auf Antworttext kopieren"),
    ).toBeInTheDocument();
  });

  test("fa: Response Body and Response Headers in Persian, the reference as stored", () => {
    drawReturns("fa");

    expect(names()).toContain("بدنه پاسخ");
    expect(names()).toContain("هدرهای پاسخ");
    expect(names()).not.toContain("Response Body");
    expect(screen.getByLabelText("کپی ارجاع به بدنه پاسخ")).toBeInTheDocument();

    // Workflows read a value by its id: the reference is not translated.
    const references: Array<string> = screen
      .getAllByTestId("workflow-return-value-reference")
      .map((reference: HTMLElement): string => {
        return reference.textContent || "";
      });

    expect(references).toContain(RESPONSE_BODY_REFERENCE);
  });

  test("en: the catalogue's own words, and its descriptions", () => {
    drawReturns("en");

    expect(names()).toContain("Response Body");
    expect(
      screen
        .getAllByTestId("workflow-return-value-description")
        .map((description: HTMLElement): string => {
          return description.textContent || "";
        }),
    ).toContain(RESPONSE_BODY.description);
  });

  test("a description the locale words is drawn in its words", () => {
    const instance: i18n = createInstance();

    void instance.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            [RESPONSE_BODY.description]: "Was der Server zurückgab.",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });

    render(
      <I18nextProvider i18n={instance}>
        <ComponentReturnValueViewer
          name=""
          description=""
          returnValues={[RESPONSE_BODY]}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByTestId("workflow-return-value-description"),
    ).toHaveTextContent("Was der Server zurückgab.");
  });
});

describe("the value picker", () => {
  function itemOf(
    groups: Array<ValueSuggestionGroup>,
    reference: string,
  ): ValueSuggestion | undefined {
    for (const group of groups) {
      const found: ValueSuggestion | undefined = group.items.find(
        (item: ValueSuggestion): boolean => {
          return item.reference === reference;
        },
      );

      if (found) {
        return found;
      }
    }

    return undefined;
  }

  test("without the reader's translator: the catalogue's English, as before", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
      upstreamComponents: [WEBHOOK_STEP],
    });
    const body: ValueSuggestion = itemOf(groups, BODY_REFERENCE)!;

    expect(body.label).toBe("Request Body");
    expect(body.drillIn?.wholeValueLabel).toBe("The whole Request Body");
  });

  test.each(["de", "fa"])(
    "%s: a step's values are listed in the reader's words, each read by its id",
    (language: string) => {
      const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
        upstreamComponents: [WEBHOOK_STEP, API_POST_STEP],
        translator: translatorFor(language),
      });

      for (const [reference, returnValue] of [
        [BODY_REFERENCE, REQUEST_BODY],
        [RESPONSE_BODY_REFERENCE, RESPONSE_BODY],
      ] as Array<[string, ReturnValue]>) {
        const item: ValueSuggestion = itemOf(groups, reference)!;

        expect(item.label).toBe(drawn(language, returnValue.name));
        expect(item.label).not.toBe(returnValue.name);
        expect(item.reference).toBe(reference);
      }

      expect(itemOf(groups, BODY_REFERENCE)!.drillIn?.wholeValueLabel).toBe(
        language === "de" ? "Anfragetext als Ganzes" : "کل بدنه درخواست",
      );
    },
  );

  test("de: a step that has run names its values, and the whole of one, in German", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepSampleGroups(
      {
        upstreamComponents: [WEBHOOK_STEP],
        translator: translatorFor("de"),
      },
      [
        {
          componentId: "webhook-1",
          returnValues: {
            "request-body": {
              kind: StepSampleKind.Object,
              preview: "1 field",
              ranAt: "2026-11-15T10:00:00.000Z",
              fields: [
                {
                  path: "environment",
                  kind: StepSampleKind.Text,
                  preview: '"production"',
                },
              ],
            },
          },
        },
      ] as Array<StepSample>,
      {
        formatWhen: (): string => {
          return "vor 5 Minuten";
        },
      },
    );

    const body: ValueSuggestion = itemOf(groups, BODY_REFERENCE)!;

    expect(body.label).toBe("Anfragetext");
    expect(body.drillIn?.wholeValueLabel).toBe("Anfragetext als Ganzes");

    // A field inside it, which a search lists, is named under the drawn name.
    const field: ValueSuggestion | undefined = groups[0]!.items.find(
      (item: ValueSuggestion): boolean => {
        return Boolean(item.searchOnly);
      },
    );

    expect(field?.label.startsWith("Anfragetext › ")).toBe(true);
    expect(field?.searchOnly?.context).toContain("Anfragetext");
  });

  function drawMenu(language: string): void {
    render(
      inLanguage(
        language,
        <ValuePickerProvider
          graphComponents={[WEBHOOK_STEP, API_POST_STEP, LOG_STEP]}
          component={LOG_STEP}
          sources={[createStepValueSource()]}
          valueSources={{
            upstream: [WEBHOOK_STEP, API_POST_STEP],
            downstreamIds: [],
            hasIncomingConnection: true,
          }}
        >
          <ValuePickerMenu hasSearchBox={true} onPick={(): void => {}} />
        </ValuePickerProvider>,
      ),
    );
  }

  function optionFor(reference: string): HTMLElement | undefined {
    return screen
      .queryAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.getAttribute("data-reference") === reference;
      });
  }

  function nameOf(option: HTMLElement): string {
    return (
      (option.querySelector('[data-part="name"]') as HTMLElement | null)
        ?.textContent || ""
    );
  }

  test.each(LANGUAGES)(
    "%s: the list draws each value as the locale words it",
    (language: string) => {
      drawMenu(language);

      expect(nameOf(optionFor(BODY_REFERENCE)!)).toBe(
        drawn(language, "Request Body"),
      );
      expect(nameOf(optionFor(RESPONSE_BODY_REFERENCE)!)).toBe(
        drawn(language, "Response Body"),
      );
    },
  );

  test("de: a search for the German word finds the value", () => {
    drawMenu("de");

    const search: HTMLElement = screen.getByRole("combobox");

    fireEvent.change(search, { target: { value: "antworttext" } });

    expect(
      screen.queryAllByRole("option").map((option: HTMLElement): string => {
        return option.getAttribute("data-reference") || "";
      }),
    ).toEqual([RESPONSE_BODY_REFERENCE]);
  });

  test("fa: looking inside Request Body starts with the whole of it, in Persian", () => {
    drawMenu("fa");

    const body: HTMLElement = optionFor(BODY_REFERENCE)!;

    fireEvent.click(within(body).getByTestId("value-picker-look-inside"));

    expect(screen.queryAllByRole("option")[0]).toHaveTextContent(
      "کل بدنه درخواست",
    );
    expect(screen.queryAllByRole("option")[0]).not.toHaveTextContent(
      "The whole",
    );
  });
});

describe("a reference's chip", () => {
  test("without the reader's translator: the step and value in English", () => {
    const description: ReferenceDescription = describeReference(
      BODY_REFERENCE,
      { graphComponents: [WEBHOOK_STEP, LOG_STEP] },
    )!;

    expect(description.source).toBe("Webhook");
    expect(description.parts).toEqual(["Request Body"]);
  });

  test("fa: the step and its value in Persian, a path into it as written", () => {
    const description: ReferenceDescription = describeReference(
      componentReturnValueReference("webhook-1", "request-body", [
        "environment",
      ]),
      {
        graphComponents: [WEBHOOK_STEP, LOG_STEP],
        translator: translatorFor("fa"),
      },
    )!;

    expect(description.source).toBe("وب‌هوک");
    expect(description.parts).toEqual(["بدنه درخواست", "environment"]);
    expect(description.label).toBe("وب‌هوک › بدنه درخواست › environment");
  });

  test("two steps of one kind are told apart by id, in the reader's words", () => {
    const second: NodeDataProp = stepOf(API_POST, "api-post-2");
    const description: ReferenceDescription = describeReference(
      RESPONSE_BODY_REFERENCE,
      {
        graphComponents: [API_POST_STEP, second, LOG_STEP],
        translator: translatorFor("de"),
      },
    )!;

    expect(description.source).toBe(
      `${drawn("de", API_POST.title)} (api-post-1)`,
    );
    expect(description.parts).toEqual(["Antworttext"]);
  });

  test("de: the picker's provider names a chip with the reader's translator", () => {
    let label: string = "";

    const Probe: () => ReactElement = (): ReactElement => {
      label = useValuePicker().describeReference(BODY_REFERENCE)?.label || "";
      return <span />;
    };

    render(
      inLanguage(
        "de",
        <ValuePickerProvider
          graphComponents={[WEBHOOK_STEP, LOG_STEP]}
          component={LOG_STEP}
          sources={[]}
        >
          <Probe />
        </ValuePickerProvider>,
      ),
    );

    expect(label).toBe(`${drawn("de", "Webhook")} › Anfragetext`);
  });
});

describe("the run log's Received and Returned", () => {
  const STEP: WorkflowStepTraceEntry = {
    componentId: "api-post-1",
    metadataId: API_POST.id,
    title: API_POST.title,
    status: WorkflowStepStatus.Success,
    startedAt: "2026-11-15T10:00:00.000Z",
    completedAt: "2026-11-15T10:00:01.000Z",
    durationInMs: 1000,
    argumentValues: { "request-body": "{}" },
    argumentNames: [{ id: "request-body", name: "Request Body" }],
    returnValues: { "response-body": "{}", "response-status": 200 },
    returnValueNames: [
      { id: "response-status", name: "Response Status" },
      { id: "response-body", name: "Response Body" },
    ],
    executedPort: "success",
  };

  function drawStep(language: string): Array<string> {
    render(inLanguage(language, <StepTraceViewer trace={{ steps: [STEP] }} />));

    if (screen.queryAllByTestId("workflow-run-step-value").length === 0) {
      fireEvent.click(
        within(screen.getByTestId("workflow-run-step")).getAllByRole(
          "button",
        )[0]!,
      );
    }

    return screen
      .getAllByTestId("workflow-run-step-value-name")
      .map((name: HTMLElement): string => {
        return name.textContent || "";
      });
  }

  test.each(LANGUAGES)(
    "%s: a setting and the values returned, named as the locale words them",
    (language: string) => {
      expect(drawStep(language)).toEqual([
        drawn(language, "Request Body"),
        drawn(language, "Response Status"),
        drawn(language, "Response Body"),
      ]);
    },
  );

  test("fa: Response Body in Persian, with the id it is read by beside it", () => {
    expect(drawStep("fa")).toContain("بدنه پاسخ");
    expect(screen.getByText("response-body")).toBeInTheDocument();
  });
});
