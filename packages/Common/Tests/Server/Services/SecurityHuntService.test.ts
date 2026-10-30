import SecurityHuntService from "../../../Server/Services/SecurityHuntService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  SECURITY_HUNTS_PER_PROJECT_MAX,
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntSchedule,
} from "../../../Types/SecurityEvent/SecurityHunt";
import TimeRange from "../../../Types/Time/TimeRange";
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
 * A PROJECT'S HUNTS, AS THEY ARE SAVED (SecurityHuntService).
 *
 * Each is checked as its form checks it - a name, a search or chips the
 * Events sidebar can make, a schedule and a window it knows - at most
 * SECURITY_HUNTS_PER_PROJECT_MAX a project, and a scheduled one tells
 * somebody. The schedule is OneUptime's to keep: set, or given a new
 * search, a scheduled hunt starts from that moment, as the person who made
 * the change, and those columns are written only once the change has
 * passed every check (the permitted hooks). A teammate who saves a
 * scheduled hunt's schedule as it is takes its runs over, from where they
 * had got to. API keys set no schedule: no person stands behind one.
 */

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityHunt>,
  ) => Promise<OnCreate<SecurityHunt>>;
  onCreatePermitted: (onCreate: OnCreate<SecurityHunt>) => Promise<void>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityHunt>,
  ) => Promise<OnUpdate<SecurityHunt>>;
  onUpdatePermitted: (updateBy: UpdateBy<SecurityHunt>) => Promise<void>;
};

type Spy = ReturnType<typeof getJestSpyOn>;

const service: HookCaller = SecurityHuntService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const DIEGO: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000002");
const TEAM: ObjectID = new ObjectID("81000000-0000-4000-8000-000000000001");
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const OTHER_HUNT_ID: ObjectID = new ObjectID(
  "3b000000-0000-4000-8000-000000000002",
);
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const AS_MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA,
  tenantId: PROJECT_ID,
};
const AS_DIEGO: DatabaseCommonInteractionProps = {
  userId: DIEGO,
  tenantId: PROJECT_ID,
};
// An API key: a project, and nobody behind it.
const AS_API_KEY: DatabaseCommonInteractionProps = { tenantId: PROJECT_ID };

function user(id: ObjectID): User {
  const model: User = new User();
  model._id = id.toString();
  return model;
}

function team(id: ObjectID): Team {
  const model: Team = new Team();
  model._id = id.toString();
  return model;
}

function newHunt(values: Partial<Record<string, unknown>> = {}): SecurityHunt {
  const model: SecurityHunt = new SecurityHunt();
  model.projectId = PROJECT_ID;
  model.name = "Encoded PowerShell";
  model.searchQuery = "processname:powershell.exe commandline:-enc";
  Object.assign(model, values);
  return model;
}

function storedHunt(
  values: Partial<Record<string, unknown>> = {},
): SecurityHunt {
  const model: SecurityHunt = newHunt({
    _id: HUNT_ID.toString(),
    schedule: SecurityHuntSchedule.EveryDay,
    filters: {},
    notifyUsers: [user(MAYA)],
    notifyTeams: [],
    scheduledByUserId: MAYA,
    searchedUpToAt: new Date(NOW.getTime() - 3 * 60 * MINUTE),
    nextRunAt: new Date(NOW.getTime() + 21 * 60 * MINUTE),
    lastRunError: null,
    ...values,
  });
  return model;
}

function createBy(
  data: SecurityHunt,
  props: DatabaseCommonInteractionProps = AS_MAYA,
): CreateBy<SecurityHunt> {
  return { data, props } as CreateBy<SecurityHunt>;
}

function updateBy(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = AS_MAYA,
): UpdateBy<SecurityHunt> {
  return {
    query: { _id: HUNT_ID.toString() },
    data,
    props,
  } as unknown as UpdateBy<SecurityHunt>;
}

