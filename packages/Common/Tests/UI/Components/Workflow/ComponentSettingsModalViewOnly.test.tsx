/*
 * A step's settings dialog on a Builder that is a view (WorkflowViewOnly),
 * rendered for real: the actual Modal, ArgumentsForm and BasicForm.
 *
 * Someone who may open a workflow but not change it - a Workflow Member, a
 * viewer - opens a step to read what it does. The dialog used to let them
 * change it all and press Save, and every save then failed. Now:
 *
 *   - the settings and the identifier are shown as they are, inside a
 *     disabled fieldset: every control is disabled (a screen reader still
 *     reads each one and its value) and the pointer goes through the pickers;
 *   - Close in place of Save and Cancel, and neither Delete nor Run just
 *     this step, which takes the same permission;
 *   - the footer says what the dialog is, with why under the pointer and
 *     read out;
 *   - what is only read stays usable: a trigger's URL is still copied, a
 *     step's references and its help are still there.
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
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const VIEW_ONLY_REASON: string =
  "Changing this workflow takes permission to edit it. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.";

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

const makeNode: (metadataId: string, id: string) => NodeDataProp = (
  metadataId: string,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = getMetadata(metadataId);

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

// A Log step that writes "Deployment finished".
const logStep: () => NodeDataProp = (): NodeDataProp => {
  const log: NodeDataProp = makeNode(ComponentID.Log, "log-1");
  log.arguments = { value: "Deployment finished" };
  return log;
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

const footer: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal-footer");
};

beforeEach(() => {
  mockPermissions = [];
});

describe("a step opened on a view", () => {
  test("shows its settings and identifier as they are, inside disabled fieldsets the pointer goes through", () => {
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

    const settings: HTMLElement = screen.getByTestId(
      "workflow-component-settings-view-only",
    );
    const identifier: HTMLElement = screen.getByTestId(
      "workflow-component-id-view-only",
    );

    for (const fieldset of [settings, identifier]) {
      expect(fieldset.tagName).toBe("FIELDSET");
      expect(fieldset).toBeDisabled();
      expect(fieldset).toHaveClass("pointer-events-none");
      // No frame or indent of its own: the form reads as it does for an editor.
      expect(fieldset).toHaveClass("m-0", "min-w-0", "border-0", "p-0");
    }

    expect(settings).toHaveTextContent("Value");
    expect(
      within(identifier).getByRole("textbox", { name: /^Identifier/ }),
    ).toHaveValue("log-1");
  });

  /*
   * Steps whose settings are form controls - the schedule's pickers, an
   * email's and a request's fields: every one of them disabled by the
   * fieldset, whatever the step. (A value box is not a form control; the
   * tests below hold it to being read only.)
   */
  test.each([ComponentID.Schedule, ComponentID.SendEmail, ComponentID.ApiPost])(
    "every control in a %s step's settings is disabled",
    (componentId: string) => {
      renderModal(makeNode(componentId, `${componentId}-1`), {
        readOnlyReason: VIEW_ONLY_REASON,
      });

      const settings: HTMLElement = screen.getByTestId(
        "workflow-component-settings-view-only",
      );

      const controls: Array<HTMLElement> = Array.from(
        settings.querySelectorAll<HTMLElement>(
          "input, textarea, select, button",
        ),
      );

      expect([componentId, controls.length > 0]).toEqual([componentId, true]);

      for (const control of controls) {
        // Disabled by the fieldset: what :disabled matches.
        expect([
          control.outerHTML.slice(0, 80),
          control.matches(":disabled"),
        ]).toEqual([control.outerHTML.slice(0, 80), true]);
      }

      // Nor is any value box left to type in.
      for (const box of Array.from(
        settings.querySelectorAll<HTMLElement>("[data-template-editor]"),
      )) {
        expect(box).toHaveAttribute("contenteditable", "false");
      }

      expect(
        within(screen.getByTestId("workflow-component-id-view-only")).getByRole(
          "textbox",
          { name: /^Identifier/ },
        ),
      ).toBeDisabled();
    },
  );

  /*
   * A value box is an editable element, not a form control (ValuePicker/
   * TemplateTextEditor), so the disabled fieldset never reached it: on a
   * view it took the focus as the dialog opened, and the keyboard's typing
   * went into it. It now shows its value to be read: not editable, never
   * focused on its own, read out as read-only - and in the same ink as
   * any other value, not greyed out as a disabled box is.
   */
  test("a value box shows its value to be read: not editable, not focused on its own, read only", () => {
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");

    expect(box).toHaveTextContent("Deployment finished");
    expect(box).toHaveAttribute("contenteditable", "false");
    expect(box).toHaveAttribute("aria-readonly", "true");
    expect(box).not.toHaveAttribute("aria-disabled");
    expect(box).not.toHaveClass("text-gray-500");
    expect(document.activeElement).not.toBe(box);
  });

  test("nothing typed, pasted, cut or dropped into a value box changes it", () => {
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

    const box: HTMLElement = screen.getByTestId("workflow-argument-value");
    box.focus();

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
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

    expect(
      screen.queryByTestId("workflow-argument-value-insert-value"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Insert a value from an earlier step or a variable",
      }),
    ).not.toBeInTheDocument();
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

  test("its footer says what the dialog is, with why under the pointer and read out", () => {
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

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
    renderModal(makeNode(ComponentID.Log, "log-1"), {
      readOnlyReason: VIEW_ONLY_REASON,
    });

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
    renderModal(logStep(), { readOnlyReason: VIEW_ONLY_REASON });

    expect(
      screen.getByTestId("workflow-component-section-documentation"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-component-docs-jump")).toBeEnabled();
  });
});

describe("a step opened by an editor", () => {
  test("is a form as it always was: no fieldset, Save, Delete and no note", () => {
    renderModal(logStep());

    expect(
      screen.queryByTestId("workflow-component-settings-view-only"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-component-id-view-only"),
    ).not.toBeInTheDocument();
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
});
