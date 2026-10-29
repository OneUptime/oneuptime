import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import IconProp from "../../../Types/Icon/IconProp";
import LogsTable, {
  getLogsColumnWidthKind,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import { LOGS_TABLE_COLUMN_WIDTHS_KEY } from "../../../UI/Components/LogsViewer/LogsViewer";
import { getLogsAttributeColumnId } from "../../../UI/Components/LogsViewer/types";
import useResizableColumns, {
  ResizableColumns,
} from "../../../UI/Components/Table/ColumnResize/useResizableColumns";
import { ColumnWidthKind } from "../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { COLUMN_RESIZE_HANDLE_TEST_ID } from "../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import { RESET_COLUMN_WIDTHS_TEST_ID } from "../../../UI/Components/Table/ColumnResize/ResetColumnWidthsButton";
import Card from "../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import User from "../../../UI/Utils/User";
import { UserPreferenceType } from "../../../Utils/UserPreferences";

/*
 * The logs list sizes its columns as every table does: an edge on each
 * column it shows - a log attribute's too - named after the column; a
 * width kept drawn on the header cell and remembered per person; the room
 * sized columns leave going to a cell at each row's end, whose header holds
 * Reset column widths when the list's card has no ⋯ to keep it in (and no
 * column header draws a second one); an opened log's details spanning that
 * cell too. The time and the severity are never cut, the message wraps.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000cc";

// A log attribute's column is named after the attribute.
const METHOD_COLUMN: string = getLogsAttributeColumnId("http.method");

const COLUMNS: Array<string> = [
  "time",
  "severity",
  "service",
  "message",
  METHOD_COLUMN,
];

function makeLog(index: number): Log {
  const log: Log = new Log();

  log.body = `request ${index} finished`;
  log.time = new Date("2026-10-29T10:15:00.000Z");
  log.severityText = LogSeverity.Information;
  log.traceId = `trace-${index}`;

  return log;
}

const LOGS: Array<Log> = [makeLog(1), makeLog(2)];

const LogsList: FunctionComponent<{
  selectedLogId?: string | undefined;
}> = (props: { selectedLogId?: string | undefined }): ReactElement => {
  // As LogsViewer sizes its list.
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: LOGS_TABLE_COLUMN_WIDTHS_KEY,
    columns: COLUMNS.map(
      (columnId: string, index: number): { id: string; cellNumber: number } => {
        return { id: columnId, cellNumber: index + 1 };
      },
    ),
    hasOwnReset: true,
  });

  return (
    <LogsTable
      logs={LOGS}
      serviceMap={{}}
      isLoading={false}
      onRowClick={() => {}}
      selectedColumns={COLUMNS}
      selectedLogId={props.selectedLogId}
      renderExpandedContent={() => {
        return <div data-testid="log-details">details</div>;
      }}
      resizableColumns={resizableColumns}
    />
  );
};

const storageKey: string = `${UserPreferenceType.TableColumnWidths}.${PERSON}.${LOGS_TABLE_COLUMN_WIDTHS_KEY}`;

const keep: (widths: { [id: string]: number }) => void = (widths: {
  [id: string]: number;
}): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(widths));
};

const stored: () => { [id: string]: number } | null = (): {
  [id: string]: number;
} | null => {
  const value: string | null = window.localStorage.getItem(storageKey);

  return value ? (JSON.parse(value) as { [id: string]: number }) : null;
};

const headerCellOf: (title: string) => HTMLTableCellElement = (
  title: string,
): HTMLTableCellElement => {
  return screen.getByRole("columnheader", {
    name: title,
  }) as HTMLTableCellElement;
};

const edgeOf: (columnId: string) => HTMLElement = (
  columnId: string,
): HTMLElement => {
  return document.querySelector(
    `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"][data-column-id="${columnId}"]`,
  ) as HTMLElement;
};

beforeEach(() => {
  window.localStorage.clear();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("the logs list's columns", () => {
  test("each has an edge, a log attribute's too, named after its column", () => {
    render(<LogsList />);

    expect(
      Array.from(
        document.querySelectorAll(
          `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"]`,
        ),
      ).map((edge: Element): string | null => {
        return edge.getAttribute("data-column-id");
      }),
    ).toEqual(COLUMNS);

    expect(edgeOf("time")).toHaveAttribute(
      "aria-label",
      "Resize the Time column",
    );
    expect(edgeOf(METHOD_COLUMN)).toHaveAttribute(
      "aria-label",
      "Resize the http.method column",
    );
    // The sortable Time column is named by its title alone.
    expect(headerCellOf("Time")).toHaveAttribute("aria-label", "Time");
  });

  test("the time and the severity are never cut, the message wraps, any other value gives way", () => {
    expect(getLogsColumnWidthKind("time")).toBe(ColumnWidthKind.Whole);
    expect(getLogsColumnWidthKind("severity")).toBe(ColumnWidthKind.Whole);
    expect(getLogsColumnWidthKind("message")).toBe(ColumnWidthKind.Prose);
    expect(getLogsColumnWidthKind("service")).toBe(ColumnWidthKind.Text);
    expect(getLogsColumnWidthKind(METHOD_COLUMN)).toBe(ColumnWidthKind.Text);
  });

  test("a width kept is drawn on the header cell and remembered per person", () => {
    render(<LogsList />);

    act(() => {
      fireEvent.keyDown(edgeOf("message"), { key: "ArrowRight" });
    });
    act(() => {
      fireEvent.keyUp(edgeOf("message"), { key: "ArrowRight" });
    });

    const width: string = headerCellOf("Message").style.width;

    expect(width).toMatch(/^\d+px$/);
    expect(stored()).toEqual({ message: parseInt(width, 10) });
  });

  test("a kept time is drawn whole: no most width", () => {
    keep({ time: 220 });

    render(<LogsList />);

    expect(headerCellOf("Time").style.width).toBe("220px");
    expect(headerCellOf("Time").style.maxWidth).toBe("");
  });
});

describe("the room the logs list's sized columns leave", () => {
  test("nothing ends a row while no column is sized", () => {
    render(<LogsList />);

    expect(screen.queryByTestId("logs-table-end-filler")).toBeNull();
  });

  test("goes to a cell at each row's end, whose header holds the list's one Reset column widths", () => {
    keep({ message: 400 });

    render(<LogsList />);

    const filler: HTMLElement = screen.getByTestId("logs-table-end-filler");
    const reset: HTMLElement = within(filler).getByRole("button", {
      name: "Reset column widths",
    });

    // One cell more in every row than the list has columns.
    for (const row of Array.from(document.querySelectorAll("tbody tr"))) {
      expect(row.querySelectorAll("td")).toHaveLength(COLUMNS.length + 1);
    }

    // The list draws it once: no column header draws another.
    expect(
      document.querySelectorAll(
        `[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).toHaveLength(1);

    act(() => {
      fireEvent.click(reset);
    });

    expect(headerCellOf("Message").style.width).toBe("");
    expect(stored()).toBeNull();
    expect(screen.queryByTestId("logs-table-end-filler")).toBeNull();
  });

  test("an opened log's details span the end cell too", () => {
    keep({ message: 400 });

    const rowId: string = "trace-1";

    render(<LogsList selectedLogId={rowId} />);

    const details: HTMLElement = screen.getByTestId("log-details");

    expect(details.closest("td")).toHaveAttribute(
      "colspan",
      String(COLUMNS.length + 1),
    );
  });

  test("in a card with a ⋯, the reset is there and the end cell holds nothing", () => {
    keep({ message: 400 });

    render(
      <Card
        title="Logs"
        buttons={[
          <CardMoreMenu key="more">
            {[
              <MoreMenuItem
                key="refresh"
                text="Refresh"
                icon={IconProp.Refresh}
                onClick={() => {}}
              />,
            ]}
          </CardMoreMenu>,
        ]}
      >
        <LogsList />
      </Card>,
    );

    const filler: HTMLElement = screen.getByTestId("logs-table-end-filler");

    expect(filler).toHaveAttribute("aria-hidden", "true");
    expect(within(filler).queryByRole("button")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });

    expect(
      within(screen.getByRole("menu")).getByText("Reset column widths"),
    ).toBeInTheDocument();
  });
});
