/*
 * A workflow step's settings, rendered from the real component definitions.
 *
 * The maintainer's report: "I dont see value picker here, just like we have
 * on Create One Incident component fields... Please make this easy to use and
 * not have things like 'Pick this value from other component or from
 * variable'." It was the Log step's Value, with those two links under it.
 *
 * Every setting that can hold a value from an earlier step now has the
 * picker in it: a { } button in the field, and "{{" typed in it. A picked
 * value lands where the caret is and shows as a chip; what is stored is the
 * same {{...}} reference as before. Earlier guarantees hold too: messages are
 * multi-line boxes that grow, short values stay on one line, code keeps its
 * editor, and what is typed is stored exactly as typed.
 *
 * The form, its fields, the picker and the step's own state are the real
 * thing; only the API is stood in for.
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

/*
 * The variables the picker lists come from the API: one of this workflow's
 * and one global. Every other list (the Execute Workflow dropdown) is empty.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async (args: { modelType: { name?: string } }) => {
        const isVariables: boolean =
          new (args.modelType as unknown as new () => { tableName?: string })()
            .tableName === "WorkflowVariable";

        const data: Array<Record<string, unknown>> = isVariables
          ? [
              {
                name: "DEPLOY_ENV",
                description: "staging or production",
                workflowId: "workflow-1",
                isSecret: false,
              },
              { name: "API_KEY", workflowId: null, isSecret: true },
            ]
          : [];

        return { data: data, count: data.length, skip: 0, limit: 10 };
      }),
    },
  };
});

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import { INSERT_VALUE_LABEL } from "../../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import { TYPE_A_VALUE_LABEL } from "../../../../UI/Components/Workflow/ValuePicker/ValueSingleField";
import {
  ArgumentControl,
  argumentControlFor,
} from "../../../../UI/Components/Workflow/ValuePicker/ArgumentControl";
import { StepValueSources } from "../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import { parseStringDictionaryValue } from "../../../../UI/Components/Workflow/Utils";
import {
  chipsIn,
  editorValue,
  keys,
  placeCaret,
} from "./ValuePicker/ValuePickerTestUtils";
import Components from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Dictionary from "../../../../Types/Dictionary";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const WEBHOOK_BODY: string =
  "{{local.components.webhook-1.returnValues.request-body}}";
const DEPLOY_ENV: string = "{{local.variables.DEPLOY_ENV}}";
const API_KEY: string = "{{global.variables.API_KEY}}";

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

type StepFunction = (
  id: ComponentID,
  args?: JSONObject,
  stepId?: string,
) => NodeDataProp;

const step: StepFunction = (
  id: ComponentID,
  args: JSONObject = {},
  stepId: string = `${id}-1`,
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: stepId,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${stepId}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const webhook: NodeDataProp = step(ComponentID.Webhook, {}, "webhook-1");
const slackAfter: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  {},
  "slack-1",
);

interface RenderedStep {
  view: RenderResult;
  user: UserEvent;
  onFormChange: MockFunction;
  onErrors: MockFunction;
}

type RenderStepFunction = (
  node: NodeDataProp,
  options?: {
    graph?: Array<NodeDataProp>;
    valueSources?: StepValueSources;
  },
) => RenderedStep;

const renderStep: RenderStepFunction = (
  node: NodeDataProp,
  options: {
    graph?: Array<NodeDataProp>;
    valueSources?: StepValueSources;
  } = {},
): RenderedStep => {
  const onFormChange: MockFunction = getJestMockFunction();
  const onErrors: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={options.graph || [webhook, node, slackAfter]}
      valueSources={
        options.valueSources || {
          upstream: [webhook],
          downstreamIds: ["slack-1"],
          hasIncomingConnection: true,
        }
      }
      onHasFormValidationErrors={(errors: Dictionary<boolean>): void => {
        onErrors(errors);
      }}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  return {
    view: view,
    user: userEvent.setup({ delay: null }),
    onFormChange: onFormChange,
    onErrors: onErrors,
  };
};

type ControlFunction = (name: string) => HTMLElement;

// The text control a field's label names.
const control: ControlFunction = (name: string): HTMLElement => {
  return screen.getByRole("textbox", {
    name: new RegExp(`^${name}`),
  });
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

type InsertValueFunction = (argumentId: string) => HTMLElement;

const insertValue: InsertValueFunction = (argumentId: string): HTMLElement => {
  return screen.getByTestId(`workflow-argument-${argumentId}-insert-value`);
};

type PickFunction = (reference: string) => Promise<void>;

// Picks a value from the open list.
const pick: PickFunction = async (reference: string): Promise<void> => {
  const option: HTMLElement | undefined = await waitFor(() => {
    const found: HTMLElement | undefined = screen
      .getAllByRole("option")
      .find((candidate: HTMLElement) => {
        return candidate.getAttribute("data-reference") === reference;
      });

    if (!found) {
      throw new Error(`No option for ${reference}`);
    }

    return found;
  });

  fireEvent.click(option!);
};

type ListedReferencesFunction = () => Promise<Array<string>>;

const listedReferences: ListedReferencesFunction = async (): Promise<
  Array<string>
> => {
  // The variables arrive from the API a moment after the list opens.
  await waitFor(() => {
    expect(screen.queryByText("Loading variables…")).toBeNull();
  });

  return screen.getAllByRole("option").map((option: HTMLElement) => {
    return option.getAttribute("data-reference") || "";
  });
};

afterEach(() => {
  cleanup();
});

describe("ArgumentsForm — the Log step", () => {
  const SENTENCE: string =
    "ℹ️ Non-production webhook received. Logged without alerting.";

  test("its Value has the value picker in the field, and no links under it", () => {
    renderStep(step(ComponentID.Log));

    const value: HTMLElement = control("Value");
    const box: HTMLElement = screen.getByTestId("workflow-argument-value-box");

    expect(box).toContainElement(value);
    expect(box).toContainElement(insertValue("value"));
    expect(insertValue("value")).toHaveAccessibleName(INSERT_VALUE_LABEL);

    expect(screen.queryByText(/Pick this value/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "component" })).toBeNull();
    expect(screen.queryByRole("button", { name: "variable." })).toBeNull();
  });

  test("its Value is a multi-line box holding the whole sentence", () => {
    renderStep(step(ComponentID.Log, { value: SENTENCE }));

    const value: HTMLElement = control("Value");

    expect(value).toHaveAttribute("aria-multiline", "true");
    expect(editorValue(value)).toBe(SENTENCE);
    expect(document.querySelector("input[type='text']")).toBeNull();
  });

  test("Enter starts a new line, and the step keeps every line", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.Log));

    placeCaret(control("Value"), 0);
    await user.keyboard("Webhook received.{Enter}Environment: staging");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(
        "Webhook received.\nEnvironment: staging",
      );
    });
  });

  test("{ } puts the picked value where the caret is, as a chip", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.Log, { value: "Deploying to  now." }),
    );

    placeCaret(control("Value"), 13);
    fireEvent.mouseDown(insertValue("value"));
    await user.click(insertValue("value"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(
        `Deploying to ${DEPLOY_ENV} now.`,
      );
    });

    // Shown as a chip that says what it reads, not as {{...}}.
    expect(chipsIn(control("Value"))).toHaveLength(1);
    expect(chipsIn(control("Value"))[0]).toHaveTextContent(
      "Variable›DEPLOY_ENV",
    );
    expect(control("Value").textContent).not.toContain("{{");
  });

  test("typing after a pick keeps the picked reference", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.Log, { value: "Body: " }),
    );

    await user.click(insertValue("value"));
    await pick(WEBHOOK_BODY);
    await user.keyboard(" (raw)");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(
        `Body: ${WEBHOOK_BODY} (raw)`,
      );
    });
    expect(chipsIn(control("Value"))[0]).toHaveTextContent(
      "Webhook›Request Body",
    );
  });

  test("typing {{ offers the same values, and Enter takes one", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.Log));

    placeCaret(control("Value"), 0);
    await user.keyboard(keys("{{request bo"));

    expect(screen.getByTestId("value-picker-inline")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["value"]).toBe(WEBHOOK_BODY);
    });
  });

  test("the list offers the steps before this one and the variables, never one after", async () => {
    const { user } = renderStep(step(ComponentID.Log));

    await user.click(insertValue("value"));

    const references: Array<string> = await listedReferences();

    expect(references).toEqual([
      "{{local.components.webhook-1.returnValues.request-headers}}",
      "{{local.components.webhook-1.returnValues.request-params}}",
      WEBHOOK_BODY,
      DEPLOY_ENV,
      API_KEY,
    ]);
    expect(
      references.some((reference: string) => {
        return reference.includes("slack-1");
      }),
    ).toBe(false);

    const picker: HTMLElement = screen.getByTestId("value-picker");
    expect(within(picker).getByText("Webhook")).toBeInTheDocument();
    expect(within(picker).getByText("Workflow variables")).toBeInTheDocument();
    expect(within(picker).getByText("Global variables")).toBeInTheDocument();
    expect(within(picker).getByText("Secret")).toBeInTheDocument();
  });

  test("without the graph's order, every other step is offered", async () => {
    const onFormChange: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });
    const log: NodeDataProp = step(ComponentID.Log);

    render(
      <ArgumentsForm
        component={log}
        workflowId={ObjectID.generate()}
        graphComponents={[webhook, log, slackAfter]}
        onHasFormValidationErrors={() => {}}
        onFormChange={onFormChange}
      />,
    );

    await user.click(insertValue("value"));

    expect(await listedReferences()).toContain(
      "{{local.components.slack-1.returnValues.error}}",
    );
  });

  test("an empty Value is required, once the field has been left", async () => {
    const { onErrors } = renderStep(step(ComponentID.Log));

    const value: HTMLElement = control("Value");
    fireEvent.focus(value);
    fireEvent.blur(value);

    await waitFor(() => {
      expect(screen.getByText("Value is required.")).toBeInTheDocument();
    });
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
  });

  test("the first setting takes the focus as the settings open", async () => {
    renderStep(step(ComponentID.Log));

    await waitFor(() => {
      expect(control("Value")).toHaveFocus();
    });
  });
});

describe("ArgumentsForm — every setting that can take a value offers one", () => {
  /*
   * The whole table: for every built-in step and setting, the control the
   * setting gets and whether it has the picker. A new step or setting type
   * that does not fit is caught here.
   */
  const HAS_PICKER: Array<ArgumentControl> = [
    ArgumentControl.Text,
    ArgumentControl.MultiLineText,
    ArgumentControl.Number,
    ArgumentControl.Password,
    ArgumentControl.Boolean,
    ArgumentControl.Date,
    ArgumentControl.DateTime,
    ArgumentControl.JSONCode,
    ArgumentControl.HTMLCode,
  ];

  const settings: Array<[string, string, Argument]> = Components.flatMap(
    (component: ComponentMetadata) => {
      return (component.arguments || []).map(
        (arg: Argument): [string, string, Argument] => {
          return [component.id, arg.name, arg];
        },
      );
    },
  );

  test.each(settings)(
    "%s → %s",
    async (componentId: string, _name: string, arg: Argument) => {
      const { user } = renderStep(step(componentId as ComponentID));

      const advanced: HTMLElement | null = screen.queryByRole("button", {
        name: /^Show \d+ advanced setting/,
      });

      if (advanced) {
        await user.click(advanced);
      }

      /*
       * The form draws a field list it is handed a moment later, and the
       * Execute Workflow step waits for its list of workflows first.
       */
      const label: RegExp = new RegExp(
        `^${arg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      );

      await waitFor(() => {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      });

      const argumentControl: ArgumentControl = argumentControlFor({
        type: arg.type,
        value: null,
        isRowsDictionary:
          arg.type === ComponentInputType.StringDictionary &&
          parseStringDictionaryValue(null) !== null,
      });

      const button: HTMLElement | null = screen.queryByTestId(
        `workflow-argument-${arg.id}-insert-value`,
      );

      if (arg.type === ComponentInputType.CronTab) {
        // The schedule picker, with its own way to a variable.
        expect(screen.getByText("Variable")).toBeInTheDocument();
        return;
      }

      if (argumentControl === ArgumentControl.KeyValueRows) {
        // Rows: each value gets the picker once there is a row.
        expect(
          screen.getByRole("button", { name: `Add ${arg.name}` }),
        ).toBeInTheDocument();
        return;
      }

      if (HAS_PICKER.includes(argumentControl)) {
        expect(button).not.toBeNull();
      } else {
        expect(button).toBeNull();
      }
    },
  );

  test("JavaScript gets no picker in the code, and one in its Arguments", () => {
    renderStep(step(ComponentID.JavaScriptCode));

    expect(
      screen.queryByTestId("workflow-argument-code-insert-value"),
    ).toBeNull();
    expect(
      screen.getByTestId("workflow-argument-arguments-insert-value"),
    ).toBeInTheDocument();
  });

  test("a choice from a list gets none: the If/Else operator", () => {
    renderStep(step(ComponentID.IfElse));

    expect(
      screen.queryByTestId("workflow-argument-operator-insert-value"),
    ).toBeNull();
    expect(
      screen.getByTestId("workflow-argument-input-1-insert-value"),
    ).toBeInTheDocument();
  });
});

describe("ArgumentsForm — JSON and HTML get Insert value in the editor", () => {
  test("into an empty JSON body, the reference alone: the whole body", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.ApiPost));

    await user.click(insertValue("request-body"));
    await pick(WEBHOOK_BODY);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["request-body"]).toBe(WEBHOOK_BODY);
    });
  });

  test("where a JSON value goes, the reference comes with its quotes", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.ApiPost, { "request-body": '{"title": }' }),
    );

    const body: HTMLTextAreaElement = screen.getByRole("textbox", {
      name: /^Request Body/,
    }) as HTMLTextAreaElement;
    body.setSelectionRange(10, 10);

    await user.click(insertValue("request-body"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["request-body"]).toBe(
        `{"title": "${DEPLOY_ENV}"}`,
      );
    });
  });

  test("inside a JSON string, the reference goes in as it is", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.ApiPost, { "request-body": '{"title": "Alert: "}' }),
    );

    const body: HTMLTextAreaElement = screen.getByRole("textbox", {
      name: /^Request Body/,
    }) as HTMLTextAreaElement;
    body.setSelectionRange(18, 18);

    await user.click(insertValue("request-body"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["request-body"]).toBe(
        `{"title": "Alert: ${DEPLOY_ENV}"}`,
      );
    });
  });

  test("an email body takes the reference where the caret is", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.SendEmail, { "email-body": "<p>Hi </p>" }),
    );

    const body: HTMLTextAreaElement = control(
      "Email Body",
    ) as HTMLTextAreaElement;
    body.setSelectionRange(6, 6);

    await user.click(insertValue("email-body"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["email-body"]).toBe(
        `<p>Hi ${DEPLOY_ENV}</p>`,
      );
    });
  });

  test("an email body holding a reference keeps the HTML editor", () => {
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

describe("ArgumentsForm — a setting with a control of its own", () => {
  test("a number: the number box, or a picked value as a chip", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.Sleep));

    const seconds: HTMLElement = screen.getByRole("spinbutton", {
      name: /^Seconds/,
    });
    expect(seconds).toHaveAttribute("type", "number");

    await user.click(insertValue("seconds"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["seconds"]).toBe(DEPLOY_ENV);
    });
    expect(screen.queryByRole("spinbutton", { name: /^Seconds/ })).toBeNull();
    expect(chipsIn(control("Seconds"))).toHaveLength(1);

    // "abc" goes back to the number box, empty.
    await user.click(
      screen.getByTestId("workflow-argument-seconds-type-a-value"),
    );

    await waitFor(() => {
      expect(lastArguments(onFormChange)["seconds"]).toBe("");
    });
    expect(
      screen.getByRole("spinbutton", { name: /^Seconds/ }),
    ).toBeInTheDocument();
  });

  test("a stored reference on a number shows as the chip", () => {
    renderStep(step(ComponentID.Sleep, { seconds: DEPLOY_ENV }));

    expect(chipsIn(control("Seconds"))).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: TYPE_A_VALUE_LABEL }),
    ).toBeInTheDocument();
  });

  test("a password stays hidden when typed, and a picked secret shows as its name", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.SendEmail));

    const password: HTMLElement = screen.getByLabelText(/^SMTP Password/);
    expect(password).toHaveAttribute("type", "password");

    await user.click(insertValue("smtp-password"));
    await pick(API_KEY);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["smtp-password"]).toBe(API_KEY);
    });
    expect(chipsIn(control("SMTP Password"))[0]).toHaveTextContent(
      "Global variable›API_KEY",
    );
  });

  test("a switch is one row, as every switch field is: its name and help beside it, then { }", () => {
    renderStep(step(ComponentID.SendEmail));

    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Use Implicit TLS",
    });

    expect(toggle).toHaveAccessibleDescription(
      /^Optional\. Enable for implicit TLS/,
    );
    expect(insertValue("secure").parentElement).toContainElement(toggle);

    // No label above it: the name is drawn once, beside the switch.
    expect(screen.getAllByText("Use Implicit TLS")).toHaveLength(1);
  });

  test("a value picked for a switch sits under its name, and abc brings the switch back", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.SendEmail));

    await user.click(insertValue("secure"));
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["secure"]).toBe(DEPLOY_ENV);
    });
    expect(chipsIn(control("Use Implicit TLS"))[0]).toHaveTextContent(
      "Variable›DEPLOY_ENV",
    );
    expect(
      screen.queryByRole("switch", { name: "Use Implicit TLS" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: TYPE_A_VALUE_LABEL }));

    await waitFor(() => {
      expect(lastArguments(onFormChange)["secure"]).toBe(false);
    });
    // The form hands its fields the new value a moment after it reports it.
    expect(
      await screen.findByRole("switch", { name: "Use Implicit TLS" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});

describe("ArgumentsForm — request headers", () => {
  test("each header's value can be a variable", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.ApiPost));

    await user.click(
      screen.getByRole("button", { name: /^Show \d+ advanced setting/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Add Request Headers" }),
    );

    const keyInput: HTMLElement = screen.getByPlaceholderText("Key");
    await user.type(keyInput, "Authorization");

    await user.click(
      screen.getByTestId(
        "workflow-argument-request-headers-value-0-insert-value",
      ),
    );
    await pick(API_KEY);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["request-headers"]).toEqual({
        Authorization: API_KEY,
      });
    });
  });
});

describe("ArgumentsForm — what is typed is what is stored", () => {
  /*
   * The visual Markdown editor Slack's message used to open turned _italic_
   * into *italic* (bold in Slack) and broke the references below.
   */
  test("Slack formatting and references with underscores survive as typed", async () => {
    const { user, onFormChange } = renderStep(
      step(ComponentID.SlackSendMessageToChannel),
    );

    const message: string =
      "_Heads up_: *{{local.variables.service_name}}* is down in {{global.variables.deploy_env}}. <https://status.example.com|Status>";

    placeCaret(control("Message Text"), 0);
    await user.paste(message);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["text"]).toBe(message);
    });
  });

  test("an AI prompt with references and Markdown in it survives as typed", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.AIGenerateText));

    const prompt: string =
      "## Task\nSummarise {{local.components.find_one_incident.returnValues.model.description}} for **support**.\n- keep it short";

    placeCaret(control("Prompt"), 0);
    await user.paste(prompt);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["prompt"]).toBe(prompt);
    });
  });

  test("no step opens the visual Markdown editor", () => {
    for (const componentId of [
      ComponentID.SlackSendMessageToChannel,
      ComponentID.AIGenerateText,
    ]) {
      const { view } = renderStep(step(componentId));

      expect(view.container.querySelector(".ou-markdown-editor")).toBeNull();
      expect(
        view.container.querySelectorAll("[data-template-editor]").length,
      ).toBeGreaterThan(0);

      view.unmount();
    }
  });
});

describe("ArgumentsForm — every free-text argument is a multi-line box", () => {
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

    expect(control(field)).toHaveAttribute("aria-multiline", "true");
  });

  test("a message that already holds a reference is still the multi-line box", () => {
    renderStep(
      step(ComponentID.TelegramSendMessageToChat, {
        text: "{{local.components.ai-generate-text-1.returnValues.response}}",
      }),
    );

    expect(control("Message Text")).toHaveAttribute("aria-multiline", "true");
    expect(chipsIn(control("Message Text"))).toHaveLength(1);
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
    [ComponentID.ApiPost, "URL"],
  ])("%s → %s", (componentId: ComponentID, field: string) => {
    renderStep(step(componentId));

    expect(control(field)).toHaveAttribute("aria-multiline", "false");
  });

  test("Enter does not break a one-line value", async () => {
    const { user, onFormChange } = renderStep(step(ComponentID.SendEmail));

    placeCaret(control("Subject"), 0);
    await user.keyboard("Down{Enter} again");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["subject"]).toBe("Down again");
    });
  });
});

describe("ArgumentsForm — a typed URL is still checked", () => {
  test("one that is not a URL says so", async () => {
    const { user } = renderStep(step(ComponentID.ApiPost));

    const url: HTMLElement = control("URL");
    placeCaret(url, 0);
    await user.keyboard("not a url");
    fireEvent.blur(url);

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  test("one built from a value is not judged before it runs", async () => {
    const { user } = renderStep(step(ComponentID.ApiPost));

    const url: HTMLElement = control("URL");
    placeCaret(url, 0);
    await user.paste("{{global.variables.API_BASE}}/incidents");
    fireEvent.blur(url);

    // Give validation its chance to run.
    await waitFor(() => {
      expect(editorValue(control("URL"))).toBe(
        "{{global.variables.API_BASE}}/incidents",
      );
    });
    expect(screen.queryByTestId("error-message")).toBeNull();
  });
});
