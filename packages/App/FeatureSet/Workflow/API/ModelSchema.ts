import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  TableColumnMetadata,
  getTableColumns,
} from "Common/Types/Database/TableColumn";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Permission from "Common/Types/Permission";
import { isSystemColumnId } from "Common/Types/Workflow/SystemColumns";
import Entities from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

interface ColumnDescriptor {
  id: string;
  title: string;
  description?: string | undefined;
  type: TableColumnType;
  isRelation: boolean;
  relatedTableName?: string | undefined;
  relatedColumns?: Array<ColumnDescriptor> | undefined;
  /** Whether a create must supply this column. Mirrors @TableColumn required. */
  required: boolean;
  /**
   * Whether a create can leave this column out and still succeed. True when the
   * column carries a default of any kind, which is exactly what
   * DatabaseService.checkRequiredFields exempts.
   */
  hasDefault: boolean;
  /**
   * True for the project column and for the relation that shares its physical
   * column. The workflow runner stamps both itself (applyTenantColumn), so a
   * builder never supplies them - the record editor uses this to avoid opening
   * with a row nothing should be typed into.
   */
  isTenantColumn: boolean;
  /**
   * True for a column OneUptime fills in itself: the record's ID and
   * timestamps, who created it, and anything the model computes on save (a
   * slug, a number, a notification status). The record editor never offers
   * one for a create or an update. A Select or a Query can still name it -
   * reading when an incident was created, or filtering on it, is useful.
   */
  isSystemColumn: boolean;
  /**
   * Whether some role may set this column when a record is created, and
   * whether some role may change it afterwards. The write gate admits a column
   * when either is true, so the editor needs both to tell Create One's fields
   * from Update One's: createdByUserId is create-only, and a column like
   * Incident.statusPagesNotifiedOnCreation is update-only.
   */
  canCreate: boolean;
  canUpdate: boolean;
  example?: string | undefined;
  placeholder?: string | undefined;
}

/**
 * Which permission list decides whether a column is described.
 *
 * "read" is what a Select or Query argument needs - you are naming a column to
 * be given back, or to filter on. "write" is what a create/update payload
 * needs, and the two genuinely differ: MonitorSecret.secretValue declares
 * `read: []` with full create and update lists, so the column the component
 * exists to write is invisible under the read gate.
 */
export type ModelSchemaAccess = "read" | "write";

export const parseAccess: (value: unknown) => ModelSchemaAccess = (
  value: unknown,
): ModelSchemaAccess => {
  return value === "write" ? "write" : "read";
};

type ModelConstructor = { new (): BaseModel };

const findModelByTableName: (tableName: string) => ModelConstructor | null = (
  tableName: string,
): ModelConstructor | null => {
  for (const ModelClass of Entities) {
    const instance: BaseModel = new ModelClass();
    if (instance.tableName === tableName) {
      return ModelClass as ModelConstructor;
    }
  }
  return null;
};

const isRelationType: (type: TableColumnType) => boolean = (
  type: TableColumnType,
): boolean => {
  return (
    type === TableColumnType.Entity || type === TableColumnType.EntityArray
  );
};

const hasReadAccess: (acl: ColumnAccessControl | undefined) => boolean = (
  acl: ColumnAccessControl | undefined,
): boolean => {
  if (!acl) {
    // No ACL decorator means the column was never gated — treat as not selectable.
    return false;
  }
  if (!Array.isArray(acl.read) || acl.read.length === 0) {
    return false;
  }
  /*
   * Self-only fields (password, MFA secrets, personal tokens, etc.) have
   * CurrentUser as their only reader. They don't belong in a workflow
   * picker — a workflow runs as a role, not as the field's owner.
   */
  const everyReaderIsCurrentUser: boolean = acl.read.every((p: Permission) => {
    return p === Permission.CurrentUser;
  });
  if (everyReaderIsCurrentUser) {
    return false;
  }
  return true;
};

