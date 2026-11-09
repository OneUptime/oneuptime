import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import DatabaseService from "Common/Server/Services/DatabaseService";
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicyScheduleCalendarFeed from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOnCallCalendarFeed from "Common/Models/DatabaseModels/ProjectOnCallCalendarFeed";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ENTRIES OF A CALENDAR LINK RESET, A TEAM JOINED THROUGH SSO AND A LABEL
 * RULE'S LABELS, AS THE RECORDER WRITES THEM (issues #6284-#6286).
 *
 * Each was written round DatabaseService's audit hook, or of columns its
 * defaults leave out, and recorded nothing. Each now records its own entry;
 * pinned here is what that entry says - by whom, of what, on which page,
 * and never with a token. What reaches the recorder from each write is
 * pinned at the write sites (OnCallCalendarFeedServices, SsoTeamMembership,
 * RuleAddedLabels).
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const PROD: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
};

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function makeProject(storeSystemEvents: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = true;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = storeSystemEvents;
  return item;
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(false);
  inserted = [];

  recorder = new AuditLogRecorder({
    store: {
      create: jest.fn(((createBy: { data: AuditLog }) => {
        inserted.push(createBy.data);
        return Promise.resolve(createBy.data);
      }) as never),
    } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    if (findOneById.id.toString() !== USER_ID.toString()) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = USER_ID.toString();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    return Promise.resolve(user);
  }) as never);

  // The names of related rows the recorder looks up: the project's labels.
  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation((async (): Promise<Array<Label>> => {
      const europe: Label = new Label(new ObjectID(EU));
      europe.name = "europe";
      return [europe];
    }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a calendar feed's link reset", () => {
  function scheduleFeedBefore(): OnCallDutyPolicyScheduleCalendarFeed {
    const feed: OnCallDutyPolicyScheduleCalendarFeed =
      new OnCallDutyPolicyScheduleCalendarFeed(RECORD_ID);
    feed.projectId = PROJECT_ID;
    feed.onCallDutyPolicyScheduleId = SCHEDULE_ID;
    feed.tokenHint = "aB3d";
    feed.rotatedAt = new Date("2026-10-01T00:00:00.000Z");
    return feed;
  }

  const ROTATED: JSONObject = {
    tokenHint: "zZ9q",
    rotatedAt: new Date("2026-11-08T10:00:00.000Z"),
  } as unknown as JSONObject;

  test("is an Update by the person, on the schedule's page, with the token as changed and never its value", async () => {
    await recorder.recordUpdate({
      model: new OnCallDutyPolicyScheduleCalendarFeed(),
      before: scheduleFeedBefore(),
      updatedFields: ROTATED,
      itemId: RECORD_ID,
      props: PERSON,
      includeColumns: ["tokenHint", "rotatedAt"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.rootResourceId?.toString()).toBe(SCHEDULE_ID.toString());
    expect(changesOf(entry)).toEqual([
      {
        field: "tokenHint",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
      {
        field: "rotatedAt",
        oldValue: "2026-10-01T00:00:00.000Z",
        newValue: "2026-11-08T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(entry)).not.toContain("aB3d");
    expect(JSON.stringify(entry)).not.toContain("zZ9q");
  });

  test("the project's link reset the same way", async () => {
    const before: ProjectOnCallCalendarFeed = new ProjectOnCallCalendarFeed(
      RECORD_ID,
    );
    before.projectId = PROJECT_ID;
    before.tokenHint = "aB3d";

    await recorder.recordUpdate({
      model: new ProjectOnCallCalendarFeed(),
      before,
      updatedFields: ROTATED,
      itemId: RECORD_ID,
      props: PERSON,
      includeColumns: ["tokenHint", "rotatedAt"],
    });

    expect(
      changesOf(onlyEntry()).map((change: JSONObject): unknown => {
        return change["field"];
      }),
    ).toEqual(["tokenHint", "rotatedAt"]);
  });

  test("written without naming its columns - as it was - the reset recorded nothing", async () => {
    await recorder.recordUpdate({
      model: new OnCallDutyPolicyScheduleCalendarFeed(),
      before: scheduleFeedBefore(),
      updatedFields: ROTATED,
      itemId: RECORD_ID,
      props: PERSON,
    });

    expect(inserted).toHaveLength(0);
  });

  test("a member leaving rotates it as OneUptime's own: kept only with system events stored", async () => {
    const memberLeft: () => Promise<void> = async (): Promise<void> => {
      await recorder.recordUpdate({
        model: new OnCallDutyPolicyScheduleCalendarFeed(),
        before: scheduleFeedBefore(),
        updatedFields: ROTATED,
        itemId: RECORD_ID,
        props: { isRoot: true },
        includeColumns: ["tokenHint", "rotatedAt"],
      });
    };

    await memberLeft();
    expect(inserted).toHaveLength(0);

    project = makeProject(true);
    recorder.invalidateProjectSettings(PROJECT_ID);
    await memberLeft();

    expect(onlyEntry().userType).toBe("System");
  });
});

describe("a team joined through SSO sign-in", () => {
  function joined(): TeamMember {
    const member: TeamMember = new TeamMember(RECORD_ID);
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;
    member.userId = USER_ID;
    member.hasAcceptedInvitation = true;
    member.invitationAcceptedAt = new Date("2026-11-08T10:00:00.000Z");
    return member;
  }

  test("is a Create on the team's page, named after the person, by the person who signed in", async () => {
    await recorder.recordCreate({
      model: new TeamMember(),
      createdItem: joined(),
      props: OnBehalfOfProps.get({ userId: USER_ID, userType: UserType.User }),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Team Member");
    expect(entry.resourceName).toBe("Ada Lovelace");
    expect(entry.rootResourceType).toBe("Team");
    expect(entry.rootResourceId?.toString()).toBe(TEAM_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);
  });

  test("is kept though the project does not store system events: it is theirs", async () => {
    project = makeProject(false);

    await recorder.recordCreate({
      model: new TeamMember(),
      createdItem: joined(),
      props: OnBehalfOfProps.get({ userId: USER_ID, userType: UserType.User }),
    });

    expect(inserted).toHaveLength(1);
  });
});

describe("the labels a label rule added", () => {
  function monitorBefore(): Monitor {
    const monitor: Monitor = new Monitor(RECORD_ID);
    monitor.projectId = PROJECT_ID;
    monitor.name = "API";
    const production: Label = new Label(new ObjectID(PROD));
    production.name = "production";
    monitor.labels = [production];
    return monitor;
  }

  function after(): JSONObject {
    const production: Label = new Label(new ObjectID(PROD));
    production.name = "production";

    return {
      labels: [production, new Label(new ObjectID(EU))],
    } as unknown as JSONObject;
  }

  test("are an Update by whoever ran the rule, the labels named before and after", async () => {
    await recorder.recordUpdate({
      model: new Monitor(),
      before: monitorBefore(),
      updatedFields: after(),
      itemId: RECORD_ID,
      props: PERSON,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.resourceName).toBe("API");
    expect(changesOf(entry)).toEqual([
      {
        field: "labels",
        oldValue: [{ _id: PROD, name: "production" }],
        newValue: [
          { _id: PROD, name: "production" },
          { _id: EU, name: "europe" },
        ],
      },
    ]);
  });

  test("a rule applied as the record is created is OneUptime's own: kept only with system events stored", async () => {
    await recorder.recordUpdate({
      model: new Monitor(),
      before: monitorBefore(),
      updatedFields: after(),
      itemId: RECORD_ID,
      props: { isRoot: true },
    });

    expect(inserted).toHaveLength(0);
  });
});
