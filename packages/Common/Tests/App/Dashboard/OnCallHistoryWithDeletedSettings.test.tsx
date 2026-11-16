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
 * ON-CALL HISTORY WHOSE SETTINGS WERE DELETED, IN THE DASHBOARD (issue
 * #9036).
 *
 * Deleting an escalation rule, a schedule, a team or a person's account
 * used to delete the on-call runs and lines that named them (ON DELETE
 * CASCADE), so the lists never met such a row. Now the rows stay and the
 * reference is cleared (ON DELETE SET NULL). These draw the three lists
 * with such rows:
 *
 *   - a run's Execution Timeline: a line whose escalation rule was deleted
 *     says which level it was, as the line recorded it ("Level 2: Database
 *     (deleted)"), or that its rule was deleted - never "No escalation rule
 *     found.", which still means a rule the reader may not read, and never
 *     "Direct page"; its other cells draw as before, a cleared person or
 *     schedule as the quiet dash;
 *   - On-Call Policy Logs: a run whose level, or whose acknowledger's
 *     account, was deleted is listed as any run;
 *   - User Settings > On-Call Logs: a page whose level was deleted says so.
 *
 * The tables are replaced by a recorder so the columns each list builds can
 * be read and run; each cell is then rendered for real.
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

import ExecutionLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import ExecutionLogTimelineTable, {
  DELETED_ESCALATION_RULE_LABEL,
  DELETED_LEVEL_TEMPLATE,
  DELETED_LEVEL_WITH_NAME_TEMPLATE,
  getDeletedLevelText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
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
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_DELETED_LEVEL_LABEL,
  ON_CALL_DELETED_LEVEL_TEMPLATE,
  ON_CALL_DELETED_LEVEL_WITH_NAME_TEMPLATE,
} from "../../../Types/OnCallDutyPolicy/OnCallRunLevel";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { QUIET_DASH_TEXT } from "../../Helpers/QuietDash";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const POLICY_ID: string = "dddddddd-0000-4000-8000-000000009036";
const RULE_ID: string = "eeeeeeee-0000-4000-8000-000000009036";
const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000009036";

interface RecordedColumn {
  title: string;
  field: JSONObject;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: JSONObject;
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
    throw new Error(`No "${title}" column`);
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
  escalationRule.name = "Database";
  escalationRule.onCallDutyPolicyId = new ObjectID(POLICY_ID);
  return escalationRule;
}

function person(): User {
  const user: User = new User();
  user._id = "10000000-0000-4000-8000-000000009036";
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

describe("a run's Execution Timeline", () => {
  function table(): RecordedTable {
    render(
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={new ObjectID(RUN_ID)}
      />,
    );
    return recorded();
  }

  // A line of a policy's run: its rule there, or deleted since.
  function line(data: {
    ruleIsThere?: boolean;
    recordedOrder?: number;
    recordedName?: string;
    personIsThere?: boolean;
    status?: OnCallDutyExecutionLogTimelineStatus;
  }): OnCallDutyPolicyExecutionLogTimeline {
    const timeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    timeline.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    timeline.status =
      data.status || OnCallDutyExecutionLogTimelineStatus.NotificationSent;

    if (data.ruleIsThere) {
      timeline.onCallDutyPolicyEscalationRuleId = new ObjectID(RULE_ID);
      timeline.onCallDutyPolicyEscalationRule = rule();
    }

    if (data.recordedOrder !== undefined) {
      timeline.escalationRuleOrder = data.recordedOrder;
    }

    if (data.recordedName !== undefined) {
      timeline.escalationRuleName = data.recordedName;
    }

    if (data.personIsThere) {
      timeline.alertSentToUser = person();
      timeline.alertSentToUserId = new ObjectID(person()._id!);
    }

    return timeline;
  }

  test("a line whose rule was deleted names the level it recorded, and says it was deleted", () => {
    expect(
      cellText(
        table(),
        "Escalation Rule",
        line({ recordedOrder: 2, recordedName: "Database" }),
      ),
    ).toBe("Level 2: Database (deleted)");
    expect(
      screen.getByTestId("on-call-timeline-deleted-escalation-rule"),
    ).toBeInTheDocument();
  });

  test("with only its place recorded, the place", () => {
    expect(
      cellText(table(), "Escalation Rule", line({ recordedOrder: 3 })),
    ).toBe("Level 3 (deleted)");
  });

  test("written before levels were recorded, that its rule was deleted", () => {
    expect(cellText(table(), "Escalation Rule", line({}))).toBe(
      "Deleted escalation rule",
    );
  });

  test("it is no direct page, and no rule the reader may not read", () => {
    const said: string = cellText(
      table(),
      "Escalation Rule",
      line({ recordedOrder: 2 }),
    );

    expect(said).not.toContain("Direct page");
    expect(said).not.toContain("No escalation rule found.");
    expect(screen.queryByTestId("on-call-direct-page")).toBeNull();
  });

  test("a line whose rule is still there names the rule as it is now", () => {
    expect(
      cellText(
        table(),
        "Escalation Rule",
        line({ ruleIsThere: true, recordedOrder: 2, recordedName: "Old" }),
      ),
    ).toBe("Database");
  });

  test("every line is read with its rule's id and the level it recorded", () => {
    const fields: JSONObject = table().selectMoreFields;

    expect(fields["onCallDutyPolicyEscalationRuleId"]).toBe(true);
    expect(fields["escalationRuleOrder"]).toBe(true);
    expect(fields["escalationRuleName"]).toBe(true);
    // A direct page is told apart by its policy, as before.
    expect(fields["onCallDutyPolicyId"]).toBe(true);
  });

  test("the line's other cells draw as before: who it reached, and how it went", () => {
    const recordedTable: RecordedTable = table();
    const item: OnCallDutyPolicyExecutionLogTimeline = line({
      recordedOrder: 2,
      personIsThere: true,
    });

    expect(cellText(recordedTable, "Notification Sent To", item)).toContain(
      "Jane Doe",
    );
    expect(cellText(recordedTable, "Status", item)).toBe("Notification Sent");
  });

  test("a line whose person's account, or schedule, was deleted draws the quiet dash there", () => {
    const recordedTable: RecordedTable = table();
    const item: OnCallDutyPolicyExecutionLogTimeline = line({
      recordedOrder: 2,
    });

    expect(cellText(recordedTable, "Notification Sent To", item)).toBe(
      QUIET_DASH_TEXT,
    );
    expect(cellText(recordedTable, "Schedule", item)).toBe(QUIET_DASH_TEXT);
  });

  describe("the words for a deleted level", () => {
    test("are the run's chat message's", () => {
      expect(DELETED_LEVEL_WITH_NAME_TEMPLATE).toBe(
        ON_CALL_DELETED_LEVEL_WITH_NAME_TEMPLATE,
      );
      expect(DELETED_LEVEL_TEMPLATE).toBe(ON_CALL_DELETED_LEVEL_TEMPLATE);
      expect(DELETED_ESCALATION_RULE_LABEL).toBe(ON_CALL_DELETED_LEVEL_LABEL);
    });

    test("read whole in the reader's language, the level's place and name in it", () => {
      const german: Record<string, string> = {
        [DELETED_LEVEL_WITH_NAME_TEMPLATE]:
          "Stufe {{order}}: {{name}} (gelöscht)",
        [DELETED_LEVEL_TEMPLATE]: "Stufe {{order}} (gelöscht)",
        [DELETED_ESCALATION_RULE_LABEL]: "Gelöschte Eskalationsregel",
      };
      const translator: Translator = createTranslator((text: string) => {
        return german[text];
      }, "de");

      expect(
        getDeletedLevelText(translator, {
          escalationRuleOrder: 2,
          escalationRuleName: "Database",
        }),
      ).toBe("Stufe 2: Database (gelöscht)");
      expect(getDeletedLevelText(translator, { escalationRuleOrder: 2 })).toBe(
        "Stufe 2 (gelöscht)",
      );
      expect(getDeletedLevelText(translator, {})).toBe(
        "Gelöschte Eskalationsregel",
      );
    });

    test("a language that lacks them reads them in English", () => {
      const translator: Translator = createTranslator(() => {
        return undefined;
      }, "de");

      expect(
        getDeletedLevelText(translator, {
          escalationRuleOrder: 4,
          escalationRuleName: "Ops",
        }),
      ).toBe("Level 4: Ops (deleted)");
    });
  });
});

describe("On-Call Policy Logs", () => {
  function table(): RecordedTable {
    render(<ExecutionLogsTable />);
    return recorded();
  }

  // A run whose level was deleted while it paged.
  function run(
    data: { acknowledgedByIsThere?: boolean } = {},
  ): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log._id = RUN_ID;
    log.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    log.onCallDutyPolicy = policy();
    log.status = OnCallDutyPolicyStatus.Executing;
    log.lastExecutedEscalationRuleOrder = 2;

    if (data.acknowledgedByIsThere) {
      log.acknowledgedByUser = person();
    }

    return log;
  }

  test("a run whose level was deleted is listed as any run: its policy and its status", () => {
    const recordedTable: RecordedTable = table();

    expect(cellText(recordedTable, "Policy Name", run())).toBe("Critical");
    expect(cellText(recordedTable, "Status", run())).toBe("Executing");
  });

  test("a run whose acknowledger's account was deleted shows nobody under Acknowledged By", () => {
    const recordedTable: RecordedTable = table();

    expect(cellText(recordedTable, "Acknowledged By", run())).toBe(
      QUIET_DASH_TEXT,
    );
    expect(
      cellText(
        recordedTable,
        "Acknowledged By",
        run({ acknowledgedByIsThere: true }),
      ),
    ).toContain("Jane Doe");
  });
});

describe("User Settings > On-Call Logs", () => {
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

  test("a page whose level was deleted says its escalation rule was deleted", () => {
    const log: UserOnCallLog = new UserOnCallLog();
    log.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    log.onCallDutyPolicy = policy();

    expect(cellText(table(), "Escalation Rule", log)).toBe(
      "Deleted escalation rule",
    );
    expect(
      screen.getByTestId("on-call-log-deleted-escalation-rule"),
    ).toBeInTheDocument();
  });

  test("its policy is named as before", () => {
    const log: UserOnCallLog = new UserOnCallLog();
    log.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    log.onCallDutyPolicy = policy();

    expect(cellText(table(), "On-Call Policy", log)).toBe("Critical");
  });

  test("every page is read with its rule's id", () => {
    expect(table().selectMoreFields["onCallDutyPolicyEscalationRuleId"]).toBe(
      true,
    );
  });
});
