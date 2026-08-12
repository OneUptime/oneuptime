import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * ModelDelete is the confirmation behind every "Delete <thing>" card in the
 * product. Two things were added to it so the project delete can ask why the
 * customer is leaving: content inside the confirmation, and a delete action
 * the caller supplies. Both are optional, and the ~60 existing call sites pass
 * neither - so the default path is pinned here just as hard as the new one.
 */

const MODEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

type RenderDeleteFunction = (props?: {
  confirmationContent?: ReactElement | undefined;
  onDelete?: (() => Promise<void>) | undefined;
  onDeleteSuccess?: (() => void) | undefined;
}) => void;

const renderDelete: RenderDeleteFunction = (props?: {
  confirmationContent?: ReactElement | undefined;
  onDelete?: (() => Promise<void>) | undefined;
  onDeleteSuccess?: (() => void) | undefined;
}): void => {
  render(
    <ModelDelete
      modelType={Project}
      modelId={MODEL_ID}
      onDeleteSuccess={props?.onDeleteSuccess || ((): void => {})}
      {...(props?.confirmationContent
        ? { confirmationContent: props.confirmationContent }
        : {})}
      {...(props?.onDelete ? { onDelete: props.onDelete } : {})}
    />,
  );
};

type OpenConfirmationFunction = () => void;

const openConfirmation: OpenConfirmationFunction = (): void => {
  // The card's own button - the card title has the same words but is a heading.
  fireEvent.click(
    screen.getByRole("button", { name: "Delete Project" }) as HTMLElement,
  );
};

describe("ModelDelete", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("does not open the confirmation until the delete button is pressed", () => {
    renderDelete();

    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
  });

  it("asks for confirmation before deleting anything", async () => {
    const deleteItem: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "deleteItem",
    ).mockResolvedValue(undefined);

    renderDelete();
    openConfirmation();

    expect(screen.getByTestId("confirm-modal-description")).toBeInTheDocument();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it("deletes the model by id when no custom delete is given", async () => {
    const deleteItem: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "deleteItem",
    ).mockResolvedValue(undefined);

    renderDelete();
    openConfirmation();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(deleteItem).toHaveBeenCalledWith({
        modelType: Project,
        id: MODEL_ID,
      });
    });
  });

  it("renders the extra confirmation content inside the modal", () => {
    renderDelete({
      confirmationContent: (
        <label data-testid="reason-field">
          Why are you deleting this project?
        </label>
      ),
    });

    expect(screen.queryByTestId("reason-field")).toBeNull();

    openConfirmation();

    expect(screen.getByTestId("reason-field")).toBeInTheDocument();
    expect(
      screen.getByText("Why are you deleting this project?"),
    ).toBeInTheDocument();
    // The confirmation itself is still there.
    expect(screen.getByTestId("confirm-modal-description")).toBeInTheDocument();
  });

  /*
   * The project delete has to send the reason with it, which the generic
   * DELETE cannot carry - so the caller supplies the whole request.
   */
  it("runs the caller's delete instead of the generic one", async () => {
    const deleteItem: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "deleteItem",
    ).mockResolvedValue(undefined);

    let customDeleteRan: boolean = false;

    renderDelete({
      onDelete: async (): Promise<void> => {
        customDeleteRan = true;
      },
    });

    openConfirmation();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(customDeleteRan).toBe(true);
    });

    expect(deleteItem).not.toHaveBeenCalled();
  });

  it("reports success after the caller's delete resolves", async () => {
    let deletedSuccessfully: boolean = false;

    renderDelete({
      onDelete: async (): Promise<void> => {},
      onDeleteSuccess: (): void => {
        deletedSuccessfully = true;
      },
    });

    openConfirmation();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(deletedSuccessfully).toBe(true);
    });
  });

  /*
   * A failed delete must not look like a successful one: the dashboard's
   * success handler clears the current project and navigates away from it.
   */
  it("shows the error and does not report success when the delete fails", async () => {
    let deletedSuccessfully: boolean = false;

    renderDelete({
      onDelete: async (): Promise<void> => {
        throw new Error("Delete on Project is not allowed");
      },
      onDeleteSuccess: (): void => {
        deletedSuccessfully = true;
      },
    });

    openConfirmation();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByText("Delete Error")).toBeInTheDocument();
    });

    expect(deletedSuccessfully).toBe(false);
  });

  it("closes the confirmation without deleting when it is dismissed", async () => {
    const deleteItem: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "deleteItem",
    ).mockResolvedValue(undefined);

    let customDeleteRan: boolean = false;

    renderDelete({
      onDelete: async (): Promise<void> => {
        customDeleteRan = true;
      },
    });

    openConfirmation();
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    });

    expect(customDeleteRan).toBe(false);
    expect(deleteItem).not.toHaveBeenCalled();
  });
});
