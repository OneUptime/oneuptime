import type DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import UpdateBy from "../../Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { RefusalWithValues } from "../../../Types/Exception/RefusalWithValues";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  NAME_WHITE_SPACE_RUN_PATTERN,
  getNameKey,
  getNameKeySql,
  getNameTakenRefusalText,
  normalizeName,
} from "../../../Types/Database/UniqueName";

/*
 * A NAME ONE OF ITS KIND IN ITS PROJECT, ON A CREATE AND ON A RENAME
 * (#9674, Types/Database/UniqueName).
 *
 * Run by a service from its unique-check hooks (onBeforeCreateUniqueCheck,
 * onBeforeUpdateUniqueCheck): once the caller may make the write, so the
 * refusal may say the name is taken - the caller may create or rename the
 * record, and the name is the one they wrote.
 *
 *   - A new record is refused a name another record of its project has.
 *   - A rename is refused one too. A write that gives a record its own name
 *     again - an edit of its description sends the name it has, or the same
 *     name in another case - is no rename, and is never refused: two
 *     records that already share a name, from before names were held to one
 *     record each, can still be edited, and renamed apart.
 *   - One update that would give several records the name is refused: they
 *     would share it the moment it was made.
 *
 * The other record is looked for as OneUptime (isRoot): one the caller may
 * not read - kept from them by labels or ownership - holds its name all the
 * same, and a count that could not see it would let the clash through. The
 * refusal never says anything of it but that the name is taken.
 *
 * OneUptime's own writes are trusted, as ArchivableValueGuard trusts them:
 * SCIM's groups, which the identity provider names and matches by name, and
 * a new project's own teams. A check before a write is no lock: two writes
 * of one name at the same moment can still both land. No unique index
 * closes that, because projects made before #9674 may already hold names
 * twice, and an index could not be built over them.
 */

export interface UniqueNameRules<TBaseModel extends BaseModel> {
  service: DatabaseService<TBaseModel>;
  // The refusal of a name another record has, with the name in it.
  takenRefusal: RefusalWithValues;
  // The refusal of one update that would give several records one name.
  renamedTogetherRefusal: string;
  /*
   * Columns of the other record a kind's own refusal reads, and that
   * refusal: an archived label's name says where to unarchive it. Null
   * leaves the kind's takenRefusal.
   */
  clashSelect?: Select<TBaseModel> | undefined;
  describeClash?:
    | ((data: { clash: TBaseModel; name: string }) => string | null)
    | undefined;
  /*
   * Which of several records with the name the refusal speaks of: a policy
   * in service before an archived one, whose refusal says to unarchive it.
   */
  clashSort?: Sort<TBaseModel> | undefined;
}

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

