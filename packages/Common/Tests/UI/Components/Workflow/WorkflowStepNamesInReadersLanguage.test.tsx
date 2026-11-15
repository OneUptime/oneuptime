/*
 * A WORKFLOW STEP'S OWN NAMES IN THE READER'S LANGUAGE (#7511).
 *
 * The workflow docs named a step's outputs (Success, Error, Yes, No) and
 * its settings (Incident Template, Message Text, Port, Channel) in English
 * in every language, as the builder once drew them. It no longer does:
 *   - the settings form titles each setting with its name, looked up
 *     (ArgumentsForm hands arg.name to FieldLabel, which translates it);
 *   - the canvas draws each output in the reader's words
 *     (WorkflowNodeInReadersLanguage);
 *   - and the settings panel's Outputs list does too, as the canvas does,
 *     while a Switch / Case's cases keep the names the person gave them.
 *     It drew every output in English, beside a translated canvas.
 * These tests draw both with the Dashboard's real German and Persian
 * locale files, so the docs can name the same words.
 */

// Utils.ts imports the database-model registry, which nothing here reads.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
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

import Incident from "../../../../Models/DatabaseModels/Incident";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import ComponentPortViewer from "../../../../UI/Components/Workflow/ComponentPortViewer";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
  Port,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponents from "../../../../Types/Workflow/Components/BaseModel";
import { getComponentOutPorts } from "../../../../Types/Workflow/ComponentOutPorts";
import { SWITCH_ARGUMENT_IDS } from "../../../../Types/Workflow/Components/Switch";
import {
  createSwitchCase,
  SwitchCase,
  toStoredSwitchCases,
} from "../../../../Types/Workflow/Components/SwitchCases";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
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

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
}

const CREATE_ONE_INCIDENT: ComponentMetadata = {
  ...BaseModelComponents.getComponents(new Incident()).find(
    (component: ComponentMetadata): boolean => {
      return component.id === "incident-create-one";
    },
  )!,
};

// The JSON editor for JSON Object, not the row editor, which reads the server.
delete CREATE_ONE_INCIDENT.tableName;

const IRC: ComponentMetadata = metadataOf(ComponentID.IRCSendMessageToChannel);
const API_POST: ComponentMetadata = metadataOf(ComponentID.ApiPost);
const IF_ELSE: ComponentMetadata = metadataOf(ComponentID.IfElse);
const SWITCH: ComponentMetadata = metadataOf(ComponentID.Switch);

// The words a language's Dashboard has for an English name, or the English.
function drawn(language: string, english: string): string {
  const value: string | undefined = LOCALES[language]?.[english];

  return language !== "en" && typeof value === "string" && value.trim()
    ? value
    : english;
}

