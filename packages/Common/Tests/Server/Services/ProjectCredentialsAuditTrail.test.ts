import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService, {
  PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
} from "../../../Server/Services/ProjectSmtpConfigService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import WriteOnlyCredentialChanges from "../../../Server/Utils/AuditLog/WriteOnlyCredentialChanges";
import Encryption from "../../../Server/Utils/Encryption";
import Email from "../../../Types/Email";
import MailTransportType from "../../../Types/Email/MailTransportType";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WRITE-ONLY CREDENTIAL CHANGED STILL LEAVES AN AUDIT LOG ENTRY (#8989).
 *
 * A project's SMTP credentials and a code repository's webhook secret are
 * write-only now: nobody reads one back, so the audit log leaves its value
 * out of every entry. An update that changed only one - a password rotated
 * - would then leave no entry at all. Each service names the credentials
 * an update writes in its auditLogIncludeColumns, so the entry records each
 * as changed, by whom and when, never with its value (the Enterprise
 * recorder's side: ee AuditLogRecorderProjectCredentials). Through the real
 * update pipeline, on a table in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CONFIG_ID: string = "20000000-0000-4000-8000-000000000002";
const REPOSITORY_ID: string = "30000000-0000-4000-8000-000000000003";

type RecordUpdate = typeof AuditLogService.recordUpdate;

let recordUpdate: jest.SpiedFunction<RecordUpdate>;

// What the audit log was handed by each update: the columns it names.
function namedColumns(): Array<Array<string> | undefined> {
  return recordUpdate.mock.calls.map(
    (call: Parameters<RecordUpdate>): Array<string> | undefined => {
      return call[0].includeColumns;
    },
  );
}

beforeEach(() => {
  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSmtpConfigService, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CodeRepositoryService, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's SMTP config", () => {
  let table: InMemoryTable;

  beforeEach(async () => {
    table = useInMemoryTable(ProjectSmtpConfigService, [
      {
        _id: CONFIG_ID,
        projectId: PROJECT_ID,
        name: "Company mail server",
        slug: "company-mail-server",
        transportType: MailTransportType.SMTP,
        fromEmail: new Email("alerts@example.com"),
        fromName: "Alerts",
        username: "alerts@example.com",
        password: await Encryption.encrypt("the old password"),
      },
    ]);
  });

  test("a password rotated alone is recorded as changed, and stored encrypted", async () => {
    await ProjectSmtpConfigService.updateOneById({
      id: new ObjectID(CONFIG_ID),
      data: { password: "the new password" },
      props: { isRoot: true },
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(namedColumns()).toEqual([["password"]]);

    const stored: string = String(table.get(CONFIG_ID)?.["password"]);

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await Encryption.decrypt(stored)).toBe("the new password");
  });

  test("each credential an update writes is named, and only those", async () => {
    await ProjectSmtpConfigService.updateOneById({
      id: new ObjectID(CONFIG_ID),
      data: {
        name: "Company mail server (EU)",
        clientSecret: "a client secret",
        sendgridApiKey: "SG.a-key",
      },
      props: { isRoot: true },
    });

    expect(namedColumns()).toEqual([["clientSecret", "sendgridApiKey"]]);
  });

  test("an update that writes no credential names none", async () => {
    await ProjectSmtpConfigService.updateOneById({
      id: new ObjectID(CONFIG_ID),
      data: { name: "Company mail server (EU)" },
      props: { isRoot: true },
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(namedColumns()).toEqual([undefined]);
  });

  test("a password written back as it was makes no entry", async () => {
    await ProjectSmtpConfigService.updateOneById({
      id: new ObjectID(CONFIG_ID),
      data: { password: "the old password" },
      props: { isRoot: true },
    });

    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("every credential column of the config is one the service names", () => {
    expect(
      [...new ProjectSmtpConfig().getEncryptedColumns().columns].sort(),
    ).toEqual([...PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS].sort());
  });
});

describe("a code repository", () => {
  beforeEach(() => {
    useInMemoryTable(CodeRepositoryService, [
      {
        _id: REPOSITORY_ID,
        projectId: PROJECT_ID,
        name: "example/service",
      },
    ]);
  });

  test("its webhook secret replaced is recorded as changed", async () => {
    await CodeRepositoryService.updateOneById({
      id: new ObjectID(REPOSITORY_ID),
      data: { secretToken: "a new webhook secret" },
      props: { isRoot: true },
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(namedColumns()).toEqual([["secretToken"]]);
    expect(new CodeRepository().getEncryptedColumns().columns).toContain(
      "secretToken",
    );
  });
});

describe("WriteOnlyCredentialChanges", () => {
  function updateWith(
    data: Record<string, unknown>,
    named?: Array<string>,
  ): UpdateBy<ProjectSmtpConfig> {
    return {
      query: {},
      data: data as never,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
      ...(named ? { auditLogIncludeColumns: named } : {}),
    };
  }

  test("names a credential set, or cleared with null; never one left out", () => {
    const updateBy: UpdateBy<ProjectSmtpConfig> = updateWith({
      password: "set",
      clientSecret: null,
      resendApiKey: undefined,
    });

    WriteOnlyCredentialChanges.recordInAuditLog(
      updateBy,
      PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    );

    expect(updateBy.auditLogIncludeColumns).toEqual([
      "password",
      "clientSecret",
    ]);
  });

  test("keeps what the update named already, once each", () => {
    const updateBy: UpdateBy<ProjectSmtpConfig> = updateWith(
      { password: "set" },
      ["name", "password"],
    );

    WriteOnlyCredentialChanges.recordInAuditLog(
      updateBy,
      PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    );

    expect(updateBy.auditLogIncludeColumns).toEqual(["name", "password"]);
  });

  test("names nothing, and adds no list, for an update of other columns", () => {
    const updateBy: UpdateBy<ProjectSmtpConfig> = updateWith({ name: "x" });

    WriteOnlyCredentialChanges.recordInAuditLog(
      updateBy,
      PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    );

    expect(updateBy.auditLogIncludeColumns).toBeUndefined();
  });

  test("a model's own unset columns are not credentials written", () => {
    const updateBy: UpdateBy<ProjectSmtpConfig> = updateWith(
      Object.assign(new ProjectSmtpConfig(), { name: "x" }) as never,
    );

    WriteOnlyCredentialChanges.recordInAuditLog(
      updateBy,
      PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    );

    expect(updateBy.auditLogIncludeColumns).toBeUndefined();
  });
});
