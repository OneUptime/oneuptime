/*
 * The Incoming Email trigger's settings dialog, rendered for real: the actual
 * Modal, sections, address panel, Returns and "How to use" help. Only the
 * network, the signed-in user's permissions and the dashboard's configured
 * inbound email domain are stubbed.
 *
 * Someone opening this step has come for its email address, so the address is
 * the first thing in the dialog - exactly where the Webhook trigger puts its
 * URL - with its key masked, a copy button that the keyboard starts on, and
 * Reset address for those who may.
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
    INBOUND_EMAIL_DOMAIN: "inbound.oneuptime.example",
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
        return error instanceof Error ? error.message : String(error);
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
 * Who may reset the address is read from the signed-in user's permission
 * snapshot. Empty by default - the snapshot "has not landed" - so a reset is
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
import * as UIConfig from "../../../../UI/Config";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import { INCOMING_EMAIL_TRIGGER_SECRET_MASK } from "../../../../Types/Workflow/IncomingEmailTrigger";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NEW_SECRET: string = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const DOMAIN: string = "inbound.oneuptime.example";
const ADDRESS: string = `workflow-${SECRET}@${DOMAIN}`;
const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const metadata: ComponentMetadata = Components.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.IncomingEmail;
  },
)!;

const node: NodeDataProp = {
  error: "",
  id: "incoming-email-1",
  nodeType: NodeType.Node,
  metadata: metadata,
  metadataId: metadata.id,
  internalId: "internal-incoming-email-1",
  arguments: {},
  returnValues: {},
  componentType: metadata.componentType,
};

const modalProps: (overrides?: Partial<ComponentProps>) => ComponentProps = (
  overrides?: Partial<ComponentProps>,
): ComponentProps => {
  return {
    title: metadata.title,
    description: metadata.description,
    onClose: getJestMockFunction(),
    onSave: getJestMockFunction(),
    onDelete: getJestMockFunction(),
    component: node,
    graphComponents: [node],
    workflowId: WORKFLOW_ID,
    incomingEmailSecretKey: SECRET,
    canSeeIncomingEmailSecretKey: true,
    onResetIncomingEmailSecretKey:
      getJestMockFunction().mockResolvedValue(undefined),
    ...(overrides || {}),
  };
};

// The dialog's sections, top to bottom, by name.
const sectionOrder: () => Array<string> = (): Array<string> => {
  return Array.from(
    document.querySelectorAll('[data-testid^="workflow-component-section-"]'),
  ).map((section: Element) => {
    return (section.getAttribute("data-testid") || "").replace(
      "workflow-component-section-",
      "",
    );
  });
};

const section: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getByTestId(`workflow-component-section-${name}`);
};

/*
 * The dashboard reads INBOUND_EMAIL_DOMAIN off its config module when the
 * dialog draws, so a test sets it there: what the server says about inbound
 * email, as the browser sees it.
 */
const setInboundDomain: (domain: string | undefined) => void = (
  domain: string | undefined,
): void => {
  (UIConfig as unknown as Record<string, unknown>)["INBOUND_EMAIL_DOMAIN"] =
    domain;
};

