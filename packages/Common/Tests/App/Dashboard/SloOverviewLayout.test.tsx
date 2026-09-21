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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SloView from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Index";
import { UseSloOverviewDataResult } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloOverviewData";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Route from "../../../Types/API/Route";
import { Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Render the overview and its real details card, field renderer and edit
 * form. Only unrelated overview sections and the polling hook are replaced:
 * this catches a card left below the grid, duplicate cards, broken sidebar
 * headers, and edits that stop reaching the SLO or refreshing its summary.
 */
const SLO_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EDIT_LABEL: string = "Edit Service Level Objective";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const refreshMock: MockFunction = getJestMockFunction();

let overviewData: UseSloOverviewDataResult;
let storedSlo: ServiceLevelObjective;
let permissionsForTest: Array<Permission>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloOverviewData",
  () => {
    return {
      __esModule: true,
      default: (): UseSloOverviewDataResult => {
        return overviewData;
      },
      getSloNoticeFingerprint: (): string => {
        return "unchanged-notice";
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewHero",
  () => {
    return {
      __esModule: true,
      default: (props: { slo: ServiceLevelObjective }): React.ReactElement => {
        return <h1>{props.slo.name}</h1>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return { __esModule: true, default: (): null => null };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => <div data-testid="kpi-strip" />,
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => (
        <section aria-label="Budget burn-down" />
      ),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeed",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => (
        <section aria-label="Recent activity" />
      ),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewGettingStartedCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => (
        <section aria-label="Choose what this SLO measures" />
      ),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloActiveBurnEventsCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => (
        <section aria-label="Open alerts and incidents" />
      ),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBurnRateRulesSummaryCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => (
        <section aria-label="Burn rate rules" />
      ),
    };
  },
);

type RenderPageFunction = () => RenderResult;

const renderPage: RenderPageFunction = (): RenderResult => {
  return render(
    <MemoryRouter>
      <SloView
        pageRoute={new Route("/slos")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
};

type GetDetailsCardFunction = () => HTMLElement;

const getDetailsCard: GetDetailsCardFunction = (): HTMLElement => {
  return screen
    .getByRole("heading", { name: "SLO Details" })
    .closest<HTMLElement>('[data-testid="card"]')!;
};

type WaitForDetailsFunction = () => Promise<void>;

const waitForDetails: WaitForDetailsFunction = async (): Promise<void> => {
  await within(getDetailsCard()).findByText(storedSlo.name!);
};

type OpenEditorFunction = () => Promise<HTMLElement>;

const openEditor: OpenEditorFunction = async (): Promise<HTMLElement> => {
  fireEvent.click(
    await within(getDetailsCard()).findByRole("button", { name: EDIT_LABEL }),
  );
  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: EDIT_LABEL,
  });
  await within(dialog).findByDisplayValue(storedSlo.name!);
  return dialog;
};

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/slos/${SLO_ID.toString()}`,
  );
  window.localStorage.clear();
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  refreshMock.mockReset();

  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  storedSlo = new ServiceLevelObjective();
  storedSlo.id = SLO_ID;
  storedSlo.name = "Checkout availability";
  storedSlo.description = "Availability of the checkout API.";
  storedSlo.isEnabled = true;
  storedSlo.sloStatus = SloStatus.Healthy;
  storedSlo.monitors = [monitor];
  storedSlo.labels = [];

  overviewData = {
    slo: storedSlo,
    burnRateRules: [],
    burnRateRulesError: "",
    monitorRuleCount: 0,
    enabledMonitorRuleCount: 0,
    owners: [],
    isLoadingOwners: false,
    hasLoaded: true,
    error: "",
    refreshError: "",
    isRefreshing: false,
    refreshCount: 1,
    refresh: (): void => {
      refreshMock();
    },
  };

  getItemMock.mockImplementation((): Promise<ServiceLevelObjective> => {
    return Promise.resolve(storedSlo);
  });
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
  createOrUpdateMock.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SLO overview details sidebar", () => {
  test.each([
    ["an SLO with monitors", true, 0, false],
    ["a new SLO", false, 0, true],
    ["an SLO with monitor rules", false, 1, false],
    ["an SLO whose rule count is unavailable", false, null, false],
  ])(
    "%s has one details card first in the sidebar",
    async (
      _name: string,
      hasMonitors: boolean,
      monitorRuleCount: number | null,
      isGettingStarted: boolean,
    ) => {
      if (!hasMonitors) {
        storedSlo.monitors = [];
      }
      overviewData.monitorRuleCount = monitorRuleCount;

      renderPage();
      await waitForDetails();

      expect(
        screen.getAllByRole("heading", { name: "SLO Details" }),
      ).toHaveLength(1);
      const details: HTMLElement = getDetailsCard();
      const events: HTMLElement = screen.getByRole("region", {
        name: "Open alerts and incidents",
      });
      const rules: HTMLElement = screen.getByRole("region", {
        name: "Burn rate rules",
      });
      const sidebar: HTMLElement = events.parentElement!;
      expect(details.parentElement).toBe(sidebar);
      expect(Array.from(sidebar.children)).toEqual([details, events, rules]);

      const activity: HTMLElement = screen.getByRole("region", {
        name: "Recent activity",
      });
      const main: HTMLElement = activity.parentElement!;
      expect(main).not.toBe(sidebar);
      expect(main).toHaveClass("xl:col-span-2");
      expect(main).not.toContainElement(details);
      expect(main.nextElementSibling).toBe(sidebar);
      expect(main.parentElement).toHaveClass(
        "grid",
        "grid-cols-1",
        "xl:grid-cols-3",
      );
      expect(
        within(main).getByRole("region", {
          name: isGettingStarted
            ? "Choose what this SLO measures"
            : "Budget burn-down",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-strip") !== null).toBe(
        !isGettingStarted,
      );
    },
  );

  test("stacks the title above the documentation and edit actions for the narrow column", async () => {
    renderPage();
    await waitForDetails();

    const details: HTMLElement = getDetailsCard();
    const header: HTMLElement = within(details).getByTestId("card-header");
    const actions: HTMLElement = within(header).getByTestId(
      "card-header-actions",
    );
    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(actions).toHaveClass("flex-wrap");
    expect(within(actions).getByRole("button", { name: EDIT_LABEL })).toBeEnabled();
    expect(
      within(actions).getByRole("button", { name: "View Documentation" }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole("heading", { name: "SLO Details" }),
    ).toBeNull();
  });

  test("keeps the documentation action pointed at the SLO guide", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    renderPage();
    await waitForDetails();
    fireEvent.click(
      within(getDetailsCard()).getByRole("button", {
        name: "View Documentation",
      }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]!.toString()).toBe(
      "/docs/slo/error-budget",
    );
    expect(navigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
  });

  test("renders the name, description and label together in a single column", async () => {
    const label: Label = new Label();
    label.id = new ObjectID("44444444-4444-4444-8444-444444444444");
    label.name = "Customer facing";
    label.color = Red;
    storedSlo.labels = [label];

    renderPage();
    await waitForDetails();

    const details: HTMLElement = getDetailsCard();
    expect(within(details).getByText(storedSlo.description!)).toBeInTheDocument();
    expect(within(details).getByText("Customer facing")).toBeInTheDocument();
    const fields: HTMLElement = details.querySelector<HTMLElement>(
      "#slo-details",
    )!;
    expect(fields).toHaveClass("grid-cols-1", "sm:grid-cols-1");
    expect(
      Array.from(fields.querySelectorAll("label")).map(
        (labelElement: HTMLLabelElement): string | null => {
          return labelElement.textContent;
        },
      ),
    ).toEqual(["Name", "Description", "Labels"]);
    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: ServiceLevelObjective,
        id: SLO_ID,
        select: {
          _id: true,
          name: true,
          description: true,
          labels: { name: true, color: true },
        },
      }),
    );
  });

  test.each(["absent", "empty"])(
    "retains the empty states when description and labels are %s",
    async (emptyState: string) => {
      if (emptyState === "absent") {
        delete storedSlo.description;
        delete storedSlo.labels;
      } else {
        storedSlo.description = "";
        storedSlo.labels = [];
      }

      renderPage();
      await waitForDetails();

      const details: HTMLElement = getDetailsCard();
      expect(within(details).getByText("No description")).toBeInTheDocument();
      expect(within(details).getByText("No labels")).toBeInTheDocument();
    },
  );

  test("opens the same SLO's editor and refreshes details and overview after a successful save", async () => {
    createOrUpdateMock.mockImplementation(
      (request: { model: ServiceLevelObjective }): Promise<{ data: object }> => {
        storedSlo = Object.assign(new ServiceLevelObjective(), storedSlo, request.model);
        return Promise.resolve({ data: {} });
      },
    );

    renderPage();
    await waitForDetails();
    const sidebar: HTMLElement = getDetailsCard().parentElement!;
    const dialog: HTMLElement = await openEditor();
    expect(
      within(dialog).getByDisplayValue("Availability of the checkout API."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Labels")).toBeInTheDocument();
    expect(within(dialog).queryByText("Target (%)")).toBeNull();

    fireEvent.change(within(dialog).getByDisplayValue("Checkout availability"), {
      target: { value: "Payments availability" },
    });
    fireEvent.change(
      within(dialog).getByDisplayValue("Availability of the checkout API."),
      { target: { value: "Availability of the payments API." } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    const request: { model: ServiceLevelObjective; modelType: unknown } =
      createOrUpdateMock.mock.calls[0]![0];
    expect(request.modelType).toBe(ServiceLevelObjective);
    expect(request.model.id?.toString()).toBe(SLO_ID.toString());
    expect(request.model.name).toBe("Payments availability");
    expect(request.model.description).toBe("Availability of the payments API.");
    expect(request.model.targetPercentage).toBeUndefined();
    await within(getDetailsCard()).findByText("Payments availability");
    expect(getDetailsCard().parentElement).toBe(sidebar);
    expect(
      within(getDetailsCard()).getByText("Availability of the payments API."),
    ).toBeInTheDocument();
  });

  test("canceling an edit keeps the sidebar card and does not save or refresh", async () => {
    renderPage();
    await waitForDetails();
    const details: HTMLElement = getDetailsCard();
    const dialog: HTMLElement = await openEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(getDetailsCard()).toBe(details);
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  test("a failed edit stays open without refreshing the overview", async () => {
    createOrUpdateMock.mockRejectedValue(new Error("Changes could not be saved."));
    renderPage();
    await waitForDetails();
    const dialog: HTMLElement = await openEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await within(dialog).findByText("Changes could not be saved.");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(within(getDetailsCard()).getByText("Checkout availability")).toBeInTheDocument();
  });

  test("moving the card preserves the permission gate on editing", async () => {
    permissionsForTest = [Permission.Viewer];
    renderPage();
    await waitForDetails();

    const edit: HTMLElement = within(getDetailsCard()).getByRole("button", {
      name: EDIT_LABEL,
    });
    expect(edit).toBeDisabled();
    fireEvent.click(edit);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each(["loading", "failed"])(
    "does not mount an editable details card while the overview is %s",
    (state: string) => {
      overviewData.slo = null;
      overviewData.hasLoaded = state !== "loading";
      overviewData.error = state === "failed" ? "The SLO could not be loaded." : "";

      renderPage();

      expect(screen.queryByRole("heading", { name: "SLO Details" })).toBeNull();
      expect(screen.queryByRole("button", { name: EDIT_LABEL })).toBeNull();
      expect(getItemMock).not.toHaveBeenCalled();
    },
  );
});
