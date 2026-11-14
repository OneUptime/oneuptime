import Alert from "../../../Models/DatabaseModels/Alert";
import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import AlertReminderRuleService from "../../../Server/Services/AlertReminderRuleService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { REMINDER_INTERVAL_REFUSAL } from "../../../Types/Reminder/ReminderInterval";
import ReminderStopState from "../../../Types/Reminder/ReminderStopState";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import { SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL } from "../../../Types/Reminder/ScheduledMaintenanceReminderNeverReminds";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A REMINDER RULE'S INTERVAL IS A WHOLE NUMBER OF MINUTES FROM 1 TO A YEAR.
 *
 * Found with #6978: the only check an incident's, an alert's or a scheduled
 * maintenance event's reminder rule had on "Reminder Interval (Minutes)" was
 * the required-column check every create makes. It refused 0 as
 * "reminderIntervalInMinutes is required" and took -5, which reminded the
 * owners every minute until the record was resolved; an edit was not
 * checked at all, so 0 saved there and the rule reminded nobody. Every
 * write is now held to the interval's rule (Types/Reminder/ReminderInterval)
 * in the rules' own words, however it is made, and the services that
 * schedule a record's next reminder read a rule saved before the check with
 * an interval below a minute as reminding nobody.
 *
 * The creates and updates here run the real pipeline - the hooks, the
 * permission checks and the required-column check - over tables in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "69780000-0000-4000-8000-0000000000a1",
);
const RULE_ID: ObjectID = new ObjectID("69780000-0000-4000-8000-0000000000a2");
const RECORD_ID: ObjectID = new ObjectID(
  "69780000-0000-4000-8000-0000000000a3",
);

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

type RuleService = DatabaseService<BaseModel>;

interface RuleKind {
  name: string;
  service: RuleService;
  makeRule: () => BaseModel;
  storedRule: () => StoredRow;
  permissions: Array<Permission>;
  // The refresh every create, update and delete of a rule runs.
  refresh: string;
}

const RULE_KINDS: Array<RuleKind> = [
  {
    name: "an alert reminder rule",
    service: AlertReminderRuleService as unknown as RuleService,
    makeRule: (): BaseModel => {
      const rule: AlertReminderRule = new AlertReminderRule();
      rule.stopRemindersOnState = ReminderStopState.Resolved;
      return rule;
    },
    storedRule: (): StoredRow => {
      return { stopRemindersOnState: ReminderStopState.Resolved };
    },
    permissions: [
      Permission.CreateAlertReminderRule,
      Permission.ReadAlertReminderRule,
      Permission.EditAlertReminderRule,
    ],
    refresh: "refreshSchedulesForOpenAlerts",
  },
  {
    name: "an incident reminder rule",
    service: IncidentReminderRuleService as unknown as RuleService,
    makeRule: (): BaseModel => {
      const rule: IncidentReminderRule = new IncidentReminderRule();
      rule.stopRemindersOnState = ReminderStopState.Resolved;
      return rule;
    },
    storedRule: (): StoredRow => {
      return { stopRemindersOnState: ReminderStopState.Resolved };
    },
    permissions: [
      Permission.CreateIncidentReminderRule,
      Permission.ReadIncidentReminderRule,
      Permission.EditIncidentReminderRule,
    ],
    refresh: "refreshSchedulesForOpenIncidents",
  },
  {
    name: "a scheduled maintenance reminder rule",
    service: ScheduledMaintenanceReminderRuleService as unknown as RuleService,
    makeRule: (): BaseModel => {
      const rule: ScheduledMaintenanceReminderRule =
        new ScheduledMaintenanceReminderRule();
      rule.remindWhileScheduled = true;
      rule.stopRemindersOnState =
        ScheduledMaintenanceReminderStopState.Completed;
      return rule;
    },
    storedRule: (): StoredRow => {
      return {
        remindWhileScheduled: true,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
      };
    },
    permissions: [
      Permission.CreateScheduledMaintenanceReminderRule,
      Permission.ReadScheduledMaintenanceReminderRule,
      Permission.EditScheduledMaintenanceReminderRule,
    ],
    refresh: "refreshSchedulesForOpenScheduledMaintenances",
  },
];

