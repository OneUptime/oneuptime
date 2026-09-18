import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import NetworkTopologyToolbar, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyToolbar";
import { ALL_NODE_KINDS } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  buildHealthFilterOptions,
  TopologyHealthSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyHealthFilter";

const HEALTH: TopologyHealthSummary = {
  total: 12,
  healthy: 8,
  down: 2,
  degraded: 1,
  unknown: 1,
  attention: 3,
};

function toolbarProps(overrides: Partial<ComponentProps> = {}): ComponentProps {
  return {
    searchText: "",
    onSearchChange: jest.fn(),
    layoutMode: "force",
    onLayoutChange: jest.fn(),
    availableKinds: ALL_NODE_KINDS,
    visibleKinds: ALL_NODE_KINDS,
    onKindToggle: jest.fn(),
    vlanOptions: [
      { label: "All VLANs", value: "all" },
      { label: "VLAN 20", value: "20" },
    ],
    selectedVlan: "all",
    onVlanChange: jest.fn(),
    healthSummary: HEALTH,
    healthFilterMode: "all",
    healthChipOptions: buildHealthFilterOptions(HEALTH),
    healthFilterMatchCount: 12,
    onHealthChange: jest.fn(),
    onResetFilters: jest.fn(),
    ...overrides,
  };
}

function openOptions(): void {
  fireEvent.click(screen.getByRole("button", { name: /Map options/ }));
}

describe("network map controls", () => {
  afterEach(cleanup);

  test("starts with search and health filters while advanced options are closed", () => {
    render(<NetworkTopologyToolbar {...toolbarProps()} />);
    expect(
      screen.getByRole("textbox", { name: "Find a network device" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Filter by device health" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Map options/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("group", { name: "Topology layout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  test("the disclosure is accessible and can be closed again", () => {
    render(<NetworkTopologyToolbar {...toolbarProps()} />);
    openOptions();
    const toggle: HTMLElement = screen.getByRole("button", {
      name: /Map options/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("network-topology-options")).toHaveAttribute(
      "id",
      toggle.getAttribute("aria-controls"),
    );
    expect(
      screen.getByRole("group", { name: "Topology layout" }),
    ).toBeVisible();
    fireEvent.click(toggle);
    expect(
      screen.queryByTestId("network-topology-options"),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["Automatic", "force"],
    ["By network layer", "tiered"],
    ["Concentric", "radial"],
    ["Hub and spoke", "star"],
    ["Parent and child", "parentChild"],
  ])("keeps the %s arrangement available", (label: string, mode: string) => {
    const props: ComponentProps = toolbarProps();
    render(<NetworkTopologyToolbar {...props} />);
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(props.onLayoutChange).toHaveBeenCalledWith(mode);
  });

  test("explains the selected layout and reports it as selected", () => {
    render(
      <NetworkTopologyToolbar {...toolbarProps({ layoutMode: "tiered" })} />,
    );
    openOptions();
    expect(
      screen.getByRole("button", { name: "By network layer" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Automatic" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByText(/Places core, distribution and access devices in rows/),
    ).toBeVisible();
  });

  test("only offers node kinds present in this network", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({ availableKinds: new Set(["device"]) })}
      />,
    );
    openOptions();
    const kinds: HTMLElement = screen.getByRole("group", {
      name: "Node types",
    });
    expect(
      within(kinds).getByRole("button", { name: "Monitored devices" }),
    ).toBeVisible();
    expect(
      within(kinds).queryByRole("button", { name: "Endpoints" }),
    ).not.toBeInTheDocument();
    expect(
      within(kinds).queryByRole("button", { name: "Discovered neighbors" }),
    ).not.toBeInTheDocument();
  });

  test("can hide and restore discovered neighbors", () => {
    const props: ComponentProps = toolbarProps({
      visibleKinds: new Set(["device", "endpoint"]),
    });
    render(<NetworkTopologyToolbar {...props} />);
    openOptions();
    const neighbors: HTMLElement = screen.getByRole("button", {
      name: "Discovered neighbors",
    });
    expect(neighbors).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(neighbors);
    expect(props.onKindToggle).toHaveBeenCalledWith("unmanaged");
  });

  test("indicates hidden filters even while Map options is closed", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          visibleKinds: new Set(["device"]),
          selectedVlan: "20",
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Map options/ }),
    ).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeVisible();
    expect(
      screen.queryByTestId("network-topology-options"),
    ).not.toBeInTheDocument();
  });

  test("does not claim a type filter is active for a kind absent from the payload", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          availableKinds: new Set(["device"]),
          visibleKinds: new Set(["device"]),
        })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  test("does not offer a VLAN selector when none were discovered", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          vlanOptions: [{ label: "All VLANs", value: "all" }],
        })}
      />,
    );
    openOptions();
    expect(
      screen.queryByTestId("network-topology-vlan-filter"),
    ).not.toBeInTheDocument();
  });

  test("explains the endpoint-only scope of the VLAN selector", () => {
    render(<NetworkTopologyToolbar {...toolbarProps()} />);
    openOptions();
    expect(screen.getByTestId("network-topology-vlan-filter")).toBeVisible();
    expect(
      screen.getByText(
        "Filters endpoints. Network devices stay visible for context.",
      ),
    ).toBeVisible();
  });

  test("search reports input to the live map", () => {
    const props: ComponentProps = toolbarProps();
    render(<NetworkTopologyToolbar {...props} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a network device" }),
      { target: { value: "branch router" } },
    );
    expect(props.onSearchChange).toHaveBeenCalledWith("branch router");
  });

  test("selecting a health filter reports the intended mode", () => {
    const props: ComponentProps = toolbarProps();
    render(<NetworkTopologyToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(props.onHealthChange).toHaveBeenCalledWith("attention");
  });

  test("announces exact health matches without mislabeling degraded devices as down", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          healthFilterMode: "down",
          healthFilterMatchCount: 2,
        })}
      />,
    );
    const hint: HTMLElement = screen.getByTestId(
      "network-topology-health-filter-hint",
    );
    expect(hint).toHaveAttribute("role", "status");
    expect(hint).toHaveTextContent("2 of 12 match this health filter.");
    expect(hint).toHaveTextContent(
      "Connected neighbors stay dimmed for context.",
    );
  });

  test.each([
    { searchText: "router" },
    { selectedVlan: "20" },
    { healthFilterMode: "down" as const },
    { visibleKinds: new Set<"device">(["device"]) },
  ])(
    "offers a single reset for any active filter",
    (overrides: Partial<ComponentProps>) => {
      const props: ComponentProps = toolbarProps(overrides);
      render(<NetworkTopologyToolbar {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(props.onResetFilters).toHaveBeenCalledTimes(1);
      expect(props.onLayoutChange).not.toHaveBeenCalled();
    },
  );
});
