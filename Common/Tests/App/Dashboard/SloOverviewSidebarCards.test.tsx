import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SloBurnRateRulesSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBurnRateRulesSummaryCard";
import SloConfigurationSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloConfigurationSummaryCard";
import SloOverviewGettingStartedCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewGettingStartedCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Route from "../../../Types/API/Route";
import { Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * The SLO overview's read-only sidebar and its getting-started card,
 * RENDERED: plain-language configuration, the burn rate rules against the
 * current burn, and the calls to action a brand-new SLO needs — each link
 * pointing at the SLO page that actually does the thing.
 */

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

afterEach(() => {
  cleanup();
});

type HrefFunction = (pageKey: PageMap) => string;

const hrefFor: HrefFunction = (pageKey: PageMap): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageKey] as Route, {
    modelId: SLO_ID,
  }).toString();
};

type RenderInRouterFunction = (element: React.ReactElement) => void;

const renderInRouter: RenderInRouterFunction = (
  element: React.ReactElement,
): void => {
  render(<MemoryRouter>{element}</MemoryRouter>);
};

// Partial<T> under exactOptionalPropertyTypes forbids the explicit undefined of an unset column.
type SloOverrides = {
  [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | undefined;
};

type BuildSloFunction = (overrides: SloOverrides) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: SloOverrides,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.sliType = SliType.MonitorUptime;
  slo.downtimeMonitorStatuses = [];
  Object.assign(slo, overrides);
  return slo;
};

type GetRowFunction = (key: string) => HTMLElement;

const getConfigurationRow: GetRowFunction = (key: string): HTMLElement => {
  return screen.getByTestId(`slo-configuration-${key}`);
};

describe("SloConfigurationSummaryCard", () => {
  test("restates the target as the downtime it allows", () => {
    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({})}
        now={NOW}
      />,
    );

    const objective: HTMLElement = getConfigurationRow("objective");
    expect(within(objective).getByText("99.9% uptime")).toBeInTheDocument();
    expect(
      within(objective).getByText(
        "43m 12s of downtime allowed per rolling 30 days",
      ),
    ).toBeInTheDocument();
  });

  test("names every setting in plain words, with the defaults spelled out", () => {
    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({})}
        now={NOW}
      />,
    );

    expect(getConfigurationRow("window")).toHaveTextContent("Rolling 30 days");
    expect(getConfigurationRow("window")).toHaveTextContent(
      "Old downtime ages out of the window, returning its budget.",
    );
    expect(getConfigurationRow("at-risk")).toHaveTextContent(
      "When 25% or less of the error budget is left",
    );
    expect(getConfigurationRow("downtime-statuses")).toHaveTextContent(
      "Every non-operational status",
    );
    expect(getConfigurationRow("multi-monitor-mode")).toHaveTextContent(
      "Down when any monitor is down",
    );
    // Never the raw enum text the old details card printed.
    expect(screen.queryByText(SloMultiMonitorMode.AnyDown)).toBeNull();
    expect(getConfigurationRow("indicator")).toHaveTextContent(
      "Monitor uptime",
    );
    expect(getConfigurationRow("indicator")).toHaveTextContent(
      "Evaluated every 5 minutes.",
    );
  });

  test("a calendar month in its timezone, averaged monitors and named downtime statuses", () => {
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = "5f8b7c1e2d3a4b5c6d7e8f93";
    offline.name = "Offline";
    offline.color = Red;

    const degraded: MonitorStatus = new MonitorStatus();
    degraded._id = "5f8b7c1e2d3a4b5c6d7e8f94";
    degraded.name = "Degraded";
    degraded.color = Yellow;

    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({
          windowType: SloWindowType.CalendarMonth,
          timezone: "Europe/Berlin",
          multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
          downtimeMonitorStatuses: [offline, degraded],
        })}
        now={NOW}
      />,
    );

    expect(getConfigurationRow("window")).toHaveTextContent(
      "Calendar month (Europe/Berlin)",
    );
    expect(getConfigurationRow("window")).toHaveTextContent(
      "The budget resets to full at the start of every month.",
    );
    // September has 30 days in Berlin too.
    expect(getConfigurationRow("objective")).toHaveTextContent(
      "43m 12s of downtime allowed this calendar month",
    );
    expect(getConfigurationRow("multi-monitor-mode")).toHaveTextContent(
      "Averaged across monitors",
    );

    const statuses: HTMLElement = getConfigurationRow("downtime-statuses");
    expect(within(statuses).getByText("Offline")).toBeInTheDocument();
    expect(within(statuses).getByText("Degraded")).toBeInTheDocument();
  });

  test("an unset target says so instead of an allowance", () => {
    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({ targetPercentage: undefined })}
        now={NOW}
      />,
    );

    expect(getConfigurationRow("objective")).toHaveTextContent("No target set");
    expect(getConfigurationRow("objective")).not.toHaveTextContent(
      "downtime allowed",
    );
  });

  test("editing lives on the Settings page", () => {
    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({})}
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Edit in Settings" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_SETTINGS));
  });
});

