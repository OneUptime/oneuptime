import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * AffectedResourcesDisplay is the body of the "Affected Resources" card on
 * the incident, alert and scheduled maintenance overview pages (and of the
 * templates' cards). It groups an event's resources by category.
 *
 * Each category used to be a card of its own - bordered, shadowed, rounded,
 * with a coloured bar across its top - so the page's card read as a stack of
 * cards nested inside a card. The categories are now flat sections of the one
 * card: a small tinted icon, the label and its count, then the resources
 * indented under the label, split by hairlines like the details card's rows.
 *
 * Its grid used to follow the viewport alone (two columns from md up), so on
 * an overview page's ~300px sidebar two categories shared the width and every
 * name was clipped mid-word ("Checkout A"). Callers in a narrow column ask
 * for one column, and a long name ends in an ellipsis with the full name on
 * hover.
 *
 * Browser-level checks (computed styles, the stretched link, hover, focus,
 * dark mode) live in packages/E2E/EventOverview.
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

import AffectedResourcesDisplay, {
  AFFECTED_RESOURCE_ITEM_CLASS_NAME,
  getAffectedResourcesGridClassName,
  getAffectedResourcesSectionClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import AffectedResourcesCell from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesCell";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Color from "../../../Types/Color";

const LONG_MONITOR_NAME: string =
  "Checkout API p95 latency above two seconds in eu-west-1";

interface NamedModel {
  _id?: string | undefined;
  name?: string | undefined;
}

type NamedFunction = <T extends NamedModel>(
  type: new () => T,
  id: string,
  name: string,
) => T;

const named: NamedFunction = <T extends NamedModel>(
  type: new () => T,
  id: string,
  name: string,
): T => {
  const model: T = new type();
  model._id = id;
  model.name = name;
  return model;
};

type IdFunction = (hex: string, n: number) => string;

// A valid UUID per model and index: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001".
const id: IdFunction = (hex: string, n: number): string => {
  const block: string = hex.repeat(8);

  return `${block}-${hex.repeat(4)}-4${hex.repeat(3)}-8${hex.repeat(3)}-${String(n).padStart(12, "0")}`;
};

type BuildMonitorFunction = (n: number, name: string) => Monitor;

const buildMonitor: BuildMonitorFunction = (
  n: number,
  name: string,
): Monitor => {
  return named(Monitor, id("a", n), name);
};

type BuildMonitorsFunction = (count: number) => Array<Monitor>;

const buildMonitors: BuildMonitorsFunction = (
  count: number,
): Array<Monitor> => {
  return Array.from({ length: count }, (_: unknown, i: number): Monitor => {
    return buildMonitor(i + 1, `probe-${String(i + 1).padStart(3, "0")}`);
  });
};

type BuildServiceFunction = (n: number, name: string) => Service;

const buildService: BuildServiceFunction = (
  n: number,
  name: string,
): Service => {
  const service: Service = named(Service, id("b", n), name);
  service.serviceColor = new Color("#6366f1");
  return service;
};

const MONITORS: Array<Monitor> = [
  buildMonitor(1, LONG_MONITOR_NAME),
  buildMonitor(2, "orders-db primary"),
];

const SERVICES: Array<Service> = [buildService(1, "checkout-api")];

afterEach(() => {
  cleanup();
});

/*
 * Every class token on an element and its descendants: what the stylesheet
 * can paint on this display, whatever the markup nests.
 */
function classTokensWithin(element: Element): Array<string> {
  return [element, ...Array.from(element.querySelectorAll("*"))].flatMap(
    (node: Element): Array<string> => {
      return Array.from(node.classList);
    },
  );
}

/*
 * What made a category a card: a border (other than the grid's hairlines,
 * which are divide-* on the grid), a shadow, a white fill of its own, card
 * rounding, a ring, clipping, and the coloured bar across its top.
 */
const BORDER_OR_SHADOW: RegExp = /^(hover:)?(border|shadow)(-|$)/;
const RING: RegExp = /^ring(-|$)/;
const CARD_ROUNDING: RegExp = /^rounded-(lg|xl|2xl|3xl)$/;

function cardChromeIn(element: Element): Array<string> {
  return classTokensWithin(element).filter((token: string): boolean => {
    return (
      BORDER_OR_SHADOW.test(token) ||
      RING.test(token) ||
      token === "bg-white" ||
      token === "overflow-hidden" ||
      CARD_ROUNDING.test(token) ||
      token === "h-1"
    );
  });
}

type SectionsFunction = () => Array<HTMLElement>;

const sections: SectionsFunction = (): Array<HTMLElement> => {
  return screen.getAllByTestId("affected-resource-category");
};

type HeadingNamesFunction = () => Array<string>;

// The category headings, as a screen reader names them: label, then count.
const headingNames: HeadingNamesFunction = (): Array<string> => {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return (heading.textContent || "").replace(/\s+/g, " ").trim();
    });
};

