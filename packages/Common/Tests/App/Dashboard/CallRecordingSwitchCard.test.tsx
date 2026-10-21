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
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Record and transcribe incident calls, the project's one switch for it, on
 * Project Settings > Workspace > Video Calls (Dashboard
 * Components/VideoCall/CallRecordingSwitchCard). It saves the moment it is
 * flipped - except that turning it ON asks first: it records people, and
 * everyone on those calls sees the provider say so. Turning it OFF never
 * asks.
 *
 * The real card, switch and dialog are rendered; only the network and the
 * permission gate are stubbed.
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

import CallRecordingSwitchCard, {
  getRecordIncidentCallsConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallRecordingSwitchCard";
import CallRecordingSwitchCopy, {
  CALL_RECORDING_SWITCH_COLUMN,
  CALL_RECORDING_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallRecordingSwitchCopy";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "8f8f8f8f-0000-4000-8000-0000000000cc";

let stored: Record<string, unknown> = {};

beforeEach(() => {
  stored = {};

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    Object.assign(project, stored);
    return project;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(
        stored,
        (options as { data: Record<string, unknown> }).data,
      );
      return {};
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderCard(): Promise<HTMLElement> {
  render(<CallRecordingSwitchCard projectId={new ObjectID(PROJECT_ID)} />);
  await flush();
  return await screen.findByTestId(CALL_RECORDING_SWITCH_TEST_ID);
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

describe("Call transcripts on the Video Calls page", () => {
  test("is one switch under the card's title and line, saying what it does and what it cannot record", async () => {
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText(CallRecordingSwitchCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CallRecordingSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: CallRecordingSwitchCopy.switchTitle,
      }),
    ).toBe(control);

    const description: HTMLElement = screen.getByText(
      (_content: string, element: Element | null): boolean => {
        return (
          element !== null &&
          element.textContent ===
            `${CallRecordingSwitchCopy.switchDescription} ${CallRecordingSwitchCopy.switchNote}`
        );
      },
      { ignore: "script, style" },
    );

    expect(description).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  test("reads the project's switch, and only that", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const call: { modelType: unknown; id: ObjectID; select: unknown } =
      getItemMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: unknown;
      };

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual({ [CALL_RECORDING_SWITCH_COLUMN]: true });
  });

  test("a project that never set it records nothing, as the column's default says", async () => {
    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("turning it on asks first, saying calls are recorded, and saves nothing until confirmed", async () => {
    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName(
      CallRecordingSwitchCopy.turnOnConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(CallRecordingSwitchCopy.turnOnConfirmDescription);
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: CallRecordingSwitchCopy.turnOnConfirmButton,
      }),
    );
    await flush();

    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().id.toString()).toBe(PROJECT_ID);
    expect(updateCall().data).toEqual({
      recordAndTranscribeIncidentCalls: true,
    });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("cancelling leaves calls unrecorded", async () => {
    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("turning it off saves at once, with no dialog", async () => {
    stored = { recordAndTranscribeIncidentCalls: true };

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "true");

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({
      recordAndTranscribeIncidentCalls: false,
    });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("the confirmation is only for turning recording on", () => {
    expect(getRecordIncidentCallsConfirmation(false)).toBeUndefined();
    expect(getRecordIncidentCallsConfirmation(true)).toEqual({
      title: CallRecordingSwitchCopy.turnOnConfirmTitle,
      description: CallRecordingSwitchCopy.turnOnConfirmDescription,
      submitButtonText: CallRecordingSwitchCopy.turnOnConfirmButton,
    });
  });

  test("a member who may not change the project sees the switch, locked", async () => {
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return {
          isAllowed: false,
          disabledReason: "You need the Project Admin role.",
        };
      },
    );

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
