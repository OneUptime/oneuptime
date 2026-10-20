import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A RUN THAT WAITS TO PAGE, IN THE EXECUTION LOGS.
 *
 * An on-call rule that pages only during working hours holds the runs it
 * starts outside them. Such a run's row says so where its status is: the
 * Waiting pill, and under it what it waits for and when paging starts - its
 * status message, the words the record's feed says too - so nobody has to
 * open View Status Message to learn why nobody was paged at 2am.
 */

const modelTableMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown): ReactElement => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock("../../../UI/Components/Pill/Pill", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <span data-testid="pill">{props.text}</span>;
    },
  };
});

import ExecutionLogsTable, {
  ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const WAITING_MESSAGE: string =
  "Waiting for working hours. Paging starts Tue 09:00 (Europe/London).";

interface RecordedColumn {
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedFilter {
  title: string;
  filterDropdownOptions?: Array<{ label: string; value: unknown }>;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  filters: Array<RecordedFilter>;
}

function table(): RecordedTable {
  render(<ExecutionLogsTable />);

  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

function statusCell(log: OnCallDutyPolicyExecutionLog): {
  container: HTMLElement;
} {
  const status: RecordedColumn | undefined = table().columns.find(
    (column: RecordedColumn): boolean => {
      return column.title === "Status";
    },
  );

  cleanup();

  return render(status!.getElement!(log));
}

function run(
  status: OnCallDutyPolicyStatus,
  statusMessage?: string,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = "aaaaaaaa-0000-4000-8000-000000000001";
  log.status = status;

  if (statusMessage !== undefined) {
    log.statusMessage = statusMessage;
  }

  return log;
}

beforeEach(() => {
  modelTableMock.mockClear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call-duty`);
});

afterEach(() => {
  cleanup();
});

describe("a waiting run's status", () => {
  test("is the Waiting pill, with what it waits for and when paging starts under it", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(OnCallDutyPolicyStatus.Waiting, WAITING_MESSAGE),
    );

    expect(
      cell.container.querySelector("[data-testid=pill]"),
    ).toHaveTextContent("Waiting");

    const message: HTMLElement | null = cell.container.querySelector(
      "[data-testid=execution-log-waiting-message]",
    );

    expect(message).toHaveTextContent(WAITING_MESSAGE);
    expect(message!.className).toBe(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
  });

  test("with no message, is the pill alone", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(OnCallDutyPolicyStatus.Waiting),
    );

    expect(cell.container).toHaveTextContent("Waiting");
    expect(
      cell.container.querySelector(
        "[data-testid=execution-log-waiting-message]",
      ),
    ).toBeNull();
  });

  test("is not an error: a run that waits is not one that failed", () => {
    expect(
      statusCell(run(OnCallDutyPolicyStatus.Waiting, WAITING_MESSAGE))
        .container,
    ).not.toHaveTextContent(OnCallDutyPolicyStatus.Error);
  });

  test("a run that pages shows its status as it always has, with no message under it", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(
        OnCallDutyPolicyStatus.Executing,
        "First escalation rule executed...",
      ),
    );

    expect(cell.container).toHaveTextContent(OnCallDutyPolicyStatus.Executing);
    expect(cell.container).not.toHaveTextContent("First escalation rule");
  });

  test("the Status filter offers Waiting", () => {
    const status: RecordedFilter | undefined = table().filters.find(
      (filter: RecordedFilter): boolean => {
        return filter.title === "Status";
      },
    );

    expect(
      (status?.filterDropdownOptions || []).map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toContain(OnCallDutyPolicyStatus.Waiting);
  });
});
