import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import ProbeOwnerTeamService from "Common/Server/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "Common/Server/Services/ProbeOwnerUserService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import { PROBE_MISSED_FEATURE_SENTENCES } from "Common/Server/Utils/Probe/ProbeMajorReleaseNotification";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeFeature,
} from "Common/Types/Probe/ProbeReportedVersion";
import { EVERY_DAY } from "Common/Utils/CronTime";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
  usersNamedBy,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Probe:NotifyMajorReleaseBehind, the daily job that tells a custom probe's
 * owners once when it falls a major release behind the OneUptime it reports
 * to (OneUptime issue #9977).
 *
 * The real job runs, day after day, on the real rules
 * (Types/Probe/ProbeMajorReleaseNotice), the real words
 * (ProbeMajorReleaseNotification), the real owners read
 * (ProbeService.getOwners: owner users and the members of owner teams) and
 * the real once-only delivery (OwnerNotificationDeliveries), with the
 * probes' table, the owner tables, the project's owners and the delivery
 * table stood in for, and what each person is sent recorded.
 */

type CronHandler = () => Promise<void>;

interface CapturedJob {
  options: { schedule: string; runOnStartup: boolean };
  handler: CronHandler;
}

const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, handler: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import {
  PROBE_MAJOR_RELEASE_JOB_NAME,
  PROBE_MAJOR_RELEASE_PAGE_SIZE,
  ProbeMajorReleaseRun,
  getNoticeOccurrence,
  isComparableServerRelease,
  notifyProbesMajorReleaseBehind,
} from "../../../../FeatureSet/Workers/Jobs/Probe/NotifyMajorReleaseBehind";

const DAY: number = 24 * 60 * 60 * 1000;
const FIRST_DAY: Date = new Date("2026-11-20T08:00:00.000Z");
const HOME: string = "https://oneuptime.example.com";
const DOCS_LINK: string = `${HOME}/docs/probe/custom-probe#update-a-probe`;
const EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_PROBE_MAJOR_RELEASE_BEHIND_OWNER_NOTIFICATION;

function day(index: number): Date {
  return new Date(FIRST_DAY.getTime() + index * DAY);
}

// ---------- The world: probes, owners, teams and projects ----------

interface ProbeRow {
  id: ObjectID;
  projectId: ObjectID | null;
  projectName: string;
  name: string;
  description: string | null;
  isGlobalProbe: boolean;
  connectionStatus: ProbeConnectionStatus | null;
  reportedVersion: string | null;
  lastAlive: Date | null;
  majorVersionBehindNotifiedFor: number | null;
}

interface Sent {
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  subject: string;
  templateType: EmailTemplateType | undefined;
  vars: JSONObject;
  sms: string;
  call: string;
  pushTitle: string;
  pushBody: string;
  pushUrl: string | undefined;
}

interface World {
  probes: Array<ProbeRow>;
  ownerUsers: Map<string, Array<User>>;
  ownerTeams: Map<string, Array<ObjectID>>;
  teamMembers: Map<string, Array<User>>;
  projectOwners: Map<string, Array<User>>;
  users: Array<User>;
  sent: Array<Sent>;
  seeded: Array<string>;
  // Whose sends fail, by user id.
  failsFor: Set<string>;
  // Reads of a project's owners, by project id.
  projectOwnerReads: Map<string, number>;
  // Whether the probes' read honours its query: off, a read that returned every probe.
  isQueryHonoured: boolean;
  queries: Array<JSONObject>;
}

let world: World;
let deliveries: InMemoryOwnerNotificationDeliveries;
let clock: Date = FIRST_DAY;

function newWorld(): World {
  return {
    probes: [],
    ownerUsers: new Map(),
    ownerTeams: new Map(),
    teamMembers: new Map(),
    projectOwners: new Map(),
    users: [],
    sent: [],
    seeded: [],
    failsFor: new Set(),
    projectOwnerReads: new Map(),
    isQueryHonoured: true,
    queries: [],
  };
}

let userCount: number = 0;

function person(name: string): User {
  userCount++;
  const user: User = new User();
  user.id = new ObjectID(
    `11111111-0000-4000-8000-${userCount.toString().padStart(12, "0")}`,
  );
  user.name = name as never;
  world.users.push(user);
  return user;
}

let projectCount: number = 0;

function project(owners: Array<User>): ObjectID {
  projectCount++;
  const projectId: ObjectID = new ObjectID(
    `22222222-0000-4000-8000-${projectCount.toString().padStart(12, "0")}`,
  );
  world.projectOwners.set(projectId.toString(), owners);
  return projectId;
}

let probeCount: number = 0;

function addProbe(
  data: Partial<ProbeRow> & { projectId: ObjectID | null },
): ProbeRow {
  probeCount++;
  const row: ProbeRow = {
    id: new ObjectID(
      `33333333-0000-4000-8000-${probeCount.toString().padStart(12, "0")}`,
    ),
    projectName: "Acme Production",
    name: `probe-${probeCount}`,
    description: "The office network",
    isGlobalProbe: false,
    connectionStatus: ProbeConnectionStatus.Connected,
    reportedVersion: "18.0.0",
    lastAlive: FIRST_DAY,
    majorVersionBehindNotifiedFor: null,
    ...data,
  };

  world.probes.push(row);
  return row;
}

function ownedBy(
  probe: ProbeRow,
  users: Array<User>,
  teams?: Array<ObjectID>,
): void {
  world.ownerUsers.set(probe.id.toString(), users);
  world.ownerTeams.set(probe.id.toString(), teams || []);
}

function team(members: Array<User>): ObjectID {
  const teamId: ObjectID = ObjectID.generate();
  world.teamMembers.set(teamId.toString(), members);
  return teamId;
}

function asModel(row: ProbeRow): Probe {
  const probe: Probe = new Probe();
  probe.id = row.id;
  probe.name = row.name;

  if (row.description) {
    probe.description = row.description;
  }

  if (row.projectId) {
    probe.projectId = row.projectId;
    const owner: Project = new Project();
    owner.name = row.projectName;
    probe.project = owner;
  }

  probe.isGlobalProbe = row.isGlobalProbe;

  if (row.connectionStatus) {
    probe.connectionStatus = row.connectionStatus;
  }

  if (row.reportedVersion !== null) {
    probe.reportedVersion = row.reportedVersion;
  }

  if (row.lastAlive) {
    probe.lastAlive = row.lastAlive;
  }

  if (row.majorVersionBehindNotifiedFor !== null) {
    probe.majorVersionBehindNotifiedFor = row.majorVersionBehindNotifiedFor;
  }

  return probe;
}

// The value a Raw filter (QueryHelper.greaterThan, QueryHelper.any) holds.
function rawValue(filter: unknown): unknown {
  const parameters: JSONObject | undefined = (
    filter as { objectLiteralParameters?: JSONObject } | undefined
  )?.objectLiteralParameters;

  return parameters ? Object.values(parameters)[0] : undefined;
}

function standWorld(): void {
  jest.spyOn(ProbeService, "findBy").mockImplementation((async (input: {
    query: JSONObject;
    limit: number;
  }): Promise<Array<Probe>> => {
    world.queries.push(input.query);

    const after: string | undefined = input.query["_id"]
      ? String(rawValue(input.query["_id"]))
      : undefined;

    return world.probes
      .filter((row: ProbeRow): boolean => {
        if (!world.isQueryHonoured) {
          return true;
        }

        return (
          row.isGlobalProbe === input.query["isGlobalProbe"] &&
          row.connectionStatus === input.query["connectionStatus"]
        );
      })
      .filter((row: ProbeRow): boolean => {
        return !after || row.id.toString() > after;
      })
      .sort((a: ProbeRow, b: ProbeRow): number => {
        return a.id.toString() < b.id.toString() ? -1 : 1;
      })
      .slice(0, input.limit)
      .map(asModel);
  }) as never);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async (input: {
    id: ObjectID;
  }): Promise<Probe | null> => {
    const row: ProbeRow | undefined = world.probes.find(
      (candidate: ProbeRow): boolean => {
        return candidate.id.toString() === input.id.toString();
      },
    );

    return row ? asModel(row) : null;
  }) as never);

  jest
    .spyOn(ProbeService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }): Promise<boolean> => {
      const row: ProbeRow | undefined = world.probes.find(
        (candidate: ProbeRow): boolean => {
          return candidate.id.toString() === input.id.toString();
        },
      );

      if (
        !row ||
        row.majorVersionBehindNotifiedFor !==
          (input.expectedData["majorVersionBehindNotifiedFor"] ?? null)
      ) {
        return false;
      }

      row.majorVersionBehindNotifiedFor =
        (input.data["majorVersionBehindNotifiedFor"] as number | null) ?? null;
      return true;
    }) as never);

  jest
    .spyOn(ProbeOwnerUserService, "findBy")
    .mockImplementation((async (input: {
      query: JSONObject;
    }): Promise<Array<ProbeOwnerUser>> => {
      return (world.ownerUsers.get(String(input.query["probeId"])) || []).map(
        (user: User): ProbeOwnerUser => {
          const owner: ProbeOwnerUser = new ProbeOwnerUser();
          owner.user = user;
          return owner;
        },
      );
    }) as never);

  jest
    .spyOn(ProbeOwnerTeamService, "findBy")
    .mockImplementation((async (input: {
      query: JSONObject;
    }): Promise<Array<ProbeOwnerTeam>> => {
      return (world.ownerTeams.get(String(input.query["probeId"])) || []).map(
        (teamId: ObjectID): ProbeOwnerTeam => {
          const owner: ProbeOwnerTeam = new ProbeOwnerTeam();
          owner.teamId = teamId;
          return owner;
        },
      );
    }) as never);

  jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
    teamIds: Array<ObjectID>,
  ): Promise<Array<User>> => {
    return teamIds.flatMap((teamId: ObjectID): Array<User> => {
      return world.teamMembers.get(teamId.toString()) || [];
    });
  }) as never);

  jest.spyOn(ProjectService, "getOwners").mockImplementation((async (
    projectId: ObjectID,
  ): Promise<Array<User>> => {
    const key: string = projectId.toString();
    world.projectOwnerReads.set(
      key,
      (world.projectOwnerReads.get(key) || 0) + 1,
    );
    return world.projectOwners.get(key) || [];
  }) as never);

  jest.spyOn(UserService, "findBy").mockImplementation((async (input: {
    query: JSONObject;
  }): Promise<Array<User>> => {
    return usersNamedBy(world.users, input.query);
  }) as never);

  jest
    .spyOn(UserNotificationSettingService, "ensureSettingExistsForUser")
    .mockImplementation((async (input: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
    }): Promise<void> => {
      world.seeded.push(`${input.userId.toString()}|${input.eventType}`);
    }) as never);

  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (input: {
      userId: ObjectID;
      projectId: ObjectID;
      eventType: NotificationSettingEventType;
      emailEnvelope: {
        subject: string;
        templateType?: EmailTemplateType;
        vars: JSONObject;
      };
      smsMessage: { message: string };
      callRequestMessage: { data: Array<{ sayMessage: string }> };
      pushNotificationMessage: {
        title: string;
        body: string;
        clickAction?: string;
      };
    }): Promise<void> => {
      if (world.failsFor.has(input.userId.toString())) {
        throw new Error("The mail server refused.");
      }

      world.sent.push({
        userId: input.userId.toString(),
        projectId: input.projectId.toString(),
        eventType: input.eventType,
        subject: input.emailEnvelope.subject,
        templateType: input.emailEnvelope.templateType,
        vars: input.emailEnvelope.vars,
        sms: input.smsMessage.message,
        call: input.callRequestMessage.data[0]!.sayMessage,
        pushTitle: input.pushNotificationMessage.title,
        pushBody: input.pushNotificationMessage.body,
        pushUrl: input.pushNotificationMessage.clickAction,
      });
    }) as never);

  jest
    .spyOn(DatabaseConfig, "getHomeUrl")
    .mockResolvedValue(URL.fromString(HOME));
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(`${HOME}/dashboard`));
}

