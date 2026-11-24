import type DatabaseService from "../../Services/DatabaseService";
import type ProjectServiceType from "../../Services/ProjectService";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import CreateBy from "../../Types/Database/CreateBy";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import UpdateBy from "../../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Logger";
import ProjectLimitLock from "./ProjectLimitLock";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { ProjectNameRule } from "../../../Types/Database/ProjectNameRule";
import {
  DuplicateNameGroup,
  DuplicateNameRecord,
  DuplicateNamesOfKind,
  getNumbersTakenNameData,
  isNumbersTakenName,
  MAX_DUPLICATE_GROUPS_PER_KIND,
  MAX_DUPLICATE_RECORDS_PER_GROUP,
  UniqueNameCheckAnswer,
} from "../../../Types/Database/RequiredUniqueNames";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  FREE_NAME_ATTEMPTS,
  getNameKey,
  getNameKeySql,
  getNumberedName,
  getRequiredUniqueNameTakenRefusal,
  NAME_WHITE_SPACE_RUN_PATTERN,
  normalizeName,
  REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
} from "../../../Types/Database/UniqueName";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import BadDataException from "../../../Types/Exception/BadDataException";
import NameTakenException from "../../../Types/Exception/NameTakenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ARCHIVED_COLUMN } from "../../../Utils/ArchivableValues";
import crypto from "crypto";

/*
 * NAMES ONE OF THEIR KIND IN A PROJECT THAT REQUIRES IT (#10761).
 *
 * A project's Require Unique Names (Project requireUniqueNames) holds the
 * kinds a model marks @UniqueNameWhenRequired - monitors, monitor groups,
 * probes, SLOs, templates, connections and the rest - to one record per
 * name, case and spacing aside (Types/Database/UniqueName). The base
 * service asks this on every create and every update of a marked kind
 * (DatabaseService), so the Dashboard, the API, Terraform and a workflow
 * are held to it alike:
 *
 *   - a new record is refused a name another record of its kind in the
 *     project has;
 *   - so is a rename. A write that gives a record its own name again - an
 *     edit form sends the name back, perhaps in another case - is no
 *     rename, and is never refused: records that shared a name before the
 *     setting was on can still be edited, and renamed apart;
 *   - one update that would give several records the name is refused.
 *
 * An archived record keeps its name: archived, it is in no list, but
 * unarchived it would be a twin, and unarchiving is never refused. The
 * refusal says so, with the code a program tells it by. Its words name the
 * other record - its own name, and its id beside them (NameTakenException's
 * takenById) - where the caller may read it; of one they may not, nothing
 * but that it holds the name. Nothing is written by a refused write, and
 * the refusal carries NameTakenException's code, so the Terraform provider
 * asks again for a while: another resource of the same apply may be
 * renaming that record away (Scripts/TerraformProvider ProviderGenerator).
 *
 * OneUptime's own writes are trusted (isRoot), as UniqueNameInProject
 * trusts them: telemetry, a discovery import, a rule's run. A write made
 * for a person with a name OneUptime picked - a guided setup's monitor named
 * after its address, a recommendation's "web - High CPU", a data product's
 * monitor, a library's hunt - says so in its misc data
 * (NUMBERS_TAKEN_NAME_KEY), and takes the next free numbered name ("web -
 * High CPU 2") instead of being refused: the person cannot pick another
 * where it is written. A name a person typed is never numbered.
 *
 * TWO WRITES OF ONE NAME AT ONE MOMENT - two parallel Terraform creates, a
 * double-clicked Save - cannot both pass. The check and the write are held
 * by a lock named after the kind, the project and the name as it reads
 * (Semaphore, in Valkey): a write takes it before it looks for the name,
 * and gives it back only once its INSERT or UPDATE has committed, so the
 * second write looks once the first one's row is there, and is refused.
 * Writes of other names, other kinds and other projects never wait for
 * each other. Valkey holds the lock rather than a Postgres transaction
 * because an update writes its row in several ways (a plain UPDATE, save()
 * for its lists, entry by entry), and a lock outside them holds every one;
 * without Valkey a write goes ahead unlocked, still checked, as a state
 * change does (StateChangeLock).
 *
 * The lookup is one indexed read: each marked table has an index on its
 * project and its name as it reads (1809187560000-AddUniqueNameIndexes).
 * No unique index refuses a twin by itself: a project that existed before
 * may hold names twice, and the rule is the project's to switch on and off.
 */

