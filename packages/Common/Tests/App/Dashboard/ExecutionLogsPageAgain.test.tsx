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
 * A PAGE AGAIN, IN THE EXECUTION LOGS (issue #5123).
 *
 * A policy whose acknowledgement timeout ran out pages again about a record
 * somebody acknowledged earlier: a run of its own, a row of its own, beside
 * the run before it about the same record. Its row says what it is where
 * its status is - "Paged again (1 of 5)" under the pill - so the two rows
 * read apart without opening either.
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
  ON_CALL_LOGS_PAGED_AGAIN,
  ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111112";

interface RecordedColumn {
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: Record<string, unknown>;
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
  pageAgainNumber?: number,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = "aaaaaaaa-0000-4000-8000-000000000002";
  log.status = status;

  if (pageAgainNumber !== undefined) {
    log.pageAgainNumber = pageAgainNumber;
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

describe("a page again's status", () => {
  test("is its pill, with which time it pages again under it", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(OnCallDutyPolicyStatus.Executing, 1),
    );

    expect(
      cell.container.querySelector("[data-testid=pill]"),
    ).toHaveTextContent(OnCallDutyPolicyStatus.Executing);

    const note: HTMLElement | null = cell.container.querySelector(
      "[data-testid=execution-log-paged-again]",
    );

    expect(note).toHaveTextContent(/^Paged again \(1 of 5\)$/);
    // Drawn as the waiting run's note is: small, grey, wrapping under the pill.
    expect(note!.className).toBe(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
  });

  test("says which time it is, once it has ended too", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(OnCallDutyPolicyStatus.Completed, 4),
    );

    expect(cell.container).toHaveTextContent(OnCallDutyPolicyStatus.Completed);
    expect(
      cell.container.querySelector("[data-testid=execution-log-paged-again]"),
    ).toHaveTextContent("Paged again (4 of 5)");
  });

  test("its words are one sentence the locales translate whole", () => {
    expect(ON_CALL_LOGS_PAGED_AGAIN).toBe(
      "Paged again ({{number}} of {{max}})",
    );
  });
});

describe("every other run's status", () => {
  test.each([
    [OnCallDutyPolicyStatus.Executing, undefined],
    [OnCallDutyPolicyStatus.Completed, undefined],
    [OnCallDutyPolicyStatus.Error, 0],
  ])(
    "%s with no page again number is the pill alone",
    (status: OnCallDutyPolicyStatus, number: number | undefined) => {
      const cell: { container: HTMLElement } = statusCell(run(status, number));

      expect(
        cell.container.querySelector("[data-testid=execution-log-paged-again]"),
      ).toBeNull();
      expect(cell.container).not.toHaveTextContent("Paged again");
    },
  );
});

describe("the table", () => {
  test("reads whether each run is a page again", () => {
    expect(table().selectMoreFields["pageAgainNumber"]).toBe(true);
  });
});