// One day's run, on this OneUptime's release.
async function runOn(
  dayIndex: number,
  serverVersion: string,
): Promise<ProbeMajorReleaseRun> {
  clock = day(dayIndex);

  return await notifyProbesMajorReleaseBehind({ serverVersion, now: clock });
}

// Lets a run that will never finish - a stopped worker's - get as far as it ever will.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

function sentTo(user: User): Array<Sent> {
  return world.sent.filter((sent: Sent): boolean => {
    return sent.userId === user.id!.toString();
  });
}

function sentAbout(probe: ProbeRow): Array<Sent> {
  return world.sent.filter((sent: Sent): boolean => {
    return String(sent.vars["viewProbeLink"]).endsWith(probe.id.toString());
  });
}

beforeEach(() => {
  world = newWorld();
  userCount = 0;
  projectCount = 0;
  probeCount = 0;
  clock = FIRST_DAY;
  deliveries = useInMemoryOwnerNotificationDeliveries();
  standWorld();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(clock.getTime());
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the job", () => {
  test("runs once a day, not on startup", () => {
    expect(mockCapturedJobs[PROBE_MAJOR_RELEASE_JOB_NAME]?.options).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: false,
    });
  });

  test("reads only connected custom probes, a page at a time, in id order", async () => {
    const projectId: ObjectID = project([person("Owner")]);
    addProbe({ projectId });

    await runOn(0, "18.0.0");

    expect(world.queries.length).toBeGreaterThan(0);

    for (const query of world.queries) {
      expect(query["isGlobalProbe"]).toBe(false);
      expect(query["connectionStatus"]).toBe(ProbeConnectionStatus.Connected);
    }
  });

  test("compares probes only with a OneUptime that runs a release", () => {
    expect(isComparableServerRelease("18.0.0")).toBe(true);
    expect(isComparableServerRelease("v18.2.1")).toBe(true);
    expect(isComparableServerRelease("18.0.0-test")).toBe(false);
    expect(isComparableServerRelease("18.0.0-rc.1")).toBe(false);
    expect(isComparableServerRelease("")).toBe(false);
    expect(isComparableServerRelease("unknown")).toBe(false);
  });

  test("a notice's occurrence is the day it went out", () => {
    expect(getNoticeOccurrence(day(0))).toBe(getNoticeOccurrence(day(0)));
    expect(getNoticeOccurrence(day(1))).toBe(getNoticeOccurrence(day(0)) + 1);
    expect(
      getNoticeOccurrence(new Date(day(0).getTime() + 15 * 60 * 60 * 1000)),
    ).toBe(getNoticeOccurrence(day(0)));
  });
});