// What a hold of a name is: the lock to give back once the write is done.
export type UniqueNameHold = SemaphoreMutex | null;

// Where the locks live in Valkey.
export const UNIQUE_NAME_LOCK_NAMESPACE: string = "RequiredUniqueName";

// A column of a write's data, a row or a model, as it was written.
const readColumn: (record: unknown, column: string) => unknown = (
  record: unknown,
  column: string,
): unknown => {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  return (record as JSONObject)[column];
};

const toObjectId: (value: unknown) => ObjectID | null = (
  value: unknown,
): ObjectID | null => {
  if (value instanceof ObjectID) {
    return value;
  }

  if (typeof value === "string" && ObjectID.isValidUUID(value)) {
    return new ObjectID(value);
  }

  return null;
};

const toIdText: (value: unknown) => string = (value: unknown): string => {
  return value ? String(value).toLowerCase() : "";
};

// A date as the API writes one, or null.
const toDateText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }

  return typeof value === "string" && value ? value : null;
};

export default class RequiredUniqueNames {
  // The column a service's kind holds one of its kind while required, or null.
  public static getColumn<TBaseModel extends BaseModel>(
    service: DatabaseService<TBaseModel>,
  ): string | null {
    return getUniqueNameWhenRequiredColumn(service.getModel());
  }

  /*
   * Marks a create whose name its service filled in - left empty, and named
   * after its provider, organization or firewall - as one whose taken name
   * is numbered rather than refused: nobody typed it.
   */
  public static numberTakenNameOf<TBaseModel extends BaseModel>(
    createBy: CreateBy<TBaseModel>,
  ): void {
    createBy.miscDataProps = {
      ...(createBy.miscDataProps || {}),
      ...getNumbersTakenNameData(),
    };
  }

  /*
   * Whether the project requires unique names now. A project whose setting
   * cannot be read lets names repeat, as one that never turned it on does:
   * the rule is a project's tidiness, and never the reason a write fails.
   */
  public static async isRequiredInProject(
    projectId: ObjectID,
  ): Promise<boolean> {
    /*
     * Lazy require: ProjectService extends DatabaseService, which asks this
     * module on every write, so a top-level import would leave
     * DatabaseService undefined where ProjectService extends it.
     */
    const projectService: typeof ProjectServiceType =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/ProjectService").default;

    // No database to read it from: nothing is held to it.
    if (!PostgresAppInstance.isConnected()) {
      return false;
    }

    try {
      const project: Project | null = await projectService.findOneById({
        id: projectId,
        select: {
          requireUniqueNames: true,
        },
        props: {
          isRoot: true,
        },
      });

      return project?.requireUniqueNames === true;
    } catch (err) {
      logger.error(err, {
        projectId: projectId.toString(),
      } as LogAttributes);

      return false;
    }
  }

