/*
 * THE VALUE PICKER'S SENTENCES, A CHIP'S PROBLEMS, THE RETURNS TYPE AND THE
 * PATH BETWEEN STEPS, IN THE READER'S LANGUAGE (#8360, #8361, #8570).
 *
 * The builder named a step and its values in the reader's language, but the
 * sentences around them were left as they were:
 *   - the picker's "Runs only when {{step}} takes {{output}}" line filled in
 *     the step's and the output's English ("If / Else", "Yes") beside a
 *     canvas that drew "Wenn / Sonst" and "Ja", and so did its notes on a
 *     record's empty fields and on a step that has not run;
 *   - a reference chip's problems were English sentences glued in code, and
 *     a variable chip said "Variable" or "Global variable" in English;
 *   - a step's Returns list named a value's kind by the code's type
 *     ("Dictionary of String"), where the picker says "Key / value";
 *   - a screen reader heard "which led to" and "Leads to" stuck between a
 *     step and its next steps in English's order.
 *
 * These draw each with the Dashboard's real locale files: English, German,
 * Arabic, Persian and Japanese, whose verb comes after the steps.
 */

// The step catalogue imports the database-model registry, which nothing here reads.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import { returnValueTypeLabel } from "../../../../UI/Components/Workflow/ReturnValueNames";
import StepTraceViewer, {
  LED_TO_SENTENCE,
} from "../../../../UI/Components/Workflow/StepTraceViewer";
import { LEADS_TO_SENTENCE } from "../../../../UI/Components/Workflow/Switch/SwitchEditor";
import {
  ReferenceDescription,
  ReferenceProblemCopy,
  ReferenceTone,
  describeReference,
} from "../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import { chipTitle } from "../../../../UI/Components/Workflow/ValuePicker/ReferenceChip";
import {
  NOT_RUN_NOTE,
  notRunNote,
} from "../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  StepValueCopy,
  buildStepValueGroups,
} from "../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import {
  ValueSuggestionGroup,
  ValueSuggestionSentence,
  typeLabelForInputType,
} from "../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import ValuePickerMenu from "../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import { createTranslator, Translator } from "../../../../Types/Translator";
import ComponentMetadata, {
  ComponentInputType,
  NodeDataProp,
  NodeType,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import { SELECT_FIELDS_NAME } from "../../../../Types/Workflow/Components/BaseModel";
import {
  WorkflowStepStatus,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withPicker } from "./ValuePicker/ValuePickerTestUtils";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
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

const LANGUAGES: Array<string> = ["en", "de", "ar", "fa", "ja"];
const LOCALES: Record<string, Record<string, string>> = {};
const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    LOCALES[language] = localeOf(language);

    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: LOCALES[language] },
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

function translatorFor(language: string): Translator {
  return createTranslator((text: string): string | undefined => {
    const value: string | undefined = LOCALES[language]?.[text];

    return value && value !== text ? value : undefined;
  }, language);
}

// The words a language's Dashboard has for an English name, or the English.
function drawn(language: string, english: string): string {
  const value: string | undefined = LOCALES[language]?.[english];

  return language !== "en" && typeof value === "string" && value.trim()
    ? value
    : english;
}

function inLanguage(language: string, children: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={instances[language]!}>{children}</I18nextProvider>
  );
}

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
}

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

const IF_ELSE: NodeDataProp = stepOf(metadataOf(ComponentID.IfElse), "if-1");
const SWITCH: NodeDataProp = stepOf(metadataOf(ComponentID.Switch), "switch-1");
const API_POST: NodeDataProp = stepOf(
  metadataOf(ComponentID.ApiPost),
  "api-post-1",
);
const SLACK: NodeDataProp = stepOf(
  metadataOf(ComponentID.SlackSendMessageToChannel),
  "slack-1",
);
const WEBHOOK: ComponentMetadata = metadataOf(ComponentID.Webhook);

