/*
 * A record's own Delete page (ModelDelete) says what goes with it - the same
 * sentence (DeleteConsequences) a list's row Delete and bulk Delete say -
 * on the card before anything is clicked and in the dialog, each time as a
 * paragraph of its own under the question. A kind with nothing to add says
 * the question alone.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import { DELETE_CONSEQUENCES } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "31111111-1111-4111-8111-111111111111",
);

const STATUS_PAGE_CONSEQUENCE: string =
  "Deleting a status page also deletes its subscribers, private users and custom domains.";

beforeEach(() => {
  jest.restoreAllMocks();
  getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a record's Delete page says what goes with it", () => {
  it("is the catalog's sentence for the kind", () => {
    expect(DELETE_CONSEQUENCES["StatusPage"]!.sentence).toBe(
      STATUS_PAGE_CONSEQUENCE,
    );
  });

  it("on the card, under the statement, before anything is clicked", () => {
    render(
      <ModelDelete
        modelType={StatusPage}
        modelId={STATUS_PAGE_ID}
        itemName="Production"
        onDeleteSuccess={(): void => {}}
      />,
    );

    const card: HTMLElement = screen.getByTestId("model-delete-card-message");

    expect(card.textContent).toBe(
      `Permanently delete Production. This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE}`,
    );
    expect(
      within(card).getByTestId("delete-confirmation-consequence").textContent,
    ).toBe(STATUS_PAGE_CONSEQUENCE);
  });

  it("in the dialog, under the question", () => {
    render(
      <ModelDelete
        modelType={StatusPage}
        modelId={STATUS_PAGE_ID}
        itemName="Production"
        onDeleteSuccess={(): void => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Status Page" }));

    const dialog: HTMLElement = screen.getByTestId("confirm-modal-description");

    expect(dialog).toHaveTextContent(
      `Are you sure you want to delete Production? This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE}`,
    );
    expect(
      within(dialog).getByTestId("delete-confirmation-consequence").textContent,
    ).toBe(STATUS_PAGE_CONSEQUENCE);
  });

  it("a kind with nothing to add asks the question alone", () => {
    // A project is deleted with its own words, on its own page.
    expect(DELETE_CONSEQUENCES["Project"]).toBeUndefined();

    render(
      <ModelDelete
        modelType={Project}
        modelId={STATUS_PAGE_ID}
        itemName="Acme"
        onDeleteSuccess={(): void => {}}
      />,
    );

    expect(screen.getByTestId("model-delete-card-message").textContent).toBe(
      "Permanently delete Acme. This action cannot be undone.",
    );
    expect(screen.queryByTestId("delete-confirmation-consequence")).toBeNull();
  });
});
