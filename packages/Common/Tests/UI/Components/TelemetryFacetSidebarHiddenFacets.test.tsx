import TelemetryFacetSidebar from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import { buildResourceFacetConfigs } from "../../../UI/Components/TelemetryViewer/ResourceFacetConfigs";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
} from "../../../UI/Components/TelemetryViewer/types";
import { RESOURCE_FACET_CATALOG } from "../../../Types/Telemetry/ResourceFacetCatalog";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Traces, Metrics and Exceptions explorers share TelemetryFacetSidebar.
 * With every catalog resource type now offered as a facet, a project that
 * runs only Kubernetes would scroll past eleven empty sections — so configs
 * marked hideWhenEmpty fold into an "N empty filters hidden" footer instead.
 *
 * These render the real sidebar with the configs the explorers build: a
 * Service facet, the twelve resource facets, and a Status facet.
 */

const SERVICE_CONFIG: FacetConfig = {
  key: "primaryEntityId",
  title: "Service",
  priority: 1,
  serverSearchable: true,
};

const STATUS_CONFIG: FacetConfig = {
  key: "statusCode",
  title: "Status",
  priority: 3,
};

function makeConfigs(): Array<FacetConfig> {
  return [
    STATUS_CONFIG,
    ...buildResourceFacetConfigs({ basePriority: 2 }),
    SERVICE_CONFIG,
  ];
}

function value(id: string, count: number = 1, name?: string): FacetValue {
  return name
    ? { value: id, count: count, displayName: name }
    : {
        value: id,
        count: count,
      };
}

interface SidebarOptions {
  facetData: FacetData;
  facetConfigs?: Array<FacetConfig> | undefined;
  activeFilters?: Array<ActiveFilter> | undefined;
  isLoading?: boolean | undefined;
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;
}

function sidebarElement(options: SidebarOptions): ReactElement {
  return (
    <TelemetryFacetSidebar
      facetData={options.facetData}
      facetConfigs={options.facetConfigs || makeConfigs()}
      isLoading={options.isLoading || false}
      activeFilters={options.activeFilters}
      onIncludeFilter={jest.fn()}
      onExcludeFilter={jest.fn()}
      onFacetSearchChange={options.onFacetSearchChange}
    />
  );
}

// Section headers are the only buttons that report aria-expanded AND control a body.
function sectionTitles(): Array<string> {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return (
        element.hasAttribute("aria-expanded") &&
        !element.closest("[data-testid='facet-sidebar-hidden-footer']") &&
        !(element.textContent || "").startsWith("Show")
      );
    })
    .map((element: HTMLElement): string => {
      const title: HTMLElement | null = element.querySelector("span.uppercase");
      return title?.textContent || "";
    });
}

function footer(): HTMLElement | null {
  return screen.queryByTestId("facet-sidebar-hidden-footer");
}

function sectionFor(title: string | RegExp): HTMLElement {
  const header: HTMLElement = screen.getByRole("button", { name: title });
  // header button -> header wrapper -> section
  return header.parentElement!.parentElement as HTMLElement;
}