beforeEach(() => {
  mockPermissions = [Permission.EditWorkflow];
  mockIsMasterAdmin = false;
  setInboundDomain(DOMAIN);
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("Incoming Email trigger: the address is what it is opened for", () => {
  test("the address is the first thing in the dialog", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    expect(sectionOrder()[0]).toBe("email-address");
    expect(
      within(section("email-address")).getByTestId(
        "incoming-email-trigger-address",
      ),
    ).toBeInTheDocument();
  });

  test("sections run address, identifier and outputs, returns, documentation - and no settings or inputs", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    expect(sectionOrder()).toEqual([
      "email-address",
      "id",
      "outputs",
      "returns",
      "documentation",
    ]);
  });

  test("the address is built from the workflow's key and the server's inbound domain, masked until Show", () => {
    const { container } = render(<ComponentSettingsModal {...modalProps()} />);

    const box: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-address",
    );

    expect(box.textContent).toContain(
      `workflow-${INCOMING_EMAIL_TRIGGER_SECRET_MASK}`,
    );
    expect(box.textContent).toContain(`@${DOMAIN}`);
    expect(container.ownerDocument.body.innerHTML).not.toContain(SECRET);

    fireEvent.click(
      screen.getByTestId("incoming-email-trigger-address-visibility"),
    );

    expect(box.textContent).toBe(ADDRESS);
  });

  test("Copy address copies exactly the address", async () => {
    const copied: Array<string> = [];

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string): Promise<void> => {
          copied.push(text);
        },
      },
      configurable: true,
    });

    render(<ComponentSettingsModal {...modalProps()} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the email address" }),
      );
    });

    expect(copied).toEqual([ADDRESS]);
  });

  test("the keyboard starts on Copy address", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy the email address" }),
    );
  });

  test("Returns gives a reference for every part of the email, by the step's own identifier", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    const returns: string = section("returns").textContent || "";

    for (const value of [
      "from",
      "to",
      "cc",
      "subject",
      "body",
      "html-body",
      "headers",
      "attachments",
      "received-at",
    ]) {
      expect(returns).toContain(
        `{{local.components.incoming-email-1.returnValues.${value}}}`,
      );
    }
  });

  test("the help does not repeat the address the dialog shows above it, or its key", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    const help: HTMLElement = section("documentation");

    expect(help).toHaveTextContent("at the top of this dialog");
    expect(help.textContent).not.toContain("workflow-");
    expect(help.textContent).not.toContain(SECRET);
  });

  test("the trigger has nothing to run on its own, so no Run just this step", () => {
    render(<ComponentSettingsModal {...modalProps()} />);

    expect(
      screen.queryByRole("button", { name: "Run just this step" }),
    ).not.toBeInTheDocument();
  });
});

