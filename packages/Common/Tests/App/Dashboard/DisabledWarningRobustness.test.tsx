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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "This monitor is disabled" banner on the monitor's sub-pages (Probes,
 * Criteria, Settings and a dozen more). It used to have no error handling -
 * a failed read became an unhandled rejection - and it was set but never
 * cleared, so it stayed up after the monitor was re-enabled and carried over
 * to the next monitor.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import DisabledWarning, {
  getDisabledMessage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";

const monitorWith: (data: Partial<Monitor>) => Monitor = (
  data: Partial<Monitor>,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.API;
  Object.assign(monitor, data);
  return monitor;
};

const DISABLED: Monitor = monitorWith({ disableActiveMonitoring: true });
const ENABLED: Monitor = monitorWith({ disableActiveMonitoring: false });

const warning: (monitorId: string, refreshToggle?: string) => ReactElement = (
  monitorId: string,
  refreshToggle?: string,
): ReactElement => {
  return (
    <DisabledWarning
      monitorId={new ObjectID(monitorId)}
      refreshToggle={refreshToggle}
    />
  );
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

const unhandled: Array<unknown> = [];

const onUnhandledRejection: (reason: unknown) => void = (
  reason: unknown,
): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandledRejection);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandledRejection);
  cleanup();
  getItemMock.mockReset();
});

describe("DisabledWarning", () => {
  test("a disabled monitor shows the banner", async () => {
    getItemMock.mockResolvedValue(DISABLED as never);

    render(warning(MONITOR_A));
    await flush();

    expect(screen.getByText("This monitor is disabled")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We are not monitoring this monitor since it is disabled. To enable active monitoring, please go to Settings.",
      ),
    ).toBeInTheDocument();
  });

  test("a rejected read renders nothing and raises no unhandled rejection", async () => {
    getItemMock.mockRejectedValue(new Error("Network error") as never);

    const view: RenderResult = render(warning(MONITOR_A));
    await flush();
    // Give a stray rejection a turn of the event loop to surface.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(view.container.innerHTML).toBe("");
    expect(unhandled).toEqual([]);
  });

  test("the banner clears after re-enable on refreshToggle", async () => {
    getItemMock
      .mockResolvedValueOnce(DISABLED as never)
      .mockResolvedValueOnce(ENABLED as never);

    const view: RenderResult = render(warning(MONITOR_A, "1"));
    await flush();
    expect(screen.getByText("This monitor is disabled")).toBeInTheDocument();

    view.rerender(warning(MONITOR_A, "2"));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("This monitor is disabled")).toBeNull();
  });

  test("a failed refresh does not leave a stale banner up", async () => {
    getItemMock
      .mockResolvedValueOnce(DISABLED as never)
      .mockRejectedValueOnce(new Error("Network error") as never);

    const view: RenderResult = render(warning(MONITOR_A, "1"));
    await flush();
    expect(screen.getByText("This monitor is disabled")).toBeInTheDocument();

    view.rerender(warning(MONITOR_A, "2"));
    await flush();

    expect(screen.queryByText("This monitor is disabled")).toBeNull();
    expect(unhandled).toEqual([]);
  });

  test("a monitor id change re-reads, and never shows the previous monitor's banner", async () => {
    let resolveB: (monitor: Monitor) => void = (): void => {};

    getItemMock.mockResolvedValueOnce(DISABLED as never).mockReturnValueOnce(
      new Promise<Monitor>((resolve: (monitor: Monitor) => void) => {
        resolveB = resolve;
      }) as never,
    );

    const view: RenderResult = render(warning(MONITOR_A));
    await flush();
    expect(screen.getByText("This monitor is disabled")).toBeInTheDocument();

    view.rerender(warning(MONITOR_B));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    const secondRead: { id: ObjectID } = getItemMock.mock.calls[1]![0] as {
      id: ObjectID;
    };
    expect(secondRead.id.toString()).toBe(MONITOR_B);

    // Monitor B has not answered yet: A's banner must already be gone.
    expect(screen.queryByText("This monitor is disabled")).toBeNull();

    await act(async () => {
      resolveB(ENABLED);
    });
    await flush();
    expect(screen.queryByText("This monitor is disabled")).toBeNull();
  });

  test("a late answer for the previous monitor is ignored", async () => {
    let resolveA: (monitor: Monitor) => void = (): void => {};

    getItemMock
      .mockReturnValueOnce(
        new Promise<Monitor>((resolve: (monitor: Monitor) => void) => {
          resolveA = resolve;
        }) as never,
      )
      .mockResolvedValueOnce(ENABLED as never);

    const view: RenderResult = render(warning(MONITOR_A));
    view.rerender(warning(MONITOR_B));
    await flush();

    await act(async () => {
      resolveA(DISABLED);
    });
    await flush();

    expect(screen.queryByText("This monitor is disabled")).toBeNull();
  });

  test("a re-render with the same id does not read again", async () => {
    getItemMock.mockResolvedValue(ENABLED as never);

    const view: RenderResult = render(warning(MONITOR_A, "1"));
    await flush();

    view.rerender(warning(MONITOR_A, "1"));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("getDisabledMessage", () => {
  test("names each reason monitoring is off", () => {
    expect(getDisabledMessage(DISABLED)).toContain("go to Settings");
    expect(
      getDisabledMessage(
        monitorWith({ disableActiveMonitoringBecauseOfManualIncident: true }),
      ),
    ).toContain("resolve the incident");
    expect(
      getDisabledMessage(
        monitorWith({
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toContain("scheduled maintenance event");
  });

  test("an enabled, manual or missing monitor has no banner", () => {
    expect(getDisabledMessage(ENABLED)).toBe("");
    expect(getDisabledMessage(null)).toBe("");
    expect(
      getDisabledMessage(
        monitorWith({
          monitorType: MonitorType.Manual,
          disableActiveMonitoring: true,
        }),
      ),
    ).toBe("");
  });
});
