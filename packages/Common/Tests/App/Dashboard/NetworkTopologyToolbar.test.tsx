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
  DefaultLayoutControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyToolbar";
import { NETWORK_TOPOLOGY_LAYOUTS } from "../../../Types/NetworkDevice/NetworkTopologyLayout";
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

/*
 * Issue #5378: the layout a map opens on is the team's, not each reader's.
 * Every reader sees which layout that is; a Project Owner or Admin can make
 * the layout on screen everyone's default, or clear the project's default,
 * right where the layouts are chosen.
 */
describe("network map controls: the default layout", () => {
  afterEach(cleanup);

  function defaultLayout(
    overrides: Partial<DefaultLayoutControls> = {},
  ): DefaultLayoutControls {
    return {
      layoutMode: "tiered",
      isSetByProject: false,
      canChange: true,
      isSaving: false,
      error: "",
      onMakeDefault: jest.fn(),
      onClear: jest.fn(),
      ...overrides,
    };
  }

  function layoutButtons(): Array<HTMLElement> {
    return within(
      screen.getByRole("group", { name: "Topology layout" }),
    ).getAllByRole("button");
  }

  function defaultTags(): Array<HTMLElement> {
    return screen.queryAllByTestId("network-topology-layout-default-tag");
  }

  test("offers a button for every layout a project can choose, in order", () => {
    render(<NetworkTopologyToolbar {...toolbarProps()} />);
    openOptions();
    expect(
      layoutButtons().map((button: HTMLElement): string => {
        return (button.getAttribute("data-testid") || "").replace(
          "network-topology-layout-mode-",
          "",
        );
      }),
    ).toEqual([...NETWORK_TOPOLOGY_LAYOUTS]);
  });

  test("a map with no default to show tags no layout and offers no controls", () => {
    render(<NetworkTopologyToolbar {...toolbarProps()} />);
    openOptions();
    expect(defaultTags()).toHaveLength(0);
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-clear-default"),
    ).not.toBeInTheDocument();
  });

  test.each([...NETWORK_TOPOLOGY_LAYOUTS])(
    "tags %s, and only it, as the default",
    (mode: string) => {
      render(
        <NetworkTopologyToolbar
          {...toolbarProps({
            layoutMode: "force",
            defaultLayout: defaultLayout({
              layoutMode: mode as DefaultLayoutControls["layoutMode"],
              canChange: false,
            }),
          })}
        />,
      );
      openOptions();
      const tags: Array<HTMLElement> = defaultTags();
      expect(tags).toHaveLength(1);
      expect(tags[0]).toHaveTextContent("Default");
      expect(
        screen.getByTestId(`network-topology-layout-mode-${mode}`),
      ).toContainElement(tags[0]!);
    },
  );

  test("the tag reads as part of the layout's name, and the layout still reports whether it is selected", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "tiered",
          defaultLayout: defaultLayout({ layoutMode: "parentChild" }),
        })}
      />,
    );
    openOptions();
    const parentChild: HTMLElement = screen.getByRole("button", {
      name: "Parent and child Default",
    });
    expect(parentChild).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(parentChild);
    expect(
      screen.getByRole("button", { name: "By network layer" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("picking a layout is still only a layout change, whoever is looking", () => {
    const props: ComponentProps = toolbarProps({
      layoutMode: "tiered",
      defaultLayout: defaultLayout({ layoutMode: "tiered" }),
    });
    render(<NetworkTopologyToolbar {...props} />);
    openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Hub and spoke" }));
    expect(props.onLayoutChange).toHaveBeenCalledWith("star");
    expect(props.defaultLayout!.onMakeDefault).not.toHaveBeenCalled();
    expect(props.defaultLayout!.onClear).not.toHaveBeenCalled();
  });

  test("a reader who may not change the default sees which layout it is, and no controls", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "star",
          defaultLayout: defaultLayout({
            layoutMode: "parentChild",
            isSetByProject: true,
            canChange: false,
          }),
        })}
      />,
    );
    openOptions();
    expect(defaultTags()).toHaveLength(1);
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-clear-default"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-default-status"),
    ).not.toBeInTheDocument();
  });

  test("the controls stay inside Map options, with the layouts", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "star",
          defaultLayout: defaultLayout({ layoutMode: "tiered" }),
        })}
      />,
    );
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    openOptions();
    expect(
      within(screen.getByTestId("network-topology-options")).getByTestId(
        "network-topology-make-default",
      ),
    ).toBeVisible();
  });

  test("on another layout, an admin can make it the default for everyone", () => {
    const controls: DefaultLayoutControls = defaultLayout({
      layoutMode: "tiered",
    });
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "parentChild",
          defaultLayout: controls,
        })}
      />,
    );
    openOptions();
    const makeDefault: HTMLElement = screen.getByRole("button", {
      name: "Make default for everyone",
    });
    expect(makeDefault).toBeEnabled();
    expect(makeDefault).toHaveAttribute(
      "title",
      "Every network map in this project will open on this layout. People can still switch while they look.",
    );
    fireEvent.click(makeDefault);
    expect(controls.onMakeDefault).toHaveBeenCalledTimes(1);
    expect(controls.onClear).not.toHaveBeenCalled();
  });

  test("on the map's own default there is nothing to make default, and nothing to clear", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "tiered",
          defaultLayout: defaultLayout({
            layoutMode: "tiered",
            isSetByProject: false,
          }),
        })}
      />,
    );
    openOptions();
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-clear-default"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-default-status"),
    ).not.toBeInTheDocument();
  });

  test("on the project's default, an admin is told it is everyone's and can clear it", () => {
    const controls: DefaultLayoutControls = defaultLayout({
      layoutMode: "parentChild",
      isSetByProject: true,
    });
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "parentChild",
          defaultLayout: controls,
        })}
      />,
    );
    openOptions();
    const status: HTMLElement = screen.getByTestId(
      "network-topology-default-status",
    );
    expect(status).toHaveTextContent(
      "Everyone in this project opens network maps on this layout.",
    );
    expect(status).toHaveAttribute("role", "status");
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    const clear: HTMLElement = screen.getByRole("button", {
      name: "Clear default",
    });
    expect(clear).toHaveAttribute(
      "title",
      "Each map opens on its own default again: Automatic for all devices, By network layer for a site.",
    );
    fireEvent.click(clear);
    expect(controls.onClear).toHaveBeenCalledTimes(1);
    expect(controls.onMakeDefault).not.toHaveBeenCalled();
  });

  test("while a change saves, its button says so and cannot be pressed twice", () => {
    const controls: DefaultLayoutControls = defaultLayout({
      layoutMode: "tiered",
      isSaving: true,
    });
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({ layoutMode: "star", defaultLayout: controls })}
      />,
    );
    openOptions();
    const makeDefault: HTMLElement = screen.getByTestId(
      "network-topology-make-default",
    );
    expect(makeDefault).toHaveTextContent("Saving…");
    expect(makeDefault).toBeDisabled();
    fireEvent.click(makeDefault);
    expect(controls.onMakeDefault).not.toHaveBeenCalled();
  });

  test("clearing says it is saving too", () => {
    const controls: DefaultLayoutControls = defaultLayout({
      layoutMode: "star",
      isSetByProject: true,
      isSaving: true,
    });
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({ layoutMode: "star", defaultLayout: controls })}
      />,
    );
    openOptions();
    const clear: HTMLElement = screen.getByTestId(
      "network-topology-clear-default",
    );
    expect(clear).toHaveTextContent("Saving…");
    expect(clear).toBeDisabled();
  });

  test.each([
    ["making a default", "star", false],
    ["clearing it", "tiered", true],
  ])(
    "a change that did not save is said beside the control, after %s",
    (_label: string, layoutMode: string, isSetByProject: boolean) => {
      render(
        <NetworkTopologyToolbar
          {...toolbarProps({
            layoutMode: layoutMode as ComponentProps["layoutMode"],
            defaultLayout: defaultLayout({
              layoutMode: "tiered",
              isSetByProject: isSetByProject,
              error: "We couldn't change the default layout. Try again.",
            }),
          })}
        />,
      );
      openOptions();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "We couldn't change the default layout. Try again.",
      );
    },
  );

  test("no error is shown when there is none", () => {
    render(
      <NetworkTopologyToolbar
        {...toolbarProps({
          layoutMode: "star",
          defaultLayout: defaultLayout({ layoutMode: "tiered" }),
        })}
      />,
    );
    openOptions();
    expect(
      screen.queryByTestId("network-topology-default-error"),
    ).not.toBeInTheDocument();
  });

  test("the tag follows the default when it changes", () => {
    const props: ComponentProps = toolbarProps({
      layoutMode: "star",
      defaultLayout: defaultLayout({ layoutMode: "tiered" }),
    });
    const { rerender } = render(<NetworkTopologyToolbar {...props} />);
    openOptions();
    expect(
      screen.getByTestId("network-topology-layout-mode-tiered"),
    ).toHaveTextContent("Default");
    rerender(
      <NetworkTopologyToolbar
        {...props}
        defaultLayout={defaultLayout({
          layoutMode: "star",
          isSetByProject: true,
        })}
      />,
    );
    expect(
      screen.getByTestId("network-topology-layout-mode-tiered"),
    ).not.toHaveTextContent("Default");
    expect(
      screen.getByTestId("network-topology-layout-mode-star"),
    ).toHaveTextContent("Default");
    expect(
      screen.queryByTestId("network-topology-make-default"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("network-topology-default-status")).toBeVisible();
  });
});