function nodeOf(
  metadata: ComponentMetadata,
  args: NodeDataProp["arguments"] = {},
): NodeDataProp {
  return {
    error: "",
    id: `${metadata.id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${metadata.id}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function drawSettings(language: string, metadata: ComponentMetadata): void {
  const node: NodeDataProp = nodeOf(metadata);

  render(
    <I18nextProvider i18n={instances[language]!}>
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
      />
    </I18nextProvider>,
  );
}

function argumentNamed(metadata: ComponentMetadata, name: string): Argument {
  return (metadata.arguments || []).find((argument: Argument): boolean => {
    return argument.name === name;
  }) as Argument;
}

// The settings form's field labels: each setting's title, as drawn.
function fieldLabels(): Array<string> {
  return Array.from(document.querySelectorAll("label")).map(
    (label: HTMLLabelElement): string => {
      return (label.textContent || "").trim();
    },
  );
}

function drawOutputs(
  language: string,
  ports: Array<Port>,
  metadata?: ComponentMetadata,
): Array<string> {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <ComponentPortViewer
        name=""
        description=""
        ports={ports}
        metadata={metadata}
      />
    </I18nextProvider>,
  );

  return screen
    .getAllByTestId("workflow-port-title")
    .map((title: HTMLElement): string => {
      return title.textContent || "";
    });
}

describe("a step's settings, titled in the reader's language", () => {
  test("the locales word the settings the docs name", () => {
    for (const name of [
      "Incident Template",
      "Message Text",
      "Port",
      "Channel",
      "Request Body",
    ]) {
      expect(LOCALES["en"]![name]).toBe(name);
      expect(drawn("de", name)).not.toBe("");
      expect(drawn("fa", name)).not.toBe(name);
    }

    expect(argumentNamed(IRC, "Message Text")).toBeDefined();
    expect(argumentNamed(IRC, "Port")).toBeDefined();
    expect(argumentNamed(IRC, "Channel")).toBeDefined();
    expect(
      argumentNamed(CREATE_ONE_INCIDENT, "Incident Template"),
    ).toBeDefined();
  });

  test.each(LANGUAGES)(
    "%s: Create One Incident titles its Incident Template as the locale words it",
    async (language: string) => {
      drawSettings(language, CREATE_ONE_INCIDENT);

      await waitFor(() => {
        expect(fieldLabels().join("\n")).toContain(
          drawn(language, "Incident Template"),
        );
      });

      if (language === "fa") {
        expect(fieldLabels().join("\n")).toContain("قالب حادثه");
        expect(fieldLabels().join("\n")).not.toContain("Incident Template");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: Send Message to IRC titles its Message Text, Port and Channel as the locale words them",
    async (language: string) => {
      drawSettings(language, IRC);

      await waitFor(() => {
        expect(fieldLabels().length).toBeGreaterThan(3);
      });

      const labels: string = fieldLabels().join("\n");

      for (const name of ["Message Text", "Port", "Channel"]) {
        expect({
          language,
          name,
          drawn: labels.includes(drawn(language, name)),
        }).toEqual({ language, name, drawn: true });
      }

      if (language === "de") {
        expect(labels).toContain("Nachrichtentext");
        expect(labels).toContain("Kanal");
      }

      if (language === "fa") {
        expect(labels).toContain("متن پیام");
        expect(labels).toContain("پورت");
        expect(labels).toContain("کانال");
      }
    },
  );

  test("fa: API Post titles its Request Body in Persian", async () => {
    drawSettings("fa", API_POST);

    await waitFor(() => {
      expect(fieldLabels().join("\n")).toContain(drawn("fa", "Request Body"));
    });
    expect(drawn("fa", "Request Body")).not.toBe("Request Body");
  });
});

describe("a step's outputs on its settings panel, in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: If / Else's Yes and No, as the canvas draws them",
    (language: string) => {
      expect(drawOutputs(language, IF_ELSE.outPorts, IF_ELSE)).toEqual(
        IF_ELSE.outPorts.map((port: Port): string => {
          return drawn(language, port.title);
        }),
      );
    },
  );

  test("de and fa: API Post's Success and Error are no longer English", () => {
    expect(drawOutputs("de", API_POST.outPorts, API_POST)).toEqual(
      API_POST.outPorts.map((port: Port): string => {
        return drawn("de", port.title);
      }),
    );
    cleanup();

    const persian: Array<string> = drawOutputs(
      "fa",
      API_POST.outPorts,
      API_POST,
    );

    expect(persian).toContain("موفق");
    expect(persian).not.toContain("Success");
  });

  test("a Switch / Case's cases keep the names the person gave them, its Default reads in the reader's words", () => {
    const cases: Array<SwitchCase> = ["Error", "production"].map(
      (name: string, index: number): SwitchCase => {
        return { ...createSwitchCase(`case-${index + 1}`), value: name };
      },
    );
    const args: NodeDataProp["arguments"] = {
      [SWITCH_ARGUMENT_IDS.cases]: toStoredSwitchCases(cases),
    };
    const ports: Array<Port> = getComponentOutPorts({
      metadata: SWITCH,
      arguments: args,
    });

    const titles: Array<string> = drawOutputs("de", ports, SWITCH);

    // A case named "Error" is the person's word, not the step's output.
    expect(titles).toContain("Error");
    expect(titles).toContain("production");
    expect(titles).toContain(drawn("de", "Default"));
  });

  test("inputs, given no step, read in the reader's words", () => {
    expect(drawOutputs("de", IF_ELSE.inPorts)).toEqual(
      IF_ELSE.inPorts.map((port: Port): string => {
        return drawn("de", port.title);
      }),
    );
  });
});
