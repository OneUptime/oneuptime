import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";

/*
 * AffectedResourcesDisplay groups an event's resources into category cards.
 * Its grid used to follow the viewport alone (two columns from md up), so on
 * an overview page's ~300px sidebar two cards shared the width and every name
 * was clipped mid-word ("Checkout A"). Callers in a narrow column now ask for
 * one column, and a long name ends in an ellipsis with the full name on hover.
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
  getAffectedResourcesGridClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import AffectedResourcesCell from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesCell";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import Host from "../../../Models/DatabaseModels/Host";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Color from "../../../Types/Color";

const LONG_MONITOR_NAME: string =
  "Checkout API p95 latency above two seconds in eu-west-1";

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

const MONITORS: Array<Monitor> = [
  buildMonitor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", LONG_MONITOR_NAME),
  buildMonitor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "orders-db primary"),
];

const SERVICES: Array<Service> = [
  buildService("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "checkout-api"),
];

afterEach(() => {
  cleanup();
});

describe("getAffectedResourcesGridClassName", () => {
  test("follows the viewport by default: one column, two from md up", () => {
    expect(getAffectedResourcesGridClassName(undefined)).toBe(
      "grid grid-cols-1 gap-3 md:grid-cols-2",
    );
  });

  test("two columns is the same viewport-based grid", () => {
    expect(getAffectedResourcesGridClassName(2)).toBe(
      "grid grid-cols-1 gap-3 md:grid-cols-2",
    );
  });

  test("one column never splits, whatever the viewport", () => {
    const className: string = getAffectedResourcesGridClassName(1);

    expect(className).toBe("grid grid-cols-1 gap-3");
    expect(className).not.toContain("md:grid-cols-2");
  });
});

describe("AffectedResourcesDisplay columns", () => {
  test("renders today's two-column grid when columns is left out", () => {
    render(
      <AffectedResourcesDisplay monitors={MONITORS} services={SERVICES} />,
    );

    const grid: HTMLElement = screen.getByTestId("affected-resources-grid");

    expect(grid).toHaveClass("grid", "grid-cols-1", "gap-3", "md:grid-cols-2");
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

    expect(grid).toHaveClass("grid", "grid-cols-1", "gap-3");
    expect(grid).not.toHaveClass("md:grid-cols-2");
    // Both categories still render, one under the other.
    expect(within(grid).getByText("Monitors")).toBeInTheDocument();
    expect(within(grid).getByText("Services")).toBeInTheDocument();
  });

  test("keeps the summary counts in either layout", () => {
    const { rerender } = render(
      <AffectedResourcesDisplay monitors={MONITORS} services={SERVICES} />,
    );

    expect(screen.getByText("3 resources")).toBeInTheDocument();
    expect(screen.getByText("across 2 categories")).toBeInTheDocument();
    expect(screen.getByText("·")).toBeInTheDocument();

    rerender(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        services={SERVICES}
        columns={1}
      />,
    );

    expect(screen.getByText("3 resources")).toBeInTheDocument();
    expect(screen.getByText("across 2 categories")).toBeInTheDocument();
    // The separator would dangle at the end of a wrapped first line.
    expect(screen.queryByText("·")).toBeNull();
  });

  test("the empty state does not depend on columns", () => {
    render(
      <AffectedResourcesDisplay columns={1} emptyMessage="Nothing hit." />,
    );

    expect(screen.getByText("Nothing hit.")).toBeInTheDocument();
    expect(screen.queryByTestId("affected-resources-grid")).toBeNull();
  });
});

describe("AffectedResourcesDisplay item names", () => {
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
      "flex-1",
      "truncate",
      "[&_span.flex]:block",
      "[&_span.flex]:truncate",
    );

    // The monitor element really does wrap its name in a flex span.
    const link: HTMLElement = within(item).getByRole("link");
    const nameSpan: Element | null = link.querySelector("span.flex");

    expect(nameSpan).not.toBeNull();
    expect(nameSpan).toHaveTextContent(LONG_MONITOR_NAME);
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
    );
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

  test("the category label and count cannot push each other out of the card", () => {
    render(<AffectedResourcesDisplay monitors={MONITORS} columns={1} />);

    const label: HTMLElement = screen.getByText("Monitors");
    const count: HTMLElement = screen.getByText("2");

    expect(label).toHaveClass("truncate");
    expect(label.parentElement).toHaveClass("min-w-0");
    expect(count).toHaveClass("flex-shrink-0");
  });
});

describe("AffectedResourcesDisplay databases", () => {
  const DATABASE_ID: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

  const buildDatabase: (id: string, name: string) => DatabaseServer = (
    id: string,
    name: string,
  ): DatabaseServer => {
    const database: DatabaseServer = new DatabaseServer();
    database._id = id;
    database.name = name;
    return database;
  };

  test("attached databases get their own card, counted with the rest", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        databaseServers={[
          buildDatabase(DATABASE_ID, "PostgreSQL db.prod:5432"),
          buildDatabase(
            "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
            "Redis cache.prod:6379",
          ),
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
    expect(screen.getByText("1 resource")).toBeInTheDocument();
    expect(screen.getByText("across 1 category")).toBeInTheDocument();
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

  test("hideDatabaseServers drops the card", () => {
    render(
      <AffectedResourcesDisplay
        monitors={MONITORS}
        databaseServers={[buildDatabase(DATABASE_ID, "MySQL orders:3306")]}
        hideDatabaseServers={true}
      />,
    );

    expect(screen.queryByText("Databases")).toBeNull();
    expect(screen.queryByText("MySQL orders:3306")).toBeNull();
    expect(screen.getByText("2 resources")).toBeInTheDocument();
  });
});