describe("getAffectedResourcesGridClassName", () => {
  test("one column stacks the sections, split by hairlines", () => {
    expect(getAffectedResourcesGridClassName(1)).toBe(
      "grid grid-cols-1 divide-y divide-gray-100",
    );
  });

  test("by default the sections sit two abreast from md up, spaced instead of divided", () => {
    const className: string = getAffectedResourcesGridClassName(undefined);

    expect(className).toBe(
      "grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:gap-x-10 md:gap-y-6 md:divide-y-0",
    );
    // Phones still get one divided column.
    expect(className.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-1", "divide-y", "divide-gray-100"]),
    );
  });

  test("two columns is the same viewport-based grid", () => {
    expect(getAffectedResourcesGridClassName(2)).toBe(
      getAffectedResourcesGridClassName(undefined),
    );
  });

  test("one column never splits, whatever the viewport", () => {
    const className: string = getAffectedResourcesGridClassName(1);

    expect(className).not.toContain("md:grid-cols-2");
    expect(className).not.toContain("md:divide-y-0");
  });

  test("no layout spaces the sections with a gap between cards", () => {
    for (const columns of [1, 2, undefined] as const) {
      expect(getAffectedResourcesGridClassName(columns).split(" ")).not.toEqual(
        expect.arrayContaining(["gap-3"]),
      );
    }
  });
});

describe("getAffectedResourcesSectionClassName", () => {
  test("in one column a section is padded between hairlines, flush at both ends", () => {
    expect(getAffectedResourcesSectionClassName(1)).toBe(
      "min-w-0 py-4 first:pt-0 last:pb-0",
    );
  });

  test("side by side the padding goes, since whitespace separates the sections", () => {
    expect(getAffectedResourcesSectionClassName(undefined)).toBe(
      "min-w-0 py-4 first:pt-0 last:pb-0 md:py-0",
    );
    expect(getAffectedResourcesSectionClassName(2)).toBe(
      getAffectedResourcesSectionClassName(undefined),
    );
  });

  test("the grid and its sections agree on the layout", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    for (const section of sections()) {
      expect(section.className).toBe(getAffectedResourcesSectionClassName(1));
    }

    cleanup();
    render(
      <AffectedResourcesDisplay monitors={MONITORS} services={SERVICES} />,
    );

    for (const section of sections()) {
      expect(section.className).toBe(
        getAffectedResourcesSectionClassName(undefined),
      );
    }
  });
});

