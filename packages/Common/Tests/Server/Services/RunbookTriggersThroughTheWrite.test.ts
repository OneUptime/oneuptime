import RunbookService, {
  RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE,
  Service as RunbookServiceClass,
} from "../../../Server/Services/RunbookService";
import RunbookLabelRuleEngineService from "../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "../../../Server/Services/RunbookOwnerRuleEngineService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import { RUNBOOK_TRIGGER_REFUSED_MESSAGE } from "../../../Server/Utils/Runbook/RunbookTriggerAccess";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
} from "../../../Types/Runbook/RunbookSchedule";
import { isRunbookWebhookSecretKeyShape } from "../../../Types/Runbook/RunbookWebhook";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RUNBOOK'S TRIGGERS, through the whole write: the real permission
 * checks, the real hooks and the real success hooks, as each kind of
 * member, against an in-memory Runbook table.
 *
 *   - Setting up a schedule or a webhook takes permission to edit the
 *     runbook AND to run it: Edit Runbook alone may change its steps but
 *     not make them run on their own. Turning a trigger off takes only the
 *     edit.
 *   - Settings the scheduler could not read are refused in plain words.
 *   - The scheduler's columns and the webhook's key are OneUptime's: a
 *     member who sends one is refused.
 *   - A change of when the schedule runs works the next run out again from
 *     now; a save that changes nothing moves nothing. Turning the webhook
 *     on gives it a key once, which it keeps.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111aa",
);
const RUNBOOK_ID: string = "22222222-2222-4222-8222-2222222222bb";
const NOW: Date = new Date("2026-10-15T08:00:00.000Z");

let table: InMemoryTable;

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

const RUNBOOK_ADMIN: Array<Permission> = [Permission.RunbookAdmin];
const PROJECT_OWNER: Array<Permission> = [Permission.ProjectOwner];
const EDIT_ONLY: Array<Permission> = [
  Permission.EditRunbook,
  Permission.ReadRunbook,
];
const EDIT_AND_START_RUNS: Array<Permission> = [
  Permission.EditRunbook,
  Permission.ReadRunbook,
  Permission.CreateRunbookExecution,
];
const RUNBOOK_MEMBER: Array<Permission> = [Permission.RunbookMember];

function stored(column: string): unknown {
  return table.get(RUNBOOK_ID)?.[column];
}

function storedDate(column: string): string | null {
  const value: unknown = stored(column);
  return value ? new Date(value as Date).toISOString() : null;
}

