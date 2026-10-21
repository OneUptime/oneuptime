import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The Reminders card on an incident's, an alert's and a scheduled
 * maintenance event's Settings page (Dashboard Components/Reminders/
 * RemindersCard). It used to be Edit Reminders, flip "Enable Reminders",
 * Save. Now it is one switch, "Send reminders", that saves the moment it is
 * flipped, with when the next reminder goes out and how many were sent as
 * read-only lines under it - which the server works out again whenever
 * reminders are switched on or off, so the card reads them again.
 *
 * The real card, switch and countdown are rendered; only the network, the
 * permission gate and the project are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import RemindersCard from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/RemindersCard";
import ReminderRuleScope from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/ReminderRuleScope";
import RemindersSwitchCopy, {
  REMINDERS_DETAILS_ID,
  REMINDERS_SWITCH_COLUMN,
  REMINDERS_SWITCH_SCOPE_COPY,
  REMINDERS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/RemindersSwitchCopy";
import { ReminderRuleScope as ReminderRuleScopeFromCountdown } from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/NextReminderCountdown";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import Label from "../../../Models/DatabaseModels/Label";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const RECORD_ID: string = "4d4d4d4d-0000-4000-8000-0000000000aa";
const PROJECT_ID: string = "4d4d4d4d-0000-4000-8000-0000000000ff";
const SEVERITY_ID: string = "4d4d4d4d-0000-4000-8000-0000000000cc";
const LABEL_ID: string = "4d4d4d4d-0000-4000-8000-0000000000dd";

// Far enough ahead that the countdown never reaches it during a test.
const NEXT_REMINDER: Date = new Date("2099-06-01T12:00:00.000Z");

interface ScopeCase {
  scope: ReminderRuleScope;
  modelType: { new (): BaseModel };
  ruleType: { new (): BaseModel };
  // The column holding the record's severity, if reminder rules match on it.
  severityColumn: string | null;
  // The word the switch's sentences use for the record.
  noun: string;
}

const SCOPES: Array<ScopeCase> = [
  {
    scope: ReminderRuleScope.Incident,
    modelType: Incident,
    ruleType: IncidentReminderRule,
    severityColumn: "incidentSeverityId",
    noun: "incident",
  },
  {
    scope: ReminderRuleScope.Alert,
    modelType: Alert,
    ruleType: AlertReminderRule,
    severityColumn: "alertSeverityId",
    noun: "alert",
  },
  {
    scope: ReminderRuleScope.ScheduledMaintenance,
    modelType: ScheduledMaintenance,
    ruleType: ScheduledMaintenanceReminderRule,
    severityColumn: null,
    noun: "event",
  },
];

// What the server holds for the record.
let stored: Record<string, unknown> = {};
let currentCase: ScopeCase = SCOPES[0]!;

beforeEach(() => {
  stored = {};
  currentCase = SCOPES[0]!;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const item: BaseModel = new currentCase.modelType();
    item._id = RECORD_ID;
    Object.assign(item, stored);
    return item;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  // The server works the next reminder out again from the switch.
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const data: Record<string, unknown> = (
        options as { data: Record<string, unknown> }
      ).data;

      Object.assign(stored, data);
      stored["nextReminderNotificationAt"] =
        data["enableReminders"] === false ? null : NEXT_REMINDER;

      return {};
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );

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

async function renderCard(scopeCase: ScopeCase): Promise<HTMLElement> {
  currentCase = scopeCase;

  render(
    <RemindersCard scope={scopeCase.scope} modelId={new ObjectID(RECORD_ID)} />,
  );
  await flush();

  return await screen.findByTestId(REMINDERS_SWITCH_TEST_ID);
}

interface GetItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

function recordReads(): Array<GetItemCall> {
  return getItemMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as GetItemCall;
  });
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

function details(): HTMLElement {
  return document.getElementById(REMINDERS_DETAILS_ID) as HTMLElement;
}

describe.each(SCOPES)(
  "RemindersCard for $noun reminders",
  (scopeCase: ScopeCase) => {
    test("is one switch, Send reminders, under the card's own title and line, with no Edit button", async () => {
      const control: HTMLElement = await renderCard(scopeCase);

      expect(
        screen.getByText(RemindersSwitchCopy.cardTitle),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          REMINDERS_SWITCH_SCOPE_COPY[scopeCase.scope].cardDescription,
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Send reminders" })).toBe(
        control,
      );
      expect(
        screen.queryByRole("button", { name: "Edit Reminders" }),
      ).toBeNull();
      expect(screen.queryByText("Enable Reminders")).toBeNull();
    });

    test("reads the switch, the next reminder, the count and what reminder rules match on, in one read", async () => {
      await renderCard(scopeCase);

      const expected: Record<string, unknown> = {
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
        labels: { _id: true },
        [REMINDERS_SWITCH_COLUMN]: true,
      };

      if (scopeCase.severityColumn) {
        expected[scopeCase.severityColumn] = true;
      }

      expect(recordReads()).toHaveLength(1);
      expect(recordReads()[0]!.modelType).toBe(scopeCase.modelType);
      expect(recordReads()[0]!.id.toString()).toBe(RECORD_ID);
      expect(recordReads()[0]!.select).toEqual(expected);
    });

    test("a record nobody switched is on: the column defaults to sending reminders", async () => {
      const control: HTMLElement = await renderCard(scopeCase);

      expect(control).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText(
          REMINDERS_SWITCH_SCOPE_COPY[scopeCase.scope].switchOnDescription,
        ),
      ).toBeInTheDocument();
    });

    test("a record with reminders off shows the switch off, and says so", async () => {
      stored = { enableReminders: false };

      const control: HTMLElement = await renderCard(scopeCase);

      expect(control).toHaveAttribute("aria-checked", "false");
      expect(
        screen.getByText(
          REMINDERS_SWITCH_SCOPE_COPY[scopeCase.scope].switchOffDescription,
        ),
      ).toBeInTheDocument();
      expect(
        within(details()).getByText(
          "Reminders are disabled, so no reminder is scheduled.",
        ),
      ).toBeInTheDocument();
    });

    test("the next reminder and the reminders sent are read-only lines under the switch", async () => {
      stored = {
        enableReminders: true,
        nextReminderNotificationAt: NEXT_REMINDER,
        reminderNotificationSentCount: 3,
      };

      const control: HTMLElement = await renderCard(scopeCase);

      expect(
        within(details()).getByText(RemindersSwitchCopy.nextReminderTitle),
      ).toBeInTheDocument();
      expect(
        within(details()).getByText(RemindersSwitchCopy.remindersSentTitle),
      ).toBeInTheDocument();
      expect(within(details()).getByText("3")).toBeInTheDocument();
      expect(
        within(details()).getByText(/^Scheduled for /),
      ).toBeInTheDocument();
      expect(details()).not.toContainElement(control);
      expect(
        screen.getByTestId(`${REMINDERS_SWITCH_TEST_ID}-details`),
      ).toContainElement(details());
    });

    test("no reminder sent yet reads 0, not a blank", async () => {
      await renderCard(scopeCase);

      expect(within(details()).getByText("0")).toBeInTheDocument();
    });

    test("turning reminders off saves that column alone, at once, and the countdown goes with it", async () => {
      stored = {
        enableReminders: true,
        nextReminderNotificationAt: NEXT_REMINDER,
      };

      const control: HTMLElement = await renderCard(scopeCase);
      expect(
        within(details()).getByText(/^Scheduled for /),
      ).toBeInTheDocument();

      fireEvent.click(control);
      await flush();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      expect(updateCall().modelType).toBe(scopeCase.modelType);
      expect(updateCall().id.toString()).toBe(RECORD_ID);
      expect(updateCall().data).toEqual({ enableReminders: false });

      expect(control).toHaveAttribute("aria-checked", "false");
      expect(
        screen.getByTestId(`${REMINDERS_SWITCH_TEST_ID}-status`),
      ).toHaveTextContent("Saved");
      expect(within(details()).queryByText(/^Scheduled for /)).toBeNull();
      expect(
        within(details()).getByText(
          "Reminders are disabled, so no reminder is scheduled.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("turning reminders on reads the record again, for the next reminder the server scheduled", async () => {
      stored = { enableReminders: false };

      const control: HTMLElement = await renderCard(scopeCase);

      fireEvent.click(control);
      await flush();

      expect(updateCall().data).toEqual({ enableReminders: true });
      expect(recordReads()).toHaveLength(2);
      expect(recordReads()[1]!.select).toEqual(recordReads()[0]!.select);
      expect(
        await within(details()).findByText(/^Scheduled for /),
      ).toBeInTheDocument();
      expect(control).toHaveAttribute("aria-checked", "true");
    });

    test("a refused change moves the switch back, says why, and keeps the countdown", async () => {
      stored = {
        enableReminders: true,
        nextReminderNotificationAt: NEXT_REMINDER,
      };
      updateByIdMock.mockImplementation(async (): Promise<unknown> => {
        throw new Error("You do not have permission to change reminders.");
      });

      const control: HTMLElement = await renderCard(scopeCase);

      fireEvent.click(control);
      await flush();

      expect(control).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to change reminders.",
      );
      expect(
        within(details()).getByText(/^Scheduled for /),
      ).toBeInTheDocument();
    });

    test("someone who may not change the column sees it locked, with why", async () => {
      getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
        (): PermissionGateResult => {
          return {
            isAllowed: false,
            disabledReason: "You need the Edit permission to change this.",
          };
        },
      );

      const control: HTMLElement = await renderCard(scopeCase);

      expect(control).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(control);
      await flush();

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(control).toHaveAttribute("aria-checked", "true");
    });

    test("the countdown looks up this kind of record's reminder rules", async () => {
      stored = {
        nextReminderNotificationAt: NEXT_REMINDER,
        labels: [Object.assign(new Label(), { _id: LABEL_ID })],
        ...(scopeCase.severityColumn
          ? { [scopeCase.severityColumn]: new ObjectID(SEVERITY_ID) }
          : {}),
      };

      await renderCard(scopeCase);

      const ruleTypes: Array<unknown> = getListMock.mock.calls.map(
        (call: Array<unknown>): unknown => {
          return (call[0] as { modelType: unknown }).modelType;
        },
      );

      expect(ruleTypes).toContain(scopeCase.ruleType);
    });
  },
);

