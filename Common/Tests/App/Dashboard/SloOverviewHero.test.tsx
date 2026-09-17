import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
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
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * The SLO overview hero, RENDERED: the verdict, the facts every number below
 * depends on, and the owners and labels strip. In particular the "window
 * filling" chip that replaced the full-width "Window not yet full" banner
 * must appear for a young rolling window and for nothing else.
 */

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const LAST_EVALUATED_AT: Date = new Date("2026-09-15T11:58:00.000Z");

afterEach(() => {
  cleanup();
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

type ChipTextsFunction = () => Array<string>;

const getChipTexts: ChipTextsFunction = (): Array<string> => {
  return within(screen.getByRole("list", { name: "SLO at a glance" }))
    .getAllByRole("listitem")
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
    expect(getChipTexts()).toEqual([
      "Target 99.9%",
      "Rolling 30 days",
      "3 monitors",
    ]);
  });

  test("says when it was last evaluated, with the exact time on hover", () => {
    renderHero({});

    const lastEvaluated: HTMLElement = screen.getByTestId(
      "slo-overview-last-evaluated",
    );

    expect(lastEvaluated.textContent).toMatch(/^Evaluated .+ · every 5 min$/);

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
      "Not evaluated yet · runs every 5 min",
    );

    const monitorsChip: HTMLElement = screen.getByTestId(
      "slo-overview-chip-monitors",
    );
    expect(monitorsChip).toHaveTextContent("No monitors");
    expect(monitorsChip.querySelector("span")!.className).toContain("amber");
  });

  test("a young rolling window gets a 'window filling' chip instead of a banner", () => {
    renderHero({ slo: buildSlo({ errorBudgetTotalSeconds: 648 }) });

    const chip: HTMLElement = screen.getByTestId(
      "slo-overview-chip-window-fill",
    );

    expect(chip).toHaveTextContent("Window 25% full");
    expect(chip.getAttribute("title")).toContain(
      "younger than its compliance window",
    );
    expect(getChipTexts()).toEqual([
      "Target 99.9%",
      "Rolling 30 days",
      "Window 25% full",
      "3 monitors",
    ]);
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
    expect(getChipTexts()).toContain("Calendar month (Europe/Berlin)");
    cleanup();

    renderHero({
      slo: buildSlo({
        multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
        errorBudgetTotalSeconds: 100,
      }),
    });
    expect(screen.queryByTestId("slo-overview-chip-window-fill")).toBeNull();
  });

  test("disabled and archived SLOs say so, and never claim a stale verdict", () => {
    renderHero({
      slo: buildSlo({ isEnabled: false, isArchived: true }),
    });

    expect(screen.getByTestId("slo-overview-headline")).toHaveTextContent(
      "Archived — not being measured",
    );
    expect(getChipTexts()).toEqual(
      expect.arrayContaining(["Disabled", "Archived"]),
    );
  });

  test("an SLO without a description invites one", () => {
    renderHero({ slo: buildSlo({ description: undefined }) });

    expect(
      screen.getByText(
        "No description yet. Say what this objective protects in SLO Details below.",
      ),
    ).toBeInTheDocument();
  });

  describe("owners", () => {
    const ownersHref: string = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SLO_VIEW_OWNERS] as Route,
      { modelId: SLO_ID },
    ).toString();

    test("no owners links to the Owners page", () => {
      renderHero({ owners: [] });

      expect(screen.getByRole("link", { name: "Add owners" })).toHaveAttribute(
        "href",
        ownersHref,
      );
    });

    test("while loading it shows a placeholder, not an invitation", () => {
      renderHero({ owners: undefined, isLoadingOwners: true });

      expect(screen.queryByRole("link", { name: "Add owners" })).toBeNull();
      expect(screen.queryByText("Unavailable")).toBeNull();
    });

    test("a failed lookup says unavailable rather than inviting duplicate owners", () => {
      renderHero({ owners: undefined, isLoadingOwners: false });

      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Add owners" })).toBeNull();
    });

    test("owners render as the avatar stack", () => {
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      const owners: Array<ResourceOwnerEntry> = [{ kind: "team", team: team }];

      renderHero({ owners: owners });

      expect(screen.queryByRole("link", { name: "Add owners" })).toBeNull();
      expect(screen.queryByText("Unavailable")).toBeNull();
      expect(screen.queryByText("No owners.")).toBeNull();
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

  test("owners sit beside the evaluation time, labelled", () => {
    renderHero({ owners: [] });

    const owners: HTMLElement = screen.getByTestId("slo-overview-owners");
    expect(owners).toHaveTextContent("Owners");
    expect(
      within(owners).getByRole("link", { name: "Add owners" }),
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
  });
});