function ruleEditor(kind: RuleKind): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      projectId: PROJECT_ID,
      permissions: kind.permissions,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function ruleWith(kind: RuleKind, columns: StoredRow): BaseModel {
  const rule: BaseModel = kind.makeRule();
  const row: StoredRow = rule as unknown as StoredRow;
  row["projectId"] = PROJECT_ID;
  row["name"] = "Remind the owners";
  row["isEnabled"] = true;

  for (const [column, value] of Object.entries(columns)) {
    row[column] = value;
  }

  return rule;
}

async function refusalOf(write: () => Promise<unknown>): Promise<unknown> {
  try {
    await write();
  } catch (err) {
    return err;
  }

  throw new Error("The write was not refused.");
}

// The values a write may not save, and why each is one.
const REFUSED: Array<[string, unknown]> = [
  ["0, which the required check called missing", 0],
  ["-5, which reminded every minute", -5],
  ["-1", -1],
  ["a part of a minute", 1.5],
  ["more than a year", 525601],
  ["0 as text", "0"],
  ["-5 as text", "-5"],
  ["words", "thirty"],
  ["an emptied box", ""],
];

describe.each(RULE_KINDS)("$name", (kind: RuleKind) => {
  let table: InMemoryTable;

  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
    jest.spyOn(logger, "info").mockImplementation((() => {}) as never);
    jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

    table = useInMemoryTable(kind.service, []);
    stubProjectDirectory({});

    // Each write re-schedules the project's open records: not under test.
    jest
      .spyOn(
        kind.service as unknown as Record<string, () => Promise<void>>,
        kind.refresh,
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("created", () => {
    test.each(REFUSED)(
      "with %s, is refused in the rule's own words, and nothing is saved",
      async (_label: string, interval: unknown) => {
        const refusal: unknown = await refusalOf(() => {
          return kind.service.create({
            data: ruleWith(kind, { reminderIntervalInMinutes: interval }),
            props: ruleEditor(kind),
          });
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toBe(REMINDER_INTERVAL_REFUSAL);
        expect(table.inserts).toHaveLength(0);
        expect(table.rows).toHaveLength(0);
      },
    );

    test("with null, is refused in the rule's own words", async () => {
      const refusal: unknown = await refusalOf(() => {
        return kind.service.create({
          data: ruleWith(kind, { reminderIntervalInMinutes: null }),
          props: ruleEditor(kind),
        });
      });

      expect((refusal as Error).message).toBe(REMINDER_INTERVAL_REFUSAL);
      expect(table.rows).toHaveLength(0);
    });

    test("without an interval, is still refused as one that is required", async () => {
      const refusal: unknown = await refusalOf(() => {
        return kind.service.create({
          data: ruleWith(kind, {}),
          props: ruleEditor(kind),
        });
      });

      expect((refusal as Error).message).toBe(
        "reminderIntervalInMinutes is required",
      );
      expect(table.rows).toHaveLength(0);
    });

    test("by root - a workflow, the server itself - is held to it too", async () => {
      const refusal: unknown = await refusalOf(() => {
        return kind.service.create({
          data: ruleWith(kind, { reminderIntervalInMinutes: -5 }),
          props: { isRoot: true },
        });
      });

      expect((refusal as Error).message).toBe(REMINDER_INTERVAL_REFUSAL);
      expect(table.rows).toHaveLength(0);
    });

    test.each([
      [1, 1],
      [30, 30],
      [1440, 1440],
      [525600, 525600],
    ])(
      "every %p minutes, is saved as %p",
      async (interval: number, saved: number) => {
        await kind.service.create({
          data: ruleWith(kind, { reminderIntervalInMinutes: interval }),
          props: ruleEditor(kind),
        });

        expect(table.rows).toHaveLength(1);
        expect(table.rows[0]!["reminderIntervalInMinutes"]).toBe(saved);
      },
    );

    test("with an interval sent as text, saves the number it spells", async () => {
      await kind.service.create({
        data: ruleWith(kind, { reminderIntervalInMinutes: "45" }),
        props: ruleEditor(kind),
      });

      expect(table.inserts).toHaveLength(1);
      expect(table.inserts[0]!["reminderIntervalInMinutes"]).toBe(45);
    });
  });

  describe("edited", () => {
    function storeRule(interval: number): void {
      table.rows.push({
        _id: RULE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Remind the owners",
        isEnabled: true,
        reminderIntervalInMinutes: interval,
        version: 1,
        ...kind.storedRule(),
      });
    }

    async function edit(data: StoredRow): Promise<void> {
      await kind.service.updateOneById({
        id: RULE_ID,
        data: data as never,
        props: ruleEditor(kind),
      });
    }

    test.each([...REFUSED, ["null", null] as [string, unknown]])(
      "to %s, is refused, and the rule keeps its interval",
      async (_label: string, interval: unknown) => {
        storeRule(30);

        const refusal: unknown = await refusalOf(() => {
          return edit({ reminderIntervalInMinutes: interval });
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toBe(REMINDER_INTERVAL_REFUSAL);
        expect(table.updates).toHaveLength(0);
        expect(table.get(RULE_ID)!["reminderIntervalInMinutes"]).toBe(30);
      },
    );

    test("to 0 is refused: it saved before, and the rule then reminded nobody", async () => {
      storeRule(30);

      await expect(edit({ reminderIntervalInMinutes: 0 })).rejects.toThrow(
        REMINDER_INTERVAL_REFUSAL,
      );
      expect(table.get(RULE_ID)!["reminderIntervalInMinutes"]).toBe(30);
    });

    test("to every 2 hours, as text, saves 120", async () => {
      storeRule(30);

      await edit({ reminderIntervalInMinutes: "120" });

      expect(table.updates).toHaveLength(1);
      expect(table.updates[0]!.set["reminderIntervalInMinutes"]).toBe(120);
      expect(table.get(RULE_ID)!["reminderIntervalInMinutes"]).toBe(120);
    });

    test("without touching the interval - a rename - saves, even on a rule saved with -5 before the check", async () => {
      storeRule(-5);

      await edit({ name: "Remind the on-call team" });

      expect(table.get(RULE_ID)!["name"]).toBe("Remind the on-call team");
      expect(table.get(RULE_ID)!["reminderIntervalInMinutes"]).toBe(-5);
    });

    test("a rule saved with -5 before the check is put right by an edit to a real interval", async () => {
      storeRule(-5);

      await edit({ reminderIntervalInMinutes: 60 });

      expect(table.get(RULE_ID)!["reminderIntervalInMinutes"]).toBe(60);
    });
  });
});

describe("a scheduled maintenance reminder rule with two problems", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
    useInMemoryTable(
      ScheduledMaintenanceReminderRuleService as unknown as RuleService,
      [],
    );
    stubProjectDirectory({});
    jest
      .spyOn(
        ScheduledMaintenanceReminderRuleService,
        "refreshSchedulesForOpenScheduledMaintenances",
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is told about its interval first, and then, once that is put right, about the timing that never reminds", async () => {
    const kind: RuleKind = RULE_KINDS[2]!;
    const neverReminds: StoredRow = {
      remindWhileScheduled: false,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
    };

    await expect(
      kind.service.create({
        data: ruleWith(kind, {
          ...neverReminds,
          reminderIntervalInMinutes: -5,
        }),
        props: ruleEditor(kind),
      }),
    ).rejects.toThrow(REMINDER_INTERVAL_REFUSAL);

    await expect(
      kind.service.create({
        data: ruleWith(kind, {
          ...neverReminds,
          reminderIntervalInMinutes: 30,
        }),
        props: ruleEditor(kind),
      }),
    ).rejects.toThrow(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL);
  });
});

/*
 * The services that schedule an open record's next reminder - when it is
 * created, when its rule or its labels change - read the matching rule's
 * interval as the workers do.
 */
interface RecordKind {
  name: string;
  refresh: () => Promise<void>;
  service: unknown;
  ruleService: unknown;
  record: () => BaseModel;
  rule: (interval: number) => BaseModel;
  isClosed: string;
}

const RECORD_KINDS: Array<RecordKind> = [
  {
    name: "an alert",
    refresh: (): Promise<void> => {
      return AlertService.refreshReminderSchedule({
        alertId: RECORD_ID,
        projectId: PROJECT_ID,
      });
    },
    service: AlertService,
    ruleService: AlertReminderRuleService,
    record: (): BaseModel => {
      const alert: Alert = new Alert(RECORD_ID);
      alert.enableReminders = true;
      alert.labels = [];
      return alert;
    },
    rule: (interval: number): BaseModel => {
      const rule: AlertReminderRule = new AlertReminderRule();
      rule.reminderIntervalInMinutes = interval;
      return rule;
    },
    isClosed: "isAlertResolved",
  },
  {
    name: "an incident",
    refresh: (): Promise<void> => {
      return IncidentService.refreshReminderSchedule({
        incidentId: RECORD_ID,
        projectId: PROJECT_ID,
      });
    },
    service: IncidentService,
    ruleService: IncidentReminderRuleService,
    record: (): BaseModel => {
      const incident: Incident = new Incident(RECORD_ID);
      incident.enableReminders = true;
      incident.labels = [];
      return incident;
    },
    rule: (interval: number): BaseModel => {
      const rule: IncidentReminderRule = new IncidentReminderRule();
      rule.reminderIntervalInMinutes = interval;
      return rule;
    },
    isClosed: "isIncidentResolved",
  },
  {
    name: "a scheduled maintenance event",
    refresh: (): Promise<void> => {
      return ScheduledMaintenanceService.refreshReminderSchedule({
        scheduledMaintenanceId: RECORD_ID,
        projectId: PROJECT_ID,
      });
    },
    service: ScheduledMaintenanceService,
    ruleService: ScheduledMaintenanceReminderRuleService,
    record: (): BaseModel => {
      const event: ScheduledMaintenance = new ScheduledMaintenance(RECORD_ID);
      event.enableReminders = true;
      event.labels = [];
      event.startsAt = new Date(NOW.getTime() - 60 * MINUTE_IN_MS);
      return event;
    },
    rule: (interval: number): BaseModel => {
      const rule: ScheduledMaintenanceReminderRule =
        new ScheduledMaintenanceReminderRule();
      rule.remindWhileScheduled = true;
      rule.reminderIntervalInMinutes = interval;
      return rule;
    },
    isClosed: "isScheduledMaintenanceCompleted",
  },
];

describe.each(RECORD_KINDS)(
  "scheduling the next reminder of $name",
  (kind: RecordKind) => {
    let writes: Array<StoredRow>;

    function matchRule(interval: number): void {
      jest
        .spyOn(
          kind.ruleService as Record<string, () => Promise<unknown>>,
          "findMatchingRule",
        )
        .mockResolvedValue(kind.rule(interval) as never);
    }

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
      writes = [];

      jest
        .spyOn(
          kind.service as Record<string, () => Promise<unknown>>,
          "findOneById",
        )
        .mockResolvedValue(kind.record() as never);
      jest
        .spyOn(
          kind.service as Record<string, () => Promise<unknown>>,
          kind.isClosed,
        )
        .mockResolvedValue(false as never);
      jest
        .spyOn(
          kind.service as Record<
            string,
            (data: { data: StoredRow }) => Promise<unknown>
          >,
          "updateOneById",
        )
        .mockImplementation((async (update: {
          data: StoredRow;
        }): Promise<void> => {
          writes.push(update.data);
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    test.each([[-5], [-1], [0]])(
      "with a rule saved with %p minutes before the check, schedules none - never one in the past",
      async (interval: number) => {
        matchRule(interval);

        await kind.refresh();

        expect(writes).toEqual([{ nextReminderNotificationAt: null }]);
      },
    );

    test("with a rule reminding every 45 minutes, schedules one 45 minutes on", async () => {
      matchRule(45);

      await kind.refresh();

      expect(writes).toEqual([
        {
          nextReminderNotificationAt: new Date(
            NOW.getTime() + 45 * MINUTE_IN_MS,
          ),
        },
      ]);
    });
  },
);
