/*
 * A workflow step's settings, rendered from the real component definitions.
 *
 * The maintainer's report was the Log step: its Value, a whole sentence, sat
 * in a one-line text box. Free text - a value to log, a message, a prompt, a
 * JSON document written as text - now gets a multi-line box that grows as it
 * fills; code and HTML keep their editors even once a reference is in them;
 * short values stay on one line.
 *
 * The two pickers behind "Pick this value from other component or from
 * variable" are stood in for, so the tests can drive what they hand back; the
 * form, its fields and the step's own state are the real thing.
 */

/*
 * Utils.ts imports the whole database-model registry for
 * loadComponentsAndCategories, which nothing here calls.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

jest.mock("../../../../UI/Components/Workflow/VariableModal", () => {
  return {
    __esModule: true,
    default: (props: VariableModalProps): ReactElement => {
      return (
        <div data-testid="variable-picker">
          <button
            type="button"
            onClick={() => {
              props.onSave("{{local.variables.DEPLOY_ENV}}");
            }}
          >
            Use DEPLOY_ENV
          </button>
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../UI/Components/Workflow/ComponentValuePickerModal",
  () => {
    return {
      __esModule: true,
      default: (props: ValuePickerProps): ReactElement => {
        return (
          <div data-testid="component-value-picker">
            <button
              type="button"
              onClick={() => {
                props.onSave(
                  "{{local.components.webhook-1.returnValues.request-body}}",
                );
              }}
            >
              Use the webhook request body
            </button>
          </div>
        );
      },
    };
  },
);

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import { ComponentProps as VariableModalProps } from "../../../../UI/Components/Workflow/VariableModal";
import { ComponentProps as ValuePickerProps } from "../../../../UI/Components/Workflow/ComponentValuePickerModal";
import Components from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata) => {
      return component.id === id;
    },
  );

  if (!metadata) {
    throw new Error(`No component ${id}`);
  }

  return metadata;
};

type StepFunction = (id: ComponentID, args?: JSONObject) => NodeDataProp;

const step: StepFunction = (
  id: ComponentID,
  args: JSONObject = {},
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: `${id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

interface RenderedStep {
  view: RenderResult;
  onFormChange: MockFunction;
}

type RenderStepFunction = (node: NodeDataProp) => RenderedStep;

const renderStep: RenderStepFunction = (node: NodeDataProp): RenderedStep => {
  const onFormChange: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <ArgumentsForm
      component={node}
      workflowId={ObjectID.generate()}
      graphComponents={[node]}
      onHasFormValidationErrors={(): void => {}}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  return { view, onFormChange };
};

type ControlFunction = (name: string) => HTMLElement;

// The control a field's label names, whatever kind of control it is.
const control: ControlFunction = (name: string): HTMLElement => {
  return screen.getByRole("textbox", {
    name: new RegExp(`^${name}`),
  });
};

type ExpectMultiLineBoxFunction = (element: HTMLElement) => void;

const expectMultiLineBox: ExpectMultiLineBoxFunction = (
  element: HTMLElement,
): void => {
  expect(element.tagName).toBe("TEXTAREA");
  // The plain box, not a code editor's input.
  expect(element).not.toHaveAttribute("data-testid", "code-editor-input");
  expect(element).toHaveAttribute("data-auto-grow", "true");
  expect(element).toHaveAttribute("rows", "3");
};

type LastArgumentsFunction = (onFormChange: MockFunction) => JSONObject;

const lastArguments: LastArgumentsFunction = (
  onFormChange: MockFunction,
): JSONObject => {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;
  const last: NodeDataProp = calls[calls.length - 1]![0] as NodeDataProp;
  return last.arguments;
};

afterEach(() => {
  cleanup();
});

describe("ArgumentsForm — the Log step", () => {
  const SENTENCE: string =
    "ℹ️ Non-production webhook received. Logged without alerting.";

  test("its Value is a multi-line box holding the whole sentence, not a one-line text box", () => {
    renderStep(step(ComponentID.Log, { value: SENTENCE }));

    const value: HTMLElement = control("Value");

    expectMultiLineBox(value);
    expect((value as HTMLTextAreaElement).value).toBe(SENTENCE);
    expect(screen.queryByRole("textbox", { name: /^Value/ })).toBe(value);
    expect(document.querySelector("input[type='text']")).toBeNull();
  });

  test("Enter starts a new line, and the step keeps every line", async () => {
    const { onFormChange } = renderStep(step(ComponentID.Log));

    await userEvent
      .setup({ delay: null })
      .type(control("Value"), "Webhook received.{Enter}Environment: staging");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(
        "Webhook received.\nEnvironment: staging",
      );
    });
  });

  test("a variable picked from the footer appears in the box, after what was there", async () => {
    const { onFormChange } = renderStep(
      step(ComponentID.Log, { value: "Deploying to " }),
    );

    fireEvent.click(screen.getByRole("button", { name: "variable." }));
    fireEvent.click(screen.getByRole("button", { name: "Use DEPLOY_ENV" }));

    await waitFor(() => {
      expect((control("Value") as HTMLTextAreaElement).value).toBe(
        "Deploying to {{local.variables.DEPLOY_ENV}}",
      );
    });
    expect(lastArguments(onFormChange)["value"]).toBe(
      "Deploying to {{local.variables.DEPLOY_ENV}}",
    );
  });

  test("typing after a pick keeps the picked reference", async () => {
    const { onFormChange } = renderStep(
      step(ComponentID.Log, { value: "Body: " }),
    );

    fireEvent.click(screen.getByRole("button", { name: "component" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use the webhook request body" }),
    );

    await waitFor(() => {
      expect((control("Value") as HTMLTextAreaElement).value).toBe(
        "Body: {{local.components.webhook-1.returnValues.request-body}}",
      );
    });

    await userEvent.setup({ delay: null }).type(control("Value"), " (raw)");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(
        "Body: {{local.components.webhook-1.returnValues.request-body}} (raw)",
      );
    });
    expect((control("Value") as HTMLTextAreaElement).value).toBe(
      "Body: {{local.components.webhook-1.returnValues.request-body}} (raw)",
    );
  });
});

describe("ArgumentsForm — every free-text argument is the multi-line box", () => {
  test.each([
    [ComponentID.SlackSendMessageToChannel, "Message Text"],
    [ComponentID.MicrosoftTeamsSendMessageToChannel, "Message Text"],
    [ComponentID.DiscordSendMessageToChannel, "Message Text"],
    [ComponentID.TelegramSendMessageToChat, "Message Text"],
    [ComponentID.AIGenerateText, "System Instructions"],
    [ComponentID.AIGenerateText, "Prompt"],
    [ComponentID.TextToJson, "Text"],
  ])("%s → %s", (componentId: ComponentID, field: string) => {
    renderStep(step(componentId));

    expectMultiLineBox(control(field));
  });

  test("a message that already holds a reference is still the multi-line box", () => {
    renderStep(
      step(ComponentID.TelegramSendMessageToChat, {
        text: "{{local.components.ai-generate-text-1.returnValues.response}}",
      }),
    );

    expectMultiLineBox(control("Message Text"));
  });

  test("no step opens the visual Markdown editor", () => {
    for (const componentId of [
      ComponentID.SlackSendMessageToChannel,
      ComponentID.AIGenerateText,
    ]) {
      const { view } = renderStep(step(componentId));

      expect(view.container.querySelector("[contenteditable]")).toBeNull();

      view.unmount();
    }
  });
});

describe("ArgumentsForm — what is typed is what is stored", () => {
  /*
   * The visual Markdown editor Slack's message used to open turned _italic_
   * into *italic* (bold in Slack) and broke the references below.
   */
  test("Slack formatting and references with underscores survive as typed", () => {
    const { onFormChange } = renderStep(
      step(ComponentID.SlackSendMessageToChannel),
    );

    const message: string =
      "_Heads up_: *{{local.variables.service_name}}* is down in {{global.variables.deploy_env}}. <https://status.example.com|Status>";

    fireEvent.change(control("Message Text"), { target: { value: message } });

    expect(lastArguments(onFormChange)["text"]).toBe(message);
  });

  test("an AI prompt with references and Markdown in it survives as typed", () => {
    const { onFormChange } = renderStep(step(ComponentID.AIGenerateText));

    const prompt: string =
      "## Task\nSummarise {{local.components.find_one_incident.returnValues.model.description}} for **support**.\n- keep it short";

    fireEvent.change(control("Prompt"), { target: { value: prompt } });

    expect(lastArguments(onFormChange)["prompt"]).toBe(prompt);
  });
});

describe("ArgumentsForm — code keeps its editor", () => {
  test("an email body holding a reference keeps the HTML editor, not a one-line box", () => {
    renderStep(
      step(ComponentID.SendEmail, {
        "email-body":
          "<p>Incident {{local.components.on-create-incident-1.returnValues.model.title}} was created.</p>",
      }),
    );

    const body: HTMLElement = control("Email Body");

    expect(body).toHaveAttribute("data-testid", "code-editor-input");
    expect(body.closest("[data-code-type]")).toHaveAttribute(
      "data-code-type",
      "html",
    );
  });
});

describe("ArgumentsForm — short values stay on one line", () => {
  test.each([
    [ComponentID.SendEmail, "From Email"],
    [ComponentID.SendEmail, "To Email"],
    [ComponentID.SendEmail, "Subject"],
    [ComponentID.TelegramSendMessageToChat, "Chat ID"],
    [ComponentID.TelegramSendMessageToChat, "Telegram Bot Token"],
    [ComponentID.IfElse, "Input 1"],
  ])("%s → %s", (componentId: ComponentID, field: string) => {
    renderStep(step(componentId));

    expect(control(field).tagName).toBe("INPUT");
  });
});
