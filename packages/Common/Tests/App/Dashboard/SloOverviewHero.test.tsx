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
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

import { OwnersChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwners";
import { ADD_OWNERS_TEXT_BUTTON_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwnersPopup";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import SloOverviewHero, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewHero";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Label from "../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * The SLO overview hero, RENDERED: the verdict, the facts every number below
 * depends on, and ownership. The facts form a labelled definition list,
 * and the window-filling badge appears only for a young rolling window.
 */

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const LAST_EVALUATED_AT: Date = new Date("2026-09-15T11:58:00.000Z");
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const JANE_ID: string = "b0000000-0000-4000-8000-000000000001";

// The project's people, as the Add owners list searches them.
function serveProject(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const jane: User = new User();
      jane._id = JANE_ID;
      jane.name = new Name("Jane Doe");
      jane.email = new Email("jane@example.com");
      const member: TeamMember = new TeamMember();
      member.user = jane;
      return { data: [member], count: 1, skip: 0, limit: 25 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

// A reader who may add owners (a project owner).
function mayAddOwners(): void {
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/slos`);
  serveProject();
  createMock.mockResolvedValue({});
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined,
 * and an explicit undefined is exactly what a column the worker has not
 * written yet looks like on a real row.
 */
type SloOverrides = {
  [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | undefined;
};

type BuildSloFunction = (overrides: SloOverrides) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: SloOverrides,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.name = "Checkout availability";
  slo.description = "Customers can pay for their basket.";
  slo.isEnabled = true;
  slo.isArchived = false;
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.sloStatus = SloStatus.Healthy;
  slo.lastEvaluatedAt = LAST_EVALUATED_AT;
  slo.errorBudgetTotalSeconds = 2592;
  Object.assign(slo, overrides);
  return slo;
};

type RenderHeroFunction = (overrides: Partial<ComponentProps>) => void;

const renderHero: RenderHeroFunction = (
  overrides: Partial<ComponentProps>,
): void => {
  const props: ComponentProps = {
    sloId: SLO_ID,
    slo: buildSlo({}),
    monitorCount: 3,
    owners: [],
    isLoadingOwners: false,
    isRefreshing: false,
    refreshError: "",
    onRefresh: () => {},
    ...overrides,
  };

  render(
    <MemoryRouter>
      <SloOverviewHero {...props} />
    </MemoryRouter>,
  );
};

type FactValuesFunction = () => Array<string>;

const getFactValues: FactValuesFunction = (): Array<string> => {
  return within(screen.getByLabelText("SLO at a glance"))
    .getAllByRole("definition")
    .map((item: HTMLElement) => {
      return item.textContent || "";
    });
};

describe("SloOverviewHero", () => {
  test("a healthy SLO leads with its verdict and the facts behind the numbers", () => {
    renderHero({});

    expect(screen.getByTestId("slo-overview-headline")).toHaveTextContent(
      "Within error budget",
    );
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(
      screen.getByText("Customers can pay for their basket."),
    ).toBeInTheDocument();
    const facts: HTMLElement = screen.getByLabelText("SLO at a glance");
    expect(facts.tagName).toBe("DL");
    expect(
      within(facts)
        .getAllByRole("term")
        .map((term: HTMLElement) => {
          return term.textContent;
        }),
    ).toEqual(["Target", "Compliance window", "Monitors", "Owners"]);
    // A reader whose permissions are not known yet is offered nothing to add.
    expect(getFactValues()).toEqual([
      "99.9%",
      "Rolling 30 days",
      "3 monitors",
      "No owners",
    ]);
  });

  test.each([
    {
      status: SloStatus.Healthy,
      headline: "Within error budget",
      tone: "text-emerald-800",
    },
    {
      status: SloStatus.AtRisk,
      headline: "Error budget running low",
      tone: "text-amber-800",
    },
    {
      status: SloStatus.BudgetExhausted,
      headline: "Error budget exhausted",
      tone: "text-red-800",
    },
    {
      status: SloStatus.Misconfigured,
      headline: "Cannot be evaluated",
      tone: "text-gray-700",
    },
    {
      status: SloStatus.Paused,
      headline: "Measurement paused",
      tone: "text-gray-700",
    },
  ])(
    "renders $status with a matching headline and soft status badge",
    ({
      status,
      headline,
      tone,
    }: {
      status: SloStatus;
      headline: string;
      tone: string;
    }) => {
      renderHero({ slo: buildSlo({ sloStatus: status }) });

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        headline,
      );
      expect(screen.getByText(status)).toHaveClass("bg-gradient-to-r", tone);
      expect(screen.queryByRole("img")).toBeNull();
    },
  );

  test("says when it was last evaluated, with the exact time on hover", () => {
    renderHero({});

    const lastEvaluated: HTMLElement = screen.getByTestId(
      "slo-overview-last-evaluated",
    );

    expect(lastEvaluated.textContent).toMatch(/^Evaluated .+/);
    expect(lastEvaluated).not.toHaveTextContent("Runs every");
    expect(screen.getByText("Runs every 5 minutes")).toBeInTheDocument();

    const time: HTMLElement = lastEvaluated.querySelector("time")!;
    expect(time).toHaveAttribute("dateTime", LAST_EVALUATED_AT.toISOString());
    expect(time.getAttribute("title")).toBeTruthy();
  });

  test("a brand-new SLO makes no reliability claim and says what it is waiting for", () => {
    renderHero({
      slo: buildSlo({
        sloStatus: undefined,
        lastEvaluatedAt: undefined,
        errorBudgetTotalSeconds: undefined,
      }),
      monitorCount: 0,
    });

    expect(screen.getByTestId("slo-overview-headline")).toHaveTextContent(
      "Waiting for monitors",
    );
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.getByTestId("slo-overview-last-evaluated")).toHaveTextContent(
      "Not evaluated yet",
    );
    expect(screen.getByText("Runs every 5 minutes")).toBeInTheDocument();
    expect(screen.getAllByText("Not evaluated yet")).toHaveLength(2);

    const monitorsChip: HTMLElement = screen.getByTestId(
      "slo-overview-chip-monitors",
    );
    expect(monitorsChip).toHaveTextContent("No monitors");
    expect(within(monitorsChip).getByText("No monitors")).toHaveClass(
      "text-yellow-700",
    );
  });

  test("a young rolling window shows its filling badge alongside its compliance window", () => {
    renderHero({ slo: buildSlo({ errorBudgetTotalSeconds: 648 }) });

    const chip: HTMLElement = screen.getByTestId(
      "slo-overview-chip-window-fill",
    );

    expect(chip).toHaveTextContent("Window 25% full");
    expect(chip.getAttribute("title")).toContain(
      "younger than its compliance window",
    );
    const window: HTMLElement = screen.getByTestId("slo-overview-chip-window");
    expect(window).toContainElement(chip);
    expect(within(window).getByRole("term")).toHaveTextContent(
      "Compliance window",
    );
    expect(within(window).getByRole("definition")).toHaveTextContent(
      "Rolling 30 days",
    );
  });

  test("a mature window, a calendar month and an averaged SLO get no window chip", () => {
    renderHero({ slo: buildSlo({ errorBudgetTotalSeconds: 2592 }) });
    expect(screen.queryByTestId("slo-overview-chip-window-fill")).toBeNull();
    cleanup();

    renderHero({
      slo: buildSlo({
        windowType: SloWindowType.CalendarMonth,
        timezone: "Europe/Berlin",
        errorBudgetTotalSeconds: 100,
      }),
    });
    expect(screen.queryByTestId("slo-overview-chip-window-fill")).toBeNull();
    expect(getFactValues()).toContain("Calendar month (Europe/Berlin)");
    cleanup();

    renderHero({
      slo: buildSlo({
        multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
        errorBudgetTotalSeconds: 100,
      }),
    });
    expect(screen.queryByTestId("slo-overview-chip-window-fill")).toBeNull();
  });

  test.each([
    { isEnabled: false, isArchived: false, status: "Disabled" },
    { isEnabled: true, isArchived: true, status: "Archived" },
    { isEnabled: false, isArchived: true, status: "Archived" },
  ])(
    "$status overrides stale health when enabled=$isEnabled and archived=$isArchived",
    ({
      isEnabled,
      isArchived,
      status,
    }: {
      isEnabled: boolean;
      isArchived: boolean;
      status: string;
    }) => {
      renderHero({ slo: buildSlo({ isEnabled, isArchived }) });

      expect(screen.getByTestId("slo-overview-headline")).toHaveTextContent(
        `${status} — not being measured`,
      );
      expect(screen.getByText(status, { exact: true })).toHaveClass(
        "text-gray-700",
      );
      expect(screen.queryByText("Healthy", { exact: true })).toBeNull();
      expect(screen.queryByText("Within error budget")).toBeNull();
      if (isArchived) {
        expect(screen.queryByText("Disabled", { exact: true })).toBeNull();
      }
    },
  );

  test.each([undefined, ""])(
    "an empty description (%s) adds no placeholder copy",
    (description: string | undefined) => {
      renderHero({ slo: buildSlo({ description }) });

      expect(screen.queryByText(/No description/)).toBeNull();
      expect(
        screen.getByTestId("slo-overview-headline").nextElementSibling,
      ).toBeNull();
    },
  );

  test("a missing target is explicit instead of showing an incomplete percentage", () => {
    renderHero({ slo: buildSlo({ targetPercentage: undefined }) });

    expect(
      within(screen.getByTestId("slo-overview-chip-target")).getByRole(
        "definition",
      ),
    ).toHaveTextContent("Not set");
  });

  test.each([
    { count: 0, label: "No monitors" },
    { count: 1, label: "1 monitor" },
    { count: 3, label: "3 monitors" },
  ])(
    "the $label summary links to this SLO's Monitors page",
    ({ count, label }: { count: number; label: string }) => {
      renderHero({ monitorCount: count });

      const monitorsHref: string = RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
        { modelId: SLO_ID },
      ).toString();

      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        monitorsHref,
      );
    },
  );

  describe("owners", () => {
    test("no owners: Add owners opens the Add owners list right there, not the Owners page", async () => {
      mayAddOwners();
      renderHero({ owners: [] });

      const add: HTMLElement = screen.getByRole("button", {
        name: "Add owners",
      });

      expect(add).toHaveAttribute("data-testid", "slo-overview-add-owners");
      expect(add).toHaveAttribute("aria-haspopup", "dialog");
      expect(screen.queryByRole("link", { name: "Add owners" })).toBeNull();
      /*
       * "No owners", then the shared "+ Add owners" - the monitor
       * overview's words and control, so the two heroes read alike (UI
       * review).
       */
      const owners: HTMLElement = screen.getByTestId("slo-overview-owners");
      expect(within(owners).getByText("No owners")).toBeVisible();
      expect(
        within(owners).getByText("No owners").compareDocumentPosition(add) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      for (const className of ADD_OWNERS_TEXT_BUTTON_CLASS_NAME.split(" ")) {
        expect(add).toHaveClass(className);
      }
      expect(add.querySelector("svg")).not.toBeNull();

      fireEvent.click(add);

      const list: HTMLElement = await screen.findByRole("dialog", {
        name: "Add owners",
      });

      expect(await within(list).findByText("Jane Doe")).toBeVisible();
      expect(add).toHaveAttribute("aria-expanded", "true");
    });

    test("a pick makes them an owner of the SLO, and the page is told to read its owners again", async () => {
      mayAddOwners();
      const changes: Array<OwnersChange> = [];

      renderHero({
        owners: [],
        onOwnersChanged: (change: OwnersChange): void => {
          changes.push(change);
        },
      });

      fireEvent.click(screen.getByRole("button", { name: "Add owners" }));

      const list: HTMLElement = await screen.findByRole("dialog", {
        name: "Add owners",
      });

      fireEvent.click(await within(list).findByText("Jane Doe"));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });

      const request: any = createMock.mock.calls[0]![0];

      expect(request.modelType).toBe(ServiceLevelObjectiveOwnerUser);
      expect(String(request.model.serviceLevelObjectiveId)).toBe(
        SLO_ID.toString(),
      );
      expect(String(request.model.userId)).toBe(JANE_ID);
      await waitFor(() => {
        expect(changes).toEqual([{ wasAdded: true }]);
      });
      expect(await within(list).findByText("Added Jane Doe.")).toBeVisible();
    });

    test("a reader who may not add owners reads No owners, and nothing offers to add", () => {
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue([Permission.Viewer]);
      jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);

      renderHero({ owners: [] });

      expect(
        within(screen.getByTestId("slo-overview-owners")).getByText(
          "No owners",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "Add owners" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Add owners" })).toBeNull();
    });

    test("while loading it shows a placeholder, not an invitation", () => {
      mayAddOwners();
      renderHero({ owners: undefined, isLoadingOwners: true });

      expect(screen.queryByRole("button", { name: "Add owners" })).toBeNull();
      expect(screen.queryByText("Unavailable")).toBeNull();
    });

    test("a failed lookup says unavailable rather than inviting duplicate owners", () => {
      mayAddOwners();
      renderHero({ owners: undefined, isLoadingOwners: false });

      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add owners" })).toBeNull();
    });

    test("owners render as the avatar stack, then the place to add more", () => {
      mayAddOwners();
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      const owners: Array<ResourceOwnerEntry> = [{ kind: "team", team: team }];

      renderHero({ owners: owners });

      const place: HTMLElement = screen.getByRole("button", {
        name: "Add owners",
      });

      expect(place).toHaveAttribute(
        "data-testid",
        "slo-overview-add-more-owners",
      );
      expect(place).toHaveClass("h-6", "w-6", "rounded-full", "border-dashed");
      expect(screen.queryByText("Unavailable")).toBeNull();
      expect(screen.queryByText("No owners.")).toBeNull();
    });

    test("owners without the permission to add: the avatars alone", () => {
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      renderHero({ owners: [{ kind: "team", team: team }] });

      expect(screen.queryByRole("button", { name: "Add owners" })).toBeNull();
    });
  });

  test("leaves labels to the page header, which already shows them", () => {
    const label: Label = new Label();
    label._id = "5f8b7c1e2d3a4b5c6d7e8f92";
    label.name = "payments";
    label.color = Green;

    renderHero({ slo: buildSlo({ labels: [label] }) });
    expect(screen.queryByText("payments")).toBeNull();
    expect(screen.queryByText("No labels")).toBeNull();
  });

  test("owners are labelled within the summary facts", () => {
    mayAddOwners();
    renderHero({ owners: [] });

    const owners: HTMLElement = screen.getByTestId("slo-overview-owners");
    expect(screen.getByLabelText("SLO at a glance")).toContainElement(owners);
    expect(owners).toHaveTextContent("Owners");
    expect(
      within(owners).getByRole("button", { name: "Add owners" }),
    ).toBeInTheDocument();
  });

  test("refresh calls back, and a failed refresh keeps the numbers and says so", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    renderHero({ onRefresh: onRefresh, refreshError: "Network error." });

    fireEvent.click(screen.getByTestId("slo-overview-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh — showing the last numbers that loaded. Network error.",
    );
    expect(getFactValues()).toContain("99.9%");
  });

  test("an in-progress refresh disables duplicate requests and keeps the summary visible", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    renderHero({ onRefresh, isRefreshing: true });

    const refreshButton: HTMLElement = screen.getByRole("button", {
      name: "Refresh",
    });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(refreshButton);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("slo-overview-headline")).toHaveTextContent(
      "Within error budget",
    );
    expect(getFactValues()).toContain("99.9%");
  });
});
