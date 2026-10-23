import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import ColumnPermissions from "./ColumnPermission";
import ColumnRefusalMessage from "./ColumnRefusalMessage";
import OwnedScopePermission from "./OwnedScopePermission";
import OwnerOnlyColumnPermission from "./OwnerOnlyColumnPermission";
import RelationListPermission from "./RelationListPermission";
import TablePermission from "./TablePermission";
import OwnedByFilter, { OwnerTable, OwnerTablesOfKind } from "../OwnedByFilter";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import OwnedBy, {
  OWNED_BY_QUERY_KEY,
  OwnedByMatch,
} from "../../../../Types/BaseDatabase/OwnedBy";
import Columns from "../../../../Types/Database/Columns";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
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

    /*
     * What the caller holds, read the way the select check reads it
     * (ColumnPermission): allow rows grant, and a block with no labels takes
     * a permission away.
     */
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: ColumnPermissions.getColumnCheckRows(props),
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

            /*
             * Whether the caller may read this column of the related record,
             * by the rule every permission check follows (HeldPermissionsUtil),
             * as the select check reads a column: one of its read permissions
             * held, no block with no labels on any of them, and the related
             * table's operational-resource wildcard for a column that lets in
             * everyone its table does. A column without its own access
             * control is read with its table's permissions.
             */
            if (
              !QueryPermission.canReadRelatedColumn({
                relatedModel: relatedModel,
                column: innerKey,
                held: held,
              })
            ) {
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
                }. ${ColumnRefusalMessage.getWhoMay("query", readPermissions)}`,
              );
            }
          }
        }
      }
    }
  }

  // Whether `held` may read one column of a record reached by a relation.
  private static canReadRelatedColumn(data: {
    relatedModel: BaseModel;
    column: string;
    held: HeldPermissions;
  }): boolean {
    const tablePermissions: Array<Permission> =
      data.relatedModel.getReadPermissions() || [];

    if (!data.relatedModel.getColumnAccessControlFor(data.column)) {
      return HeldPermissionsUtil.holdsAnyOf(data.held, tablePermissions, {
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: data.relatedModel.isOperationalResource,
          operation: "read",
        }),
      });
    }

    const columnPermissions: Array<Permission> =
      data.relatedModel.getColumnAccessControlFor(data.column)!.read || [];

    return HeldPermissionsUtil.holdsAnyOf(data.held, columnPermissions, {
      wildcard: HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: data.relatedModel.isOperationalResource,
        operation: "read",
        tablePermissions: tablePermissions,
        columnPermissions: columnPermissions,
      }),
    });
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

    const canReadOnTheseColumns: Columns =
      ColumnPermissions.getModelColumnsByPermissions(
        modelType,
        ColumnPermissions.getColumnCheckRows(props),
        DatabaseRequestType.Read,
      );

    const tableColumns: Array<string> = model.getTableColumns().columns;

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    /*
     * What the caller holds, read the way the select check reads it - for
     * the columns a relation filter names (checkRelationFilterPermission).
     */
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: ColumnPermissions.getColumnCheckRows(props),
    });

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
              ColumnRefusalMessage.getQueryRefusal({
                column: field,
                permissions: model.getColumnAccessControlFor(field)?.read || [],
              }),
            );
          }
        }

        continue;
      }

      /*
       * WHO OWNS THE RECORDS (OwnedBy, under "owners") is no column of
       * theirs: it reads their owner tables. See checkOwnedByPermission.
       */
      if (query[key] instanceof OwnedBy) {
        QueryPermission.checkOwnedByPermission({
          modelType: modelType,
          key: key,
          ownedBy: query[key] as unknown as OwnedBy,
          props: props,
        });

        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        if (!tableColumns.includes(key)) {
          throw new BadDataException(
            `Invalid column on ${model.singularName} - ${key}. Column does not exist.`,
          );
        }

        // Who may read it, or that nobody may (ColumnRefusalMessage).
        throw new NotAuthorizedException(
          ColumnRefusalMessage.getQueryRefusal({
            column: key,
            permissions: model.getColumnAccessControlFor(key)?.read || [],
          }),
        );
      }

      QueryPermission.checkRelationFilterPermission({
        model: model,
        relationColumn: key,
        filter: (query as Record<string, unknown>)[key],
        held: held,
        props: props,
      });
    }
  }

  /*
   * A FILTER BY OWNERS IS A READ OF THE OWNER TABLES.
   *
   * `{ owners: OwnedBy }` matches the records some people or teams own, which
   * is what <Kind>OwnerUser and <Kind>OwnerTeam hold - the people a filter
   * names are read in the one, the teams in the other, and both when it asks
   * whether a record has owners at all. So it is held to what listing those
   * tables by the same owners would be held to: the table's read permission,
   * no block on it, and the read of the two columns it compares (the record's
   * key and userId or teamId). Owner rows are read through their record, so
   * the records this query reaches are already the ones whose owners the
   * caller may read. Only a kind with owners of its own is filtered by them
   * (OwnedByFilter), and only under "owners".
   */
  private static checkOwnedByPermission(data: {
    modelType: DatabaseBaseModelType;
    key: string;
    ownedBy: OwnedBy;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.key !== OWNED_BY_QUERY_KEY) {
      throw new BadDataException(
        `A filter by owners goes under "${OWNED_BY_QUERY_KEY}", not "${data.key}".`,
      );
    }

    const tables: OwnerTablesOfKind | null = OwnedByFilter.getOwnerTables(
      data.modelType,
    );

    if (!tables) {
      throw OwnedByFilter.getNoOwnersException(data.modelType);
    }

    const readsEveryOwner: boolean =
      data.ownedBy.match === OwnedByMatch.AnyOwner ||
      data.ownedBy.match === OwnedByMatch.NoOwner;

    const tablesRead: Array<OwnerTable> = [];

    if (readsEveryOwner || data.ownedBy.userIds.length > 0) {
      tablesRead.push(tables.userTable);
    }

    if (readsEveryOwner || data.ownedBy.teamIds.length > 0) {
      tablesRead.push(tables.teamTable);
    }

    for (const table of tablesRead) {
      TablePermission.checkTableLevelPermissions(
        table.modelType,
        data.props,
        DatabaseRequestType.Read,
      );

      TablePermission.checkTableLevelBlockPermissions(
        table.modelType,
        data.props,
        DatabaseRequestType.Read,
      );

      const readableColumns: Columns =
        ColumnPermissions.getModelColumnsByPermissions(
          table.modelType,
          ColumnPermissions.getColumnCheckRows(data.props),
          DatabaseRequestType.Read,
        );

      const ownerTable: BaseModel = new table.modelType();

      for (const column of [table.resourceColumnName, table.ownerColumnName]) {
        if (!readableColumns.columns.includes(column)) {
          throw new NotAuthorizedException(
            ColumnRefusalMessage.getRelationQueryRefusal({
              column: column,
              relatedModelName: ownerTable.singularName || table.tableName,
              relationColumn: OWNED_BY_QUERY_KEY,
              permissions:
                ownerTable.getColumnAccessControlFor(column)?.read || [],
            }),
          );
        }
      }
    }
  }

  /*
   * A FILTER THROUGH A RELATION IS HELD TO THE RELATED COLUMN'S READ.
   *
   * A query may filter a record by a column of a record it names -
   * `{ user: { name: Search("jo") } }` on a team member - and the database
   * joins the related table to answer it. The check above holds the
   * relation itself to the caller's read, but nothing held the related
   * column: a filter on a status page's `callSmsConfig.twilioAuthToken`, or
   * on its `smtpConfig.password`, was answered for anyone who may read the
   * page. Which records a filter matches says something about the value it
   * compares, so a WHERE reads a value as surely as a SELECT does.
   *
   * So each column a relation filter names is held to the related column's
   * read: a column marked canReadOnRelationQuery, which any reader of the
   * relation may select, or one of the id and timestamp columns every
   * select may name, is filtered on freely; any other only by a caller who
   * may read that column of the related model (canReadRelatedColumn) - and
   * never by a workflow's step when the related model is a setting that
   * holds credentials, whose read a step acting as a Project Admin is not
   * lent (RelationListPermission.isReadWithheldFromWorkflow): whoever may
   * edit a workflow decides what its Find steps filter by. A filter a level
   * deeper is held to the same rule from there. Root and master admin reads
   * never reach this check.
   */
  private static checkRelationFilterPermission(data: {
    model: BaseModel;
    relationColumn: string;
    filter: unknown;
    held: HeldPermissions;
    props: DatabaseCommonInteractionProps;
  }): void {
    const filters: Array<unknown> = Array.isArray(data.filter)
      ? data.filter
      : [data.filter];

    const relationFilters: Array<Record<string, unknown>> = filters.filter(
      (filter: unknown): filter is Record<string, unknown> => {
        return QueryPermission.isPlainObject(filter);
      },
    );

    if (relationFilters.length === 0) {
      return;
    }

    const tableColumnMetadata: TableColumnMetadata | undefined =
      data.model.getTableColumnMetadata(data.relationColumn);

    if (
      !tableColumnMetadata ||
      !tableColumnMetadata.modelType ||
      (tableColumnMetadata.type !== TableColumnType.Entity &&
        tableColumnMetadata.type !== TableColumnType.EntityArray)
    ) {
      return;
    }

    const relatedModel: BaseModel = new tableColumnMetadata.modelType();

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    /*
     * The related model's columns the caller reads only on the records they
     * or their teams own (a Runner's key: OwnedScopePermission
     * .getColumnsKeptToOwners). A filter through the relation would match
     * every other record by them too, so it is refused.
     */
    const keptToOwners: Array<string> =
      OwnedScopePermission.getColumnsKeptToOwners(
        tableColumnMetadata.modelType,
        data.props,
      );

    for (const relationFilter of relationFilters) {
      for (const relatedColumn of Object.keys(relationFilter)) {
        if (keptToOwners.includes(relatedColumn)) {
          throw new NotAuthorizedException(
            OwnedScopePermission.getColumnKeptToOwnersRefusal(
              tableColumnMetadata.modelType,
              relatedColumn,
            ),
          );
        }

        const relatedColumnMetadata: TableColumnMetadata | undefined =
          relatedModel.getTableColumnMetadata(relatedColumn);

        if (!relatedColumnMetadata) {
          throw new BadDataException(
            `Column ${relatedColumn} not found on ${relatedModel.singularName}`,
          );
        }

        if (
          !excludedColumnNames.includes(relatedColumn) &&
          !relatedColumnMetadata.canReadOnRelationQuery &&
          (!QueryPermission.canReadRelatedColumn({
            relatedModel: relatedModel,
            column: relatedColumn,
            held: data.held,
          }) ||
            RelationListPermission.isReadWithheldFromWorkflow(
              tableColumnMetadata.modelType,
              data.props,
            ))
        ) {
          throw new NotAuthorizedException(
            ColumnRefusalMessage.getRelationQueryRefusal({
              column: relatedColumn,
              relatedModelName: relatedModel.singularName || "",
              relationColumn: data.relationColumn,
              permissions: QueryPermission.getRelatedReadPermissions(
                relatedModel,
                relatedColumn,
              ),
            }),
          );
        }

        QueryPermission.checkRelationFilterPermission({
          model: relatedModel,
          relationColumn: relatedColumn,
          filter: relationFilter[relatedColumn],
          held: data.held,
          props: data.props,
        });
      }
    }
  }

  // Who may read one column of a related model, as a refusal names them.
  private static getRelatedReadPermissions(
    relatedModel: BaseModel,
    column: string,
  ): Array<Permission> {
    return (
      relatedModel.getColumnAccessControlFor(column)?.read ||
      relatedModel.getReadPermissions() ||
      []
    );
  }

  /*
   * A filter object: what a relation filter is. Never an operator
   * (Search, Includes...), an id or a date, which are values a column is
   * compared with.
   */
  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== Typeof.Object || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
