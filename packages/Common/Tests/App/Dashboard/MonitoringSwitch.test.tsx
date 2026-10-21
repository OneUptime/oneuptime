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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Whether OneUptime checks a monitor, end to end on the screen.
 *
 * It used to be a "Monitor Settings" card whose Edit dialog held one switch,
 * "Disable Active Monitoring" (on meant off), and a red banner on every page
 * of a disabled monitor that said "To enable active monitoring, please go to
 * Settings". Now:
 *
 *   - the Settings page's "Monitoring" card is one switch, "Check this
 *     monitor", that saves when flipped (it stores disableActiveMonitoring
 *     the other way round), and asks before it turns monitoring off;
 *   - the banner on a turned-off monitor's pages says what off means and
 *     carries "Turn monitoring on", which turns it back on right there;
 *   - the two follow each other on the same screen.
 *
 * A paused-by-incident or paused-for-maintenance monitor keeps its wording
 * and gets no button: monitoring resumes when that ends.
 *
 * Only the network and the permission gate are stubbed. The fake monitor
 * below answers reads with what was last saved, as the server would.
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

import DisabledWarning, {
  getMonitoringOffNotice,
  MonitoringOffReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import MonitoringCard, {
  getTurnOffMonitoringConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringCard";
import MonitoringSwitchCopy, {
  MONITORING_OFF_BANNER_TEST_ID,
  MONITORING_SWITCH_TEST_ID,
  TURN_MONITORING_ON_BUTTON_TEST_ID,
  TURN_MONITORING_ON_ERROR_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000aa";
const OTHER_MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000bb";

const OFF_SENTENCE: string =
  "Nothing checks this monitor while monitoring is off: its status stays at the last one recorded, and it opens no incidents or alerts.";

// The fake monitor, as the server holds it.
let stored: Partial<Monitor> = {};
let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  stored = {
    monitorType: MonitorType.API,
    disableActiveMonitoring: false,
    disableActiveMonitoringBecauseOfManualIncident: false,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    isArchived: false,
  };
  gate = { isAllowed: true };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    Object.assign(monitor, stored);
    return monitor;
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

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

async function renderCard(): Promise<HTMLElement> {
  render(<MonitoringCard monitorId={new ObjectID(MONITOR_ID)} />);
  return await screen.findByTestId(MONITORING_SWITCH_TEST_ID);
}

async function renderBanner(
  monitorId: string = MONITOR_ID,
): Promise<RenderResult> {
  const view: RenderResult = render(
    <DisabledWarning monitorId={new ObjectID(monitorId)} />,
  );
  await flush();
  return view;
}

function banner(): HTMLElement | null {
  return screen.queryByTestId(MONITORING_OFF_BANNER_TEST_ID);
}

describe("the Monitoring card on a monitor's Settings page", () => {
  test("is one switch, 'Check this monitor', on while the monitor is checked", async () => {
    const control: HTMLElement = await renderCard();

    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pause this monitor without deleting it. Its settings and history are kept.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Check this monitor" })).toBe(
      control,
    );
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "OneUptime checks this monitor and opens incidents and alerts when its criteria match.",
      ),
    ).toBeInTheDocument();

    // It reads the one column it switches.
    const read: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };
    expect(read.select).toEqual({ disableActiveMonitoring: true });
  });

  test("is off for a monitor someone turned off, and says what off means", async () => {
    stored.disableActiveMonitoring = true;

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(OFF_SENTENCE)).toBeInTheDocument();
  });

  test("turning it off asks first, and saves nothing until it is confirmed", async () => {
    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Turn off monitoring?");
    expect(dialog).toHaveTextContent(
      "Nothing will check this monitor until monitoring is turned back on, so it opens no incidents or alerts, even if what it watches goes down.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Turn off monitoring" }),
    );
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Monitor);
    expect(updateCall().id.toString()).toBe(MONITOR_ID);
    expect(updateCall().data).toEqual({ disableActiveMonitoring: true });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId(`${MONITORING_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
  });

  test("cancelling keeps it checked", async () => {
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
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(stored.disableActiveMonitoring).toBe(false);
  });

  test("turning it back on saves at once", async () => {
    stored.disableActiveMonitoring = true;

    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({ disableActiveMonitoring: false });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("the dialog is only for turning it off, with a danger button", () => {
    expect(getTurnOffMonitoringConfirmation(true)).toBeUndefined();
    expect(getTurnOffMonitoringConfirmation(false)).toEqual({
      title: MonitoringSwitchCopy.turnOffConfirmTitle,
      description: MonitoringSwitchCopy.turnOffConfirmDescription,
      submitButtonText: MonitoringSwitchCopy.turnOffConfirmButton,
      submitButtonType: ButtonStyleType.DANGER,
    });
  });

  test("someone who may not change it sees it locked", async () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(control);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("the banner on a turned-off monitor's pages", () => {
  test("says monitoring is turned off and what that means, quietly, with the way back", async () => {
    stored.disableActiveMonitoring = true;

    await renderBanner();

    const shown: HTMLElement = banner()!;
    expect(shown).toHaveTextContent("Monitoring is turned off");
    expect(shown).toHaveTextContent(OFF_SENTENCE);
    // A choice someone made, not an outage: announced politely.
    expect(shown).toHaveAttribute("role", "status");
    expect(
      within(shown).getByRole("button", { name: "Turn monitoring on" }),
    ).toBeEnabled();
    // No longer sends the reader to Settings.
    expect(shown).not.toHaveTextContent("go to Settings");
  });

  test("its button turns monitoring on for this monitor, and the banner goes", async () => {
    stored.disableActiveMonitoring = true;

    await renderBanner();

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Monitor);
    expect(updateCall().id.toString()).toBe(MONITOR_ID);
    // Exactly what the Monitoring switch writes, and nothing else.
    expect(updateCall().data).toEqual({ disableActiveMonitoring: false });

    // It read the monitor again, and the monitor is checked now.
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
  });

  test("a refused change says why in the banner, which stays", async () => {
    stored.disableActiveMonitoring = true;
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "User is not allowed to update on disableActiveMonitoring column of Monitor",
      );
    });

    await renderBanner();

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await flush();

    expect(banner()).not.toBeNull();
    expect(
      screen.getByTestId(TURN_MONITORING_ON_ERROR_TEST_ID),
    ).toHaveTextContent(
      "User is not allowed to update on disableActiveMonitoring column of Monitor",
    );
    expect(
      screen.getByTestId(TURN_MONITORING_ON_ERROR_TEST_ID),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeEnabled();
  });

  test("someone who may not turn it on sees the button locked, and pressing it does nothing", async () => {
    stored.disableActiveMonitoring = true;
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    await renderBanner();

    const button: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await flush();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("while the permissions are still loading there is no button, only the words", async () => {
    stored.disableActiveMonitoring = true;
    gate = { isAllowed: false };

    await renderBanner();

    expect(banner()).toHaveTextContent("Monitoring is turned off");
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
  });

  test("an error for one monitor is not shown on the next one's banner", async () => {
    stored.disableActiveMonitoring = true;
    updateByIdMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("Network error");
    });

    const view: RenderResult = await renderBanner();

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await flush();
    expect(
      screen.getByTestId(TURN_MONITORING_ON_ERROR_TEST_ID),
    ).toBeInTheDocument();

    view.rerender(
      <DisabledWarning monitorId={new ObjectID(OTHER_MONITOR_ID)} />,
    );
    await flush();

    expect(banner()).not.toBeNull();
    expect(screen.queryByTestId(TURN_MONITORING_ON_ERROR_TEST_ID)).toBeNull();
  });

  test.each([
    [
      "an incident",
      { disableActiveMonitoringBecauseOfManualIncident: true },
      "We are not monitoring this monitor since it is disabled because of an active incident. To enable active monitoring, please resolve the incident.",
    ],
    [
      "a scheduled maintenance event",
      { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
      "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.",
    ],
  ])(
    "a monitor paused by %s keeps its wording, and has no button",
    async (_reason: string, pause: Partial<Monitor>, sentence: string) => {
      Object.assign(stored, pause);

      await renderBanner();

      const shown: HTMLElement = banner()!;
      expect(shown).toHaveTextContent("This monitor is disabled");
      expect(shown).toHaveTextContent(sentence);
      expect(
        screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
      ).toBeNull();
    },
  );

  test("a checked, archived or manual monitor has no banner", async () => {
    await renderBanner();
    expect(banner()).toBeNull();
    cleanup();

    stored.disableActiveMonitoring = true;
    stored.isArchived = true;
    await renderBanner();
    expect(banner()).toBeNull();
    cleanup();

    stored.isArchived = false;
    stored.monitorType = MonitorType.Manual;
    await renderBanner();
    expect(banner()).toBeNull();
  });
});

describe("getMonitoringOffNotice", () => {
  const monitorWith: (values: Partial<Monitor>) => Monitor = (
    values: Partial<Monitor>,
  ): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.API;
    Object.assign(monitor, values);
    return monitor;
  };

  test("names why monitoring is off, turned off first", () => {
    expect(
      getMonitoringOffNotice(
        monitorWith({
          disableActiveMonitoring: true,
          disableActiveMonitoringBecauseOfManualIncident: true,
        }),
      ),
    ).toEqual({
      reason: MonitoringOffReason.TurnedOff,
      title: "Monitoring is turned off",
      message: OFF_SENTENCE,
    });

    expect(
      getMonitoringOffNotice(
        monitorWith({ disableActiveMonitoringBecauseOfManualIncident: true }),
      )?.reason,
    ).toBe(MonitoringOffReason.ManualIncident);

    expect(
      getMonitoringOffNotice(
        monitorWith({
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      )?.reason,
    ).toBe(MonitoringOffReason.ScheduledMaintenance);
  });

  test("is nothing for a checked, archived, manual or missing monitor", () => {
    expect(getMonitoringOffNotice(monitorWith({}))).toBeNull();
    expect(
      getMonitoringOffNotice(
        monitorWith({ disableActiveMonitoring: true, isArchived: true }),
      ),
    ).toBeNull();
    expect(
      getMonitoringOffNotice(
        monitorWith({
          monitorType: MonitorType.Manual,
          disableActiveMonitoring: true,
        }),
      ),
    ).toBeNull();
    expect(getMonitoringOffNotice(null)).toBeNull();
  });

  test("the banner and the switch say off the same way", () => {
    expect(
      getMonitoringOffNotice(monitorWith({ disableActiveMonitoring: true }))
        ?.message,
    ).toBe(MonitoringSwitchCopy.offDescription);
  });
});

describe("the card and the banner on one screen (the Settings page)", () => {
  async function renderSettings(): Promise<HTMLElement> {
    render(
      <>
        <DisabledWarning monitorId={new ObjectID(MONITOR_ID)} />
        <MonitoringCard monitorId={new ObjectID(MONITOR_ID)} />
      </>,
    );
    await flush();
    return await screen.findByTestId(MONITORING_SWITCH_TEST_ID);
  }

  test("turning monitoring off brings the banner up, without a reload", async () => {
    const control: HTMLElement = await renderSettings();
    expect(banner()).toBeNull();

    fireEvent.click(control);
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Turn off monitoring",
      }),
    );
    await flush();

    await waitFor(() => {
      expect(banner()).not.toBeNull();
    });
    expect(banner()).toHaveTextContent("Monitoring is turned off");
  });

  test("the banner's button turns the switch on, and the banner goes", async () => {
    stored.disableActiveMonitoring = true;

    const control: HTMLElement = await renderSettings();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(banner()).not.toBeNull();

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await flush();

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(banner()).toBeNull();
    // One save, from the banner; the switch only followed it.
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("turning it back on from the switch takes the banner down", async () => {
    stored.disableActiveMonitoring = true;

    const control: HTMLElement = await renderSettings();

    fireEvent.click(control);
    await flush();

    await waitFor(() => {
      expect(banner()).toBeNull();
    });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("another monitor's switch leaves this banner alone", async () => {
    stored.disableActiveMonitoring = true;

    render(<DisabledWarning monitorId={new ObjectID(MONITOR_ID)} />);
    await flush();
    const reads: number = getItemMock.mock.calls.length;

    render(<MonitoringCard monitorId={new ObjectID(OTHER_MONITOR_ID)} />);
    const otherSwitch: HTMLElement = await screen.findByTestId(
      MONITORING_SWITCH_TEST_ID,
    );
    const readsAfterCard: number = getItemMock.mock.calls.length;
    expect(readsAfterCard).toBe(reads + 1);

    fireEvent.click(otherSwitch);
    await flush();

    // The banner did not read again for another monitor's switch.
    expect(getItemMock.mock.calls.length).toBe(readsAfterCard);
  });
});