describe("AffectedResourcesDisplay: sections of one card, not cards in a card", () => {
  const EVERY_CATEGORY: Array<ReactElement> = [
    <AffectedResourcesDisplay
      key="sidebar"
      monitors={buildMonitors(7)}
      hosts={[named(Host, id("c", 1), "web-01")]}
      services={SERVICES}
      serviceLevelObjectives={[
        named(ServiceLevelObjective, id("d", 1), "Checkout availability"),
      ]}
      columns={1}
    />,
    <AffectedResourcesDisplay
      key="full-width"
      monitors={buildMonitors(7)}
      hosts={[named(Host, id("c", 1), "web-01")]}
      services={SERVICES}
    />,
  ];

  test.each([
    ["the sidebar layout", 0],
    ["the full-width layout", 1],
  ])(
    "no category in %s carries a border, shadow, fill, card rounding or accent bar",
    (_layout: string, index: number) => {
      const { container } = render(EVERY_CATEGORY[index]!);

      expect(sections().length).toBeGreaterThan(1);
      expect(cardChromeIn(container)).toEqual([]);
    },
  );

  test("a category is a plain section: its own classes are only layout", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    for (const section of sections()) {
      expect(section.className.split(" ")).toEqual([
        "min-w-0",
        "py-4",
        "first:pt-0",
        "last:pb-0",
      ]);
    }
  });

  test("the sections are split by the grid's hairlines, not spaced apart as tiles", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid).toHaveClass("divide-y", "divide-gray-100");
    expect(grid).not.toHaveClass("gap-3");
    expect(Array.from(grid.children)).toEqual(sections());
  });

  test("expanding a category and hitting the cap adds no box either", () => {
    const { container } = render(
      <AffectedResourcesDisplay monitors={buildMonitors(130)} columns={1} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show 96 more" }));

    expect(
      screen.getByTestId("affected-resource-truncated-note"),
    ).toBeInTheDocument();
    expect(cardChromeIn(container)).toEqual([]);
    // The note is tinted text, not a tinted banner.
    expect(
      classTokensWithin(screen.getByTestId("affected-resource-truncated-note")),
    ).not.toEqual(expect.arrayContaining(["bg-amber-50"]));
  });

  test("the empty state is open text inside the card, not a dashed box", () => {
    const { container } = render(<AffectedResourcesDisplay columns={1} />);

    expect(screen.getByTestId("affected-resources-empty")).toBeInTheDocument();
    expect(cardChromeIn(container)).toEqual([]);
    expect(classTokensWithin(container)).not.toEqual(
      expect.arrayContaining(["border-dashed"]),
    );
    expect(classTokensWithin(container)).not.toEqual(
      expect.arrayContaining(["bg-gray-50/50"]),
    );
  });
});

