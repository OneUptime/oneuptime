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
import { MemoryRouter } from "react-router-dom";
import SloView from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Index";
import { UseSloOverviewDataResult } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloOverviewData";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import Route from "../../../Types/API/Route";
import { Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * Render the overview and its real details card, field renderer and edit
 * form. Only unrelated overview sections and the polling hook are replaced:
 * this catches a card left below the grid, duplicate cards, broken sidebar
 * headers, and edits that stop reaching the SLO or refreshing its summary.
 */
const SLO_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EDIT_LABEL: string = "Edit Service Level Objective";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const refreshMock: MockFunction = getJestMockFunction();
const refreshOwnersMock: MockFunction = getJestMockFunction();

let overviewData: UseSloOverviewDataResult;
let storedSlo: ServiceLevelObjective;
let permissionsForTest: Array<Permission>;
// What the page hands the burn-down, as the stand-in below records it.
let mockBurnDownTiers:
  | Array<ServiceLevelObjectiveErrorBudgetPolicyTier>
  | undefined;

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
      default: (props: {
        slo: ServiceLevelObjective;
        onOwnersChanged?: ((change: { wasAdded: boolean }) => void) | undefined;
      }): React.ReactElement => {
        /*
         * The hero adds owners itself (its own suite): here it only tells
         * the page an owner was added, as its Add owners list does.
         */
        return (
          <h1
            data-testid="hero"
            onClick={() => {
              props.onOwnersChanged?.({ wasAdded: true });
            }}
          >
            {props.slo.name}
          </h1>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip",
  () => {
    return {
      __esModule: true,
      default: (props: {
        lowestEnabledBurnRateThreshold: number | null;
      }): React.ReactElement => {
        return (
          <div
            data-testid="kpi-strip"
            data-lowest-threshold={String(props.lowestEnabledBurnRateThreshold)}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        policyTiers?: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>;
      }): React.ReactElement => {
        mockBurnDownTiers = props.policyTiers;
        return <section aria-label="Budget burn-down" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeed",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <section aria-label="Recent activity" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewGettingStartedCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <section aria-label="Choose what this SLO measures" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloActiveBurnEventsCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <section aria-label="Open alerts and incidents" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBurnRateRulesSummaryCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <section aria-label="Burn rate rules" />;
      },
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
  const editButton: HTMLElement = await within(getDetailsCard()).findByRole(
    "button",
    { name: EDIT_LABEL },
  );
  await act(async () => {
    fireEvent.click(editButton);
  });
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
  refreshOwnersMock.mockReset();
  mockBurnDownTiers = undefined;

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
    policyTiers: [],
    policyTiersError: "",
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
    refreshOwners: (): void => {
      refreshOwnersMock();
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

  test("stacks the title above the edit action and the ⋯ that holds the documentation, for the narrow column", async () => {
    renderPage();
    await waitForDetails();

    const details: HTMLElement = getDetailsCard();
    const header: HTMLElement = within(details).getByTestId("card-header");
    const actions: HTMLElement = within(header).getByTestId(
      "card-header-actions",
    );
    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(actions).toHaveClass("flex-wrap");
    expect(
      within(actions).getByRole("button", { name: EDIT_LABEL }),
    ).toBeEnabled();
    /*
     * The documentation is in the card's ⋯, as a table keeps it - not a
     * button of its own beside Edit.
     */
    expect(
      within(actions).getByRole("button", { name: "More options" }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: "View Documentation" }),
    ).toBeNull();
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
        name: "More options",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
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
    expect(
      within(details).getByText(storedSlo.description!),
    ).toBeInTheDocument();
    expect(within(details).getByText("Customer facing")).toBeInTheDocument();
    const fields: HTMLElement =
      details.querySelector<HTMLElement>("#slo-details")!;
    // One column at every width: no wider grid from any breakpoint.
    expect(fields).toHaveClass("grid-cols-1");
    expect(fields.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols-[2-9]/);
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
      (request: {
        model: ServiceLevelObjective;
      }): Promise<{ data: Record<string, unknown> }> => {
        storedSlo = Object.assign(
          new ServiceLevelObjective(),
          storedSlo,
          request.model,
        );
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
    // Labels are there, folded under More fields, which names them.
    expect(listedNames(dialog)).toContain("Labels");
    expect(within(dialog).queryByText("Target (%)")).toBeNull();

    fireEvent.change(
      within(dialog).getByDisplayValue("Checkout availability"),
      {
        target: { value: "Payments availability" },
      },
    );
    fireEvent.change(
      within(dialog).getByDisplayValue("Availability of the checkout API."),
      { target: { value: "Availability of the payments API." } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

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
    createOrUpdateMock.mockRejectedValue(
      new Error("Changes could not be saved."),
    );
    renderPage();
    await waitForDetails();
    const dialog: HTMLElement = await openEditor();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await within(dialog).findByText("Changes could not be saved.");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      within(getDetailsCard()).getByText("Checkout availability"),
    ).toBeInTheDocument();
  });

  test("an owner added from the hero has the page read the owners again, and nothing else", async () => {
    renderPage();
    await waitForDetails();

    fireEvent.click(screen.getByTestId("hero"));

    expect(refreshOwnersMock).toHaveBeenCalledTimes(1);
    // The SLO itself is not read again for an owner.
    expect(refreshMock).not.toHaveBeenCalled();
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
      overviewData.error =
        state === "failed" ? "The SLO could not be loaded." : "";

      renderPage();

      expect(screen.queryByRole("heading", { name: "SLO Details" })).toBeNull();
      expect(screen.queryByRole("button", { name: EDIT_LABEL })).toBeNull();
      expect(getItemMock).not.toHaveBeenCalled();
    },
  );
});

/*
 * The tier of its error budget policy the SLO is in: right under the
 * summary, its name, the budget left it applies at, since when, and what
 * the team agreed to do there, in the tier's colour, linking to the policy.
 * Nothing at all while the SLO is in no tier.
 */
describe("the tier of the error budget policy the SLO is in", () => {
  function policyTier(data: {
    name: string;
    thresholdPercentage: number;
    whatWeDo: string;
    isEnabled?: boolean;
  }): ServiceLevelObjectiveErrorBudgetPolicyTier {
    const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
      new ServiceLevelObjectiveErrorBudgetPolicyTier();
    tier._id = ObjectID.generate().toString();
    tier.name = data.name;
    tier.thresholdPercentage = data.thresholdPercentage;
    tier.whatWeDo = data.whatWeDo;
    tier.isEnabled = data.isEnabled ?? true;
    return tier;
  }

  const CAUTION: ServiceLevelObjectiveErrorBudgetPolicyTier = policyTier({
    name: "Caution",
    thresholdPercentage: 50,
    whatWeDo: "Review risky changes before they ship.",
  });
  const RELIABILITY_FIRST: ServiceLevelObjectiveErrorBudgetPolicyTier =
    policyTier({
      name: "Reliability first",
      thresholdPercentage: 25,
      whatWeDo: "Only **reliability** improvements and critical fixes ship.",
    });
  const EXHAUSTED: ServiceLevelObjectiveErrorBudgetPolicyTier = policyTier({
    name: "Budget exhausted",
    thresholdPercentage: 0,
    whatWeDo: "Freeze non-critical releases.",
  });
  const SWITCHED_OFF: ServiceLevelObjectiveErrorBudgetPolicyTier = policyTier({
    name: "Switched off",
    thresholdPercentage: 75,
    whatWeDo: "Nothing yet.",
    isEnabled: false,
  });

  function putSloIn(
    tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
    hoursAgo: number = 3,
  ): void {
    storedSlo.currentErrorBudgetPolicyTierId = new ObjectID(tier._id!);
    storedSlo.currentErrorBudgetPolicyTierName = tier.name!;
    storedSlo.currentErrorBudgetPolicyTierEnteredAt = new Date(
      Date.now() - hoursAgo * 60 * 60 * 1000,
    );
  }

  function tierCard(): HTMLElement {
    return screen.getByTestId("slo-overview-policy-tier");
  }

  test("shows it under the summary, before the numbers: its name, budget left, since when and what the team does", async () => {
    overviewData.policyTiers = [CAUTION, RELIABILITY_FIRST, EXHAUSTED];
    putSloIn(RELIABILITY_FIRST);

    renderPage();
    await waitForDetails();

    const card: HTMLElement = tierCard();

    expect(card).toHaveAttribute("aria-label", "Error Budget Policy");
    expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Reliability first",
    );
    expect(card).toHaveTextContent("Budget left ≤ 25%");
    expect(card).toHaveTextContent("Entered 3 hours ago");
    expect(within(card).getByTestId("markdown")).toHaveTextContent(
      "Only **reliability** improvements and critical fixes ship.",
    );

    // Right under the hero, before the KPI strip and the grid.
    const hero: HTMLElement = screen.getByTestId("hero");
    const kpi: HTMLElement = screen.getByTestId("kpi-strip");

    expect(
      hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      card.compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("links to the Error Budget Policy page, and is coloured as its tier", async () => {
    overviewData.policyTiers = [CAUTION, RELIABILITY_FIRST, EXHAUSTED];
    putSloIn(CAUTION);

    renderPage();
    await waitForDetails();

    expect(
      within(tierCard()).getByRole("link", { name: "Open policy" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/slos/${SLO_ID.toString()}/error-budget-policy`,
    );
    expect(tierCard()).toHaveAttribute("data-tier-tone", "warning");
    expect(
      within(tierCard()).getByTestId("slo-overview-policy-tier-color"),
    ).toHaveStyle({ backgroundColor: Yellow.toString() });
  });

  test("the tier of an exhausted budget reads red", async () => {
    overviewData.policyTiers = [CAUTION, RELIABILITY_FIRST, EXHAUSTED];
    putSloIn(EXHAUSTED, 2);

    renderPage();
    await waitForDetails();

    expect(tierCard()).toHaveAttribute("data-tier-tone", "danger");
    expect(
      within(tierCard()).getByTestId("slo-overview-policy-tier-color"),
    ).toHaveStyle({ backgroundColor: Red.toString() });
    expect(tierCard()).toHaveTextContent("Budget left ≤ 0%");
    expect(tierCard()).toHaveTextContent("Entered 2 hours ago");
  });

  test("an SLO in no tier, or without a policy, shows nothing more", async () => {
    overviewData.policyTiers = [CAUTION, RELIABILITY_FIRST, EXHAUSTED];

    renderPage();
    await waitForDetails();

    expect(screen.queryByTestId("slo-overview-policy-tier")).toBeNull();

    cleanup();
    overviewData.policyTiers = [];

    renderPage();
    await waitForDetails();

    expect(screen.queryByTestId("slo-overview-policy-tier")).toBeNull();
  });

  test("a tier the page could not read still says which one, by the name the SLO keeps", async () => {
    overviewData.policyTiers = [];
    putSloIn(RELIABILITY_FIRST);

    renderPage();
    await waitForDetails();

    expect(
      within(tierCard()).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Reliability first");
    expect(tierCard()).not.toHaveTextContent("Budget left");
    expect(within(tierCard()).queryByTestId("markdown")).toBeNull();
  });

  test("hands the burn-down the enabled tiers, for its lines", async () => {
    overviewData.policyTiers = [SWITCHED_OFF, CAUTION, EXHAUSTED];

    renderPage();
    await waitForDetails();

    expect(mockBurnDownTiers).toEqual([CAUTION, EXHAUSTED]);
  });
});

/*
 * The burn rate tile is an hour's reading, and turns red at the lowest
 * threshold among the rules that hour can speak for: those that look back 6
 * hours or less, like Fast burn and Slow burn. The default slow-leak rule
 * fires at 1x over 3 days; compared with an hour, it would turn the tile red
 * for any hour that burned at all.
 */
describe("the burn rate tile's rule threshold", () => {
  function burnRule(
    name: string,
    threshold: number,
    longWindowInMinutes: number | undefined,
    isEnabled: boolean = true,
  ): ServiceLevelObjectiveBurnRateRule {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    rule._id = ObjectID.generate().toString();
    rule.name = name;
    rule.burnRateThreshold = threshold;
    rule.isEnabled = isEnabled;

    if (longWindowInMinutes !== undefined) {
      rule.longWindowInMinutes = longWindowInMinutes;
    }

    return rule;
  }

  async function tileThreshold(): Promise<string | null> {
    renderPage();
    await waitForDetails();

    return screen
      .getByTestId("kpi-strip")
      .getAttribute("data-lowest-threshold");
  }

  test("is the lowest among the enabled rules that look back 6 hours or less - never Slow leak's 1x", async () => {
    overviewData.burnRateRules = [
      burnRule("Fast burn", 14.4, 60),
      burnRule("Slow burn", 6, 360),
      burnRule("Slow leak", 1, 4320),
      burnRule("Switched off", 0.5, 60, false),
    ];

    expect(await tileThreshold()).toBe("6");
  });

  test("with only a slow leak enabled, the tile has no rule threshold to reach", async () => {
    overviewData.burnRateRules = [burnRule("Slow leak", 1, 4320)];

    expect(await tileThreshold()).toBe("null");
  });

  test("a rule whose long window is unknown is compared, as every rule was", async () => {
    overviewData.burnRateRules = [
      burnRule("Slow burn", 6, 360),
      burnRule("Imported", 2, undefined),
    ];

    expect(await tileThreshold()).toBe("2");
  });
});
