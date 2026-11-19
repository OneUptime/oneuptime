import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A MONITOR SECRET'S TYPE CHANGED IS IN THE AUDIT LOG, AND ITS VALUE NEVER
 * IS (issue #9760).
 *
 * Update Secret Value changes a secret's type only together with a new
 * value. Its entry says the type changed, from what to what - Text and
 * One-time code are no secrets - and that the value changed, by whom and
 * when, never with the value it had or the one it has: not as written, not
 * as stored, not the setup key, not the password. MonitorSecretService
 * names the value in the update's includeColumns
 * (WriteOnlyCredentialChanges), as these entries are handed it. Run against
 * the entry that reaches the insert; nothing here touches ClickHouse or
 * Postgres.
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
const SECRET_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const STORED_SEED: string = `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;
const PASSWORD: string = "the old password";
const STORED_PASSWORD: string =
  "U2FsdGVkX1+the+old+password+as+the+database+holds+it";
const NEW_PASSWORD: string = "a new password";

let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function secret(
  secretType: MonitorSecretType,
  secretValue: string,
): MonitorSecret {
  const row: MonitorSecret = new MonitorSecret();
  row._id = SECRET_ID.toString();
  row.projectId = PROJECT_ID;
  row.name = "LoginCode";
  row.secretType = secretType;
  row.secretValue = secretValue;
  return row;
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return ((entry.changes || []) as Array<JSONObject>).find(
    (change: JSONObject): boolean => {
      return change["field"] === field;
    },
  );
}

function expectNoValueIn(entries: Array<AuditLog>): void {
  const text: string = JSON.stringify(entries);

  for (const value of [
    SEED,
    STORED_SEED,
    PASSWORD,
    STORED_PASSWORD,
    NEW_PASSWORD,
  ]) {
    expect({ value, inEntry: text.includes(value) }).toEqual({
      value,
      inEntry: false,
    });
  }
}

beforeEach(() => {
  setTestBillingEnabled(false);
  inserted = [];

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  project.auditLogsRetentionInDays = 30;
  project.storeSystemEventsInAuditLogs = false;

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  const user: User = new User();
  user._id = USER_ID.toString();
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");

  findUserMock.mockReset();
  findUserMock.mockImplementation(() => {
    return Promise.resolve(user);
  });

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a monitor secret's type changed with a new value", () => {
  test("Text to One-time code: the type from and to, the value changed and never shown", async () => {
    // As MonitorSecretService's update hands it over.
    await recorder.recordUpdate({
      model: new MonitorSecret(),
      before: secret(MonitorSecretType.Text, STORED_PASSWORD),
      updatedFields: {
        secretType: MonitorSecretType.TOTP,
        secretValue: STORED_SEED,
      },
      itemId: SECRET_ID,
      props: USER_PROPS,
      includeColumns: ["secretValue"],
    });

    expect(inserted).toHaveLength(1);
    expect(changeFor(inserted[0]!, "secretType")).toEqual(
      expect.objectContaining({
        field: "secretType",
        oldValue: MonitorSecretType.Text,
        newValue: MonitorSecretType.TOTP,
      }),
    );
    expect(changeFor(inserted[0]!, "secretValue")).toEqual({
      field: "secretValue",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
    });
    expectNoValueIn(inserted);
  });

  test("One-time code to Text: the same, the setup key never in the entry", async () => {
    await recorder.recordUpdate({
      model: new MonitorSecret(),
      before: secret(MonitorSecretType.TOTP, STORED_SEED),
      updatedFields: {
        secretType: MonitorSecretType.Text,
        secretValue: NEW_PASSWORD,
      },
      itemId: SECRET_ID,
      props: USER_PROPS,
      includeColumns: ["secretValue"],
    });

    expect(inserted).toHaveLength(1);
    expect(changeFor(inserted[0]!, "secretType")).toEqual(
      expect.objectContaining({
        oldValue: MonitorSecretType.TOTP,
        newValue: MonitorSecretType.Text,
      }),
    );
    expect(changeFor(inserted[0]!, "secretValue")).toEqual({
      field: "secretValue",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
    });
    expectNoValueIn(inserted);
  });
});

describe("a monitor secret's value replaced with its type kept", () => {
  test("is recorded as changed, never with a value", async () => {
    await recorder.recordUpdate({
      model: new MonitorSecret(),
      before: secret(MonitorSecretType.Text, STORED_PASSWORD),
      updatedFields: { secretValue: NEW_PASSWORD },
      itemId: SECRET_ID,
      props: USER_PROPS,
      includeColumns: ["secretValue"],
    });

    expect(inserted).toHaveLength(1);
    expect(changeFor(inserted[0]!, "secretValue")).toEqual({
      field: "secretValue",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
    });
    expect(changeFor(inserted[0]!, "secretType")).toBeUndefined();
    expectNoValueIn(inserted);
  });

  test("an update that does not name the value carries none either", async () => {
    await recorder.recordUpdate({
      model: new MonitorSecret(),
      before: secret(MonitorSecretType.TOTP, STORED_SEED),
      updatedFields: { secretValue: NEW_PASSWORD },
      itemId: SECRET_ID,
      props: USER_PROPS,
    });

    expectNoValueIn(inserted);
  });
});
