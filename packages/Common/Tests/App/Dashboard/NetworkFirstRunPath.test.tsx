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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Network Overview of a project with nothing on it: the first-run path.
 *
 * A probe first - every device is pinged and walked by one, and it has to
 * be on the device's network - then the devices, then the alerts. The
 * probe step opens the "Add a probe" dialog in place: name it, run the
 * command it prints, and watch it connect. Everything but the network is
 * real: the page, the step, the dialog, its form and the probe-state logic.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CREATED_PROBE_ID: string = "20000000-0000-4000-8000-0000000000aa";
const WAITING_PROBE_ID: string = "20000000-0000-4000-8000-0000000000bb";
const RUNNING_PROBE_ID: string = "20000000-0000-4000-8000-0000000000cc";
const PROBE_KEY: string = "c0ffee00-1111-4222-8333-444455556666";

const fetchNetworkOverviewMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const projectProbesMock: MockFunction = getJestMockFunction();
const globalProbesMock: MockFunction = getJestMockFunction();
const probeKeyMock: MockFunction = getJestMockFunction();
const probeStatusMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

// What the viewer may do: add probes, and read a probe's key.
let mockCanCreateProbe: boolean = true;
let mockCanReadProbeKey: boolean = true;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: {
        modelType: { name?: string };
        requestOptions?: { overrideRequestUrl?: unknown };
      }): Promise<unknown> => {
        if (request.modelType?.name === "Probe") {
          return request.requestOptions?.overrideRequestUrl
            ? globalProbesMock(request)
            : projectProbesMock(request);
        }

        return { data: [], count: 0 };
      },
      getItem: async (request: {
        select: Record<string, unknown>;
      }): Promise<unknown> => {
        return request.select["key"]
          ? probeKeyMock(request)
          : probeStatusMock(request);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: (_model: unknown, action: string): { isAllowed: boolean } => {
        return { isAllowed: action === "create" ? mockCanCreateProbe : true };
      },
      hasPermissionSnapshot: (): boolean => {
        return true;
      },
      canReadColumn: (_model: unknown, column: string): boolean => {
        return column === "key" ? mockCanReadProbeKey : true;
      },
    },
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSummaryApi",
  () => {
    return {
      __esModule: true,
      fetchNetworkOverview: (...args: Array<unknown>): unknown => {
        return fetchNetworkOverviewMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
    },
  };
});

import NetworkOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { PROBE_WAITING_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkProbeSetup";
import { RUN_PROBE_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Network/AddProbeModal";
import Probe from "../../../Models/DatabaseModels/Probe";
import { BILLING_ENABLED } from "../../../UI/Config";
import Navigation from "../../../UI/Utils/Navigation";
import { AA_TEXT_CONTRAST, contrastOf } from "../../Helpers/TailwindContrast";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;
const ALERT_POLICIES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices/settings/alert-policies`;

function emptyOverview(total: number = 0): Record<string, unknown> {
  return {
    fleet: {
      total: total,
      up: total,
      down: 0,
      pending: 0,
      interfacesDown: 0,
      snmpFailing: 0,
    },
    siteCount: 0,
    unhealthySiteCount: 0,
    endpointCount: 0,
    vendors: [],
    attentionDevices: [],
    attentionSites: [],
  };
}

function probeRow(data: {
  id: string;
  name: string;
  connectionStatus?: string;
  lastAlive?: Date;
}): Probe {
  const probe: Probe = new Probe();
  probe._id = data.id;
  probe.name = data.name;

  if (data.connectionStatus) {
    probe.connectionStatus = data.connectionStatus as never;
  }

  if (data.lastAlive) {
    probe.lastAlive = data.lastAlive;
  }

  return probe;
}

function probesAre(probes: Array<Probe>): void {
  projectProbesMock.mockResolvedValue({
    data: probes,
    count: probes.length,
  } as never);
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(options?: {
  alertPolicies?: number;
  devices?: number;
}): Promise<void> {
  fetchNetworkOverviewMock.mockResolvedValue(
    emptyOverview(options?.devices || 0) as never,
  );
  countMock.mockResolvedValue((options?.alertPolicies || 0) as never);

  render(
    <MemoryRouter>
      <NetworkOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await flush();
}

function step(name: "probe" | "devices" | "alerts"): HTMLElement {
  return screen.getByTestId(`network-first-run-step-${name}`);
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockCanCreateProbe = true;
  mockCanReadProbeKey = true;
  for (const mock of [
    fetchNetworkOverviewMock,
    countMock,
    projectProbesMock,
    globalProbesMock,
    probeKeyMock,
    probeStatusMock,
    createMock,
  ]) {
    mock.mockReset();
  }
  probesAre([]);
  globalProbesMock.mockResolvedValue({ data: [], count: 0 } as never);
  probeKeyMock.mockResolvedValue(
    probeRow({ id: CREATED_PROBE_ID, name: "" }) as never,
  );
  probeKeyMock.mockImplementation((async (): Promise<Probe> => {
    const probe: Probe = new Probe();
    probe._id = CREATED_PROBE_ID;
    probe.key = PROBE_KEY;
    return probe;
  }) as never);
  probeStatusMock.mockResolvedValue(new Probe() as never);
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/network-devices`,
  );
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  navigateSpy.mockRestore();
  jest.useRealTimers();
});

