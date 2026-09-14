import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import {
  ActiveFilter,
  FacetData,
  FacetValue,
  LogsSavedViewOption,
} from "../../../UI/Components/LogsViewer/types";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import IconProp from "../../../Types/Icon/IconProp";
import { TelemetryEntityNameMap } from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
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
 * The Logs explorer's sidebar is not config-driven: it renders whatever keys
 * the facets response holds. It now titles, orders and server-searches every
 * catalog resource type (not just Host / Docker / Podman / Kubernetes), and
 * folds the empty ones into an "N empty filters hidden" footer. Service and
 * Severity are never folded away.
 */

function value(id: string, count: number = 1, name?: string): FacetValue {
  if (name) {
    return { value: id, count: count, displayName: name };
  }
  return { value: id, count: count };
}

interface SidebarOptions {
  facetData: FacetData;
  activeFilters?: Array<ActiveFilter> | undefined;
  isLoading?: boolean | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  entityNameMap?: TelemetryEntityNameMap | undefined;
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;
}

function sidebarElement(options: SidebarOptions): ReactElement {
  return (
    <LogsFacetSidebar
      facetData={options.facetData}
      isLoading={options.isLoading || false}
      serviceMap={{}}
      entityNameMap={options.entityNameMap}
      onIncludeFilter={jest.fn()}
      onExcludeFilter={jest.fn()}
      activeFilters={options.activeFilters}
      savedViews={options.savedViews}
      selectedSavedViewId={null}
      onSavedViewSelect={jest.fn()}
      onClearSavedView={jest.fn()}
      onFacetSearchChange={options.onFacetSearchChange}
    />
  );
}

