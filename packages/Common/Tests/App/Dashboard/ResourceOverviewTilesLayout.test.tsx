import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ResourceOverview's golden-metric tiles, laid out by the overview's own
 * width (every telemetry overview page: services, hosts, databases, queues
 * and more).
 *
 *   - Four to a row only where the overview holds four tiles of some 200px:
 *     a container query on the tiles' frame, never the screen's width. A
 *     1024px window beside a record page's side menu leaves the overview
 *     some 680px; four tiles of 158px broke a German "Verbraucht" mid-word
 *     and cut every line under a value. The skeleton the tiles load as a
 *     group takes the same grid, so nothing moves when they land.
 *   - The line under a value wraps to two lines instead of being cut on one:
 *     a phone's two columns cut "broker metrics; 18 throttled" before its
 *     number, and a tap has no hover to read the rest.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import ResourceOverview, {
  RESOURCE_OVERVIEW_DETAILS_DESCRIPTION,
  RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME,
  RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME,
  ResourceOverviewTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import IconProp from "../../../Types/Icon/IconProp";

const VIEWPORT_COLUMNS: RegExp = /(?:^|\s)(?:sm|md|lg|xl|2xl):grid-cols-/;

const TILES: Array<ResourceOverviewTile> = [
  "Published",
  "Consumed",
  "Errors",
  "p95 processing time",
].map((title: string): ResourceOverviewTile => {
  return {
    title: title,
    value: "36",
    icon: IconProp.Clock,
    iconColor: "sky",
    sublabel: `${title}: broker metrics; 18 throttled`,
  };
});

function renderOverview(
  tiles: Array<ResourceOverviewTile>,
  options: { tilesLoading?: boolean } = {},
): void {
  render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <ResourceOverview
        icon={IconProp.QueueList}
        title="orders"
        identifier="orders"
        identifierLabel="destination"
        status="connected"
        lastSeenAt={undefined}
        chips={[]}
        tiles={tiles}
        tilesLoading={options.tilesLoading}
        detailRows={[]}
        detailsDescription={RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}
      />
    </MemoryRouter>,
  );
}

// Every element whose class list is exactly the tiles' grid.
function tileGrids(): Array<HTMLElement> {
  return Array.from(document.body.querySelectorAll<HTMLElement>("div")).filter(
    (element: HTMLElement): boolean => {
      return element.className === RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME;
    },
  );
}

afterEach(() => {
  cleanup();
});

describe("ResourceOverview tiles, by the overview's own width", () => {
  test("four to a row only where the overview holds four: a container query, never the screen", () => {
    renderOverview(TILES);

    const grid: HTMLElement = screen.getByTestId("resource-overview-tiles");
    expect(grid.className).toBe(RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME);
    expect(grid).toHaveClass(
      "grid",
      "grid-cols-2",
      "[@container(min-width:52rem)]:grid-cols-4",
    );
    expect(grid.className).not.toMatch(VIEWPORT_COLUMNS);
    // The frame it measures is the overview's column, not the grid itself.
    const frame: HTMLElement = grid.parentElement!;
    expect(frame.className).toBe(RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME);
    expect(frame).toHaveClass("mb-6", "[container-type:inline-size]");
    expect(within(grid).getAllByText("36")).toHaveLength(4);
  });

  test("the skeleton of tiles loading as a group takes the same grid", () => {
    renderOverview([], { tilesLoading: true });

    expect(screen.queryByTestId("resource-overview-tiles")).toBeNull();
    const grids: Array<HTMLElement> = tileGrids();
    expect(grids).toHaveLength(1);
    expect(grids[0]!.children).toHaveLength(4);
    expect(grids[0]!.parentElement!.className).toBe(
      RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME,
    );
  });

  test("the detector knows a grid counted by the screen", () => {
    expect(VIEWPORT_COLUMNS.test("grid grid-cols-2 gap-4 lg:grid-cols-4")).toBe(
      true,
    );
    expect(VIEWPORT_COLUMNS.test(RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME)).toBe(
      false,
    );
  });
});

describe("the line under a tile's value", () => {
  test("wraps to two lines rather than being cut on one", () => {
    renderOverview(TILES);

    const line: HTMLElement = screen.getByText(
      "Errors: broker metrics; 18 throttled",
    );
    expect(line).toHaveClass("line-clamp-2", "break-words");
    expect(line).not.toHaveClass("truncate");
  });

  test("a tile without one keeps the line's height, so values line up", () => {
    renderOverview([{ ...TILES[0]!, sublabel: undefined }, TILES[1]!]);

    const grid: HTMLElement = screen.getByTestId("resource-overview-tiles");
    const empty: HTMLElement | undefined = Array.from(
      grid.querySelectorAll<HTMLElement>("div"),
    ).find((element: HTMLElement): boolean => {
      return element.textContent === " ";
    });
    expect(empty).toBeDefined();
    expect(empty).toHaveClass("mt-1", "text-xs");
  });
});
