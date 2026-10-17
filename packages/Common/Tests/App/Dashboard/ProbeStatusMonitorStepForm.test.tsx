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

  test("on an installation with only global probes, it starts on those", async () => {
    // Tests run without billing, as a self-hosted OneUptime does.
    mockGetAllProbes.mockResolvedValue([BUNDLED] as never);

    render(<Harness probeIds={[]} />);

    await waitFor(() => {
      expect(changes).toEqual([{ probeIds: [GLOBAL_ID] }]);
    });
    expect(await picked()).toEqual(["Probe"]);
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

    fireEvent.click(screen.getByRole("button", { name: "Remove Deleted probe" }));

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
    mockGetAllProbes.mockRejectedValue(new Error("Network unreachable") as never);

    render(<Harness probeIds={[]} />);

    expect(
      await screen.findByText(/The probes could not be loaded\./),
    ).toHaveTextContent("Network unreachable");
    expect(picker()).toBeNull();
    expect(changes).toEqual([]);
  });

  test("tells whoever picks what a disconnected probe is", async () => {
    mockGetAllProbes.mockResolvedValue([OFFICE] as never);

    render(<Harness probeIds={[OFFICE_ID]} />);

    expect(
      screen.getByTestId("probe-status-monitor-step-form"),
    ).toHaveTextContent(
      "A probe is disconnected when it has not reported for three minutes, so a quick restart is not an outage.",
    );
    await picked();
  });
});
