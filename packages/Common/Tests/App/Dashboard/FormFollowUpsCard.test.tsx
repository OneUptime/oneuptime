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
 * A form's Follow-Ups card, on its On Submit page (Types/Form/FormFollowUp):
 * one switch that saves the moment it is flipped, locked while it saves, and
 * moved back when the server refuses. Only the network and the permission
 * gate are stubbed.
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

import FormFollowUpsCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormFollowUpsCard";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "../../../Models/DatabaseModels/Form";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000bb";

let stored: { enableFollowUps?: boolean | undefined } | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  stored = { enableFollowUps: true };
  gate = { isAllowed: true };

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

    if (stored.enableFollowUps !== undefined) {
      form.enableFollowUps = stored.enableFollowUps;
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
    render(<FormFollowUpsCard formId={new ObjectID(FORM_ID)} />);
  });
}

async function loaded(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  return screen.getByRole("switch");
}

describe("reading the form", () => {
  test("asks for Follow-Ups, of this form, and nothing else", async () => {
    await renderCard();
    await loaded();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["select"]).toEqual({ enableFollowUps: true });
  });

  test("says what the switch does, on and off", async () => {
    await renderCard();
    await loaded();

    expect(
      screen.getAllByText(FormsCopy.followUpsCardTitle).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(FormsCopy.followUpsOn)).toBeInTheDocument();
  });

  test("a form that never had the switch set reads as off", async () => {
    stored = {};

    await renderCard();
    const theSwitch: HTMLElement = await loaded();

    expect(theSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(FormsCopy.followUpsOff)).toBeInTheDocument();
  });

  test("a form that is gone says so instead of a switch", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(screen.getByText(FormsCopy.formNotFound)).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("flipping the switch", () => {
  test("saves the one column at once", async () => {
    await renderCard();
    const theSwitch: HTMLElement = await loaded();

    await act(async (): Promise<void> => {
      fireEvent.click(theSwitch);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["data"]).toEqual({ enableFollowUps: false });
    expect(screen.getByText(FormsCopy.followUpsOff)).toBeInTheDocument();
  });

  test("moves back, with the reason, when the server refuses", async () => {
    updateByIdMock.mockRejectedValue(new Error("No permission") as never);

    await renderCard();
    const theSwitch: HTMLElement = await loaded();

    await act(async (): Promise<void> => {
      fireEvent.click(theSwitch);
    });

    await waitFor(() => {
      expect(screen.getByTestId("form-follow-ups-error")).toBeInTheDocument();
    });

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  test("is locked for somebody who may not edit the form", async () => {
    gate = { isAllowed: false, disabledReason: "You may not edit forms." };

    await renderCard();
    const theSwitch: HTMLElement = await loaded();

    await act(async (): Promise<void> => {
      fireEvent.click(theSwitch);
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
