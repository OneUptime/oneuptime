import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";

/*
 * An SLO is an affected resource of the incidents and alerts its burn rate
 * rules raise. A burn-rate incident carries no monitors on purpose, so before
 * this change its "Affected Resources" card said "No resources affected." and
 * its row in the incident list was blank - the incident looked like it was
 * about nothing, with no way back to the objective that declared it.
 *
 * These render the real card and cell. AppLink is a plain anchor so hrefs can
 * be read.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import AffectedResourcesCell from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesCell";
import AffectedResourcesDisplay from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Color from "../../../Types/Color";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const CHECKOUT_SLO_ID: string = "0193c0de-8888-4aaa-8bbb-000000000001";
const SEARCH_SLO_ID: string = "0193c0de-8888-4aaa-8bbb-000000000002";

type BuildSloFunction = (id: string, name: string) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  id: string,
  name: string,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id;
  slo.name = name;
  return slo;
};

type BuildServiceFunction = (id: string, name: string) => Service;

const buildService: BuildServiceFunction = (
  id: string,
  name: string,
): Service => {
  const service: Service = new Service();
  service._id = id;
  service.name = name;
  service.serviceColor = new Color("#6366f1");
  return service;
};

type BuildMonitorFunction = (id: string, name: string) => Monitor;

const buildMonitor: BuildMonitorFunction = (
  id: string,
  name: string,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  return monitor;
};

const CHECKOUT_SLO: ServiceLevelObjective = buildSlo(
  CHECKOUT_SLO_ID,
  "Checkout availability",
);
const SEARCH_SLO: ServiceLevelObjective = buildSlo(
  SEARCH_SLO_ID,
  "Search latency p95",
);

function sloHref(id: string): string {
  return `/dashboard/${PROJECT_ID}/slos/${id}`;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
});

describe("AffectedResourcesDisplay with SLOs", () => {
  test("a burn-rate incident linked only to its SLO is not 'No resources affected.'", () => {
    render(
      <AffectedResourcesDisplay
        serviceLevelObjectives={[CHECKOUT_SLO]}
        columns={1}
      />,
    );

    expect(screen.queryByText("No resources affected.")).toBeNull();

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid.children).toHaveLength(1);
    expect(within(grid).getByText("SLOs")).toBeInTheDocument();
    expect(screen.getByText("1 resource")).toBeInTheDocument();
    expect(screen.getByText("across 1 category")).toBeInTheDocument();
  });

  test("each SLO links to its overview and carries its full name as a title", () => {
    render(
      <AffectedResourcesDisplay
        serviceLevelObjectives={[CHECKOUT_SLO, SEARCH_SLO]}
        columns={1}
      />,
    );

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "affected-resource-item",
    );

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("title");
      }),
    ).toEqual(["Checkout availability", "Search latency p95"]);
    expect(
      items.map((item: HTMLElement): string | null => {
        return within(item).getByRole("link").getAttribute("href");
      }),
    ).toEqual([sloHref(CHECKOUT_SLO_ID), sloHref(SEARCH_SLO_ID)]);
  });

  test("the SLO card counts its SLOs", () => {
    render(
      <AffectedResourcesDisplay
        serviceLevelObjectives={[CHECKOUT_SLO, SEARCH_SLO]}
        columns={1}
      />,
    );

    const card: HTMLElement = screen.getByTestId("affected-resources-grid")
      .firstElementChild as HTMLElement;

    expect(within(card).getByText("2")).toBeInTheDocument();
  });

  test("SLOs add to the summary and sit after the infrastructure they measure", () => {
    render(
      <AffectedResourcesDisplay
        services={[
          buildService("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "checkout-api"),
        ]}
        serviceLevelObjectives={[CHECKOUT_SLO, SEARCH_SLO]}
      />,
    );

    expect(screen.getByText("3 resources")).toBeInTheDocument();
    expect(screen.getByText("across 2 categories")).toBeInTheDocument();

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid.children).toHaveLength(2);
    expect(
      within(grid.lastElementChild as HTMLElement).getByText("SLOs"),
    ).toBeInTheDocument();
  });

  test("an alert page that hides monitors still shows the SLO", () => {
    render(
      <AffectedResourcesDisplay
        monitors={[
          buildMonitor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "checkout-web"),
        ]}
        serviceLevelObjectives={[CHECKOUT_SLO]}
        hideMonitors={true}
        columns={1}
      />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid.children).toHaveLength(1);
    expect(within(grid).queryByText("Monitors")).toBeNull();
    expect(within(grid).getByText("SLOs")).toBeInTheDocument();
  });

  test("a caller can hide the SLO category", () => {
    render(
      <AffectedResourcesDisplay
        serviceLevelObjectives={[CHECKOUT_SLO]}
        hideServiceLevelObjectives={true}
        columns={1}
      />,
    );

    expect(screen.getByText("No resources affected.")).toBeInTheDocument();
    expect(screen.queryByTestId("affected-resources-grid")).toBeNull();
  });

  test("the empty state explains that SLOs are linked for you, not attached by hand", () => {
    render(<AffectedResourcesDisplay columns={1} />);

    expect(
      screen.getByText(
        /SLOs are linked automatically when their burn rate rules fire\./,
      ),
    ).toBeInTheDocument();
  });

  test("an empty SLO list alone is still empty", () => {
    render(<AffectedResourcesDisplay serviceLevelObjectives={[]} />);

    expect(screen.getByText("No resources affected.")).toBeInTheDocument();
  });
});

describe("AffectedResourcesCell with SLOs", () => {
  test("an incident row linked only to its SLO shows the SLO, not 'No resources.'", () => {
    render(<AffectedResourcesCell serviceLevelObjectives={[CHECKOUT_SLO]} />);

    expect(screen.queryByText("No resources.")).toBeNull();

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute("href", sloHref(CHECKOUT_SLO_ID));
    expect(link).toHaveTextContent("Checkout availability");
  });

  test("the SLO row carries a type icon like every other resource row", () => {
    render(<AffectedResourcesCell serviceLevelObjectives={[CHECKOUT_SLO]} />);

    expect(screen.getByRole("link").querySelector("svg")).not.toBeNull();
  });

  test("SLOs are listed after the other resources", () => {
    render(
      <AffectedResourcesCell
        services={[
          buildService("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "checkout-api"),
        ]}
        serviceLevelObjectives={[CHECKOUT_SLO]}
      />,
    );

    const links: Array<HTMLElement> = screen.getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("checkout-api");
    expect(links[1]).toHaveAttribute("href", sloHref(CHECKOUT_SLO_ID));
  });

  test("past the first three resources an SLO waits behind the 'more resources' button", () => {
    render(
      <AffectedResourcesCell
        monitors={[
          buildMonitor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "checkout-web"),
          buildMonitor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "orders-db"),
        ]}
        serviceLevelObjectives={[CHECKOUT_SLO, SEARCH_SLO]}
      />,
    );

    expect(screen.queryByText("Search latency p95")).toBeNull();

    fireEvent.click(screen.getByText("1 more resources"));

    expect(screen.getByText("Search latency p95")).toBeInTheDocument();
  });

  test("an SLO without an id is named without a link", () => {
    const unsaved: ServiceLevelObjective = new ServiceLevelObjective();
    unsaved.name = "Unsaved objective";

    render(<AffectedResourcesCell serviceLevelObjectives={[unsaved]} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Unsaved objective")).toBeInTheDocument();
  });
});