describe("a probe a major release behind", () => {
  test("one major behind: its owner is told once, with which probe, how far behind, what it misses, and how to update it", async () => {
    const alice: User = person("Alice");
    const projectId: ObjectID = project([person("Project owner")]);
    const probe: ProbeRow = addProbe({
      projectId,
      name: "office-probe",
      reportedVersion: "17.2.0",
    });
    ownedBy(probe, [alice]);

    const run: ProbeMajorReleaseRun = await runOn(0, "18.0.0");

    expect(run).toMatchObject({ read: 1, told: 1, forgotten: 0 });
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);

    const sent: Array<Sent> = sentTo(alice);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.eventType).toBe(EVENT);
    expect(sent[0]!.templateType).toBe(
      EmailTemplateType.ProbeMajorReleaseBehind,
    );
    expect(sent[0]!.subject).toBe(
      "[Probe Update Available] office-probe is 1 major release behind OneUptime",
    );
    expect(sent[0]!.vars).toMatchObject({
      probeName: "office-probe",
      probeDescription: "The office network",
      probeRelease: "17.2.0",
      serverRelease: "18.0.0",
      majorReleasesBehind: "1",
      projectName: "Acme Production",
      isOwner: "true",
      updateProbeDocsUrl: DOCS_LINK,
      viewProbeLink: `${HOME}/dashboard/${projectId.toString()}/monitors/settings/probes/${probe.id.toString()}`,
    });
    // 17.2.0 is too old for a request body that is no JSON object, not for one-time codes.
    expect(sent[0]!.vars["missedFeatures"]).toEqual([
      PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.AnyRequestBody],
    ]);
    expect(sent[0]!.sms).toContain(
      "Probe office-probe runs 17.2.0, 1 major release behind OneUptime 18.0.0, which it reports to.",
    );
    expect(sent[0]!.sms).toContain(DOCS_LINK);
    expect(sent[0]!.pushUrl).toBe(sent[0]!.vars["viewProbeLink"]);
    // Nobody else: the project's owners are told only of a probe with no owners.
    expect(world.sent).toHaveLength(1);
  });

  test("two majors behind: told once, of how far, and of everything it misses", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "16.4.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.1.2");

    const sent: Array<Sent> = sentTo(alice);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("is 2 major releases behind OneUptime");
    expect(sent[0]!.vars["majorReleasesBehind"]).toBe("2");
    expect(sent[0]!.vars["missedFeatures"]).toEqual([
      PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.OneTimeCodes],
      PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.AnyRequestBody],
    ]);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
  });

  test("a probe that says no release, on a later major: told as at least so far behind, never naming a release a feature shipped in", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: null,
    });
    ownedBy(probe, [alice]);

    await runOn(0, "19.0.0");

    const sent: Sent = sentTo(alice)[0]!;

    expect(sent.subject).toContain("is at least");
    expect(sent.vars["probeRelease"]).toBe(
      `older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`,
    );
    expect(JSON.stringify(sent.vars)).not.toMatch(/17\.2\.1/);
  });

  test("a minor-only difference: nobody is told, and nothing is kept", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([person("Project owner")]),
      reportedVersion: "18.0.0",
    });
    ownedBy(probe, [alice]);

    const run: ProbeMajorReleaseRun = await runOn(0, "18.4.1");

    expect(run).toMatchObject({ read: 1, told: 0 });
    expect(world.sent).toEqual([]);
    expect(probe.majorVersionBehindNotifiedFor).toBeNull();
  });

  test("told once, then not again the next day, nor the day after", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.2.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");
    await runOn(1, "18.0.0");
    await runOn(2, "18.0.1");

    expect(sentTo(alice)).toHaveLength(1);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
  });

  test("updated, then behind again: forgotten once updated, told again when it falls behind", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.2.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");
    expect(sentTo(alice)).toHaveLength(1);

    // Updated to OneUptime's major release: what was told is forgotten.
    probe.reportedVersion = "18.0.0";
    const updated: ProbeMajorReleaseRun = await runOn(1, "18.0.0");

    expect(updated.forgotten).toBe(1);
    expect(probe.majorVersionBehindNotifiedFor).toBeNull();
    expect(sentTo(alice)).toHaveLength(1);

    // Rolled back: behind OneUptime 18 again, and told again.
    probe.reportedVersion = "17.2.0";
    await runOn(2, "18.0.0");

    expect(sentTo(alice)).toHaveLength(2);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
  });

  test("updated, then left behind by OneUptime's next major release: told again, of the new one", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.2.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");
    probe.reportedVersion = "18.0.0";
    await runOn(1, "18.0.0");
    await runOn(2, "19.0.0");

    expect(sentTo(alice)).toHaveLength(2);
    expect(sentTo(alice)[1]!.vars["serverRelease"]).toBe("19.0.0");
    expect(probe.majorVersionBehindNotifiedFor).toBe(19);
  });

  test("never updated while OneUptime moves on a major release: told again, of the new one, as two behind", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.2.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");
    await runOn(30, "19.0.0");

    expect(sentTo(alice)).toHaveLength(2);
    expect(sentTo(alice)[1]!.vars["majorReleasesBehind"]).toBe("2");
  });
});

