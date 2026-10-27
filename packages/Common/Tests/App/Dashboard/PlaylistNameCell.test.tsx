import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import React, { ReactElement } from "react";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import { PlaylistNameCell } from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Playlists/Playlists";

/*
 * A playlist's row in Dashboards -> Playlists (the UI review of #5235): its
 * name, and what it plays - "3 dashboards, 1 minute each" - in a column of
 * its own. Below lg that column is left out (hideBelowLargeScreen): beside
 * the side menu a tablet's card is 430 to 700px wide, and the phrase ran
 * under the sticky Play buttons. The name's cell then says it under the
 * name - on a tablet's row and a phone's card alike - and only then, so a
 * row never says it twice.
 */

const SUMMARY: string = "3 dashboards, 1 minute each";

function renderCell(options: {
  isTableCell: boolean;
  areColumnsFolded: boolean;
  hasDashboards?: boolean;
  summary?: string;
}): void {
  const cell: ReactElement = (
    <PlaylistNameCell
      name="NOC wall"
      summary={options.summary || SUMMARY}
      hasDashboards={options.hasDashboards ?? true}
    />
  );

  render(
    <TableCellContext.Provider value={options.isTableCell}>
      <TableFoldedColumnsContext.Provider value={options.areColumnsFolded}>
        <div data-testid="cell">{cell}</div>
      </TableFoldedColumnsContext.Provider>
    </TableCellContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("a playlist's name in its row", () => {
  test("from lg up the row has its own Dashboards column: the cell is the name alone", () => {
    renderCell({ isTableCell: true, areColumnsFolded: false });

    expect(screen.getByTestId("cell")).toHaveTextContent(/^NOC wall$/);
    expect(screen.queryByTestId("playlist-summary")).toBeNull();
  });

  test("below lg, what it plays goes under the name", () => {
    renderCell({ isTableCell: true, areColumnsFolded: true });

    const summary: HTMLElement = screen.getByTestId("playlist-summary");

    expect(summary).toHaveTextContent(SUMMARY);
    expect(screen.getByText("NOC wall")).toBeInTheDocument();
    // Under it: the name first, the phrase after.
    expect(
      screen.getByText("NOC wall").compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the phrase is a quiet second line that wraps rather than ending in '...'", () => {
    renderCell({ isTableCell: true, areColumnsFolded: true });

    const summary: HTMLElement = screen.getByTestId("playlist-summary");

    // The cell's own line is the name's: the phrase is lighter and smaller.
    expect(summary.className).toContain("font-normal");
    expect(summary.className).toContain("text-sm");
    expect(summary.className).toContain("text-gray-600");
    // A table cell is nowrap; the phrase breaks into two even lines instead.
    expect(summary.className).toContain("whitespace-normal");
    expect(summary.className).toContain("text-balance");
    expect(summary.className).not.toContain("truncate");
  });

  test("a playlist with no dashboards says so a shade lighter", () => {
    renderCell({
      isTableCell: true,
      areColumnsFolded: true,
      hasDashboards: false,
      summary: "No dashboards",
    });

    const summary: HTMLElement = screen.getByTestId("playlist-summary");

    expect(summary).toHaveTextContent("No dashboards");
    expect(summary.className).toContain("text-gray-500");
  });

  test("outside a table's cell - a dialog over it - nothing folds", () => {
    renderCell({ isTableCell: false, areColumnsFolded: true });

    expect(screen.queryByTestId("playlist-summary")).toBeNull();
  });
});