describe("RemindersSwitchCopy", () => {
  test("every scope has its own sentences, and they name the record they are about", () => {
    for (const scopeCase of SCOPES) {
      const copy: (typeof REMINDERS_SWITCH_SCOPE_COPY)[ReminderRuleScope] =
        REMINDERS_SWITCH_SCOPE_COPY[scopeCase.scope];

      for (const sentence of [
        copy.cardDescription,
        copy.switchOnDescription,
        copy.switchOffDescription,
      ]) {
        expect([scopeCase.noun, sentence]).toEqual([
          scopeCase.noun,
          expect.stringContaining(scopeCase.noun),
        ]);
      }

      // Off says the rules are overridden; on says they set how often.
      expect(copy.switchOnDescription).toContain("reminder rules");
      expect(copy.switchOffDescription).toContain("reminder rules");
    }
  });

  test("the switch reads on = reminders go out, never 'Enable' or 'Disable'", () => {
    expect(RemindersSwitchCopy.switchTitle).toBe("Send reminders");

    for (const scopeCase of SCOPES) {
      for (const sentence of Object.values(
        REMINDERS_SWITCH_SCOPE_COPY[scopeCase.scope],
      )) {
        expect(sentence).not.toMatch(/enable|disable/i);
      }
    }
  });

  test("the countdown's scope is the same enum the card uses", () => {
    expect(ReminderRuleScopeFromCountdown).toBe(ReminderRuleScope);
  });
});