async function change(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await RunbookService.updateOneById({
    id: new ObjectID(RUNBOOK_ID),
    // Each write its own copy, as each request's: the hooks write into it.
    data: { ...data } as never,
    props: props,
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

function sameValue(storedValue: unknown, expected: unknown): boolean {
  const isEmpty: (value: unknown) => boolean = (value: unknown): boolean => {
    return value === null || value === undefined;
  };

  if (isEmpty(storedValue) || isEmpty(expected)) {
    return isEmpty(storedValue) && isEmpty(expected);
  }

  if (storedValue instanceof Date || expected instanceof Date) {
    return (
      new Date(storedValue as Date).getTime() ===
      new Date(expected as Date).getTime()
    );
  }

  return String(storedValue) === String(expected);
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  getJestSpyOn(
    RunbookLabelRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    RunbookOwnerRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);

  table = useInMemoryTable(RunbookService, [
    {
      _id: RUNBOOK_ID,
      projectId: PROJECT_ID.toString(),
      name: "Rotate the logs",
      slug: "rotate-the-logs",
      isEnabled: true,
      steps: [],
      isScheduleEnabled: false,
      scheduleCron: null,
      scheduleTimezone: null,
      scheduleNextRunAt: null,
      scheduleQueuedRunAt: null,
      isWebhookEnabled: false,
      webhookSecretKey: null,
      version: 1,
    },
  ]);

  // The scheduler's and the key's writes: one statement, as Postgres runs it.
  getJestSpyOn(
    RunbookService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }): Promise<boolean> => {
      const row: StoredRow | undefined = table.get(input.id);

      if (!row) {
        return false;
      }

      for (const [column, value] of Object.entries(input.expectedData)) {
        if (!sameValue(row[column], value)) {
          return false;
        }
      }

      Object.assign(row, input.data);
      return true;
    },
  );
  getJestSpyOn(
    RunbookService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      Object.assign(table.get(input.id)!, input.data);
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const WEEKDAYS_AT_NINE: Record<string, unknown> = {
  isScheduleEnabled: true,
  scheduleCron: "0  9 * *   1-5",
  scheduleTimezone: " Europe/London ",
  scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.Skip,
  scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.RunOnce,
};

describe("setting up a schedule", () => {
  test.each([
    ["a runbook admin", RUNBOOK_ADMIN],
    ["a project owner", PROJECT_OWNER],
    ["someone who may edit runbooks and start runs", EDIT_AND_START_RUNS],
  ])(
    "%s sets one up, and its next run is worked out on the zone's clock",
    async (_who: string, permissions: Array<Permission>) => {
      await change(WEEKDAYS_AT_NINE, member(permissions));

      expect(stored("isScheduleEnabled")).toBe(true);
      // Kept with its fields one space apart, and the zone trimmed.
      expect(stored("scheduleCron")).toBe("0 9 * * 1-5");
      expect(stored("scheduleTimezone")).toBe("Europe/London");
      // Thursday 2026-10-15, 09:00 in London (BST) is 08:00 UTC; it is 08:00 now.
      expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T08:00:00.000Z");
    },
  );

  test("someone who may edit the runbook but not run it is refused, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      change(WEEKDAYS_AT_NINE, member(EDIT_ONLY)),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    expect(stored("isScheduleEnabled")).toBe(false);
    expect(stored("scheduleCron")).toBeNull();
  });

  test("someone who may run runbooks but not edit them is refused by the column's own permission", async () => {
    const error: unknown = await refusalOf(
      change(WEEKDAYS_AT_NINE, member(RUNBOOK_MEMBER)),
    );

    expect(error).not.toBeUndefined();
    expect(stored("isScheduleEnabled")).toBe(false);
  });

  test("changing only when it runs takes permission to run it too", async () => {
    await change(WEEKDAYS_AT_NINE, { isRoot: true });

    const error: unknown = await refusalOf(
      change({ scheduleCron: "*/5 * * * *" }, member(EDIT_ONLY)),
    );

    expect((error as Error).message).toBe(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    expect(stored("scheduleCron")).toBe("0 9 * * 1-5");
  });

  test("turning a schedule off takes only permission to edit the runbook", async () => {
    await change(WEEKDAYS_AT_NINE, { isRoot: true });

    await change({ isScheduleEnabled: false }, member(EDIT_ONLY));

    expect(stored("isScheduleEnabled")).toBe(false);
    // Off: no next run, and the schedule is kept for next time.
    expect(stored("scheduleNextRunAt")).toBeNull();
    expect(stored("scheduleCron")).toBe("0 9 * * 1-5");
  });

  test("a schedule cannot be turned on before it says when it runs", async () => {
    const error: unknown = await refusalOf(
      change({ isScheduleEnabled: true }, member(RUNBOOK_ADMIN)),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE);
    expect(stored("isScheduleEnabled")).toBe(false);
  });

  test("a cron, a time zone or a policy the scheduler cannot read is refused in plain words", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ scheduleCron: "0 0 31 2 *" }, "This schedule never runs"],
      [{ scheduleCron: "0 0 9 * * *" }, "five fields"],
      [{ scheduleCron: "61 9 * * *" }, "minute"],
      [
        { scheduleTimezone: "Mars/Olympus_Mons" },
        '"Mars/Olympus_Mons" is not a time zone.',
      ],
      [{ scheduleOverlapPolicy: "Sometimes" }, '"Skip" or "RunAfter"'],
      [{ scheduleMissedRunPolicy: "Twice" }, '"RunOnce" or "Skip"'],
    ];

    for (const [data, words] of cases) {
      const error: unknown = await refusalOf(
        change(data, member(RUNBOOK_ADMIN)),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(words);
    }

    expect(stored("scheduleCron")).toBeNull();
    expect(stored("scheduleTimezone")).toBeNull();
  });

  test("the scheduler's own columns are OneUptime's: a member who sends one is refused", async () => {
    for (const column of ["scheduleNextRunAt", "scheduleQueuedRunAt"]) {
      const error: unknown = await refusalOf(
        change(
          { ...WEEKDAYS_AT_NINE, [column]: new Date("2030-01-01T00:00:00Z") },
          member(PROJECT_OWNER),
        ),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(column);
    }

    expect(stored("isScheduleEnabled")).toBe(false);
  });
});

describe("when the next run is worked out again", () => {
  beforeEach(async () => {
    await change(WEEKDAYS_AT_NINE, { isRoot: true });
    // As the scheduler leaves it: a run waiting, a next run planned.
    table.get(RUNBOOK_ID)!["scheduleQueuedRunAt"] = new Date(
      "2026-10-14T08:00:00.000Z",
    );
  });

  test("a new cron: the next run follows it, and the waiting run is dropped", async () => {
    await change({ scheduleCron: "30 8 * * *" }, member(RUNBOOK_ADMIN));

    // 08:30 in London (BST) is 07:30 UTC: today's has passed, so tomorrow's.
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T07:30:00.000Z");
    expect(stored("scheduleQueuedRunAt")).toBeNull();
  });

  test("a new time zone: 09:00 is read on its clock", async () => {
    await change(
      { scheduleTimezone: "America/New_York" },
      member(RUNBOOK_ADMIN),
    );

    // 09:00 in New York (EDT) is 13:00 UTC, later today.
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-15T13:00:00.000Z");
  });

  test("turning the runbook off clears it; turning it back on works it out from then", async () => {
    await change({ isEnabled: false }, member(RUNBOOK_ADMIN));

    expect(stored("scheduleNextRunAt")).toBeNull();
    expect(stored("scheduleQueuedRunAt")).toBeNull();

    await change({ isEnabled: true }, member(RUNBOOK_ADMIN));

    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T08:00:00.000Z");
  });

  test("a rename, or a save that sends the schedule unchanged, moves nothing", async () => {
    table.get(RUNBOOK_ID)!["scheduleNextRunAt"] = new Date(
      "2026-10-15T07:59:00.000Z",
    );

    await change({ name: "Rotate all the logs" }, member(RUNBOOK_ADMIN));
    await change(
      {
        isScheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "Europe/London",
      },
      member(RUNBOOK_ADMIN),
    );

    // A run due a minute ago is not lost to the save.
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-15T07:59:00.000Z");
    expect(storedDate("scheduleQueuedRunAt")).toBe("2026-10-14T08:00:00.000Z");
  });
});

describe("the webhook", () => {
  test("turning it on gives it a key, once: off and on again keeps the same URL", async () => {
    await change({ isWebhookEnabled: true }, member(RUNBOOK_ADMIN));

    const key: unknown = stored("webhookSecretKey");

    expect(isRunbookWebhookSecretKeyShape(key)).toBe(true);

    await change({ isWebhookEnabled: false }, member(RUNBOOK_ADMIN));
    expect(stored("webhookSecretKey")).toBe(key);

    await change({ isWebhookEnabled: true }, member(RUNBOOK_ADMIN));
    expect(stored("webhookSecretKey")).toBe(key);
  });

  test("turning it on takes permission to run the runbook; turning it off does not", async () => {
    const error: unknown = await refusalOf(
      change({ isWebhookEnabled: true }, member(EDIT_ONLY)),
    );

    expect((error as Error).message).toBe(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    expect(stored("isWebhookEnabled")).toBe(false);
    expect(stored("webhookSecretKey")).toBeNull();

    await change({ isWebhookEnabled: true }, { isRoot: true });
    await change({ isWebhookEnabled: false }, member(EDIT_ONLY));

    expect(stored("isWebhookEnabled")).toBe(false);
  });

  test("its key is never written through the API, not even by an owner", async () => {
    const error: unknown = await refusalOf(
      change(
        { isWebhookEnabled: true, webhookSecretKey: "a".repeat(43) },
        member(PROJECT_OWNER),
      ),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect(stored("webhookSecretKey")).toBeNull();
  });

  test("a reset gives it a new key; the old one is gone", async () => {
    await change({ isWebhookEnabled: true }, member(RUNBOOK_ADMIN));

    const before: unknown = stored("webhookSecretKey");
    const after: string = await RunbookService.resetWebhookSecretKey(
      new ObjectID(RUNBOOK_ID),
    );

    expect(isRunbookWebhookSecretKeyShape(after)).toBe(true);
    expect(after).not.toBe(before);
    expect(stored("webhookSecretKey")).toBe(after);
  });

  test("every key is new: a thousand keys, no two alike", () => {
    const keys: Set<string> = new Set<string>();

    for (let i: number = 0; i < 1000; i++) {
      keys.add(RunbookServiceClass.generateWebhookSecretKey());
    }

    expect(keys.size).toBe(1000);
  });
});

describe("creating a runbook with a trigger on", () => {
  async function create(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Runbook> {
    const runbook: Runbook = new Runbook();

    Object.assign(runbook, {
      projectId: PROJECT_ID,
      name: "Nightly clean-up",
      steps: [],
      ...data,
    });

    return await RunbookService.create({ data: runbook, props: props });
  }

  function createdRow(): StoredRow | undefined {
    return table.rows.find((row: StoredRow) => {
      return row["name"] === "Nightly clean-up";
    });
  }

  test("a runbook admin may: its next run is planned and its webhook gets a key", async () => {
    await create(
      {
        isScheduleEnabled: true,
        scheduleCron: "0 2 * * *",
        scheduleTimezone: "UTC",
        isWebhookEnabled: true,
      },
      member(RUNBOOK_ADMIN),
    );

    const row: StoredRow | undefined = createdRow();

    expect(row).toBeDefined();
    expect(new Date(row!["scheduleNextRunAt"] as Date).toISOString()).toBe(
      "2026-10-16T02:00:00.000Z",
    );
    expect(isRunbookWebhookSecretKeyShape(row!["webhookSecretKey"])).toBe(true);
  });

  test("someone who may create runbooks but not run them may not turn a trigger on", async () => {
    const error: unknown = await refusalOf(
      create(
        { isWebhookEnabled: true },
        member([Permission.CreateRunbook, Permission.ReadRunbook]),
      ),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    expect(createdRow()).toBeUndefined();
  });

  test("a schedule cannot be on before it says when it runs", async () => {
    const error: unknown = await refusalOf(
      create({ isScheduleEnabled: true }, member(RUNBOOK_ADMIN)),
    );

    expect((error as Error).message).toBe(RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE);
    expect(createdRow()).toBeUndefined();
  });

  test("a runbook created with its triggers off needs no permission to run", async () => {
    await create(
      { scheduleCron: "0 2 * * *", isScheduleEnabled: false },
      member([Permission.CreateRunbook, Permission.ReadRunbook]),
    );

    expect(createdRow()).toBeDefined();
    expect(createdRow()!["scheduleNextRunAt"]).toBeUndefined();
  });
});
