/*
 * A workflow step's settings dialog, rendered for real: the actual Modal,
 * ArgumentsForm and BasicForm. Only the network, the dashboard's configured
 * host and the documentation file are stubbed.
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
 * The documentation is a markdown file fetched from the server; what it says
 * is not under test here, only where its section sits.
 */
jest.mock("../../../../UI/Components/Workflow/DocumentationViewer", () => {
  return {
    __esModule: true,
    default: (props: { documentationLink: { toString: () => string } }) => {
      return (
        <div data-testid="documentation-viewer">
          {props.documentationLink.toString()}
        </div>
      );
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
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import { getWebhookTriggerCurlExample } from "../../../../Types/Workflow/WebhookTrigger";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, describe, expect, test } from "@jest/globals";
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
const WEBHOOK_URL: string = `https://oneuptime.example.com/workflow/trigger/${SECRET}`;
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

afterEach(() => {
  setClipboard(null);
});

describe("Webhook trigger: the URL is what it is opened for", () => {
  test("the URL is the first thing in the dialog", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const body: HTMLElement = screen.getByTestId("workflow-component-settings");
    const url: HTMLElement = screen.getByTestId("webhook-trigger-url");

    expect(body.firstElementChild).toBe(section("webhook-url"));
    expect(url).toHaveTextContent(WEBHOOK_URL);

    // Above every other section, the identifier included.
    for (const name of ["id", "outputs", "returns", "documentation"]) {
      expect(isBefore(url, section(name))).toBe(true);
    }
  });

  test("the URL is built from the workflow's own secret key", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      webhookSecretKey: "another-secret",
    });

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
      "AcceptsGETorPOSTrequests.",
    );
  });

  test("offers a ready-to-run request to the same URL, with its own copy button", async () => {
    const copied: Array<string> = [];

    setClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    renderModal(makeNode(ComponentID.Webhook, "webhook-1"));

    const curl: HTMLElement = screen.getByTestId("webhook-trigger-curl");

    expect(curl.textContent).toBe(getWebhookTriggerCurlExample(WEBHOOK_URL));
    expect(curl.textContent).toContain(`"${WEBHOOK_URL}"`);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the example request" }),
      );
    });

    expect(copied).toEqual([getWebhookTriggerCurlExample(WEBHOOK_URL)]);
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
    expect(screen.getByTestId("documentation-viewer")).toHaveTextContent(
      "/workflow/docs/Webhook.md",
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

  test("without a secret key it says where the URL comes from, and offers nothing to copy", () => {
    renderModal(makeNode(ComponentID.Webhook, "webhook-1"), {
      webhookSecretKey: "",
    });

    expect(screen.getByTestId("webhook-trigger-url-missing")).toHaveTextContent(
      "This workflow does not have a webhook URL yet.",
    );
    expect(screen.queryByTestId("webhook-trigger-url")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy the webhook URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-curl"),
    ).not.toBeInTheDocument();
    expect(sectionOrder()[0]).toBe("webhook-url");
  });

  test("the documentation file no longer repeats the URL the dialog shows above it", () => {
    const markdown: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App",
        "FeatureSet",
        "Workflow",
        "Docs",
        "ComponentDocumentation",
        "Webhook.md",
      ),
      "utf8",
    );

    expect(markdown).not.toContain("{{webhookSecretKey}}");
    expect(markdown).not.toContain("{{serverUrl}}");
    expect(markdown).not.toContain("workflow/trigger/");
    expect(markdown).toContain("top of this dialog");
  });
});

describe("Manual trigger: says how it is started", () => {
  test("opens on how to run it, with no Settings section", () => {
    renderModal(makeNode(ComponentID.Manual, "manual-1"));

    expect(sectionOrder()).toEqual(["how-to-run", "id", "outputs", "returns"]);

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

describe("Steps with settings open on them", () => {
  test("Schedule opens on its schedule", () => {
    renderModal(makeNode(ComponentID.Schedule, "schedule-1"));

    expect(sectionOrder()).toEqual(["settings", "id", "outputs"]);
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