// Facet section titles, in render order (saved views excluded).
function sectionTitles(): Array<string> {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return (
        element.hasAttribute("aria-expanded") &&
        !element.closest("[data-testid='facet-sidebar-hidden-footer']") &&
        !(element.textContent || "").startsWith("Show") &&
        !(element.textContent || "").startsWith("Saved Views")
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
  return header.parentElement!.parentElement as HTMLElement;
}

function typeInto(box: HTMLElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
}

function callsFor(mock: MockFunction, key: string): Array<Array<unknown>> {
  return mock.mock.calls.filter((call: Array<unknown>): boolean => {
    return call[0] === key;
  });
}

const CATALOG_LABELS: Array<string> = RESOURCE_FACET_CATALOG.map(
  (definition: ResourceFacetDefinition): string => {
    return definition.label;
  },
);

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("LogsFacetSidebar hides empty resource facets", () => {
  const MIXED: FacetData = {
    severityText: [value("Error", 4)],
    primaryEntityId: [value("svc-1", 10, "checkout")],
    hostId: [value("h-1", 3, "web-1")],
    dockerHostId: [],
    podmanHostId: [],
    kubernetesClusterId: [value("k-1", 2, "prod-cluster")],
    proxmoxClusterId: [value("p-1", 0, "pve-prod")],
  };

  test("renders resources with values and folds away the empty ones", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(sectionTitles()).toEqual([
      "Severity",
      "Service",
      "Host",
      "Kubernetes Cluster",
      "Proxmox Cluster",
    ]);
    expect(footer()).toHaveTextContent("2 empty filters hidden");
    expect(screen.getByText("2 empty filters hidden")).toHaveAttribute(
      "title",
      "Docker Host, Podman Host",
    );
  });

  test("a new resource type shows its server-resolved names", () => {
    render(sidebarElement({ facetData: MIXED }));

    expect(
      within(sectionFor("Proxmox Cluster")).getByText("pve-prod"),
    ).toBeInTheDocument();
  });

  test("the Service facet is never hidden, even when empty", () => {
    render(
      sidebarElement({
        facetData: { primaryEntityId: [], hostId: [] },
      }),
    );

    expect(sectionTitles()).toEqual(["Service"]);
    expect(
      within(sectionFor("Service")).getByText("No values in this time range"),
    ).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });

  test("the severity facet is never hidden, even when empty", () => {
    render(sidebarElement({ facetData: { severityText: [] } }));

    expect(sectionTitles()).toEqual(["Severity"]);
    expect(
      within(sectionFor("Severity")).getByText("No values in this time range"),
    ).toBeInTheDocument();
    expect(footer()).toBeNull();
  });

  test("other non-resource keys are never hidden", () => {
    render(sidebarElement({ facetData: { traceId: [], "resource.x": [] } }));

    expect(sectionTitles()).toEqual(["resource.x", "Trace ID"]);
    expect(footer()).toBeNull();
  });

  test("Show reveals hidden facets in catalog order with a resource empty state; Hide folds them again", () => {
    render(sidebarElement({ facetData: MIXED }));

    fireEvent.click(
      screen.getByRole("button", { name: "Show 2 empty filters" }),
    );

    expect(sectionTitles()).toEqual([
      "Severity",
      "Service",
      "Host",
      "Docker Host",
      "Podman Host",
      "Kubernetes Cluster",
      "Proxmox Cluster",
    ]);
    expect(
      within(sectionFor("Docker Host")).getByText(
        "No Docker Hosts in this project",
      ),
    ).toBeInTheDocument();
    expect(
      within(sectionFor("Podman Host")).getByText(
        "No Podman Hosts in this project",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide empty filters" }));

    expect(sectionTitles()).toEqual([
      "Severity",
      "Service",
      "Host",
      "Kubernetes Cluster",
      "Proxmox Cluster",
    ]);
  });

  test("every catalog resource, all empty, folds into one footer and reveals in catalog order", () => {
    const allEmpty: FacetData = { severityText: [value("Error")] };
    for (const key of RESOURCE_FACET_CATALOG_KEYS) {
      allEmpty[key] = [];
    }

    render(sidebarElement({ facetData: allEmpty }));

    expect(sectionTitles()).toEqual(["Severity"]);
    expect(footer()).toHaveTextContent("12 empty filters hidden");
    expect(screen.getByText("12 empty filters hidden")).toHaveAttribute(
      "title",
      CATALOG_LABELS.join(", "),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show 12 empty filters" }),
    );

    expect(sectionTitles()).toEqual(["Severity", ...CATALOG_LABELS]);

    for (const definition of RESOURCE_FACET_CATALOG) {
      expect(
        within(sectionFor(definition.label)).getByText(
          `No ${definition.pluralLabel} in this project`,
        ),
      ).toBeInTheDocument();
    }
  });

  test("a facet with an active selection stays and is not counted", () => {
    render(
      sidebarElement({
        facetData: MIXED,
        activeFilters: [
          {
            facetKey: "podmanHostId",
            value: "pm-1",
            displayKey: "Podman Host",
            displayValue: "pm-1",
          },
        ],
      }),
    );

    expect(sectionTitles()).toContain("Podman Host");
    expect(
      within(sectionFor(/^Podman Host/)).getByText("1"),
    ).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });

  test("loading with no data shows the loader and no footer", () => {
    render(sidebarElement({ facetData: {}, isLoading: true }));

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(sectionTitles()).toEqual([]);
    expect(footer()).toBeNull();
  });

  test("saved views still render above the facets, and the footer sits after the last facet", () => {
    render(
      sidebarElement({
        facetData: MIXED,
        savedViews: [
          { id: "v1", name: "Errors only" },
          { id: "v2", name: "Checkout" },
        ],
      }),
    );

    const savedViews: HTMLElement = screen.getByRole("button", {
      name: "Saved Views",
    });
    const severity: HTMLElement = screen.getByRole("button", {
      name: "Severity",
    });

    expect(
      savedViews.compareDocumentPosition(severity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Errors only" }),
    ).toBeInTheDocument();

    const lastFacet: HTMLElement = screen.getByRole("button", {
      name: "Proxmox Cluster",
    });
    expect(
      lastFacet.compareDocumentPosition(footer()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(footer()!.nextElementSibling).toBeNull();
  });

  test("a sidebar with only saved views and hidden facets shows both", () => {
    render(
      sidebarElement({
        facetData: { hostId: [] },
        savedViews: [{ id: "v1", name: "Errors only" }],
      }),
    );

    expect(
      screen.getByRole("button", { name: "Saved Views" }),
    ).toBeInTheDocument();
    expect(sectionTitles()).toEqual([]);
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });
});

describe("LogsFacetSidebar titles, order, icons and names", () => {
  function everyKeyWithValues(): FacetData {
    const data: FacetData = {
      zeta: [value("z")],
      alpha: [value("a")],
      spanId: [value("s")],
      traceId: [value("t")],
    };
    for (const key of [...RESOURCE_FACET_CATALOG_KEYS].reverse()) {
      data[key] = [value(`${key}-1`)];
    }
    data["primaryEntityId"] = [value("svc")];
    data["severityText"] = [value("Error")];
    return data;
  }

  test("orders Severity, Service, the catalog, then everything else by key", () => {
    render(sidebarElement({ facetData: everyKeyWithValues() }));

    expect(sectionTitles()).toEqual([
      "Severity",
      "Service",
      ...CATALOG_LABELS,
      "alpha",
      "Span ID",
      "Trace ID",
      "zeta",
    ]);
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, string, IconProp] => {
        return [definition.facetKey, definition.label, definition.icon];
      },
    ),
  )(
    "%s is titled %s with its catalog icon",
    (facetKey: string, label: string, icon: IconProp) => {
      render(sidebarElement({ facetData: { [facetKey]: [value("x-1")] } }));

      const header: HTMLElement = screen.getByRole("button", { name: label });
      expect(within(header).getByTestId("facet-section-icon")).toHaveAttribute(
        "data-icon",
        icon,
      );
    },
  );

  test("the Service facet carries the service icon and severity none", () => {
    render(
      sidebarElement({
        facetData: {
          severityText: [value("Error")],
          primaryEntityId: [value("svc")],
        },
      }),
    );

    expect(
      within(screen.getByRole("button", { name: "Service" })).getByTestId(
        "facet-section-icon",
      ),
    ).toHaveAttribute("data-icon", IconProp.SquareStack);
    expect(
      within(screen.getByRole("button", { name: "Severity" })).queryByTestId(
        "facet-section-icon",
      ),
    ).toBeNull();
  });

  test("a new resource type without a server name uses the resolver's name", () => {
    render(
      sidebarElement({
        facetData: {
          cephClusterId: [value("ceph-1", 5)],
          iotFleetId: [value("fleet-1", 2, "fleet-1")],
        },
        entityNameMap: {
          "ceph-1": {
            id: "ceph-1",
            name: "storage-east",
            entityType: ServiceType.CephCluster,
            typeLabel: "Ceph Cluster",
          },
          "fleet-1": {
            id: "fleet-1",
            name: "sensors",
            entityType: ServiceType.IoTDevice,
            typeLabel: "IoT Fleet",
          },
        },
      }),
    );

    expect(
      within(sectionFor("Ceph Cluster")).getByText("storage-east"),
    ).toBeInTheDocument();
    // A displayName that only echoes the id does not hide the resolved name.
    expect(
      within(sectionFor("IoT Fleet")).getByText("sensors"),
    ).toBeInTheDocument();
  });
});

describe("LogsFacetSidebar server search", () => {
  test.each(["primaryEntityId", ...RESOURCE_FACET_CATALOG_KEYS])(
    "%s gets a server-backed search box",
    (facetKey: string) => {
      jest.useFakeTimers();
      const onFacetSearchChange: MockFunction = getJestMockFunction();
      render(
        sidebarElement({
          facetData: { [facetKey]: [value("x-1")] },
          onFacetSearchChange: onFacetSearchChange as any,
        }),
      );

      const box: HTMLElement = screen.getByRole("textbox");
      typeInto(box, " needle ");

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(callsFor(onFacetSearchChange, facetKey)).toEqual([
        [facetKey, "needle"],
      ]);
    },
  );

  test("severity is searched locally only", () => {
    jest.useFakeTimers();
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const severities: Array<FacetValue> = [];
    for (let index: number = 1; index <= 8; index++) {
      severities.push(value(`Sev${index}`, index));
    }

    render(
      sidebarElement({
        facetData: { severityText: severities },
        onFacetSearchChange: onFacetSearchChange as any,
      }),
    );

    typeInto(screen.getByRole("textbox", { name: "Search Severity" }), "Sev2");
    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(onFacetSearchChange).not.toHaveBeenCalled();
  });

  test("without a callback a short resource list has no search box", () => {
    render(sidebarElement({ facetData: { proxmoxClusterId: [value("p")] } }));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("the full timeline keeps a searched resource on screen until fresh data lands", () => {
    jest.useFakeTimers();
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const data: FacetData = {
      severityText: [value("Error")],
      dockerHostId: [value("d-1", 3, "docker-a"), value("d-2", 1, "docker-b")],
      podmanHostId: [],
    };

    const view: RenderResult = render(
      sidebarElement({
        facetData: data,
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

    function dockerBox(): HTMLElement {
      return screen.getByRole("textbox", { name: "Search Docker Host" });
    }

    typeInto(dockerBox(), "zzz");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(callsFor(onFacetSearchChange, "dockerHostId")).toEqual([
      ["dockerHostId", "zzz"],
    ]);

    const noMatch: FacetData = { ...data, dockerHostId: [] };
    rerenderWith(noMatch);

    expect(sectionTitles()).toContain("Docker Host");
    expect(
      within(sectionFor("Docker Host")).getByText("No matches for “zzz”"),
    ).toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");

    fireEvent.keyDown(dockerBox(), { key: "Escape" });
    expect(dockerBox()).toHaveValue("");
    expect(sectionTitles()).toContain("Docker Host");

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(callsFor(onFacetSearchChange, "dockerHostId")).toEqual([
      ["dockerHostId", "zzz"],
      ["dockerHostId", ""],
    ]);
    expect(sectionTitles()).toContain("Docker Host");

    rerenderWith({ ...data });
    expect(
      within(sectionFor("Docker Host")).getByText("docker-a"),
    ).toBeInTheDocument();

    rerenderWith({ ...data, dockerHostId: [] });
    expect(sectionTitles()).not.toContain("Docker Host");
    expect(footer()).toHaveTextContent("2 empty filters hidden");
  });

  test("a revealed resource keeps its search text after being hidden and revealed again", () => {
    const view: RenderResult = render(
      sidebarElement({
        facetData: { hostId: [], severityText: [value("Error")] },
        onFacetSearchChange: jest.fn(),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty filter" }),
    );
    typeInto(screen.getByRole("textbox", { name: "Search Host" }), "web");

    // The refetch drops the facet entirely, then brings it back.
    view.rerender(
      sidebarElement({
        facetData: { severityText: [value("Error")] },
        onFacetSearchChange: jest.fn(),
      }),
    );
    view.rerender(
      sidebarElement({
        facetData: { hostId: [], severityText: [value("Error")] },
        onFacetSearchChange: jest.fn(),
      }),
    );

    expect(screen.getByRole("textbox", { name: "Search Host" })).toHaveValue(
      "web",
    );
  });
});
