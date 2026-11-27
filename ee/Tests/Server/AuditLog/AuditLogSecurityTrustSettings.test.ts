import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import EnableAuditLogOn from "Common/Types/BaseDatabase/EnableAuditLogOn";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * #11049: EVERY CHANGE TO SECURITY EVENTS' TRUSTED PROXIES IS AUDITED.
 *
 * What Security Events trusts as a proxy decides which address an attack is
 * blamed on, and so which address a case offers to block. A Security Admin
 * now edits the list, as a Project Owner or Admin does, beside the two
 * switches they already flipped: whether the project's own load balancers
 * are trusted, and whether its access logs are read for X-Forwarded-For.
 * Each is a column of the project, and the audit log records each change
 * of it - the list before and after, the switch's old and new value, and
 * who changed it - whoever that is. Pinned against the entry that reaches
 * the insert; billing and the edition as in AuditLogRecorder.test.ts.
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
  "11049000-0000-4000-8000-000000000001",
);
const SECURITY_ADMIN_ID: ObjectID = new ObjectID(
  "11049000-0000-4000-8000-000000000002",
);

// The columns of Trusted Proxies a person sets.
const TRUSTED_PROXY_COLUMNS: ReadonlyArray<string> = [
  "securityTrustedProxies",
  "securityTrustOwnLoadBalancers",
  "securityReadAccessLogForwardedFor",
];

const SECURITY_ADMIN: DatabaseCommonInteractionProps = {
  userId: SECURITY_ADMIN_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function auditedProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  project.auditLogsRetentionInDays = 30;
  project.storeSystemEventsInAuditLogs = false;
  return project;
}

function before(columns: Partial<Project>): Project {
  const project: Project = auditedProject();
  project.name = "Acme";
  Object.assign(project, columns);
  return project;
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return ((entry.changes || []) as Array<JSONObject>).find(
    (change: JSONObject): boolean => {
      return change["field"] === field;
    },
  );
}

async function recordChange(
  previous: Partial<Project>,
  updatedFields: JSONObject,
): Promise<AuditLog> {
  await recorder.recordUpdate({
    model: new Project(),
    before: before(previous),
    updatedFields,
    itemId: PROJECT_ID,
    props: SECURITY_ADMIN,
  });

  return onlyEntry();
}

beforeEach(() => {
  setTestBillingEnabled(false);
  inserted = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(auditedProject());
  });

  const securityAdmin: User = new User();
  securityAdmin._id = SECURITY_ADMIN_ID.toString();
  securityAdmin.name = new Name("Grace Hopper");
  securityAdmin.email = new Email("grace@example.com");

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    return Promise.resolve(
      findOneById.id.toString() === SECURITY_ADMIN_ID.toString()
        ? securityAdmin
        : null,
    );
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the project's audit log keeps every column of Trusted Proxies", () => {
  test("each is audited on update, with its value in full: none is left out or redacted", () => {
    const auditLogOn: EnableAuditLogOn | undefined = new Project()
      .enableAuditLogOn;

    expect(auditLogOn?.update).toBe(true);

    for (const column of TRUSTED_PROXY_COLUMNS) {
      expect({
        column,
        ignored: (auditLogOn?.ignoreColumns || []).includes(column),
        redacted: (auditLogOn?.redactColumns || []).includes(column),
      }).toEqual({ column, ignored: false, redacted: false });
    }
  });
});

describe("a Security Admin's change of Trusted Proxies is recorded, with who made it", () => {
  test("the list, before and after", async () => {
    const entry: AuditLog = await recordChange(
      { securityTrustedProxies: "203.0.113.0/24" },
      { securityTrustedProxies: "203.0.113.0/24\n198.51.100.7" },
    );

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Project");
    expect(entry.userId?.toString()).toBe(SECURITY_ADMIN_ID.toString());
    expect(entry.userName).toBe("Grace Hopper");
    expect(changeFor(entry, "securityTrustedProxies")).toEqual({
      field: "securityTrustedProxies",
      oldValue: "203.0.113.0/24",
      newValue: "203.0.113.0/24\n198.51.100.7",
    });
  });

  test("a list emptied: every proxy it trusted is no longer trusted", async () => {
    const entry: AuditLog = await recordChange(
      { securityTrustedProxies: "203.0.113.0/24" },
      { securityTrustedProxies: null },
    );

    expect(changeFor(entry, "securityTrustedProxies")?.["oldValue"]).toBe(
      "203.0.113.0/24",
    );
  });

  test.each([
    ["securityTrustOwnLoadBalancers", true, false],
    ["securityReadAccessLogForwardedFor", false, true],
  ])(
    "%s, flipped",
    async (column: string, oldValue: boolean, newValue: boolean) => {
      const entry: AuditLog = await recordChange(
        { [column]: oldValue } as Partial<Project>,
        { [column]: newValue },
      );

      expect(entry.userId?.toString()).toBe(SECURITY_ADMIN_ID.toString());
      expect(changeFor(entry, column)).toEqual({
        field: column,
        oldValue,
        newValue,
      });
    },
  );

  test("a save that changes nothing adds no entry", async () => {
    await recorder.recordUpdate({
      model: new Project(),
      before: before({ securityTrustedProxies: "203.0.113.0/24" }),
      updatedFields: { securityTrustedProxies: "203.0.113.0/24" },
      itemId: PROJECT_ID,
      props: SECURITY_ADMIN,
    });

    expect(inserted).toHaveLength(0);
  });
});
