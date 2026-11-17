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
import { getDrawnTableColumns } from "../../../UI/Components/Table/FoldedColumns";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import Columns from "../../../UI/Components/Table/Types/Columns";
import Column from "../../../UI/Components/Table/Types/Column";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  SLACK_CHANNEL_ARCHIVED_REFUSAL,
  SLACK_RATE_LIMITED_REFUSAL,
} from "../../../Utils/Workspace/WorkspaceRefusal";

/*
 * #7121: THE REASON COLUMN GIVES WAY FIRST ON A NARROW TABLE.
 *
 * The Workspace Logs table's Reason column (WorkspaceLogsReason) is the
 * widest it has: on a table narrower than its rows - beside a side menu,
 * on a tablet - it is the one folded away, and each Error row's reason is
 * drawn under its Status instead. On a phone's card it is a field of the
 * card, which a row that went out leaves out.
 *
 * The real WorkspaceLogsTable runs and hands its columns to ModelTable,
 * which is replaced by a recorder; those columns are then drawn by the
 * real TableBody - unfolded, folded and as a card - keyed as ModelTable
 * keys a column (its first field).
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
  status?: string | undefined;
  statusMessage?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
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
  "71210000-0000-4000-8000-0000000000c1",
);

// A column as ModelTable hands it to the table: keyed by its first field.
function asTableColumn(column: CapturedColumn): Column<LogRow> {
  const { field, ...rest } = column;

  return {
    ...rest,
    key: Object.keys(field || {})[0] as keyof LogRow,
  } as Column<LogRow>;
}

function columnTitled(title: string): Column<LogRow> {
  const column: CapturedColumn | undefined = capturedColumns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  if (!column) {
    throw new Error(`The Workspace Logs table has no ${title} column`);
  }

  return asTableColumn(column);
}

const ARCHIVED: LogRow = {
  _id: "71210000-0000-4000-8000-0000000000c2",
  channelName: "old-incidents",
  status: WorkspaceNotificationStatus.Error,
  workspaceType: WorkspaceType.Slack,
  statusMessage: "Error from Slack is_archived",
};

const RATE_LIMITED: LogRow = {
  _id: "71210000-0000-4000-8000-0000000000c3",
  channelName: "alerts",
  status: WorkspaceNotificationStatus.Error,
  workspaceType: WorkspaceType.Slack,
  statusMessage:
    "Slack asked OneUptime to slow down. Wait a minute, then try again. Slack said: ratelimited.",
};

const POSTED: LogRow = {
  _id: "71210000-0000-4000-8000-0000000000c4",
  channelName: "incidents",
  status: WorkspaceNotificationStatus.Success,
  workspaceType: WorkspaceType.Slack,
  statusMessage: "Message posted to workspace channel",
};

// The table's Channel, Status and Reason columns, drawn as the table draws them.
function draw(data: { isFolded: boolean; isMobile: boolean }): HTMLElement {
  const drawn: ReturnType<typeof getDrawnTableColumns<LogRow>> =
    getDrawnTableColumns<LogRow>(
      [columnTitled("Channel"), columnTitled("Status"), columnTitled("Reason")],
      data.isFolded,
      data.isMobile,
    );

  const columns: Columns<LogRow> = drawn.columns;

  const body: ReactElement = (
    <TableBody<LogRow>
      id="workspace-logs-body"
      data={[ARCHIVED, RATE_LIMITED, POSTED]}
      columns={columns}
      foldedColumns={drawn.foldedColumns}
      areColumnsFolded={drawn.areColumnsFolded}
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

function rowOf(rows: HTMLElement, channel: string): HTMLElement {
  return within(rows).getByText(channel).closest("tr") as HTMLElement;
}

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

describe("the Workspace Logs table's Reason column on a narrow table", () => {
  test("is the column that folds, and it folds under Status", () => {
    const titles: Array<string> = capturedColumns.map(
      (column: CapturedColumn): string => {
        return column.title;
      },
    );

    expect(titles.indexOf("Reason")).toBe(titles.indexOf("Status") + 1);

    const reason: Column<LogRow> = columnTitled("Reason");

    expect(reason.hideBelowLargeScreen).toBe(true);
    expect(reason.foldInto).toBe("status");
    // Prose wraps inside its column rather than running over the next one.
    expect(reason.wrapContent).toBe(true);

    const foldable: Array<string> = capturedColumns
      .filter((column: CapturedColumn): boolean => {
        return Boolean(column.hideBelowLargeScreen);
      })
      .map((column: CapturedColumn): string => {
        return column.title;
      });

    expect(foldable).toEqual(["Reason"]);
  });

  test("folded: each Error row's reason is drawn under its status, in its Status cell", () => {
    const rows: HTMLElement = draw({ isFolded: true, isMobile: false });

    const archived: NodeListOf<HTMLTableCellElement> = rowOf(
      rows,
      "old-incidents",
    ).querySelectorAll("td");

    // Channel and Status: the reason has no cell of its own.
    expect(archived).toHaveLength(2);
    expect(archived[1]).toHaveTextContent(WorkspaceNotificationStatus.Error);
    expect(archived[1]).toHaveTextContent(
      SLACK_CHANNEL_ARCHIVED_REFUSAL.reason,
    );

    expect(rowOf(rows, "alerts").querySelectorAll("td")[1]).toHaveTextContent(
      SLACK_RATE_LIMITED_REFUSAL.reason,
    );
  });

  test("folded: a row that went out has nothing under its status", () => {
    const rows: HTMLElement = draw({ isFolded: true, isMobile: false });

    const posted: HTMLElement = rowOf(rows, "incidents");

    expect(posted).not.toHaveTextContent("Message posted");
    expect(posted).not.toHaveTextContent(SLACK_RATE_LIMITED_REFUSAL.reason);
  });

  test("the check can fail: unfolded, the reason has a cell of its own", () => {
    const rows: HTMLElement = draw({ isFolded: false, isMobile: false });

    const archived: NodeListOf<HTMLTableCellElement> = rowOf(
      rows,
      "old-incidents",
    ).querySelectorAll("td");

    expect(archived).toHaveLength(3);
    expect(archived[1]).not.toHaveTextContent(
      SLACK_CHANNEL_ARCHIVED_REFUSAL.reason,
    );
    expect(archived[2]).toHaveTextContent(
      SLACK_CHANNEL_ARCHIVED_REFUSAL.reason,
    );
    expect(
      within(rowOf(rows, "incidents")).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeVisible();
  });
});

describe("the Workspace Logs table's Reason on a phone's card", () => {
  test("an Error row's card says why; a row that went out says nothing of a reason", () => {
    const rows: HTMLElement = draw({ isFolded: true, isMobile: true });

    expect(rows).toHaveTextContent(SLACK_CHANNEL_ARCHIVED_REFUSAL.reason);
    expect(rows).toHaveTextContent(SLACK_RATE_LIMITED_REFUSAL.reason);
    expect(rows).not.toHaveTextContent("Message posted");
    // Slack's codes are support's: under the pointer, never on the card.
    expect(rows).not.toHaveTextContent("Error from Slack");
    expect(rows).not.toHaveTextContent("ratelimited");
  });
});
