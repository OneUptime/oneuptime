import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import ResourceTopologyMap, {
  ResourceTopologyArrangement,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyMap";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import { ResourceTopologyGraph } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { buildVMwareTopology } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/VMwareTopology";

/*
 * A resource's topology as a person reads it in the list - the view a phone
 * gets, and the one the page offers beside the map - with the map's
 * controls above it: the counts, Needs attention, the search, Group by, and
 * the panel of a picked part. The map itself is drawn by React Flow, which
 * jsdom cannot lay out; the browser suite (packages/E2E/ResourceTopology)
 * covers it.
 */

const NOW: Date = new Date();
const FRESH: Date = new Date(NOW.getTime() - 60 * 1000);

function row(fields: Partial<VMwareResource>): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

function vcenterGraph(): ResourceTopologyGraph {
  const issues: Array<OpenIssueRecord> = [
    {
      type: "incident",
      id: "incident-1",
      title: "Datastore almost full",
      number: "#12",
      severityName: "Critical",
      severityColor: "#dc2626",
      stateName: "Created",
      createdAt: NOW,
      seriesLabels: { "resource.vcenter.datastore.name": "ssd-full" },
      relatedIds: {},
    },
  ];

  return buildVMwareTopology({
    vcenter: { id: "vc-row", name: "vcenter-prod", lastSeenAt: FRESH },
    rows: [
      row({
        kind: VMwareResourceKind.Datacenter,
        externalId: "dc/Amsterdam",
        name: "Amsterdam",
      }),
      row({
        kind: VMwareResourceKind.Cluster,
        externalId: "cluster/ams-prod",
        name: "ams-prod",
        clusterName: "ams-prod",
        datacenterName: "Amsterdam",
        hostCount: 2,
        effectiveHostCount: 2,
      }),
      row({
        kind: VMwareResourceKind.Host,
        externalId: "host/esx-01",
        hostName: "esx-01",
        clusterName: "ams-prod",
        datacenterName: "Amsterdam",
        metricsUpdatedAt: FRESH,
        latestCpuPercent: 30,
      }),
      row({
        kind: VMwareResourceKind.VirtualMachine,
        externalId: "vm/web-1",
        name: "web-1",
        hostName: "esx-01",
        datacenterName: "Amsterdam",
        isPoweredOn: true,
        metricsUpdatedAt: FRESH,
      }),
      row({
        kind: VMwareResourceKind.Datastore,
        externalId: "ds/full",
        name: "ssd-full",
        datacenterName: "Amsterdam",
        latestDiskPercent: 95,
      }),
      row({
        kind: VMwareResourceKind.Datastore,
        externalId: "ds/fine",
        name: "ssd-fine",
        datacenterName: "Amsterdam",
        latestDiskPercent: 20,
      }),
    ],
    issues: issues,
    now: NOW,
  });
}

function renderMap(
  arrangements: Array<ResourceTopologyArrangement> = [
    { id: "vcenter", label: "Hosts and clusters", graph: vcenterGraph() },
  ],
): void {
  render(
    <MemoryRouter>
      <ResourceTopologyMap
        arrangements={arrangements}
        searchPlaceholder="Find a host, virtual machine or datastore…"
      />
    </MemoryRouter>,
  );
}

function rowOf(id: string): HTMLElement {
  return screen.getByTestId(`resource-topology-row-${id}`);
}

// The button that picks a row's part (its toggle, if any, comes first).
function pick(id: string): void {
  const buttons: Array<HTMLElement> = within(rowOf(id)).getAllByRole("button");
  fireEvent.click(buttons[buttons.length - 1]!);
}

beforeEach(() => {
  // The list, as a phone opens it; the map needs a real browser.
  window.history.replaceState({}, "", "/topology?view=list");
});

afterEach(() => {
  cleanup();
});

describe("the list of a resource's parts", () => {
  test("draws the resource top down, each kind under its own heading", () => {
    renderMap();

    expect(screen.getByTestId("resource-topology-outline")).toBeVisible();
    expect(rowOf("vcenter")).toHaveTextContent("vcenter-prod");
    expect(rowOf("vmware.datacenter:datacenter/Amsterdam")).toBeVisible();
    // Kind counts above, and the open incident counted for the whole vCenter.
    expect(
      screen.getByTestId("resource-topology-count-vmware.datastore"),
    ).toHaveTextContent("2");
    expect(
      screen.getByTestId("resource-topology-issue-summary"),
    ).toHaveTextContent("1 open incident");
  });

  test("a closed part says what it holds, and opens", () => {
    renderMap();
    const cluster: string = "vmware.cluster:cluster/ams-prod";
    const toggle: HTMLElement = screen.getByTestId(
      `resource-topology-row-toggle-${cluster}`,
    );

    if (toggle.getAttribute("aria-expanded") === "true") {
      fireEvent.click(toggle);
    }

    expect(
      screen.getByTestId(`resource-topology-row-toggle-${cluster}`),
    ).toHaveAttribute("aria-expanded", "false");
    expect(rowOf(cluster)).toHaveTextContent("1 ESXi Host");

    fireEvent.click(
      screen.getByTestId(`resource-topology-row-toggle-${cluster}`),
    );
    expect(
      screen.getByTestId(`resource-topology-row-toggle-${cluster}`),
    ).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("vmware.host:host/esx-01")).toBeVisible();
  });
});

