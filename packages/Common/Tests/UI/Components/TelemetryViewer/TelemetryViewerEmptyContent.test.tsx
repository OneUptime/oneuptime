import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * The shared telemetry shell's empty area.
 *
 * For most signals the default is right: an empty list means the filters are
 * too narrow, so it says so and invites the reader to widen them. For a
 * signal a project may not be SENDING at all — security events — that reading
 * is wrong, and the reader needs the setup guide instead. `emptyContent` is
 * the escape hatch for exactly that.
 *
 * This is a shared component with four consumers, so what matters as much as
 * the new branch is that the old one is untouched.
 */

interface Item {
  id: string;
}

function renderViewer(
  props: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>> = {},
): void {
  render(
    <TelemetryViewer<Item>
      items={[]}
      isLoading={false}
      renderRow={(item: Item): React.ReactElement => {
        return <span>{item.id}</span>;
      }}
      getRowKey={(item: Item): string => {
        return item.id;
      }}
      searchValue=""
      onSearchChange={(): void => {}}
      onSearchSubmit={(): void => {}}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      onTimeRangeChange={(): void => {}}
      page={1}
      pageSize={50}
      totalCount={0}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      /*
       * Named so the pagination footer reads "No events": its default label
       * is "results", which would collide with the empty block's own
       * "No results" and make these assertions ambiguous.
       */
      itemLabel="events"
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("the default empty area", () => {
  test("reads as 'nothing matched these filters'", () => {
    renderViewer();

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(
      screen.getByText("Try adjusting filters or time range."),
    ).toBeInTheDocument();
  });

  test("a caller can still name what is missing", () => {
    renderViewer({ emptyMessage: "No traces found" });

    expect(screen.getByText("No traces found")).toBeInTheDocument();
    expect(
      screen.getByText("Try adjusting filters or time range."),
    ).toBeInTheDocument();
  });
});

describe("emptyContent", () => {
  test("replaces the whole default block, hint included", () => {
    renderViewer({
      emptyMessage: "No results",
      emptyContent: <p>Nothing is sending yet — read the setup guide.</p>,
    });

    expect(
      screen.getByText("Nothing is sending yet — read the setup guide."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No results")).toBeNull();
    expect(
      screen.queryByText("Try adjusting filters or time range."),
    ).toBeNull();
  });

  test("is not rendered while the first page is still loading", () => {
    renderViewer({
      isLoading: true,
      emptyContent: <p>Nothing is sending yet.</p>,
    });

    expect(screen.queryByText("Nothing is sending yet.")).toBeNull();
  });

  test("is not rendered once there are rows", () => {
    renderViewer({
      items: [{ id: "row-1" }],
      emptyContent: <p>Nothing is sending yet.</p>,
    });

    expect(screen.getByText("row-1")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is sending yet.")).toBeNull();
  });

  /*
   * An error is the shell's own branch and wins over both: a reader whose
   * query failed must not be told the project has no data.
   */
  test("an error replaces the list area outright", () => {
    renderViewer({
      error: "clickhouse is down",
      emptyContent: <p>Nothing is sending yet.</p>,
    });

    expect(screen.getByText(/clickhouse is down/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing is sending yet.")).toBeNull();
  });
});
