import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A direct page in the on-call logs.
 *
 * A workflow's Page Users, Page a Team and Page Whoever Is On Call steps
 * page people with no on-call policy behind the page. The page is kept
 * where an on-call run is, so it is listed with the runs in three places:
 *
 *   - On-Call Duty > Logs, and the On-Call Logs of the incident or alert it
 *     is about (Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable);
 *   - the run's own timeline (ExecutionLogsTimelineTable);
 *   - User Settings > Notification Logs, of each person it paged
 *     (Pages/UserSettings/OnCallLogs).
 *
 * Each of those named the policy and the escalation rule of every row, and
 * said "No on-call policy." / "No escalation rule found." where there was
 * none - which, of a page that was sent exactly as asked, reads as something
 * that went wrong. They say "Direct page" now, and what started it.
 *
 * What must not change is the row that really has lost something: a run
 * whose policy the reader may not read still says so. The two are told
 * apart by the run's policy id, so each list reads it with every row.
 *
 * The tables are replaced by a recorder so the columns each list builds can
 * be read and run; each cell is then rendered for real. AppLink is a plain
 * anchor.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import ExecutionLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import ExecutionLogTimelineTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import UserOnCallLogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogs";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const POLICY_ID: string = "dddddddd-0000-4000-8000-000000000001";
const RULE_ID: string = "eeeeeeee-0000-4000-8000-000000000001";
const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

interface RecordedColumn {
  title: string;
  field: JSONObject;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: JSONObject;
  cardProps: { title: string; description: string };
}

// What the list handed its table, the last time it drew.
function recorded(): RecordedTable {
  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

function column(table: RecordedTable, title: string): RecordedColumn {
  const found: RecordedColumn | undefined = table.columns.find(
    (candidate: RecordedColumn): boolean => {
      return candidate.title === title;
    },
  );

  if (!found) {
    throw new Error(
      `No "${title}" column among ${table.columns
        .map((candidate: RecordedColumn): string => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return found;
}

// A cell, drawn for real, and what it says.
function cellText(table: RecordedTable, title: string, item: unknown): string {
  cleanup();

  const view: { container: HTMLElement } = render(
    column(table, title).getElement!(item),
  );

  return (view.container.textContent || "").trim();
}

function policy(): OnCallDutyPolicy {
  const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
  onCallPolicy._id = POLICY_ID;
  onCallPolicy.name = "Critical";
  return onCallPolicy;
}

function rule(): OnCallDutyPolicyEscalationRule {
  const escalationRule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  escalationRule._id = RULE_ID;
  escalationRule.name = "Rule 1";
  escalationRule.onCallDutyPolicyId = new ObjectID(POLICY_ID);
  return escalationRule;
}

function person(): User {
  const user: User = new User();
  user._id = "10000000-0000-4000-8000-000000000001";
  user.name = new Name("Jane Doe");
  user.email = new Email("jane@example.com");
  return user;
}

beforeEach(() => {
  modelTableMock.mockClear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call-duty`);
});

afterEach(() => {
  cleanup();
});

describe("On-Call Duty > Logs, and the logs of an incident or an alert", () => {
  function table(): RecordedTable {
    render(<ExecutionLogsTable />);
    return recorded();
  }

  function run(data: {
    hasPolicy?: boolean;
    policyIsReadable?: boolean;
    workflowName?: string;
    startedBy?: User;
  }): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log._id = RUN_ID;

    if (data.hasPolicy) {
      log.onCallDutyPolicyId = new ObjectID(POLICY_ID);

      if (data.policyIsReadable !== false) {
        log.onCallDutyPolicy = policy();
      }
    }

    if (data.workflowName) {
      log.triggeredByWorkflowName = data.workflowName;
    }

    if (data.startedBy) {
      log.triggeredByUser = data.startedBy;
    }

    return log;
  }

  test("a policy's run names its policy, as it always has", () => {
    expect(cellText(table(), "Policy Name", run({ hasPolicy: true }))).toBe(
      "Critical",
    );
  });

  test("a direct page says Direct page, and the workflow that started it", () => {
    const said: string = cellText(
      table(),
      "Policy Name",
      run({ workflowName: "Page on-call for critical incidents" }),
    );

    expect(said).toContain("Direct page");
    expect(said).toContain("Workflow: Page on-call for critical incidents");
    expect(said).not.toContain("No on-call policy.");
  });

  test("a direct page a person started names the person", () => {
    const said: string = cellText(
      table(),
      "Policy Name",
      run({ startedBy: person() }),
    );

    expect(said).toContain("Direct page");
    expect(said).toContain("Jane Doe");
    expect(screen.queryByTestId("on-call-direct-page-workflow")).toBeNull();
  });

  test("a direct page with nothing else known still says what it is", () => {
    cellText(table(), "Policy Name", run({}));

    expect(screen.getByTestId("on-call-direct-page-label")).toHaveTextContent(
      "Direct page",
    );
  });

  test("a run whose policy the reader may not read is not called a direct page", () => {
    const said: string = cellText(
      table(),
      "Policy Name",
      run({ hasPolicy: true, policyIsReadable: false }),
    );

    expect(said).toBe("No on-call policy.");
    expect(screen.queryByTestId("on-call-direct-page")).toBeNull();
  });

  test("every row is read with its policy id and with what started it", () => {
    const more: JSONObject = table().selectMoreFields;

    // Without the id, every row whose policy is unreadable would look direct.
    expect(more["onCallDutyPolicyId"]).toBe(true);
    expect(more["triggeredByWorkflowName"]).toBe(true);
    expect(more["triggeredByUser"]).toEqual({ name: true, email: true });
  });

  test("the list says it holds both kinds of run", () => {
    expect(table().cardProps.description).toBe(
      "Each time an on-call policy ran or people were paged directly: what triggered it and who acknowledged it. Open one to see every notification it sent and whether it was delivered.",
    );
  });

  test("under one policy the column is not there at all: every row is that policy's", () => {
    render(<ExecutionLogsTable onCallDutyPolicyId={new ObjectID(POLICY_ID)} />);

    expect(
      recorded().columns.map((candidate: RecordedColumn): string => {
        return candidate.title;
      }),
    ).not.toContain("Policy Name");
  });
});