// The create, as the database layer runs it: decided, then written once permitted.
async function create(
  data: SecurityHunt,
  props: DatabaseCommonInteractionProps = AS_MAYA,
): Promise<JSONObject> {
  const onCreate: OnCreate<SecurityHunt> = await service.onBeforeCreate(
    createBy(data, props),
  );
  await service.onCreatePermitted(onCreate);
  return onCreate.createBy.data as unknown as JSONObject;
}

async function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = AS_MAYA,
): Promise<JSONObject> {
  const onUpdate: OnUpdate<SecurityHunt> = await service.onBeforeUpdate(
    updateBy(data, props),
  );
  await service.onUpdatePermitted(onUpdate.updateBy);
  return onUpdate.updateBy.data as unknown as JSONObject;
}

let count: Spy;
let heldRows: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW as never);
  count = getJestSpyOn(SecurityHuntService, "countBy").mockResolvedValue(
    new PositiveNumber(3) as never,
  );
  heldRows = getJestSpyOn(
    SecurityHuntService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue([storedHunt()] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a hunt saved", () => {
  test("with only a name and a search, is opened by hand and searches back a week", async () => {
    const data: JSONObject = await create(newHunt());

    expect(data["schedule"]).toBe(SecurityHuntSchedule.NotScheduled);
    expect(data["timeRange"]).toBe(TimeRange.PAST_ONE_WEEK);
    // Nothing to run, so nothing scheduled and nobody to run as.
    expect(data["nextRunAt"]).toBeNull();
    expect(data["searchedUpToAt"]).toBeNull();
    expect(data["scheduledByUserId"]).toBeNull();
  });

  test("keeps its name, description and search trimmed, and its chips as the sidebar reads them", async () => {
    const data: JSONObject = await create(
      newHunt({
        name: "  Encoded PowerShell  ",
        description: "  Why it matters  ",
        searchQuery: "  commandline:-enc  ",
        filters: { severityName: ["High", "High", ""], className: [] },
      }),
    );

    expect(data["name"]).toBe("Encoded PowerShell");
    expect(data["description"]).toBe("Why it matters");
    expect(data["searchQuery"]).toBe("commandline:-enc");
    expect(data["filters"]).toEqual({ severityName: ["High"] });
  });

  test("with chips and no search, is a search too", async () => {
    await expect(
      create(
        newHunt({
          searchQuery: "",
          filters: { "attributes.threat.matched": ["true"] },
        }),
      ),
    ).resolves.toBeDefined();
  });

  test.each([
    ["no name", { name: "  " }, SECURITY_HUNT_MESSAGES.enterName.message],
    [
      "a name past 100 characters",
      { name: "n".repeat(101) },
      SECURITY_HUNT_MESSAGES.nameTooLong.message,
    ],
    [
      "no search and no chips",
      { searchQuery: "", filters: {} },
      SECURITY_HUNT_MESSAGES.enterSearch.message,
    ],
    [
      "a chip the sidebar cannot make",
      { filters: { projectId: [PROJECT_ID.toString()] } },
      SECURITY_HUNT_MESSAGES.unknownFilter.message,
    ],
    [
      "a schedule it does not know",
      { schedule: "Every Minute" },
      SECURITY_HUNT_MESSAGES.unknownSchedule.message,
    ],
    [
      "a fixed window",
      { timeRange: TimeRange.CUSTOM },
      SECURITY_HUNT_MESSAGES.unknownTimeRange.message,
    ],
    [
      "a schedule and nobody to tell",
      { schedule: SecurityHuntSchedule.EveryHour, notifyUsers: [] },
      SECURITY_HUNT_MESSAGES.chooseRecipients.message,
    ],
  ])(
    "is refused with %s, in the words its form says",
    async (_: string, values: Record<string, unknown>, message: string) => {
      await expect(create(newHunt(values))).rejects.toEqual(
        new BadDataException(message),
      );
    },
  );

  test("tells at most 50 people and teams", async () => {
    const people: Array<User> = Array.from(
      { length: 30 },
      (_: unknown, index: number): User => {
        return user(
          new ObjectID(
            `80000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
          ),
        );
      },
    );
    const teams: Array<Team> = Array.from(
      { length: 21 },
      (_: unknown, index: number): Team => {
        return team(
          new ObjectID(
            `81000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
          ),
        );
      },
    );

    await expect(
      create(newHunt({ notifyUsers: people, notifyTeams: teams })),
    ).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.tooManyRecipients.message),
    );
    await expect(
      create(newHunt({ notifyUsers: people, notifyTeams: teams.slice(1) })),
    ).resolves.toBeDefined();
  });

  test("is refused once the project keeps 200 hunts, counted as OneUptime", async () => {
    count.mockResolvedValue(
      new PositiveNumber(SECURITY_HUNTS_PER_PROJECT_MAX) as never,
    );

    await expect(create(newHunt())).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.tooManyHunts.message),
    );
    expect(count).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("with a schedule, runs from now on, its first run one interval away, as the person who saved it", async () => {
    const data: JSONObject = await create(
      newHunt({
        schedule: SecurityHuntSchedule.EverySixHours,
        notifyTeams: [team(TEAM)],
      }),
    );

    expect(data["searchedUpToAt"]).toEqual(
      new Date(NOW.getTime() - SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000),
    );
    expect(data["nextRunAt"]).toEqual(
      new Date(NOW.getTime() + 6 * 60 * MINUTE),
    );
    expect(data["lastRunError"]).toBeNull();
    expect(data["scheduledByUserId"]).toEqual(MAYA);
    // Written as the id alone: no relation object rides along.
    expect(data).not.toHaveProperty("scheduledByUser");
  });

  test("writes the schedule only once permitted: the hook that decides it leaves the columns alone", async () => {
    const onCreate: OnCreate<SecurityHunt> = await service.onBeforeCreate(
      createBy(
        newHunt({
          schedule: SecurityHuntSchedule.EveryDay,
          notifyUsers: [user(MAYA)],
        }),
      ),
    );
    const decided: JSONObject = onCreate.createBy.data as unknown as JSONObject;

    expect(decided["nextRunAt"]).toBeUndefined();
    expect(decided["scheduledByUserId"]).toBeUndefined();

    await service.onCreatePermitted(onCreate);

    expect(decided["nextRunAt"]).toEqual(
      new Date(NOW.getTime() + 24 * 60 * MINUTE),
    );
  });

  test("ignores the run columns a request sends: what it found, when it runs, who it runs as", async () => {
    const data: JSONObject = await create(
      newHunt({
        schedule: SecurityHuntSchedule.EveryHour,
        notifyUsers: [user(MAYA)],
        scheduledByUserId: DIEGO,
        nextRunAt: new Date("2020-01-01T00:00:00.000Z"),
        searchedUpToAt: new Date("2020-01-01T00:00:00.000Z"),
        lastRunError: "sent by the request",
      }),
    );

    expect(data["scheduledByUserId"]).toEqual(MAYA);
    expect(data["nextRunAt"]).toEqual(new Date(NOW.getTime() + 60 * MINUTE));
    expect(data["searchedUpToAt"]).toEqual(
      new Date(NOW.getTime() - SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000),
    );
    expect(data["lastRunError"]).toBeNull();
  });

  test("by an API key: opened by hand, yes; on a schedule, no - nobody to run as", async () => {
    await expect(create(newHunt(), AS_API_KEY)).resolves.toBeDefined();
    await expect(
      create(
        newHunt({
          schedule: SecurityHuntSchedule.EveryDay,
          notifyUsers: [user(MAYA)],
        }),
        AS_API_KEY,
      ),
    ).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.scheduleNeedsPerson.message),
    );
  });

  test("by OneUptime itself, on a schedule: kept, with nobody to run as", async () => {
    const data: JSONObject = await create(
      newHunt({
        schedule: SecurityHuntSchedule.EveryDay,
        notifyUsers: [user(MAYA)],
      }),
      { isRoot: true },
    );

    expect(data["scheduledByUserId"]).toBeNull();
    expect(data["nextRunAt"]).toEqual(
      new Date(NOW.getTime() + 24 * 60 * MINUTE),
    );
  });
});

