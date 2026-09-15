import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import SloBudgetBar from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBar";
import SloKpiStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * The SLO overview's headline numbers, RENDERED.
 *
 * The maths behind each tile is unit-tested in SloProjection.test.ts; what
 * can still go wrong is the wiring into the DOM — a tile reading the wrong
 * column, a colour class on the wrong branch, an overspent budget drawing a
 * full bar, or a not-evaluated SLO showing a green 0%. So these render the
 * real strip and bar from plain SLO rows and assert what a reader sees.
 */

const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

afterEach(() => {
  cleanup();
});

type BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective>,
) => ServiceLevelObjective;

// 99.9% over a rolling 30 days: a full budget is 2592 seconds (43m 12s).
const buildSlo: BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective>,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 20;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  Object.assign(slo, overrides);
  return slo;
};

type GetTileFunction = (id: string) => HTMLElement;

const getTile: GetTileFunction = (id: string): HTMLElement => {
  const tile: HTMLElement | null = document.getElementById(id);

  if (!tile) {
    throw new Error(`No KPI tile with id ${id}`);
  }

  return tile;
};

describe("SloBudgetBar", () => {
  test("before the first evaluation it draws only an empty track", () => {
    render(
      <SloBudgetBar
        errorBudgetRemainingPercentage={null}
        atRiskThresholdPercentage={20}
      />,
    );

    const bar: HTMLElement = screen.getByRole("progressbar", {
      name: "Error budget remaining",
    });

    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      "Error budget not evaluated yet",
    );
    expect(bar).toHaveClass("bg-gray-100");
    expect(screen.queryByTestId("slo-budget-bar-fill")).toBeNull();
    expect(screen.queryByTestId("slo-budget-bar-marker")).toBeNull();
  });

  test("fills to the remaining budget and ticks the SLO's own at-risk threshold", () => {
    render(
      <SloBudgetBar
        errorBudgetRemainingPercentage={42.5}
        atRiskThresholdPercentage={25}
      />,
    );

    const fill: HTMLElement = screen.getByTestId("slo-budget-bar-fill");
    expect(fill).toHaveStyle({ width: "42.5%" });
    expect(fill).toHaveClass("bg-emerald-500");

    const marker: HTMLElement = screen.getByTestId("slo-budget-bar-marker");
    expect(marker).toHaveStyle({ left: "25%" });
    expect(marker).toHaveAttribute("title", "At risk at 25% or less");
    expect(marker).toHaveAttribute("aria-hidden", "true");

    const bar: HTMLElement = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "43");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      "42.5% of the error budget remaining; at risk at 25% or less",
    );
  });

  test("turns amber at the threshold, using <= like the worker", () => {
    render(
      <SloBudgetBar
        errorBudgetRemainingPercentage={25}
        atRiskThresholdPercentage={25}
      />,
    );

    expect(screen.getByTestId("slo-budget-bar-fill")).toHaveClass(
      "bg-amber-500",
    );
  });

  test("an overspent budget draws no fill on a red track, and says it is overspent", () => {
    render(
      <SloBudgetBar
        errorBudgetRemainingPercentage={-340}
        atRiskThresholdPercentage={20}
      />,
    );

    const bar: HTMLElement = screen.getByRole("progressbar");

    expect(screen.queryByTestId("slo-budget-bar-fill")).toBeNull();
    expect(bar).toHaveClass("bg-red-100");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar.getAttribute("aria-valuetext")).toContain(
      "Error budget overspent (-340%)",
    );
    // The threshold tick still shows where "at risk" would have been.
    expect(screen.getByTestId("slo-budget-bar-marker")).toHaveStyle({
      left: "20%",
    });
  });

  test("clamps the fill and the marker onto the track", () => {
    render(
      <SloBudgetBar
        errorBudgetRemainingPercentage={100.4}
        atRiskThresholdPercentage={150}
      />,
    );

    expect(screen.getByTestId("slo-budget-bar-fill")).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByTestId("slo-budget-bar-marker")).toHaveStyle({
      left: "100%",
    });
  });
});

