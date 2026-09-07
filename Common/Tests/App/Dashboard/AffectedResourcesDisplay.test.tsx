import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";
import AffectedResourcesDisplay from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Host from "../../../Models/DatabaseModels/Host";

function makeMonitor(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = name;
  return monitor;
}

function makeHost(name: string): Host {
  const host: Host = new Host();
  host.name = name;
  return host;
}

afterEach(() => {
  cleanup();
});

describe("AffectedResourcesDisplay overview sidebar", () => {
  test("keeps multiple resource categories in one column for a narrow details sidebar", () => {
    const { container } = render(
      <AffectedResourcesDisplay
        compact={true}
        monitors={[makeMonitor("Production API")]}
        hosts={[makeHost("Authentication database")]}
      />,
    );

    expect(screen.getByText("Monitors")).toBeInTheDocument();
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Production API")).toBeInTheDocument();
    expect(screen.getByText("Authentication database")).toBeInTheDocument();
    expect(screen.getByText("2 resources")).toBeInTheDocument();
    expect(screen.getByText("across 2 categories")).toBeInTheDocument();
    expect(container.querySelector(".grid")).toHaveClass("grid-cols-1");
    expect(container.querySelector(".grid")).not.toHaveClass("md:grid-cols-2");
  });

  test("preserves the existing two-column desktop layout outside compact sidebars", () => {
    const { container } = render(
      <AffectedResourcesDisplay
        monitors={[makeMonitor("Production API")]}
        hosts={[makeHost("Authentication database")]}
      />,
    );

    expect(container.querySelector(".grid")).toHaveClass("md:grid-cols-2");
    expect(screen.getAllByRole("list")).toHaveLength(2);
  });

  test("retains category filtering and accurate totals in compact mode", () => {
    render(
      <AffectedResourcesDisplay
        compact={true}
        hideMonitors={true}
        monitors={[makeMonitor("Production API")]}
        hosts={[makeHost("Authentication database")]}
      />,
    );

    expect(screen.queryByText("Monitors")).not.toBeInTheDocument();
    expect(screen.queryByText("Production API")).not.toBeInTheDocument();
    expect(screen.getByText("Authentication database")).toBeInTheDocument();
    expect(screen.getByText("1 resource")).toBeInTheDocument();
    expect(screen.getByText("across 1 category")).toBeInTheDocument();
  });

  test("allows responders to expand and collapse longer resource lists in compact mode", () => {
    render(
      <AffectedResourcesDisplay
        compact={true}
        monitors={Array.from({ length: 6 }, (_: unknown, index: number) => {
          return makeMonitor(`Production API ${index + 1}`);
        })}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("Production API 6")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more items" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("Production API 6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("6 resources")).toBeInTheDocument();
  });

  test("keeps the caller's empty-state guidance when no visible resources remain", () => {
    render(
      <AffectedResourcesDisplay
        compact={true}
        hideMonitors={true}
        monitors={[makeMonitor("Production API")]}
        emptyMessage="No maintenance resources selected yet."
      />,
    );

    expect(
      screen.getByText("No maintenance resources selected yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