describe("a hunt changed", () => {
  test("by its name alone, reads no row and leaves its schedule as it is", async () => {
    const data: JSONObject = await update({ name: "  Encoded PS  " });

    expect(data).toEqual({ name: "Encoded PS" });
    expect(heldRows).not.toHaveBeenCalled();
  });

  test("checks the name and description as sent, and only those", async () => {
    await expect(update({ name: "" })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.enterName.message),
    );
    await expect(update({ description: "d".repeat(2001) })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.descriptionTooLong.message),
    );
    await expect(
      update({ description: "Why it matters" }),
    ).resolves.toBeDefined();
  });

  test("refuses a schedule or a window it does not know", async () => {
    await expect(update({ schedule: "Every Minute" })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.unknownSchedule.message),
    );
    await expect(update({ timeRange: TimeRange.CUSTOM })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.unknownTimeRange.message),
    );
  });

  test("is checked as the hunt it leaves behind: a search taken away with no chips left", async () => {
    await expect(update({ searchQuery: "  " })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.enterSearch.message),
    );

    heldRows.mockResolvedValue([
      storedHunt({ filters: { severityName: ["High"] } }),
    ] as never);

    // The chips it keeps stand in for the search.
    await expect(update({ searchQuery: "" })).resolves.toBeDefined();
  });

  test("a scheduled hunt left telling nobody is refused", async () => {
    await expect(update({ notifyUsers: [], notifyTeams: [] })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.chooseRecipients.message),
    );
    // A team instead of the person: still somebody.
    await expect(
      update({ notifyUsers: [], notifyTeams: [team(TEAM)] as never }),
    ).resolves.toBeDefined();
  });

  test("given a schedule, starts from now, as the person who set it", async () => {
    heldRows.mockResolvedValue([
      storedHunt({
        schedule: SecurityHuntSchedule.NotScheduled,
        scheduledByUserId: null,
        nextRunAt: null,
        searchedUpToAt: null,
      }),
    ] as never);

    const data: JSONObject = await update(
      { schedule: SecurityHuntSchedule.EveryHour },
      AS_DIEGO,
    );

    expect(data["scheduledByUserId"]).toEqual(DIEGO);
    expect(data["nextRunAt"]).toEqual(new Date(NOW.getTime() + 60 * MINUTE));
    expect(data["searchedUpToAt"]).toEqual(
      new Date(NOW.getTime() - SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000),
    );
  });

  test("given a new search while scheduled, starts again from now: its runs never read the old search's window", async () => {
    const data: JSONObject = await update({
      searchQuery: "processname:powershell.exe",
    });

    expect(data["searchedUpToAt"]).toEqual(
      new Date(NOW.getTime() - SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000),
    );
    expect(data["nextRunAt"]).toEqual(
      new Date(NOW.getTime() + 24 * 60 * MINUTE),
    );
  });

  test("given its own search again, or its chips in another order, changes nothing", async () => {
    heldRows.mockResolvedValue([
      storedHunt({ filters: { severityName: ["High", "Critical"] } }),
    ] as never);

    const data: JSONObject = await update({
      searchQuery: "processname:powershell.exe commandline:-enc",
      filters: { severityName: ["Critical", "High"] },
    });

    expect(data).not.toHaveProperty("nextRunAt");
    expect(data).not.toHaveProperty("searchedUpToAt");
  });

  test("not scheduled, given a new search: nothing to start", async () => {
    heldRows.mockResolvedValue([
      storedHunt({
        schedule: SecurityHuntSchedule.NotScheduled,
        scheduledByUserId: null,
      }),
    ] as never);

    const data: JSONObject = await update({ searchQuery: "user:root" });

    expect(data).toEqual({ searchQuery: "user:root" });
  });

  test("taken off its schedule, runs no more and runs as nobody; what it found stays", async () => {
    const data: JSONObject = await update({
      schedule: SecurityHuntSchedule.NotScheduled,
    });

    expect(data["nextRunAt"]).toBeNull();
    expect(data["searchedUpToAt"]).toBeNull();
    expect(data["scheduledByUserId"]).toBeNull();
    expect(data).not.toHaveProperty("lastFoundAt");
    expect(data).not.toHaveProperty("lastFoundEventCount");
  });

  test("changes one hunt's schedule or search at a time: each starts with its own moment and author", async () => {
    heldRows.mockResolvedValue([
      storedHunt(),
      storedHunt({ _id: OTHER_HUNT_ID.toString() }),
    ] as never);

    await expect(update({ searchQuery: "user:root" })).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.oneHuntAtATime.message),
    );
    // Their names, though, all at once.
    await expect(update({ description: "Kept" })).resolves.toBeDefined();
  });

  test("by an API key, may not set a schedule", async () => {
    await expect(
      update({ schedule: SecurityHuntSchedule.EveryWeek }, AS_API_KEY),
    ).rejects.toEqual(
      new BadDataException(SECURITY_HUNT_MESSAGES.scheduleNeedsPerson.message),
    );
  });
});