describe("AffectedResourcesDisplay: category headings", () => {
  const ALL_CATEGORIES: ReactElement = (
    <AffectedResourcesDisplay
      monitors={[buildMonitor(1, "api.acme.com")]}
      hosts={[named(Host, id("c", 1), "web-01")]}
      kubernetesClusters={[
        named(KubernetesCluster, id("e", 1), "prod-eks-eu-west-1"),
      ]}
      dockerHosts={[named(DockerHost, id("f", 1), "docker-edge-01")]}
      podmanHosts={[named(PodmanHost, id("1", 1), "podman-01")]}
      proxmoxClusters={[named(ProxmoxCluster, id("2", 1), "pve-lab")]}
      vmwareVCenters={[named(VMwareVCenter, id("3", 1), "vcenter-01")]}
      cephClusters={[named(CephCluster, id("4", 1), "ceph-prod")]}
      dockerSwarmClusters={[named(DockerSwarmCluster, id("5", 1), "swarm-1")]}
      iotFleets={[named(IoTFleet, id("6", 1), "sensors-eu")]}
      databaseServers={[
        named(DatabaseServer, id("7", 1), "PostgreSQL db.prod:5432"),
      ]}
      networkSites={[named(NetworkSite, id("9", 1), "Frankfurt DC")]}
      services={[buildService(1, "checkout-api"), buildService(2, "payments")]}
      serviceLevelObjectives={[
        named(ServiceLevelObjective, id("d", 1), "Checkout availability"),
      ]}
      columns={1}
    />
  );

  /*
   * Label, then the icon tile's tint and the icon's colour. Each pair has a
   * dark-mode remap in Theme.css (see AffectedResourcesDisplayDarkMode in the
   * App tests).
   */
  const CATEGORIES: Array<[string, string, string]> = [
    ["Monitors", "bg-blue-50", "text-blue-600"],
    ["Hosts", "bg-emerald-50", "text-emerald-600"],
    ["Kubernetes Clusters", "bg-indigo-50", "text-indigo-600"],
    ["Docker Hosts", "bg-sky-50", "text-sky-600"],
    ["Podman Hosts", "bg-violet-50", "text-violet-600"],
    ["Proxmox Clusters", "bg-orange-50", "text-orange-600"],
    ["vCenters", "bg-sky-50", "text-sky-600"],
    ["Ceph Clusters", "bg-rose-50", "text-rose-600"],
    ["Docker Swarm Clusters", "bg-cyan-50", "text-cyan-600"],
    ["IoT Fleets", "bg-teal-50", "text-teal-600"],
    ["Databases", "bg-purple-50", "text-purple-600"],
    ["Network Sites", "bg-indigo-50", "text-indigo-600"],
    ["Services", "bg-amber-50", "text-amber-600"],
    ["SLOs", "bg-fuchsia-50", "text-fuchsia-600"],
  ];

  test("every category is a level-3 heading naming its label and count, in a fixed order", () => {
    render(ALL_CATEGORIES);

    expect(headingNames()).toEqual(
      CATEGORIES.map(([label]: [string, string, string]): string => {
        return label === "Services" ? `${label} 2` : `${label} 1`;
      }),
    );
  });

  test.each(CATEGORIES)(
    "%s has its own tinted icon tile beside the label",
    (label: string, tint: string, iconColour: string) => {
      render(ALL_CATEGORIES);

      const section: HTMLElement = sections().find(
        (candidate: HTMLElement): boolean => {
          return (
            within(candidate).getByRole("heading", { level: 3 })
              .firstElementChild?.textContent === label
          );
        },
      )!;
      const tile: HTMLElement = section.firstElementChild!
        .firstElementChild as HTMLElement;

      expect(tile).toHaveClass(
        "flex",
        "h-6",
        "w-6",
        "shrink-0",
        "items-center",
        "justify-center",
        "rounded-md",
        tint,
      );
      expect(tile.querySelector("svg")).toHaveClass(
        "h-3.5",
        "w-3.5",
        iconColour,
      );
      // The tile is not part of the heading: an icon is no part of the name.
      expect(
        within(section).getByRole("heading", { level: 3 }),
      ).not.toContainElement(tile);
    },
  );

  test("each list is named by its heading, so the count is read before the items", () => {
    render(
      <AffectedResourcesDisplay
        monitors={buildMonitors(7)}
        services={SERVICES}
        columns={1}
      />,
    );

    const monitors: HTMLElement = screen.getByRole("list", {
      name: "Monitors 7",
    });
    const services: HTMLElement = screen.getByRole("list", {
      name: "Services 1",
    });

    expect(within(monitors).getAllByRole("listitem")).toHaveLength(4);
    expect(within(services).getAllByRole("listitem")).toHaveLength(1);
  });

  test("the count covers every item, including those behind Show more", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(12)} />);

    expect(
      screen.getByTestId("affected-resource-category-count"),
    ).toHaveTextContent(/^12$/);
    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(4);
  });

  test("a four-digit count is grouped the way the locale groups it", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(1200)} />);

    expect(
      screen.getByTestId("affected-resource-category-count"),
    ).toHaveTextContent((1200).toLocaleString());
  });

  test("the label can truncate but the count never shrinks, and it sits right after the label", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });
    const label: HTMLElement = within(heading).getByText("Monitors");
    const count: HTMLElement = within(heading).getByText("2");

    expect(heading).toHaveClass("flex", "min-w-0", "flex-1", "items-center");
    expect(label).toHaveClass("min-w-0", "truncate");
    // Not pushed to the far edge: in a wide card that parted it from its label.
    expect(label).not.toHaveClass("flex-1");
    expect(count).toHaveClass("shrink-0", "rounded-full", "tabular-nums");
    expect(label.nextElementSibling).toBe(count);
  });

  test("the resources are indented under the label, past the icon tile", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    // The tile is h-6 w-6 and the header row has gap-2: 24px + 8px = pl-8.
    expect(screen.getByRole("list")).toHaveClass("pl-8");
    expect(screen.getByRole("heading", { level: 3 }).parentElement).toHaveClass(
      "flex",
      "items-center",
      "gap-2",
    );
  });

  test("hidden categories are left out of the headings", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        hideMonitors={true}
        columns={1}
      />,
    );

    expect(headingNames()).toEqual(["Services 1"]);
  });
});

