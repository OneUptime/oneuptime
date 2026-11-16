import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import { PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS } from "../../../Server/Services/ProjectSmtpConfigService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import { PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY } from "../../../UI/Components/SmtpConfig/SmtpConfigFormFields";
import { getAuditLogRedactedColumns } from "../../../Types/AuditLog/AuditLogRedaction";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isOwnerOnlyColumn } from "../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { getMetadataArgsStorage } from "typeorm";

/*
 * A PROJECT'S CREDENTIALS ARE KEPT ENCRYPTED AT REST (#8989), AND THOSE
 * NOBODY NEEDS TO SEE AGAIN ARE WRITE-ONLY.
 *
 * A project's SMTP password and OAuth client secret (for a Google service
 * account, the private key of its JSON key file), its Slack, Microsoft
 * Teams and Mattermost bot tokens, its members' chat sign-in tokens, its
 * code repositories' webhook secrets and its members' webhook signing
 * secrets were stored as written, beside the email providers' keys that
 * were encrypted from the start: a backup or a database dump held them in
 * plain text. Each is now `encrypted: true` - DatabaseService encrypts it
 * on every write and decrypts it on every read - in a text column a
 * ciphertext fits, never read through a relation, and never carried by an
 * audit log entry.
 *
 * The mail credentials (and the providers' keys beside them), the chat
 * tokens and the repository's webhook secret are write-only: nobody reads
 * one through the API, a Project Owner included, nor filters by one - only
 * OneUptime reads them, as root, to send. A webhook's signing secret is
 * still read by the member it belongs to, alone: the Edit dialog shows it,
 * and clearing it there stops the signing.
 *
 * These run the models and the server's own column checks.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type ModelType = { new (): DatabaseBaseModel };

interface Credential {
  name: string;
  modelType: ModelType;
  column: string;
  // Who reads it through the API: nobody, for a write-only one.
  readers: Array<Permission>;
  // Whether the API's own create and update write it.
  isWrittenThroughTheApi: boolean;
}

const SMTP_CREDENTIALS: Array<string> = [
  "password",
  "clientSecret",
  "amazonSesSecretAccessKey",
  "sendgridApiKey",
  "mailgunApiKey",
  "postmarkServerToken",
  "resendApiKey",
];

const CREDENTIALS: Array<Credential> = [
  ...SMTP_CREDENTIALS.map((column: string): Credential => {
    return {
      name: `ProjectSMTPConfig.${column}`,
      modelType: ProjectSmtpConfig,
      column: column,
      readers: [],
      isWrittenThroughTheApi: true,
    };
  }),
  {
    name: "WorkspaceProjectAuthToken.authToken",
    modelType: WorkspaceProjectAuthToken,
    column: "authToken",
    readers: [],
    // Written by the Slack, Microsoft Teams and Mattermost connect flows only.
    isWrittenThroughTheApi: false,
  },
  {
    name: "WorkspaceUserAuthToken.authToken",
    modelType: WorkspaceUserAuthToken,
    column: "authToken",
    readers: [],
    // Written by the members' chat sign-ins only.
    isWrittenThroughTheApi: false,
  },
  {
    name: "CodeRepository.secretToken",
    modelType: CodeRepository,
    column: "secretToken",
    readers: [],
    isWrittenThroughTheApi: true,
  },
  {
    name: "UserWebhook.secret",
    modelType: UserWebhook,
    column: "secret",
    readers: [Permission.CurrentUser],
    isWrittenThroughTheApi: true,
  },
];

const WRITE_ONLY: Array<Credential> = CREDENTIALS.filter(
  (credential: Credential): boolean => {
    return credential.readers.length === 0;
  },
);

// Every role there is: none of them reads a write-only credential.
const EVERY_ROLE: Array<Permission> = Object.values(Permission).filter(
  (permission: Permission): boolean => {
    return permission !== Permission.Public;
  },
);

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: userPermissions,
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function errorOf(run: () => void): Error | null {
  try {
    run();
  } catch (err) {
    return err as Error;
  }

  return null;
}

function accessOf(credential: Credential): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    new credential.modelType().getColumnAccessControlFor(credential.column);

  expect(accessControl).not.toBeNull();

  return accessControl!;
}

// The column as TypeORM creates it: its type and its length.
function storedColumnOf(credential: Credential): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.target === credential.modelType &&
        candidate.propertyName === credential.column
      );
    })
    .pop();

  expect(column).toBeDefined();

  return column!;
}

function shapeOf(schema: unknown): Array<string> {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

describe.each(CREDENTIALS)("$name", (credential: Credential) => {
  test("is kept encrypted at rest, and the spec calls it a secret", () => {
    const model: DatabaseBaseModel = new credential.modelType();
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      credential.column,
    );

    expect(metadata.encrypted).toBe(true);
    expect(ModelSchema.isSecretColumn(metadata)).toBe(true);
    expect(model.getEncryptedColumns().columns).toContain(credential.column);
  });

  test("is stored in a text column, which a ciphertext fits", () => {
    const column: ColumnMetadataArgs = storedColumnOf(credential);

    /*
     * A ciphertext is longer than its value: a 500-character password is
     * stored as 704 characters, a 100-character secret as 172.
     */
    expect(column.options.type).toBe("text");
    expect(column.options.length).toBeUndefined();
    expect(Boolean(column.options.unique)).toBe(false);
  });

  test("is never read through a relation, where a request could ask for it decrypted", () => {
    const metadata: TableColumnMetadata =
      new credential.modelType().getTableColumnMetadata(credential.column);

    expect(Boolean(metadata.canReadOnRelationQuery)).toBe(false);
  });

  test("is read by whom it says, and by nobody else", () => {
    expect([...accessOf(credential).read].sort()).toEqual(
      [...credential.readers].sort(),
    );
  });

  test("an audit log entry never carries its value", () => {
    expect(
      getAuditLogRedactedColumns(new credential.modelType()).has(
        credential.column,
      ),
    ).toBe(true);
  });
});

