import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";

/*
 * THE RELATIONS A LINKEDTO FILTER READS THROUGH A TABLE OF THEIR OWN
 * (#11211).
 *
 * LinkedTo follows a record's own relations: a join table TypeORM knows
 * (an incident's monitors), or a column naming one record (an alert's
 * monitorId). A team's members are neither: each is a row of TeamMember,
 * which names the team and the person, so the Teams list's Member chip
 * read the teams of the people picked first - the first 10,000
 * memberships - and filtered the list by those ids. Named here, such a
 * relation is one LinkedTo answers like any other, inside the list's own
 * query (QueryUtil.getLinkedToCondition, QueryHelper.linkedThroughTable):
 *
 *   { linkedTo: new LinkedTo({ relations: { members: [userIds] } }) }
 *
 * on a list of teams matches the teams one of those people is in; NoneOf,
 * the teams none of them is in - a team with nobody in it among them.
 *
 * Filtering through one reads the link table: it is held to that table's
 * read and to the read of the two columns it compares, never through
 * CurrentUser alone, which reads only the caller's own rows of it
 * (QueryPermission.checkLinkTableRelationPermission). A relation named
 * here is not a column of the record, so it can never be selected, sorted
 * by, or filtered as anything but a LinkedTo.
 */
export interface LinkTableRelation {
  // The table whose rows link a record to another (TeamMember).
  modelType: { new (): BaseModel };
  // Its column naming the record the filter lists (TeamMember.teamId).
  recordColumnName: string;
  // Its column naming what the record is linked to (TeamMember.userId).
  linkedColumnName: string;
}

interface LinkTableRelationEntry extends LinkTableRelation {
  // The kind of record the relation is of.
  recordModelType: { new (): BaseModel };
  // What LinkedTo calls it.
  relation: string;
}

const LINK_TABLE_RELATIONS: ReadonlyArray<LinkTableRelationEntry> = [
  {
    // The people in a team.
    recordModelType: Team,
    relation: "members",
    modelType: TeamMember,
    recordColumnName: "teamId",
    linkedColumnName: "userId",
  },
];

export default class LinkedToLinkTables {
  /*
   * The link table `relation` of `modelType`'s records is kept in, or null
   * when it is none: a column of the record, or nothing at all.
   */
  public static get(
    modelType: { new (): BaseModel },
    relation: string,
  ): LinkTableRelation | null {
    const entry: LinkTableRelationEntry | undefined = LINK_TABLE_RELATIONS.find(
      (candidate: LinkTableRelationEntry): boolean => {
        return (
          candidate.relation === relation &&
          LinkedToLinkTables.isSameKind(candidate.recordModelType, modelType)
        );
      },
    );

    if (!entry) {
      return null;
    }

    return {
      modelType: entry.modelType,
      recordColumnName: entry.recordColumnName,
      linkedColumnName: entry.linkedColumnName,
    };
  }

  // Every relation kept in a link table, with the kind it is of.
  public static getAll(): Array<
    LinkTableRelation & {
      recordModelType: { new (): BaseModel };
      relation: string;
    }
  > {
    return LINK_TABLE_RELATIONS.map(
      (
        entry: LinkTableRelationEntry,
      ): LinkTableRelation & {
        recordModelType: { new (): BaseModel };
        relation: string;
      } => {
        return { ...entry };
      },
    );
  }

  /*
   * Whether two model classes are the same kind of record: the same class,
   * or (a copy of the class loaded twice) the same table.
   */
  private static isSameKind(
    a: { new (): BaseModel },
    b: { new (): BaseModel },
  ): boolean {
    if (a === b) {
      return true;
    }

    const aTable: string | null | undefined = new a().tableName;

    return Boolean(aTable) && aTable === new b().tableName;
  }
}
