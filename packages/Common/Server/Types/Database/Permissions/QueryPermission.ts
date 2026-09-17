import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import ColumnPermissions from "./ColumnPermission";
import OwnerOnlyColumnPermission from "./OwnerOnlyColumnPermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import Columns from "../../../../Types/Database/Columns";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { JSONObject } from "../../../../Types/JSON";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import Typeof from "../../../../Types/Typeof";

export default class QueryPermission {
  /**
   * Validates every column reached through a relation in the select.
   *
   * Takes the OUTER query as well as the select because two of the checks below
   * cannot be answered from the select alone. Which COLUMNS a relation may
   * expose is a property of the related model (canReadOnRelationQuery, the
   * column's own read permissions); which ROWS the relation will expose is a
   * property of the outer query, and nothing else - the related rows are
   * whichever ones the join drags in. An owner-only column needs both answers,
   * so the outer query is threaded down here rather than left behind in
   * BasePermission.
   */
  @CaptureSpan()
  public static checkRelationQueryPermission<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();
    const userPermissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).map((i: UserPermission) => {
        return i.permission;
      });

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    for (const key in select) {
      if (typeof (select as JSONObject)[key] === Typeof.Object) {
        const tableColumnMetadata: TableColumnMetadata =
          model.getTableColumnMetadata(key);

        if (!tableColumnMetadata.modelType) {
          throw new BadDataException(
            "Select not supported on " +
              key +
              " of " +
              model.singularName +
              " because this column modelType is not found.",
          );
        }

        const relatedModel: BaseModel = new tableColumnMetadata.modelType();

        if (
          tableColumnMetadata.type === TableColumnType.Entity ||
          tableColumnMetadata.type === TableColumnType.EntityArray
        ) {
          for (const innerKey in (select as any)[key]) {
            // check for permissions.
            if (typeof (select as any)[key][innerKey] === Typeof.Object) {
              throw new BadDataException(
                "You cannot query deep relations. Querying deep relations is not supported.",
              );
            }

            const getRelatedTableColumnMetadata: TableColumnMetadata =
              relatedModel.getTableColumnMetadata(innerKey);

            if (!getRelatedTableColumnMetadata) {
              throw new BadDataException(
                `Column ${innerKey} not found on ${relatedModel.singularName}`,
              );
            }

            /*
             * Owner-only columns are checked BEFORE the canReadOnRelationQuery
             * short-circuit below, and that ordering is the whole point.
             * canReadOnRelationQuery is a modelling flag meaning "this column is
             * safe to surface as a label on a joined row"; it skips every
             * permission check that follows it. The seven notification-method
             * models set it on their identifier columns so that a user's own
             * rule table can render "Email: jane@example.com" - which is
             * correct, and which is also exactly how an administrator's widened
             * read of the RULE table reaches into the METHOD table and lifts a
             * phone number, an email address or a webhook URL belonging to
             * somebody else. Nothing downstream of the `continue` can stop it,
             * so the check has to happen here.
             */
            OwnerOnlyColumnPermission.checkRelationSelect({
              modelType: modelType,
              relationColumnName: key,
              relatedModelType: tableColumnMetadata.modelType,
              relatedColumnName: innerKey,
              query: query as Query<BaseModel>,
              props: props,
            });

            if (
              !getRelatedTableColumnMetadata.canReadOnRelationQuery &&
              !excludedColumnNames.includes(innerKey)
            ) {
              throw new BadDataException(
                `Column ${innerKey} on ${relatedModel.singularName} does not support read on relation query.`,
              );
            }

            if (getRelatedTableColumnMetadata.canReadOnRelationQuery) {
              continue;
            }

            // check if the user has permission to read this column
            if (userPermissions) {
              const hasPermission: boolean = relatedModel.hasReadPermissions(
                userPermissions,
                innerKey,
              );

              if (!hasPermission) {
                let readPermissions: Array<Permission> = [];
                if (relatedModel.getColumnAccessControlFor(innerKey)) {
                  readPermissions =
                    relatedModel.getColumnAccessControlFor(innerKey)!.read;
                }

                throw new NotAuthorizedException(
                  `You do not have permissions to read ${
                    relatedModel.singularName
                  } on ${
                    model.singularName
                  }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
                    readPermissions,
                  ).join(", ")}`,
                );
              }
            }
          }
        }
      }
    }
  }

  @CaptureSpan()
  public static checkQueryPermission<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    /*
     * A WHERE clause reads a value just as surely as a SELECT does, one guess
     * at a time. The name-intersection below authorises a predicate on any
     * column the caller may READ, and Permission.CurrentUser being auto-granted
     * means an owner-only column passes that intersection for everybody - so
     * `{ webhookUrl: "https://hooks.slack.com/services/T.../B.../x" }` is a
     * confirm/deny oracle over somebody else's credential that never appears in
     * any result set. Hold a predicate to the same standard as a select.
     */
    OwnerOnlyColumnPermission.checkQueryPermission(modelType, query, props);

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const canReadOnTheseColumns: Columns =
      ColumnPermissions.getModelColumnsByPermissions(
        modelType,
        userPermissions || [],
        DatabaseRequestType.Read,
      );

    const tableColumns: Array<string> = model.getTableColumns().columns;

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    // Now we need to check all columns.

    for (const key in query) {
      if (excludedColumnNames.includes(key)) {
        continue;
      }

      /*
       * MultiSearch is a synthetic operator: the key itself is not a column,
       * but the operator carries the list of fields it will ILIKE against
       * (QueryUtil.serializeQuery expands it into an OR over those fields).
       * Validate each inner field the same way we validate any other queried
       * column so a client can't search across columns the user can't read.
       */
      if (query[key] instanceof MultiSearch) {
        const multiSearch: MultiSearch = query[key] as unknown as MultiSearch;

        for (const field of multiSearch.fields) {
          if (excludedColumnNames.includes(field)) {
            continue;
          }

          if (!tableColumns.includes(field)) {
            throw new BadDataException(
              `Invalid column on ${model.singularName} - ${field}. Column does not exist.`,
            );
          }

          if (!canReadOnTheseColumns.columns.includes(field)) {
            throw new NotAuthorizedException(
              `You do not have permissions to query on - ${field}. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                model.getColumnAccessControlFor(field)
                  ? model.getColumnAccessControlFor(field)!.read
                  : [],
              ).join(", ")}`,
            );
          }
        }

        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        if (!tableColumns.includes(key)) {
          throw new BadDataException(
            `Invalid column on ${model.singularName} - ${key}. Column does not exist.`,
          );
        }

        throw new NotAuthorizedException(
          `You do not have permissions to query on - ${key}. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
            model.getColumnAccessControlFor(key)
              ? model.getColumnAccessControlFor(key)!.read
              : [],
          ).join(", ")}`,
        );
      }
    }
  }
}