// Whether some role may set the column on a new record.
const hasCreateAccess: (acl: ColumnAccessControl | undefined) => boolean = (
  acl: ColumnAccessControl | undefined,
): boolean => {
  return Boolean(acl && Array.isArray(acl.create) && acl.create.length > 0);
};

// Whether some role may change the column on a record that exists.
const hasUpdateAccess: (acl: ColumnAccessControl | undefined) => boolean = (
  acl: ColumnAccessControl | undefined,
): boolean => {
  return Boolean(acl && Array.isArray(acl.update) && acl.update.length > 0);
};

/*
 * A column is writable when some role may create or update it. Deliberately not
 * symmetrical with hasReadAccess: there is no CurrentUser carve-out, because a
 * self-only writable column (a user's own password) is already excluded by
 * carrying no create/update permission that a workflow's role could hold, and
 * the columns this gate exists for - encrypted secrets - are write-only by
 * design.
 */
const hasWriteAccess: (acl: ColumnAccessControl | undefined) => boolean = (
  acl: ColumnAccessControl | undefined,
): boolean => {
  return hasCreateAccess(acl) || hasUpdateAccess(acl);
};

/*
 * A column OneUptime fills in itself. `computed` is how the models mark it -
 * the ID and timestamps, every slug, record numbers, notification statuses -
 * and forceGetDefaultValueOnCreate overwrites whatever a create sends. The
 * shared list catches the rest, chiefly createdByUserId, which carries a
 * create list on nearly every model only so the write path may stamp it.
 */
const isSystemColumn: (
  columnId: string,
  column: TableColumnMetadata,
) => boolean = (columnId: string, column: TableColumnMetadata): boolean => {
  return (
    isSystemColumnId(columnId) ||
    Boolean(column.computed) ||
    Boolean(column.forceGetDefaultValueOnCreate)
  );
};

const hasAccess: (
  acl: ColumnAccessControl | undefined,
  access: ModelSchemaAccess,
) => boolean = (
  acl: ColumnAccessControl | undefined,
  access: ModelSchemaAccess,
): boolean => {
  return access === "write" ? hasWriteAccess(acl) : hasReadAccess(acl);
};

