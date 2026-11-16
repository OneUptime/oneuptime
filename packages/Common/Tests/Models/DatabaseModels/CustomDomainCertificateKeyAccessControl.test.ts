import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import { getAuditLogRedactedColumns } from "../../../Types/AuditLog/AuditLogRedaction";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";

/*
 * A CUSTOM DOMAIN'S UPLOADED PRIVATE KEY IS WRITE-ONLY, ON ALL THREE KINDS.
 *
 * A status page's, a dashboard's and a form's custom domain can serve a
 * certificate its owner uploads, with its private key. Everyone who could
 * read the domain - a Viewer, Read Form, Read Status Page Domain - could
 * read the key back, and with it impersonate the customer's domain. Now
 * nobody reads it through the API: it is written with the certificate,
 * kept encrypted at rest, and read only by OneUptime itself to serve the
 * domain. These run the server's own column checks - the ones a request
 * goes through - for every role that reads a domain, and for the roles
 * that write one, who still upload and replace the key.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const KEY: string = "customCertificateKey";

type DomainModelType = { new (): DatabaseBaseModel };

const KINDS: Array<[string, DomainModelType]> = [
  ["StatusPageDomain", StatusPageDomain],
  ["DashboardDomain", DashboardDomain],
  ["FormDomain", FormDomain],
];

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

function accessOf(
  modelType: DomainModelType,
  column: string,
): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    new modelType().getColumnAccessControlFor(column);

  expect(accessControl).not.toBeNull();

  return accessControl!;
}

// Every role that reads the domain: the certificate's own readers.
function readersOf(modelType: DomainModelType): Array<Permission> {
  return [...accessOf(modelType, "customCertificate").read];
}

describe.each(KINDS)(
  "%s.customCertificateKey",
  (_name: string, modelType: DomainModelType) => {
    test("nobody reads it: its read list is empty", () => {
      expect(accessOf(modelType, KEY).read).toEqual([]);
    });

    test("it is kept encrypted at rest, and the spec calls it a secret", () => {
      const metadata: TableColumnMetadata =
        new modelType().getTableColumnMetadata(KEY);

      expect(metadata.encrypted).toBe(true);
      expect(metadata.secret).toBe(true);
      expect(ModelSchema.isSecretColumn(metadata)).toBe(true);
      expect(new modelType().getEncryptedColumns().columns).toContain(KEY);
    });

    test("those who may change the certificate still upload and replace the key", () => {
      expect([...accessOf(modelType, KEY).create].sort()).toEqual(
        [...accessOf(modelType, "customCertificate").create].sort(),
      );
      expect([...accessOf(modelType, KEY).update].sort()).toEqual(
        [...accessOf(modelType, "customCertificate").update].sort(),
      );
    });

    test("every role that reads the domain is refused the key", () => {
      const readers: Array<Permission> = readersOf(modelType);

      expect(readers).toContain(Permission.Viewer);
      expect(readers).toContain(Permission.ProjectOwner);

      for (const permission of readers) {
        const error: Error | null = errorOf(() => {
          SelectPermission.checkSelectPermission(
            modelType,
            { [KEY]: true } as never,
            propsWith([permission]),
          );
        });

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error?.message).toContain(KEY);
      }
    });

    test("every role that reads the domain still reads its certificate and name", () => {
      for (const permission of readersOf(modelType)) {
        expect(
          errorOf(() => {
            SelectPermission.checkSelectPermission(
              modelType,
              {
                fullDomain: true,
                isCustomCertificate: true,
                customCertificate: true,
              } as never,
              propsWith([permission]),
            );
          }),
        ).toBeNull();
      }
    });

    test("a filter on the key is refused too, so it cannot be guessed one value at a time", () => {
      for (const permission of readersOf(modelType)) {
        const error: Error | null = errorOf(() => {
          QueryPermission.checkQueryPermission(
            modelType,
            { [KEY]: "-----BEGIN PRIVATE KEY-----" } as never,
            propsWith([permission]),
          );
        });

        expect(error).toBeInstanceOf(NotAuthorizedException);
      }
    });

    test("its writers may write it on a create and an update", () => {
      for (const [type, permissions] of [
        [DatabaseRequestType.Create, accessOf(modelType, KEY).create],
        [DatabaseRequestType.Update, accessOf(modelType, KEY).update],
      ] as Array<[DatabaseRequestType, Array<Permission>]>) {
        for (const permission of permissions) {
          const data: DatabaseBaseModel = new modelType();
          (data as unknown as Record<string, unknown>)[KEY] = "key";

          expect(
            errorOf(() => {
              ColumnPermissions.checkDataColumnPermissions(
                modelType,
                data,
                propsWith([permission]),
                type,
              );
            }),
          ).toBeNull();
        }
      }
    });

    test("a Viewer may not write it", () => {
      const data: DatabaseBaseModel = new modelType();
      (data as unknown as Record<string, unknown>)[KEY] = "key";

      expect(
        errorOf(() => {
          ColumnPermissions.checkDataColumnPermissions(
            modelType,
            data,
            propsWith([Permission.Viewer]),
            DatabaseRequestType.Update,
          );
        }),
      ).not.toBeNull();
    });

    test("the API's spec takes it on a create and an update, and never returns it", () => {
      const read: { shape: Record<string, unknown> } =
        ModelSchema.getReadModelSchema({ modelType }) as unknown as {
          shape: Record<string, unknown>;
        };
      const create: { shape: Record<string, unknown> } =
        ModelSchema.getCreateModelSchema({ modelType }) as unknown as {
          shape: Record<string, unknown>;
        };
      const update: { shape: Record<string, unknown> } =
        ModelSchema.getUpdateModelSchema({ modelType }) as unknown as {
          shape: Record<string, unknown>;
        };

      expect(Object.keys(read.shape)).not.toContain(KEY);
      expect(Object.keys(read.shape)).toContain("customCertificate");
      expect(Object.keys(create.shape)).toContain(KEY);
      expect(Object.keys(update.shape)).toContain(KEY);
    });

    test("an audit log entry never carries its value", () => {
      expect(getAuditLogRedactedColumns(new modelType()).has(KEY)).toBe(true);
    });
  },
);
