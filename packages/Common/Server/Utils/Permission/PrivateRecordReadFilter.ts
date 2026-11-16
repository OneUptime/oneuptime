import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import Text from "../../../Types/Text";
import PrivateRecordPermission, {
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../Types/Database/Permissions/PrivateRecordPermission";
import {
  combineWithPrivacyClause,
  shouldBypassRecordPrivacy,
} from "../PrivacyFilterUtil";
import { Raw } from "typeorm";

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
 */
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
   * key. Deleting a private record deletes the pages and logs about it with
   * it; a runbook run or a fix linked to it outlives it, naming no record.
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
}
