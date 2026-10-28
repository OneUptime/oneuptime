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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A RUN'S TIMELINE SAYS A LEVEL PAGED NOBODY, AND THAT THE POLICY DID NOT
 * WAIT FOR IT.
 *
 * A level with nobody to page is passed at once (OnCallEmptyLevel), and
 * writes a line of its own on the run's timeline. On the run's own page
 * (the Execution Timeline card) that row names nobody: where a person
 * would be, it says why the level paged nobody - it has no responders, or
 * nobody it names could be paged (their own rows say why) - with "Moved on
 * at once" under it, as "Next in rotation" sits under a schedule's name. A
 * row from before levels were passed at once says only that nobody was
 * paged: that run waited.
 *
 * The table is replaced by a recorder so the columns can be read and each
 * cell drawn for real (as in OnCallTimelineNextInRotation.test.tsx).
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

import ExecutionLogTimelineTable, {
  LEVEL_HAS_NO_RESPONDERS_LABEL,
  LEVEL_PAGED_NOBODY_LABEL,
  MOVED_ON_AT_ONCE_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";

const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const RULE_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";

interface RecordedColumn {
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: JSONObject;
}

beforeEach(() => {
  modelTableMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function table(): RecordedTable {
  render(
    <ExecutionLogTimelineTable
      onCallPolicyExecutionLogId={new ObjectID(RUN_ID)}
    />,
  );

  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

// The "Notification Sent To" cell of a row, drawn for real.
function drawSentTo(item: OnCallDutyPolicyExecutionLogTimeline): void {
  const recorded: RecordedTable = table();
  cleanup();

  const column: RecordedColumn | undefined = recorded.columns.find(
    (candidate: RecordedColumn): boolean => {
      return candidate.title === "Notification Sent To";
    },
  );

  render(column!.getElement!(item));
}

// A level's own line: no person, no schedule, no team.
function levelLine(
  statusMessage: string,
): OnCallDutyPolicyExecutionLogTimeline {
  const line: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  line.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
  line.statusMessage = statusMessage;
  line.onCallDutyPolicyId = new ObjectID(
    "aaaaaaaa-0000-4000-8000-000000000004",
  );
  line.onCallDutyPolicyEscalationRuleId = new ObjectID(RULE_ID);

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule._id = RULE_ID;
  rule.name = "Level 1";
  line.onCallDutyPolicyEscalationRule = rule;

  return line;
}

describe("the Execution Timeline's row for a level that paged nobody", () => {
  test("its status message is read with every row, so the row can tell", () => {
    expect(table().selectMoreFields["statusMessage"]).toBe(true);
  });

  test("a level with no responders says so, and that the policy moved on at once", () => {
    drawSentTo(levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE));

    expect(
      screen.getByTestId("on-call-timeline-level-paged-nobody"),
    ).toHaveTextContent(LEVEL_HAS_NO_RESPONDERS_LABEL);
    expect(
      screen.getByTestId("on-call-timeline-moved-on-at-once"),
    ).toHaveTextContent(MOVED_ON_AT_ONCE_LABEL);
    expect(LEVEL_HAS_NO_RESPONDERS_LABEL).toBe("This level has no responders");
    expect(MOVED_ON_AT_ONCE_LABEL).toBe("Moved on at once");
  });

  test("a level whose people could not be paged says so - their own rows above say why", () => {
    drawSentTo(levelLine(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE));

    expect(
      screen.getByTestId("on-call-timeline-level-paged-nobody"),
    ).toHaveTextContent(LEVEL_PAGED_NOBODY_LABEL);
    expect(
      screen.getByTestId("on-call-timeline-moved-on-at-once"),
    ).toBeInTheDocument();
    expect(LEVEL_PAGED_NOBODY_LABEL).toBe(
      "Nobody at this level could be paged",
    );
  });

  test("a row from before levels were passed at once: nobody was paged, and nothing is said of moving on - that run waited", () => {
    drawSentTo(levelLine(LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE));

    expect(
      screen.getByTestId("on-call-timeline-level-paged-nobody"),
    ).toHaveTextContent(LEVEL_PAGED_NOBODY_LABEL);
    expect(
      screen.queryByTestId("on-call-timeline-moved-on-at-once"),
    ).not.toBeInTheDocument();
  });

  test("never a dash where the level's line used to read '-'", () => {
    drawSentTo(levelLine(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE));

    expect(screen.queryByText("-")).not.toBeInTheDocument();
  });
});

describe("the other rows about nobody read as before", () => {
  test("a schedule with nobody on call says that - not that the level had no responders", () => {
    const line: OnCallDutyPolicyExecutionLogTimeline = levelLine(
      "Skipped because no active users are found in this schedule.",
    );
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule._id = "5c4e0000-0000-4000-8000-000000000009";
    schedule.name = "Payments primary";
    line.onCallDutySchedule = schedule;
    line.onCallDutyScheduleId = new ObjectID(schedule._id);

    drawSentTo(line);

    expect(screen.getByText("No one was on call")).toBeInTheDocument();
    expect(
      screen.queryByTestId("on-call-timeline-level-paged-nobody"),
    ).not.toBeInTheDocument();
  });

  test("a team of the level with nobody in it is named", () => {
    const line: OnCallDutyPolicyExecutionLogTimeline = levelLine(
      "Skipped because this team has no members.",
    );
    const team: Team = new Team();
    team._id = "7ea40000-0000-4000-8000-000000000001";
    team.name = "Night Shift";
    line.userBelongsToTeam = team;
    line.userBelongsToTeamId = new ObjectID(team._id);

    drawSentTo(line);

    expect(
      screen.getByTestId("on-call-timeline-team-has-no-members"),
    ).toHaveTextContent("Team Night Shift has no members");
    expect(
      screen.queryByTestId("on-call-timeline-level-paged-nobody"),
    ).not.toBeInTheDocument();
  });

  test("a row about nobody with any other message is a dash, as it was", () => {
    drawSentTo(levelLine("Something else happened."));

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(
      screen.queryByTestId("on-call-timeline-level-paged-nobody"),
    ).not.toBeInTheDocument();
  });
});
