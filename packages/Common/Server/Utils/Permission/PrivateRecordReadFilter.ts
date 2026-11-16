import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Text from "../../../Types/Text";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import PrivateRecordPermission, {
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../Types/Database/Permissions/PrivateRecordPermission";
import QueryHelper from "../../Types/Database/QueryHelper";
import QueryUtil from "../../Types/Database/QueryUtil";
import {
  combineWithPrivacyClause,
  shouldBypassRecordPrivacy,
} from "../PrivacyFilterUtil";
import { DataSource, Raw } from "typeorm";

/*
 * WHAT IS DONE ABOUT A PRIVATE RECORD IS READ ONLY BY THOSE WHO SEE IT.
 *
 * A page of an on-call policy about a private incident, a run of a runbook
 * linked to a private alert, a step of such a page: each is as much a part
 * of the private record it names as the record's notes are
 * (PrivateRecordParts.ALSO_PART_OF), though it is read through something
 * else - the on-call policy, the runbook. Its own columns say what was done
 * about the record (who was paged, what the person who paged wrote, what
 * the runbook printed), and its relation to the record reads the record
 * itself. So it is read only by those who see that record: its owners - the
 * people named on it and the members of the teams named on it, with their
 * invitation accepted - and the project's owners and admins, as the record's
 * own privacy filter reads it (Utils/Incident/IncidentPrivacyFilter and its
 * three twins, by the same owner tables).
 *
 * The columns naming such records can be empty - a page is about an
 * incident OR an alert OR an episode - and a row whose column names no
 * record passes that column's clause: the others decide.
 *
 * The same rule holds THROUGH A RELATION (#9102): see "A RELATION TO A
 * PRIVATE RECORD" below.
 */

// A relation of a model to records that are, or are parts of, private records.
export interface PrivateRecordRelation {
  // The relation: "incident".
  relation: string;
  // The records it reads: Incident, or a part of one (RunbookExecution).
  relatedModelType: { new (): BaseModel };
  // Whether it reads a list of them (many-to-many).
  isList: boolean;
}

/*
 * A person's own page about a record, and its steps: read only by the person
 * paged (their table is read with CurrentUser alone), whose page - the email,
 * SMS, call or push they got - named the record. The people paged about a
 * private record still see their page (#8913), with what it was about, so
 * their relations to it are not held to the rule below. By table name;
 * PrivateRecordRelations.test holds each to being read by its person alone.
 */
export const PAGES_OF_THE_PERSON_PAGED: ReadonlyArray<string> = [
  "UserOnCallLog",
  "UserOnCallLogTimeline",
];

// The most ids one read of the records a page of rows names asks about.
const SEEN_IDS_PER_READ: number = 1000;

export default class PrivateRecordReadFilter {
  /*
   * The columns of `modelType`'s rows naming private records it is a part
   * of but not read through (ALSO_PART_OF): every one of them, for a model
   * read through something that is not private. The record a part is read
   * through has its own filter in the part's service.
   */
  public static getNamedRecordColumns(modelType: {
    new (): BaseModel;
  }): Array<PrivateRecordColumn> {
    const primary: PrivateRecordColumn | null =
      PrivateRecordPermission.getPrivateRecordColumn(modelType);

    return PrivateRecordPermission.getPrivateRecordColumns(modelType).filter(
      (column: PrivateRecordColumn): boolean => {
        return (
          !column.isRecord && !(primary && primary.column === column.column)
        );
      },
    );
  }

  // The same columns, by name: what a service's read hook narrows by.
  public static getNamedRecordColumnNames(modelType: {
    new (): BaseModel;
  }): Array<string> {
    return PrivateRecordReadFilter.getNamedRecordColumns(modelType).map(
      (column: PrivateRecordColumn): string => {
        return column.column;
      },
    );
  }

  /*
   * The condition on a column naming records of `kind`: no record, or one
   * that is no private record the caller does not see - a private one is
   * seen when it is owned by them or by a team of theirs they have
   * accepted. Undefined for a caller who sees every private record
   * (shouldBypassRecordPrivacy), who is not narrowed. A caller who is no
   * person - an API key without Project Owner or Project Admin, a
   * workflow's step - sees no private record.
   *
   * Written as what it leaves out (NOT EXISTS over the private records of
   * the kind), not as every record it lets through: the rows it narrows can
   * be many - a project's notification logs - and the private records are
   * few, so Postgres answers it with an anti-join on the record's primary
   * key. A row naming no record passes, so no part of a record may outlive
   * it naming none: deleting a record deletes its pages, logs, runbook runs
   * and fixes with it (ON DELETE CASCADE, #9103), however it is deleted -
   * PrivateRecordParts.test holds every key naming one to that.
   */
  public static getOptionalRecordReadRaw(data: {
    kind: PrivateRecordKind;
    props: DatabaseCommonInteractionProps;
  }): FindWhereProperty<any> | undefined {
    if (shouldBypassRecordPrivacy(data.props)) {
      return undefined;
    }

    const kind: PrivateRecordKind = data.kind;

    const parameters: Record<string, string> = {};

    let unseen: string = "";

    if (data.props.userId) {
      const user: string = `privReadUser_${Text.generateRandomText(10)}`;

      parameters[user] = data.props.userId.toString();

      unseen =
        ` AND pr."_id" NOT IN (SELECT prou."${kind.ownerKey}" FROM "${kind.ownerUserTable}" prou WHERE prou."userId" = :${user} AND prou."deletedAt" IS NULL AND prou."${kind.ownerKey}" IS NOT NULL)` +
        ` AND pr."_id" NOT IN (SELECT prot."${kind.ownerKey}" FROM "${kind.ownerTeamTable}" prot INNER JOIN "TeamMember" prtm ON prtm."teamId" = prot."teamId" WHERE prtm."userId" = :${user} AND prtm."deletedAt" IS NULL AND prtm."hasAcceptedInvitation" = TRUE AND prot."deletedAt" IS NULL AND prot."${kind.ownerKey}" IS NOT NULL)`;
    }

    return Raw((alias: string): string => {
      return `(${alias} IS NULL OR NOT EXISTS (SELECT 1 FROM "${kind.tableName}" pr WHERE pr."_id" = ${alias} AND pr."isPrivate" = TRUE${unseen}))`;
    }, parameters);
  }

  /*
   * `query` over `modelType`'s rows, kept to the rows that are no private
   * record, no part of one and name none: what a caller who is no person
   * and sees no private record reads - a workflow's step (#8914). For Run
   * Workflow's record picker, which offers only what a run can act on. As
   * it is for a model that has nothing to do with a private record.
   */
  public static keepToNotPrivate<T>(
    query: T,
    modelType: { new (): BaseModel },
  ): T {
    const filtered: Record<string, unknown> = {
      ...((query || {}) as Record<string, unknown>),
    };

    for (const column of PrivateRecordPermission.getPrivateRecordColumns(
      modelType,
    )) {
      const raw: FindWhereProperty<any> | undefined =
        PrivateRecordReadFilter.getOptionalRecordReadRaw({
          kind: column.kind,
          // No person, no project: sees no private record.
          props: {},
        });

      if (!raw) {
        continue;
      }

      const key: string = column.isRecord ? "_id" : column.column;

      filtered[key] = combineWithPrivacyClause(filtered[key], raw);
    }

    return filtered as T;
  }

  /*
   * `query` over `modelType`'s rows, kept to the rows whose every private
   * record they name (getNamedRecordColumns) the caller sees. The caller's
   * own filter on each column stays as sent. As it is for a caller who sees
   * every private record, and for a model that names none.
   */
  public static apply<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
    modelType: { new (): BaseModel },
  ): T {
    const columns: Array<PrivateRecordColumn> =
      PrivateRecordReadFilter.getNamedRecordColumns(modelType);

    if (columns.length === 0 || shouldBypassRecordPrivacy(props)) {
      return query;
    }

    const filtered: Record<string, unknown> = (query || {}) as Record<
      string,
      unknown
    >;

    for (const column of columns) {
      const raw: FindWhereProperty<any> | undefined =
        PrivateRecordReadFilter.getOptionalRecordReadRaw({
          kind: column.kind,
          props: props,
        });

      if (!raw) {
        continue;
      }

      filtered[column.column] = combineWithPrivacyClause(
        filtered[column.column],
        raw,
      );
    }

    return filtered as T;
  }

  /*
   * A RELATION TO A PRIVATE RECORD SHOWS IT ONLY TO THOSE WHO SEE IT (#9102).
   *
   * A Data Security issue, a security case, a form submission, a session
   * replay pinned to an incident, a public alert in an episode: each names
   * a record that may be private without being a part of it, and is read by
   * whoever may read it, with the key naming that record. A read of such a
   * row can select the record through its relation (`select: { incident: {
   * title: true } }`), filter by the record's columns (`{ incident: {
   * title: ... } }`) or sort by them - and a join runs none of the record's
   * own read rule. So through every relation to a record that is, or is a
   * part of, a private record (the related model names private records:
   * PrivateRecordPermission.getPrivateRecordColumns), the related record is
   * read only by those who see every private record it is or names, by this
   * file's rule (getOptionalRecordReadRaw):
   *
   *   - a select reads it only where they see it (keepSeenRelatedRecords):
   *     anyone else gets the row without it, as a row whose relation is
   *     empty - the key naming it stays, as the row's own column;
   *   - a filter on its columns matches only the related records they see
   *     (addToRelationFilters), in a read, a count, an update and a delete;
   *   - a sort by its columns is refused (checkRelationSort): where a record
   *     falls in an order says what it holds, and an order cannot leave a
   *     record out.
   *
   * Not where the model's own read keeps it already: a part of a private
   * record through the key it is a part by - a note's incident, a log's
   * alert - read only where its reader sees that record
   * (getPrivateRecordColumns of the model; PrivateRecordParts.test holds
   * each service to it). Nor a person's own page (PAGES_OF_THE_PERSON_PAGED).
   * Those who see every private record (shouldBypassRecordPrivacy) read
   * every relation as before.
   */
  private static relationsByModel: Map<
    { new (): BaseModel },
    Array<PrivateRecordRelation>
  > = new Map();

  private static everyRelationByModel: Map<
    { new (): BaseModel },
    Array<PrivateRecordRelation>
  > = new Map();

  /*
   * The relations of `modelType` the rule holds (see above): each relation
   * to records that are, or are parts of, private records, but those its
   * own read keeps - unless `evenWhereItsReadKeepsThem`, for a read that
   * runs none of the service's hooks (ignoreHooks), which is narrowed by
   * none of them either.
   */
  public static getRelations(
    modelType: { new (): BaseModel },
    options?: { evenWhereItsReadKeepsThem?: boolean | undefined } | undefined,
  ): Array<PrivateRecordRelation> {
    const isEvery: boolean = Boolean(options?.evenWhereItsReadKeepsThem);

    const cache: Map<
      { new (): BaseModel },
      Array<PrivateRecordRelation>
    > = isEvery
      ? PrivateRecordReadFilter.everyRelationByModel
      : PrivateRecordReadFilter.relationsByModel;

    let relations: Array<PrivateRecordRelation> | undefined =
      cache.get(modelType);

    if (relations) {
      return relations;
    }

    relations = PrivateRecordReadFilter.readRelations(modelType, isEvery);
    cache.set(modelType, relations);

    return relations;
  }

  private static readRelations(
    modelType: { new (): BaseModel },
    isEvery: boolean,
  ): Array<PrivateRecordRelation> {
    const model: BaseModel = new modelType();

    if (PAGES_OF_THE_PERSON_PAGED.includes(model.tableName || "")) {
      return [];
    }

    // What the model's own read keeps to the private records its reader sees.
    const keptByItsRead: Array<PrivateRecordColumn> = isEvery
      ? []
      : PrivateRecordPermission.getPrivateRecordColumns(modelType);

    const relations: Array<PrivateRecordRelation> = [];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (
        !metadata ||
        !metadata.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const relatedModelType: { new (): BaseModel } = metadata.modelType as {
        new (): BaseModel;
      };

      if (
        PrivateRecordPermission.getPrivateRecordColumns(relatedModelType)
          .length === 0
      ) {
        continue;
      }

      const isKeptByItsRead: boolean =
        metadata.type === TableColumnType.Entity &&
        keptByItsRead.some((kept: PrivateRecordColumn): boolean => {
          return (
            kept.column === metadata.manyToOneRelationColumn &&
            kept.recordModelType === relatedModelType
          );
        });

      if (isKeptByItsRead) {
        continue;
      }

      relations.push({
        relation: column,
        relatedModelType: relatedModelType,
        isList: metadata.type === TableColumnType.EntityArray,
      });
    }

    return relations;
  }

  /*
   * What a row of `relatedModelType` must meet to be one the caller sees:
   * for the record itself, on its id, and for each private record a part
   * names, on the key naming it - this file's rule. Null for a caller who
   * sees every private record.
   */
  public static getSeenConditions(data: {
    relatedModelType: { new (): BaseModel };
    props: DatabaseCommonInteractionProps;
  }): Array<{ column: string; condition: FindWhereProperty<any> }> | null {
    if (shouldBypassRecordPrivacy(data.props)) {
      return null;
    }

    const conditions: Array<{
      column: string;
      condition: FindWhereProperty<any>;
    }> = [];

    for (const column of PrivateRecordPermission.getPrivateRecordColumns(
      data.relatedModelType,
    )) {
      const condition: FindWhereProperty<any> | undefined =
        PrivateRecordReadFilter.getOptionalRecordReadRaw({
          kind: column.kind,
          props: data.props,
        });

      if (condition) {
        conditions.push({
          column: column.isRecord ? "_id" : column.column,
          condition: condition,
        });
      }
    }

    return conditions;
  }

  /*
   * `query`, its filters through a relation the rule holds - `{ incident: {
   * title: ... } }` - kept to the related records the caller sees: the
   * conditions of getSeenConditions put under the relation, beside the
   * caller's own filter on the same columns, which stays. A filter a level
   * deeper, under the related record's own relation, the same way. Every
   * other key as sent; a copy where anything changed. As it is for a caller
   * who sees every private record.
   */
  public static addToRelationFilters<T>(
    modelType: { new (): BaseModel },
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    if (
      !query ||
      typeof query !== "object" ||
      Array.isArray(query) ||
      shouldBypassRecordPrivacy(props)
    ) {
      return query;
    }

    return PrivateRecordReadFilter.narrowRelationFilters(
      modelType,
      query as unknown as Record<string, unknown>,
      props,
      PrivateRecordReadFilter.getRelations(modelType, {
        evenWhereItsReadKeepsThem: Boolean(props.ignoreHooks),
      }),
    ) as unknown as T;
  }

  private static narrowRelationFilters(
    modelType: { new (): BaseModel },
    filter: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    heldRelations: Array<PrivateRecordRelation>,
  ): Record<string, unknown> {
    const model: BaseModel = new modelType();
    let narrowed: Record<string, unknown> | null = null;

    for (const key of Object.keys(filter)) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(key);

      if (
        !metadata ||
        !metadata.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const relatedModelType: { new (): BaseModel } = metadata.modelType as {
        new (): BaseModel;
      };

      const isHeld: boolean = heldRelations.some(
        (held: PrivateRecordRelation): boolean => {
          return held.relation === key;
        },
      );

      const narrowOne: (value: unknown) => unknown = (
        value: unknown,
      ): unknown => {
        if (!PrivateRecordReadFilter.isPlainObject(value)) {
          return value;
        }

        // Its own relations first, by the related model's own rule.
        const related: Record<string, unknown> =
          PrivateRecordReadFilter.narrowRelationFilters(
            relatedModelType,
            value as Record<string, unknown>,
            props,
            PrivateRecordReadFilter.getRelations(relatedModelType),
          );

        if (!isHeld) {
          return related;
        }

        const kept: Record<string, unknown> = { ...related };

        for (const seen of PrivateRecordReadFilter.getSeenConditions({
          relatedModelType: relatedModelType,
          props: props,
        }) || []) {
          kept[seen.column] = PrivateRecordReadFilter.combineOnRelatedColumn({
            relatedModelType: relatedModelType,
            column: seen.column,
            existing: kept[seen.column],
            condition: seen.condition,
          });
        }

        return kept;
      };

      const value: unknown = filter[key];
      const rewritten: unknown = Array.isArray(value)
        ? value.map(narrowOne)
        : narrowOne(value);

      if (rewritten !== value) {
        narrowed = narrowed || { ...filter };
        narrowed[key] = rewritten;
      }
    }

    return narrowed || filter;
  }

  /*
   * The caller's filter on a related record's column and a condition of
   * the rule, both: one of OneUptime's operators is written as SQL first,
   * as the related model writes it (QueryUtil.serializeQuery), so the
   * caller's filter is kept rather than dropped.
   */
  private static combineOnRelatedColumn(data: {
    relatedModelType: { new (): BaseModel };
    column: string;
    existing: unknown;
    condition: FindWhereProperty<any>;
  }): FindWhereProperty<any> {
    let existing: unknown = data.existing;

    if (existing instanceof QueryOperator) {
      existing = (
        QueryUtil.serializeQuery(data.relatedModelType, {
          [data.column]: existing,
        } as never) as Record<string, unknown>
      )[data.column];
    }

    return combineWithPrivacyClause(existing, data.condition);
  }

  /*
   * Refuses, for a caller who does not see every private record, a sort
   * through a relation the rule holds by a column of the related record
   * other than its id: `{ incident: { title: "ASC" } }` on a Data Security
   * issue. A sort through the related record's own relation, a level
   * deeper, the same way. Where each record falls in the order would say
   * what its private record holds, one guess at a time - and an order
   * leaves no record out.
   */
  public static checkRelationSort(data: {
    modelType: { new (): BaseModel };
    sort: unknown;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (
      !PrivateRecordReadFilter.isPlainObject(data.sort) ||
      shouldBypassRecordPrivacy(data.props)
    ) {
      return;
    }

    PrivateRecordReadFilter.checkSortLevel({
      modelType: data.modelType,
      sort: data.sort as Record<string, unknown>,
      path: [],
      heldRelations: PrivateRecordReadFilter.getRelations(data.modelType, {
        evenWhereItsReadKeepsThem: Boolean(data.props.ignoreHooks),
      }),
    });
  }

  private static checkSortLevel(data: {
    modelType: { new (): BaseModel };
    sort: Record<string, unknown>;
    path: Array<string>;
    heldRelations: Array<PrivateRecordRelation>;
  }): void {
    const model: BaseModel = new data.modelType();

    for (const field of Object.keys(data.sort)) {
      const value: unknown = data.sort[field];
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(field);

      if (
        !PrivateRecordReadFilter.isPlainObject(value) ||
        !metadata ||
        !metadata.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const relatedModelType: { new (): BaseModel } = metadata.modelType as {
        new (): BaseModel;
      };
      const path: Array<string> = [...data.path, field];

      const isHeld: boolean = data.heldRelations.some(
        (held: PrivateRecordRelation): boolean => {
          return held.relation === field;
        },
      );

      if (isHeld) {
        const ordered: string | undefined = Object.keys(
          value as Record<string, unknown>,
        ).find((relatedField: string): boolean => {
          return (
            relatedField !== "_id" &&
            (value as Record<string, unknown>)[relatedField] !== undefined
          );
        });

        if (ordered) {
          throw new NotAuthorizedException(
            PrivateRecordReadFilter.getRelationSortRefusal({
              field: ordered,
              relatedModelType: relatedModelType,
              relationPath: path.join("."),
            }),
          );
        }
      }

      PrivateRecordReadFilter.checkSortLevel({
        modelType: relatedModelType,
        sort: value as Record<string, unknown>,
        path: path,
        heldRelations: PrivateRecordReadFilter.getRelations(relatedModelType),
      });
    }
  }

  /*
   * Why a sort through a relation the rule holds is refused, after the
   * words every sort refusal starts with (ColumnRefusalMessage).
   */
  public static getRelationSortRefusal(data: {
    field: string;
    relatedModelType: { new (): BaseModel };
    relationPath: string;
  }): string {
    const related: BaseModel = new data.relatedModelType();
    const name: string = related.singularName || related.tableName || "record";
    const noun: string = name.toLowerCase();
    const article: string = ["a", "e", "i", "o", "u"].includes(noun.charAt(0))
      ? "An"
      : "A";

    const why: string = PrivateRecordPermission.isPrivateRecordModel(
      data.relatedModelType,
    )
      ? `${article} ${noun} can be private, and only its owners, Project Owners and Project Admins may read a private one.`
      : `${article} ${noun} can be about a private incident, alert or episode, which only its owners, Project Owners and Project Admins may read.`;

    return `You do not have permissions to sort on - ${data.field} of ${name} through ${data.relationPath}. ${why} So only Project Owners and Project Admins sort a list by its fields.`;
  }

  /*
   * Leaves out of `rows` - read with `select` - every related record the
   * caller does not see, through each relation the rule holds that the
   * select reads more of than the id: a relation to one record is unset, a
   * list loses the entry. The row itself, and the key naming the record,
   * stay. Who sees which related record is read in one query per related
   * model for the whole answer. Nothing to do for a caller who sees every
   * private record, or a select that reads no such relation.
   */
  public static async keepSeenRelatedRecords(data: {
    modelType: { new (): BaseModel };
    rows: Array<BaseModel>;
    select: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (
      data.rows.length === 0 ||
      !PrivateRecordReadFilter.isPlainObject(data.select) ||
      shouldBypassRecordPrivacy(data.props)
    ) {
      return;
    }

    const select: Record<string, unknown> = data.select as Record<
      string,
      unknown
    >;

    const relations: Array<PrivateRecordRelation> =
      PrivateRecordReadFilter.getRelations(data.modelType, {
        evenWhereItsReadKeepsThem: Boolean(data.props.ignoreHooks),
      }).filter((relation: PrivateRecordRelation): boolean => {
        return PrivateRecordReadFilter.selectReadsBeyondId(
          select[relation.relation],
        );
      });

    if (relations.length === 0) {
      return;
    }

    // The ids each related model is asked about, lower-cased.
    const idsByModel: Map<{ new (): BaseModel }, Set<string>> = new Map();

    for (const row of data.rows) {
      for (const relation of relations) {
        for (const id of PrivateRecordReadFilter.getRelatedIds(
          row,
          relation.relation,
        )) {
          const ids: Set<string> =
            idsByModel.get(relation.relatedModelType) || new Set<string>();
          ids.add(id);
          idsByModel.set(relation.relatedModelType, ids);
        }
      }
    }

    const seenByModel: Map<{ new (): BaseModel }, Set<string>> = new Map();

    for (const [relatedModelType, ids] of idsByModel.entries()) {
      seenByModel.set(
        relatedModelType,
        await PrivateRecordReadFilter.readSeenIds({
          relatedModelType: relatedModelType,
          ids: Array.from(ids),
          props: data.props,
        }),
      );
    }

    const isSeen: (
      relation: PrivateRecordRelation,
      related: unknown,
    ) => boolean = (
      relation: PrivateRecordRelation,
      related: unknown,
    ): boolean => {
      const id: string | null = PrivateRecordReadFilter.getId(related);

      return Boolean(id && seenByModel.get(relation.relatedModelType)?.has(id));
    };

    for (const row of data.rows) {
      const values: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;

      for (const relation of relations) {
        const value: unknown = values[relation.relation];

        if (value === undefined || value === null) {
          continue;
        }

        if (Array.isArray(value)) {
          values[relation.relation] = value.filter(
            (related: unknown): boolean => {
              return isSeen(relation, related);
            },
          );
          continue;
        }

        if (!isSeen(relation, value)) {
          values[relation.relation] = undefined;
        }
      }
    }
  }

  /*
   * Of `ids` - records of `relatedModelType` a read reached through a
   * relation - the ones the caller sees (getSeenConditions), lower-cased:
   * read as OneUptime, deleted rows too, so that only the rule decides. All
   * of them for a caller who sees every private record; none when the
   * database cannot be asked, as nothing can then say who sees them.
   */
  public static async readSeenIds(data: {
    relatedModelType: { new (): BaseModel };
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    const conditions: Array<{
      column: string;
      condition: FindWhereProperty<any>;
    }> | null = PrivateRecordReadFilter.getSeenConditions({
      relatedModelType: data.relatedModelType,
      props: data.props,
    });

    const ids: Array<string> = Array.from(
      new Set<string>(
        data.ids.map((id: string): string => {
          return id.toLowerCase();
        }),
      ),
    );

    if (!conditions || conditions.length === 0) {
      return new Set<string>(ids);
    }

    const dataSource: DataSource | null = PostgresAppInstance.isConnected()
      ? PostgresAppInstance.getDataSource()
      : null;

    const seen: Set<string> = new Set<string>();

    if (!dataSource || ids.length === 0) {
      return seen;
    }

    for (
      let start: number = 0;
      start < ids.length;
      start += SEEN_IDS_PER_READ
    ) {
      const where: Record<string, unknown> = {
        _id: QueryHelper.any(ids.slice(start, start + SEEN_IDS_PER_READ)),
      };

      for (const seenCondition of conditions) {
        where[seenCondition.column] = combineWithPrivacyClause(
          where[seenCondition.column],
          seenCondition.condition,
        );
      }

      const rows: Array<BaseModel> = await dataSource
        .getRepository(data.relatedModelType)
        .find({
          where: where as never,
          select: { _id: true } as never,
          withDeleted: true,
        });

      for (const row of rows) {
        const id: string | null = PrivateRecordReadFilter.getId(row);

        if (id) {
          seen.add(id);
        }
      }
    }

    return seen;
  }

  // Whether a select of a relation reads more of it than its id.
  private static selectReadsBeyondId(relationSelect: unknown): boolean {
    if (!relationSelect || typeof relationSelect !== "object") {
      return false;
    }

    return Object.keys(relationSelect).some((key: string): boolean => {
      return (
        key !== "_id" &&
        Boolean((relationSelect as Record<string, unknown>)[key])
      );
    });
  }

  // The ids of the related records a row read back through `relation`.
  private static getRelatedIds(
    row: BaseModel,
    relation: string,
  ): Array<string> {
    const value: unknown = (row as unknown as Record<string, unknown>)[
      relation
    ];
    const ids: Array<string> = [];

    for (const related of Array.isArray(value) ? value : [value]) {
      const id: string | null = PrivateRecordReadFilter.getId(related);

      if (id) {
        ids.push(id);
      }
    }

    return ids;
  }

  // A record's id, lower-cased, however a read shaped it.
  private static getId(record: unknown): string | null {
    if (!record || typeof record !== "object") {
      return null;
    }

    const value: unknown =
      (record as Record<string, unknown>)["_id"] ||
      (record as Record<string, unknown>)["id"];

    return value ? value.toString().toLowerCase() : null;
  }

  // A filter or a sort object: never an operator, an id, a date or a list.
  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
