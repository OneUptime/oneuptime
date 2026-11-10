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
 * THE MONITORING CARD ON A MONITOR GROUP'S OVERVIEW (issue #6401).
 *
 * Turning monitoring off for a group's monitors took the Monitors list, a
 * selection and a bulk Disable - of one page of the list, never of "the
 * group" - and nothing on the group said it was off. The card says how
 * many of the group's monitors are checked and turns monitoring off or on
 * for every one of them at once:
 *
 *   - Turn off monitoring while any monitor is checked, Turn monitoring on
 *     while any is not; both while the group is mixed;
 *   - turning it off asks first - in the dialog, why it failed - and
 *     turning it on saves at once, saying on the card why it failed;
 *   - the page is told the group's monitors as they are afterwards;
 *   - someone who may not flip a monitor's switch sees the buttons locked,
 *     with why; while permissions load there are none.
 *
 * The server and the permission gate are stubbed.
 */

const mockSetMonitoring: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringAPI",
  () => {
    return {
      __esModule: true,
      fetchMonitorGroupMonitoringSummary: jest.fn(),
      setMonitorGroupMonitoring: (...args: Array<unknown>): unknown => {
        return mockSetMonitoring(...args);
      },
    };
  },
);

import MonitorGroupMonitoringCard from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCard";
import MonitorGroupMonitoringCopy, {
  MONITOR_GROUP_MONITORING_CARD_TEST_ID,
  MONITOR_GROUP_MONITORING_ERROR_TEST_ID,
  MONITOR_GROUP_MONITORING_STATE_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCopy";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { MonitorGroupMonitoringSummary } from "../../../Utils/Monitor/MonitorGroupMonitoring";

const GROUP_ID: string = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

const LOCKED_REASON: string =
  "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.";

let gate: PermissionGateResult = { isAllowed: true };
let onChange: MockFunction;

beforeEach(() => {
  gate = { isAllowed: true };
  onChange = getJestMockFunction();

  mockSetMonitoring.mockReset();
  mockSetMonitoring.mockImplementation(async (data: unknown) => {
    const isMonitoringOn: boolean = (data as { isMonitoringOn: boolean })
      .isMonitoringOn;
    return { monitorCount: 3, monitoringOffCount: isMonitoringOn ? 0 : 3 };
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function renderCard(summary: MonitorGroupMonitoringSummary): void {
  render(
    <MonitorGroupMonitoringCard
      monitorGroupId={new ObjectID(GROUP_ID)}
      summary={summary}
      onChange={
        onChange as unknown as (s: MonitorGroupMonitoringSummary) => void
      }
    />,
  );
}

function stateLine(): HTMLElement {
  return screen.getByTestId(MONITOR_GROUP_MONITORING_STATE_TEST_ID);
}

function turnOffButton(): HTMLElement | null {
  return screen.queryByTestId(MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID);
}

function turnOnButton(): HTMLElement | null {
  return screen.queryByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID);
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("what the card says", () => {
  test("titled Monitoring, with what it does", () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    expect(screen.getByText("Monitoring")).toBeVisible();
    expect(
      screen.getByText(
        "Turn monitoring off or on for every monitor in this group at once.",
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_CARD_TEST_ID),
    ).toBeVisible();
  });

  test("every monitor checked: monitoring is on, and the one way on is Turn off monitoring", () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    expect(stateLine()).toHaveTextContent(
      "Monitoring is on for every monitor in this group.",
    );
    expect(turnOffButton()).toHaveTextContent("Turn off monitoring");
    expect(turnOnButton()).toBeNull();
  });

  test("none checked: monitoring is off - what that means - and Turn monitoring on", () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 3 });

    expect(stateLine()).toHaveTextContent(
      "Monitoring is off for every monitor in this group. Nothing checks them, and they open no incidents or alerts until monitoring is turned back on.",
    );
    expect(turnOnButton()).toHaveTextContent("Turn monitoring on");
    expect(turnOffButton()).toBeNull();
  });

  test("some off, some on: how many of how many, and both ways", () => {
    renderCard({ monitorCount: 5, monitoringOffCount: 2 });

    expect(stateLine()).toHaveTextContent(
      "Monitoring is off for 2 of 5 monitors in this group.",
    );
    expect(turnOnButton()).not.toBeNull();
    expect(turnOffButton()).not.toBeNull();
  });

  test("a single monitor reads as every monitor, on or off", () => {
    renderCard({ monitorCount: 1, monitoringOffCount: 1 });
    expect(stateLine()).toHaveTextContent(MonitorGroupMonitoringCopy.offLine);
  });
});