const toProjectId: (value: unknown) => ObjectID | null = (
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

export default class UniqueNameInProject {
  // A new record's name, refused when another record of its project has it.
  public static async refuseCreateClash<TBaseModel extends BaseModel>(data: {
    rules: UniqueNameRules<TBaseModel>;
    createBy: CreateBy<TBaseModel>;
  }): Promise<void> {
    if (data.createBy.props.isRoot) {
      return;
    }

    const name: unknown = readColumn(data.createBy.data, "name");

    // No name is the required check's to answer.
    if (!getNameKey(name)) {
      return;
    }

    const projectId: ObjectID | null =
      toProjectId(readColumn(data.createBy.data, "projectId")) ||
      data.createBy.props.tenantId ||
      null;

    if (!projectId) {
      return;
    }

    await UniqueNameInProject.refuseIfTaken({
      rules: data.rules,
      projectId: projectId,
      name: name as string,
      exceptId: null,
    });
  }

  /*
   * A rename, refused when another record of its project has the new name,
   * or when it would give several records the name. Reads the records the
   * update writes, and holds the update to them.
   */
  public static async refuseRenameClash<TBaseModel extends BaseModel>(data: {
    rules: UniqueNameRules<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<void> {
    if (data.updateBy.props.isRoot) {
      return;
    }

    const name: unknown = readColumn(data.updateBy.data, "name");

    // No name written, or none at all: the column's own checks answer.
    if (!getNameKey(name)) {
      return;
    }

    const rows: Array<TBaseModel> =
      await data.rules.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        _id: true,
        projectId: true,
        name: true,
      } as Select<TBaseModel>);

    const renamed: Array<TBaseModel> = rows.filter(
      (row: TBaseModel): boolean => {
        return getNameKey(readColumn(row, "name")) !== getNameKey(name);
      },
    );

    // Its own name again, perhaps in another case: no rename.
    if (renamed.length === 0) {
      return;
    }

    if (renamed.length > 1) {
      throw new BadDataException(data.rules.renamedTogetherRefusal);
    }

    const row: TBaseModel = renamed[0]!;
    const projectId: ObjectID | null = toProjectId(
      readColumn(row, "projectId"),
    );

    if (!projectId) {
      return;
    }

    await UniqueNameInProject.refuseIfTaken({
      rules: data.rules,
      projectId: projectId,
      name: name as string,
      exceptId: row.id || null,
    });
  }

  /*
   * THE RECORDS OF A PROJECT THAT SHARE A NAME (#9746), for its list to
   * mark them: records made before names were held to one record each keep
   * their names, and nothing told an admin which ones a picker would draw
   * alike.
   *
   * Each group is the records whose names read as one name - as the rule
   * compares them, in Postgres, both sides read as findWithSameName reads
   * them - and only those the reader may read, with the reader's own
   * permissions. A group is found among every record of the project, as
   * OneUptime, as the rule counts them: a record the reader may read can
   * share its name with one they may not, which a rename onto that name
   * would say anyway. A list's page holds only some of a project's records,
   * so this reads the project, not the page: one query, its rows counted
   * by their name, and one read of the ones that share it.
   */
  public static async findRecordsSharingName<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    projectId: ObjectID;
    // The reader's own: the records of each group they may read.
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<Array<string>>> {
    const nameKey: string = getNameKeySql({
      textSql: `"name"`,
      patternSql: "$2",
    });

    const rows: Array<{ id: string; nameKey: string }> = await data.service
      .getRepository()
      .query(
        `SELECT "id", "nameKey" FROM (SELECT "_id" AS "id", ${nameKey} AS "nameKey", COUNT(*) OVER (PARTITION BY ${nameKey}) AS "count" FROM "${data.service.getRepository().metadata.tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL) AS "named" WHERE "count" > 1 ORDER BY "nameKey", "id"`,
        [data.projectId.toString(), NAME_WHITE_SPACE_RUN_PATTERN],
      );

    if (rows.length === 0) {
      return [];
    }

    const readable: Array<TBaseModel> = await data.service.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          rows.map((row: { id: string }): ObjectID => {
            return new ObjectID(row.id.toString());
          }),
        ),
      } as unknown as Query<TBaseModel>,
      select: { _id: true } as Select<TBaseModel>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: data.props,
    });

    const readableIds: Set<string> = new Set<string>(
      readable.map((record: TBaseModel): string => {
        return (record.id?.toString() || "").toLowerCase();
      }),
    );

    const groups: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const row of rows) {
      const id: string = row.id.toString().toLowerCase();

      if (!readableIds.has(id)) {
        continue;
      }

      groups.set(row.nameKey, [...(groups.get(row.nameKey) || []), id]);
    }

    return Array.from(groups.values());
  }

  private static async refuseIfTaken<TBaseModel extends BaseModel>(data: {
    rules: UniqueNameRules<TBaseModel>;
    projectId: ObjectID;
    name: string;
    exceptId: ObjectID | null;
  }): Promise<void> {
    const query: JSONObject = {
      projectId: data.projectId,
      name: QueryHelper.findWithSameName(data.name),
    } as unknown as JSONObject;

    if (data.exceptId) {
      query["_id"] = QueryHelper.notEquals(
        data.exceptId.toString(),
      ) as unknown as JSONObject;
    }

    const clash: TBaseModel | null = await data.rules.service.findOneBy({
      query: query as unknown as Query<TBaseModel>,
      select: {
        ...(data.rules.clashSelect || {}),
        _id: true,
      } as Select<TBaseModel>,
      ...(data.rules.clashSort ? { sort: data.rules.clashSort } : {}),
      props: {
        isRoot: true,
      },
    });

    if (!clash) {
      return;
    }

    const described: string | null = data.rules.describeClash
      ? data.rules.describeClash({
          clash: clash,
          name: normalizeName(data.name),
        })
      : null;

    throw new BadDataException(
      described || getNameTakenRefusalText(data.rules.takenRefusal, data.name),
    );
  }
}
