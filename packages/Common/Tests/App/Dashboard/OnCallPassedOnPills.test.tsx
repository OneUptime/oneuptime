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
 * "ESCALATED" IN THE ON-CALL LOGS.
 *
 * When somebody escalates a page, three lists say so:
 *
 *   - the run's Execution Timeline (ExecutionLogsTimelineTable): the line
 *     of the person who escalated it;
 *   - User Settings > Notification Logs (Pages/UserSettings/OnCallLogs):
 *     the person's own page, which stopped there;
 *   - its Timeline (Pages/UserSettings/OnCallLogsTimeline): the
 *     notification they escalated it from.
 *
 * Each list draws a status it knows as a coloured pill and anything else as
 * a red Error. An escalated page is stored with the status "Passed On" -
 * the action's first name, kept so old logs, the API and saved filters keep
 * working - and the lists draw it as "Escalated", in yellow: nothing went
 * wrong, and the page is somebody else's to take. The status filters offer
 * it as "Escalated" too, while filtering by the stored value.
 *
 * The tables are replaced by a recorder so the columns each list builds can
 * be read and run; the pill is a span that carries its colour.
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
    default: (props: {
      text: string;
      color: { toString: () => string };
    }): ReactElement => {
      return (
        <span data-testid="pill" data-color={props.color.toString()}>
          {props.text}
        </span>
      );
    },
  };
});

import ExecutionLogTimelineTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import UserOnCallLogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogs";
import UserOnCallLogsTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogsTimeline";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Route from "../../../Types/API/Route";
import { Red, Yellow } from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const NOTIFICATION_LOG_ID: string = "cccccccc-0000-4000-8000-000000000001";

interface RecordedColumn {
  title: string;
  field: JSONObject;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedFilter {
  title: string;
  field: JSONObject;
  filterDropdownOptions?: Array<DropdownOption>;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  filters?: Array<RecordedFilter>;
}

// What the list handed its table, the last time it drew.
function recorded(): RecordedTable {
  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

// The status cell for a row, drawn for real: its pill's words and colour.
function statusPill(
  table: RecordedTable,
  item: unknown,
): { text: string; color: string } {
  const column: RecordedColumn | undefined = table.columns.find(
    (candidate: RecordedColumn): boolean => {
      return candidate.title === "Status";
    },
  );

  expect(column).toBeDefined();

  cleanup();

  const view: { container: HTMLElement } = render(column!.getElement!(item));
  const pill: HTMLElement = view.container.querySelector(
    "[data-testid='pill']",
  ) as HTMLElement;

  return {
    text: (pill.textContent || "").trim(),
    color: pill.getAttribute("data-color") || "",
  };
}

function statusFilterOptions(table: RecordedTable): Array<DropdownOption> {
  const filter: RecordedFilter | undefined = (table.filters || []).find(
    (candidate: RecordedFilter): boolean => {
      return candidate.title === "Status";
    },
  );

  return filter?.filterDropdownOptions || [];
}

// The filter's option for the stored "Passed On", as a reader sees it.
function escalatedOption(table: RecordedTable): {
  label: string;
  value: string;
} {
  const option: DropdownOption | undefined = statusFilterOptions(table).find(
    (candidate: DropdownOption): boolean => {
      return candidate.value === "Passed On";
    },
  );

  expect(option).toBeDefined();

  return { label: String(option!.label), value: String(option!.value) };
}

// No option is labelled with the old words.
function labels(table: RecordedTable): Array<string> {
  return statusFilterOptions(table).map((option: DropdownOption): string => {
    return String(option.label);
  });
}

beforeEach(() => {
  modelTableMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("a run's Execution Timeline", () => {
  function table(): RecordedTable {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/on-call-duty`,
    );
    render(
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={new ObjectID(RUN_ID)}
      />,
    );
    return recorded();
  }

  function line(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): OnCallDutyPolicyExecutionLogTimeline {
    const timeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    timeline.status = status;
    return timeline;
  }

  test("the line of whoever escalated the page says Escalated, in yellow", () => {
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.PassedOn)),
    ).toEqual({ text: "Escalated", color: Yellow.toString() });
  });

  test("the lines around it are as they were", () => {
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.Skipped)),
    ).toEqual({ text: "Skipped", color: Yellow.toString() });
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.Error)),
    ).toEqual({ text: "Error", color: Red.toString() });
  });

  test("the status filter offers it as Escalated, filtering by the stored Passed On", () => {
    const recordedTable: RecordedTable = table();

    expect(escalatedOption(recordedTable)).toEqual({
      label: "Escalated",
      value: "Passed On",
    });
    expect(labels(recordedTable)).not.toContain("Passed On");
    // The other statuses read as they are stored.
    expect(labels(recordedTable)).toContain("Skipped");
    expect(labels(recordedTable)).toContain("Notification Sent");
  });
});

describe("User Settings > Notification Logs", () => {
  function table(): RecordedTable {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/user-settings/on-call-logs`,
    );
    render(
      <UserOnCallLogsPage
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
    return recorded();
  }

  function page(status: UserNotificationExecutionStatus): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();
    log.status = status;
    return log;
  }

  test("a page you escalated says Escalated, in yellow - not Error", () => {
    expect(
      statusPill(table(), page(UserNotificationExecutionStatus.PassedOn)),
    ).toEqual({ text: "Escalated", color: Yellow.toString() });
  });

  test("its status filter offers it as Escalated", () => {
    expect(escalatedOption(table())).toEqual({
      label: "Escalated",
      value: "Passed On",
    });
  });

  test("a page that went wrong is still an error", () => {
    expect(
      statusPill(table(), page(UserNotificationExecutionStatus.Error)).color,
    ).toBe(Red.toString());
  });
});

describe("User Settings > Notification Logs > Timeline", () => {
  function table(): RecordedTable {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/user-settings/on-call-logs/${NOTIFICATION_LOG_ID}`,
    );
    render(
      <UserOnCallLogsTimelinePage
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
    return recorded();
  }

  function notification(status: UserNotificationStatus): UserOnCallLogTimeline {
    const timeline: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timeline.status = status;
    return timeline;
  }

  test("the notification you escalated it from says Escalated, in yellow - not Error", () => {
    expect(
      statusPill(table(), notification(UserNotificationStatus.PassedOn)),
    ).toEqual({ text: "Escalated", color: Yellow.toString() });
  });

  test("its status filter offers it as Escalated", () => {
    const recordedTable: RecordedTable = table();

    expect(escalatedOption(recordedTable)).toEqual({
      label: "Escalated",
      value: "Passed On",
    });
    expect(labels(recordedTable)).toContain("Acknowledged");
  });

  test("the notifications around it are as they were", () => {
    expect(
      statusPill(table(), notification(UserNotificationStatus.Acknowledged))
        .text,
    ).toBe("Acknowledged");
    expect(
      statusPill(table(), notification(UserNotificationStatus.Error)),
    ).toEqual({ text: "Error", color: Yellow.toString() });
  });
});
