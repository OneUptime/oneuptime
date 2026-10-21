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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The probe picker of a Probe Status monitor, as a person meets it on
 * Create Monitor and on the monitor's Criteria: the probes the project may
 * watch, grouped as the Probes page groups them, already filled in for a
 * new monitor so most people only check it and move on - and never filled
 * in over what an existing monitor already watches.
 *
 * ProbeUtil is the network boundary here: the real one reads the project's
 * probes and the global ones from two endpoints.
 */

const mockGetAllProbes: MockFunction = getJestMockFunction();

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __probeStatusStepFormConfig: MutableConfig }
).__probeStatusStepFormConfig = config;

/*
 * BILLING_ENABLED is read when the module loads, and CI runs these suites
 * with BILLING_ENABLED=true in config.env: a getter here, switched per test,
 * so the self-hosted and the Cloud defaults are each tested whatever the
 * environment says.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __probeStatusStepFormConfig: MutableConfig | undefined;
          }
        ).__probeStatusStepFormConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (...args: Array<unknown>) => {
        return mockGetAllProbes(...args);
      },
    },
  };
});

import ProbeStatusMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProbeStatusMonitor/ProbeStatusMonitorStepForm";
import Probe from "../../../Models/DatabaseModels/Probe";
import MonitorStepProbeStatusMonitor from "../../../Types/Monitor/MonitorStepProbeStatusMonitor";
import Navigation from "../../../UI/Utils/Navigation";

const OFFICE_ID: string = "7a000000-0000-4000-8000-000000000001";
const DATA_CENTER_ID: string = "7a000000-0000-4000-8000-000000000002";
const GLOBAL_ID: string = "7a000000-0000-4000-8000-000000000003";
const DELETED_ID: string = "7a000000-0000-4000-8000-000000000099";

function probe(id: string, name: string, isGlobalProbe: boolean): Probe {
  const item: Probe = new Probe();
  item._id = id;
  item.name = name;
  item.isGlobalProbe = isGlobalProbe;
  return item;
}

const OFFICE: Probe = probe(OFFICE_ID, "Office LAN", false);
const DATA_CENTER: Probe = probe(DATA_CENTER_ID, "Data Center", false);
const BUNDLED: Probe = probe(GLOBAL_ID, "Probe", true);

/*
 * The step form is controlled: the monitor form holds the value. The
 * harness holds it the same way and records every change.
 */
const changes: Array<MonitorStepProbeStatusMonitor> = [];

function Harness(props: { probeIds: Array<string> }): ReactElement {
  const [value, setValue] = useState<MonitorStepProbeStatusMonitor>({
    probeIds: props.probeIds,
  });

  return (
    <MemoryRouter>
      <ProbeStatusMonitorStepForm
        monitorStepProbeStatusMonitor={value}
        onChange={(next: MonitorStepProbeStatusMonitor) => {
          changes.push(next);
          setValue(next);
        }}
      />
    </MemoryRouter>
  );
}

let watchProbeId: string | null = null;

beforeEach(() => {
  changes.length = 0;
  watchProbeId = null;
  // A self-hosted installation unless a test says it is OneUptime Cloud.
  config.billingEnabled = false;
  mockGetAllProbes.mockReset();
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return name === "watchProbeId" ? watchProbeId : null;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The picker, by the name a screen reader announces.
function picker(): HTMLElement | null {
  return screen.queryByRole("combobox", { name: "Probes to watch" });
}

async function picked(): Promise<Array<string>> {
  await waitFor(() => {
    expect(picker()).toBeInTheDocument();
  });

  return screen
    .queryAllByRole("button", { name: /^Remove / })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace(/^Remove /, "");
    });
}