const describeColumns: (
  modelInstance: BaseModel,
  options: { includeRelations: boolean; access: ModelSchemaAccess },
) => Array<ColumnDescriptor> = (
  modelInstance: BaseModel,
  options: { includeRelations: boolean; access: ModelSchemaAccess },
): Array<ColumnDescriptor> => {
  const columns: { [key: string]: TableColumnMetadata } =
    getTableColumns(modelInstance);

  /*
   * The standalone getColumnAccessControl reads only the @ColumnAccessControl
   * decorator. The primary key and the timestamp columns carry no decorator -
   * the model injects their ACLs from its own record-level permissions - so
   * reading the decorator alone hid "_id" from the picker, which is exactly
   * the column builders most need to find (see issue #3132).
   *
   * Built once per model: the model's per-column accessor rebuilds this whole
   * dictionary on every call, which would make describing a model quadratic in
   * its column count, and describeColumns recurses into every relation.
   */
  const accessControlByColumn: Dictionary<ColumnAccessControl> =
    modelInstance.getColumnAccessControlForAllColumns();

  const tenantColumn: string | null = modelInstance.getTenantColumn();

  const descriptors: Array<ColumnDescriptor> = [];

  for (const columnId of Object.keys(columns)) {
    const column: TableColumnMetadata | undefined = columns[columnId];
    if (!column) {
      continue;
    }

    const acl: ColumnAccessControl | undefined =
      accessControlByColumn[columnId];

    if (!hasAccess(acl, options.access)) {
      continue;
    }

    /*
     * Skip columns without a human-readable title. Untitled columns are
     * typically internal/system fields (FK columns, computed flags, etc.)
     * that shouldn't show up in the user-facing picker.
     */
    if (!column.title) {
      continue;
    }

    const isRelation: boolean = isRelationType(column.type);

    if (isRelation && !options.includeRelations) {
      // We're describing the columns of a related entity — don't recurse further.
      continue;
    }

    /*
     * Any kind of default lets a create leave the column out. checkRequiredFields
     * exempts isDefaultValueColumn; the other two are set by the write path
     * before that check ever runs, so all three mean "you need not type this".
     */
    const hasDefault: boolean = Boolean(
      column.isDefaultValueColumn ||
        column.defaultValue !== undefined ||
        column.forceGetDefaultValueOnCreate,
    );

    const isTenantColumn: boolean = Boolean(
      tenantColumn &&
        (columnId === tenantColumn ||
          column.manyToOneRelationColumn === tenantColumn),
    );

    const descriptor: ColumnDescriptor = {
      id: columnId,
      title: column.title,
      description: column.description,
      type: column.type,
      isRelation,
      required: Boolean(column.required),
      hasDefault: hasDefault,
      isTenantColumn: isTenantColumn,
      isSystemColumn: isSystemColumn(columnId, column),
      canCreate: hasCreateAccess(acl),
      canUpdate: hasUpdateAccess(acl),
      /*
       * example is typed loosely on TableColumnMetadata (it also carries JSON
       * for the API reference). Only a scalar is useful as a placeholder in a
       * one-line input, so anything else is dropped rather than stringified
       * into "[object Object]".
       */
      example:
        typeof column.example === "string" ||
        typeof column.example === "number" ||
        typeof column.example === "boolean"
          ? String(column.example)
          : undefined,
      placeholder: column.placeholder,
    };

    if (isRelation && column.modelType) {
      const RelatedModel: ModelConstructor =
        column.modelType as ModelConstructor;
      const relatedInstance: BaseModel = new RelatedModel();
      descriptor.relatedTableName = relatedInstance.tableName || undefined;
      /*
       * Related columns stay on the read gate even when the parent request is
       * for write columns: pointing a record at a related row means naming an
       * existing record, not writing that record's fields. Gating them on
       * create/update would drop most relations, since a related model's "_id"
       * is readable but not writable.
       */
      descriptor.relatedColumns = describeColumns(relatedInstance, {
        includeRelations: false,
        access: "read",
      });

      // A relation with zero readable scalar columns is useless in the picker.
      if (
        !descriptor.relatedColumns ||
        descriptor.relatedColumns.length === 0
      ) {
        continue;
      }
    }

    descriptors.push(descriptor);
  }

  descriptors.sort((a: ColumnDescriptor, b: ColumnDescriptor) => {
    return a.title.localeCompare(b.title);
  });

  return descriptors;
};

export default class ModelSchemaAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.get(
      `/model-schema/:tableName`,
      UserMiddleware.getUserMiddleware,
      this.getModelSchema,
    );
  }

  public async getModelSchema(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const tableName: string | undefined = req.params["tableName"];

      if (!tableName) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("tableName not found in URL"),
        );
      }

      const ModelClass: ModelConstructor | null =
        findModelByTableName(tableName);

      if (!ModelClass) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(`No model found for tableName: ${tableName}`),
        );
      }

      const modelInstance: BaseModel = new ModelClass();

      /*
       * Defaults to "read" for every caller that does not ask, so the field
       * picker and the query builder keep the read-only gate they were built
       * against - filtering on a column your role cannot read is a disclosure
       * vector, and that is deliberate for those two.
       */
      const access: ModelSchemaAccess = parseAccess(req.query?.["access"]);

      const columns: Array<ColumnDescriptor> = describeColumns(modelInstance, {
        includeRelations: true,
        access: access,
      });

      /*
       * Round-trip through JSON so the response satisfies the JSONObject
       * shape (plain objects, no class instances, no `undefined` values).
       */
      const responseBody: JSONObject = JSON.parse(
        JSON.stringify({ tableName, access, columns }),
      );

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
      next(err);
    }
  }
}