function typeInto(box: HTMLElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("TelemetryFacetSidebar hides empty resource facets", () => {
  const MIXED: FacetData = {
    primaryEntityId: [value("svc-1", 10, "checkout")],
    statusCode: [value("200", 7)],
    hostId: [value("h-1", 3, "web-1")],
    dockerHostId: [],
    kubernetesClusterId: [],
    proxmoxClusterId: [value("p-1", 0, "pve-prod")],
  };

  test("renders resource facets with values and folds away the empty ones", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(sectionTitles()).toEqual([
      "Service",
      "Host",
      "Proxmox Cluster",
      "Status",
    ]);
    expect(screen.queryByRole("button", { name: "Docker Host" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Kubernetes Cluster" }),
    ).toBeNull();
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("resources the server did not return are neither rendered nor counted", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(screen.queryByRole("button", { name: "Podman Host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "IoT Fleet" })).toBeNull();
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("a resource with only zero-count values is not empty", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(
      within(sectionFor("Proxmox Cluster")).getByText("pve-prod"),
    ).toBeInTheDocument();
  });

  test("non-hideable facets stay on screen when empty", () => {
    render(
      sidebarElement({
        facetData: {
          primaryEntityId: [],
          statusCode: [],
          hostId: [],
        },
      }),
    );

    expect(sectionTitles()).toEqual(["Service", "Status"]);
    expect(
      within(sectionFor("Service")).getByText("No values in this time range"),
    ).toBeInTheDocument();
    expect(
      within(sectionFor("Status")).getByText("No values in this time range"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No values found")).toBeNull();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });

  test("a config without hideWhenEmpty is never hidden, even for a catalog key", () => {
    render(
      sidebarElement({
        facetData: { hostId: [] },
        facetConfigs: [{ key: "hostId", title: "Host", priority: 1 }],
      }),
    );

    expect(sectionTitles()).toEqual(["Host"]);
    expect(footer()).toBeNull();
  });

  test("the footer says 'filter' for one and 'filters' for many", () => {
    const view: RenderResult = render(
      sidebarElement({ facetData: { hostId: [] } }),
    );

    expect(footer()).toHaveTextContent("1 empty filter hidden");

    const allEmpty: FacetData = {};
    for (const definition of RESOURCE_FACET_CATALOG) {
      allEmpty[definition.facetKey] = [];
    }
    view.rerender(sidebarElement({ facetData: allEmpty }));

    // One per catalog type (thirteen, Databases included).
    const count: number = RESOURCE_FACET_CATALOG.length;
    expect(count).toBe(13);
    expect(footer()).toHaveTextContent(`${count} empty filters hidden`);
  });

  test("the count's tooltip names the hidden facets in sidebar order", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(screen.getByText("2 empty filters hidden")).toHaveAttribute(
      "title",
      "Docker Host, Kubernetes Cluster",
    );
  });

  test("Show reveals the hidden facets in their usual place with a resource empty state", () => {
    render(sidebarElement({ facetData: MIXED }));

    const show: HTMLElement = screen.getByRole("button", {
      name: "Show 2 empty filters",
    });
    expect(show).toHaveAttribute("aria-expanded", "false");

    const listId: string | null = show.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    expect(
      document
        .getElementById(listId!)!
        .contains(screen.getByRole("button", { name: "Host" })),
    ).toBe(true);

    fireEvent.click(show);

    expect(sectionTitles()).toEqual([
      "Service",
      "Host",
      "Docker Host",
      "Kubernetes Cluster",
      "Proxmox Cluster",
      "Status",
    ]);
    expect(
      within(sectionFor("Docker Host")).getByText(
        "No Docker Hosts in this project",
      ),
    ).toBeInTheDocument();
    expect(
      within(sectionFor("Kubernetes Cluster")).getByText(
        "No Kubernetes Clusters in this project",
      ),
    ).toBeInTheDocument();

    const hide: HTMLElement = screen.getByRole("button", {
      name: "Hide empty filters",
    });
    expect(hide).toHaveAttribute("aria-expanded", "true");
  });

  test("Hide empty filters folds them away again", () => {
    render(sidebarElement({ facetData: MIXED }));

    fireEvent.click(
      screen.getByRole("button", { name: "Show 2 empty filters" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide empty filters" }));

    expect(sectionTitles()).toEqual([
      "Service",
      "Host",
      "Proxmox Cluster",
      "Status",
    ]);
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("the footer is the last thing in the facet list", () => {
    render(sidebarElement({ facetData: MIXED }));

    const status: HTMLElement = screen.getByRole("button", { name: "Status" });
    expect(
      status.compareDocumentPosition(footer()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(footer()!.nextElementSibling).toBeNull();
  });

  test("a facet with an active selection stays on screen and is not counted", () => {
    render(
      sidebarElement({
        facetData: MIXED,
        activeFilters: [
          {
            facetKey: "dockerHostId",
            value: "d-1",
            displayKey: "Docker Host",
            displayValue: "d-1",
          },
        ],
      }),
    );

    expect(sectionTitles()).toContain("Docker Host");
    expect(
      within(sectionFor(/^Docker Host/)).getByText("1"),
    ).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
    expect(screen.getByText("1 empty filter hidden")).toHaveAttribute(
      "title",
      "Kubernetes Cluster",
    );
  });

  test("a selected resource keeps its section even before its values load", () => {
    render(
      sidebarElement({
        facetData: {},
        isLoading: true,
        activeFilters: [
          {
            facetKey: "cephClusterId",
            value: "c-1",
            displayKey: "Ceph Cluster",
            displayValue: "c-1",
          },
        ],
      }),
    );

    expect(sectionTitles()).toEqual(["Service", "Ceph Cluster", "Status"]);
    expect(footer()).toBeNull();
  });

  test("the first load ({}) shows the loader, no resource sections and no footer", () => {
    render(sidebarElement({ facetData: {}, isLoading: true }));

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(sectionTitles()).toEqual(["Service", "Status"]);
    expect(footer()).toBeNull();
  });

  test("hidden facets reappear on their own when a refetch brings values", () => {
    const view: RenderResult = render(
      sidebarElement({ facetData: { hostId: [], dockerHostId: [] } }),
    );

    expect(footer()).toHaveTextContent("2 empty filters hidden");

    view.rerender(
      sidebarElement({
        facetData: { hostId: [value("h-1")], dockerHostId: [value("d-1")] },
      }),
    );

    expect(sectionTitles()).toEqual([
      "Service",
      "Host",
      "Docker Host",
      "Status",
    ]);
    expect(footer()).toBeNull();
  });

  test("icons come from the config", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(
      within(screen.getByRole("button", { name: "Host" })).getByTestId(
        "facet-section-icon",
      ),
    ).toHaveAttribute("data-icon", IconProp.Server);
    expect(
      within(
        screen.getByRole("button", { name: "Proxmox Cluster" }),
      ).getByTestId("facet-section-icon"),
    ).toHaveAttribute("data-icon", IconProp.Proxmox);
    expect(
      within(screen.getByRole("button", { name: "Service" })).queryByTestId(
        "facet-section-icon",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show 2 empty filters" }),
    );

    expect(
      within(screen.getByRole("button", { name: "Docker Host" })).getByTestId(
        "facet-section-icon",
      ),
    ).toHaveAttribute("data-icon", IconProp.Docker);
  });

  test("a hideWhenEmpty config without a noun still gets a project empty state", () => {
    render(
      sidebarElement({
        facetData: { customResource: [] },
        facetConfigs: [
          {
            key: "customResource",
            title: "Custom",
            hideWhenEmpty: true,
          },
        ],
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty filter" }),
    );

    expect(screen.getByText("No values in this project")).toBeInTheDocument();
  });

  test("an empty config list renders no sections and no footer", () => {
    render(sidebarElement({ facetData: MIXED, facetConfigs: [] }));

    expect(sectionTitles()).toEqual([]);
    expect(footer()).toBeNull();
  });
});

describe("TelemetryFacetSidebar keeps searched facets on screen", () => {
  const HOSTS: FacetData = {
    primaryEntityId: [value("svc-1", 10, "checkout")],
    hostId: [value("h-1", 3, "web-1"), value("h-2", 1, "web-2")],
    dockerHostId: [],
  };

  function hostBox(): HTMLElement {
    return screen.getByRole("textbox", { name: "Search Host" });
  }

  function callsFor(mock: MockFunction, key: string): Array<Array<unknown>> {
    return mock.mock.calls.filter((call: Array<unknown>): boolean => {
      return call[0] === key;
    });
  }

  test("the full timeline: type, no match, clear, refetch", () => {
    jest.useFakeTimers();
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    function rerenderWith(facetData: FacetData): void {
      view.rerender(
        sidebarElement({
          facetData: facetData,
          onFacetSearchChange: onFacetSearchChange as any,
        }),
      );
    }

    // Mount-time empty emits settle first.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    onFacetSearchChange.mockClear();

    // 1. Type: the local filter already finds nothing.
    typeInto(hostBox(), "zzz");
    expect(
      within(sectionFor("Host")).getByText("No matches for “zzz”"),
    ).toBeInTheDocument();

    // 2. Debounce: sent to the host with the facet key.
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(callsFor(onFacetSearchChange, "hostId")).toEqual([]);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(callsFor(onFacetSearchChange, "hostId")).toEqual([
      ["hostId", "zzz"],
    ]);

    // 3. The server answers with nothing: the section stays, box and all.
    const noMatch: FacetData = { ...HOSTS, hostId: [] };
    rerenderWith(noMatch);

    expect(sectionTitles()).toContain("Host");
    expect(hostBox()).toHaveValue("zzz");
    expect(
      within(sectionFor("Host")).getByText("No matches for “zzz”"),
    ).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");

    // 4. Clear: the stale empty answer is still showing, so is the section.
    fireEvent.click(
      within(sectionFor("Host")).getByRole("button", { name: "Clear search" }),
    );

    expect(sectionTitles()).toContain("Host");
    expect(hostBox()).toHaveValue("");
    expect(
      within(sectionFor("Host")).getByText("No matches for “zzz”"),
    ).toBeInTheDocument();

    // 5. Debounce sends "": nothing has arrived yet, still on screen.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(callsFor(onFacetSearchChange, "hostId")).toEqual([
      ["hostId", "zzz"],
      ["hostId", ""],
    ]);
    expect(sectionTitles()).toContain("Host");

    // 6. The unsearched refetch lands with values.
    rerenderWith({ ...HOSTS });

    expect(sectionTitles()).toContain("Host");
    expect(within(sectionFor("Host")).getByText("web-1")).toBeInTheDocument();
    expect(within(sectionFor("Host")).getByText("web-2")).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");

    // 7. A later unsearched response with nothing: hidden and counted.
    rerenderWith({ ...HOSTS, hostId: [] });

    expect(sectionTitles()).not.toContain("Host");
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("clearing and refetching to an empty list hides the facet", () => {
    jest.useFakeTimers();
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    typeInto(hostBox(), "zzz");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    view.rerender(
      sidebarElement({
        facetData: { ...HOSTS, hostId: [] },
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    typeInto(hostBox(), "");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(sectionTitles()).toContain("Host");

    view.rerender(
      sidebarElement({
        facetData: { ...HOSTS, hostId: [] },
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    expect(sectionTitles()).not.toContain("Host");
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("a facet with text in its box stays on screen before the debounce fires", () => {
    const view: RenderResult = render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: jest.fn(),
      }),
    );

    typeInto(hostBox(), "web");

    // A response for some other reason (e.g. the time range) says empty.
    view.rerender(
      sidebarElement({
        facetData: { ...HOSTS, hostId: [] },
        onFacetSearchChange: jest.fn(),
      }),
    );

    expect(sectionTitles()).toContain("Host");
    expect(hostBox()).toHaveValue("web");
  });

  test("a revealed facet being searched survives 'Hide empty filters'", () => {
    render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: jest.fn(),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty filter" }),
    );
    typeInto(
      screen.getByRole("textbox", { name: "Search Docker Host" }),
      "box",
    );

    expect(footer()).toBeNull();
    expect(sectionTitles()).toContain("Docker Host");

    // Clearing without a server round-trip: empty again, and still revealed.
    typeInto(screen.getByRole("textbox", { name: "Search Docker Host" }), "");

    expect(sectionTitles()).toContain("Docker Host");
    fireEvent.click(screen.getByRole("button", { name: "Hide empty filters" }));
    expect(sectionTitles()).not.toContain("Docker Host");
  });

  test("a search box keeps its text when a failed refetch drops the facet", () => {
    const view: RenderResult = render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: jest.fn(),
      }),
    );

    typeInto(hostBox(), "web");
    view.rerender(
      sidebarElement({ facetData: {}, onFacetSearchChange: jest.fn() }),
    );

    expect(sectionTitles()).toEqual(["Service", "Host", "Status"]);
    expect(hostBox()).toHaveValue("web");
    expect(footer()).toBeNull();
  });

  test("search change is debounced and reported with the facet key", () => {
    jest.useFakeTimers();
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    typeInto(screen.getByRole("textbox", { name: "Search Service" }), "check");

    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(callsFor(onFacetSearchChange, "primaryEntityId")).toEqual([]);

    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(callsFor(onFacetSearchChange, "primaryEntityId")).toEqual([
      ["primaryEntityId", "check"],
    ]);
    // Only server-searchable facets report.
    expect(callsFor(onFacetSearchChange, "statusCode")).toEqual([]);
  });

  test("a host re-render mid-debounce does not restart the timer", () => {
    jest.useFakeTimers();
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: first as any,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });
    first.mockClear();

    typeInto(hostBox(), "web");
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // The host re-renders with a fresh callback, as parents do.
    view.rerender(
      sidebarElement({
        facetData: HOSTS,
        onFacetSearchChange: second as any,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(callsFor(second, "hostId")).toEqual([["hostId", "web"]]);
    expect(first).not.toHaveBeenCalled();
  });

  test("without a server search callback a short resource list has no search box and still hides when empty", () => {
    render(
      sidebarElement({
        facetData: { hostId: [value("h-1")], dockerHostId: [] },
      }),
    );

    expect(screen.queryByRole("textbox", { name: "Search Host" })).toBeNull();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });
});
