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
 * "PASSED ON" IN THE ON-CALL LOGS.
 *
 * When somebody passes a page on, three lists say so:
 *
 *   - the run's Execution Timeline (ExecutionLogsTimelineTable): the line
 *     of the person who passed it on;
 *   - User Settings > Notification Logs (Pages/UserSettings/OnCallLogs):
 *     the person's own page, which stopped there;
 *   - its Timeline (Pages/UserSettings/OnCallLogsTimeline): the
 *     notification they passed it on from.
 *
 * Each list draws a status it knows as a coloured pill and anything else as
 * a red Error - so a page passed on read as an error until the lists knew
 * the status. They draw "Passed On" in yellow now: nothing went wrong, and
 * the page is somebody else's to take. The status filters list it too.
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

function statusFilterOptions(table: RecordedTable): Array<string> {
  const filter: RecordedFilter | undefined = (table.filters || []).find(
    (candidate: RecordedFilter): boolean => {
      return candidate.title === "Status";
    },
  );

  return (filter?.filterDropdownOptions || []).map(
    (option: DropdownOption): string => {
      return String(option.value);
    },
  );
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

  test("the line of whoever passed the page on says Passed On, in yellow", () => {
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.PassedOn)),
    ).toEqual({ text: "Passed On", color: Yellow.toString() });
  });

  test("the lines around it are as they were", () => {
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.Skipped)),
    ).toEqual({ text: "Skipped", color: Yellow.toString() });
    expect(
      statusPill(table(), line(OnCallDutyExecutionLogTimelineStatus.Error)),
    ).toEqual({ text: "Error", color: Red.toString() });
  });

  test("the status filter offers Passed On", () => {
    expect(statusFilterOptions(table())).toContain("Passed On");
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

  test("a page you passed on says Passed On, in yellow - not Error", () => {
    expect(
      statusPill(table(), page(UserNotificationExecutionStatus.PassedOn)),
    ).toEqual({ text: "Passed On", color: Yellow.toString() });
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

  test("the notification you passed it on from says Passed On, in yellow - not Error", () => {
    expect(
      statusPill(table(), notification(UserNotificationStatus.PassedOn)),
    ).toEqual({ text: "Passed On", color: Yellow.toString() });
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
