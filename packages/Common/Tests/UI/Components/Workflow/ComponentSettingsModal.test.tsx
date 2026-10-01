/*
 * A workflow step's settings dialog, rendered for real: the actual Modal,
 * ArgumentsForm, BasicForm and "How to use" help. Only the network and the
 * dashboard's configured host are stubbed.
 *
 * The complaint this answers: someone opening the Webhook trigger is looking
 * for its URL, and it was buried at the bottom of a narrow sidebar, below a
 * wide card saying the step had no settings and a large empty area.
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

/*
 * Who may reset the webhook URL is read from the signed-in user's permission
 * snapshot. Empty by default - the snapshot "has not landed" - so the reset is
 * only offered where a test grants it.
 */
let mockPermissions: Array<unknown> = [];
let mockIsMasterAdmin: boolean = false;

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
        return mockIsMasterAdmin;
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
import {
  EXECUTE_WORKFLOW_COMPONENT_TITLE,
  RUN_WORKFLOW_BUTTON_TITLE,
} from "../../../../UI/Components/Workflow/ManualTriggerPanel";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import {
  WEBHOOK_TRIGGER_SECRET_MASK,
  getWebhookTriggerCurlExample,
} from "../../../../Types/Workflow/WebhookTrigger";
import getJestMockFunction, { MockFunction } from "../../../MockType";
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
import fs from "fs";
import path from "path";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const WEBHOOK_URL_PREFIX: string =
  "https://oneuptime.example.com/workflow/trigger/";
const WEBHOOK_URL: string = `${WEBHOOK_URL_PREFIX}${SECRET}`;
const MASKED_WEBHOOK_URL: string = `${WEBHOOK_URL_PREFIX}${WEBHOOK_TRIGGER_SECRET_MASK}`;
const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

// packages/Common/Tests/UI/Components/Workflow -> packages
const PACKAGES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

type GetMetadataFunction = (id: string) => ComponentMetadata;

const getMetadata: GetMetadataFunction = (id: string): ComponentMetadata => {
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
    workflowId: WORKFLOW_ID,
    webhookSecretKey: SECRET,
    ...(overrides || {}),
  };

  return render(<ComponentSettingsModal {...props} />);
};

type SectionOrderFunction = () => Array<string>;

// The dialog's sections, top to bottom, by name.
const sectionOrder: SectionOrderFunction = (): Array<string> => {
  return Array.from(
    document.querySelectorAll('[data-testid^="workflow-component-section-"]'),
  ).map((section: Element) => {
    return (section.getAttribute("data-testid") || "").replace(
      "workflow-component-section-",
      "",
    );
  });
};

type SectionFunction = (name: string) => HTMLElement;

const section: SectionFunction = (name: string): HTMLElement => {
  return screen.getByTestId(`workflow-component-section-${name}`);
};

type IsBeforeFunction = (first: Element, second: Element) => boolean;

const isBefore: IsBeforeFunction = (
  first: Element,
  second: Element,
): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

type SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
) => void;

const setClipboard: SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
};

beforeEach(() => {
  mockPermissions = [];
  mockIsMasterAdmin = false;
});

afterEach(() => {
  setClipboard(null);
});

