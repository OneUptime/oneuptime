import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  TableColumnMetadata,
  getTableColumns,
} from "Common/Types/Database/TableColumn";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { getColumnAccessControl } from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableColumnType from "Common/Types/Database/TableColumnType";
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
}

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
  return Array.isArray(acl.read) && acl.read.length > 0;
};

const describeColumns: (
  modelInstance: BaseModel,
  options: { includeRelations: boolean },
) => Array<ColumnDescriptor> = (
  modelInstance: BaseModel,
  options: { includeRelations: boolean },
): Array<ColumnDescriptor> => {
  const columns: { [key: string]: TableColumnMetadata } =
    getTableColumns(modelInstance);

  const descriptors: Array<ColumnDescriptor> = [];

  for (const columnId of Object.keys(columns)) {
    const column: TableColumnMetadata | undefined = columns[columnId];
    if (!column) {
      continue;
    }

    const acl: ColumnAccessControl | undefined = getColumnAccessControl(
      modelInstance,
      columnId,
    );

    if (!hasReadAccess(acl)) {
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

    const descriptor: ColumnDescriptor = {
      id: columnId,
      title: column.title,
      description: column.description,
      type: column.type,
      isRelation,
    };

    if (isRelation && column.modelType) {
      const RelatedModel: ModelConstructor =
        column.modelType as ModelConstructor;
      const relatedInstance: BaseModel = new RelatedModel();
      descriptor.relatedTableName = relatedInstance.tableName || undefined;
      descriptor.relatedColumns = describeColumns(relatedInstance, {
        includeRelations: false,
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

      const columns: Array<ColumnDescriptor> = describeColumns(modelInstance, {
        includeRelations: true,
      });

      /*
       * Round-trip through JSON so the response satisfies the JSONObject
       * shape (plain objects, no class instances, no `undefined` values).
       */
      const responseBody: JSONObject = JSON.parse(
        JSON.stringify({ tableName, columns }),
      );

      return Response.sendJsonObjectResponse(req, res, responseBody);
    } catch (err) {
      next(err);
    }
  }
}
