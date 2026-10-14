/*
 * A step after a Webhook or Incoming Email trigger that nothing has reached
 * yet, while the workflow is off. Its trigger refuses requests (and ignores
 * email) until the workflow is on, so the value picker cannot say "send a
 * test request": it says the trigger is off, and offers a test run with Run
 * Workflow instead. Pressing it saves what was typed in the step, then asks
 * the builder to open Run Workflow.
 *
 * Rendered for real - the dialog, its settings form, the value picker and
 * its default sources; only the network and the configured host are stubbed.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;
  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("../../../../Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
    INBOUND_EMAIL_DOMAIN: "inbound.oneuptime.example",
  };
});

// No step has run: /step-samples has nothing for any of them.
jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
      post: jest.fn(async () => {
        return { data: { samples: [] } };
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
      getCommonHeaders: jest.fn(() => {
        return {};
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
import { StepSampleCopy } from "../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import { StepValueSources } from "../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";

type MakeNodeFunction = (metadataId: string, id: string) => NodeDataProp;

const makeNode: MakeNodeFunction = (
  metadataId: string,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === metadataId;
    },
  )!;

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

interface RenderedDialog {
  onSave: MockFunction;
  onRequestTestRun: MockFunction;
  log: NodeDataProp;
}

type RenderDialogFunction = (options: {
  trigger: NodeDataProp;
  value?: string;
  overrides?: Partial<ComponentProps>;
}) => RenderedDialog;

// A Log step's settings, right after the trigger.
const renderDialog: RenderDialogFunction = (options: {
  trigger: NodeDataProp;
  value?: string;
  overrides?: Partial<ComponentProps>;
}): RenderedDialog => {
  const onSave: MockFunction = getJestMockFunction();
  const onRequestTestRun: MockFunction = getJestMockFunction();
  const log: NodeDataProp = makeNode(ComponentID.Log, "log-1");
  log.arguments = options.value === undefined ? {} : { value: options.value };

  const valueSources: StepValueSources = {
    upstream: [options.trigger],
    downstreamIds: [],
    hasIncomingConnection: true,
  };

  const props: ComponentProps = {
    title: log.metadata.title,
    description: log.metadata.description,
    onClose: getJestMockFunction(),
    onSave: onSave,
    onDelete: getJestMockFunction(),
    component: log,
    graphComponents: [options.trigger, log],
    valueSources: valueSources,
    workflowId: WORKFLOW_ID,
    webhookSecretKey: SECRET,
    isWorkflowOff: true,
    onRequestTestRun: onRequestTestRun as unknown as () => void,
    ...(options.overrides || {}),
  };

  render(<ComponentSettingsModal {...props} />);

  return { onSave: onSave, onRequestTestRun: onRequestTestRun, log: log };
};

type OpenPickerFunction = () => Promise<HTMLElement>;

// Opens the Value's picker and waits for the trigger's note.
const openPicker: OpenPickerFunction = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByTestId("workflow-argument-value-insert-value"));

  return waitFor(() => {
    return screen.getByTestId("value-picker-group-note");
  });
};

const webhook: NodeDataProp = makeNode(ComponentID.Webhook, "webhook-1");
const email: NodeDataProp = makeNode(
  ComponentID.IncomingEmail,
  "incoming-email-1",
);

afterEach(() => {
  cleanup();
});

describe("a Webhook nothing has called, while the workflow is off", () => {
  test("the picker says its URL refuses requests, and offers a test run", async () => {
    renderDialog({ trigger: webhook, value: "Hello" });

    const note: HTMLElement = await openPicker();

    expect(note).toHaveTextContent(
      "No request has reached this webhook yet, and while this workflow is off its URL refuses requests. Test it with Run Workflow: the fields of the request you send there show up here.",
    );
    // A request to copy would be refused: none is offered.
    expect(within(note).queryByTestId("value-picker-note-copy")).toBeNull();
    expect(
      within(note).getByTestId("value-picker-note-waiting"),
    ).toHaveTextContent("Waiting for a test run…");
    expect(
      within(note).getByTestId("value-picker-note-test-run"),
    ).toHaveTextContent("Test with Run Workflow");
  });

  test("the test run saves what was typed first, then asks for Run Workflow", async () => {
    const { onSave, onRequestTestRun } = renderDialog({
      trigger: webhook,
      value: "Deploy finished",
    });

    await openPicker();
    fireEvent.click(screen.getByTestId("value-picker-note-test-run"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]![0] as NodeDataProp).arguments).toEqual(
      expect.objectContaining({ value: "Deploy finished" }),
    );
    expect(onRequestTestRun).toHaveBeenCalledTimes(1);
    expect(onSave.mock.invocationCallOrder[0]!).toBeLessThan(
      onRequestTestRun.mock.invocationCallOrder[0]!,
    );
  });

  test("a step that cannot be saved yet is not saved for a test run", async () => {
    // The Log's Value is required, and empty.
    const { onSave, onRequestTestRun } = renderDialog({ trigger: webhook });

    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    });

    const note: HTMLElement = await openPicker();

    // The note still says why there are no fields; it just offers no run.
    expect(note).toHaveTextContent("while this workflow is off");
    expect(within(note).queryByTestId("value-picker-note-test-run")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRequestTestRun).not.toHaveBeenCalled();
  });

  test("someone who may not run the workflow is offered no test run", async () => {
    renderDialog({
      trigger: webhook,
      value: "Hello",
      overrides: { onRequestTestRun: undefined },
    });

    const note: HTMLElement = await openPicker();

    expect(note).toHaveTextContent("while this workflow is off");
    expect(within(note).queryByTestId("value-picker-note-test-run")).toBeNull();
  });
});

describe("the same Webhook while the workflow is on", () => {
  test("the picker offers a test request to copy, and no test run", async () => {
    renderDialog({
      trigger: webhook,
      value: "Hello",
      overrides: { isWorkflowOff: false },
    });

    const note: HTMLElement = await openPicker();

    expect(note).toHaveTextContent(StepSampleCopy.noRequestYetWithTest);
    expect(
      within(note).getByTestId("value-picker-note-copy"),
    ).toHaveTextContent("Copy test request");
    expect(within(note).queryByTestId("value-picker-note-test-run")).toBeNull();
  });
});

describe("an Incoming Email trigger no email has reached, while the workflow is off", () => {
  test("the picker says email to it is ignored, and offers a test run", async () => {
    const { onRequestTestRun } = renderDialog({
      trigger: email,
      value: "Hello",
    });

    const note: HTMLElement = await openPicker();

    expect(note).toHaveTextContent(
      "No email has reached the workflow's address yet, and while this workflow is off email to it is ignored. Test it with Run Workflow: the fields of the email you fill in there show up here.",
    );

    fireEvent.click(within(note).getByTestId("value-picker-note-test-run"));
    expect(onRequestTestRun).toHaveBeenCalledTimes(1);
  });

  test("on, it waits for an email, and offers no test run", async () => {
    renderDialog({
      trigger: email,
      value: "Hello",
      overrides: { isWorkflowOff: false },
    });

    const note: HTMLElement = await openPicker();

    expect(note).toHaveTextContent(StepSampleCopy.noEmailYet);
    expect(within(note).queryByTestId("value-picker-note-test-run")).toBeNull();
  });
});