describe("SloBurnRateRulesSummaryCard", () => {
  type BuildRuleFunction = (
    overrides: Partial<ServiceLevelObjectiveBurnRateRule>,
  ) => ServiceLevelObjectiveBurnRateRule;

  let ruleCounter: number = 0;

  const buildRule: BuildRuleFunction = (
    overrides: Partial<ServiceLevelObjectiveBurnRateRule>,
  ): ServiceLevelObjectiveBurnRateRule => {
    ruleCounter += 1;
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    rule._id = `5f8b7c1e2d3a4b5c6d7e${(9000 + ruleCounter).toString()}`;
    rule.isEnabled = true;
    rule.shouldCreateAlert = false;
    rule.shouldCreateIncident = false;
    Object.assign(rule, overrides);
    return rule;
  };

  const rules: Array<ServiceLevelObjectiveBurnRateRule> = [
    buildRule({
      name: "Slow burn",
      burnRateThreshold: 6,
      longWindowInMinutes: 360,
      shortWindowInMinutes: 30,
      shouldCreateAlert: true,
    }),
    buildRule({
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
      shouldCreateAlert: true,
      shouldCreateIncident: true,
    }),
    buildRule({
      name: "Quiet",
      burnRateThreshold: 3,
      longWindowInMinutes: 1440,
      shortWindowInMinutes: 120,
    }),
    buildRule({
      name: "Switched off",
      burnRateThreshold: 1,
      isEnabled: false,
    }),
  ];

  test("lists enabled rules fastest first, hiding and counting disabled ones", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={6}
        error=""
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("slo-burn-rule-row");

    expect(
      rows.map((row: HTMLElement) => {
        return row.querySelector("p")!.textContent;
      }),
    ).toEqual(["Fast burn", "Slow burn", "Quiet"]);
    expect(screen.queryByText("Switched off")).toBeNull();
    expect(
      screen.getByText(/1 disabled rule is not shown\./),
    ).toBeInTheDocument();
  });

  test("describes each rule's threshold, windows and outputs", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={6}
        error=""
      />,
    );

    const [fast, slow, quiet]: Array<HTMLElement> =
      screen.getAllByTestId("slo-burn-rule-row");

    expect(
      within(fast!).getByText("At 14.4× or faster over 1h and 5m"),
    ).toBeInTheDocument();
    expect(within(fast!).getByText("Declares incident")).toBeInTheDocument();
    expect(within(fast!).getByText("Raises alert")).toBeInTheDocument();

    expect(
      within(slow!).getByText("At 6× or faster over 6h and 30m"),
    ).toBeInTheDocument();
    expect(within(quiet!).getByText("Raises nothing")).toBeInTheDocument();
  });

  test("compares the current burn with each threshold, flagging those reached", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={6}
        error=""
      />,
    );

    const [fast, slow, quiet]: Array<HTMLElement> =
      screen.getAllByTestId("slo-burn-rule-row");

    // 6 / 14.4 = 42%; the burn is at or above the other two thresholds.
    expect(within(fast!).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(within(fast!).queryByText("At threshold")).toBeNull();
    expect(within(slow!).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(within(slow!).getByText("At threshold")).toBeInTheDocument();
    expect(within(quiet!).getByText("At threshold")).toBeInTheDocument();
    expect(within(fast!).getByText("6× now")).toBeInTheDocument();
  });

  test("an unevaluated burn shows a dash and flags nothing", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={null}
        error=""
      />,
    );

    expect(screen.queryByText("At threshold")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  test("links to the rules page", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={1}
        error=""
      />,
    );

    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      hrefFor(PageMap.SLO_VIEW_BURN_RATE_RULES),
    );
  });

  test("with only disabled rules it warns that nothing alerts", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={[rules[3]!]}
        currentBurnRate={1}
        error=""
      />,
    );

    const empty: HTMLElement = screen.getByTestId("slo-burn-rules-empty");
    expect(empty).toHaveTextContent("No enabled burn rate rules");
    expect(empty).toHaveTextContent(
      "This SLO has 1 disabled rule, so nothing alerts when it burns its error budget too fast.",
    );
    expect(
      within(empty).getByRole("link", { name: "Review rules" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_BURN_RATE_RULES));
  });

  test("with no rules at all it invites adding one", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={[]}
        currentBurnRate={1}
        error=""
      />,
    );

    expect(screen.getByRole("link", { name: "Add a rule" })).toHaveAttribute(
      "href",
      hrefFor(PageMap.SLO_VIEW_BURN_RATE_RULES),
    );
  });

  test("a failed rule lookup says so instead of claiming there are none", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={[]}
        currentBurnRate={1}
        error="Could not load rules."
      />,
    );

    expect(screen.getByText("Could not load rules.")).toBeInTheDocument();
    expect(screen.queryByTestId("slo-burn-rules-empty")).toBeNull();
  });
});

describe("SloOverviewGettingStartedCard", () => {
  test("offers both ways to attach monitors, each linking to its page", () => {
    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={2}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Choose what this SLO measures" }),
    ).toBeInTheDocument();

    const ruleOption: HTMLElement = screen.getByTestId(
      "slo-getting-started-option-rule",
    );
    expect(
      within(ruleOption).getByRole("link", { name: "Create a monitor rule" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITOR_RULES));

    const manualOption: HTMLElement = screen.getByTestId(
      "slo-getting-started-option-manual",
    );
    expect(
      within(manualOption).getByRole("link", { name: "Add monitors" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITORS));

    expect(
      screen.getByRole("link", { name: "Review burn rate rules" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_BURN_RATE_RULES));
  });

  test("says how many burn rate rules are ready, or that none is", () => {
    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={2}
      />,
    );
    expect(
      screen.getByText(/^2 burn rate rules are ready to alert/),
    ).toBeInTheDocument();
    cleanup();

    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={1}
      />,
    );
    expect(
      screen.getByText(/^1 burn rate rule is ready to alert/),
    ).toBeInTheDocument();
    cleanup();

    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={0}
      />,
    );
    expect(
      screen.getByText(
        "No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast.",
      ),
    ).toBeInTheDocument();
  });

  test("tells a new SLO when its numbers will arrive", () => {
    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={0}
      />,
    );

    expect(
      screen.getByText(/OneUptime evaluates SLOs every 5 minutes\./),
    ).toBeInTheDocument();
  });
});
