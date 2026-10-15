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
 * A RUN'S TIMELINE SAYS WHO THE BACKUP WAS, AND WHY.
 *
 * An escalation rule can page the next person in an on-call schedule's
 * rotation - the backup after whoever is on call. The run's own page (the
 * Execution Timeline card) shows each step's schedule; a step that paged
 * the backup says "Next in rotation" under the schedule's name, and a step
 * that found nobody next says that where a person would be named - not "No
 * one was on call", which would send a reader to the wrong fix.
 *
 * The table is replaced by a recorder so the columns can be read and each
 * cell drawn for real (as in OnCallDirectPageInLogs.test.tsx).
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
  NEXT_IN_ROTATION_LABEL,
  NOBODY_NEXT_IN_ROTATION_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUN_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

interface RecordedColumn {
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  selectMoreFields: JSONObject;
}

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

// A cell, drawn for real, and what it says.
function cellText(title: string, item: unknown): string {
  const recorded: RecordedTable = table();
  cleanup();

  const found: RecordedColumn | undefined = recorded.columns.find(
    (candidate: RecordedColumn): boolean => {
      return candidate.title === title;
    },
  );

  if (!found?.getElement) {
    throw new Error(`No "${title}" column`);
  }

  const view: { container: HTMLElement } = render(found.getElement(item));

  return (view.container.textContent || "").trim();
}

function step(data: {
  isNextInRotation?: boolean;
  hasUser?: boolean;
  scheduleName?: string;
}): OnCallDutyPolicyExecutionLogTimeline {
  const timeline: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = "5c4e0000-0000-4000-8000-000000000001";
  schedule.name = data.scheduleName ?? "Payments primary";
  timeline.onCallDutySchedule = schedule;
  timeline.onCallDutyScheduleId = new ObjectID(schedule._id);

  if (data.isNextInRotation) {
    timeline.isNextInRotation = true;
  }

  if (data.hasUser) {
    const user: User = new User();
    user._id = "10000000-0000-4000-8000-000000000001";
    user.name = new Name("Sam Lee");
    user.email = new Email("sam@example.com");
    timeline.alertSentToUser = user;
  }

  return timeline;
}

beforeEach(() => {
  modelTableMock.mockClear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call-duty`);
});

afterEach(() => {
  cleanup();
});

describe("a step that paged the next person in a schedule's rotation", () => {
  test("its schedule says Next in rotation under the schedule's name", () => {
    expect(
      cellText("Schedule", step({ isNextInRotation: true, hasUser: true })),
    ).toBe("Payments primaryNext in rotation");
    expect(
      screen.getByTestId("on-call-timeline-next-in-rotation"),
    ).toBeInTheDocument();
    expect(NEXT_IN_ROTATION_LABEL).toBe("Next in rotation");
  });

  test("the person paged is named, as for any page", () => {
    expect(
      cellText(
        "Notification Sent To",
        step({ isNextInRotation: true, hasUser: true }),
      ),
    ).toContain("Sam Lee");
  });

  test("a step to the schedule's on-call person shows the schedule alone, as before", () => {
    expect(cellText("Schedule", step({ hasUser: true }))).toBe(
      "Payments primary",
    );
    expect(screen.queryByTestId("on-call-timeline-next-in-rotation")).toBeNull();
  });

  test("a schedule's name is shown as written, never read as markup", () => {
    expect(
      cellText(
        "Schedule",
        step({
          isNextInRotation: true,
          hasUser: true,
          scheduleName: "<b>Primary</b>",
        }),
      ),
    ).toBe("<b>Primary</b>Next in rotation");
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("a step that found nobody next in the rotation", () => {
  test("says so where a person would be named - not that nobody was on call", () => {
    expect(
      cellText("Notification Sent To", step({ isNextInRotation: true })),
    ).toBe("Nobody was next in the rotation");
    expect(
      screen.getByTestId("on-call-timeline-nobody-next-in-rotation"),
    ).toBeInTheDocument();
    expect(NOBODY_NEXT_IN_ROTATION_LABEL).toBe(
      "Nobody was next in the rotation",
    );
  });

  test("a schedule with nobody on call at all still says so in its own words", () => {
    expect(cellText("Notification Sent To", step({}))).toBe(
      "No one was on call",
    );
  });
});

test("every step is read with whether it paged the next person in the rotation", () => {
  expect(table().selectMoreFields["isNextInRotation"]).toBe(true);
});