// What the picker says about API Post, reached only through `before`'s output.
function sometimesLine(before: {
  branchStep: NodeDataProp;
  portTitle: string;
  portId: string;
}): ValueSuggestionSentence {
  const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
    component: SLACK,
    upstreamComponents: [before.branchStep, API_POST],
    sometimesSteps: { "api-post-1": before },
  });
  const group: ValueSuggestionGroup | undefined = groups.find(
    (candidate: ValueSuggestionGroup): boolean => {
      return candidate.id === "step:api-post-1";
    },
  );

  return group?.availability?.reason as ValueSuggestionSentence;
}

const AFTER_YES: {
  branchStep: NodeDataProp;
  portTitle: string;
  portId: string;
} = { branchStep: IF_ELSE, portTitle: "Yes", portId: "yes" };

// A Switch / Case whose case the person named "Error".
const AFTER_CASE: {
  branchStep: NodeDataProp;
  portTitle: string;
  portId: string;
} = { branchStep: SWITCH, portTitle: "Error", portId: "case-1" };

const NEW_KEYS: ReadonlyArray<string> = [
  ReferenceProblemCopy.noSuchStep,
  ReferenceProblemCopy.noSuchValue,
  ReferenceProblemCopy.ownValue,
  ReferenceProblemCopy.runsAfter,
  ReferenceProblemCopy.notPassedOn,
  ReferenceProblemCopy.noSuchWorkflowVariable,
  ReferenceProblemCopy.noSuchGlobalVariable,
  ReferenceProblemCopy.variable,
  ReferenceProblemCopy.globalVariable,
  NOT_RUN_NOTE,
  LED_TO_SENTENCE,
  LEADS_TO_SENTENCE,
  StepValueCopy.sometimesWhen,
  StepValueCopy.notPassedOn,
  StepValueCopy.onDeletePassesOnId,
];

const TYPE_LABELS: ReadonlyArray<string> = Object.values(
  ComponentInputType,
).flatMap((type: ComponentInputType): Array<string> => {
  const label: string | undefined = typeLabelForInputType(type);

  return label ? [label] : [];
});

describe("the sentences' keys", () => {
  test("are keys of English, each with its placeholders", () => {
    for (const key of NEW_KEYS) {
      expect({ key, english: LOCALES["en"]![key] }).toEqual({
        key,
        english: key,
      });
    }

    expect(LED_TO_SENTENCE).toContain("{{steps}}");
    expect(LEADS_TO_SENTENCE).toContain("{{steps}}");
    expect(NOT_RUN_NOTE).toContain("{{step}}");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them, and every kind of value the picker names",
    (language: string) => {
      expect(
        [...NEW_KEYS, ...TYPE_LABELS].filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);
    },
  );

  test("the kinds of value include the ones #8361 found in English", () => {
    expect(TYPE_LABELS).toContain("Key / value");
    expect(TYPE_LABELS).toContain("Yes / No");
    expect(TYPE_LABELS).toContain("Records");
    expect(TYPE_LABELS).toContain("Any type");
  });
});

describe("the picker's sometimes line (#8360)", () => {
  test("names If / Else and its Yes as the canvas draws them, in every language", () => {
    for (const language of LANGUAGES) {
      const sentence: ValueSuggestionSentence = sometimesLine(AFTER_YES);
      const said: string = translatorFor(language).translateTemplate(
        sentence.template,
        sentence.values || {},
      );

      expect(said).toContain(drawn(language, "If / Else"));
      expect(said).toContain(drawn(language, "Yes"));

      if (language !== "en") {
        expect(said).not.toContain("If / Else");
      }
    }

    expect(
      translatorFor("de").translateTemplate(
        sometimesLine(AFTER_YES).template,
        sometimesLine(AFTER_YES).values || {},
      ),
    ).toContain("Wenn / Sonst");
  });

  test("keeps a Switch / Case's case as the person named it", () => {
    const sentence: ValueSuggestionSentence = sometimesLine(AFTER_CASE);

    for (const language of ["de", "fa"]) {
      const said: string = translatorFor(language).translateTemplate(
        sentence.template,
        sentence.values || {},
      );

      // "Error" is a word every locale has: the case is not translated.
      expect(drawn(language, "Error")).not.toBe("Error");
      expect(said).toContain("Error");
      expect(said).not.toContain(drawn(language, "Error"));
      expect(said).toContain(drawn(language, "Switch / Case"));
    }
  });

  test.each(["de", "fa", "ar"])(
    "%s: the menu draws the whole line in the reader's language",
    (language: string) => {
      const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
        component: SLACK,
        upstreamComponents: [IF_ELSE, API_POST],
        sometimesSteps: { "api-post-1": AFTER_YES },
      });

      render(
        inLanguage(
          language,
          withPicker(
            <ValuePickerMenu hasSearchBox={true} onPick={() => {}} />,
            {
              groups: groups,
            },
          ),
        ),
      );

      const line: HTMLElement = screen.getByTestId("value-picker-sometimes");

      expect(line).toHaveTextContent(drawn(language, "If / Else"));
      expect(line).toHaveTextContent(drawn(language, "Yes"));
      expect(line).not.toHaveTextContent("If / Else");
      expect(line).not.toHaveTextContent("Runs only when");
    },
  );

  test("without the reader's translator, the English it always said", () => {
    const sentence: ValueSuggestionSentence = sometimesLine(AFTER_YES);

    expect(
      createTranslator(undefined, "en").translateTemplate(
        sentence.template,
        sentence.values || {},
      ),
    ).toBe(
      "Runs only when If / Else takes Yes, so its values can be empty here.",
    );
  });
});