  /*
   * A new record's name: refused when another record of its kind in its
   * project has it, while the project requires unique names. Hands back the
   * lock that holds the name until the record's INSERT has committed (give
   * it back with giveBack), or null when there is nothing to hold.
   */
  public static async holdNameOnCreate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    createBy: CreateBy<TBaseModel>;
  }): Promise<UniqueNameHold> {
    const column: string | null = RequiredUniqueNames.getColumn(data.service);

    if (!column || data.createBy.props.isRoot) {
      return null;
    }

    const name: unknown = readColumn(data.createBy.data, column);

    // No name is the column's own checks' to answer.
    if (!getNameKey(name)) {
      return null;
    }

    const projectId: ObjectID | null =
      toObjectId(readColumn(data.createBy.data, "projectId")) ||
      data.createBy.props.tenantId ||
      null;

    if (!projectId) {
      return null;
    }

    if (!(await RequiredUniqueNames.isRequiredInProject(projectId))) {
      return null;
    }

    return await RequiredUniqueNames.holdAndRefuseIfTaken({
      service: data.service,
      column: column,
      projectId: projectId,
      name: name as string,
      exceptId: null,
      props: data.createBy.props,
      numbersTakenName: isNumbersTakenName(data.createBy.miscDataProps),
      writeName: (numbered: string): void => {
        (data.createBy.data as unknown as JSONObject)[column] = numbered;
      },
    });
  }

  /*
   * A rename: refused when another record of its kind in its project has
   * the new name, or when the update would give several records the name,
   * while the project requires unique names. Reads the rows the update
   * writes, and holds the update to them. Hands back the lock that holds
   * the name until the rows are written, or null.
   */
  public static async holdNameOnRename<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<UniqueNameHold> {
    const column: string | null = RequiredUniqueNames.getColumn(data.service);

    if (!column || data.updateBy.props.isRoot) {
      return null;
    }

    const name: unknown = readColumn(data.updateBy.data, column);

    // No name written, or none at all: the column's own checks answer.
    if (!getNameKey(name)) {
      return null;
    }

    const rows: Array<TBaseModel> =
      await data.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        _id: true,
        projectId: true,
        [column]: true,
      } as Select<TBaseModel>);

    // Its own name again, perhaps in another case: no rename.
    const renamed: Array<TBaseModel> = rows.filter(
      (row: TBaseModel): boolean => {
        return getNameKey(readColumn(row, column)) !== getNameKey(name);
      },
    );

    if (renamed.length === 0) {
      return null;
    }

    const projectIds: Array<ObjectID> = [];

    for (const row of renamed) {
      const projectId: ObjectID | null = toObjectId(
        readColumn(row, "projectId"),
      );

      if (
        projectId &&
        !projectIds.some((seen: ObjectID): boolean => {
          return toIdText(seen) === toIdText(projectId);
        })
      ) {
        projectIds.push(projectId);
      }
    }

    const requiredProjectIds: Array<ObjectID> = [];

    for (const projectId of projectIds) {
      if (await RequiredUniqueNames.isRequiredInProject(projectId)) {
        requiredProjectIds.push(projectId);
      }
    }

    if (requiredProjectIds.length === 0) {
      return null;
    }

    // They would share the name the moment it was written.
    if (renamed.length > 1) {
      throw new BadDataException(
        REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
      );
    }

    const row: TBaseModel = renamed[0]!;

    return await RequiredUniqueNames.holdAndRefuseIfTaken({
      service: data.service,
      column: column,
      projectId: requiredProjectIds[0]!,
      name: name as string,
      exceptId: row.id || null,
      props: data.updateBy.props,
      numbersTakenName: isNumbersTakenName(data.updateBy.miscDataProps),
      writeName: (numbered: string): void => {
        (data.updateBy.data as unknown as JSONObject)[column] = numbered;
      },
    });
  }

  /*
   * Gives back a hold holdNameOnCreate or holdNameOnRename handed back.
   * Never throws: a release that fails must neither hide the error a failed
   * write is unwinding nor fail a write that was saved (redis-semaphore
   * stops refreshing the lock before it asks Valkey, so the lock runs out on
   * its own). Giving back nothing does nothing.
   */
  public static async giveBack(
    hold: UniqueNameHold | undefined,
    logAttributes?: LogAttributes,
  ): Promise<void> {
    if (!hold) {
      return;
    }

    try {
      await Semaphore.release(hold);
    } catch (err) {
      logger.error(err, logAttributes);
    }
  }

  /*
   * The lock's key: the kind, the project as Postgres writes its id, and
   * the name as it reads - hashed, so a long name makes no long key.
   */
  public static getLockKey(data: {
    tableName: string;
    projectId: ObjectID;
    name: string;
  }): string {
    const nameHash: string = crypto
      .createHash("sha256")
      .update(getNameKey(data.name))
      .digest("hex");

    return `${data.tableName}:${ProjectLimitLock.getProjectKey(data.projectId)}:${nameHash}`;
  }

  /*
   * Takes the name's lock. Null when it cannot be had - Valkey is
   * unreachable, or another write held it for longer than a write waits -
   * and the write goes ahead without it, still checked.
   */
  public static async takeLock(data: {
    tableName: string;
    projectId: ObjectID;
    name: string;
  }): Promise<UniqueNameHold> {
    try {
      return await Semaphore.lock({
        key: RequiredUniqueNames.getLockKey(data),
        namespace: UNIQUE_NAME_LOCK_NAMESPACE,
      });
    } catch (err) {
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);

      return null;
    }
  }

  /*
   * THE RECORD OF A KIND THAT HAS A NAME IN A PROJECT, looked for as
   * OneUptime: a record the caller may not read holds its name all the
   * same. One in service before an archived one, so a refusal speaks of the
   * one people see. One indexed read (AddUniqueNameIndexes).
   */
  public static async findHolder<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    column: string;
    projectId: ObjectID;
    name: string;
    exceptId: ObjectID | null;
  }): Promise<TBaseModel | null> {
    const query: JSONObject = {
      projectId: data.projectId,
      [data.column]: QueryHelper.findWithSameName(data.name),
    } as unknown as JSONObject;

    if (data.exceptId) {
      query["_id"] = QueryHelper.notEquals(
        data.exceptId.toString(),
      ) as unknown as JSONObject;
    }

    const isArchivable: boolean = data.service
      .getModel()
      .hasColumn(ARCHIVED_COLUMN);

    return await data.service.findOneBy({
      query: query as unknown as Query<TBaseModel>,
      select: {
        _id: true,
        [data.column]: true,
        ...(isArchivable ? { [ARCHIVED_COLUMN]: true } : {}),
      } as Select<TBaseModel>,
      ...(isArchivable
        ? {
            sort: {
              [ARCHIVED_COLUMN]: SortOrder.Ascending,
            } as Sort<TBaseModel>,
          }
        : {}),
      props: {
        isRoot: true,
      },
    });
  }

  // Whether the caller may read a record: only then is it named to them.
  public static async mayRead<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (data.props.isRoot) {
      return true;
    }

    try {
      const record: TBaseModel | null = await data.service.findOneBy({
        query: { _id: data.id.toString() } as unknown as Query<TBaseModel>,
        select: { _id: true } as Select<TBaseModel>,
        props: data.props,
      });

      return Boolean(record);
    } catch {
      // Not allowed to read the kind at all.
      return false;
    }
  }

  /*
   * WHETHER A NAME A FORM HOLDS IS TAKEN, for the Dashboard to warn as it
   * is typed (GET /unique-names/check): the record of the kind that has it,
   * where the reader may read it - or, where saving it would be refused
   * anyway, that a record they may not read has it. Kinds whose names are
   * free to repeat have no answer (getProjectNameRule).
   */
  public static async checkName<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    rule: ProjectNameRule;
    projectId: ObjectID;
    name: string;
    exceptId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<UniqueNameCheckAnswer> {
    const isRequired: boolean =
      data.rule.isAlwaysUnique ||
      (await RequiredUniqueNames.isRequiredInProject(data.projectId));

    if (!getNameKey(data.name)) {
      return { isRequired, takenBy: null, isTakenByUnreadable: false };
    }

    const holder: TBaseModel | null = await RequiredUniqueNames.findHolder({
      service: data.service,
      column: data.rule.column,
      projectId: data.projectId,
      name: data.name,
      exceptId: data.exceptId,
    });

    if (!holder || !holder.id) {
      return { isRequired, takenBy: null, isTakenByUnreadable: false };
    }

    if (
      await RequiredUniqueNames.mayRead({
        service: data.service,
        id: holder.id,
        props: data.props,
      })
    ) {
      return {
        isRequired,
        takenBy: {
          id: holder.id.toString(),
          name: normalizeName(readColumn(holder, data.rule.column)),
          isArchived: readColumn(holder, ARCHIVED_COLUMN) === true,
        },
        isTakenByUnreadable: false,
      };
    }

    return {
      isRequired,
      takenBy: null,
      isTakenByUnreadable: isRequired,
    };
  }

  /*
   * THE NAMES A PROJECT HOLDS MORE THAN ONCE, of one kind (GET
   * /unique-names/duplicates), for Project Settings > Project to list
   * beside Require Unique Names: records named alike before it was on keep
   * their names, valid, until someone renames them.
   *
   * Each group is the records whose names read as one name - in Postgres,
   * both sides read as findWithSameName reads them, archived records
   * included, since they hold their names - found among every record of
   * the kind in the project, as OneUptime; only those the reader may read
   * are listed, with the reader's own permissions, and the group counts the
   * rest. One query for the names, one read of the records the reader may
   * read. Null for a kind with no name held twice, or one the reader may
   * not read at all.
   */
  public static async findDuplicatesOfKind<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DuplicateNamesOfKind | null> {
    const column: string | null = RequiredUniqueNames.getColumn(data.service);
    const tableName: string | null = data.service.getModel().tableName;

    if (!column || !tableName) {
      return null;
    }

    const nameKey: string = getNameKeySql({
      textSql: `"${column}"`,
      patternSql: "$2",
    });

    const rows: Array<{ id: string; nameKey: string; count: string | number }> =
      await data.service
        .getRepository()
        .query(
          `SELECT "id", "nameKey", "count" FROM (SELECT "_id" AS "id", ${nameKey} AS "nameKey", COUNT(*) OVER (PARTITION BY ${nameKey}) AS "count" FROM "${data.service.getRepository().metadata.tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "${column}" IS NOT NULL) AS "named" WHERE "count" > 1 AND "nameKey" <> '' ORDER BY "nameKey", "id"`,
          [data.projectId.toString(), NAME_WHITE_SPACE_RUN_PATTERN],
        );

    if (rows.length === 0) {
      return null;
    }

    // The groups, by the name as it reads, in its order.
    const countByKey: Map<string, number> = new Map<string, number>();
    const idsByKey: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const row of rows) {
      countByKey.set(row.nameKey, Number(row.count) || 0);
      idsByKey.set(row.nameKey, [
        ...(idsByKey.get(row.nameKey) || []),
        toIdText(row.id),
      ]);
    }

    const keys: Array<string> = Array.from(idsByKey.keys());
    const shownKeys: Array<string> = keys.slice(
      0,
      MAX_DUPLICATE_GROUPS_PER_KIND,
    );

    const shownIds: Array<string> = shownKeys.flatMap(
      (key: string): Array<string> => {
        return (idsByKey.get(key) || []).slice(
          0,
          MAX_DUPLICATE_RECORDS_PER_GROUP,
        );
      },
    );

    const isArchivable: boolean = data.service
      .getModel()
      .hasColumn(ARCHIVED_COLUMN);

    let readable: Array<TBaseModel> = [];

    try {
      readable = await data.service.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            shownIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as unknown as Query<TBaseModel>,
        select: {
          _id: true,
          [column]: true,
          createdAt: true,
          ...(isArchivable ? { [ARCHIVED_COLUMN]: true } : {}),
        } as Select<TBaseModel>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });
    } catch {
      // A reader who may not read the kind at all has none of it listed.
      return null;
    }

    const readableById: Map<string, TBaseModel> = new Map<string, TBaseModel>();

    for (const record of readable) {
      readableById.set(toIdText(record.id), record);
    }

    const groups: Array<DuplicateNameGroup> = [];

    for (const key of shownKeys) {
      const records: Array<DuplicateNameRecord> = [];

      for (const id of (idsByKey.get(key) || []).slice(
        0,
        MAX_DUPLICATE_RECORDS_PER_GROUP,
      )) {
        const record: TBaseModel | undefined = readableById.get(id);

        if (!record) {
          continue;
        }

        records.push({
          id: id,
          name: normalizeName(readColumn(record, column)),
          createdAt: toDateText(readColumn(record, "createdAt")),
          isArchived: readColumn(record, ARCHIVED_COLUMN) === true,
        });
      }

      if (records.length === 0) {
        continue;
      }

      groups.push({
        name: records[0]!.name,
        count: countByKey.get(key) || records.length,
        records: records,
      });
    }

    if (groups.length === 0) {
      return null;
    }

    return {
      tableName: tableName,
      pluralName: data.service.getModel().pluralName || tableName,
      groupCount: keys.length,
      groups: groups,
    };
  }

  /*
   * The name's lock, then the refusal if another record has the name; the
   * lock is handed back to hold until the write is done, and given back at
   * once when the name is refused.
   *
   * A name OneUptime picked for the person (numbersTakenName) is numbered
   * rather than refused: "web - High CPU", then "web - High CPU 2" and on,
   * each held and looked for in turn, the first that is free written into
   * the write (writeName) - up to FREE_NAME_ATTEMPTS of them, then refused
   * as any taken name is. Numbered, a name keeps to its column's length and
   * gives up the end of its words, never its number.
   */
  private static async holdAndRefuseIfTaken<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    column: string;
    projectId: ObjectID;
    name: string;
    exceptId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
    numbersTakenName?: boolean | undefined;
    writeName?: ((name: string) => void) | undefined;
  }): Promise<UniqueNameHold> {
    const attempts: number = data.numbersTakenName ? FREE_NAME_ATTEMPTS : 1;

    const columnType: TableColumnType | undefined = data.service
      .getModel()
      .getTableColumnMetadata(data.column)?.type;

    const maxLength: number | undefined = columnType
      ? getMaxLengthFromTableColumnType(columnType)
      : undefined;

    for (let number: number = 1; ; number++) {
      const name: string = getNumberedName({
        name: data.name,
        number: number,
        maxLength: maxLength,
      });

      const hold: UniqueNameHold = await RequiredUniqueNames.takeLock({
        tableName: data.service.getModel().tableName || "",
        projectId: data.projectId,
        name: name,
      });

      try {
        await RequiredUniqueNames.refuseIfTaken({ ...data, name: name });
      } catch (error) {
        await RequiredUniqueNames.giveBack(hold, {
          projectId: data.projectId.toString(),
        } as LogAttributes);

        if (number >= attempts || !(error instanceof NameTakenException)) {
          throw error;
        }

        continue;
      }

      if (number > 1) {
        data.writeName?.(name);
      }

      return hold;
    }
  }

  /*
   * Refuses the name when another record of the kind in the project has
   * it: in the words of a record in service, or of an archived one, with
   * the code a program tells them by - naming the other record, with its
   * id, to a caller who may read it.
   */
  private static async refuseIfTaken<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    column: string;
    projectId: ObjectID;
    name: string;
    exceptId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const holder: TBaseModel | null =
      await RequiredUniqueNames.findHolder(data);

    if (!holder) {
      return;
    }

    const isArchived: boolean = readColumn(holder, ARCHIVED_COLUMN) === true;

    const isReadable: boolean = holder.id
      ? await RequiredUniqueNames.mayRead({
          service: data.service,
          id: holder.id,
          props: data.props,
        })
      : false;

    throw new NameTakenException(
      getRequiredUniqueNameTakenRefusal({
        kindLabel:
          data.service.getModel().singularName ||
          data.service.getModel().tableName ||
          "record",
        name: isReadable ? readColumn(holder, data.column) : data.name,
        isArchived: isArchived,
      }),
      {
        isArchived: isArchived,
        ...(isReadable && holder.id ? { id: holder.id.toString() } : {}),
      },
    );
  }
}