describe("Webhook trigger: the URL is what it is opened for", () => {
  test("the URL is the first thing in the dialog", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const body: HTMLElement = screen.getByTestId("workflow-component-settings");
    const url: HTMLElement = screen.getByTestId("webhook-trigger-url");

    expect(body.firstElementChild).toBe(section("webhook-url"));
    expect(url).toHaveTextContent(WEBHOOK_URL_PREFIX);

    // Above every other section, the identifier included.
    for (const name of ["id", "outputs", "returns", "documentation"]) {
      expect(isBefore(url, section(name))).toBe(true);
    }
  });

  test("the secret key in it stays masked until Show is clicked", () => {
    const { container } = renderModal(
      makeNode(ComponentID.Webhook, "webhook-1"),
    );

    expect(container.ownerDocument.body.innerHTML).not.toContain(SECRET);
    expect(screen.getByTestId("webhook-trigger-url").textContent).toContain(
      MASKED_WEBHOOK_URL,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the full URL" }));

    expect(screen.getByTestId("webhook-trigger-url").textContent).toBe(
      WEBHOOK_URL,
    );
  });

  test("the URL is built from the workflow's own secret key", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      webhookSecretKey: "another-secret",
    });

    fireEvent.click(screen.getByRole("button", { name: "Show the full URL" }));

    expect(screen.getByTestId("webhook-trigger-url").textContent).toBe(
      "https://oneuptime.example.com/workflow/trigger/another-secret",
    );
  });

  test("Copy URL copies exactly the URL and says so", async () => {
    const copied: Array<string> = [];

    setClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const copyButton: HTMLElement = screen.getByRole("button", {
      name: "Copy the webhook URL",
    });

    expect(copyButton).toHaveTextContent("Copy URL");

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(copied).toEqual([WEBHOOK_URL]);
    expect(copyButton).toHaveTextContent("Copied!");
  });

  test("says which methods the URL accepts", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(screen.getByTestId("webhook-trigger-methods").textContent).toBe(
      "Accepts GET or POST requests.",
    );
  });

  test("offers a ready-to-run request to the same URL, with its own copy button", async () => {
    const copied: Array<string> = [];

    setClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const curl: HTMLElement = screen.getByTestId("webhook-trigger-curl");

    // Masked like the URL above it, but its Copy copies the real request.
    expect(curl.textContent).toBe(
      getWebhookTriggerCurlExample(MASKED_WEBHOOK_URL),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the example request" }),
      );
    });

    expect(copied).toEqual([getWebhookTriggerCurlExample(WEBHOOK_URL)]);

    fireEvent.click(screen.getByRole("button", { name: "Show the full URL" }));

    expect(curl.textContent).toBe(getWebhookTriggerCurlExample(WEBHOOK_URL));
    expect(curl.textContent).toContain(`"${WEBHOOK_URL}"`);
  });

  test("keeps the warning that the URL is a secret", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(section("webhook-url")).toHaveTextContent(
      "Anyone with this URL can start the workflow, so keep it private.",
    );
  });

  test("no empty Settings card: the step has none, so there is no section for them", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(
      screen.queryByTestId("workflow-component-section-settings"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("This step does not need any settings."),
    ).not.toBeInTheDocument();
  });

  test("sections run URL, identifier and outputs, returns, documentation - and no inputs", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(sectionOrder()).toEqual([
      "webhook-url",
      "id",
      "outputs",
      "returns",
      "documentation",
    ]);
    expect(section("documentation")).toHaveTextContent(
      "Starts this workflow each time another app or service calls its URL.",
    );
  });

  test("the identifier and the outputs share one row", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const row: HTMLElement = screen.getByTestId(
      "workflow-component-settings-compact-row",
    );

    expect(within(row).getByTestId("workflow-component-section-id")).toBe(
      section("id"),
    );
    expect(within(row).getByTestId("workflow-component-section-outputs")).toBe(
      section("outputs"),
    );
    expect(
      within(row).queryByTestId("workflow-component-section-returns"),
    ).not.toBeInTheDocument();
  });

  test("Returns gives the reference for each part of the request, each with a copy button", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const returns: HTMLElement = section("returns");

    expect(
      within(returns)
        .getAllByTestId("workflow-return-value-reference")
        .map((reference: HTMLElement) => {
          return reference.textContent;
        }),
    ).toEqual([
      "{{local.components.webhook-1.returnValues.request-headers}}",
      "{{local.components.webhook-1.returnValues.request-params}}",
      "{{local.components.webhook-1.returnValues.request-body}}",
    ]);
    expect(
      within(returns).getAllByRole("button", { name: /^Copy the reference/ }),
    ).toHaveLength(3);
  });

  test("the Out port says when it runs, not the Log component's sentence", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(section("outputs")).toHaveTextContent(
      "Connect the steps to run each time the URL is called.",
    );
    expect(section("outputs")).not.toHaveTextContent("logged");
  });

  test("the keyboard starts on Copy URL", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy the webhook URL" }),
    );
  });

  test("without a secret key it says there is no URL yet, and offers nothing to copy", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      webhookSecretKey: "",
    });

    expect(screen.getByTestId("webhook-trigger-url-missing")).toHaveTextContent(
      "This workflow does not have a webhook URL yet.",
    );
    // The URL is created here now, not on the workflow's Settings page.
    expect(section("webhook-url")).not.toHaveTextContent("Settings");
    expect(screen.queryByTestId("webhook-trigger-url")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy the webhook URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-curl"),
    ).not.toBeInTheDocument();
    expect(sectionOrder()[0]).toBe("webhook-url");
  });

  test("the help does not repeat the URL the dialog shows above it, or its secret", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    fireEvent.click(
      within(section("documentation")).getByRole("button", {
        name: "Learn more",
      }),
    );

    const help: string = section("documentation").textContent || "";

    expect(help).toContain("at the top of this dialog");
    expect(help).not.toContain(SECRET);
    expect(help).not.toContain("workflow/trigger/");
  });
});