describe("the picker's notes (#8360)", () => {
  test("a step that has not run is named as the canvas names it", () => {
    expect(notRunNote(API_POST)).toBe(
      "API Post (JSON) hasn't run yet. Its fields show up here after it does.",
    );

    const german: string = notRunNote(API_POST, translatorFor("de"));

    expect(german).toContain(drawn("de", "API Post (JSON)"));
    expect(german).not.toContain("hasn't run yet");

    const japanese: string = notRunNote(API_POST, translatorFor("ja"));

    expect(japanese).toContain(drawn("ja", "API Post (JSON)"));
    expect(japanese.indexOf(drawn("ja", "API Post (JSON)"))).toBe(0);
  });

  test("a step without a catalogue title is named by its id", () => {
    expect(
      notRunNote(
        { ...API_POST, metadata: { ...API_POST.metadata, title: "" } },
        translatorFor("de"),
      ),
    ).toContain("api-post-1");
  });

  test("a record's empty fields name the step and its Fields to pass on in the reader's words", () => {
    const sentence: string = translatorFor("de").translateTemplate(
      StepValueCopy.notPassedOn,
      {
        step: "On Update Incident",
        setting: drawn("de", SELECT_FIELDS_NAME),
      },
    );

    expect(sentence).toContain(drawn("de", SELECT_FIELDS_NAME));
    expect(sentence).not.toContain("doesn't pass these on");
  });
});

