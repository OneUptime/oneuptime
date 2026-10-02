/*
 * Helpers for driving the value picker in jsdom.
 *
 * - The chip editor is a contenteditable element. user-event types into it
 *   faithfully, but its click works out a caret offset jsdom then refuses, so
 *   tests put the caret where they want it themselves (placeCaret).
 * - user-event reads "{" and "[" as the start of a key name; keys() doubles
 *   them so "{{" types two braces.
 * - The picker's values come from sources. withPicker provides fixed ones,
 *   so a test says exactly what is on offer without mocking the API.
 */

import { CHIP_REFERENCE_ATTRIBUTE } from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceChip";
import {
  serializeTemplateEditor,
  writeTemplateSelection,
} from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextDom";
import { StepValueSources } from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import { ValuePickerProvider } from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import {
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import IconProp from "../../../../../Types/Icon/IconProp";
import { NodeDataProp } from "../../../../../Types/Workflow/Component";
import React, { ReactElement, ReactNode } from "react";

export const BODY: string =
  "{{local.components.webhook-1.returnValues.request-body}}";
export const HEADERS: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";
export const DEPLOY_ENV: string = "{{local.variables.DEPLOY_ENV}}";
export const API_KEY: string = "{{global.variables.API_KEY}}";

/** The webhook's values and two variables, as the picker would list them. */
export const SAMPLE_GROUPS: Array<ValueSuggestionGroup> = [
  {
    id: "step:webhook-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "Webhook",
    subtitle: "webhook-1",
    iconProp: IconProp.Bolt,
    order: 0,
    items: [
      {
        reference: BODY,
        label: "Request Body",
        description: "What the request sent.",
        typeLabel: "JSON",
        drillIn: {
          wholeValueLabel: "The whole Request Body",
          allowsPath: true,
          pathPlaceholder: "e.g. title or items[0].name",
        },
      },
      {
        reference: HEADERS,
        label: "Request Headers",
        typeLabel: "Key / value",
      },
    ],
  },
  {
    id: "variables:workflow",
    kind: ValueSuggestionGroupKind.WorkflowVariables,
    title: "Workflow variables",
    iconProp: IconProp.Variable,
    order: 1000,
    items: [{ reference: DEPLOY_ENV, label: "DEPLOY_ENV", badges: ["Secret"] }],
  },
  {
    id: "variables:global",
    kind: ValueSuggestionGroupKind.GlobalVariables,
    title: "Global variables",
    iconProp: IconProp.Globe,
    order: 1001,
    items: [{ reference: API_KEY, label: "API_KEY" }],
  },
];

type StaticSourceFunction = (
  groups: Array<ValueSuggestionGroup>,
) => ValueSuggestionSource;

export const staticSource: StaticSourceFunction = (
  groups: Array<ValueSuggestionGroup>,
): ValueSuggestionSource => {
  return {
    id: "static",
    getGroups: () => {
      return groups;
    },
  };
};

export interface WithPickerOptions {
  groups?: Array<ValueSuggestionGroup> | undefined;
  sources?: Array<ValueSuggestionSource> | undefined;
  graphComponents?: Array<NodeDataProp> | undefined;
  valueSources?: StepValueSources | undefined;
  component?: NodeDataProp | undefined;
}

type WithPickerFunction = (
  children: ReactNode,
  options?: WithPickerOptions,
) => ReactElement;

/** `children` inside a picker offering exactly what the options say. */
export const withPicker: WithPickerFunction = (
  children: ReactNode,
  options: WithPickerOptions = {},
): ReactElement => {
  return (
    <ValuePickerProvider
      graphComponents={options.graphComponents || []}
      component={options.component}
      valueSources={options.valueSources}
      sources={
        options.sources || [staticSource(options.groups || SAMPLE_GROUPS)]
      }
    >
      {children}
    </ValuePickerProvider>
  );
};

type PlaceCaretFunction = (
  editor: HTMLElement,
  start: number,
  end?: number,
) => void;

/** Focus the editor with the caret (or a selection) at these offsets. */
export const placeCaret: PlaceCaretFunction = (
  editor: HTMLElement,
  start: number,
  end?: number,
): void => {
  editor.focus();
  writeTemplateSelection(editor, { start: start, end: end ?? start });
};

type EditorValueFunction = (editor: HTMLElement) => string;

/** The string the editor's content stands for. */
export const editorValue: EditorValueFunction = (
  editor: HTMLElement,
): string => {
  return serializeTemplateEditor(editor);
};

type ChipsInFunction = (editor: HTMLElement) => Array<HTMLElement>;

export const chipsIn: ChipsInFunction = (
  editor: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    editor.querySelectorAll<HTMLElement>(`[${CHIP_REFERENCE_ATTRIBUTE}]`),
  );
};

type KeysFunction = (text: string) => string;

/** Text for user.keyboard, typed literally: "{" and "[" are doubled. */
export const keys: KeysFunction = (text: string): string => {
  return text.replace(/[{[]/g, (character: string) => {
    return character + character;
  });
};