describe("AffectedResourcesDisplay: summary", () => {
  test("two or more categories add up to one line above them", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    const summary: HTMLElement = screen.getByTestId(
      "affected-resources-summary",
    );

    expect(summary).toHaveTextContent("3 resources across 2 categories");
    // The total is the emphasised part.
    expect(within(summary).getByText("3 resources")).toHaveClass(
      "font-semibold",
      "text-gray-900",
    );
    expect(screen.getByText("across 2 categories")).toBe(summary);
    expect(summary.nextElementSibling).toBe(
      screen.getByTestId("affected-resources-grid"),
    );
  });

  test("a single category counts itself in its heading, so there is no summary", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    expect(screen.queryByTestId("affected-resources-summary")).toBeNull();
    expect(screen.queryByText(/across/)).toBeNull();
    expect(headingNames()).toEqual(["Monitors 2"]);
  });

  test("the summary reads the same in either layout, with no separator to dangle", () => {
    const { rerender } = render(
      <AffectedResourcesDisplay monitors={MONITORS} services={SERVICES} />,
    );

    expect(screen.getByTestId("affected-resources-summary")).toHaveTextContent(
      "3 resources across 2 categories",
    );
    expect(screen.queryByText("·")).toBeNull();

    rerender(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    expect(screen.getByTestId("affected-resources-summary")).toHaveTextContent(
      "3 resources across 2 categories",
    );
    expect(screen.queryByText("·")).toBeNull();
  });

  test("a hidden category is not added up", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        hosts={[named(Host, id("c", 1), "web-01")]}
        hideHosts={true}
      />,
    );

    expect(screen.getByTestId("affected-resources-summary")).toHaveTextContent(
      "3 resources across 2 categories",
    );
  });

  test("large totals are grouped the way the locale groups them", () => {
    render(
      <AffectedResourcesDisplay
        monitors={buildMonitors(1500)}
        services={SERVICES}
      />,
    );

    expect(screen.getByTestId("affected-resources-summary")).toHaveTextContent(
      `${(1501).toLocaleString()} resources across 2 categories`,
    );
  });
});