describe("a run's timeline", () => {
  function table(): RecordedTable {
    render(
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={new ObjectID(RUN_ID)}
      />,
    );
    return recorded();
  }

  function line(data: {
    hasPolicy?: boolean;
    hasRule?: boolean;
  }): OnCallDutyPolicyExecutionLogTimeline {
    const timeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();

    if (data.hasPolicy) {
      timeline.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    }

    if (data.hasRule) {
      timeline.onCallDutyPolicyEscalationRule = rule();
    }

    return timeline;
  }

  test("a policy's line names its escalation rule, as it always has", () => {
    expect(
      cellText(
        table(),
        "Escalation Rule",
        line({ hasPolicy: true, hasRule: true }),
      ),
    ).toBe("Rule 1");
  });

  test("a direct page's line says Direct page: it has no rules, and none is missing", () => {
    const said: string = cellText(table(), "Escalation Rule", line({}));

    expect(said).toContain("Direct page");
    expect(said).not.toContain("No escalation rule found.");
  });

  test("a policy's line whose rule is gone still says so", () => {
    expect(
      cellText(table(), "Escalation Rule", line({ hasPolicy: true })),
    ).toBe("No escalation rule found.");
    expect(screen.queryByTestId("on-call-direct-page")).toBeNull();
  });

  test("every line is read with its policy id", () => {
    expect(table().selectMoreFields["onCallDutyPolicyId"]).toBe(true);
  });
});

describe("User Settings > Notification Logs", () => {
  function table(): RecordedTable {
    render(
      <UserOnCallLogsPage
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
    return recorded();
  }

  function page(data: {
    hasPolicy?: boolean;
    policyIsReadable?: boolean;
    hasRule?: boolean;
  }): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();

    if (data.hasPolicy) {
      log.onCallDutyPolicyId = new ObjectID(POLICY_ID);

      if (data.policyIsReadable !== false) {
        log.onCallDutyPolicy = policy();
      }
    }

    if (data.hasRule) {
      log.onCallDutyPolicyEscalationRule = rule();
    }

    return log;
  }

  test("a page from a policy names the policy and the rule, as it always has", () => {
    const recordedTable: RecordedTable = table();
    const item: UserOnCallLog = page({ hasPolicy: true, hasRule: true });

    expect(cellText(recordedTable, "On-Call Policy", item)).toBe("Critical");
    expect(cellText(recordedTable, "Escalation Rule", item)).toBe("Rule 1");
  });

  test("a direct page says Direct page, and has no rule to name", () => {
    const recordedTable: RecordedTable = table();
    const item: UserOnCallLog = page({});

    expect(cellText(recordedTable, "On-Call Policy", item)).toContain(
      "Direct page",
    );
    expect(cellText(recordedTable, "Escalation Rule", item)).toBe("-");
  });

  test("a page whose policy or rule the reader may not read still says so", () => {
    const recordedTable: RecordedTable = table();
    const item: UserOnCallLog = page({
      hasPolicy: true,
      policyIsReadable: false,
    });

    expect(cellText(recordedTable, "On-Call Policy", item)).toBe(
      "No on-call policy.",
    );
    expect(cellText(recordedTable, "Escalation Rule", item)).toBe(
      "No escalation rule.",
    );
  });

  test("every row is read with its policy id", () => {
    expect(table().selectMoreFields["onCallDutyPolicyId"]).toBe(true);
  });

  test("the list says a person is paged by a policy or directly", () => {
    expect(table().cardProps.description).toBe(
      "Each time you were paged in this project, by an on-call policy or directly. Open one to see every notification sent and whether it was delivered.",
    );
  });
});
