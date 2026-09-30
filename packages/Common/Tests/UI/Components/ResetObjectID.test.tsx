import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ResetObjectID: a card whose button replaces a key column with a freshly
 * generated id, after a confirmation, and then says what the new value is.
 *
 * Its wording is generic by default ("Reset Share Key", "Your new Share Key
 * is ..."). A caller whose key is more than a key - an incident form's link,
 * which stops working when it is reset - can name the button apart from the
 * card, put content in the card, and say what the confirmation and the
 * result mean. Every one of those is optional, and a caller that sets none
 * of them gets exactly what it got before.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import ResetObjectID, {
  ComponentProps,
} from "../../../UI/Components/ResetObjectID/ResetObjectID";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000ff";
const NEW_KEY: string = "0b1d3c5e-7f90-4a1b-8c2d-3e4f5a6b7c8d";

let completedWith: Array<string> = [];

beforeEach(() => {
  completedWith = [];

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: true };
    });

  jest.spyOn(ObjectID, "generate").mockImplementation((): ObjectID => {
    return new ObjectID(NEW_KEY);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type ExtraProps = Partial<ComponentProps<IncidentForm>>;

function renderReset(extra: ExtraProps = {}): void {
  const props: ComponentProps<IncidentForm> = {
    modelType: IncidentForm,
    fieldName: "shareKey",
    title: "Reset Share Key",
    description: "Replace the key with a new one.",
    modelId: new ObjectID(FORM_ID),
    onUpdateComplete: (updatedValue: ObjectID): void => {
      completedWith.push(updatedValue.toString());
    },
    ...extra,
  };

  render(<ResetObjectID<IncidentForm> {...props} />);
}

function cardButton(): HTMLElement {
  return screen.getByTestId("card-button");
}

async function click(element: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(element);
  });
}

function modalTitle(): string {
  return screen.getByTestId("modal-title").textContent || "";
}

function modalDescription(): string {
  return screen.getByTestId("confirm-modal-description").textContent || "";
}

function submitButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

describe("by default", () => {
  test("the button is the card's title, and the card has no body", () => {
    renderReset();

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      "Reset Share Key",
    );
    expect(cardButton()).toHaveTextContent("Reset Share Key");
    // Its heading, its description and its button: nothing else.
    expect(screen.getByTestId("card").textContent).toBe(
      "Reset Share KeyReplace the key with a new one.Reset Share Key",
    );
  });

  test("the confirmation and the result name the column", async () => {
    renderReset();

    await click(cardButton());

    // IncidentForm.shareKey's column title is "Share Key".
    expect(modalTitle()).toBe("Reset Share Key");
    expect(modalDescription()).toBe(
      "Are you sure you want to reset Share Key?",
    );
    expect(submitButton()).toHaveTextContent("Reset");

    await click(submitButton());

    expect(modalTitle()).toBe("New Share Key");
    expect(modalDescription()).toBe(`Your new Share Key is ${NEW_KEY}`);
  });

  test("the new id is written to the column, and handed back once the result is closed", async () => {
    renderReset();

    await click(cardButton());
    await click(submitButton());

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: { id: ObjectID; data: Record<string, unknown> } =
      updateByIdMock.mock.calls[0]![0] as {
        id: ObjectID;
        data: Record<string, unknown>;
      };

    expect(request.id.toString()).toBe(FORM_ID);
    expect(request.data).toEqual({ shareKey: NEW_KEY });
    expect(completedWith).toEqual([]);

    await click(submitButton());

    expect(completedWith).toEqual([NEW_KEY]);
    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
  });
});

describe("with its own wording", () => {
  const WORDING: ExtraProps = {
    title: "Share Link",
    buttonTitle: "Reset Link",
    confirmTitle: "Reset the link?",
    confirmDescription: "The current link stops working at once.",
    confirmButtonText: "Reset Link",
    resultTitle: "New Link",
    resultDescription: "The form has a new link.",
  };

  test("the button can say something other than the card's title", () => {
    renderReset(WORDING);

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      "Share Link",
    );
    expect(cardButton()).toHaveTextContent("Reset Link");
    expect(cardButton()).not.toHaveTextContent("Share Link");
  });

  test("the confirmation says what the reset does", async () => {
    renderReset(WORDING);

    await click(cardButton());

    expect(modalTitle()).toBe("Reset the link?");
    expect(modalDescription()).toBe("The current link stops working at once.");
    expect(submitButton()).toHaveTextContent("Reset Link");
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("the result says what happened, and the new id is still handed back", async () => {
    renderReset(WORDING);

    await click(cardButton());
    await click(submitButton());

    expect(modalTitle()).toBe("New Link");
    expect(modalDescription()).toBe("The form has a new link.");
    // Not the generic sentence with the raw id in it.
    expect(modalDescription()).not.toContain(NEW_KEY);

    await click(submitButton());

    expect(completedWith).toEqual([NEW_KEY]);
  });

  test("each text falls back on its own when only some are given", async () => {
    renderReset({ confirmDescription: "The current link stops working." });

    await click(cardButton());

    expect(modalTitle()).toBe("Reset Share Key");
    expect(modalDescription()).toBe("The current link stops working.");
    expect(submitButton()).toHaveTextContent("Reset");

    await click(submitButton());

    expect(modalTitle()).toBe("New Share Key");
    expect(modalDescription()).toBe(`Your new Share Key is ${NEW_KEY}`);
  });

  test("the card shows what it is given as its body", () => {
    const body: ReactElement = (
      <p data-testid="reset-body">https://example.com/form/abc</p>
    );

    renderReset({ ...WORDING, children: body });

    const card: HTMLElement = screen.getByTestId("card");

    expect(card).toContainElement(screen.getByTestId("reset-body"));
    expect(screen.getByTestId("reset-body")).toHaveTextContent(
      "https://example.com/form/abc",
    );
  });

  test("cancelling writes nothing and hands nothing back", async () => {
    renderReset(WORDING);

    await click(cardButton());
    await click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(completedWith).toEqual([]);
  });
});
