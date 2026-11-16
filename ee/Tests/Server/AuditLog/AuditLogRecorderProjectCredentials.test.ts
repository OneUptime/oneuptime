import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import User from "Common/Models/DatabaseModels/User";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NO AUDIT LOG ENTRY CARRIES A PROJECT'S CREDENTIALS (#8989).
 *
 * A project's SMTP password, OAuth client secret and email providers'
 * keys, its chat bot tokens, a code repository's webhook secret and a
 * webhook notification method's signing secret are kept encrypted at
 * rest now. An entry is read by roles that may not read them, and the
 * Enterprise Edition exports it out of OneUptime: each is recorded as
 * changed, never with its value - neither as written nor as stored. Run
 * against the entry that reaches the insert, as AuditLogRecorderValues
 * does; nothing here touches ClickHouse or Postgres.
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

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

// As written, and as the database holds it.
const WRITTEN: string = "a credential as written";
const STORED: string = "U2FsdGVkX1+a+credential+as+the+database+holds+it";
const REWRITTEN: string = "a new credential as written";

interface Credential {
  name: string;
  modelType: { new (): BaseModel };
  column: string;
  // The rest of the record, as a create sets it.
  record: () => BaseModel;
  /*
   * Whether an update that changes it makes an entry: a write-only one
   * when its service names it (WriteOnlyCredentialChanges), one its owner
   * reads always; one only OneUptime writes - a chat token - never.
   */
  isRecordedAsChanged: boolean;
  // What its service's update hook names in auditLogIncludeColumns.
  includeColumns?: Array<string> | undefined;
}

const CREDENTIALS: Array<Credential> = [
  ...[
    "password",
    "clientSecret",
    "amazonSesSecretAccessKey",
    "sendgridApiKey",
    "mailgunApiKey",
    "postmarkServerToken",
    "resendApiKey",
  ].map((column: string): Credential => {
    return {
      name: `ProjectSMTPConfig.${column}`,
      modelType: ProjectSmtpConfig,
      column: column,
      isRecordedAsChanged: true,
      includeColumns: [column],
      record: (): BaseModel => {
        const config: ProjectSmtpConfig = new ProjectSmtpConfig();
        config.name = "Company mail server";
        config.fromEmail = new Email("alerts@example.com");
        config.fromName = "Alerts";
        return config;
      },
    };
  }),
  {
    name: "WorkspaceProjectAuthToken.authToken",
    modelType: WorkspaceProjectAuthToken,
    column: "authToken",
    isRecordedAsChanged: false,
    record: (): BaseModel => {
      const connection: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      connection.workspaceType = WorkspaceType.Slack;
      connection.workspaceProjectId = "T0000000001";
      return connection;
    },
  },
  {
    name: "CodeRepository.secretToken",
    modelType: CodeRepository,
    column: "secretToken",
    isRecordedAsChanged: true,
    includeColumns: ["secretToken"],
    record: (): BaseModel => {
      const repository: CodeRepository = new CodeRepository();
      repository.name = "example/service";
      return repository;
    },
  },
  {
    name: "UserWebhook.secret",
    modelType: UserWebhook,
    column: "secret",
    isRecordedAsChanged: true,
    record: (): BaseModel => {
      const webhook: UserWebhook = new UserWebhook();
      webhook.name = "My endpoint";
      webhook.webhookUrl = "https://hooks.example.com/oneuptime";
      webhook.userId = USER_ID;
      return webhook;
    },
  },
];

let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function withValue(credential: Credential, value: string): BaseModel {
  const record: BaseModel = credential.record();

  record._id = RECORD_ID.toString();
  (record as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
  (record as unknown as Record<string, unknown>)[credential.column] = value;

  return record;
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

  for (const value of [WRITTEN, STORED, REWRITTEN]) {
    expect(text).not.toContain(value);
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

describe.each(CREDENTIALS)("$name", (credential: Credential) => {
  test("a create's entry never carries its value, as written or as stored", async () => {
    for (const value of [WRITTEN, STORED]) {
      await recorder.recordCreate({
        model: new credential.modelType(),
        createdItem: withValue(credential, value),
        props: USER_PROPS,
      });
    }

    expectNoValueIn(inserted);

    for (const entry of inserted) {
      const change: JSONObject | undefined = changeFor(
        entry,
        credential.column,
      );

      // Left out, or recorded as set and nothing more.
      if (change) {
        expect(JSON.stringify(change)).toContain(AUDIT_LOG_REDACTED_VALUE);
      }
    }
  });

  test("an update's entry says it changed, never from what or to what", async () => {
    // As its service's update hands it over.
    await recorder.recordUpdate({
      model: new credential.modelType(),
      before: withValue(credential, STORED),
      updatedFields: { [credential.column]: REWRITTEN },
      itemId: RECORD_ID,
      props: USER_PROPS,
      includeColumns: credential.includeColumns,
    });

    expectNoValueIn(inserted);

    if (!credential.isRecordedAsChanged) {
      // Only OneUptime writes it: its refresh is no person's change.
      expect(inserted).toHaveLength(0);
      return;
    }

    expect(inserted).toHaveLength(1);
    expect(changeFor(inserted[0]!, credential.column)).toEqual({
      field: credential.column,
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
    });
  });

  test("an update that names no column carries no value either", async () => {
    await recorder.recordUpdate({
      model: new credential.modelType(),
      before: withValue(credential, STORED),
      updatedFields: { [credential.column]: REWRITTEN },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expectNoValueIn(inserted);
  });
});
