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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * How often a monitor's probes check it, on its Probes & Interval page.
 *
 * It was a page of its own, Interval, holding one card whose Edit dialog
 * held one dropdown, and that dropdown offered every interval to every
 * type, while Create Monitor offers Synthetic, Custom Code and SSL monitors
 * nothing faster than every 5 minutes. Now it is a dropdown that saves the
 * moment an interval is picked, offered what Create offers the type, plus
 * whatever the monitor has now - a dropdown whose value is not among its
 * options shows only its placeholder, as if the monitor had no interval.
 *
 * The real card, Dropdown (react-select) and Card run; only the network and
 * the permission gate are stubbed. The fake monitor answers with what was
 * last saved, as the server would.
 */

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

import MonitoringIntervalCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringIntervalCard";
import MonitoringIntervalElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringIntervalElement";
import { MONITORING_INTERVAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesAndIntervalCopy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000c1";

const EVERY_INTERVAL: Array<string> = [
  "Every Minute",
  "Every 2 Minutes",
  "Every 5 Minutes",
  "Every 10 Minutes",
  "Every 15 Minutes",
  "Every 30 Minutes",
  "Every Hour",
  "Every Day",
  "Every Week",
];

// The fake monitor's interval, as the server holds it.
let storedInterval: string | undefined = undefined;
let gate: PermissionGateResult = { isAllowed: true };
const gateColumns: Array<string> = [];

beforeEach(() => {
  storedInterval = "*/5 * * * *";
  gate = { isAllowed: true };
  gateColumns.length = 0;

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      storedInterval = (options as { data: { monitoringInterval: string } })
        .data.monitoringInterval;
      return {};
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (_model: unknown, column: unknown): PermissionGateResult => {
      gateColumns.push(column as string);
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

function renderCard(data: {
  monitorType: MonitorType;
  interval: string | null | undefined;
  onSaved?: (interval: string) => void;
}): void {
  render(
    <MonitoringIntervalCard
      monitorId={new ObjectID(MONITOR_ID)}
      monitorType={data.monitorType}
      initialInterval={data.interval}
      onSaved={data.onSaved}
    />,
  );
}

function combobox(): HTMLElement {
  return screen.getByRole("combobox", {
    name: "Monitoring Interval",
    hidden: true,
  });
}

function card(): HTMLElement {
  return screen.getByTestId(`${MONITORING_INTERVAL_TEST_ID}-card`);
}

// What the dropdown shows as picked.
function shownValue(): string {
  return (
    card().querySelector(".ou-select__single-value")?.textContent ||
    card().querySelector(".ou-select__placeholder")?.textContent ||
    ""
  );
}

function openMenu(): void {
  fireEvent.keyDown(combobox(), { key: "ArrowDown", code: "ArrowDown" });
}

function offered(): Array<string> {
  openMenu();

  const labels: Array<string> = screen
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  fireEvent.keyDown(combobox(), { key: "Escape", code: "Escape" });

  return labels;
}

async function pick(label: string): Promise<void> {
  openMenu();

  const option: HTMLElement = screen.getByRole("option", { name: label });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await flush();
}

function status(): HTMLElement {
  return screen.getByTestId(`${MONITORING_INTERVAL_TEST_ID}-status`);
}

describe("the Monitoring Interval card", () => {
  test("says what it is for, and shows the monitor's interval", () => {
    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    expect(
      screen.getByRole("heading", { name: "Monitoring Interval" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("How often each probe checks this monitor."),
    ).toBeInTheDocument();
    expect(shownValue()).toBe("Every 5 Minutes");
    expect(status()).toHaveAttribute("role", "status");
    expect(status()).toHaveTextContent("");
  });

  test("offers an API monitor every interval, shortest first", () => {
    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    expect(offered()).toEqual(EVERY_INTERVAL);
  });

  test.each([
    MonitorType.SyntheticMonitor,
    MonitorType.CustomJavaScriptCode,
    MonitorType.SSLCertificate,
  ])(
    "offers %s monitors what Create offers them: nothing faster than every 5 minutes",
    (monitorType: MonitorType) => {
      renderCard({ monitorType, interval: "*/5 * * * *" });

      expect(offered()).toEqual(EVERY_INTERVAL.slice(2));
    },
  );

  test("a Synthetic monitor already checked every minute shows that, and keeps it on the list", () => {
    renderCard({
      monitorType: MonitorType.SyntheticMonitor,
      interval: "* * * * *",
    });

    expect(shownValue()).toBe("Every Minute");
    expect(offered()).toEqual(["Every Minute", ...EVERY_INTERVAL.slice(2)]);
  });

  test("a cron the list does not have shows in words, in its place on the list", () => {
    renderCard({ monitorType: MonitorType.API, interval: "*/3 * * * *" });

    expect(shownValue()).toBe("Every 3 minutes");
    expect(offered()).toEqual([
      "Every Minute",
      "Every 2 Minutes",
      "Every 3 minutes",
      ...EVERY_INTERVAL.slice(2),
    ]);
  });

  test("a monitor with no interval asks for one", () => {
    renderCard({ monitorType: MonitorType.API, interval: null });

    expect(shownValue()).toBe("Select Monitoring Interval");
  });

  test("picking an interval saves it alone, at once, and says so", async () => {
    const saved: Array<string> = [];
    renderCard({
      monitorType: MonitorType.API,
      interval: "*/5 * * * *",
      onSaved: (interval: string): void => {
        saved.push(interval);
      },
    });

    await pick("Every 15 Minutes");

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Monitor);
    expect(updateCall().id.toString()).toBe(MONITOR_ID);
    expect(updateCall().data).toEqual({ monitoringInterval: "*/15 * * * *" });
    expect(storedInterval).toBe("*/15 * * * *");
    expect(shownValue()).toBe("Every 15 Minutes");
    expect(status()).toHaveTextContent("Saved");
    expect(saved).toEqual(["*/15 * * * *"]);
    // There is no dialog to confirm and no Save button.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  test("says Saving… while the change is on its way, and stays usable", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void): void => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    await pick("Every Hour");

    expect(status()).toHaveTextContent("Saving…");
    // Never locked while it saves, so keyboard focus stays on it.
    expect(combobox()).not.toBeDisabled();

    await act(async () => {
      finish();
    });
    await flush();

    expect(status()).toHaveTextContent("Saved");
  });

  test("picking what the monitor already has saves nothing", async () => {
    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    await pick("Every 5 Minutes");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("");
  });

  test("once saved away from an interval the list leaves out, that interval leaves the list", async () => {
    renderCard({
      monitorType: MonitorType.SyntheticMonitor,
      interval: "* * * * *",
    });

    await pick("Every 10 Minutes");

    expect(updateCall().data).toEqual({ monitoringInterval: "*/10 * * * *" });
    expect(offered()).toEqual(EVERY_INTERVAL.slice(2));
  });

  test("a refused change goes back to the monitor's interval and says why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "You do not have permission to update this Monitor. You need one of these permissions: Edit Monitor.",
      );
    });

    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    await pick("Every Day");

    const error: HTMLElement = screen.getByTestId(
      `${MONITORING_INTERVAL_TEST_ID}-error`,
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(
      "You do not have permission to update this Monitor.",
    );
    expect(shownValue()).toBe("Every 5 Minutes");
    expect(status()).toHaveTextContent("");
    expect(storedInterval).toBe("*/5 * * * *");
  });

  test("a new pick clears the last refusal", async () => {
    updateByIdMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("Refused");
    });

    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    await pick("Every Day");
    expect(
      screen.getByTestId(`${MONITORING_INTERVAL_TEST_ID}-error`),
    ).toHaveTextContent("Refused");

    await pick("Every Hour");

    expect(
      screen.queryByTestId(`${MONITORING_INTERVAL_TEST_ID}-error`),
    ).toBeNull();
    expect(storedInterval).toBe("0 * * * *");
    expect(status()).toHaveTextContent("Saved");
  });

  test("a second pick made while the first saves is saved after it, and the last pick wins", async () => {
    const finishers: Array<() => void> = [];
    updateByIdMock.mockImplementation((options: unknown): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void): void => {
        finishers.push((): void => {
          storedInterval = (options as { data: { monitoringInterval: string } })
            .data.monitoringInterval;
          resolve({});
        });
      });
    });

    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    await pick("Every 10 Minutes");
    await pick("Every 15 Minutes");
    await pick("Every 30 Minutes");

    // One request at a time: the later picks wait.
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(shownValue()).toBe("Every 30 Minutes");

    await act(async () => {
      finishers[0]!();
    });
    await flush();

    // Only the last of the waiting picks is sent.
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(updateCall(1).data).toEqual({ monitoringInterval: "*/30 * * * *" });

    await act(async () => {
      finishers[1]!();
    });
    await flush();

    expect(storedInterval).toBe("*/30 * * * *");
    expect(shownValue()).toBe("Every 30 Minutes");
    expect(status()).toHaveTextContent("Saved");
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
  });

  test("is gated on the interval column itself", () => {
    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    expect(gateColumns).toContain("monitoringInterval");
  });

  test("unlocks once the permissions arrive, which is after a fresh sign-in's first paint", async () => {
    // An empty permission snapshot: locked, with nothing to say yet.
    gate = { isAllowed: false };

    const view: { rerender: (ui: React.ReactElement) => void } = render(
      <MonitoringIntervalCard
        monitorId={new ObjectID(MONITOR_ID)}
        monitorType={MonitorType.API}
        initialInterval="*/5 * * * *"
      />,
    );

    expect(screen.getByRole("combobox", { hidden: true })).toBeDisabled();

    gate = { isAllowed: true };
    view.rerender(
      <MonitoringIntervalCard
        monitorId={new ObjectID(MONITOR_ID)}
        monitorType={MonitorType.API}
        initialInterval="*/5 * * * *"
      />,
    );

    expect(combobox()).not.toBeDisabled();

    await pick("Every Hour");

    expect(updateCall().data).toEqual({ monitoringInterval: "0 * * * *" });
  });

  test("someone who may not change the interval sees it locked, and nothing is saved", async () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    renderCard({ monitorType: MonitorType.API, interval: "*/5 * * * *" });

    /*
     * A disabled react-select hides its input (visibility: hidden), which
     * takes the combobox and its name out of the accessibility tree; the
     * interval itself is still shown as text.
     */
    const locked: HTMLElement = screen.getByRole("combobox", { hidden: true });

    expect(locked).toBeDisabled();
    expect(shownValue()).toBe("Every 5 Minutes");

    fireEvent.keyDown(locked, { key: "ArrowDown", code: "ArrowDown" });
    await flush();

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("an interval shown in words", () => {
  test.each([
    ["*/5 * * * *", "Every 5 Minutes"],
    ["0 * * * *", "Every Hour"],
    ["0 0 * * 0", "Every Week"],
    ["*/3 * * * *", "Every 3 minutes"],
    ["0 */6 * * *", "Every 6 hours"],
    ["5m", "Every 5 Minutes"],
  ])("%s reads %s", (interval: string, words: string) => {
    render(<MonitoringIntervalElement monitoringInterval={interval} />);

    expect(screen.getByText(words)).toBeInTheDocument();
  });

  test("no interval says so instead of showing nothing", () => {
    render(<MonitoringIntervalElement monitoringInterval={undefined} />);

    expect(screen.getByText("No interval defined")).toBeInTheDocument();
  });
});