describe("a scheduled hunt saved as it is by a teammate", () => {
  test("runs as them from then on, from where its runs had got to", async () => {
    const data: JSONObject = await update(
      {
        name: "Encoded PowerShell",
        schedule: SecurityHuntSchedule.EveryDay,
        notifyUsers: [user(MAYA)] as never,
      },
      AS_DIEGO,
    );

    expect(data["scheduledByUserId"]).toEqual(DIEGO);
    // Not restarted: the window and the next run stay as they were.
    expect(data).not.toHaveProperty("searchedUpToAt");
    expect(data).not.toHaveProperty("nextRunAt");
    expect(data).not.toHaveProperty("lastRunError");
  });

  test("whose author could no longer read: the error that said so goes with it", async () => {
    heldRows.mockResolvedValue([
      storedHunt({
        lastRunError: SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      }),
    ] as never);

    const data: JSONObject = await update(
      { schedule: SecurityHuntSchedule.EveryDay },
      AS_DIEGO,
    );

    expect(data["scheduledByUserId"]).toEqual(DIEGO);
    expect(data["lastRunError"]).toBeNull();
  });

  test("keeps another run error: saving does not mend a search that took too long", async () => {
    heldRows.mockResolvedValue([
      storedHunt({ lastRunError: SECURITY_HUNT_RUN_ERRORS.timedOut.message }),
    ] as never);

    const data: JSONObject = await update(
      { schedule: SecurityHuntSchedule.EveryDay },
      AS_DIEGO,
    );

    expect(data["scheduledByUserId"]).toEqual(DIEGO);
    expect(data).not.toHaveProperty("lastRunError");
  });

  test("by the person it runs as, or without sending the schedule, or across hunts: nothing moves", async () => {
    expect(
      await update({ schedule: SecurityHuntSchedule.EveryDay }, AS_MAYA),
    ).not.toHaveProperty("scheduledByUserId");
    expect(
      await update({ notifyUsers: [user(MAYA)] as never }, AS_DIEGO),
    ).not.toHaveProperty("scheduledByUserId");

    heldRows.mockResolvedValue([
      storedHunt(),
      storedHunt({ _id: OTHER_HUNT_ID.toString() }),
    ] as never);

    expect(
      await update({ schedule: SecurityHuntSchedule.EveryDay }, AS_DIEGO),
    ).not.toHaveProperty("scheduledByUserId");
  });

  test("by an API key: still runs as its author", async () => {
    expect(
      await update({ schedule: SecurityHuntSchedule.EveryDay }, AS_API_KEY),
    ).not.toHaveProperty("scheduledByUserId");
  });
});
