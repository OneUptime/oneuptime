/*
 * A step's settings dialog on a Builder that is a view (WorkflowViewOnly),
 * rendered for real: the actual Modal, ArgumentsForm and BasicForm.
 *
 * Someone who may open a workflow but not change it - a Workflow Member, a
 * viewer - opens a step to read what it does. The dialog used to let them
 * change it all and press Save, and every save then failed. Now:
 *
 *   - every setting is shown as it is and cannot be changed, held still one
 *     by one: a list to pick from or a text box is disabled, a code box shows
 *     its code to be read, a value box shows its value, and the identifier
 *     sits in a disabled fieldset the pointer goes through;
 *   - what only reads a setting stays usable: a code box's own Copy copies
 *     its code, and More fields opens to show the settings folded there.
 *     Both sat in one disabled fieldset around the whole form, which
 *     disabled them with everything else (#5320's follow-up);
 *   - what only changes a setting is not drawn at all: a header's Add and
 *     Delete, a list's clear (UI review of #5580);
 *   - the dialog starts on itself, never in a box that is only read: If /
 *     Else and Switch / Case put the focus, and its ring, in Value to check;
 *   - an empty value box keeps a line's height: it had shrunk to its
 *     padding, its placeholder spilling out of it;
 *   - Close in place of Save and Cancel, and neither Delete nor Run just
 *     this step, which takes the same permission;
 *   - the footer says what the dialog is, with why under the pointer and
 *     read out;
 *   - a trigger's URL is still copied, a step's references and its help are
 *     still there.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return String(error);
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      }),
    },
  };
});

let mockPermissions: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import ComponentSettingsModal, {
  ComponentProps,
  WORKFLOW_STEP_VIEW_ONLY_TEXT,
} from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR } from "../../../../UI/Components/Workflow/WorkflowViewOnlyFieldset";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { READ_ONLY_EMPTY_LINE_CLASS } from "../../../../UI/Components/Workflow/ValuePicker/TemplateTextEditor";
import {
  CODE_COPY_SELECTOR,
  LiveControl,
  findActionsAViewDraws,
  findLiveControls,
  isHeldStill,
} from "./ViewOnlyControls";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const VIEW_ONLY_REASON: string =
  "Changing this workflow takes permission to edit it. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.";

// What the steps below hold: code, a body and a header worth copying.
const REQUEST_BODY: string = '{"service": "checkout", "status": "deployed"}';
const SCRIPT: string = "return { ok: args.status === 'deployed' };";
const EMAIL_BODY: string = "<p>Checkout was deployed.</p>";
const AUTHORIZATION: string = "Bearer deploy-token";

const getMetadata: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
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

const makeNode: (
  metadataId: string,
  id: string,
  args?: JSONObject,
) => NodeDataProp = (
  metadataId: string,
  id: string,
  args?: JSONObject,
): NodeDataProp => {
  const metadata: ComponentMetadata = getMetadata(metadataId);

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: args || {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

// A Log step that writes "Deployment finished".
const logStep: () => NodeDataProp = (): NodeDataProp => {
  return makeNode(ComponentID.Log, "log-1", { value: "Deployment finished" });
};

// An API Post with a JSON body, and an Authorization header under More fields.
const apiPostStep: () => NodeDataProp = (): NodeDataProp => {
  return makeNode(ComponentID.ApiPost, "api-post-1", {
    url: "https://deploys.example.com/hooks/checkout",
    "request-body": REQUEST_BODY,
    "request-headers": { Authorization: AUTHORIZATION },
  });
};

const renderModal: (
  node: NodeDataProp,
  overrides?: Partial<ComponentProps>,
) => RenderResult = (
  node: NodeDataProp,
  overrides?: Partial<ComponentProps>,
): RenderResult => {
  const props: ComponentProps = {
    title: node.metadata.title,
    description: node.metadata.description,
    onClose: getJestMockFunction(),
    onSave: getJestMockFunction(),
    onDelete: getJestMockFunction(),
    component: node,
    graphComponents: [node],
    workflowId: WORKFLOW_ID,
    webhookSecretKey: SECRET,
    ...(overrides || {}),
  };

  return render(<ComponentSettingsModal {...props} />);
};

const renderView: (node: NodeDataProp) => RenderResult = (
  node: NodeDataProp,
): RenderResult => {
  return renderModal(node, { readOnlyReason: VIEW_ONLY_REASON });
};

const footer: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal-footer");
};

const settingsView: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-component-settings-view-only");
};

// The code box of the settings that holds this code.
const codeBox: (code: string) => HTMLElement = (code: string): HTMLElement => {
  const box: HTMLElement | undefined = Array.from(
    settingsView().querySelectorAll<HTMLElement>("[data-code-type]"),
  ).find((candidate: HTMLElement): boolean => {
    return (
      candidate.querySelector<HTMLTextAreaElement>(
        '[data-testid="code-editor-input"]',
      )?.value === code
    );
  });

  if (!box) {
    throw new Error(`No code box holding ${code}`);
  }

  return box;
};

let writeText: MockFunction;

beforeEach(() => {
  mockPermissions = [];
  writeText = getJestMockFunction();
  writeText.mockImplementation(() => {
    return Promise.resolve();
  });

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("a step opened on a view", () => {
  test("holds each setting still on its own - no fieldset around the whole form - and the identifier whole", () => {
    renderView(logStep());

    const settings: HTMLElement = settingsView();
    const identifier: HTMLElement = screen.getByTestId(
      "workflow-component-id-view-only",
    );

    // Nothing around the whole form disables what only reads a setting.
    expect(settings.tagName).toBe("DIV");
    expect(settings.closest("fieldset")).toBeNull();
    expect(settings.closest(".pointer-events-none")).toBeNull();
    expect(settings).toHaveTextContent("Value");

    // The identifier is one text box: held still whole, as before.
    const idFieldset: HTMLElement = within(identifier).getByTestId(
      "workflow-component-id-fieldset",
    );

    expect(idFieldset.tagName).toBe("FIELDSET");
    expect(idFieldset).toBeDisabled();
    expect(idFieldset).toHaveClass("pointer-events-none");
    // No frame or indent of its own: the form reads as it does for an editor.
    expect(idFieldset).toHaveClass("m-0", "min-w-0", "border-0", "p-0");
    expect(
      within(identifier).getByRole("textbox", { name: /^Identifier/ }),
    ).toHaveValue("log-1");
    expect(
      within(identifier).getByRole("textbox", { name: /^Identifier/ }),
    ).toBeDisabled();
  });

  /*
   * Steps whose settings are lists, switches, boxes and code: nothing in
   * them can be changed, whatever the step. What is left is what only reads
   * a setting - a code box's Copy, the More fields fold.
   */
  test.each([
    ComponentID.Schedule,
    ComponentID.SendEmail,
    ComponentID.ApiPost,
    ComponentID.JavaScriptCode,
    ComponentID.Log,
  ])(
    "nothing in a %s step's settings can be changed - it is only read",
    async (componentId: string) => {
      renderView(makeNode(componentId, `${componentId}-1`));

      // Drawn once every setting's label is: the form renders a beat late.
      await waitFor(() => {
        for (const arg of getMetadata(componentId).arguments) {
          expect(settingsView()).toHaveTextContent(arg.name);
        }
      });

      const live: Array<LiveControl> = findLiveControls(settingsView());

      expect([componentId, live]).toEqual([componentId, []]);

      // Nor is the identifier.
      expect(
        within(screen.getByTestId("workflow-component-id-view-only")).getByRole(
          "textbox",
          { name: /^Identifier/ },
        ),
      ).toBeDisabled();
    },
  );

  test("a list to pick from is disabled, as a locked field is anywhere", async () => {
    renderView(
      makeNode(ComponentID.Schedule, "schedule-1", {
        schedule: "0 * * * *",
      }),
    );

    const inputs: Array<HTMLInputElement> = await waitFor(() => {
      const found: Array<HTMLInputElement> = Array.from(
        settingsView().querySelectorAll<HTMLInputElement>("input"),
      );

      expect(found.length).toBeGreaterThan(0);
      return found;
    });

    for (const input of inputs) {
      expect(input.matches(":disabled")).toBe(true);
    }
  });

  test("a code box shows its code to be read: read only, said so, with no Format and no Insert value", () => {
    renderView(apiPostStep());

    const box: HTMLElement = codeBox(REQUEST_BODY);
    const input: HTMLTextAreaElement = within(box).getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    expect(input).toHaveAttribute("readonly");
    // Read, not disabled: it is still focused, selected and scrolled.
    expect(input).toBeEnabled();
    expect(isHeldStill(input)).toBe(false);
    expect(within(box).getByTestId("code-editor-read-only")).toHaveTextContent(
      "Read-only",
    );
    expect(
      within(box).queryByTestId("code-editor-format-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-argument-request-body-insert-value"),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["an API Post's JSON body", apiPostStep, REQUEST_BODY],
    [
      "a script's JavaScript",
      (): NodeDataProp => {
        return makeNode(ComponentID.JavaScriptCode, "javascript-1", {
          code: SCRIPT,
        });
      },
      SCRIPT,
    ],
    [
      "an email's HTML body",
      (): NodeDataProp => {
        return makeNode(ComponentID.SendEmail, "send-email-1", {
          "email-body": EMAIL_BODY,
        });
      },
      EMAIL_BODY,
    ],
  ])(
    "copying changes nothing, so a code box's own Copy works: %s",
    async (_name: string, node: () => NodeDataProp, code: string) => {
      renderView(node());

      const copy: HTMLElement = within(codeBox(code)).getByTestId(
        "code-editor-copy-button",
      );

      expect(copy).toBeEnabled();
      // Neither disabled nor under something the pointer goes through.
      expect(isHeldStill(copy)).toBe(false);

      await act(async () => {
        fireEvent.click(copy);
      });

      expect(writeText).toHaveBeenCalledWith(code);
      expect(copy).toHaveTextContent("Copied");
    },
  );

  test("More fields still opens, to read the settings folded there", async () => {
    renderView(apiPostStep());

    const moreFields: HTMLElement = await screen.findByRole("button", {
      name: "More fields",
    });

    expect(moreFields).toBeEnabled();
    expect(isHeldStill(moreFields)).toBe(false);
    expect(moreFields).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(moreFields);

    expect(moreFields).toHaveAttribute("aria-expanded", "true");

    // The header it folded: its name is read in a disabled box, its value as it is.
    const key: HTMLElement = await screen.findByDisplayValue("Authorization");

    expect(key.matches(":disabled")).toBe(true);
    expect(
      screen.getByTestId("workflow-argument-request-headers-value-0"),
    ).toHaveTextContent(AUTHORIZATION);
    expect(
      screen.getByTestId("workflow-argument-request-headers-value-0"),
    ).toHaveAttribute("contenteditable", "false");

    // And it folds away again.
    fireEvent.click(moreFields);
    expect(moreFields).toHaveAttribute("aria-expanded", "false");
  });

  test("a header's row is read: no Add and no Delete beside it, and its type has nothing to clear", async () => {
    renderView(apiPostStep());

    fireEvent.click(
      await screen.findByRole("button", {
        name: "More fields",
      }),
    );

    await screen.findByDisplayValue("Authorization");

    expect(screen.queryByTestId("delete-Authorization")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add Request Headers" }),
    ).toBeNull();
    expect(
      settingsView().querySelector(".ou-select__clear-indicator"),
    ).toBeNull();
    expect(findActionsAViewDraws(settingsView())).toEqual([]);
  });

  test("a step with no headers says None where they would be", async () => {
    renderView(
      makeNode(ComponentID.ApiPost, "api-post-1", {
        url: "https://deploys.example.com/hooks/checkout",
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "More fields",
      }),
    );

    expect(await screen.findByTestId("dictionary-none")).toHaveTextContent(
      "None",
    );
  });

  test("an empty value box keeps the height of a line, its placeholder inside it", () => {
    renderView(makeNode(ComponentID.Log, "log-1", { value: "" }));

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");

    expect(box).toBeEmptyDOMElement();
    expect(box.className).toContain(READ_ONLY_EMPTY_LINE_CLASS);
  });

  test("every code box of a step with two is read only, each with its own Copy", () => {
    renderView(
      makeNode(ComponentID.JavaScriptCode, "javascript-1", {
        code: SCRIPT,
        arguments: REQUEST_BODY,
      }),
    );

    const boxes: Array<HTMLElement> = Array.from(
      settingsView().querySelectorAll<HTMLElement>("[data-code-type]"),
    );

    expect(boxes).toHaveLength(2);

    for (const box of boxes) {
      expect(box).toHaveClass("ou-code-editor--readonly");
      expect(box.querySelector(CODE_COPY_SELECTOR)).toBeEnabled();
    }
  });

  test("nothing in the settings is held in a fieldset but what changes a setting", () => {
    renderView(apiPostStep());

    for (const fieldset of Array.from(
      settingsView().querySelectorAll<HTMLElement>(
        WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR,
      ),
    )) {
      expect(fieldset.querySelector(CODE_COPY_SELECTOR)).toBeNull();
      expect(
        fieldset.querySelector('[data-testid="folded-section-header"]'),
      ).toBeNull();
    }
  });

  /*
   * A value box is an editable element, not a form control (ValuePicker/
   * TemplateTextEditor), so a disabled fieldset never reached it: on a
   * view it took the focus as the dialog opened, and the keyboard's typing
   * went into it. It now shows its value to be read: not editable, never
   * focused on its own, read out as read-only - and in the same ink as
   * any other value, not greyed out as a disabled box is.
   */
  test("a value box shows its value to be read: not editable, not focused on its own, read only", () => {
    renderView(logStep());

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");

    expect(box).toHaveTextContent("Deployment finished");
    expect(box).toHaveAttribute("contenteditable", "false");
    expect(box).toHaveAttribute("aria-readonly", "true");
    expect(box).not.toHaveAttribute("aria-disabled");
    expect(box).not.toHaveClass("text-gray-500");
    expect(document.activeElement).not.toBe(box);
  });

  test("nothing typed, pasted, cut or dropped into a value box changes it", () => {
    renderView(logStep());

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");
    act(() => {
      box.focus();
    });

    const typing: Event = new Event("beforeinput", {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(typing, { inputType: "insertText", data: "x" });
    box.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(true);

    fireEvent.paste(box, {
      clipboardData: {
        getData: (): string => {
          return " pasted";
        },
      },
    });
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });

    expect(box).toHaveTextContent("Deployment finished");
    expect(box).not.toHaveTextContent("pasted");
  });

  test("offers no value to insert: no { } beside a value box", () => {
    renderView(logStep());

    expect(
      screen.queryByTestId("workflow-argument-value-insert-value"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Insert a value from an earlier step or a variable",
      }),
    ).not.toBeInTheDocument();
  });

  /*
   * If / Else and Switch / Case draw their first box at once, so the dialog
   * found Value to check first and put the focus - and its ring - on a box
   * that cannot be typed in. The dialog starts on itself instead.
   */
  test.each([
    [
      ComponentID.IfElse,
      "if-else-1",
      {
        "input-1": "Deploy finished",
        operator: "==",
        "input-2": "Deploy finished",
      },
    ],
    [
      ComponentID.Switch,
      "switch-1",
      {
        value: "Deploy finished",
        cases: [
          {
            id: "case-1",
            comparison: "==",
            value: "production",
            compareAs: "",
          },
        ],
      },
    ],
  ])(
    "%s opens with the focus on the dialog, not in a box that is only read",
    (id: string, stepId: string, args: JSONObject) => {
      renderView(makeNode(id, stepId, args));

      expect(document.activeElement).toBe(screen.getByRole("dialog"));
      expect(settingsView().contains(document.activeElement)).toBe(false);
    },
  );

  test("nothing in the settings takes the focus as the dialog opens: there is nothing to type", async () => {
    renderView(
      makeNode(ComponentID.JavaScriptCode, "javascript-1", { code: SCRIPT }),
    );

    await waitFor(() => {
      expect(
        settingsView().querySelector('[data-testid="code-editor-input"]'),
      ).not.toBeNull();
    });

    expect(settingsView().contains(document.activeElement)).toBe(false);
  });

  test("has Close, and no Save, no Delete and no Run just this step", () => {
    const onRunStep: MockFunction = getJestMockFunction();

    renderModal(logStep(), {
      readOnlyReason: VIEW_ONLY_REASON,
      onRunStep: onRunStep,
      runStepDisabledReason:
        "Running one step on its own takes permission to edit this workflow.",
    });

    expect(
      screen.queryByTestId("modal-footer-submit-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
    expect(
      within(footer()).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run just this step" }),
    ).not.toBeInTheDocument();
  });

  test("Close closes it, and saves nothing", () => {
    const onClose: MockFunction = getJestMockFunction();
    const onSave: MockFunction = getJestMockFunction();

    renderModal(logStep(), {
      readOnlyReason: VIEW_ONLY_REASON,
      onClose: onClose,
      onSave: onSave,
    });

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a copy or an opened fold saves nothing either", async () => {
    const onSave: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    renderModal(apiPostStep(), {
      readOnlyReason: VIEW_ONLY_REASON,
      onSave: onSave,
      onClose: onClose,
    });

    await act(async () => {
      fireEvent.click(
        within(codeBox(REQUEST_BODY)).getByTestId("code-editor-copy-button"),
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "More fields" }));
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("its footer says what the dialog is, with why under the pointer and read out", () => {
    renderView(logStep());

    const note: HTMLElement = screen.getByTestId(
      "workflow-component-view-only-note",
    );

    expect(footer()).toContainElement(note);
    expect(note).toHaveTextContent(WORKFLOW_STEP_VIEW_ONLY_TEXT);
    expect(WORKFLOW_STEP_VIEW_ONLY_TEXT).toBe(
      "You can look at this step but not change it.",
    );
    expect(note).toHaveAttribute("title", VIEW_ONLY_REASON);
    expect(note.querySelector(".sr-only")).toHaveTextContent(VIEW_ONLY_REASON);
    /*
     * A div: its lock Icon draws a div of its own, which a paragraph may not
     * hold (React's validateDOMNesting warned on every view).
     */
    expect(note.tagName).toBe("DIV");
    expect(footer().querySelector("p div")).toBeNull();
    /*
     * Not a div the footer holds directly: those it stacks on a phone (its
     * [&>div]:flex-col, for button groups), which put the lock on a line of
     * its own above the words.
     */
    expect(note.parentElement).not.toHaveClass("[&>div]:flex-col");
    expect(note.parentElement?.parentElement).toHaveClass("[&>div]:flex-col");
  });

  test("a step whose settings are empty says nothing needs fixing: there is nothing to save", () => {
    renderView(makeNode(ComponentID.Log, "log-1"));

    expect(
      screen.queryByText("Some settings need fixing before this can be saved."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-component-view-only-note"),
    ).toBeInTheDocument();
  });

  test("what is only read stays usable: the Webhook trigger's URL is copied as for anyone who may see it", () => {
    // May read the key, as an editor would; the view is about changing it.
    mockPermissions = [Permission.ProjectAdmin];

    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      readOnlyReason: VIEW_ONLY_REASON,
      canSeeWebhookSecretKey: true,
    });

    expect(
      screen.getByRole("button", { name: "Copy the webhook URL" }),
    ).toBeEnabled();
    // The trigger has no settings: its identifier is still a view.
    expect(screen.getByRole("textbox", { name: /^Identifier/ })).toBeDisabled();
  });

  test("its help and its references are still there", () => {
    renderView(logStep());

    expect(
      screen.getByTestId("workflow-component-section-documentation"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-component-docs-jump")).toBeEnabled();
  });
});

describe("a step opened by an editor", () => {
  test("its If / Else starts in Value to check, to type the condition", () => {
    renderModal(
      makeNode(ComponentID.IfElse, "if-else-1", {
        "input-1": "",
        operator: "==",
        "input-2": "",
      }),
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("workflow-argument-input-1"),
    );
  });

  test("its header rows come with Add and Delete, and a type to clear", async () => {
    renderModal(apiPostStep());

    fireEvent.click(
      await screen.findByRole("button", {
        name: "More fields",
      }),
    );

    expect(await screen.findByTestId("delete-Authorization")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Request Headers" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("dictionary-none")).toBeNull();
  });

  test("is a form as it always was: no view wrapper or fieldset, Save, Delete and no note", () => {
    renderModal(logStep());

    expect(
      screen.queryByTestId("workflow-component-settings-view-only"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-component-id-view-only"),
    ).not.toBeInTheDocument();
    expect(document.querySelector("fieldset[disabled]")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Save",
    );
    expect(
      within(footer()).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-component-view-only-note"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Identifier/ })).toBeEnabled();
  });

  test("its value boxes are typed in, and offer a value to insert, as they always were", () => {
    renderModal(logStep());

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");

    expect(box).toHaveAttribute("contenteditable", "true");
    expect(box).not.toHaveAttribute("aria-readonly");
    expect(
      screen.getByTestId("workflow-argument-value-insert-value"),
    ).toBeEnabled();
  });

  test("its code boxes are typed in, with Format and Insert value, as they always were", () => {
    renderModal(apiPostStep());

    const box: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>("[data-code-type]"),
    ).find((candidate: HTMLElement): boolean => {
      return Boolean(
        candidate.querySelector<HTMLTextAreaElement>(
          '[data-testid="code-editor-input"]',
        )?.value === REQUEST_BODY,
      );
    });

    expect(box).toBeDefined();
    expect(within(box!).getByTestId("code-editor-input")).not.toHaveAttribute(
      "readonly",
    );
    expect(box!).not.toHaveClass("ou-code-editor--readonly");
    expect(
      within(box!).getByTestId("code-editor-format-button"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-argument-request-body-insert-value"),
    ).toBeEnabled();
  });

  test("its other settings are held by nothing: no list or box is disabled", async () => {
    renderModal(
      makeNode(ComponentID.Schedule, "schedule-1", {
        schedule: "0 * * * *",
      }),
    );

    await waitFor(() => {
      expect(document.querySelectorAll("input").length).toBeGreaterThan(0);
    });

    expect(document.querySelector("fieldset[disabled]")).toBeNull();
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>("input")).some(
        (input: HTMLInputElement): boolean => {
          return !input.matches(":disabled");
        },
      ),
    ).toBe(true);
  });
});