describe("what is never told", () => {
  test("a global probe, even read by mistake", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: null,
      isGlobalProbe: true,
      reportedVersion: "15.0.0",
    });
    ownedBy(probe, [alice]);
    world.isQueryHonoured = false;

    const run: ProbeMajorReleaseRun = await runOn(0, "18.0.0");

    expect(run.told).toBe(0);
    expect(world.sent).toEqual([]);
    expect(probe.majorVersionBehindNotifiedFor).toBeNull();
  });

  test.each(["18.0.0-test", "18.0.0-rc.1", "", "unknown"])(
    "nothing while OneUptime runs %j: nobody told, nothing forgotten, no probe read",
    async (serverVersion: string) => {
      const alice: User = person("Alice");
      const behind: ProbeRow = addProbe({
        projectId: project([]),
        reportedVersion: "16.0.0",
      });
      const told: ProbeRow = addProbe({
        projectId: project([]),
        reportedVersion: "18.0.0",
        majorVersionBehindNotifiedFor: 18,
      });
      ownedBy(behind, [alice]);

      const run: ProbeMajorReleaseRun = await runOn(0, serverVersion);

      expect(run).toEqual({
        read: 0,
        told: 0,
        forgotten: 0,
        isServerRelease: false,
      });
      expect(world.sent).toEqual([]);
      expect(world.queries).toEqual([]);
      expect(told.majorVersionBehindNotifiedFor).toBe(18);
    },
  );

  test("a disconnected probe is not read", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "16.0.0",
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");

    expect(world.sent).toEqual([]);
  });

  test("a probe whose release cannot be told", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "unknown",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");

    expect(world.sent).toEqual([]);
  });
});

