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
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A form's Status card: one switch, Accepting Submissions, that saves the
 * moment it is flipped, is locked while it saves, and moves back when the
 * server refuses - so it never shows a state the form is not in. Only the
 * network and the permission gate are stubbed; the card and the switch are
 * the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import FormStatusCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormStatusCard";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "../../../Models/DatabaseModels/Form";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000aa";

let stored: { isEnabled?: boolean | undefined } | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let onChange: MockFunction;

beforeEach(() => {
  stored = { isEnabled: true };
  gate = { isAllowed: true };
  onChange = getJestMockFunction();

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const form: Form = new Form();
    form._id = FORM_ID;

    if (stored.isEnabled !== undefined) {
      form.isEnabled = stored.isEnabled;
    }

    return form;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <FormStatusCard
        formId={new ObjectID(FORM_ID)}
        onChange={(value: boolean) => {
          onChange(value);
        }}
      />,
    );
  });
}

function theSwitch(): HTMLElement {
  return screen.getByRole("switch");
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });
}

describe("reading the form", () => {
  test("asks for Enabled, of this form, and nothing else", async () => {
    await renderCard();
    await loaded();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["select"]).toEqual({ isEnabled: true });
  });

  test("is titled Status, the switch Accepting Submissions", async () => {
    await renderCard();
    await loaded();

    expect(screen.getByText(FormsCopy.statusCardTitle)).toBeInTheDocument();
    expect(screen.getByText(FormsCopy.acceptingSubmissions)).toBeInTheDocument();
  });

  test.each([
    [true, "true", FormsCopy.acceptingSubmissionsOn],
    [false, "false", FormsCopy.acceptingSubmissionsOff],
    [undefined, "true", FormsCopy.acceptingSubmissionsOn],
  ])(
    "Enabled %s shows the switch %s, saying what the link does",
    async (
      isEnabled: boolean | undefined,
      checked: string,
      description: string,
    ) => {
      stored = { isEnabled };

      await renderCard();
      await loaded();

      expect(theSwitch()).toHaveAttribute("aria-checked", checked);
      expect(screen.getByText(description)).toBeInTheDocument();
    },
  );

  test("a form that is not there says so, with no switch", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(screen.getByText(FormsCopy.formNotFound)).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("a read that fails says why, with no switch", async () => {
    stored = new Error("The server is down for maintenance.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("The server is down for maintenance."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("flipping the switch", () => {
  test("saves Enabled at once, then shows it and tells the page", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["data"]).toEqual({ isEnabled: false });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(
      screen.getByText(FormsCopy.acceptingSubmissionsOff),
    ).toBeInTheDocument();
  });

  test("and back on", async () => {
    stored = { isEnabled: false };

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });
    expect(updateByIdMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ data: { isEnabled: true } }),
    );
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("is locked while the change is saved", async () => {
    let finish: () => void = (): void => {};

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    // Moved, and locked against a second flip until the save is done.
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(theSwitch()).not.toHaveAttribute("aria-disabled", "true");
    });
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("a refused save moves the switch back, and says why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this form.");
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(screen.getByTestId("form-status-error")).toHaveTextContent(
        "You do not have permission to edit this form.",
      );
    });
    // Back on, as the form still is - the description too.
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });
    expect(
      screen.getByText(FormsCopy.acceptingSubmissionsOn),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    // The next try clears the old error.
    updateByIdMock.mockResolvedValue({} as never);

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(screen.queryByTestId("form-status-error")).not.toBeInTheDocument();
    });
  });
});

describe("who may flip it", () => {
  test("the gate is asked about updating a form", async () => {
    const checkSpy: ReturnType<typeof getJestSpyOn> = PermissionGate.check as never;

    await renderCard();
    await loaded();

    const [model, action] = (checkSpy as unknown as MockFunction).mock
      .calls[0] as [unknown, ModelAction];

    expect(model).toBeInstanceOf(Form);
    expect(action).toBe(ModelAction.Update);
  });

  test("someone who may not edit the form sees the switch locked, and saving does nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Form permission.",
    };

    await renderCard();
    await loaded();

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
  });
});