describe("a reference chip's problems (#8360)", () => {
  const graph: Array<NodeDataProp> = [IF_ELSE, API_POST, SLACK];

  function describe_(
    reference: string,
    language: string | null,
    extra: Partial<Parameters<typeof describeReference>[1]> = {},
  ): ReferenceDescription {
    return describeReference(reference, {
      graphComponents: graph,
      editedComponentId: "slack-1",
      downstreamIds: [],
      variableNames: { workflow: ["DEPLOY_ENV"], global: ["API_KEY"] },
      translator: language ? translatorFor(language) : undefined,
      ...extra,
    }) as ReferenceDescription;
  }

  test("without the reader's translator: the English sentences they always were", () => {
    expect(
      describe_("{{local.components.nope.returnValues.x}}", null).problem,
    ).toBe('No step in this workflow has the ID "nope".');
    expect(
      describe_("{{local.components.api-post-1.returnValues.nope}}", null)
        .problem,
    ).toBe('"API Post (JSON)" does not return anything called "nope".');
    expect(describe_("{{local.variables.MISSING}}", null).problem).toBe(
      'There is no workflow variable called "MISSING".',
    );
    expect(describe_("{{global.variables.MISSING}}", null).problem).toBe(
      'There is no global variable called "MISSING".',
    );
    expect(describe_("{{local.variables.DEPLOY_ENV}}", null).source).toBe(
      "Variable",
    );
    expect(describe_("{{global.variables.API_KEY}}", null).source).toBe(
      "Global variable",
    );
  });

  test.each(["de", "fa", "ar", "ja"])(
    "%s: every problem is a sentence of the reader's language, the ids as written",
    (language: string) => {
      const missingStep: ReferenceDescription = describe_(
        "{{local.components.nope.returnValues.x}}",
        language,
      );
      const missingValue: ReferenceDescription = describe_(
        "{{local.components.api-post-1.returnValues.nope}}",
        language,
      );
      const runsAfter: ReferenceDescription = describe_(
        "{{local.components.api-post-1.returnValues.response-body}}",
        language,
        { downstreamIds: ["api-post-1"] },
      );
      const ownValue: ReferenceDescription = describe_(
        "{{local.components.slack-1.returnValues.error}}",
        language,
      );
      const missingVariable: ReferenceDescription = describe_(
        "{{local.variables.MISSING}}",
        language,
      );
      const missingGlobal: ReferenceDescription = describe_(
        "{{global.variables.MISSING}}",
        language,
      );

      for (const description of [
        missingStep,
        missingValue,
        runsAfter,
        ownValue,
        missingVariable,
        missingGlobal,
      ]) {
        expect(description.tone).toBe(ReferenceTone.Warning);
        expect(description.problem).toBeDefined();
      }

      expect(missingStep.problem).toContain("nope");
      expect(missingStep.problem).not.toContain("No step in this workflow");
      expect(missingValue.problem).toContain(
        drawn(language, "API Post (JSON)"),
      );
      expect(missingValue.problem).toContain("nope");
      expect(missingValue.problem).not.toContain("does not return anything");
      expect(runsAfter.problem).toContain(drawn(language, "API Post (JSON)"));
      expect(runsAfter.problem).not.toContain("runs after this step");
      expect(ownValue.problem).toBe(
        drawn(language, ReferenceProblemCopy.ownValue),
      );
      expect(missingVariable.problem).toContain("MISSING");
      expect(missingVariable.problem).not.toContain("There is no");
      expect(missingGlobal.problem).toContain("MISSING");
      expect(missingGlobal.problem).not.toBe(missingVariable.problem);
    },
  );

  test("de: a variable chip says where its value comes from in German", () => {
    expect(describe_("{{local.variables.DEPLOY_ENV}}", "de").source).toBe(
      drawn("de", "Variable"),
    );
    expect(describe_("{{global.variables.API_KEY}}", "de").source).toBe(
      "Globale Variable",
    );
  });

  test("de: a warning chip's tooltip reads its problem in German, under the reference as stored", () => {
    const reference: string =
      "{{local.components.api-post-1.returnValues.nope}}";
    const title: string = chipTitle(describe_(reference, "de"), reference);

    expect(title.split("\n")[0]).toBe(reference);
    expect(title).toContain(drawn("de", "API Post (JSON)"));
    expect(title).not.toContain("does not return anything called");
  });
});

