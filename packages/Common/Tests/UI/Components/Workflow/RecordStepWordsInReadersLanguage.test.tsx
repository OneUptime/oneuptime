/*
 * A RECORD STEP DRAWN IN THE READER'S LANGUAGE, ITS MODEL'S NAME IN IT (#8642).
 *
 * Each record step's words were built in code from the model's name -
 * `Find One ${model.singularName}`, `On Create ${model.singularName}` and
 * every help line of their settings and values - so no locale had a key for
 * them, and the builder drew "Find One Incident" and "Query that selects
 * which Incidents this component acts on..." in every language.
 *
 * Each is a sentence with the name in it now ("Find One {{itemName}}"),
 * worded in every language, and built as the English it always was
 * (ComposedWords): the builder looks that English up as it always did, and
 * reads it as the sentence the language words, the model's name in the
 * language's own word. These draw the canvas card, the settings form and
 * the Returns list of the Incident's steps with the Dashboard's real
 * English, German, Arabic and Persian locale files.
 */

/*
 * Utils.ts imports the database-model registry, which nothing here reads;
 * the field pickers find no model, and list no fields.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: (): null => {
      return null;
    },
  };
});

// The record's columns, which the field pickers read: none here.
jest.mock("../../../../UI/Components/Workflow/ModelSchema", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Components/Workflow/ModelSchema",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useModelSchema: (): {
      columns: Array<unknown>;
      isLoading: boolean;
      error: null;
    } => {
      return { columns: [], isLoading: false, error: null };
    },
  };
});

// Every list the settings read (templates, variables) is empty.
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
    },
  };
});

// React Flow's Handle needs the canvas's store: each dot is drawn as a plain element.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (): ReactElement => {
      return <span data-testid="handle" />;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    useNodeId: (): string => {
      return "canvas-node-1";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return (): void => {};
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import WorkflowNode from "../../../../UI/Components/Workflow/Component";
import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../../Types/Translator";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];
const TRANSLATED: Array<string> = ["de", "ar", "fa"];
const RIGHT_TO_LEFT: Array<string> = ["ar", "fa"];
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
  jest.clearAllMocks();
});

const RECORD_STEPS: Array<ComponentMetadata> = BaseModelComponent.getComponents(
  new Incident(),
);

function stepTitled(title: string): ComponentMetadata {
  const step: ComponentMetadata | undefined = RECORD_STEPS.find(
    (component: ComponentMetadata): boolean => {
      return component.title === title;
    },
  );

  if (!step) {
    throw new Error(`No record step is titled ${title}`);
  }

  return step;
}

const ON_CREATE: ComponentMetadata = stepTitled("On Create Incident");
const FIND_ONE: ComponentMetadata = stepTitled("Find One Incident");
const DELETE_MANY: ComponentMetadata = stepTitled("Delete Many Incidents");

// How the language's locale reads an English text, as the builder does.
function translatorOf(language: string): Translator {
  return createTranslator((text: string): string | undefined => {
    return LOCALES[language]?.[text];
  }, language);
}

function drawn(language: string, english: string): string {
  return translatorOf(language).translateText(english) || english;
}

function nodeOf(metadata: ComponentMetadata): NodeDataProp {
  return {
    error: "",
    id: `${metadata.id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${metadata.id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function inLanguage(language: string, children: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={instances[language]!}>{children}</I18nextProvider>
  );
}

function drawCard(language: string, metadata: ComponentMetadata): void {
  render(
    inLanguage(
      language,
      <WorkflowNode
        data={nodeOf(metadata) as WorkflowNodeRenderData}
        selected={false}
      />,
    ),
  );
}

function drawSettings(language: string, metadata: ComponentMetadata): void {
  const node: NodeDataProp = nodeOf(metadata);

  render(
    inLanguage(
      language,
      <ArgumentsForm
        component={node}
        workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
        graphComponents={[node]}
        valueSources={{
          upstream: [],
          downstreamIds: [],
          hasIncomingConnection: true,
        }}
        onHasFormValidationErrors={(_errors: Dictionary<boolean>): void => {}}
        onFormChange={(_value: NodeDataProp): void => {}}
      />,
    ),
  );
}

function fieldLabels(): string {
  return Array.from(document.querySelectorAll("label"))
    .map((label: HTMLLabelElement): string => {
      return (label.textContent || "").trim();
    })
    .join("\n");
}

function argumentOf(metadata: ComponentMetadata, id: string): Argument {
  return metadata.arguments.find((argument: Argument): boolean => {
    return argument.id === id;
  }) as Argument;
}

function drawReturns(language: string, metadata: ComponentMetadata): void {
  render(
    inLanguage(
      language,
      <ComponentReturnValueViewer
        name=""
        description=""
        componentId={`${metadata.id}-1`}
        returnValues={metadata.returnValues}
      />,
    ),
  );
}

function textsOf(testId: string): Array<string> {
  return screen.getAllByTestId(testId).map((element: HTMLElement): string => {
    return element.textContent || "";
  });
}

describe("the words a record step is built with", () => {
  test("read as they always did in English", () => {
    expect(ON_CREATE.title).toBe("On Create Incident");
    expect(ON_CREATE.description).toBe("When the Incident is created...");
    expect(FIND_ONE.description).toBe("Database query to find one Incident");
    expect(DELETE_MANY.description).toBe(
      "Delete many Incidents that match a query.",
    );
    expect(argumentOf(FIND_ONE, "query").description).toBe(
      'Query that selects which Incidents this component acts on. Keys are column names on Incident. The ID column is "_id" (the "id" spelling is accepted too).',
    );

    for (const step of RECORD_STEPS) {
      expect(drawn("en", step.title)).toBe(step.title);
      expect(drawn("en", step.description)).toBe(step.description);
    }
  });

  test("read in German, Arabic and Persian as each words the sentence, the model by its own word", () => {
    expect(drawn("de", "On Create Incident")).toBe("Bei Erstellung: Vorfall");
    expect(drawn("de", "Find One Incident")).toBe("Vorfall finden (einzeln)");
    expect(drawn("de", "Delete Many Incidents")).toBe(
      "Vorfälle löschen (mehrere)",
    );
    expect(drawn("de", "Database query to find one Incident")).toBe(
      "Datenbankabfrage, die einen Datensatz vom Typ Vorfall findet",
    );

    expect(drawn("ar", "On Create Incident")).toBe("عند الإنشاء: حادثة");
    expect(drawn("ar", "Find One Incident")).toBe("البحث عن حادثة (سجل واحد)");

    expect(drawn("fa", "On Create Incident")).toBe("هنگام ساخت حادثه");
    expect(drawn("fa", "Find One Incident")).toBe("یافتن یک حادثه");
  });

  test.each(TRANSLATED)(
    "%s: no word of any of the Incident's record steps is left in English",
    (language: string) => {
      const english: Array<string> = [];

      for (const step of RECORD_STEPS) {
        const texts: Array<string> = [step.title, step.description];

        for (const argument of [
          ...step.arguments,
          ...(step.runWorkflowManuallyArguments || []),
        ]) {
          texts.push(argument.name, argument.description);
        }

        for (const returnValue of step.returnValues) {
          texts.push(returnValue.name, returnValue.description);
        }

        for (const text of texts) {
          if (text && drawn(language, text) === text) {
            english.push(`${step.title}: ${text}`);
          }
        }
      }

      expect(english).toEqual([]);
    },
  );
});

describe("the canvas card", () => {
  test.each(LANGUAGES)(
    "%s: On Create Incident's title and what it does, as the locale words them",
    (language: string) => {
      drawCard(language, ON_CREATE);

      const title: HTMLElement = screen.getByTestId("workflow-node-title");

      expect(title).toHaveTextContent(drawn(language, "On Create Incident"));
      expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
        drawn(language, "When the Incident is created..."),
      );

      if (language === "en") {
        expect(title).toHaveTextContent("On Create Incident");
      } else {
        expect(title).not.toHaveTextContent("On Create");
        expect(title).not.toHaveTextContent("Incident");
      }

      if (RIGHT_TO_LEFT.includes(language)) {
        expect(title).toHaveAttribute("dir", "rtl");
      }
    },
  );

  test("de: the card reads German words, the English gone", () => {
    drawCard("de", ON_CREATE);

    expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
      "Bei Erstellung: Vorfall",
    );
    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      "Wenn ein Datensatz vom Typ Vorfall erstellt wird …",
    );
  });
});

describe("the settings form", () => {
  test.each(LANGUAGES)(
    "%s: Find One Incident's query help reads in the reader's words",
    async (language: string) => {
      drawSettings(language, FIND_ONE);

      const help: string = drawn(
        language,
        argumentOf(FIND_ONE, "query").description,
      );

      await waitFor(() => {
        expect(document.body.textContent).toContain(help);
      });

      expect(fieldLabels()).toContain(drawn(language, "Query"));

      if (language !== "en") {
        expect(document.body.textContent).not.toContain(
          "Query that selects which",
        );
        expect(document.body.textContent).not.toContain("Incidents");
      }
    },
  );

  test("fa: the query's help in Persian, the model by its Persian name", async () => {
    drawSettings("fa", FIND_ONE);

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        "پرس‌وجویی که انتخاب می‌کند این قطعه روی کدام رکوردهای حوادث کار کند.",
      );
    });
  });

  test("ar: the manual run's record setting reads in Arabic", async () => {
    const id: Argument = (ON_CREATE.runWorkflowManuallyArguments || []).find(
      (argument: Argument): boolean => {
        return argument.id === "_id";
      },
    ) as Argument;

    expect(id.name).toBe("Incident ID");
    expect(drawn("ar", id.name)).toBe("معرّف الحادثة");
    expect(drawn("ar", id.description)).toBe(
      "أدخل معرّف السجل من نوع حادثة إذا أردت تشغيل سير العمل هذا يدويًا.",
    );
  });
});

describe("the Returns list", () => {
  test.each(LANGUAGES)(
    "%s: Find One Incident returns the Incident, what it holds in the reader's words",
    (language: string) => {
      drawReturns(language, FIND_ONE);

      expect(textsOf("workflow-return-value-description")).toEqual(
        FIND_ONE.returnValues.map((returnValue: ReturnValue): string => {
          return drawn(language, returnValue.description);
        }),
      );

      if (language !== "en") {
        expect(
          textsOf("workflow-return-value-description").join("\n"),
        ).not.toContain("fetched from the database");
      }
    },
  );

  test("de: the Incident fetched from the database, in German", () => {
    drawReturns("de", FIND_ONE);

    expect(textsOf("workflow-return-value-description")).toContain(
      "Aus der Datenbank abgerufener Datensatz vom Typ Vorfall",
    );
  });
});