describe.each(WRITE_ONLY)(
  "$name is write-only",
  (credential: Credential) => {
    test("a select of it is refused to every role, a Project Owner's included", () => {
      for (const permission of EVERY_ROLE) {
        const error: Error | null = errorOf(() => {
          SelectPermission.checkSelectPermission(
            credential.modelType,
            { [credential.column]: true } as never,
            propsWith([permission]),
          );
        });

        expect([permission, error]).toEqual([
          permission,
          expect.any(NotAuthorizedException),
        ]);
        expect(error!.message).toContain(
          `You do not have permissions to select on - ${credential.column}. No permission allows it: the column is not readable through the API.`,
        );
      }
    });

    test("a filter on it is refused too, so it cannot be guessed one value at a time", () => {
      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
      ]) {
        const error: Error | null = errorOf(() => {
          QueryPermission.checkQueryPermission(
            credential.modelType,
            { [credential.column]: "a-guess" } as never,
            propsWith([permission]),
          );
        });

        expect([permission, error]).toEqual([
          permission,
          expect.any(NotAuthorizedException),
        ]);
      }
    });

    test("the API's spec never returns it", () => {
      for (const schema of [
        ModelSchema.getReadModelSchema({ modelType: credential.modelType }),
        ModelSchema.getModelSchema({ modelType: credential.modelType }),
      ]) {
        expect(shapeOf(schema)).not.toContain(credential.column);
      }
    });

    test("the API takes it on a create and an update where its writers write it", () => {
      const access: ColumnAccessControl = accessOf(credential);

      if (!credential.isWrittenThroughTheApi) {
        // The connect flows and sign-ins write it, as OneUptime.
        expect(access.update).toEqual([]);
        return;
      }

      expect(access.create.length).toBeGreaterThan(0);
      expect(access.update.length).toBeGreaterThan(0);
      expect(
        shapeOf(
          ModelSchema.getCreateModelSchema({ modelType: credential.modelType }),
        ),
      ).toContain(credential.column);
      expect(
        shapeOf(
          ModelSchema.getUpdateModelSchema({ modelType: credential.modelType }),
        ),
      ).toContain(credential.column);
    });
  },
);

describe("a project's SMTP config", () => {
  test("its writers still write every credential: the config's own create and edit permissions", () => {
    for (const column of SMTP_CREDENTIALS) {
      const access: ColumnAccessControl | null =
        new ProjectSmtpConfig().getColumnAccessControlFor(column);

      expect({ column, create: [...access!.create].sort() }).toEqual({
        column,
        create: [
          Permission.CreateProjectSMTPConfig,
          Permission.ProjectAdmin,
          Permission.ProjectOwner,
        ].sort(),
      });
      expect({ column, update: [...access!.update].sort() }).toEqual({
        column,
        update: [
          Permission.EditProjectSMTPConfig,
          Permission.ProjectAdmin,
          Permission.ProjectOwner,
        ].sort(),
      });
    }
  });

  test("everything it encrypts is a credential the create's answer leaves out and the Edit dialog keeps", () => {
    const encrypted: Array<string> = [
      ...new ProjectSmtpConfig().getEncryptedColumns().columns,
    ].sort();

    expect(encrypted).toEqual([...SMTP_CREDENTIALS].sort());
    expect([...PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS].sort()).toEqual(
      encrypted,
    );
    expect(Object.keys(PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY).sort()).toEqual(
      encrypted,
    );
  });

  test("what tells configs apart stays readable to every reader of the config", () => {
    for (const column of [
      "name",
      "transportType",
      "hostname",
      "username",
      "authType",
      "clientId",
      "amazonSesAccessKeyId",
      "mailgunDomain",
    ]) {
      expect({
        column,
        isRead:
          new ProjectSmtpConfig().getColumnAccessControlFor(column)!.read
            .length > 0,
      }).toEqual({ column, isRead: true });
    }
  });
});

describe("a webhook notification method's signing secret", () => {
  test("is read by the member it belongs to alone", () => {
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("secret")!.read).toEqual([
      Permission.CurrentUser,
    ]);
    expect(isOwnerOnlyColumn(model, "secret")).toBe(true);
  });
});
