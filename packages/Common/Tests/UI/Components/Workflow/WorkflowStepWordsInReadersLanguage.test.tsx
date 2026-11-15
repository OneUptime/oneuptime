/*
 * A BUILT-IN STEP DRAWN IN THE READER'S LANGUAGE, WORD FOR WORD (#8359).
 *
 * The builder looked every word of a step up, but the step catalogue had
 * no keys: API Post's card read "API Post (JSON)" and "Send a POST Request
 * and get JSON Response" in every language, its Returns list "Fehler,
 * Response Status, Antwort-Header, Antworttext" in German, and the IRC
 * step's settings mixed "IRC Server" and "Nickname" with "Kanal" and
 * "Port". Every word of the catalogue is a key now, worded in every
 * language (WorkflowStepWordsInEveryLanguage).
 *
 * These draw the canvas card, the settings form and the Returns list with
 * the Dashboard's real English, German, Arabic and Persian locale files,
 * so the docs can quote each word as drawn.
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

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import WorkflowNode from "../../../../UI/Components/Workflow/Component";
import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
  Port,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
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

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
}

const API_POST: ComponentMetadata = metadataOf(ComponentID.ApiPost);
const IRC: ComponentMetadata = metadataOf(ComponentID.IRCSendMessageToChannel);
const IF_ELSE: ComponentMetadata = metadataOf(ComponentID.IfElse);
const PAGE_USERS: ComponentMetadata = metadataOf(ComponentID.PageUsers);

// The words a language's Dashboard has for an English name, or the English.
function drawn(language: string, english: string): string {
  const value: string | undefined = LOCALES[language]?.[english];

  return language !== "en" && typeof value === "string" && value.trim()
    ? value
    : english;
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

function outputNames(): Array<string> {
  return screen
    .getAllByTestId("workflow-node-output")
    .map((output: HTMLElement): string => {
      return output.textContent || "";
    });
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

// The settings form's field labels: each setting's title, as drawn.
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

describe("the locales word the step words these draw", () => {
  test("each is a key of English and has words of its own in German, Arabic and Persian", () => {
    for (const english of [
      API_POST.title,
      API_POST.description,
      IRC.title,
      IF_ELSE.title,
      PAGE_USERS.title,
      "Response Status",
      "IRC Server",
      "Nickname",
      "Host name of the IRC server, such as irc.libera.chat. The port goes in Port, under More fields.",
      "The HTTP status code the server answered with, 200 for example.",
    ]) {
      expect(LOCALES["en"]![english]).toBe(english);

      for (const language of TRANSLATED) {
        expect({
          language,
          english,
          worded: drawn(language, english) !== english,
        }).toEqual({
          language,
          english,
          worded: true,
        });
      }
    }

    expect(drawn("de", "API Post (JSON)")).toBe("API-Aufruf POST (JSON)");
    expect(drawn("de", "Response Status")).toBe("Antwortstatus");
    expect(drawn("de", "IRC Server")).toBe("IRC-Server");
    expect(drawn("fa", "If / Else")).toBe("اگر / وگرنه");
    expect(drawn("ar", "If / Else")).toBe("إذا / وإلا");
  });
});

describe("the canvas card", () => {
  test.each(LANGUAGES)(
    "%s: API Post's title, what it does and its outputs, as the locale words them",
    (language: string) => {
      drawCard(language, API_POST);

      const title: HTMLElement = screen.getByTestId("workflow-node-title");

      expect(title).toHaveTextContent(drawn(language, API_POST.title));
      expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
        drawn(language, API_POST.description),
      );
      expect(outputNames()).toEqual(
        API_POST.outPorts.map((port: Port): string => {
          return drawn(language, port.title);
        }),
      );

      if (language === "en") {
        expect(title).toHaveTextContent("API Post (JSON)");
      } else {
        expect(title).not.toHaveTextContent("API Post (JSON)");
        expect(
          screen.getByTestId("workflow-node-description"),
        ).not.toHaveTextContent("Send a POST Request");
      }

      if (RIGHT_TO_LEFT.includes(language)) {
        expect(title).toHaveAttribute("dir", "rtl");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: If / Else and Send Message to IRC are no longer English beside their own outputs",
    (language: string) => {
      drawCard(language, IF_ELSE);

      expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
        drawn(language, "If / Else"),
      );
      expect(outputNames()).toEqual([
        drawn(language, "Yes"),
        drawn(language, "No"),
      ]);

      cleanup();
      drawCard(language, IRC);

      expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
        drawn(language, "Send Message to IRC"),
      );
    },
  );

  test("de: the cards read German words, the English ones gone", () => {
    drawCard("de", PAGE_USERS);

    expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
      "Benutzer alarmieren",
    );
    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      "Alarmiert die genannten Personen nach deren eigenen Bereitschaftsregeln.",
    );
  });
});

describe("the settings form", () => {
  test.each(LANGUAGES)(
    "%s: Send Message to IRC titles every setting as the locale words it",
    async (language: string) => {
      drawSettings(language, IRC);

      await waitFor(() => {
        expect(fieldLabels()).toContain(drawn(language, "IRC Server"));
      });

      const labels: string = fieldLabels();

      for (const name of [
        "IRC Server",
        "Channel",
        "Message Text",
        "Nickname",
      ]) {
        expect({
          language,
          name,
          drawn: labels.includes(drawn(language, name)),
        }).toEqual({
          language,
          name,
          drawn: true,
        });
      }

      if (language !== "en") {
        expect(labels).not.toContain("IRC Server");
        expect(labels).not.toContain("Nickname");
      }
    },
  );

  test.each(TRANSLATED)(
    "%s: a setting's help reads in the reader's words",
    async (language: string) => {
      drawSettings(language, IRC);

      const help: string = drawn(
        language,
        argumentOf(IRC, "server").description,
      );

      await waitFor(() => {
        expect(document.body.textContent).toContain(help);
      });

      expect(document.body.textContent).not.toContain(
        "Host name of the IRC server",
      );
    },
  );

  test("fa: API Post's settings in Persian, its example URL as written", async () => {
    drawSettings("fa", API_POST);

    await waitFor(() => {
      expect(fieldLabels()).toContain(drawn("fa", "Request Body"));
    });

    expect(fieldLabels()).toContain(drawn("fa", "URL"));
    // An example of what to type is no key: it is drawn as written.
    expect(LOCALES["en"]!["https://api.yourcompany.com"]).toBeUndefined();
    expect(document.body.innerHTML).toContain("https://api.yourcompany.com");
  });
});

describe("the Returns list", () => {
  test.each(LANGUAGES)(
    "%s: API Post returns its four values in the reader's words, each read by its id",
    (language: string) => {
      drawReturns(language, API_POST);

      expect(textsOf("workflow-return-value-name")).toEqual(
        API_POST.returnValues.map((returnValue: ReturnValue): string => {
          return drawn(language, returnValue.name);
        }),
      );
      expect(textsOf("workflow-return-value-description")).toEqual(
        API_POST.returnValues.map((returnValue: ReturnValue): string => {
          return drawn(language, returnValue.description);
        }),
      );
      // The reference a later step stores is the value's id, in every language.
      expect(document.body.textContent).toContain(
        "{{local.components.api-post-json-1.returnValues.response-status}}".replace(
          "api-post-json-1",
          `${API_POST.id}-1`,
        ),
      );

      if (language !== "en") {
        expect(textsOf("workflow-return-value-name")).not.toContain(
          "Response Status",
        );
      }
    },
  );

  test("de: the list #8359 quoted reads wholly in German now", () => {
    drawReturns("de", API_POST);

    expect(textsOf("workflow-return-value-name")).toEqual([
      "Fehler",
      "Antwortstatus",
      "Antwort-Header",
      "Antworttext",
    ]);
  });

  test("fa: Page Users returns Paged Users in Persian", () => {
    drawReturns("fa", PAGE_USERS);

    expect(textsOf("workflow-return-value-name")).toContain(
      drawn("fa", "Paged Users"),
    );
    expect(textsOf("workflow-return-value-name")).not.toContain("Paged Users");
  });
});