describe("the first-run path", () => {
  test("is three numbered steps: a probe, the devices, the alerts", async () => {
    await renderOverview();

    const steps: HTMLElement = screen.getByTestId("network-first-run-steps");

    expect(steps.tagName).toBe("OL");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(step("probe")).getByText("Put a probe on your network"),
    ).toBeInTheDocument();
    expect(
      within(step("devices")).getByText("Bring your devices in"),
    ).toBeInTheDocument();
    expect(
      within(step("alerts")).getByText("Get told when a device goes down"),
    ).toBeInTheDocument();
    expect(within(step("probe")).getByText("1")).toBeInTheDocument();
    expect(within(step("devices")).getByText("2")).toBeInTheDocument();
    expect(within(step("alerts")).getByText("3")).toBeInTheDocument();
  });

  test("keeps the two ways in as the second step", async () => {
    await renderOverview();

    expect(
      within(step("devices")).getByTestId("network-get-started-discover"),
    ).toBeInTheDocument();
    expect(
      within(step("devices")).getByTestId("network-get-started-add"),
    ).toBeInTheDocument();
    expect(
      within(step("devices")).getByText(
        "Every device is pinged by its probe, so it has a status within minutes. Give it SNMP credentials and you also see its interfaces, traffic and health.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the probe step, with no probe yet", () => {
  test("says what a probe is and why one on the internet will not do", async () => {
    await renderOverview();

    expect(
      within(step("probe")).getByText(
        /a probe on the internet cannot reach private addresses like 10\.0\.0\.1/,
      ),
    ).toBeInTheDocument();
  });

  test("offers to add one, as the page's primary action", async () => {
    await renderOverview();

    const button: HTMLElement = within(step("probe")).getByTestId(
      "network-first-run-add-probe",
    );

    expect(button).toHaveTextContent("Add a probe");
    expect(button.tagName).toBe("BUTTON");
  });

  test("a role that may not add probes is not offered the button", async () => {
    mockCanCreateProbe = false;
    await renderOverview();

    expect(screen.queryByTestId("network-first-run-add-probe")).toBeNull();
    expect(
      within(step("probe")).getByText("Put a probe on your network"),
    ).toBeInTheDocument();
  });

  /*
   * A self-hosted server's own probes run beside it, often on the devices'
   * network, so the step says they may do. On OneUptime Cloud they are on
   * the internet - the reason for the step - and are never offered.
   */
  test("says the server's own probe may do on a self-hosted server, and never on OneUptime Cloud", async () => {
    globalProbesMock.mockResolvedValue({
      data: [probeRow({ id: RUNNING_PROBE_ID, name: "Server probe" })],
      count: 1,
    } as never);
    await renderOverview();

    if (BILLING_ENABLED) {
      expect(screen.queryByTestId("network-first-run-server-probe")).toBeNull();
      expect(globalProbesMock).not.toHaveBeenCalled();
      return;
    }

    expect(
      within(step("probe")).getByTestId("network-first-run-server-probe"),
    ).toHaveTextContent(
      "This OneUptime server runs a probe of its own too. It can check your devices if this server can reach them.",
    );
  });
});

describe("the Add a probe dialog", () => {
  async function openDialog(): Promise<void> {
    await renderOverview();
    fireEvent.click(screen.getByTestId("network-first-run-add-probe"));
    await flush();
  }

  test("opens in place, asking only for a name, with one filled in", async () => {
    await openDialog();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Add a probe",
    );
    const name: HTMLInputElement = within(dialog()).getByPlaceholderText(
      "London office probe",
    ) as HTMLInputElement;

    expect(name.value).toBe("Network probe");
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Add Probe");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("adds the probe to this project, then shows the command that runs it", async () => {
    createMock.mockImplementation((async (request: {
      model: Probe;
    }): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      created.name = request.model.name!;
      return { data: created };
    }) as never);

    await openDialog();

    const name: HTMLElement = within(dialog()).getByPlaceholderText(
      "London office probe",
    );
    fireEvent.change(name, { target: { value: "Branch probe" } });
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    const sent: Probe = (createMock.mock.calls[0]![0] as { model: Probe })
      .model;

    expect(sent.name).toBe("Branch probe");
    expect(sent.projectId?.toString()).toBe(PROJECT_ID);

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Run the probe",
    );
    const command: string =
      within(dialog()).getByTestId("add-probe-command").textContent || "";

    expect(command).toContain(
      "docker run --name oneuptime-probe --network host",
    );
    expect(command).toContain(`PROBE_ID=${CREATED_PROBE_ID}`);
    expect(command).toContain(`PROBE_KEY=${PROBE_KEY}`);
    expect(command).toContain("oneuptime/probe:release");
    expect(
      within(dialog()).getByTestId("add-probe-connection"),
    ).toHaveAttribute("data-connected", "false");
    expect(
      within(dialog()).getByTestId("add-probe-connection"),
    ).toHaveTextContent("Waiting for Branch probe to connect.");
    // Nothing to cancel: the probe exists. Close, not Cancel.
    expect(
      within(dialog()).getByTestId("modal-footer-close-button"),
    ).toHaveTextContent("Close");
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
  });

  test("links to every other way of running a probe, in a new tab", async () => {
    createMock.mockImplementation((async (): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      return { data: created };
    }) as never);

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    const link: HTMLElement = within(dialog()).getByTestId(
      "add-probe-other-ways",
    );

    expect(link).toHaveTextContent(
      "Other ways to run it: Docker Compose, Kubernetes, and through a proxy",
    );
    expect(link.getAttribute("href")).toMatch(/\/probe\/custom-probe$/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  test("turns green, and offers Done, once the probe checks in", async () => {
    createMock.mockImplementation((async (): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      return { data: created };
    }) as never);
    probeStatusMock.mockImplementation((async (): Promise<Probe> => {
      const probe: Probe = new Probe();
      probe.connectionStatus = "connected" as never;
      return probe;
    }) as never);

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    const connection: HTMLElement = within(dialog()).getByTestId(
      "add-probe-connection",
    );

    expect(connection).toHaveAttribute("data-connected", "true");
    expect(connection).toHaveTextContent(
      "Network probe is connected. Next, bring your devices in.",
    );
    expect(connection).toHaveAttribute("role", "status");
    expect(
      within(dialog()).getByTestId("modal-footer-close-button"),
    ).toHaveTextContent("Done");
  });

  test("a viewer who cannot read the key is told who can, not shown a command that cannot work", async () => {
    mockCanReadProbeKey = false;
    createMock.mockImplementation((async (): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      return { data: created };
    }) as never);

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    expect(within(dialog()).queryByTestId("add-probe-command")).toBeNull();
    expect(probeKeyMock).not.toHaveBeenCalled();
    expect(
      within(dialog()).getByTestId("add-probe-key-hidden"),
    ).toHaveTextContent(
      "Only project owners and admins can see a probe's key. Ask one of them to run Network probe: it is under Monitors → Settings → Probes.",
    );

    /*
     * With no command in front of them, nothing asks them to run one: the
     * step says where the probe has to run, for whoever runs it, and the
     * waiting line asks for nothing.
     */
    const runStep: HTMLElement =
      within(dialog()).getByTestId("add-probe-run-step");
    expect(
      within(runStep).getByText(
        "Network probe has to run on a computer inside your network that can reach your devices, such as a server or a virtual machine with Docker.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByTestId("add-probe-connection"),
    ).toHaveTextContent(
      "Waiting for Network probe to connect. This checks every few seconds and turns green once it is running.",
    );
    expect(runStep).not.toHaveTextContent(/Run this on a computer/);
    expect(runStep).not.toHaveTextContent(/run the command/);
  });

  /*
   * The key could not be read (the request failed): the dialog says why,
   * and draws neither a command placeholder that pulses for ever nor words
   * about a command that is not there.
   */
  test("a key that cannot be read leaves no command to wait for", async () => {
    createMock.mockImplementation((async (): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      return { data: created };
    }) as never);
    probeKeyMock.mockImplementation((async (): Promise<never> => {
      throw new Error("The probe's key could not be read.");
    }) as never);

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Run the probe",
    );
    expect(
      within(dialog()).getByText("The probe's key could not be read."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByTestId("add-probe-command-loading"),
    ).toBeNull();
    expect(within(dialog()).queryByTestId("add-probe-command")).toBeNull();
    expect(
      within(dialog()).getByTestId("add-probe-connection"),
    ).toHaveTextContent(
      "Waiting for Network probe to connect. This checks every few seconds and turns green once it is running.",
    );
  });

  // Between the probe being added and its key arriving: the placeholder.
  test("while the key is read, the command's place is held", async () => {
    createMock.mockImplementation((async (): Promise<unknown> => {
      const created: Probe = new Probe();
      created._id = CREATED_PROBE_ID;
      return { data: created };
    }) as never);
    probeKeyMock.mockImplementation((): Promise<never> => {
      return new Promise<never>(() => {});
    });

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    expect(
      within(dialog()).getByTestId("add-probe-command-loading"),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByTestId("add-probe-key-hidden")).toBeNull();
    expect(
      within(dialog()).getByText(/Run this on a computer inside your network/),
    ).toBeInTheDocument();
  });

  test("a probe the server does not name back is not run blind", async () => {
    createMock.mockResolvedValue({ data: {} } as never);

    await openDialog();
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Add a probe",
    );
    expect(
      within(dialog()).getByText(
        "The probe was added, but the server did not say which it is. Open it under Monitors → Settings → Probes to run it.",
      ),
    ).toBeInTheDocument();
  });

  test("the suggested name is a new one when the project has a Network probe already", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "Network probe",
        connectionStatus: "connected",
      }),
    ]);
    // A second probe, from a device's probe field: ?open=add-probe.
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/network-devices?open=add-probe`,
    );
    await renderOverview();

    const name: HTMLInputElement = within(dialog()).getByPlaceholderText(
      "London office probe",
    ) as HTMLInputElement;

    expect(name.value).toBe("Network probe 2");
  });
});

describe("the probe step, with a probe added but not running", () => {
  beforeEach(() => {
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
  });

  test("names it, and says the step turns green when it runs", async () => {
    await renderOverview();

    expect(
      within(step("probe")).getByTestId("network-first-run-probe-status"),
    ).toHaveTextContent(
      "Office probe is added. Run it on a computer on your network and this step turns green.",
    );
  });

  test("offers how to run it, and opens the dialog on that probe's command", async () => {
    await renderOverview();

    const button: HTMLElement = within(step("probe")).getByTestId(
      "network-first-run-run-probe",
    );

    expect(button).toHaveTextContent("How to run it");
    expect(screen.queryByTestId("network-first-run-add-probe")).toBeNull();

    fireEvent.click(button);
    await flush();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Run the probe",
    );
    expect(
      within(dialog()).getByTestId("add-probe-command").textContent,
    ).toContain(`PROBE_ID=${WAITING_PROBE_ID}`);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("asks again every few seconds, and turns green on its own when the probe starts", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    await renderOverview();

    expect(screen.queryByTestId("network-first-run-step-done")).toBeNull();

    probesAre([
      probeRow({
        id: WAITING_PROBE_ID,
        name: "Office probe",
        connectionStatus: "connected",
      }),
    ]);

    await act(async () => {
      jest.advanceTimersByTime(PROBE_WAITING_POLL_INTERVAL_IN_MS);
    });
    await flush();

    expect(
      within(step("probe")).getByTestId("network-first-run-probe-status"),
    ).toHaveTextContent("Office probe is connected.");
    expect(
      within(step("probe")).getByTestId("network-first-run-step-done"),
    ).toBeInTheDocument();
  });
});

describe("the probe step, done", () => {
  test("one probe connected: ticked, named, and nothing more to do", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "Data centre probe",
        lastAlive: new Date(),
      }),
    ]);
    await renderOverview();

    expect(
      within(step("probe")).getByTestId("network-first-run-step-done"),
    ).toBeInTheDocument();
    expect(
      within(step("probe")).getByTestId("network-first-run-probe-status"),
    ).toHaveTextContent("Data centre probe is connected.");
    expect(within(step("probe")).queryByRole("button")).toBeNull();
    expect(
      within(step("probe")).queryByText(/a probe on the internet cannot reach/),
    ).toBeNull();
  });

  /*
   * The tick is a picture: a screen reader is told the step is done in
   * words, and hears the step turn green while the dialog or the probe is
   * being run elsewhere.
   */
  test("a finished step says so in words, and the probe's line is announced when it changes", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "Data centre probe",
        connectionStatus: "connected",
      }),
    ]);
    await renderOverview();

    const marker: HTMLElement = within(step("probe")).getByTestId(
      "network-first-run-step-done",
    );
    const words: HTMLElement = within(marker).getByText("Done");

    expect(words).toHaveClass("sr-only");
    expect(
      within(step("probe")).getByTestId("network-first-run-probe-status")
        .parentElement,
    ).toHaveAttribute("aria-live", "polite");
  });

  test("a step still to do is numbered for the eye only: the list numbers it", async () => {
    await renderOverview();

    const steps: HTMLElement = screen.getByTestId("network-first-run-steps");
    expect(steps.tagName).toBe("OL");

    const number: HTMLElement = within(step("probe")).getByText("1");
    expect(number).toHaveAttribute("aria-hidden", "true");
  });

  test("two connected: counted", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "A",
        connectionStatus: "connected",
      }),
      probeRow({
        id: WAITING_PROBE_ID,
        name: "B",
        connectionStatus: "connected",
      }),
    ]);
    await renderOverview();

    expect(
      within(step("probe")).getByTestId("network-first-run-probe-status"),
    ).toHaveTextContent("2 probes are connected.");
  });
});

describe("the alerts step", () => {
  test("with no policy on, links to Alert Policies", async () => {
    await renderOverview({ alertPolicies: 0 });

    const link: HTMLElement = within(
      within(step("alerts")).getByTestId("network-first-run-set-up-alerts"),
    ).getByRole("link");

    expect(link).toHaveTextContent("Set up alerts");
    expect(link.getAttribute("href")).toBe(ALERT_POLICIES_PATH);
    expect(
      within(step("alerts")).getByText(
        "One alert policy raises an incident when any device goes down, for the devices you have now and every one you add later.",
      ),
    ).toBeInTheDocument();
  });

  test("with a policy on: ticked, and says alerts are on", async () => {
    await renderOverview({ alertPolicies: 2 });

    expect(
      within(step("alerts")).getByTestId("network-first-run-step-done"),
    ).toBeInTheDocument();
    expect(
      within(step("alerts")).getByTestId("network-first-run-alerts-status"),
    ).toHaveTextContent("Alerts are on.");
    expect(screen.queryByTestId("network-first-run-set-up-alerts")).toBeNull();
  });
});

/*
 * The probe fields of Add Device and of a new scan link here with
 * ?open=add-probe, in a new tab: the dialog opens at once, and the address
 * forgets the action so a refresh does not open it again.
 */
describe("opened to add a probe", () => {
  test("with nothing on the network yet, the dialog opens on the first-run path", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/network-devices?open=add-probe`,
    );
    await renderOverview();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Add a probe",
    );
    expect(screen.getByTestId("network-first-run-steps")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("with devices on it, the dialog opens over the Overview", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/network-devices?open=add-probe`,
    );
    await renderOverview({ devices: 3 });

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Add a probe",
    );
    expect(screen.getByTestId("network-health-hero")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("without it, nothing opens", async () => {
    await renderOverview({ devices: 3 });

    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("the run step's polling", () => {
  test("asks whether the probe has checked in every few seconds, until it has", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview();

    fireEvent.click(screen.getByTestId("network-first-run-run-probe"));
    await flush();

    const asked: number = probeStatusMock.mock.calls.length;

    expect(asked).toBeGreaterThan(0);

    probeStatusMock.mockImplementation((async (): Promise<Probe> => {
      const probe: Probe = new Probe();
      probe.connectionStatus = "connected" as never;
      return probe;
    }) as never);

    await act(async () => {
      jest.advanceTimersByTime(RUN_PROBE_POLL_INTERVAL_IN_MS);
    });
    await flush();

    expect(
      within(dialog()).getByTestId("add-probe-connection"),
    ).toHaveAttribute("data-connected", "true");

    const afterConnected: number = probeStatusMock.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(RUN_PROBE_POLL_INTERVAL_IN_MS * 3);
    });
    await flush();

    expect(probeStatusMock.mock.calls.length).toBe(afterConnected);
  });
});

/*
 * Every word of the first-run path and the dialog meets WCAG AA (4.5:1) on
 * what it is written on, as the light theme draws it (Tests/Helpers/
 * TailwindContrast); the dark theme's remaps are held in
 * NetworkAuditDarkMode.test.ts.
 */
describe("the first-run path can be read", () => {
  function expectReadable(element: Element): void {
    const words: string = (element.textContent || "").trim();

    expect({
      words: words,
      readable: contrastOf(element) >= AA_TEXT_CONTRAST,
    }).toEqual({ words: words, readable: true });
  }

  test("its steps while there is still something to do", async () => {
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview({ alertPolicies: 0 });

    const steps: HTMLElement = screen.getByTestId("network-first-run-steps");

    for (const heading of Array.from(steps.querySelectorAll("h3"))) {
      expectReadable(heading);
    }

    expectReadable(
      within(step("probe")).getByText(/A probe is a small program/),
    );
    expectReadable(within(step("probe")).getByText(/Office probe is added/));
    expectReadable(within(step("probe")).getByText("1"));
    expectReadable(within(step("alerts")).getByText("Set up alerts"));
    expectReadable(
      within(step("alerts")).getByText(/One alert policy raises an incident/),
    );
  });

  test("the steps that are done: green that can still be read", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "Data centre probe",
        connectionStatus: "connected",
      }),
    ]);
    await renderOverview({ alertPolicies: 1 });

    expectReadable(
      within(step("probe")).getByTestId("network-first-run-probe-status"),
    );
    expectReadable(
      within(step("alerts")).getByTestId("network-first-run-alerts-status"),
    );
  });

  test("the dialog's run step, waiting and connected", async () => {
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview();

    fireEvent.click(screen.getByTestId("network-first-run-run-probe"));
    await flush();

    expectReadable(within(dialog()).getByText(/Run this on a computer/));
    expectReadable(within(dialog()).getByTestId("add-probe-other-ways"));
    expectReadable(
      within(dialog()).getByText(/Waiting for Office probe to connect/),
    );
  });

  test("the note for someone who cannot read the key", async () => {
    mockCanReadProbeKey = false;
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview();

    fireEvent.click(screen.getByTestId("network-first-run-run-probe"));
    await flush();

    expectReadable(within(dialog()).getByTestId("add-probe-key-hidden"));
  });

  test("the dialog's connected line", async () => {
    probeStatusMock.mockImplementation((async (): Promise<Probe> => {
      const probe: Probe = new Probe();
      probe.connectionStatus = "connected" as never;
      return probe;
    }) as never);
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview();

    fireEvent.click(screen.getByTestId("network-first-run-run-probe"));
    await flush();

    expectReadable(
      within(dialog()).getByText(
        "Office probe is connected. Next, bring your devices in.",
      ),
    );
  });
});
