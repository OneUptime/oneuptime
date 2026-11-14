import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE NEXT REMINDER'S COUNTDOWN READS A RULE'S INTERVAL AS THE WORKERS DO.
 *
 * Under the countdown to a record's next reminder, a bar shows how much of
 * the matching rule's interval has gone by, and "Repeats every ...". A rule
 * saved with an interval below a minute - which the API took until it
 * checked the interval (Types/Reminder/ReminderInterval) - drew that bar for
 * -5 minutes. The workers now read such a rule as reminding nobody, and so
 * does the countdown: no bar, and no "Repeats every" a reminder never
 * follows.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import NextReminderCountdown, {
  ReminderRuleScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/NextReminderCountdown";
import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "69780000-0000-4000-8000-0000000000c1";

// Far enough ahead that the countdown never reaches it during a test.
const NEXT_REMINDER: Date = new Date("2099-06-01T12:00:00.000Z");

const SCOPES: Array<[string, ReminderRuleScope, () => BaseModel]> = [
  [
    "an incident",
    ReminderRuleScope.Incident,
    (): BaseModel => {
      const rule: IncidentReminderRule = new IncidentReminderRule();
      rule.incidentSeverities = [];
      rule.labels = [];
      return rule;
    },
  ],
  [
    "an alert",
    ReminderRuleScope.Alert,
    (): BaseModel => {
      const rule: AlertReminderRule = new AlertReminderRule();
      rule.alertSeverities = [];
      rule.labels = [];
      return rule;
    },
  ],
  [
    "a scheduled maintenance event",
    ReminderRuleScope.ScheduledMaintenance,
    (): BaseModel => {
      const rule: ScheduledMaintenanceReminderRule =
        new ScheduledMaintenanceReminderRule();
      rule.labels = [];
      return rule;
    },
  ],
];

beforeEach(() => {
  getListMock.mockReset();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe.each(SCOPES)(
  "the countdown to %s's next reminder",
  (_kind: string, scope: ReminderRuleScope, makeRule: () => BaseModel) => {
    async function renderWithRuleOf(interval: number): Promise<void> {
      const rule: BaseModel = makeRule();
      (rule as unknown as Record<string, unknown>)[
        "reminderIntervalInMinutes"
      ] = interval;

      getListMock.mockImplementation(async (): Promise<unknown> => {
        return { data: [rule], count: 1, skip: 0, limit: 1 };
      });

      render(
        <NextReminderCountdown
          scope={scope}
          nextReminderAt={NEXT_REMINDER}
          remindersEnabled={true}
        />,
      );
      await flush();

      expect(getListMock).toHaveBeenCalled();
    }

    test("with a rule reminding every 30 minutes, shows how much of the 30 minutes has gone", async () => {
      await renderWithRuleOf(30);

      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText(/^Repeats every/)).toBeInTheDocument();
    });

    test.each([[-5], [-1], [0]])(
      "with a rule saved with %p minutes, shows no interval a reminder never follows",
      async (interval: number) => {
        await renderWithRuleOf(interval);

        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        expect(screen.queryByText(/Repeats every/)).not.toBeInTheDocument();
      },
    );
  },
);
