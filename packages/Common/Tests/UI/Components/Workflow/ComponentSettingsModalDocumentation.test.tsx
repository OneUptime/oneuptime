/*
 * The "How to use" help inside a step's settings dialog, rendered for real:
 * the dialog, the form and the help. Only the network, the dashboard's
 * configured hosts and the permission snapshot are stubbed.
 *
 * The feedback this answers: the documentation section "should be improved a
 * lot and should be made simpler to understand and use". The help is now the
 * dialog's last section on every step, built from the step itself, and the
 * header has a way to it from anywhere in the dialog.
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
    DOCS_URL: URLType.fromString("https://oneuptime.example.com/docs"),
    API_DOCS_URL: URLType.fromString("https://oneuptime.example.com/reference"),
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

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
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
} from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../Types/Workflow/Components/BaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const ALL_STEPS: Array<ComponentMetadata> = [
  ...Components,
  ...BaseModelComponentFactory.getComponents(new Incident()),
];

type GetMetadataFunction = (id: string) => ComponentMetadata;

const getMetadata: GetMetadataFunction = (id: string): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = ALL_STEPS.find(
    (component: ComponentMetadata) => {
      return component.id === id;
    },
  );

  if (!metadata) {
    throw new Error(`No component ${id}`);
  }

  return metadata;
};

type MakeNodeFunction = (metadataId: string, id: string) => NodeDataProp;

const makeNode: MakeNodeFunction = (
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

type RenderModalFunction = (
  node: NodeDataProp,
  overrides?: Partial<ComponentProps>,
) => RenderResult;

const renderModal: RenderModalFunction = (
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
    workflowId: new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a"),
    webhookSecretKey: "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b",
    ...(overrides || {}),
  };

  return render(<ComponentSettingsModal {...props} />);
};

type HelpFunction = () => HTMLElement;

const help: HelpFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-component-section-documentation");
};

type JumpButtonFunction = () => HTMLElement;

const jumpButton: JumpButtonFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "How to use" });
};

type ScrollIntoView = (options?: ScrollIntoViewOptions | boolean) => void;

let scrolledInto: Array<{
  element: Element;
  options: ScrollIntoViewOptions | boolean | undefined;
}> = [];
const originalScrollIntoView: ScrollIntoView | undefined =
  Element.prototype.scrollIntoView;
const originalMatchMedia: typeof window.matchMedia | undefined =
  window.matchMedia;

type SetReducedMotionFunction = (isReduced: boolean) => void;

const setReducedMotion: SetReducedMotionFunction = (
  isReduced: boolean,
): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      return {
        matches: isReduced && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: (): void => {},
        removeListener: (): void => {},
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        dispatchEvent: (): boolean => {
          return false;
        },
      } as MediaQueryList;
    },
  });
};

beforeEach(() => {
  scrolledInto = [];
  // jsdom has no layout, so it has no scrollIntoView to call.
  Element.prototype.scrollIntoView = function (
    this: Element,
    options?: ScrollIntoViewOptions | boolean,
  ): void {
    scrolledInto.push({ element: this, options: options });
  };
  setReducedMotion(false);
});

afterEach(() => {
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe("every step's dialog ends on its help", () => {
  test.each([
    ComponentID.Webhook,
    ComponentID.Manual,
    ComponentID.Schedule,
    ComponentID.ApiGet,
    ComponentID.Log,
    ComponentID.IfElse,
    ComponentID.SendEmail,
    "incident-create-one",
    "incident-on-delete",
  ])("%s", (id: string) => {
    renderModal(makeNode(id, `${id}-1`));

    const body: HTMLElement = screen.getByTestId("workflow-component-settings");

    expect(body.lastElementChild).toBe(help());
    expect(within(help()).getByRole("heading", { level: 4 })).toHaveTextContent(
      "How to use",
    );
    expect(
      within(help()).getByTestId("workflow-component-docs-summary").textContent,
    ).toMatch(/\.$/);
  });

  test("Learn more is closed when the dialog opens", () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    expect(
      within(help()).getByRole("button", { name: "Learn more" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("workflow-component-docs-learn-more"),
    ).not.toBeInTheDocument();
  });

  test("its links open the docs in a new tab", () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    const link: HTMLElement = within(help()).getByRole("link", {
      name: /API step guide/,
    });

    expect(link).toHaveAttribute(
      "href",
      "https://oneuptime.example.com/docs/workflows/components#api",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("a database step links to its model's fields in the API reference", () => {
    renderModal(makeNode("incident-create-one", "incident-create-one-1"));

    expect(
      within(help()).getByRole("link", { name: /Every Incident field/ }),
    ).toHaveAttribute(
      "href",
      "https://oneuptime.example.com/reference/incident",
    );
  });
});

describe("the header's How to use button", () => {
  test("every step's dialog has it", () => {
    for (const id of [
      ComponentID.Webhook,
      ComponentID.Manual,
      ComponentID.ApiGet,
      "incident-on-update",
    ]) {
      const view: RenderResult = renderModal(makeNode(id, `${id}-1`));

      expect(
        within(screen.getByTestId("modal-header")).getByRole("button", {
          name: "How to use",
        }),
      ).toBeInTheDocument();

      view.unmount();
    }
  });

  test("scrolls the help into view and takes the focus there", () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    fireEvent.click(jumpButton());

    expect(scrolledInto).toEqual([
      {
        element: help(),
        options: { behavior: "smooth", block: "start" },
      },
    ]);
    expect(help()).toHaveFocus();
    // A focus target, never a tab stop of its own.
    expect(help()).toHaveAttribute("tabindex", "-1");
  });

  test("jumps without the animation for someone who asked for less motion", () => {
    setReducedMotion(true);

    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    fireEvent.click(jumpButton());

    expect(scrolledInto[0]?.options).toEqual({
      behavior: "auto",
      block: "start",
    });
  });

  test("keeps its name for screen readers where its label is hidden on a phone", () => {
    renderModal(makeNode(ComponentID.Log, "log-1"));

    const label: HTMLElement = within(jumpButton()).getByText("How to use");

    expect(label.className).toContain("max-sm:sr-only");
    // The responsive form, never a bare sr-only a foreign stylesheet could undo.
    expect(label.className.split(/\s+/)).not.toContain("sr-only");
  });

  test("never takes the focus when the dialog opens", async () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy the webhook URL" }),
    );
    expect(jumpButton()).not.toHaveFocus();
  });

  test("never takes the focus from the first setting either", async () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-component-section-settings"),
      ).toContainElement(document.activeElement as HTMLElement);
    });
    expect(jumpButton()).not.toHaveFocus();
  });

  test("is not a submit button: using it, or the help, never saves the step", () => {
    const onSave: MockFunction = getJestMockFunction();

    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"), { onSave });

    fireEvent.click(jumpButton());
    fireEvent.click(within(help()).getByRole("button", { name: "Learn more" }));
    fireEvent.click(
      within(help()).getAllByRole("button", { name: /^Copy the example/ })[0]!,
    );

    expect(jumpButton()).toHaveAttribute("type", "button");
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("the help is built from this step and this workflow", () => {
  test("renaming the step renames it in the help's example", async () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(
      within(help()).getByTestId("workflow-component-docs-example-code"),
    ).toHaveTextContent(
      "{{local.components.webhook-1.returnValues.request-body.message}}",
    );

    fireEvent.change(screen.getByRole("textbox", { name: /^Identifier/ }), {
      target: { value: "ci-webhook" },
    });

    await waitFor(() => {
      expect(
        within(help()).getByTestId("workflow-component-docs-example-code"),
      ).toHaveTextContent(
        "{{local.components.ci-webhook.returnValues.request-body.message}}",
      );
    });
  });

  test("a Slack step's example puts in a value from the workflow's own trigger", () => {
    const trigger: NodeDataProp = makeNode(
      "incident-on-create",
      "incident-on-create-1",
    );
    const slack: NodeDataProp = makeNode(
      ComponentID.SlackSendMessageToChannel,
      "notify-team",
    );

    renderModal(slack, { graphComponents: [trigger, slack] });

    expect(
      within(help()).getAllByTestId("workflow-component-docs-example-code")[0],
    ).toHaveTextContent(
      "*Heads up:* {{local.components.incident-on-create-1.returnValues.model.title}}",
    );
  });

  test("an Update step's query picks the record the trigger handed on", () => {
    const trigger: NodeDataProp = makeNode(
      "incident-on-create",
      "new-incident",
    );
    const update: NodeDataProp = makeNode(
      "incident-update-one",
      "incident-update-one-1",
    );

    renderModal(update, { graphComponents: [trigger, update] });

    expect(
      within(help()).getAllByTestId("workflow-component-docs-example-code")[0],
    ).toHaveTextContent(
      '{"_id": "{{local.components.new-incident.returnValues.model._id}}"}',
    );
  });

  test("On Delete says only the ID is passed on, and nothing about Select Fields", () => {
    renderModal(makeNode("incident-on-delete", "incident-on-delete-1"));

    fireEvent.click(within(help()).getByRole("button", { name: "Learn more" }));

    expect(help()).toHaveTextContent("Only the ID is passed on.");
    expect(help()).not.toHaveTextContent("Select Fields");
  });
});
