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
 * The Network first-run path on OneUptime Cloud, below the plan a probe needs.
 *
 * The server refuses to add a probe below the plan Probe's create is sold on
 * (Growth). A project on the free plan was offered "Add a probe" as the very
 * first step, named the probe, and was then refused with "Please upgrade your
 * plan to Growth to access this feature" - a dead end at step one. Now the
 * step names the plan and links to Billing, and the dialog - which a probe
 * field's "Add a probe" link opens too - offers the way to the plan instead
 * of a name the server would refuse.
 *
 * Only a plan KNOWN to be below counts: billing off (every self-hosted
 * server), a plan that reaches it, and a plan not known all offer the probe
 * as before. Everything but the network, the project and the plan settings
 * is real: the page, the step, the dialog and the plan comparison.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const WAITING_PROBE_ID: string = "20000000-0000-4000-8000-0000000000bb";
const RUNNING_PROBE_ID: string = "20000000-0000-4000-8000-0000000000cc";
const PROBE_KEY: string = "c0ffee00-1111-4222-8333-444455556666";
const BILLING_PATH: string = `/dashboard/${PROJECT_ID}/settings/billing`;

// The plans as OneUptime Cloud configures them (SUBSCRIPTION_PLAN_* in env.js).
const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

const PLAN_SENTENCE: string =
  "Adding a probe needs the Growth plan. Until then, OneUptime's probes on the internet can check devices with a public address.";

let mockBillingEnabled: boolean = true;
// The project's plan; "throw" stands for a plan the env does not describe.
let mockCurrentPlan: string | null = "Free";
let mockCanCreateProbe: boolean = true;
let mockCanReadProbes: boolean = true;

const fetchNetworkOverviewMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const projectProbesMock: MockFunction = getJestMockFunction();
const globalProbesMock: MockFunction = getJestMockFunction();
const probeKeyMock: MockFunction = getJestMockFunction();
const probeStatusMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

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
      getCurrentPlan: (): string | null => {
        if (mockCurrentPlan === "throw") {
          // What SubscriptionPlan.getPlanType says of an id it does not know.
          throw new Error("Plan ID is invalid");
        }

        return mockCurrentPlan;
      },
    },
  };
});

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
        if (action === "create") {
          return { isAllowed: mockCanCreateProbe };
        }

        return { isAllowed: action === "read" ? mockCanReadProbes : true };
      },
      hasPermissionSnapshot: (): boolean => {
        return true;
      },
      canReadColumn: (): boolean => {
        return true;
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

import NetworkOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  PROBE_CREATE_PLAN,
  getPlanNeededToAddProbe,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Network/ProbePlanGate";
import Probe from "../../../Models/DatabaseModels/Probe";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Navigation from "../../../UI/Utils/Navigation";
import { AA_TEXT_CONTRAST, contrastOf } from "../../Helpers/TailwindContrast";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function overview(devices: number): Record<string, unknown> {
  return {
    fleet: {
      total: devices,
      up: devices,
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
}): Probe {
  const probe: Probe = new Probe();
  probe._id = data.id;
  probe.name = data.name;

  if (data.connectionStatus) {
    probe.connectionStatus = data.connectionStatus as never;
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

async function renderOverview(options?: { devices?: number }): Promise<void> {
  fetchNetworkOverviewMock.mockResolvedValue(
    overview(options?.devices || 0) as never,
  );
  countMock.mockResolvedValue(0 as never);

  render(
    <MemoryRouter>
      <NetworkOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await flush();
}

function probeStep(): HTMLElement {
  return screen.getByTestId("network-first-run-step-probe");
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function openedToAddAProbe(): void {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/network-devices?open=add-probe`,
  );
}

function expectReadable(element: Element): void {
  const words: string = (element.textContent || "").trim();

  expect({
    words: words,
    readable: contrastOf(element) >= AA_TEXT_CONTRAST,
  }).toEqual({ words: words, readable: true });
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockBillingEnabled = true;
  mockCurrentPlan = PlanType.Free;
  mockCanCreateProbe = true;
  mockCanReadProbes = true;
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
  probeKeyMock.mockImplementation((async (): Promise<Probe> => {
    const probe: Probe = new Probe();
    probe._id = WAITING_PROBE_ID;
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
});

describe("the gate reads the plan the server asks", () => {
  test("adding a probe is sold on Growth, as Probe's create plan says", () => {
    expect(PROBE_CREATE_PLAN).toBe(new Probe().getCreateBillingPlan());
    expect(PROBE_CREATE_PLAN).toBe(PlanType.Growth);
  });

  // Why a probe added before can still be run below the plan.
  test("reading a probe needs no plan", () => {
    expect(new Probe().getReadBillingPlan()).toBe(PlanType.Free);
  });

  test("names Growth for a project on the free plan", () => {
    mockCurrentPlan = PlanType.Free;

    expect(getPlanNeededToAddProbe()).toBe(PlanType.Growth);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "names nothing on %s, which reaches it",
    (plan: PlanType) => {
      mockCurrentPlan = plan;

      expect(getPlanNeededToAddProbe()).toBeNull();
    },
  );

  test("names nothing while the plan is not known, or is one the Dashboard cannot read", () => {
    mockCurrentPlan = null;
    expect(getPlanNeededToAddProbe()).toBeNull();

    mockCurrentPlan = "throw";
    expect(getPlanNeededToAddProbe()).toBeNull();
  });

  test("names nothing with billing off, whatever the plan says", () => {
    mockBillingEnabled = false;
    mockCurrentPlan = PlanType.Free;

    expect(getPlanNeededToAddProbe()).toBeNull();
  });
});

describe("the probe step, below the plan a probe needs", () => {
  test("names the plan and links to Billing, instead of offering a probe the server would refuse", async () => {
    await renderOverview();

    const plan: HTMLElement = within(probeStep()).getByTestId(
      "network-first-run-probe-plan",
    );

    expect(plan).toHaveTextContent(PLAN_SENTENCE);

    const link: HTMLElement = within(plan).getByRole("link");

    expect(link).toHaveTextContent("Upgrade your plan in Billing settings");
    expect(link.getAttribute("href")).toBe(BILLING_PATH);
    expect(screen.queryByTestId("network-first-run-add-probe")).toBeNull();
    expect(within(probeStep()).queryByRole("button")).toBeNull();
    expect(
      within(probeStep()).queryByTestId("network-first-run-step-done"),
    ).toBeNull();
  });

  test("still says what a probe is, and the devices step still offers both ways in", async () => {
    await renderOverview();

    expect(
      within(probeStep()).getByText(
        /a probe on the internet cannot reach private addresses like 10\.0\.0\.1/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("network-get-started-discover"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("network-get-started-add")).toBeInTheDocument();
  });

  test("the plan's words can be read: dark amber on light amber", async () => {
    await renderOverview();

    const plan: HTMLElement = within(probeStep()).getByTestId(
      "network-first-run-probe-plan",
    );

    expectReadable(within(plan).getByText(/Adding a probe needs/));
    expectReadable(within(plan).getByRole("link"));
  });

  test("a probe added before - on a trial - can still be run: How to run it, and no plan", async () => {
    probesAre([probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })]);
    await renderOverview();

    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();

    fireEvent.click(
      within(probeStep()).getByTestId("network-first-run-run-probe"),
    );
    await flush();

    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Run the probe",
    );
    expect(within(dialog()).queryByTestId("add-probe-plan-needed")).toBeNull();
    expect(
      within(dialog()).getByTestId("add-probe-command").textContent,
    ).toContain(`PROBE_ID=${WAITING_PROBE_ID}`);
  });

  test("a probe that checks in is all the step asks for: done, and no plan", async () => {
    probesAre([
      probeRow({
        id: RUNNING_PROBE_ID,
        name: "Data centre probe",
        connectionStatus: "connected",
      }),
    ]);
    await renderOverview();

    expect(
      within(probeStep()).getByTestId("network-first-run-step-done"),
    ).toBeInTheDocument();
    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();
  });

  test("a role that may not list the probes still hears about the plan", async () => {
    mockCanReadProbes = false;
    await renderOverview();

    expect(projectProbesMock).not.toHaveBeenCalled();
    expect(
      within(probeStep()).getByTestId("network-first-run-probe-plan"),
    ).toHaveTextContent(PLAN_SENTENCE);
    expect(screen.queryByTestId("network-first-run-add-probe")).toBeNull();
  });

  test("says nothing while the probes load: a probe added before may be on its way", async () => {
    let answer: (value: unknown) => void = () => {
      return undefined;
    };
    projectProbesMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      }) as never,
    );
    await renderOverview();

    expect(screen.getByTestId("network-first-run-steps")).toBeInTheDocument();
    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();

    await act(async () => {
      answer({
        data: [probeRow({ id: WAITING_PROBE_ID, name: "Office probe" })],
        count: 1,
      });
    });
    await flush();

    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();
    expect(
      within(probeStep()).getByTestId("network-first-run-run-probe"),
    ).toBeInTheDocument();
  });
});

/*
 * The probe fields of Add Device, a new scan and a device's settings link to
 * ?open=add-probe: the dialog opens at once, with or without devices on the
 * network. Below the plan it asks no name - the server would refuse the
 * probe - and offers the way to the plan.
 */
describe("the Add a probe dialog, below the plan a probe needs", () => {
  test.each([
    { devices: 0, where: "on the first-run path" },
    { devices: 3, where: "over the Overview" },
  ])(
    "$where: names the plan, asks no name, and offers the way to it",
    async (data: { devices: number }) => {
      openedToAddAProbe();
      await renderOverview({ devices: data.devices });

      expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
        "Add a probe",
      );
      expect(
        within(dialog()).getByTestId("add-probe-plan-needed"),
      ).toHaveTextContent(PLAN_SENTENCE);
      expect(within(dialog()).queryByRole("textbox")).toBeNull();
      expect(
        within(dialog()).queryByPlaceholderText("London office probe"),
      ).toBeNull();
      expect(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Upgrade plan");
      expect(
        within(dialog()).getByTestId("modal-footer-close-button"),
      ).toHaveTextContent("Cancel");
    },
  );

  test("Upgrade plan opens Billing settings, and nothing is added", async () => {
    openedToAddAProbe();
    await renderOverview({ devices: 3 });

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await flush();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(BILLING_PATH);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("Cancel closes it, and nothing is added or asked", async () => {
    openedToAddAProbe();
    await renderOverview({ devices: 3 });

    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));
    await flush();

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
    // The names a new probe must not reuse: there is no name to suggest.
    expect(projectProbesMock).not.toHaveBeenCalled();
  });

  test("its words can be read", async () => {
    openedToAddAProbe();
    await renderOverview({ devices: 3 });

    expectReadable(
      within(within(dialog()).getByTestId("add-probe-plan-needed")).getByText(
        /Adding a probe needs/,
      ),
    );
  });
});

describe("where nothing stands in the way, the probe is offered as before", () => {
  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s: Add a probe, and the dialog asks for its name",
    async (plan: PlanType) => {
      mockCurrentPlan = plan;
      await renderOverview();

      expect(
        within(probeStep()).queryByTestId("network-first-run-probe-plan"),
      ).toBeNull();

      fireEvent.click(
        within(probeStep()).getByTestId("network-first-run-add-probe"),
      );
      await flush();

      expect(
        within(dialog()).queryByTestId("add-probe-plan-needed"),
      ).toBeNull();
      expect(
        (
          within(dialog()).getByPlaceholderText(
            "London office probe",
          ) as HTMLInputElement
        ).value,
      ).toBe("Network probe");
      expect(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Add Probe");
    },
  );

  test("a plan that is not known yet: the probe is offered, and the server decides", async () => {
    mockCurrentPlan = null;
    await renderOverview();

    expect(
      within(probeStep()).getByTestId("network-first-run-add-probe"),
    ).toBeInTheDocument();
    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();
  });

  test("a plan the Dashboard cannot read takes nothing down: the probe is offered", async () => {
    mockCurrentPlan = "throw";
    await renderOverview();

    expect(
      within(probeStep()).getByTestId("network-first-run-add-probe"),
    ).toBeInTheDocument();
  });

  test("a self-hosted server (billing off) never names a plan", async () => {
    mockBillingEnabled = false;
    mockCurrentPlan = PlanType.Free;
    openedToAddAProbe();
    await renderOverview();

    expect(within(dialog()).queryByTestId("add-probe-plan-needed")).toBeNull();
    expect(
      within(dialog()).getByPlaceholderText("London office probe"),
    ).toBeInTheDocument();
    expect(
      within(probeStep()).queryByTestId("network-first-run-probe-plan"),
    ).toBeNull();
  });
});