describe("AffectedResourcesDisplay: rows", () => {
  test("every item carries its full name as a title", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "affected-resource-item",
    );

    expect(
      items.map((item: HTMLElement) => {
        return item.getAttribute("title");
      }),
    ).toEqual([LONG_MONITOR_NAME, "orders-db primary", "checkout-api"]);
  });

  test("the item wrapper truncates, and turns the elements' flex name spans into truncating blocks", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    const item: HTMLElement = screen.getByTitle(LONG_MONITOR_NAME);

    expect(item).toHaveClass(
      "min-w-0",
      "truncate",
      "[&_span.flex]:block",
      "[&_span.flex]:truncate",
    );

    // The monitor element really does wrap its name in a flex span.
    const link: HTMLElement = within(item).getByRole("link");
    const nameSpan: Element | null = link.querySelector("span.flex");

    expect(nameSpan).not.toBeNull();
    expect(nameSpan).toHaveTextContent(LONG_MONITOR_NAME);
    expect(link).toHaveAttribute("href", expect.stringContaining(id("a", 1)));
  });

  test("the link is stretched over its whole row, so the row that highlights is the row that opens", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    const item: HTMLElement = screen.getByTitle(LONG_MONITOR_NAME);
    const row: HTMLElement = item.closest("li")!;

    expect(item.className).toBe(AFFECTED_RESOURCE_ITEM_CLASS_NAME);
    expect(item).toHaveClass(
      "[&_a]:after:absolute",
      "[&_a]:after:inset-0",
      "[&_a]:after:rounded-md",
    );
    // The row is what the link's ::after fills: positioned, and hoverable.
    expect(row).toHaveClass("relative", "rounded-md", "hover:bg-gray-50");
    /*
     * Nothing between the row and the link may be positioned, or the ::after
     * would fill that element instead of the row.
     */
    let node: HTMLElement | null = within(item).getByRole("link");
    while (node && node !== row) {
      expect(node.className.split(" ")).not.toEqual(
        expect.arrayContaining(["relative"]),
      );
      node = node.parentElement;
    }
    // One link per row: the stretched one.
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  test("keyboard focus draws a ring around the row, not a clipped outline round the name", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    expect(screen.getByTitle(LONG_MONITOR_NAME)).toHaveClass(
      "[&_a:focus-visible]:outline-none",
      "[&_a:focus-visible]:after:ring-2",
      "[&_a:focus-visible]:after:ring-indigo-500",
    );
  });

  /*
   * Tailwind v3 applies stacked variants right to left, so
   * "[&_a]:focus-visible:x" would style an <a> inside a focused wrapper,
   * which never happens. The focused link has to be in the arbitrary variant.
   */
  test("no class stacks a pseudo-class after the descendant variant", () => {
    for (const token of AFFECTED_RESOURCE_ITEM_CLASS_NAME.split(" ")) {
      expect(token).not.toMatch(/^\[&_a\]:(focus|hover|active)/);
    }
  });

  test("the row's hover sits flush with the dividers on the right", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    const row: HTMLElement = screen
      .getByTitle(LONG_MONITOR_NAME)
      .closest("li")!;

    // Pulled left by its own padding so the name lines up with the label...
    expect(row).toHaveClass("-ml-2", "px-2");
    // ...but not past the right edge, where the dividers and counts end.
    expect(row).not.toHaveClass("-mx-2");
    expect(row).not.toHaveClass("-mr-2");
  });

  test("the old chevron is gone: the whole row says it is a link", () => {
    const { container } = render(
      <AffectedResourcesDisplay monitors={MONITORS} columns={1} />,
    );

    for (const row of Array.from(container.querySelectorAll("li"))) {
      // Only the element inside the link draws anything.
      expect(row.children).toHaveLength(1);
      expect(row.firstElementChild).toHaveAttribute(
        "data-testid",
        "affected-resource-item",
      );
    }
  });

  test("a service name truncates beside its colour swatch", () => {
    render(<AffectedResourcesDisplay services={SERVICES} columns={1} />);

    const name: HTMLElement = screen.getByText("checkout-api");

    expect(name).toHaveClass("min-w-0", "truncate");
    expect(screen.getByTitle("checkout-api")).toContainElement(name);
  });

  test("a resource with no name gets no empty title", () => {
    const hosts: Array<Host> = [new Host()];

    render(<AffectedResourcesDisplay hosts={hosts} columns={1} />);

    expect(screen.getByTestId("affected-resource-item")).not.toHaveAttribute(
      "title",
    );
  });

  test("a resource without an id is named without a link, so there is nothing to stretch", () => {
    const unsaved: Host = new Host();
    unsaved.name = "Unsaved host";

    render(<AffectedResourcesDisplay hosts={[unsaved]} columns={1} />);

    const item: HTMLElement = screen.getByTitle("Unsaved host");

    expect(within(item).queryByRole("link")).toBeNull();
    expect(item).toHaveTextContent("Unsaved host");
  });
});