describe("a step's Returns list names a value's kind as the picker does (#8361)", () => {
  const HEADERS: ReturnValue = WEBHOOK.returnValues.find(
    (returnValue: ReturnValue): boolean => {
      return returnValue.type === ComponentInputType.StringDictionary;
    },
  ) as ReturnValue;

  test("the code's type name is not drawn, the picker's word is", () => {
    expect(HEADERS.type).toBe("Dictionary of String");
    expect(returnValueTypeLabel(HEADERS)).toBe("Key / value");
    // A kind the picker has no word for keeps its own name.
    expect(returnValueTypeLabel({ type: ComponentInputType.Query })).toBe(
      ComponentInputType.Query,
    );
  });

  test.each(LANGUAGES)(
    "%s: Request Headers' pill reads as the picker names it",
    (language: string) => {
      render(
        inLanguage(
          language,
          <ComponentReturnValueViewer
            name=""
            description=""
            componentId="webhook-1"
            returnValues={WEBHOOK.returnValues}
          />,
        ),
      );

      const pills: Array<string> = screen
        .getAllByTestId("workflow-return-value-type")
        .map((pill: HTMLElement): string => {
          return pill.textContent || "";
        });

      expect(pills).toContain(drawn(language, "Key / value"));
      expect(pills).not.toContain("Dictionary of String");

      if (language === "de") {
        expect(pills).toContain("Schlüssel / Wert");
      }
    },
  );
});

describe("the path between steps, for a screen reader (#8570)", () => {
  function aStep(
    overrides: Partial<WorkflowStepTraceEntry>,
  ): WorkflowStepTraceEntry {
    return {
      componentId: "if-1",
      metadataId: "if-else",
      title: "If / Else",
      status: WorkflowStepStatus.Success,
      startedAt: "2024-01-01T00:00:00.000Z",
      completedAt: "2024-01-01T00:00:01.000Z",
      durationInMs: 1000,
      argumentValues: {},
      returnValues: {},
      executedPort: "yes",
      executedPortTitle: "Yes",
      ...overrides,
    };
  }

  function drawTrace(language: string): HTMLElement {
    render(
      inLanguage(
        language,
        <StepTraceViewer
          trace={{
            steps: [
              aStep({
                nextSteps: [{ componentId: "log-1", title: "Log" }],
              }),
              aStep({
                componentId: "log-1",
                metadataId: "log",
                title: "Log",
                executedPort: "out",
                executedPortTitle: "Out",
              }),
            ],
          }}
        />,
      ),
    );

    return screen.getAllByTestId("workflow-run-step-outcome")[0]!;
  }

  test.each(LANGUAGES)(
    "%s: the words are one sentence around the steps, read only",
    (language: string) => {
      const outcome: HTMLElement = drawTrace(language);
      const words: Array<HTMLElement> = Array.from(
        outcome.querySelectorAll(
          "[data-testid='workflow-run-step-led-to-words']",
        ),
      );

      expect(words.length).toBeGreaterThan(0);

      for (const word of words) {
        expect(word).toHaveClass("sr-only");
      }

      const template: string = drawn(language, LED_TO_SENTENCE);
      const before: string = template.split("{{steps}}")[0]!.trim();
      const after: string = template.split("{{steps}}")[1]!.trim();
      const text: string = outcome.textContent || "";
      const stepAt: number = text.indexOf("log-1");

      // The language's words stand where its sentence puts them.
      if (before) {
        expect(text.indexOf(before)).toBeLessThan(stepAt);
      }

      if (after) {
        expect(text.lastIndexOf(after)).toBeGreaterThan(stepAt);
      }

      if (language !== "en") {
        expect(text).not.toContain("which led to");
      }
    },
  );

  test("ja: the verb comes after the steps, as Japanese says it", () => {
    const outcome: HTMLElement = drawTrace("ja");
    const text: string = outcome.textContent || "";

    expect(drawn("ja", LED_TO_SENTENCE).endsWith("に進みました")).toBe(true);
    expect(text.indexOf("に進みました")).toBeGreaterThan(text.indexOf("log-1"));
  });

  test("the Switch / Case editor's Leads to is one sentence of each language, its steps a slot", () => {
    for (const language of ["de", "fa", "ja"]) {
      const template: string = drawn(language, LEADS_TO_SENTENCE);

      expect(template).toContain("{{steps}}");
      expect(template).not.toBe(LEADS_TO_SENTENCE);
    }

    expect(drawn("ja", LEADS_TO_SENTENCE).startsWith("進む先")).toBe(true);
  });
});
