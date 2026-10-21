import ComponentSettingsModal, {
  ComponentProps as SettingsProps,
} from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Deleting a step from a workflow asked "Are you sure you want to delete this
 * component? This action is not recoverable." - in a builder that can hold
 * three "Send Email" steps. It now names the step by its kind and the
 * identifier the workflow knows it by: "Send Email (send-email-2)".
 *
 * It also deletes that step. The dialog used to hand back its working copy,
 * so a step whose identifier had been edited in the dialog and not saved was
 * looked up on the canvas by the new identifier, matched nothing, and stayed
 * while the dialog closed as though it had gone.
 */
jest.mock("../../../../UI/Components/Workflow/ArgumentsForm", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="arguments-form" />;
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/DocumentationViewer", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="documentation-viewer" />;
    },
  };
});

const SEND_EMAIL_METADATA: ComponentMetadata = {
  id: "send-email",
  title: "Send Email",
  description: "Send an email.",
  category: "Email",
  iconProp: IconProp.Email,
  componentType: ComponentType.Component,
  arguments: [],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "Start this step." }],
  outPorts: [{ id: "out", title: "Out", description: "Continue." }],
};

const WEBHOOK_METADATA: ComponentMetadata = {
  ...SEND_EMAIL_METADATA,
  id: "webhook",
  title: "Webhook",
  description: "Start the workflow from a request.",
  componentType: ComponentType.Trigger,
  inPorts: [],
};

type MakeStepFunction = (
  metadata: ComponentMetadata,
  id: string,
) => NodeDataProp;

const makeStep: MakeStepFunction = (
  metadata: ComponentMetadata,
  id: string,
): NodeDataProp => {
  return {
    id: id,
    internalId: `internal-${id}`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: metadata,
    error: "",
    arguments: {},
    returnValues: {},
  };
};

interface Harness {
  onDelete: MockFunction;
  onClose: MockFunction;
}

type RenderSettingsFunction = (
  step: NodeDataProp,
  overrides?: Partial<SettingsProps>,
) => Harness;

const renderSettings: RenderSettingsFunction = (
  step: NodeDataProp,
  overrides: Partial<SettingsProps> = {},
): Harness => {
  const onDelete: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();

  render(
    <ComponentSettingsModal
      title={step.metadata.title}
      description={step.metadata.description}
      onClose={onClose}
      onSave={getJestMockFunction()}
      onDelete={onDelete}
      component={step}
      graphComponents={[step]}
      workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
      {...overrides}
    />,
  );

  return { onDelete, onClose };
};

type OpenDeleteFunction = () => HTMLElement;

// Opens the step's Delete confirmation; returns it (the topmost dialog).
const openDelete: OpenDeleteFunction = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");

  return dialogs[dialogs.length - 1]!;
};

describe("the workflow step's Delete confirmation", () => {
  test("names the step by its kind and its identifier", () => {
    renderSettings(makeStep(SEND_EMAIL_METADATA, "send-email-2"));

    const confirmation: HTMLElement = openDelete();

    expect(
      within(confirmation).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "Are you sure you want to delete Send Email (send-email-2)? This action cannot be undone.",
    );
    expect(
      within(confirmation).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent(/^Send Email \(send-email-2\)$/);
    expect(confirmation).not.toHaveTextContent("this component");
  });

  test("does not repeat an identifier that is the step's title", () => {
    renderSettings(makeStep(SEND_EMAIL_METADATA, "Send Email"));

    const confirmation: HTMLElement = openDelete();

    expect(
      within(confirmation).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent(/^Send Email$/);
  });

  test("names a trigger the same way, under its own title", () => {
    renderSettings(makeStep(WEBHOOK_METADATA, "webhook-1"));

    const confirmation: HTMLElement = openDelete();

    expect(
      within(confirmation).getByText("Delete Trigger"),
    ).toBeInTheDocument();
    expect(
      within(confirmation).getByTestId("confirm-modal-description"),
    ).toHaveTextContent("Are you sure you want to delete Webhook (webhook-1)?");
  });

  test("deletes the step it named", () => {
    const harness: Harness = renderSettings(
      makeStep(SEND_EMAIL_METADATA, "send-email-2"),
    );

    const confirmation: HTMLElement = openDelete();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    expect(harness.onDelete).toHaveBeenCalledTimes(1);
    expect((harness.onDelete.mock.calls[0]![0] as NodeDataProp).id).toBe(
      "send-email-2",
    );
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  // The regression: an edited, unsaved identifier names no step on the canvas.
  test("deletes the step on the canvas, not the dialog's unsaved edit of it", async () => {
    const step: NodeDataProp = makeStep(SEND_EMAIL_METADATA, "send-email-2");
    const harness: Harness = renderSettings(step);

    fireEvent.change(screen.getByRole("textbox", { name: /^Identifier/ }), {
      target: { value: "renamed-but-not-saved" },
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /^Identifier/ })).toHaveValue(
        "renamed-but-not-saved",
      );
    });

    const confirmation: HTMLElement = openDelete();

    expect(
      within(confirmation).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent(/^Send Email \(send-email-2\)$/);

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    expect(harness.onDelete).toHaveBeenCalledTimes(1);
    expect(harness.onDelete.mock.calls[0]![0]).toBe(step);
    expect((harness.onDelete.mock.calls[0]![0] as NodeDataProp).id).toBe(
      "send-email-2",
    );
  });

  test("deletes nothing when cancelled", () => {
    const harness: Harness = renderSettings(
      makeStep(SEND_EMAIL_METADATA, "send-email-2"),
    );

    const confirmation: HTMLElement = openDelete();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );

    expect(harness.onDelete).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
  });
});
