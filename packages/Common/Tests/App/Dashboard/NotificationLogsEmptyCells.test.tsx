import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
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
import { isDashText } from "../../../UI/Components/Detail/EmptyValue";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * #7264: THE LOG TABLES DRAW THE QUIET DASH IN EVERY EMPTY CELL.
 *
 * The SMS, call, email, push, webhook, Telegram, WhatsApp, workspace and
 * LLM logs set `noValueMessage: "-"` on some twenty columns (To, From,
 * Error Code, Channel, Model...), and drew a dark hyphen of their own there
 * beside the quiet dash (TableEmptyValue) of the row's other empty cells -
 * a summary's Error row in no channel showed "-" under Channel and "—"
 * under User (#7116). Every one of their columns, drawn for a log row that
 * holds nothing, now shows no hyphen of its own: the quiet dash, on a
 * laptop's row; and on a phone's card, a field left out.
 *
 * Each real table runs and hands its columns to ModelTable, replaced by a
 * recorder; each column is then drawn by the real TableBody, keyed as
 * ModelTable keys a column (its first field).
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

type LogRow = Record<string, unknown> & { _id: string };

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

import SmsLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable";
import CallLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/CallLogsTable";
import EmailLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable";
import PushLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/PushLogsTable";
import WebhookLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WebhookLogsTable";
import TelegramLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/TelegramLogsTable";
import WhatsAppLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WhatsAppLogsTable";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import LlmLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogsTable";

const PROJECT_ID: ObjectID = new ObjectID(
  "72640000-0000-4000-8000-0000000000a1",
);

const EMPTY_ROW: LogRow = { _id: "72640000-0000-4000-8000-0000000000a2" };

const TABLES: Array<[string, FunctionComponent<Record<string, never>>]> = [
  ["SMS logs", SmsLogsTable as FunctionComponent<Record<string, never>>],
  ["call logs", CallLogsTable as FunctionComponent<Record<string, never>>],
  ["email logs", EmailLogsTable as FunctionComponent<Record<string, never>>],
  ["push logs", PushLogsTable as FunctionComponent<Record<string, never>>],
  [
    "webhook logs",
    WebhookLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    "Telegram logs",
    TelegramLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    "WhatsApp logs",
    WhatsAppLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    "workspace logs",
    WorkspaceLogsTable as FunctionComponent<Record<string, never>>,
  ],
  ["LLM logs", LlmLogsTable as FunctionComponent<Record<string, never>>],
];

// A table's columns as ModelTable hands them to the table: keyed by their first field.
function columnsOf(
  table: FunctionComponent<Record<string, never>>,
): Columns<LogRow> {
  capturedColumns = [];
  render(React.createElement(table));
  cleanup();

  return capturedColumns
    .filter((column: CapturedColumn): boolean => {
      return Boolean(column.field && Object.keys(column.field).length > 0);
    })
    .map((column: CapturedColumn): Column<LogRow> => {
      const { field, ...rest } = column;

      return {
        ...rest,
        key: Object.keys(field || {})[0] as keyof LogRow,
      } as Column<LogRow>;
    });
}

function draw(column: Column<LogRow>, isMobile: boolean): HTMLElement {
  const body: ReactElement = (
    <TableBody<LogRow>
      id="log-empty-cells-body"
      data={[EMPTY_ROW]}
      columns={[column]}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={isMobile}
      isPhone={isMobile}
    />
  );

  return render(
    isMobile ? (
      <div data-testid="rows">{body}</div>
    ) : (
      <table data-testid="rows">{body}</table>
    ),
  ).getByTestId("rows");
}

// The marks drawn outside the quiet dash: a hyphen of a column's own.
function ownDashesOf(element: HTMLElement): Array<string> {
  const clone: HTMLElement = element.cloneNode(true) as HTMLElement;

  for (const quiet of Array.from(
    clone.querySelectorAll(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
  )) {
    quiet.remove();
  }

  return Array.from(clone.querySelectorAll("*"))
    .filter((node: Element): boolean => {
      return node.children.length === 0 && isDashText(node.textContent || "");
    })
    .map((node: Element): string => {
      return node.textContent || "";
    });
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(TABLES)(
  "the %s, for a row that holds nothing",
  (_name: string, table: FunctionComponent<Record<string, never>>) => {
    test("has columns to draw (the recorder caught them)", () => {
      expect(columnsOf(table).length).toBeGreaterThan(2);
    });

    test("no column writes a dash for its empty value: it is the quiet dash already", () => {
      expect(
        columnsOf(table)
          .filter((column: Column<LogRow>): boolean => {
            return isDashText(column.noValueMessage);
          })
          .map((column: Column<LogRow>): string => {
            return column.title;
          }),
      ).toEqual([]);
    });

    test("no cell on a laptop draws a hyphen of its own", () => {
      const own: Array<string> = [];

      for (const column of columnsOf(table)) {
        const rows: HTMLElement = draw(column, false);

        if (ownDashesOf(rows).length > 0) {
          own.push(column.title);
        }
        cleanup();
      }

      expect(own).toEqual([]);
    });

    test("no field on a phone's card draws a hyphen of its own", () => {
      const own: Array<string> = [];

      for (const column of columnsOf(table)) {
        const cards: HTMLElement = draw(column, true);

        if (ownDashesOf(cards).length > 0) {
          own.push(column.title);
        }
        cleanup();
      }

      expect(own).toEqual([]);
    });
  },
);

describe("the check can fail", () => {
  test("a column that drew its own '-' (as the To column did) is caught in the old way of drawing", () => {
    const rows: HTMLElement = render(
      <table>
        <tbody>
          <tr>
            <td>
              <span className="text-gray-500">-</span>
            </td>
          </tr>
        </tbody>
      </table>,
    ).container;

    expect(ownDashesOf(rows)).toEqual(["-"]);
  });

  test("the quiet dash itself is not a hyphen of a column's own", () => {
    const smsTo: Column<LogRow> | undefined = columnsOf(
      SmsLogsTable as FunctionComponent<Record<string, never>>,
    ).find((column: Column<LogRow>): boolean => {
      return column.title === "To";
    });

    expect(smsTo).toBeDefined();

    const rows: HTMLElement = draw(smsTo!, false);

    expect(
      rows.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
    ).not.toBeNull();
    expect(ownDashesOf(rows)).toEqual([]);
  });
});