describe("SloKpiStrip", () => {
  test("is one labelled group of four tiles", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({})}
        lowestEnabledBurnRateThreshold={null}
        now={NOW}
      />,
    );

    const group: HTMLElement = screen.getByRole("group", {
      name: "Error budget",
    });

    for (const id of [
      "slo-kpi-sli",
      "slo-kpi-budget",
      "slo-kpi-burn-rate",
      "slo-kpi-runway",
    ]) {
      expect(group).toContainElement(getTile(id));
    }
  });

  test("asserts nothing before the first evaluation", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({})}
        lowestEnabledBurnRateThreshold={2}
        now={NOW}
      />,
    );

    const sli: HTMLElement = getTile("slo-kpi-sli");
    expect(within(sli).getByText("—")).toHaveClass("text-gray-400");
    expect(
      within(sli).getByText("Target 99.9% · not evaluated yet"),
    ).toBeInTheDocument();

    const budget: HTMLElement = getTile("slo-kpi-budget");
    expect(within(budget).getByText("—")).toHaveClass("text-gray-400");
    expect(within(budget).getByText("Not evaluated yet")).toBeInTheDocument();
    expect(within(budget).queryByTestId("slo-budget-bar-fill")).toBeNull();
    expect(within(budget).queryByTestId("slo-budget-bar-marker")).toBeNull();

    const burnRate: HTMLElement = getTile("slo-kpi-burn-rate");
    expect(within(burnRate).getByText("—")).toBeInTheDocument();
    expect(within(burnRate).getByText("Not evaluated yet")).toBeInTheDocument();
    expect(screen.queryByTestId("slo-kpi-burn-rate-badge")).toBeNull();

    const runway: HTMLElement = getTile("slo-kpi-runway");
    expect(within(runway).getByText("—")).toHaveClass("text-gray-400");
    expect(within(runway).getByText("Not evaluated yet")).toBeInTheDocument();
  });

  test("a healthy SLO reads green, with the gap to target and a sustainable runway", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          currentSliPercentage: 99.95,
          errorBudgetRemainingPercentage: 62.5,
          errorBudgetRemainingSeconds: 1620,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 0.5,
          sloStatus: SloStatus.Healthy,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={2}
        now={NOW}
      />,
    );

    const sli: HTMLElement = getTile("slo-kpi-sli");
    expect(within(sli).getByText("99.95%")).toHaveClass("text-gray-900");
    expect(
      within(sli).getByText("0.05 pp above the 99.9% target"),
    ).toBeInTheDocument();

    const budget: HTMLElement = getTile("slo-kpi-budget");
    expect(within(budget).getByText("62.5%")).toHaveClass("text-emerald-700");
    // A mature window: no "window filling" note.
    expect(within(budget).getByText("27m left of 43m 12s")).toBeInTheDocument();
    expect(within(budget).getByTestId("slo-budget-bar-fill")).toHaveStyle({
      width: "62.5%",
    });

    const burnRate: HTMLElement = getTile("slo-kpi-burn-rate");
    expect(within(burnRate).getByText("0.5×")).toHaveClass("text-gray-900");
    expect(
      within(burnRate).getByText(
        "Over the last 1h · 1× spends the budget exactly over the window",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("slo-kpi-burn-rate-badge")).toBeNull();

    const runway: HTMLElement = getTile("slo-kpi-runway");
    expect(within(runway).getByText("Sustainable")).toHaveClass(
      "text-emerald-700",
    );
    expect(
      within(runway).getByText(
        "Outlasts the 30-day window, at the burn rate of the last 1h",
      ),
    ).toBeInTheDocument();
  });

  test("a burning SLO below target goes red, and flags the lowest enabled rule's threshold", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          currentSliPercentage: 99.812,
          errorBudgetRemainingPercentage: 15,
          errorBudgetRemainingSeconds: 389,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 14.4,
          sloStatus: SloStatus.AtRisk,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={14.4}
        now={NOW}
      />,
    );

    const sli: HTMLElement = getTile("slo-kpi-sli");
    expect(within(sli).getByText("99.812%")).toHaveClass("text-red-700");
    expect(
      within(sli).getByText("0.088 pp below the 99.9% target"),
    ).toBeInTheDocument();

    const budget: HTMLElement = getTile("slo-kpi-budget");
    expect(within(budget).getByText("15%")).toHaveClass("text-amber-700");
    expect(within(budget).getByTestId("slo-budget-bar-fill")).toHaveClass(
      "bg-amber-500",
    );

    const burnRate: HTMLElement = getTile("slo-kpi-burn-rate");
    expect(within(burnRate).getByText("14.4×")).toHaveClass("text-red-700");
    const badge: HTMLElement = screen.getByTestId("slo-kpi-burn-rate-badge");
    expect(badge).toHaveTextContent("Rule threshold reached");
    expect(badge.getAttribute("title")).toContain("at or above 14.4×");

    // 389s / (14.4 x 0.001) = 27,013s: under a day, so red.
    const runway: HTMLElement = getTile("slo-kpi-runway");
    expect(within(runway).getByText("~7h 30m")).toHaveClass("text-red-700");
  });

  test("a burn above 1x that no rule catches yet is amber, without a badge", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          currentSliPercentage: 99.95,
          errorBudgetRemainingPercentage: 70,
          errorBudgetRemainingSeconds: 1814,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 1.5,
          sloStatus: SloStatus.Healthy,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={6}
        now={NOW}
      />,
    );

    expect(within(getTile("slo-kpi-burn-rate")).getByText("1.5×")).toHaveClass(
      "text-amber-700",
    );
    expect(screen.queryByTestId("slo-kpi-burn-rate-badge")).toBeNull();
  });

  test("an SLO without enabled rules never shows the threshold badge", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          errorBudgetRemainingPercentage: 10,
          errorBudgetRemainingSeconds: 259,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 50,
          currentSliPercentage: 99,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={null}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId("slo-kpi-burn-rate-badge")).toBeNull();
  });

  test("an overspent budget says how far over, with an empty red bar", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          currentSliPercentage: 99.7,
          errorBudgetRemainingPercentage: -120,
          errorBudgetRemainingSeconds: -750,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 3,
          sloStatus: SloStatus.BudgetExhausted,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={14.4}
        now={NOW}
      />,
    );

    const budget: HTMLElement = getTile("slo-kpi-budget");
    expect(within(budget).getByText("-120%")).toHaveClass("text-red-700");
    expect(
      within(budget).getByText("−12m 30s over budget of 43m 12s"),
    ).toBeInTheDocument();
    expect(within(budget).queryByTestId("slo-budget-bar-fill")).toBeNull();
    expect(within(budget).getByRole("progressbar")).toHaveClass("bg-red-100");

    const runway: HTMLElement = getTile("slo-kpi-runway");
    expect(within(runway).getByText("Overspent")).toHaveClass("text-red-700");
    expect(within(runway).getByText("12m 30s over budget")).toBeInTheDocument();
  });

  test("a young rolling window says so under the budget that is still growing", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          currentSliPercentage: 99.96,
          errorBudgetRemainingPercentage: 61.7,
          errorBudgetRemainingSeconds: 400,
          errorBudgetTotalSeconds: 648,
          currentBurnRate: 0.2,
          sloStatus: SloStatus.Healthy,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={2}
        now={NOW}
      />,
    );

    expect(
      within(getTile("slo-kpi-budget")).getByText(
        "6m 40s left of 10m 48s · window 25% full",
      ),
    ).toBeInTheDocument();
  });

  test("Monitor Seconds Average SLOs show no runway rather than a wrong one", () => {
    render(
      <SloKpiStrip
        slo={buildSlo({
          multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
          currentSliPercentage: 99.95,
          errorBudgetRemainingPercentage: 50,
          errorBudgetRemainingSeconds: 5000,
          errorBudgetTotalSeconds: 10000,
          currentBurnRate: 1,
          lastEvaluatedAt: NOW,
        })}
        lowestEnabledBurnRateThreshold={2}
        now={NOW}
      />,
    );

    const runway: HTMLElement = getTile("slo-kpi-runway");
    expect(within(runway).getByText("—")).toHaveClass("text-gray-400");
    expect(
      within(runway).getByText(
        "Not projected when downtime is averaged across monitors",
      ),
    ).toBeInTheDocument();
  });
});
