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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The project's session replay master switch, on Real User Monitoring ->
 * Settings -> Session Replay (Dashboard Components/SessionReplay/
 * SessionReplayAllowedCard). It was a card whose Update dialog held one
 * switch; now it is the switch, saving the moment it is flipped - except
 * that turning recording ON asks first, since the switch's own sentence says
 * to confirm the masking policy and the lawful basis before it is on.
 * Turning it OFF never asks: stopping the recording of end users must never
 * take a dialog.
 *
 * The real card, switch and dialog are rendered (and the real page, with
 * its roster table stubbed); only the network, the project and the
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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      return React.createElement("div", {
        "data-testid": `stub-table-${props["id"] as string}`,
      });
    },
  };
});

import SessionReplayAllowedCard, {
  getAllowSessionReplayConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAllowedCard";
import SessionReplayAllowedSwitchCopy, {
  SESSION_REPLAY_ALLOWED_SWITCH_COLUMN,
  SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAllowedSwitchCopy";
import RumSessionReplaySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/Settings/SessionReplay";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f8f8f8f-0000-4000-8000-0000000000aa";

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

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
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
  render(<SessionReplayAllowedCard projectId={new ObjectID(PROJECT_ID)} />);
  await flush();
  return await screen.findByTestId(SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID);
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

describe("Session Replay for this Project", () => {
  test("is one switch under the card's title and line, with no Update button", async () => {
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText(SessionReplayAllowedSwitchCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SessionReplayAllowedSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: SessionReplayAllowedSwitchCopy.switchTitle,
      }),
    ).toBe(control);
    expect(
      screen.getByText(SessionReplayAllowedSwitchCopy.switchDescription),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  test("reads the project's master switch, and only that", async () => {
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
    expect(call.select).toEqual({
      [SESSION_REPLAY_ALLOWED_SWITCH_COLUMN]: true,
    });
  });

  test("a project that never set it is allowed, as the column's default says", async () => {
    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("turning it off saves at once, with no dialog", async () => {
    stored = { isSessionReplayAllowed: true };

    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().id.toString()).toBe(PROJECT_ID);
    expect(updateCall().data).toEqual({ isSessionReplayAllowed: false });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("turning it on asks first, and saves nothing until confirmed", async () => {
    stored = { isSessionReplayAllowed: false };

    const control: HTMLElement = await renderCard();
    expect(control).toHaveAttribute("aria-checked", "false");

    fireEvent.click(control);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      SessionReplayAllowedSwitchCopy.allowConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SessionReplayAllowedSwitchCopy.allowConfirmDescription);
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: SessionReplayAllowedSwitchCopy.allowConfirmButton,
      }),
    );
    await flush();

    expect(updateCall().data).toEqual({ isSessionReplayAllowed: true });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("cancelling leaves recording off", async () => {
    stored = { isSessionReplayAllowed: false };

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

  test("the confirmation is only for turning recording on", () => {
    expect(getAllowSessionReplayConfirmation(false)).toBeUndefined();
    expect(getAllowSessionReplayConfirmation(true)).toEqual({
      title: SessionReplayAllowedSwitchCopy.allowConfirmTitle,
      description: SessionReplayAllowedSwitchCopy.allowConfirmDescription,
      submitButtonText: SessionReplayAllowedSwitchCopy.allowConfirmButton,
    });
  });
});

describe("the RUM Session Replay settings page", () => {
  test("opens on the master switch, for the current project, above the roster", async () => {
    render(
      <MemoryRouter>
        <RumSessionReplaySettings
          pageRoute={new Route("/dashboard")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
    await flush();

    const control: HTMLElement = await screen.findByTestId(
      SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID,
    );
    const roster: HTMLElement = screen.getByTestId(
      "stub-table-rum-application-session-replay-roster-table",
    );

    expect(
      control.compareDocumentPosition(roster) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(PROJECT_ID);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
});
