import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GreenlockCertificate from "../../../Models/DatabaseModels/GreenlockCertificate";
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
 * THE KEYS OF LET'S ENCRYPT CERTIFICATES ARE KEPT ENCRYPTED AT REST, AND
 * NOBODY READS THEM THROUGH THE API.
 *
 * AcmeCertificate.certificateKey holds the private key of every free
 * certificate OneUptime orders - for each custom domain, and for the
 * server's own host - and GreenlockCertificate.blob the ACME account and
 * certificate keys the store before it kept. Whoever holds one can serve
 * the domain as its owner. They were stored as plaintext while the keys
 * customers upload were encrypted (#8933). Now both are encrypted at rest,
 * and, as before, neither table has an endpoint, a column anybody may read
 * or write, or an audit log entry that carries a key. These read the
 * models and run the server's own column checks.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type ModelType = { new (): DatabaseBaseModel };

const KEYS: Array<[string, ModelType, string]> = [
  ["AcmeCertificate.certificateKey", AcmeCertificate, "certificateKey"],
  ["GreenlockCertificate.blob", GreenlockCertificate, "blob"],
];

// Every role there is: none of them may read a key.
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

describe.each(KEYS)(
  "%s",
  (_name: string, modelType: ModelType, column: string) => {
    test("is kept encrypted at rest, and counts as a secret", () => {
      const model: DatabaseBaseModel = new modelType();
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.encrypted).toBe(true);
      expect(ModelSchema.isSecretColumn(metadata)).toBe(true);
      expect(model.getEncryptedColumns().columns).toContain(column);
    });

    test("is never read through a relation", () => {
      const metadata: TableColumnMetadata =
        new modelType().getTableColumnMetadata(column);

      expect(Boolean(metadata.canReadOnRelationQuery)).toBe(false);
    });

    test("its table has no endpoint, and nobody may read, write or filter on the key", () => {
      const model: DatabaseBaseModel = new modelType();

      expect(model.crudApiPath).toBeFalsy();
      expect(model.readRecordPermissions).toEqual([]);
      expect(model.createRecordPermissions).toEqual([]);
      expect(model.updateRecordPermissions).toEqual([]);

      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect(accessControl?.read).toEqual([]);
      expect(accessControl?.create).toEqual([]);
      expect(accessControl?.update).toEqual([]);
    });

    test("a select of the key is refused for every role, a Project Owner's included", () => {
      for (const permission of EVERY_ROLE) {
        const error: Error | null = errorOf(() => {
          SelectPermission.checkSelectPermission(
            modelType,
            { [column]: true } as never,
            propsWith([permission]),
          );
        });

        expect(error).toBeInstanceOf(NotAuthorizedException);
      }
    });

    test("a filter on the key is refused too, so it cannot be guessed one value at a time", () => {
      const error: Error | null = errorOf(() => {
        QueryPermission.checkQueryPermission(
          modelType,
          { [column]: "-----BEGIN PRIVATE KEY-----" } as never,
          propsWith([Permission.ProjectOwner]),
        );
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("an audit log entry never carries its value", () => {
      expect(getAuditLogRedactedColumns(new modelType()).has(column)).toBe(
        true,
      );
    });
  },
);
