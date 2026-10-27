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
 * HOW ONEUPTIME AI'S HOLD ENDED, IN THE EXECUTION LOGS (OnCallPolicyAiHold).
 *
 * A run an After OneUptime AI rule held says under its status pill how the
 * hold ended - resolved by AI with nobody paged, handled by a person, AI
 * handing it off, and so on - so an on-call admin sees at a glance what AI
 * did with each page. A run still held, or never held, says nothing more.
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
  ON_CALL_LOGS_AI_HOLD_OUTCOMES,
  ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111113";

const OUTCOME_TEST_ID: string = "execution-log-ai-hold-outcome";

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
  aiHoldOutcome?: OnCallPolicyAiHoldOutcome | undefined,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = "aaaaaaaa-0000-4000-8000-000000000003";
  log.status = status;

  if (aiHoldOutcome) {
    log.aiHoldOutcome = aiHoldOutcome;
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

describe("a run OneUptime AI held, once its hold ended", () => {
  test.each([
    [
      OnCallPolicyAiHoldOutcome.ResolvedByAI,
      OnCallDutyPolicyStatus.Completed,
      "Resolved by OneUptime AI. Nobody was paged.",
    ],
    [
      OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn,
      OnCallDutyPolicyStatus.Completed,
      "Recovered on its own while OneUptime AI held the page.",
    ],
    [
      OnCallPolicyAiHoldOutcome.HandledByPerson,
      OnCallDutyPolicyStatus.Completed,
      "Handled by a person while OneUptime AI held the page.",
    ],
    [
      OnCallPolicyAiHoldOutcome.HandedOff,
      OnCallDutyPolicyStatus.Executing,
      "OneUptime AI handed it off.",
    ],
    [
      OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
      OnCallDutyPolicyStatus.Executing,
      "OneUptime AI's hold time ran out.",
    ],
    [
      OnCallPolicyAiHoldOutcome.PageNowPressed,
      OnCallDutyPolicyStatus.Executing,
      "Page now was pressed while OneUptime AI held the page.",
    ],
  ])(
    "%s says so under its pill",
    (
      outcome: OnCallPolicyAiHoldOutcome,
      status: OnCallDutyPolicyStatus,
      sentence: string,
    ) => {
      const cell: { container: HTMLElement } = statusCell(run(status, outcome));

      expect(
        cell.container.querySelector("[data-testid=pill]"),
      ).toHaveTextContent(status);

      const note: HTMLElement | null = cell.container.querySelector(
        `[data-testid=${OUTCOME_TEST_ID}]`,
      );

      expect(note).toHaveTextContent(sentence);
      // Drawn as the waiting run's note is: small, grey, under the pill.
      expect(note!.className).toBe(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
    },
  );

  test("every way a hold ends has its sentence, and no two read alike", () => {
    const ended: Array<string> = Object.values(
      OnCallPolicyAiHoldOutcome,
    ).filter((outcome: string): boolean => {
      return outcome !== OnCallPolicyAiHoldOutcome.Holding;
    });
    const sentences: Array<string> = Object.values(
      ON_CALL_LOGS_AI_HOLD_OUTCOMES,
    );

    expect(Object.keys(ON_CALL_LOGS_AI_HOLD_OUTCOMES).sort()).toEqual(
      [...ended].sort(),
    );
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe("a run with nothing to say about a hold", () => {
  test("still held, is its pill alone: the AI Investigation card says AI is on it", () => {
    const cell: { container: HTMLElement } = statusCell(
      run(OnCallDutyPolicyStatus.Waiting, OnCallPolicyAiHoldOutcome.Holding),
    );

    expect(
      cell.container.querySelector(`[data-testid=${OUTCOME_TEST_ID}]`),
    ).toBeNull();
  });

  test.each([
    OnCallDutyPolicyStatus.Executing,
    OnCallDutyPolicyStatus.Completed,
    OnCallDutyPolicyStatus.Error,
  ])("never held (%s), is its pill alone", (status: OnCallDutyPolicyStatus) => {
    const cell: { container: HTMLElement } = statusCell(run(status));

    expect(
      cell.container.querySelector(`[data-testid=${OUTCOME_TEST_ID}]`),
    ).toBeNull();
    expect(cell.container).not.toHaveTextContent("OneUptime AI");
  });

  test("an outcome this dashboard does not know is not shown", () => {
    const log: OnCallDutyPolicyExecutionLog = run(
      OnCallDutyPolicyStatus.Completed,
    );
    (log as unknown as Record<string, unknown>)["aiHoldOutcome"] =
      "Some later outcome";

    const cell: { container: HTMLElement } = statusCell(log);

    expect(
      cell.container.querySelector(`[data-testid=${OUTCOME_TEST_ID}]`),
    ).toBeNull();
  });
});

describe("the table", () => {
  test("reads how each run's hold ended", () => {
    expect(table().selectMoreFields["aiHoldOutcome"]).toBe(true);
  });
});
