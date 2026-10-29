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
 * anchor, and a pill a span that carries its tooltip, so what a status says
 * on hover can be read.
 *
 * What a real browser adds - that a long workflow name wraps inside its
 * column rather than pushing the other columns out of the card - is in
 * packages/E2E/WorkflowBuilder/OnCallLogsTables.spec.ts.
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

jest.mock("../../../UI/Components/Pill/Pill", () => {
  return {
    __esModule: true,
    default: (props: { text: string; tooltip?: string }): ReactElement => {
      return (
        <span data-testid="pill" data-tooltip={props.tooltip || ""}>
          {props.text}
        </span>
      );
    },
  };
});

import ExecutionLogsTable, {
  DIRECT_PAGE_PAGED_NOBODY_TOOLTIP,
  NOBODY_PAGED_YET_MESSAGE,
  ON_CALL_LOGS_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
  ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MAX_WIDTH_CLASS_NAME,
  ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MIN_WIDTH_CLASS_NAME,
  POLICY_HAS_NOT_RUN_MESSAGE,
  POLICY_PAGED_NOBODY_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import ExecutionLogTimelineTable, {
  EXECUTION_TIMELINE_DESCRIPTION,
  EXECUTION_TIMELINE_TITLE,
  TEAM_HAS_NO_MEMBERS_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import UserOnCallLogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogs";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const POLICY_ID: string = "dddddddd-0000-4000-8000-000000000001";
const RULE_ID: string = "eeeeeeee-0000-4000-8000-000000000001";
const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const WORKFLOW_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

interface RecordedColumn {
  title: string;
  field: JSONObject;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
  contentClassName?: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: JSONObject;
  cardProps: { title: string; description: string };
  noItemsMessage: string;
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
    workflowId?: string;
    startedBy?: User;
    status?: OnCallDutyPolicyStatus;
  }): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log._id = RUN_ID;

    if (data.workflowId) {
      log.triggeredByWorkflowId = new ObjectID(data.workflowId);
    }

    if (data.status) {
      log.status = data.status;
    }

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

  test("the workflow's name opens the workflow, as a policy's name opens the policy", () => {
    cellText(
      table(),
      "Policy Name",
      run({
        workflowName: "Page on-call for critical incidents",
        workflowId: WORKFLOW_ID,
      }),
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "Page on-call for critical incidents",
    });

    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/workflows/${WORKFLOW_ID}/builder`,
    );
    // The link is the name alone: "Workflow:" before it is not part of it.
    expect(
      screen.getByTestId("on-call-direct-page-workflow"),
    ).toHaveTextContent("Workflow: Page on-call for critical incidents");
  });

  test("a run that kept only the workflow's name shows it as text: there is nothing to open", () => {
    cellText(
      table(),
      "Policy Name",
      run({ workflowName: "Page on-call for critical incidents" }),
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByTestId("on-call-direct-page-workflow"),
    ).toHaveTextContent("Workflow: Page on-call for critical incidents");
  });

  test("a workflow's name is text inside the link, never markup", () => {
    cellText(
      table(),
      "Policy Name",
      run({
        workflowName: '<img src=x onerror="alert(1)">',
        workflowId: WORKFLOW_ID,
      }),
    );

    expect(screen.getByRole("link")).toHaveTextContent(
      '<img src=x onerror="alert(1)">',
    );
    expect(document.querySelector("img")).toBeNull();
  });

  /*
   * A table cell stays on one line unless its column says otherwise, so one
   * long workflow name took the whole row's width and pushed Status,
   * Acknowledged By and View Timeline out of the card. The column wraps, and
   * caps how wide it grows.
   */
  test("the column wraps a long name inside a capped width, rather than widening the table", () => {
    const policyColumn: RecordedColumn = column(table(), "Policy Name");

    expect(policyColumn.wrapContent).toBe(true);
    expect(policyColumn.wrapMaxWidthClassName).toBe(
      ON_CALL_LOGS_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
    );
    expect(ON_CALL_LOGS_NAME_COLUMN_MAX_WIDTH_CLASS_NAME).toBe("max-w-xs");
  });

  /*
   * The same of an incident's or an alert's title, which is longer than a
   * name more often than not: "Card payments fail at checkout for customers
   * in the EU region after the 14:00 deploy" on one line left the card
   * showing a name and a title, with when the run was triggered and how it
   * stands past its right edge.
   */
  test("Triggered By wraps a long title too, inside a cap of its own", () => {
    const triggeredBy: RecordedColumn = column(table(), "Triggered By");

    expect(triggeredBy.wrapContent).toBe(true);
    expect(triggeredBy.wrapMaxWidthClassName).toBe(
      ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MAX_WIDTH_CLASS_NAME,
    );
    expect(ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MAX_WIDTH_CLASS_NAME).toBe(
      "max-w-sm",
    );
  });

  /*
   * A column that may wrap is given the least it can take when the table
   * is short of room - and beside the side menu on a laptop it always is.
   * Without a floor that least is the title's longest word.
   */
  test("and keeps a floor, so a title never folds to a word a line", () => {
    const triggeredBy: RecordedColumn = column(table(), "Triggered By");

    expect(triggeredBy.contentClassName).toBe(
      ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MIN_WIDTH_CLASS_NAME,
    );
    expect(ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MIN_WIDTH_CLASS_NAME).toBe(
      "min-w-[12rem]",
    );
  });

  test("one policy's own logs wrap the title the same way", () => {
    render(<ExecutionLogsTable onCallDutyPolicyId={new ObjectID(POLICY_ID)} />);

    const triggeredBy: RecordedColumn = column(recorded(), "Triggered By");

    expect(triggeredBy.wrapContent).toBe(true);
    expect(triggeredBy.contentClassName).toBe("min-w-[12rem]");
  });

  test("the columns that must stay on one line still do", () => {
    const recordedTable: RecordedTable = table();

    for (const title of ["Triggered at", "Status", "Acknowledged By"]) {
      expect(column(recordedTable, title).wrapContent).toBeUndefined();
      expect(column(recordedTable, title).contentClassName).toBeUndefined();
    }
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
    // The workflow's id is what its name links to.
    expect(more["triggeredByWorkflowId"]).toBe(true);
    expect(more["triggeredByUser"]).toEqual({ name: true, email: true });
  });

  describe("a run that paged nobody says why on hover", () => {
    function tooltipOf(item: OnCallDutyPolicyExecutionLog): string {
      cleanup();
      render(column(table(), "Status").getElement!(item));

      return screen.getByTestId("pill").getAttribute("data-tooltip") || "";
    }

    test("a policy's run: its escalation rules had nobody to page - no responders, nobody on call, or only people away", () => {
      expect(
        tooltipOf(
          run({
            hasPolicy: true,
            status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
          }),
        ),
      ).toBe(POLICY_PAGED_NOBODY_TOOLTIP);
      expect(POLICY_PAGED_NOBODY_TOOLTIP).toBe(
        "This execution reached nobody. Usually its escalation rules had no responders, their schedules had nobody on call, or the people they named were away.",
      );
    });

    test("a direct page has no escalation rules, and says what it found empty instead", () => {
      const tooltip: string = tooltipOf(
        run({ status: OnCallDutyPolicyStatus.CompletedWithNoNotifications }),
      );

      expect(tooltip).toBe(DIRECT_PAGE_PAGED_NOBODY_TOOLTIP);
      expect(tooltip).toBe(
        "This page reached nobody. Usually the on-call schedule had nobody on call, the team had no members, or the people it named were away.",
      );
      expect(tooltip).not.toContain("escalation rule");
    });

    test("a run whose policy cannot be read is still a policy's run", () => {
      expect(
        tooltipOf(
          run({
            hasPolicy: true,
            policyIsReadable: false,
            status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
          }),
        ),
      ).toBe(POLICY_PAGED_NOBODY_TOOLTIP);
    });

    test("any other status has nothing to explain", () => {
      for (const status of [
        OnCallDutyPolicyStatus.Completed,
        OnCallDutyPolicyStatus.Executing,
        OnCallDutyPolicyStatus.Error,
      ]) {
        expect(tooltipOf(run({ status: status }))).toBe("");
      }
    });
  });

  describe("what the empty list says", () => {
    test("the project's, an incident's and an alert's logs: nobody has been paged", () => {
      expect(table().noItemsMessage).toBe(NOBODY_PAGED_YET_MESSAGE);
      expect(NOBODY_PAGED_YET_MESSAGE).toBe("Nobody has been paged so far.");

      render(<ExecutionLogsTable incidentId={new ObjectID(POLICY_ID)} />);
      expect(recorded().noItemsMessage).toBe(NOBODY_PAGED_YET_MESSAGE);

      render(<ExecutionLogsTable alertId={new ObjectID(POLICY_ID)} />);
      expect(recorded().noItemsMessage).toBe(NOBODY_PAGED_YET_MESSAGE);
    });

    test("one policy's own logs: that policy has not run", () => {
      render(
        <ExecutionLogsTable onCallDutyPolicyId={new ObjectID(POLICY_ID)} />,
      );

      expect(recorded().noItemsMessage).toBe(POLICY_HAS_NOT_RUN_MESSAGE);
      expect(POLICY_HAS_NOT_RUN_MESSAGE).toBe(
        "This policy has not executed so far.",
      );
    });
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
    teamName?: string;
    hasUser?: boolean;
    hasSchedule?: boolean;
  }): OnCallDutyPolicyExecutionLogTimeline {
    const timeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();

    if (data.hasPolicy) {
      timeline.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    }

    if (data.hasRule) {
      timeline.onCallDutyPolicyEscalationRule = rule();
    }

    if (data.teamName !== undefined) {
      const team: Team = new Team();
      team._id = "7eae0000-0000-4000-8000-000000000001";
      team.name = data.teamName;
      timeline.userBelongsToTeam = team;
      timeline.userBelongsToTeamId = new ObjectID(team._id);
    }

    if (data.hasUser) {
      timeline.alertSentToUser = person();
    }

    if (data.hasSchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = "5c4e0000-0000-4000-8000-000000000001";
      schedule.name = "Primary";
      timeline.onCallDutySchedule = schedule;
      timeline.onCallDutyScheduleId = new ObjectID(schedule._id);
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

  /*
   * The card is the timeline of a policy's run and of a direct page alike.
   * It was titled "Policy Execution Timeline" and described "the execution
   * of the policy", over a page that no policy ran.
   */
  describe("the card names no policy: a direct page has none", () => {
    test("its title", () => {
      expect(table().cardProps.title).toBe(EXECUTION_TIMELINE_TITLE);
      expect(EXECUTION_TIMELINE_TITLE).toBe("Execution Timeline");
    });

    test("its description says what the rows are, and where a skipped one says why", () => {
      expect(table().cardProps.description).toBe(
        EXECUTION_TIMELINE_DESCRIPTION,
      );
      expect(EXECUTION_TIMELINE_DESCRIPTION).toBe(
        "Who was paged, when, and whether they acknowledged. If someone was skipped or a page failed, its status message says why.",
      );
    });

    test.each([
      ["title", EXECUTION_TIMELINE_TITLE],
      ["description", EXECUTION_TIMELINE_DESCRIPTION],
    ])("the %s does not say policy", (_part: string, text: string) => {
      expect(text.toLowerCase()).not.toContain("policy");
    });
  });

  /*
   * A direct page names teams. A team with nobody in it has a line of its
   * own, with nobody on it: the line said "-" in every column, and so
   * nothing at all about why nobody was paged.
   */
  describe("a team a direct page named that has no members", () => {
    test("its line says which team, where nobody could be named", () => {
      expect(
        cellText(
          table(),
          "Notification Sent To",
          line({ teamName: "Night Shift" }),
        ),
      ).toBe("Team Night Shift has no members");
      expect(
        screen.getByTestId("on-call-timeline-team-has-no-members"),
      ).toBeInTheDocument();
      expect(TEAM_HAS_NO_MEMBERS_TEMPLATE).toBe(
        "Team {{teamName}} has no members",
      );
    });

    test("a team's name is shown as written, never read as markup", () => {
      expect(
        cellText(
          table(),
          "Notification Sent To",
          line({ teamName: "<b>Ops</b>" }),
        ),
      ).toBe("Team <b>Ops</b> has no members");
      expect(document.querySelector("b")).toBeNull();
    });

    test("a person paged as a member of a team is named, not their team", () => {
      const said: string = cellText(
        table(),
        "Notification Sent To",
        line({ teamName: "Platform", hasUser: true }),
      );

      expect(said).toContain("Jane Doe");
      expect(said).not.toContain("has no members");
      expect(
        screen.queryByTestId("on-call-timeline-team-has-no-members"),
      ).toBeNull();
    });

    test("a schedule with nobody on call still says so in its own words", () => {
      expect(
        cellText(table(), "Notification Sent To", line({ hasSchedule: true })),
      ).toBe("No one was on call");
    });

    test.each([undefined, "", "   "])(
      "a line with nobody and no team to name (%p) says nothing",
      (teamName: string | undefined) => {
        expect(
          cellText(
            table(),
            "Notification Sent To",
            line(teamName === undefined ? {} : { teamName: teamName }),
          ),
        ).toBe("-");
      },
    );

    test("every line is read with the team it is about", () => {
      expect(table().selectMoreFields["userBelongsToTeam"]).toEqual({
        _id: true,
        name: true,
      });
    });
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