describe("AffectedResourcesDisplay: Show more", () => {
  test("four resources fit without a toggle", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(4)} />);

    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(4);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a fifth resource waits behind 'Show 1 more'", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(5)} />);

    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "Show 1 more" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("probe-005")).toBeNull();
  });

  test("the toggle expands and collapses its list, and says so", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(7)} />);

    const list: HTMLElement = screen.getByRole("list", { name: "Monitors 7" });
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show 3 more",
    });

    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", list.id);
    expect(list.id).not.toBe("");

    fireEvent.click(toggle);

    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("probe-007")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Show less");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("probe-007")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 3 more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("the toggle is a quiet inline control lined up with the names, not a footer bar", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(7)} />);

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show 3 more",
    });

    // ml-6 plus its own px-2 puts its text on the names' pl-8 line.
    expect(toggle).toHaveClass(
      "ml-6",
      "px-2",
      "inline-flex",
      "text-xs",
      "text-indigo-600",
    );
    expect(toggle).not.toHaveClass("w-full");
    expect(cardChromeIn(toggle)).toEqual([]);
  });

  test("each category keeps its own toggle", () => {
    render(
      <AffectedResourcesDisplay
        monitors={buildMonitors(6)}
        services={[1, 2, 3, 4, 5].map((n: number): Service => {
          return buildService(n, `service-${n}`);
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));

    expect(
      within(screen.getByRole("list", { name: "Monitors 6" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("list", { name: "Services 5" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Show 1 more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("past 100 rows the rest is counted in a note instead of rendered", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(130)} />);

    // The toggle offers only what it will render.
    fireEvent.click(screen.getByRole("button", { name: "Show 96 more" }));

    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(100);
    expect(screen.getByText("probe-100")).toBeInTheDocument();
    expect(screen.queryByText("probe-101")).toBeNull();

    const note: HTMLElement = screen.getByTestId(
      "affected-resource-truncated-note",
    );

    expect(note).toHaveTextContent(
      "Showing the first 100 of 130. 30 more attached — edit affected resources to manage the full list.",
    );
    // Lined up with the names, and a div: the icon renders a <div> of its own.
    expect(note.tagName).toBe("DIV");
    expect(note).toHaveClass("ml-8", "text-amber-700");
    // The count still covers every item.
    expect(
      screen.getByTestId("affected-resource-category-count"),
    ).toHaveTextContent(/^130$/);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(4);
    expect(screen.queryByTestId("affected-resource-truncated-note")).toBeNull();
  });

  test("exactly 100 rows expand fully with no note", () => {
    render(<AffectedResourcesDisplay monitors={buildMonitors(100)} />);

    fireEvent.click(screen.getByRole("button", { name: "Show 96 more" }));

    expect(screen.getAllByTestId("affected-resource-item")).toHaveLength(100);
    expect(screen.queryByTestId("affected-resource-truncated-note")).toBeNull();
  });
});

describe("AffectedResourcesDisplay: empty state", () => {
  test("says nothing is affected and how to attach resources", () => {
    render(<AffectedResourcesDisplay columns={1} />);

    const empty: HTMLElement = screen.getByTestId("affected-resources-empty");

    expect(within(empty).getByText("No resources affected.")).toHaveClass(
      "text-sm",
      "font-medium",
      "text-gray-900",
    );
    expect(empty).toHaveTextContent(
      "Attach monitors, hosts, clusters, or services to track which parts of your infrastructure are impacted.",
    );
    expect(screen.queryByTestId("affected-resources-grid")).toBeNull();
    expect(screen.queryByTestId("affected-resources-summary")).toBeNull();
  });

  test("a caller's own message replaces the default", () => {
    render(
      <AffectedResourcesDisplay columns={1} emptyMessage="Nothing hit." />,
    );

    expect(screen.getByText("Nothing hit.")).toBeInTheDocument();
    expect(screen.queryByText("No resources affected.")).toBeNull();
  });

  test("the empty state does not depend on columns", () => {
    render(
      <AffectedResourcesDisplay columns={1} emptyMessage="Nothing hit." />,
    );

    expect(screen.getByText("Nothing hit.")).toBeInTheDocument();
    expect(screen.queryByTestId("affected-resources-grid")).toBeNull();
  });

  test("its icon sits in a plain tinted circle, with no ring or shadow", () => {
    render(<AffectedResourcesDisplay columns={1} />);

    const circle: HTMLElement = screen.getByTestId("affected-resources-empty")
      .firstElementChild as HTMLElement;

    expect(circle.tagName).toBe("DIV");
    expect(circle).toHaveClass("rounded-full", "bg-gray-100");
    expect(circle).not.toHaveClass("bg-white", "shadow-sm", "ring-1");
  });

  test("only a caller that shows SLOs promises that burn rate rules link them", () => {
    const SLO_HINT: RegExp =
      /SLOs are linked automatically when their burn rate rules fire\./;

    // The incident and alert pages pass their SLOs, even an empty list.
    render(<AffectedResourcesDisplay serviceLevelObjectives={[]} />);
    expect(screen.getByText(SLO_HINT)).toBeInTheDocument();
    cleanup();

    // Scheduled maintenance and the templates never link an SLO.
    render(<AffectedResourcesDisplay monitors={[]} services={[]} />);
    expect(screen.queryByText(SLO_HINT)).toBeNull();
    cleanup();

    // Nor does a caller that hides them.
    render(
      <AffectedResourcesDisplay
        serviceLevelObjectives={[]}
        hideServiceLevelObjectives={true}
      />,
    );
    expect(screen.queryByText(SLO_HINT)).toBeNull();
  });

  test("resources a caller hides do not count, so everything hidden is empty", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        hideMonitors={true}
        hideServices={true}
      />,
    );

    expect(screen.getByText("No resources affected.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });
});

describe("AffectedResourcesDisplay columns", () => {
  test("renders today's two-column grid when columns is left out", () => {
    render(
      <AffectedResourcesDisplay monitors={MONITORS} services={SERVICES} />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid).toHaveClass("grid", "grid-cols-1", "md:grid-cols-2");
    expect(grid.children).toHaveLength(2);
  });

  test("renders one column for a narrow sidebar", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid).toHaveClass("grid", "grid-cols-1", "divide-y");
    expect(grid).not.toHaveClass("md:grid-cols-2");
    // Both categories still render, one under the other.
    expect(within(grid).getByText("Monitors")).toBeInTheDocument();
    expect(within(grid).getByText("Services")).toBeInTheDocument();
  });
});

describe("AffectedResourcesDisplay databases", () => {
  const DATABASE_ID: string = id("d", 9);

  const buildDatabase: (databaseId: string, name: string) => DatabaseServer = (
    databaseId: string,
    name: string,
  ): DatabaseServer => {
    return named(DatabaseServer, databaseId, name);
  };

  test("attached databases get their own section, counted with the rest", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        databaseServers={[
          buildDatabase(DATABASE_ID, "PostgreSQL db.prod:5432"),
          buildDatabase(id("d", 8), "Redis cache.prod:6379"),
        ]}
      />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");
    expect(within(grid).getByText("Databases")).toBeInTheDocument();
    expect(
      within(grid).getByText("PostgreSQL db.prod:5432"),
    ).toBeInTheDocument();
    expect(within(grid).getByText("Redis cache.prod:6379")).toBeInTheDocument();
    expect(screen.getByText("4 resources")).toBeInTheDocument();
    expect(screen.getByText("across 2 categories")).toBeInTheDocument();
  });

  test("a database links to its own page", () => {
    render(
      <AffectedResourcesDisplay
        databaseServers={[
          buildDatabase(DATABASE_ID, "PostgreSQL db.prod:5432"),
        ]}
      />,
    );

    const link: HTMLElement | null = screen
      .getByText("PostgreSQL db.prod:5432")
      .closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain(`/databases/${DATABASE_ID}`);
  });

  test("databases alone are not the empty state", () => {
    render(
      <AffectedResourcesDisplay
        databaseServers={[buildDatabase(DATABASE_ID, "MySQL orders:3306")]}
        emptyMessage="Nothing hit."
      />,
    );

    expect(screen.queryByText("Nothing hit.")).toBeNull();
    expect(headingNames()).toEqual(["Databases 1"]);
  });

  test("the table cell lists a database beside the other resources", () => {
    render(
      <AffectedResourcesCell
        services={SERVICES}
        databaseServers={[
          buildDatabase(DATABASE_ID, "PostgreSQL db.prod:5432"),
        ]}
      />,
    );

    expect(screen.getByText("checkout-api")).toBeInTheDocument();
    const database: HTMLElement = screen.getByText("PostgreSQL db.prod:5432");
    expect(database.closest("a")!.getAttribute("href")).toContain(
      `/databases/${DATABASE_ID}`,
    );
  });

  test("hideDatabaseServers drops the section", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        databaseServers={[buildDatabase(DATABASE_ID, "MySQL orders:3306")]}
        hideDatabaseServers={true}
      />,
    );

    expect(screen.queryByText("Databases")).toBeNull();
    expect(screen.queryByText("MySQL orders:3306")).toBeNull();
    expect(headingNames()).toEqual(["Monitors 2"]);
  });
});