describe("who is told", () => {
  test("owner users and the members of owner teams, each once", async () => {
    const alice: User = person("Alice");
    const bob: User = person("Bob");
    const carol: User = person("Carol");
    const probe: ProbeRow = addProbe({
      projectId: project([person("Project owner")]),
      reportedVersion: "17.0.0",
    });
    // Bob owns it himself and through his team.
    ownedBy(probe, [alice, bob], [team([bob, carol])]);

    await runOn(0, "18.0.0");

    expect(sentTo(alice)).toHaveLength(1);
    expect(sentTo(bob)).toHaveLength(1);
    expect(sentTo(carol)).toHaveLength(1);
    expect(world.sent).toHaveLength(3);

    for (const sent of world.sent) {
      expect(sent.vars["isOwner"]).toBe("true");
    }
  });

  test("an owner team alone", async () => {
    const dave: User = person("Dave");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [], [team([dave])]);

    await runOn(0, "18.0.0");

    expect(sentTo(dave)).toHaveLength(1);
  });

  test("no owners: the project's owners are told in their place, and the email says why", async () => {
    const projectOwner: User = person("Project owner");
    const probe: ProbeRow = addProbe({
      projectId: project([projectOwner]),
      reportedVersion: "17.0.0",
    });

    await runOn(0, "18.0.0");

    const sent: Array<Sent> = sentTo(projectOwner);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.vars["isOwner"]).toBeUndefined();
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
    expect(deliveries.rows[0]!.isProjectOwner).toBe(true);
  });

  test("nobody to tell at all: not taken, so the first owner added is told the next day", async () => {
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });

    const first: ProbeMajorReleaseRun = await runOn(0, "18.0.0");

    expect(first.told).toBe(0);
    expect(probe.majorVersionBehindNotifiedFor).toBeNull();

    const erin: User = person("Erin");
    ownedBy(probe, [erin]);
    await runOn(1, "18.0.0");

    expect(sentTo(erin)).toHaveLength(1);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
  });

  test("each person's setting is seeded before they are told: a member who joined before it existed hears by email", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [alice]);

    await runOn(0, "18.0.0");

    expect(world.seeded).toEqual([`${alice.id!.toString()}|${EVENT}`]);
  });

  test("an owner whose notification fails is not told again, and the others are told", async () => {
    const alice: User = person("Alice");
    const bob: User = person("Bob");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [alice, bob]);
    world.failsFor.add(alice.id!.toString());

    await runOn(0, "18.0.0");
    world.failsFor.clear();
    await runOn(1, "18.0.0");

    expect(sentTo(alice)).toEqual([]);
    expect(sentTo(bob)).toHaveLength(1);
    expect(
      deliveries.statusesOf(probe.id, getNoticeOccurrence(day(0))),
    ).toEqual({
      [alice.id!.toString()]: OwnerNotificationDeliveryStatus.Failed,
      [bob.id!.toString()]: OwnerNotificationDeliveryStatus.Sent,
    });
  });
});