describe("Turn off monitoring", () => {
  test("asks first, in the words of a monitor's own switch, with a danger button", () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    fireEvent.click(turnOffButton()!);

    expect(
      within(dialog()).getByText("Turn off monitoring for this group?"),
    ).toBeVisible();
    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "Nothing checks these monitors until monitoring is back on, so they open no incidents or alerts. Their open ones set to auto-resolve are resolved now.",
    );
    expect(mockSetMonitoring).not.toHaveBeenCalled();
  });

  test("Cancel turns nothing off", async () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    fireEvent.click(turnOffButton()!);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockSetMonitoring).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("confirmed, turns it off for the whole group and tells the page what the group is now", async () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    fireEvent.click(turnOffButton()!);
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Turn off monitoring" }),
    );
    await flush();

    expect(mockSetMonitoring).toHaveBeenCalledTimes(1);
    expect(mockSetMonitoring).toHaveBeenCalledWith({
      monitorGroupId: new ObjectID(GROUP_ID),
      isMonitoringOn: false,
    });
    expect(onChange).toHaveBeenCalledWith({
      monitorCount: 3,
      monitoringOffCount: 3,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("refused, says why in the dialog, which stays open; the page is told nothing", async () => {
    mockSetMonitoring.mockRejectedValue(
      new Error("You do not have permission to edit Monitor.") as never,
    );
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    fireEvent.click(turnOffButton()!);
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Turn off monitoring" }),
    );
    await flush();

    expect(dialog()).toHaveTextContent(
      "You do not have permission to edit Monitor.",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(MONITOR_GROUP_MONITORING_ERROR_TEST_ID),
    ).toBeNull();
  });

  test("two presses of the dialog's button turn it off once", async () => {
    let finish: () => void = () => {};
    mockSetMonitoring.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        finish = () => {
          resolve({ monitorCount: 3, monitoringOffCount: 3 });
        };
      });
    });
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    fireEvent.click(turnOffButton()!);
    const confirm: HTMLElement = within(dialog()).getByRole("button", {
      name: "Turn off monitoring",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    finish();
    await flush();

    expect(mockSetMonitoring).toHaveBeenCalledTimes(1);
  });
});

describe("Turn monitoring on", () => {
  test("saves at once, with no dialog, and tells the page", async () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 3 });

    fireEvent.click(turnOnButton()!);
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();

    expect(mockSetMonitoring).toHaveBeenCalledWith({
      monitorGroupId: new ObjectID(GROUP_ID),
      isMonitoringOn: true,
    });
    expect(onChange).toHaveBeenCalledWith({
      monitorCount: 3,
      monitoringOffCount: 0,
    });
  });

  test("refused - the pay-as-you-go gate, say - says why on the card", async () => {
    mockSetMonitoring.mockRejectedValue(
      new Error("Please add a payment method to enable monitoring.") as never,
    );
    renderCard({ monitorCount: 3, monitoringOffCount: 3 });

    fireEvent.click(turnOnButton()!);
    await flush();

    const error: HTMLElement = screen.getByTestId(
      MONITOR_GROUP_MONITORING_ERROR_TEST_ID,
    );
    expect(error).toHaveTextContent(
      "Please add a payment method to enable monitoring.",
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("pressed again after a refusal, the old reason goes while it tries", async () => {
    mockSetMonitoring.mockRejectedValueOnce(new Error("Try again.") as never);
    renderCard({ monitorCount: 3, monitoringOffCount: 3 });

    fireEvent.click(turnOnButton()!);
    await flush();
    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_ERROR_TEST_ID),
    ).toBeVisible();

    fireEvent.click(turnOnButton()!);
    await flush();
    expect(
      screen.queryByTestId(MONITOR_GROUP_MONITORING_ERROR_TEST_ID),
    ).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("who may turn it", () => {
  test("someone who may not flip a monitor's switch sees both buttons locked, with why, and pressing does nothing", async () => {
    gate = { isAllowed: false, disabledReason: LOCKED_REASON };
    renderCard({ monitorCount: 5, monitoringOffCount: 2 });

    for (const button of [turnOnButton()!, turnOffButton()!]) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockSetMonitoring).not.toHaveBeenCalled();
  });

  test("while the permissions are still loading there are no buttons, only the words", () => {
    gate = { isAllowed: false };
    renderCard({ monitorCount: 5, monitoringOffCount: 2 });

    expect(turnOnButton()).toBeNull();
    expect(turnOffButton()).toBeNull();
    expect(stateLine()).toHaveTextContent(
      "Monitoring is off for 2 of 5 monitors in this group.",
    );
  });

  test("the gate asked is the one a monitor's own switch asks: updating its monitoring column", () => {
    renderCard({ monitorCount: 3, monitoringOffCount: 0 });

    expect(PermissionGate.checkColumnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "disableActiveMonitoring",
    );
  });
});
