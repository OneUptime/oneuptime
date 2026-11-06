import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test, beforeEach } from "@jest/globals";
import TelemetryFacetSidebar, {
  DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX,
  MIN_FACET_SIDEBAR_WIDTH_IN_PX,
  MAX_FACET_SIDEBAR_WIDTH_IN_PX,
  FACET_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import { FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID } from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebarResizeHandle";
import LocalStorage from "../../../../UI/Utils/LocalStorage";
import {
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";

describe("TelemetryFacetSidebar resize (#5773)", () => {
  const sampleConfigs: Array<FacetConfig> = [
    {
      key: "service",
      title: "Services",
      priority: 1,
      valueDisplayMap: {
        "service-1": "very-long-service-name-that-needs-resizing-space",
      },
    },
  ];

  const sampleData: FacetData = {
    service: [
      {
        value: "service-1",
        count: 42,
      },
    ],
  };

  beforeEach(() => {
    LocalStorage.removeItem(FACET_SIDEBAR_WIDTH_STORAGE_KEY);
  });

  test("renders with default width when no storage value exists", () => {
    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );

    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute(
      "aria-valuenow",
      DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX.toString(),
    );
  });

  test("initializes from LocalStorage when valid width is saved", () => {
    LocalStorage.setItem(FACET_SIDEBAR_WIDTH_STORAGE_KEY, 320);

    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe("320px");
  });

  test("clamps initial width within bounds if stored value is out of range", () => {
    LocalStorage.setItem(FACET_SIDEBAR_WIDTH_STORAGE_KEY, 9999);

    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${MAX_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );
  });

  test("keyboard navigation adjusts width with ArrowLeft and ArrowRight", () => {
    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX + 16}px`,
    );

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );
  });

  test("Home and End keys jump to minimum and maximum width", () => {
    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );

    fireEvent.keyDown(handle, { key: "Home" });
    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${MIN_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );

    fireEvent.keyDown(handle, { key: "End" });
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${MAX_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );
  });

  test("double-clicking resize handle resets to default width", () => {
    LocalStorage.setItem(FACET_SIDEBAR_WIDTH_STORAGE_KEY, 380);

    const { container } = render(
      <TelemetryFacetSidebar
        facetConfigs={sampleConfigs}
        facetData={sampleData}
        isLoading={false}
        onIncludeFilter={() => {}}
        onRemoveFilter={() => {}}
      />,
    );

    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );
    fireEvent.doubleClick(handle);

    const outer: HTMLElement = container.firstChild as HTMLElement;
    expect(outer.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_FACET_SIDEBAR_WIDTH_IN_PX}px`,
    );
  });
});