describe("many probes", () => {
  test("in one project: each probe's owners told of their own probe, and the project's owners read once", async () => {
    const projectOwner: User = person("Project owner");
    const projectId: ObjectID = project([projectOwner]);
    const owned: Array<{ probe: ProbeRow; owner: User }> = [];

    for (let index: number = 0; index < 5; index++) {
      const owner: User = person(`Owner ${index}`);
      const probe: ProbeRow = addProbe({
        projectId,
        reportedVersion: "17.1.0",
      });
      ownedBy(probe, [owner]);
      owned.push({ probe, owner });
    }

    // Three with no owners, one up to date, one a minor release behind.
    const unowned: Array<ProbeRow> = [0, 1, 2].map((): ProbeRow => {
      return addProbe({ projectId, reportedVersion: "16.9.0" });
    });
    addProbe({ projectId, reportedVersion: "18.2.0" });
    addProbe({ projectId, reportedVersion: "18.1.0" });

    const run: ProbeMajorReleaseRun = await runOn(0, "18.2.0");

    expect(run).toMatchObject({ read: 10, told: 8 });

    for (const { probe, owner } of owned) {
      expect(sentTo(owner)).toHaveLength(1);
      expect(sentAbout(probe)).toHaveLength(1);
    }

    // The project's owner hears of each unowned probe once.
    expect(sentTo(projectOwner)).toHaveLength(3);

    for (const probe of unowned) {
      expect(sentAbout(probe)).toHaveLength(1);
    }

    expect(world.projectOwnerReads.get(projectId.toString())).toBe(1);
  });

  test("across projects: each probe's notice goes to its own project's people, in that project", async () => {
    const firstOwner: User = person("First project's owner");
    const secondOwner: User = person("Second project's owner");
    const first: ObjectID = project([firstOwner]);
    const second: ObjectID = project([secondOwner]);
    const firstProbe: ProbeRow = addProbe({
      projectId: first,
      reportedVersion: "17.0.0",
    });
    const secondProbe: ProbeRow = addProbe({
      projectId: second,
      reportedVersion: "16.0.0",
    });

    await runOn(0, "18.0.0");

    expect(
      sentTo(firstOwner).map((sent: Sent): string => {
        return sent.projectId;
      }),
    ).toEqual([first.toString()]);
    expect(
      sentTo(secondOwner).map((sent: Sent): string => {
        return sent.projectId;
      }),
    ).toEqual([second.toString()]);
    expect(sentAbout(firstProbe)[0]!.userId).toBe(firstOwner.id!.toString());
    expect(sentAbout(secondProbe)[0]!.userId).toBe(secondOwner.id!.toString());
  });

  test("more probes than a page: every one is read, and each told once", async () => {
    const projectOwner: User = person("Project owner");
    const projectId: ObjectID = project([projectOwner]);
    const count: number = PROBE_MAJOR_RELEASE_PAGE_SIZE * 2 + 7;

    for (let index: number = 0; index < count; index++) {
      addProbe({ projectId, reportedVersion: "17.0.0" });
    }

    const run: ProbeMajorReleaseRun = await runOn(0, "18.0.0");

    expect(run.read).toBe(count);
    expect(run.told).toBe(count);
    expect(sentTo(projectOwner)).toHaveLength(count);
    expect(world.queries).toHaveLength(3);
    expect(
      world.probes.every((probe: ProbeRow): boolean => {
        return probe.majorVersionBehindNotifiedFor === 18;
      }),
    ).toBe(true);

    await runOn(1, "18.0.0");

    expect(sentTo(projectOwner)).toHaveLength(count);
  });
});

