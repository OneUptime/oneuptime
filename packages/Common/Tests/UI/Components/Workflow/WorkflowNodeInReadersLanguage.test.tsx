/*
 * A WORKFLOW STEP'S CARD IN THE READER'S LANGUAGE, AS THE PICKER WRITES IT.
 *
 * The component picker writes each step's name and description in the
 * reader's language where the step catalogue has its words (PickerItems'
 * translateText), and so does the step's settings panel (SideOver). The
 * card on the canvas showed the catalogue's English on every page: a step
 * picked as "لاگ" landed on the canvas as "Log". The card now looks the
 * same words up: its name, its description and its own outputs (Success,
 * Error, Default...), while a Switch / Case's cases keep the names the
 * person gave them. Words a language has not translated yet stay English.
 */

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

import WorkflowNode from "../../../../UI/Components/Workflow/Component";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import ComponentMetadata, {
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import { getComponentOutPorts } from "../../../../Types/Workflow/ComponentOutPorts";
import { SWITCH_ARGUMENT_IDS } from "../../../../Types/Workflow/Components/Switch";
import {
  createSwitchCase,
  SwitchCase,
  toStoredSwitchCases,
} from "../../../../Types/Workflow/Components/SwitchCases";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";

const metadataOf: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
};

const LOG: ComponentMetadata = metadataOf(ComponentID.Log);
const SWITCH: ComponentMetadata = metadataOf(ComponentID.Switch);

// The words a locale has for the catalogue: Persian's, and German's.
const PERSIAN: Record<string, string> = {
  [LOG.title]: "لاگ",
  [LOG.description]: "مقدار خود را در لاگ اجرا می‌نویسد.",
  Out: "خروجی",
  Default: "پیش‌فرض",
  // A word a case is also named: the case keeps the name it was given.
  production: "تولید",
};

const GERMAN: Record<string, string> = {
  [LOG.title]: "Protokoll",
  [LOG.description]: "Schreibt seinen Wert in das Protokoll des Laufs.",
  Out: "Aus",
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  const resources: Record<string, Record<string, string>> = {
    en: {},
    de: GERMAN,
    fa: PERSIAN,
  };

  for (const language of Object.keys(resources)) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: resources[language] || {} },
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

const dataOf: (
  metadata: ComponentMetadata,
  args: WorkflowNodeRenderData["arguments"],
) => WorkflowNodeRenderData = (
  metadata: ComponentMetadata,
  args: WorkflowNodeRenderData["arguments"],
): WorkflowNodeRenderData => {
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
};

const draw: (language: string, data: WorkflowNodeRenderData) => void = (
  language: string,
  data: WorkflowNodeRenderData,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <WorkflowNode data={data} selected={false} />
    </I18nextProvider>,
  );
};

const outputNames: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByTestId("workflow-node-output")
    .map((output: HTMLElement): string => {
      return output.textContent || "";
    });
};

describe("a step's card in the reader's language", () => {
  test("Persian: the catalogue's name, description and output in Persian, each read from the right", () => {
    draw("fa", dataOf(LOG, { value: "Checked" }));

    const title: HTMLElement = screen.getByTestId("workflow-node-title");
    const description: HTMLElement = screen.getByTestId(
      "workflow-node-description",
    );

    expect(title).toHaveTextContent("لاگ");
    // Said whole under the pointer, in the same words.
    expect(title).toHaveAttribute("title", "لاگ");
    expect(title).toHaveAttribute("dir", "rtl");
    expect(description).toHaveTextContent("مقدار خود را در لاگ اجرا می‌نویسد.");
    expect(description).toHaveAttribute("dir", "rtl");
    expect(outputNames()).toEqual(["خروجی"]);
  });

  test("German: the catalogue's words in German", () => {
    draw("de", dataOf(LOG, { value: "Checked" }));

    expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
      "Protokoll",
    );
    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      "Schreibt seinen Wert in das Protokoll des Laufs.",
    );
    expect(outputNames()).toEqual(["Aus"]);
  });

  test("English: the catalogue's own words, as always", () => {
    draw("en", dataOf(LOG, { value: "Checked" }));

    expect(screen.getByTestId("workflow-node-title").innerHTML).toBe(LOG.title);
    expect(screen.getByTestId("workflow-node-description").innerHTML).toBe(
      LOG.description,
    );
    expect(outputNames()).toEqual(
      (LOG.outPorts || []).map((port: { title: string }): string => {
        return port.title;
      }),
    );
  });

  test("a language with no words for a step keeps the catalogue's English, read left to right", () => {
    const untranslated: ComponentMetadata = {
      ...LOG,
      title: "Send Email",
      description: "Sends an email.",
    };

    draw("fa", dataOf(untranslated, { value: "Checked" }));

    expect(screen.getByTestId("workflow-node-title")).toHaveTextContent(
      "Send Email",
    );
    expect(screen.getByTestId("workflow-node-title")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      "Sends an email.",
    );
  });

  test("a Switch / Case's cases keep the names the person gave them; its Default is the reader's word", () => {
    const args: WorkflowNodeRenderData["arguments"] = buildSwitchArguments([
      "production",
      "staging",
    ]);

    // The outputs the canvas draws: one per case, named by its value, then Default.
    expect(
      getComponentOutPorts({ metadata: SWITCH, arguments: args }).map(
        (port: { title: string }): string => {
          return port.title;
        },
      ),
    ).toEqual(["production", "staging", "Default"]);

    // "production" is a word the Persian file has too: the case keeps its name.
    draw("fa", dataOf(SWITCH, args));

    expect(outputNames()).toEqual(["production", "staging", "پیش‌فرض"]);
  });
});

/*
 * A Switch / Case's settings with these cases, each "is equal to" its name,
 * as the settings save them (toStoredSwitchCases).
 */
function buildSwitchArguments(
  names: Array<string>,
): WorkflowNodeRenderData["arguments"] {
  return {
    [SWITCH_ARGUMENT_IDS.valueToCheck]:
      "{{local.components.trigger.returnValues.data.environment}}",
    [SWITCH_ARGUMENT_IDS.cases]: toStoredSwitchCases(
      names.map((name: string, index: number): SwitchCase => {
        return {
          ...createSwitchCase(`case-${index + 1}`),
          value: name,
        };
      }),
    ),
  };
}
