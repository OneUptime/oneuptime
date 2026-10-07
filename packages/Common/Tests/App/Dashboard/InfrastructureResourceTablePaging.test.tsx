import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import ResourceTable, {
  InfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import {
  choosePageSize,
  columnTexts,
  nextButton,
  nextPage,
  numberedNames,
  pageSizeSelect,
  pagingSummary,
} from "./TablePagingHarness";

/*
 * The shared Infrastructure ResourceTable, rendered for real: the Kubernetes,
 * Docker Swarm, Proxmox, Ceph and VMware lists all page through it. It pages
 * the resources its page hands it client-side, so the page size is its own
 * to hold - the footer's rows-per-page picker only reports what the reader
 * chose.
 *
 * It used to slice a fixed 25 rows and tell the footer the page size was the
 * number of rows on screen. The picker did nothing, and a short last page
 * threw the footer off: rows 26 to 30 read "Showing 6-10 of 30", the picker
 * read 5, and the footer offered pages that were empty.
 */

const TABLE_ID: string = "infrastructure-pods-table";

const THIRTY_PODS: Array<string> = numberedNames("pod", 30);

function podsNamed(names: Array<string>): Array<InfrastructureResource> {
  return names.map((name: string): InfrastructureResource => {
    return {
      name: name,
      namespace: "shop",
      cpuUtilization: 12.5,
      memoryUsageBytes: 64 * 1024 * 1024,
      memoryLimitBytes: null,
      status: "Running",
      age: "2d",
      additionalAttributes: {},
    };
  });
}

function table(names: Array<string>): React.ReactElement {
  return (
    <ResourceTable
      resources={podsNamed(names)}
      title="Pods"
      description="Pods in the cluster."
    />
  );
}

// The name column, top to bottom.
function visibleNames(): Array<string> {
  return columnTexts(TABLE_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("paging through an Infrastructure resource list", () => {
  test("shows 25 rows a page, and the last page's footer counts on from 25", async () => {
    render(table(THIRTY_PODS));

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(0, 25));
    expect(pagingSummary()).toBe("Showing 1-25 of 30 pods");

    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(25));
    // Not "Showing 6-10 of 30": the five rows here are 26 to 30.
    expect(pagingSummary()).toBe("Showing 26-30 of 30 pods");
    expect(pageSizeSelect()).toHaveValue("25");
    expect(nextButton()).toBeDisabled();
  });

  test("the rows-per-page picker really changes the page size", async () => {
    render(table(THIRTY_PODS));

    await choosePageSize(50);

    expect(pageSizeSelect()).toHaveValue("50");
    // All thirty on one page, not the 25 the list opened with.
    expect(visibleNames()).toEqual(THIRTY_PODS);
    expect(pagingSummary()).toBe("Showing 1-30 of 30 pods");
    expect(nextButton()).toBeDisabled();
  });

  test("a smaller page size pages in smaller steps, from the first page", async () => {
    render(table(THIRTY_PODS));
    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(25));

    // Row 26 of a 25-row page is not row 26 of a 10-row one: back to the top.
    await choosePageSize(10);

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(0, 10));

    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(10, 20));

    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(20));
    expect(pagingSummary()).toBe("Showing 21-30 of 30 pods");
    expect(nextButton()).toBeDisabled();
  });

  test("a shorter list from the page above does not strand the reader past its end", async () => {
    const view: RenderResult = render(table(THIRTY_PODS));
    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(25));

    // The page refetched, and ten pods are left: one page of them.
    view.rerender(table(THIRTY_PODS.slice(0, 10)));

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(0, 10));
    expect(pagingSummary()).toBe("Showing 1-10 of 10 pods");
  });

  test("the page size the reader picked outlives a refetched list", async () => {
    const view: RenderResult = render(table(THIRTY_PODS));
    await choosePageSize(10);
    await nextPage();
    await nextPage();

    expect(visibleNames()).toEqual(THIRTY_PODS.slice(20));

    // Fifteen pods are two pages of ten: the reader lands on the last one.
    view.rerender(table(THIRTY_PODS.slice(0, 15)));

    expect(pageSizeSelect()).toHaveValue("10");
    expect(visibleNames()).toEqual(THIRTY_PODS.slice(10, 15));
    expect(pagingSummary()).toBe("Showing 11-15 of 15 pods");
    expect(nextButton()).toBeDisabled();
  });
});
