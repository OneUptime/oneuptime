import "@testing-library/jest-dom";
import { cleanup, render, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TableBody from "../../../UI/Components/Table/TableBody";
import Columns from "../../../UI/Components/Table/Types/Columns";
import Column from "../../../UI/Components/Table/Types/Column";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * #7116: a workspace summary that cannot be sent as it is set up leaves an
 * Error row in its Notification Logs that names no channel - it was never
 * posted in one. The Workspace Logs table's Channel column drew its own
 * "-" for it, a hyphen as dark as a channel's name beside the quiet dash
 * of the row's empty User cell. It now shows the quiet dash every empty
 * cell has (TableEmptyValue), on a laptop's row and a phone's card.
 *
 * The real WorkspaceLogsTable runs and hands its columns to ModelTable,
 * which is replaced by a recorder; its Channel column is then drawn by the
 * real TableBody, keyed as ModelTable keys a column (its first field).
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

type LogRow = {
  _id: string;
  channelName?: string | undefined;
};

type CapturedColumn = Omit<Column<LogRow>, "key"> & {
  field?: Record<string, unknown> | undefined;
};

let capturedColumns: Array<CapturedColumn> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns: Array<CapturedColumn> }) => {
      capturedColumns = props.columns;
      return null;
    },
  };
});

import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";

const PROJECT_ID: ObjectID = new ObjectID(
  "71160000-0000-4000-8000-0000000000c1",
);

// The Channel column as ModelTable hands it to the table: keyed by its field.
function channelColumn(): Column<LogRow> {
  const column: CapturedColumn | undefined = capturedColumns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Channel";
    },
  );

  if (!column) {
    throw new Error("The Workspace Logs table has no Channel column");
  }

  const { field, ...rest } = column;

  return {
    ...rest,
    key: Object.keys(field || {})[0] as keyof LogRow,
  } as Column<LogRow>;
}

// One log row, drawn through the real table body: a laptop's row or a phone's card.
function drawCell(data: {
  column: Column<LogRow>;
  row: LogRow;
  isMobile: boolean;
}): HTMLElement {
  const columns: Columns<LogRow> = [data.column];
  const body: ReactElement = (
    <TableBody<LogRow>
      id="workspace-logs-body"
      data={[data.row]}
      columns={columns}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={data.isMobile}
      isPhone={data.isMobile}
    />
  );

  return render(
    data.isMobile ? (
      <div data-testid="rows">{body}</div>
    ) : (
      <table data-testid="rows">{body}</table>
    ),
  ).getByTestId("rows");
}

const IN_NO_CHANNEL: LogRow = { _id: "71160000-0000-4000-8000-0000000000c2" };
const IN_OPS: LogRow = {
  _id: "71160000-0000-4000-8000-0000000000c3",
  channelName: "#ops",
};

beforeEach(() => {
  capturedColumns = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  render(<WorkspaceLogsTable />);
  cleanup();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Workspace Logs table's Channel cell, for a row in no channel", () => {
  test("REGRESSION: on a laptop, the quiet dash an empty cell has - not a hyphen of its own", () => {
    const rows: HTMLElement = drawCell({
      column: channelColumn(),
      row: IN_NO_CHANNEL,
      isMobile: false,
    });

    expect(within(rows).getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeVisible();
    expect(within(rows).queryByText("-")).toBeNull();
  });

  test("on a phone's card, no hyphen either", () => {
    const rows: HTMLElement = drawCell({
      column: channelColumn(),
      row: IN_NO_CHANNEL,
      isMobile: true,
    });

    expect(within(rows).queryByText("-")).toBeNull();
  });

  test("a row in a channel names it, as it always did", () => {
    const rows: HTMLElement = drawCell({
      column: channelColumn(),
      row: IN_OPS,
      isMobile: false,
    });

    expect(within(rows).getByText("#ops")).toBeVisible();
    expect(within(rows).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  /*
   * #7264: the column's own "-" is the quiet dash too now, so the fix this
   * table took (dropping it) and the table's own rule agree.
   */
  test("a '-' of the column's own is the quiet dash as well, not a hyphen", () => {
    const rows: HTMLElement = drawCell({
      column: { ...channelColumn(), noValueMessage: "-" },
      row: IN_NO_CHANNEL,
      isMobile: false,
    });

    expect(within(rows).getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeVisible();
    expect(within(rows).queryByText("-")).toBeNull();
  });

  test("the check can fail: a column with words of its own draws them, and no quiet dash", () => {
    const rows: HTMLElement = drawCell({
      column: { ...channelColumn(), noValueMessage: "Not posted" },
      row: IN_NO_CHANNEL,
      isMobile: false,
    });

    expect(within(rows).getByText("Not posted")).toBeVisible();
    expect(within(rows).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
  });
});