describe("Webhook trigger: its URL's secret key is managed here, not in Settings", () => {
  const NEW_SECRET: string = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  type WebhookPropsFunction = (
    overrides?: Partial<ComponentProps>,
  ) => ComponentProps;

  const webhookProps: WebhookPropsFunction = (
    overrides?: Partial<ComponentProps>,
  ): ComponentProps => {
    const node: NodeDataProp = makeNode(ComponentID.Webhook, "webhook-1");

    return {
      title: node.metadata.title,
      description: node.metadata.description,
      onClose: getJestMockFunction(),
      onSave: getJestMockFunction(),
      onDelete: getJestMockFunction(),
      component: node,
      graphComponents: [node],
      workflowId: WORKFLOW_ID,
      webhookSecretKey: SECRET,
      canSeeWebhookSecretKey: true,
      onResetWebhookSecretKey:
        getJestMockFunction().mockResolvedValue(undefined),
      ...(overrides || {}),
    };
  };

  type TopDialogFunction = () => HTMLElement;

  // The confirmation opens over the step's own dialog.
  const topDialog: TopDialogFunction = (): HTMLElement => {
    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");

    return dialogs[dialogs.length - 1]!;
  };

  test("Reset URL asks first, then resets the key at once, without the step being saved", async () => {
    mockPermissions = [Permission.EditWorkflow];

    const props: ComponentProps = webhookProps();
    const view: RenderResult = render(<ComponentSettingsModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset URL" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(topDialog()).toHaveTextContent("Reset the webhook URL?");
    expect(topDialog()).toHaveTextContent(
      "the current one stops working at once",
    );
    expect(props.onResetWebhookSecretKey).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(topDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    expect(props.onResetWebhookSecretKey).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    // The builder saved the new key and passes it back in.
    view.rerender(
      <ComponentSettingsModal {...props} webhookSecretKey={NEW_SECRET} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the full URL" }));

    expect(screen.getByTestId("webhook-trigger-url").textContent).toBe(
      `${WEBHOOK_URL_PREFIX}${NEW_SECRET}`,
    );
    expect(
      screen.getByTestId("webhook-trigger-url-reset-done"),
    ).toHaveTextContent("The old one no longer works");
  });

  test("whatever was typed into the step is kept across a reset", async () => {
    mockPermissions = [Permission.ProjectAdmin];

    const props: ComponentProps = webhookProps();
    const view: RenderResult = render(<ComponentSettingsModal {...props} />);

    fireEvent.change(screen.getByRole("textbox", { name: /^Identifier/ }), {
      target: { value: "ci-webhook" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset URL" }));

    await act(async () => {
      fireEvent.click(
        within(topDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    view.rerender(
      <ComponentSettingsModal {...props} webhookSecretKey={NEW_SECRET} />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect((props.onSave as MockFunction).mock.calls[0]![0].id).toBe(
      "ci-webhook",
    );
  });

  test("someone who may not read the key is told who can see the URL, and given nothing to copy or reset", () => {
    mockPermissions = [Permission.Viewer];

    render(
      <ComponentSettingsModal
        {...webhookProps({
          webhookSecretKey: "",
          canSeeWebhookSecretKey: false,
        })}
      />,
    );

    expect(screen.getByTestId("webhook-trigger-url-hidden")).toHaveTextContent(
      "only people who can edit this workflow can see it",
    );
    expect(screen.queryByTestId("webhook-trigger-url")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy the webhook URL" }),
    ).not.toBeInTheDocument();
    // Still the dialog's first section, and the rest of the step still works.
    expect(sectionOrder()[0]).toBe("webhook-url");
    expect(
      screen.getByRole("textbox", { name: /^Identifier/ }),
    ).toBeInTheDocument();
  });

  test("a key handed in for someone who may not read it is never drawn", () => {
    mockPermissions = [Permission.Viewer];

    const { container } = render(
      <ComponentSettingsModal
        {...webhookProps({ canSeeWebhookSecretKey: false })}
      />,
    );

    expect(container.ownerDocument.body.innerHTML).not.toContain(SECRET);
  });

  test("Reset URL is shown disabled, naming the permission it needs, to someone who may not reset it", () => {
    mockPermissions = [Permission.Viewer];

    const props: ComponentProps = webhookProps();

    render(<ComponentSettingsModal {...props} />);

    const button: HTMLElement = screen.getByTestId("webhook-trigger-reset-url");

    expect(button).toBeDisabled();

    fireEvent.mouseEnter(
      screen.getByTestId("webhook-trigger-reset-url-disabled-wrapper"),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to reset this webhook URL. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.",
    );

    fireEvent.click(button);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(props.onResetWebhookSecretKey).not.toHaveBeenCalled();
  });

  test("Delete Workflow alone may update a workflow but not its key, so the reset stays locked", () => {
    mockPermissions = [Permission.DeleteWorkflow];

    render(<ComponentSettingsModal {...webhookProps()} />);

    expect(screen.getByTestId("webhook-trigger-reset-url")).toBeDisabled();
  });

  test("no Reset URL while the permission snapshot has not landed", () => {
    mockPermissions = [];

    render(<ComponentSettingsModal {...webhookProps()} />);

    expect(
      screen.queryByTestId("webhook-trigger-reset-url"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("webhook-trigger-url")).toBeInTheDocument();
  });

  test("a master admin may reset it without any project permission", () => {
    mockPermissions = [];
    mockIsMasterAdmin = true;

    render(<ComponentSettingsModal {...webhookProps()} />);

    expect(screen.getByRole("button", { name: "Reset URL" })).toBeEnabled();
  });

  test("a caller that does not say the key is readable gets no reset, so it can never replace a key it could not see", () => {
    mockPermissions = [Permission.ProjectOwner];

    render(
      <ComponentSettingsModal
        {...webhookProps({
          webhookSecretKey: "",
          canSeeWebhookSecretKey: undefined,
        })}
      />,
    );

    expect(
      screen.getByTestId("webhook-trigger-url-missing"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create URL" }),
    ).not.toBeInTheDocument();
  });

  test("a workflow with no key yet can create one here, straight away", async () => {
    mockPermissions = [Permission.EditWorkflow];

    const props: ComponentProps = webhookProps({ webhookSecretKey: "" });

    render(<ComponentSettingsModal {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create URL" }));
    });

    expect(props.onResetWebhookSecretKey).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  test("a URL that ends in the workflow's own ID is called out as not private", () => {
    mockPermissions = [Permission.EditWorkflow];

    render(
      <ComponentSettingsModal
        {...webhookProps({ webhookSecretKey: WORKFLOW_ID.toString() })}
      />,
    );

    expect(
      screen.getByTestId("webhook-trigger-url-is-workflow-id"),
    ).toHaveTextContent(
      "This URL ends in the workflow's ID, which anyone who can open the workflow can see. Reset it to get a private URL.",
    );
  });

  test("the ID is recognised whatever its case", () => {
    mockPermissions = [Permission.EditWorkflow];

    render(
      <ComponentSettingsModal
        {...webhookProps({
          webhookSecretKey: WORKFLOW_ID.toString().toUpperCase(),
        })}
      />,
    );

    expect(
      screen.getByTestId("webhook-trigger-url-is-workflow-id"),
    ).toBeInTheDocument();
  });

  test("a key of its own gets no such warning", () => {
    mockPermissions = [Permission.EditWorkflow];

    render(<ComponentSettingsModal {...webhookProps()} />);

    expect(
      screen.queryByTestId("webhook-trigger-url-is-workflow-id"),
    ).not.toBeInTheDocument();
  });

  test("no other step offers a URL to reset", () => {
    mockPermissions = [Permission.ProjectOwner];

    for (const id of [ComponentID.Manual, ComponentID.Schedule]) {
      const view: RenderResult = render(
        <ComponentSettingsModal
          {...webhookProps({ component: makeNode(id, `${id}-1`) })}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Reset URL" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("webhook-trigger-url"),
      ).not.toBeInTheDocument();

      view.unmount();
    }
  });
});

describe("Manual trigger: says how it is started", () => {
  test("opens on how to run it, with no Settings section", () => {
    renderModal(makeNode(ComponentID.Manual, "manual-1"));

    expect(sectionOrder()).toEqual([
      "how-to-run",
      "id",
      "outputs",
      "returns",
      "documentation",
    ]);

    const howToRun: HTMLElement = screen.getByTestId(
      "manual-trigger-how-to-run",
    );

    expect(howToRun).toHaveTextContent(
      `Click ${RUN_WORKFLOW_BUTTON_TITLE} in the builder's toolbar`,
    );
    expect(howToRun).toHaveTextContent(
      `with an ${EXECUTE_WORKFLOW_COMPONENT_TITLE} step`,
    );
  });

  test("names the real toolbar button and the real component", () => {
    const builder: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Workflow",
        "View",
        "Builder.tsx",
      ),
      "utf8",
    );

    expect(builder).toContain(`title="${RUN_WORKFLOW_BUTTON_TITLE}"`);
    expect(getMetadata(ComponentID.WorkflowRun).title).toBe(
      EXECUTE_WORKFLOW_COMPONENT_TITLE,
    );
  });

  test("its JSON return value describes what it holds", () => {
    renderModal(makeNode(ComponentID.Manual, "manual-1"));

    expect(section("returns")).toHaveTextContent(
      "The JSON this run was started with.",
    );
    expect(
      within(section("returns")).getByTestId("workflow-return-value-reference"),
    ).toHaveTextContent("{{local.components.manual-1.returnValues.value}}");
  });

  test("the focus is not left on a copy button halfway down", () => {
    renderModal(makeNode(ComponentID.Manual, "manual-1"));

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
});

/*
 * "I dont see value picker here, just like we have on Create One Incident
 * component fields... not have things like 'Pick value from other component
 * or from variable'." - the maintainer, on this very dialog for the Log step.
 */
describe("A step's settings have the value picker in them", () => {
  test("the Log step's Value has { } in it, and no links under it", () => {
    renderModal(makeNode(ComponentID.Log, "log-1"));

    const settings: HTMLElement = section("settings");

    expect(
      within(settings).getByTestId("workflow-argument-value-insert-value"),
    ).toHaveAccessibleName("Insert a value from an earlier step or a variable");
    expect(within(settings).queryByText(/Pick this value/i)).toBeNull();
    expect(
      within(settings).queryByRole("button", { name: "component" }),
    ).toBeNull();
    expect(
      within(settings).queryByRole("button", { name: "variable." }),
    ).toBeNull();
  });
});

describe("Steps with settings open on them", () => {
  test("Schedule opens on its schedule", () => {
    renderModal(makeNode(ComponentID.Schedule, "schedule-1"));

    expect(sectionOrder()).toEqual([
      "settings",
      "id",
      "outputs",
      "documentation",
    ]);
    expect(section("settings")).toHaveTextContent("Schedule at");
  });

  test("API Get opens on its settings, with every reference section below", () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    expect(sectionOrder()).toEqual([
      "settings",
      "id",
      "inputs",
      "outputs",
      "returns",
      "documentation",
    ]);
    expect(section("settings")).toHaveTextContent("URL");
  });

  test("the keyboard starts in the settings, not in the identifier", async () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    await waitFor(() => {
      expect(section("settings")).toContainElement(
        document.activeElement as HTMLElement,
      );
    });

    expect(document.activeElement).not.toBe(
      screen.getByRole("textbox", { name: /^Identifier/ }),
    );
  });

  test("API Get's ports say what success and error mean for a request", () => {
    renderModal(makeNode(ComponentID.ApiGet, "api-get-1"));

    expect(section("outputs")).toHaveTextContent(
      "Runs when the server answers with a success status (2xx).",
    );
    expect(section("outputs")).toHaveTextContent(
      "Runs when the request fails or the server answers with an error status.",
    );
    expect(section("outputs")).not.toHaveTextContent("message");
  });
});

describe("Identifier, saving and the footer", () => {
  test("renaming the step updates every reference in Returns", async () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    fireEvent.change(screen.getByRole("textbox", { name: /^Identifier/ }), {
      target: { value: "ci-webhook" },
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("workflow-return-value-reference")[0],
      ).toHaveTextContent(
        "{{local.components.ci-webhook.returnValues.request-headers}}",
      );
    });
  });

  test("Save hands back the step with its new identifier", async () => {
    const onSave: MockFunction = getJestMockFunction();

    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      onSave: onSave,
    });

    fireEvent.change(screen.getByRole("textbox", { name: /^Identifier/ }), {
      target: { value: "ci-webhook" },
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("workflow-return-value-reference")[0],
      ).toHaveTextContent("ci-webhook");
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]![0] as NodeDataProp).id).toBe("ci-webhook");
  });

  test("Delete asks first, then deletes the step and closes", () => {
    const onDelete: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();
    const node: NodeDataProp = makeNode(ComponentID.Webhook, "webhook-1");

    renderModal(node, { onDelete: onDelete, onClose: onClose });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete Trigger")).toBeInTheDocument();

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
    const confirm: HTMLElement = dialogs[dialogs.length - 1]!;

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect((onDelete.mock.calls[0]![0] as NodeDataProp).id).toBe("webhook-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("an action can still be run on its own from the footer", () => {
    const onRunStep: MockFunction = getJestMockFunction();

    renderModal(makeNode(ComponentID.Log, "log-1"), { onRunStep: onRunStep });

    fireEvent.click(screen.getByRole("button", { name: "Run just this step" }));

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");

    fireEvent.click(
      within(dialogs[dialogs.length - 1]!).getByRole("button", {
        name: "Run this step",
      }),
    );

    expect(onRunStep).toHaveBeenCalledTimes(1);
  });
});