describe("Incoming Email trigger: its address is managed here", () => {
  test("Reset address asks first, then resets the key at once, without the step being saved", async () => {
    const onReset: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);
    const props: ComponentProps = modalProps({
      onResetIncomingEmailSecretKey: onReset,
    });
    const { rerender } = render(<ComponentSettingsModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset address" }));

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
    const confirm: HTMLElement = dialogs[dialogs.length - 1]!;

    expect(confirm).toHaveTextContent("Reset the email address?");

    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Reset address" }),
      );
    });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();

    rerender(
      <ComponentSettingsModal {...props} incomingEmailSecretKey={NEW_SECRET} />,
    );

    fireEvent.click(
      screen.getByTestId("incoming-email-trigger-address-visibility"),
    );

    expect(
      screen.getByTestId("incoming-email-trigger-address").textContent,
    ).toBe(`workflow-${NEW_SECRET}@${DOMAIN}`);
    expect(
      screen.getByTestId("incoming-email-trigger-address-reset-done"),
    ).toBeInTheDocument();
  });

  test("whatever was typed into the step is kept across a reset", async () => {
    const props: ComponentProps = modalProps();
    const { rerender } = render(<ComponentSettingsModal {...props} />);

    fireEvent.change(screen.getByDisplayValue("incoming-email-1"), {
      target: { value: "vendor-alerts" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset address" }));

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");

    await act(async () => {
      fireEvent.click(
        within(dialogs[dialogs.length - 1]!).getByRole("button", {
          name: "Reset address",
        }),
      );
    });

    rerender(
      <ComponentSettingsModal {...props} incomingEmailSecretKey={NEW_SECRET} />,
    );

    expect(screen.getByDisplayValue("vendor-alerts")).toBeInTheDocument();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])("%s is offered Reset address", (permission: Permission) => {
    mockPermissions = [permission];

    render(<ComponentSettingsModal {...modalProps()} />);

    expect(
      screen.getByTestId("incoming-email-trigger-reset-address"),
    ).toBeEnabled();
  });

  test("Delete Workflow alone may update a workflow but not its key, so the reset stays locked", () => {
    mockPermissions = [Permission.DeleteWorkflow];

    render(<ComponentSettingsModal {...modalProps()} />);

    const button: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-reset-address",
    );

    expect(button).toBeDisabled();

    fireEvent.mouseEnter(
      screen.getByTestId(
        "incoming-email-trigger-reset-address-disabled-wrapper",
      ),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to reset this email address. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.",
    );
  });

  test("no Reset address while the permission snapshot has not landed", () => {
    mockPermissions = [];

    render(<ComponentSettingsModal {...modalProps()} />);

    expect(
      screen.queryByTestId("incoming-email-trigger-reset-address"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("incoming-email-trigger-address"),
    ).toBeInTheDocument();
  });

  test("a master admin may reset it without any project permission", () => {
    mockPermissions = [];
    mockIsMasterAdmin = true;

    render(<ComponentSettingsModal {...modalProps()} />);

    expect(
      screen.getByTestId("incoming-email-trigger-reset-address"),
    ).toBeEnabled();
  });

  test("someone who may not read the key is told who can see the address, and nothing is created for them", () => {
    mockPermissions = [Permission.Viewer];
    const onReset: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        {...modalProps({
          incomingEmailSecretKey: "",
          canSeeIncomingEmailSecretKey: false,
          onResetIncomingEmailSecretKey: onReset,
        })}
      />,
    );

    expect(
      screen.getByTestId("incoming-email-trigger-address-hidden"),
    ).toBeInTheDocument();
    expect(sectionOrder()[0]).toBe("email-address");
    expect(onReset).not.toHaveBeenCalled();
  });

  test("a key handed in for someone who may not read it is never drawn", () => {
    render(
      <ComponentSettingsModal
        {...modalProps({ canSeeIncomingEmailSecretKey: false })}
      />,
    );

    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});

describe("Incoming Email trigger: a step whose address does not exist yet", () => {
  test("opening it creates the address, for someone who may", async () => {
    const onReset: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);

    render(
      <ComponentSettingsModal
        {...modalProps({
          incomingEmailSecretKey: "",
          onResetIncomingEmailSecretKey: onReset,
        })}
      />,
    );

    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  test("not before the permission snapshot has landed: an empty key could be a hidden one", () => {
    mockPermissions = [];
    const onReset: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        {...modalProps({
          incomingEmailSecretKey: "",
          onResetIncomingEmailSecretKey: onReset,
        })}
      />,
    );

    expect(onReset).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("incoming-email-trigger-address-missing"),
    ).toBeInTheDocument();
  });

  test("not without the builder saying the key was readable", () => {
    const onReset: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        {...modalProps({
          incomingEmailSecretKey: "",
          canSeeIncomingEmailSecretKey: undefined,
          onResetIncomingEmailSecretKey: onReset,
        })}
      />,
    );

    expect(onReset).not.toHaveBeenCalled();
  });
});

describe("Incoming Email trigger: a server that receives no email", () => {
  test("says the server is not set up for it, with a link to the setup guide, and creates nothing", () => {
    setInboundDomain(undefined);
    const onReset: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        {...modalProps({
          incomingEmailSecretKey: "",
          onResetIncomingEmailSecretKey: onReset,
        })}
      />,
    );

    expect(sectionOrder()[0]).toBe("email-address");
    expect(
      screen.getByTestId("incoming-email-trigger-not-configured"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How to set up inbound email" }),
    ).toHaveAttribute(
      "href",
      "https://oneuptime.example.com/docs/self-hosted/sendgrid-inbound-email",
    );
    expect(onReset).not.toHaveBeenCalled();
  });

  test("even a workflow that has a key shows no address then", () => {
    setInboundDomain("");

    render(<ComponentSettingsModal {...modalProps()} />);

    expect(
      screen.queryByTestId("incoming-email-trigger-address"),
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});

describe("the other triggers are untouched", () => {
  test("the Webhook trigger still opens on its URL, not on an email address", () => {
    const webhook: ComponentMetadata = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.Webhook;
      },
    )!;

    render(
      <ComponentSettingsModal
        {...modalProps({
          title: webhook.title,
          component: {
            ...node,
            id: "webhook-1",
            metadata: webhook,
            metadataId: webhook.id,
          },
          webhookSecretKey: "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b",
        })}
      />,
    );

    expect(sectionOrder()[0]).toBe("webhook-url");
    expect(
      screen.queryByTestId("workflow-component-section-email-address"),
    ).not.toBeInTheDocument();
  });
});