describe("ProbeStatusMonitorStepForm", () => {
  test("a new monitor starts watching the project's own probes", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE, BUNDLED, DATA_CENTER] as never);

    render(<Harness probeIds={[]} />);

    await waitFor(() => {
      expect(changes).toHaveLength(1);
    });
    expect(changes[0]).toEqual({ probeIds: [DATA_CENTER_ID, OFFICE_ID] });
    expect(await picked()).toEqual(["Data Center", "Office LAN"]);
  });

  test("on a self-hosted installation with only global probes, it starts on those", async () => {
    mockGetAllProbes.mockResolvedValue([BUNDLED] as never);

    render(<Harness probeIds={[]} />);

    await waitFor(() => {
      expect(changes).toEqual([{ probeIds: [GLOBAL_ID] }]);
    });
    expect(await picked()).toEqual(["Probe"]);
  });

  test("on OneUptime Cloud, a project with only global probes starts with none picked", async () => {
    config.billingEnabled = true;
    mockGetAllProbes.mockResolvedValue([BUNDLED] as never);

    render(<Harness probeIds={[]} />);

    // Loaded, offered, and not picked: Cloud's global probes are OneUptime's.
    expect(await picked()).toEqual([]);
    expect(changes).toEqual([]);
  });

  test("on OneUptime Cloud too, a project's own probes are picked", async () => {
    config.billingEnabled = true;
    mockGetAllProbes.mockResolvedValue([OFFICE, BUNDLED] as never);

    render(<Harness probeIds={[]} />);

    await waitFor(() => {
      expect(changes).toEqual([{ probeIds: [OFFICE_ID] }]);
    });
    expect(await picked()).toEqual(["Office LAN"]);
  });

  test("from Monitor this probe, it starts on that probe alone", async () => {
    watchProbeId = GLOBAL_ID;
    mockGetAllProbes.mockResolvedValue([OFFICE, BUNDLED, DATA_CENTER] as never);

    render(<Harness probeIds={[]} />);

    await waitFor(() => {
      expect(changes).toEqual([{ probeIds: [GLOBAL_ID] }]);
    });
    expect(await picked()).toEqual(["Probe"]);
  });

  test("an existing monitor keeps what it watches: nothing is filled in over it", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE, BUNDLED, DATA_CENTER] as never);

    render(<Harness probeIds={[GLOBAL_ID]} />);

    expect(await picked()).toEqual(["Probe"]);
    expect(changes).toEqual([]);
  });

  test("a watched probe that was deleted shows as such, so it can be removed", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE] as never);

    render(<Harness probeIds={[OFFICE_ID, DELETED_ID]} />);

    expect(await picked()).toEqual(["Office LAN", "Deleted probe"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Deleted probe" }),
    );

    await waitFor(() => {
      expect(changes[changes.length - 1]).toEqual({ probeIds: [OFFICE_ID] });
    });
    expect(await picked()).toEqual(["Office LAN"]);
  });

  test("removing a probe leaves the rest, in the order picked", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE, BUNDLED, DATA_CENTER] as never);

    render(<Harness probeIds={[OFFICE_ID, GLOBAL_ID, DATA_CENTER_ID]} />);

    expect(await picked()).toEqual(["Office LAN", "Probe", "Data Center"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Probe" }));

    await waitFor(() => {
      expect(changes[changes.length - 1]).toEqual({
        probeIds: [OFFICE_ID, DATA_CENTER_ID],
      });
    });
  });

  test("with no probe to watch, it says so and links to the Probes page", async () => {
    mockGetAllProbes.mockResolvedValue([] as never);

    render(<Harness probeIds={[]} />);

    const empty: HTMLElement = await screen.findByTestId(
      "probe-status-monitor-no-probes",
    );

    expect(empty).toHaveTextContent(
      "There is no probe to watch yet. Add a custom probe first.",
    );
    expect(screen.getByText("Go to Probes").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/monitors/settings/probes"),
    );
    expect(changes).toEqual([]);
  });

  test("probes that cannot be loaded say why, and nothing is filled in", async () => {
    mockGetAllProbes.mockRejectedValue(
      new Error("Network unreachable") as never,
    );

    render(<Harness probeIds={[]} />);

    expect(
      await screen.findByText(/The probes could not be loaded\./),
    ).toHaveTextContent("Network unreachable");
    expect(picker()).toBeNull();
    expect(changes).toEqual([]);
  });

  test("a read that failed can be tried again, and a new monitor then gets its defaults", async () => {
    mockGetAllProbes.mockRejectedValueOnce(
      new Error("Network unreachable") as never,
    );
    mockGetAllProbes.mockResolvedValueOnce([OFFICE, DATA_CENTER] as never);

    render(<Harness probeIds={[]} />);

    await screen.findByText(/The probes could not be loaded\./);

    fireEvent.click(screen.getByRole("button", { name: "Refresh?" }));

    expect(await picked()).toEqual(["Data Center", "Office LAN"]);
    expect(mockGetAllProbes).toHaveBeenCalledTimes(2);
    expect(changes).toEqual([{ probeIds: [DATA_CENTER_ID, OFFICE_ID] }]);
    expect(screen.queryByText(/The probes could not be loaded\./)).toBeNull();
  });

  test("the picker is its card's one field: no second label, the name is for screen readers", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE] as never);

    render(<Harness probeIds={[OFFICE_ID]} />);

    await picked();

    const form: HTMLElement = screen.getByTestId(
      "probe-status-monitor-step-form",
    );

    /*
     * The card above it says what it is and when a probe counts as
     * disconnected ("Probes to Watch", three minutes without a heartbeat);
     * a "Probes" label with a second description under it said it twice.
     */
    expect(form.querySelector("label")).toBeNull();
    expect(form).not.toHaveTextContent("three minutes");
    expect(picker()).toBeInTheDocument();
  });
});
