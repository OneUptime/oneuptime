import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { formatBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import Route from "../../../Types/API/Route";

/*
 * The shared Infrastructure ResourceTable draws what a resource product's
 * list hands it - a name, an image, a reading - as written:
 *
 * - On a Persian page a figure read back to front: "3 / 4 ms" as
 *   "ms 4 / 3", "471 MiB" as "MiB 471", and a Ceph pool's ".mgr" as "mgr.".
 *   A name sits in its own isolate (bdi), and a column's value reads in its
 *   own direction (dir="auto").
 * - A name column (ResourceColumn.isName: a Swarm image) breaks after its
 *   own dots and slashes and is never cut: folded under a task's name, a
 *   registry path was cut where the column ended ("shop/check"), its tag
 *   out of sight.
 * - A reading folded with its column's name ("Max Avail 9.2 TiB") goes to
 *   the next line whole rather than leaving its unit alone there.
 * - A list may write memory its product's way (formatMemory): a Swarm
 *   task's "471 MiB", as Docker and the task's own page write it.
 */

const IMAGE: string = "registry.acme-swarm.example/shop/checkout:2.7.0";

function resource(
  name: string,
  attributes: Record<string, string>,
  memory?: {
    usage: number;
    utilization: number;
  },
): InfrastructureResource {
  return {
    name: name,
    namespace: "",
    cpuUtilization: null,
    memoryUsageBytes: memory ? memory.usage : null,
    memoryLimitBytes: null,
    memoryUtilization: memory ? memory.utilization : null,
    status: "Running",
    age: "",
    additionalAttributes: attributes,
  };
}

const COLUMNS: Array<ResourceColumn> = [
  {
    title: "Image",
    key: "image",
    isName: true,
    getValue: (row: InfrastructureResource): string => {
      return row.additionalAttributes["image"] || "—";
    },
  },
  { title: "Latency", key: "latency" },
  {
    title: "Max Avail",
    key: "maxAvail",
    showTitleWhenFolded: true,
    getValue: (row: InfrastructureResource): string => {
      return row.additionalAttributes["maxAvail"] || "—";
    },
  },
];

function renderTable(
  rows: Array<InfrastructureResource>,
  formatMemory?: (bytes: number) => string,
  getViewRoute?: (row: InfrastructureResource) => Route,
): void {
  render(
    <ResourceTable
      resources={rows}
      title="Tasks"
      description="The tasks of this swarm."
      showGroupColumn={false}
      showAge={false}
      columns={COLUMNS}
      formatMemory={formatMemory}
      getViewRoute={getViewRoute}
    />,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("a resource list draws its values as written", () => {
  test("a name sits in its own isolate, so '.mgr' never reads 'mgr.'", () => {
    renderTable([resource(".mgr", {})]);

    const name: HTMLElement = screen.getByText(".mgr");
    expect(name.tagName).toBe("BDI");
  });

  test("so does a name that links to its page", () => {
    renderTable([resource(".mgr", {})], undefined, (): Route => {
      return new Route("/dashboard/project/ceph/cluster/pools/1");
    });

    const name: HTMLElement = screen.getByText(".mgr");
    expect(name.tagName).toBe("BDI");
    expect(name.closest("a")).toHaveAttribute(
      "href",
      "/dashboard/project/ceph/cluster/pools/1",
    );
  });

  test("a column's value reads in its own direction", () => {
    renderTable([resource("osd.0", { latency: "3 / 4 ms" })]);

    const value: HTMLElement = within(rowOf("osd.0")).getByText("3 / 4 ms");
    expect(value.tagName).toBe("SPAN");
    expect(value).toHaveAttribute("dir", "auto");
  });

  test("a name column breaks after its own dots and slashes, whole and isolated", () => {
    renderTable([resource("shop_checkout.1", { image: IMAGE })]);

    const image: HTMLElement = within(rowOf("shop_checkout.1")).getByTestId(
      "resource-column-name",
    );
    expect(image.tagName).toBe("BDI");
    expect(image).toHaveTextContent(IMAGE);
    expect(image.className).toContain("[overflow-wrap:anywhere]");
    // "registry." "acme-swarm." "example/" "shop/" "checkout:2.7.0"
    expect(image.querySelectorAll("wbr")).toHaveLength(4);
    // Its column wraps rather than cutting the image short.
    expect(image.closest(".max-w-\\[16rem\\]")).not.toBeNull();
  });

  test("a name column with nothing to say is a plain dash, which a fold leaves out", () => {
    renderTable([resource("shop_web.2", {})]);

    const row: HTMLElement = rowOf("shop_web.2");
    expect(within(row).queryByTestId("resource-column-name")).toBeNull();
    // The dash the table draws for a value that is not there.
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("a reading shown with its column's name when folded moves whole", () => {
    renderTable([
      resource("rbd", { maxAvail: "9.2 TiB" }),
      resource("scratch", {}),
    ]);

    const reading: HTMLElement = within(rowOf("rbd")).getByText("9.2 TiB");
    expect(reading).toHaveClass("inline-block");
    // A row without the reading keeps the table's own dash, never a box.
    const dashes: Array<HTMLElement> = within(rowOf("scratch")).getAllByText(
      "—",
    );
    expect(dashes.length).toBeGreaterThan(0);
    for (const dash of dashes) {
      expect(dash).not.toHaveClass("inline-block");
    }
  });

  test("memory reads as written and in the product's own units", () => {
    renderTable(
      [resource("shop_checkout.2", {}, { usage: 493921239, utilization: 92 })],
      formatBytes,
    );

    const memory: HTMLElement = within(rowOf("shop_checkout.2")).getByText(
      "471 MiB",
    );
    expect(memory.tagName).toBe("BDI");
  });

  test("without its own units, memory keeps the table's", () => {
    renderTable([
      resource("pod-1", {}, { usage: 64 * 1024 * 1024, utilization: 12 }),
    ]);

    expect(within(rowOf("pod-1")).getByText("64.0 MB").tagName).toBe("BDI");
  });
});