describe("told once, however the worker stops", () => {
  test("stopped while telling: the next run tells the owner it left, exactly once, and the one it told never again", async () => {
    const alice: User = person("Alice");
    const bob: User = person("Bob");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [alice, bob]);

    // The run stops as it sets out to tell Bob, after Alice.
    deliveries.stopAt({
      statement: "startTelling",
      userId: bob.id!.toString(),
    });
    void notifyProbesMajorReleaseBehind({
      serverVersion: "18.0.0",
      now: day(0),
    });

    // Let the stopped run get as far as it ever will.
    await settle();

    expect(deliveries.stops()).toBe(1);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
    expect(sentTo(bob)).toEqual([]);

    // The next day's run takes up what it left.
    await runOn(1, "18.0.0");
    await runOn(2, "18.0.0");

    expect(sentTo(alice)).toHaveLength(1);
    expect(sentTo(bob)).toHaveLength(1);
  });

  test("stopped after whom to tell was written, before the probe was taken: the next run takes it and tells each once", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [alice]);

    deliveries.stopAt({ statement: "writeOwnersToTell", when: "after" });
    void notifyProbesMajorReleaseBehind({
      serverVersion: "18.0.0",
      now: day(0),
    });

    await settle();

    expect(deliveries.stops()).toBe(1);
    expect(probe.majorVersionBehindNotifiedFor).toBeNull();
    expect(world.sent).toEqual([]);

    await runOn(1, "18.0.0");
    await runOn(2, "18.0.0");

    expect(sentTo(alice)).toHaveLength(1);
    expect(probe.majorVersionBehindNotifiedFor).toBe(18);
    expect(
      deliveries.rows.filter(
        (row: { kind: OwnerNotificationKind }): boolean => {
          return row.kind === OwnerNotificationKind.ProbeMajorReleaseBehind;
        },
      ),
    ).toHaveLength(1);
  });

  test("a stopped run's owners whose probe was updated since are not told", async () => {
    const alice: User = person("Alice");
    const probe: ProbeRow = addProbe({
      projectId: project([]),
      reportedVersion: "17.0.0",
    });
    ownedBy(probe, [alice]);

    deliveries.stopAt({
      statement: "startTelling",
      userId: alice.id!.toString(),
    });
    void notifyProbesMajorReleaseBehind({
      serverVersion: "18.0.0",
      now: day(0),
    });

    await settle();

    probe.reportedVersion = "18.0.0";
    await runOn(1, "18.0.0");

    expect(world.sent).toEqual([]);
    expect(
      deliveries.statusesOf(probe.id, getNoticeOccurrence(day(0))),
    ).toEqual({
      [alice.id!.toString()]: OwnerNotificationDeliveryStatus.Failed,
    });
  });
});