describe("narrowing the list", () => {
  test("Needs attention keeps the troubled parts and the path to them, in the address", () => {
    renderMap();
    fireEvent.click(screen.getByTestId("resource-topology-filter-attention"));

    expect(window.location.search).toContain("filter=attention");
    expect(rowOf("vmware.datastore:ds/full")).toBeVisible();
    expect(
      screen.queryByTestId("resource-topology-row-vmware.datastore:ds/fine"),
    ).toBeNull();
    expect(
      screen.queryByTestId("resource-topology-row-vmware.vm:vm/web-1"),
    ).toBeNull();
  });

  test("a search says how many parts match, and clears", () => {
    renderMap();
    fireEvent.change(screen.getByTestId("resource-topology-search"), {
      target: { value: "web-1" },
    });

    expect(
      screen.getByTestId("resource-topology-search-result"),
    ).toHaveTextContent("1 part matches your search.");
    expect(rowOf("vmware.vm:vm/web-1")).toBeVisible();
    expect(
      screen.queryByTestId("resource-topology-row-vmware.datastore:ds/fine"),
    ).toBeNull();

    fireEvent.click(screen.getByText("Clear search"));
    expect(screen.queryByTestId("resource-topology-search-result")).toBeNull();
  });
});

describe("a picked part's panel", () => {
  test("says what it is, why it needs attention, and links to its page", () => {
    renderMap();
    fireEvent.click(screen.getByTestId("resource-topology-filter-attention"));
    pick("vmware.datastore:ds/full");

    const panel: HTMLElement = screen.getByTestId("resource-topology-panel");

    expect(screen.getByTestId("side-over-title")).toHaveTextContent("ssd-full");
    expect(panel).toHaveTextContent("95.0% of the datastore is used");
    // Its open incident, by number and title, linked to the incident's page.
    expect(
      within(screen.getByTestId("resource-topology-panel-issues")).getByRole(
        "link",
        { name: "#12 · Datastore almost full" },
      ),
    ).toHaveAttribute("href", expect.stringContaining("incident-1"));
    expect(
      within(panel).getByRole("link", { name: "Open Datastore" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/vmware/vc-row/datastores/"),
    );
    expect(window.location.search).toContain("node=");
  });

  test("Focus on this narrows to the part and what it holds; Show everything undoes it", () => {
    renderMap();
    pick("vmware.datacenter:datacenter/Amsterdam");
    fireEvent.click(screen.getByTestId("resource-topology-panel-focus"));

    expect(screen.getByTestId("resource-topology-focus")).toHaveTextContent(
      "Showing Amsterdam, what is inside it and what it is related to.",
    );
    expect(window.location.search).toContain("focus=");

    fireEvent.click(screen.getByTestId("resource-topology-focus-clear"));
    expect(screen.queryByTestId("resource-topology-focus")).toBeNull();
  });
});

describe("Group by", () => {
  test("switches between a resource's readings and keeps the choice in the address", () => {
    const graph: ResourceTopologyGraph = vcenterGraph();

    renderMap([
      { id: "first", label: "Workloads", graph: graph },
      { id: "second", label: "Nodes", graph: graph },
    ]);
    fireEvent.click(screen.getByTestId("resource-topology-arrangement-second"));

    expect(window.location.search).toContain("by=second");
    expect(
      screen.getByTestId("resource-topology-arrangement-second"),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
