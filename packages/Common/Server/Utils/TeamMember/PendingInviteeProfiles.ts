import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import { FindBuilderAdjuster } from "../../Infrastructure/Postgres/PagedFind";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Text from "../../../Types/Text";
import UserType from "../../../Types/UserType";
import {
  DataSource,
  ObjectLiteral,
  OrderByCondition,
  Raw,
  SelectQueryBuilder,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { Alias } from "typeorm/query-builder/Alias";

/*
 * ---------------------------------------------------------------------------
 * A PERSON'S OWN PROFILE IS NOT A PROJECT'S TO SEE UNTIL THEY JOIN IT (#9823).
 *
 * Inviting an address used to show the inviting project the profile of the
 * account the address already had: its name, its picture, whether it had
 * two-factor authentication on, and when it was made and last changed - an
 * account the invitation made had none of them. So an invitation told the
 * inviter whether the address had an account, and more, before the person
 * had said anything. Anyone may make a project on OneUptime Cloud.
 *
 * Now, until someone accepts, a project sees only what it invited: the
 * address, and the name the inviter typed (TeamMember.inviteeName). Once
 * they accept, it sees their profile as it sees any member's.
 *
 * WHO SEES WHOSE PROFILE. A person's name, picture and two-factor flag,
 * read through a relation (a membership's `user`, a record's owner, its
 * creator...), are withheld from a reader when the person is invited to one
 * of the reader's projects and has accepted none of them - "pending" for
 * this reader. The reader's projects are those they have a membership in, an
 * invitation included; an API key's or a workflow's, its own project. In
 * their place the reader gets the name typed with the invitation, or none.
 * Never withheld: from the person themselves, from OneUptime's own reads
 * (root), and from a master admin, who sees every account in the Admin
 * Dashboard. Someone who has accepted a project of the reader's is no
 * stranger to the reader, and someone with no membership in their projects
 * at all - who left one, say - keeps the name history shows them by.
 *
 * A run of OneUptime's own made for the readers of a subject - an AI
 * investigation, a fix, a security case's triage (ReadAudience, #9576) -
 * reads as root, but writes for everyone who may see the subject: its
 * report goes to the subject's feed and channels, and OneUptime AI repeats
 * what it read to whoever asks. So it reads people as its project does
 * (#9934): someone only invited there by the name typed for them, else
 * none.
 *
 * Asked where a read can reveal it:
 *
 *   - What a read returns (withholdFromRows), in every read of the CRUD
 *     path (DatabaseService), after the permission checks: one query of
 *     the memberships of the people the rows name.
 *   - What a read is filtered by (narrowRelationFilters): a filter through
 *     a relation on a person's name, picture or two-factor flag matches no
 *     pending person, so a search cannot spell out a name a page withholds.
 *     Pending people are found by their address, and by the name typed
 *     for them (ProjectMemberSearch).
 *   - What a read is ordered by (orderAsTheReaderSees, #9895): an order
 *     through a relation by a person's name, picture or two-factor flag
 *     orders someone pending by what their row shows - the name typed for
 *     them, else their address; no picture and no flag - so where they
 *     fall among the other rows says nothing of their account. The Users
 *     list sorted by its User column, a team's members, every list of
 *     owners or on-call people, a record by who created it: every read of
 *     the CRUD path (DatabaseService, through PagedFind).
 *   - What a filter or an order through a relation may name of a person at
 *     all (QueryPermission.canReadRelatedColumn): only what any reader of
 *     the relation may read (their name, address, picture and two-factor
 *     flag), never a column only the person reads - their language, time
 *     zone, company, phone, whether their address is verified.
 *   - A person's account dates - created, last changed (which moves with
 *     their activity), deleted, and the row's version - are their own:
 *     withheld from every reader but the person, OneUptime and a master
 *     admin, and never a filter or an order through a relation
 *     (assertMayReadThroughRelation).
 *   - Their picture is served by UserAPI by the same rule, by person:
 *     only to a reader who shares a project the person has joined.
 * ---------------------------------------------------------------------------
 */

// The table every person's account is in.
export const USER_TABLE_NAME: string = "User";

/*
 * What a project sees of a person only once they have joined it: their
 * name, their picture and whether they turned on two-factor authentication.
 * Their address is not here: the project typed it.
 */
export const PROFILE_COLUMNS_SHOWN_ONCE_JOINED: ReadonlyArray<string> = [
  "name",
  "profilePictureId",
  "twoFactorAuthEnabled",
];

/*
 * A person's account dates: when it was made, last changed (which moves
 * with their activity), deleted, and how often it was written. Their own.
 */
export const ACCOUNT_DATE_COLUMNS: ReadonlyArray<string> = [
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

// What a refused filter or order through a relation by account dates says.
export const ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE: string =
  "A person's account dates are theirs, so a list cannot be filtered or ordered by them. Filter or order by the record's own dates instead.";

/*
 * Who reads: a person, whose projects are those they have a membership in
 * (an invitation included); or a project - an API key's, a workflow's, its
 * audit log's - whose one project is itself. Ids lower-cased.
 */
export type ProfileReader = { userId: string } | { projectId: string };

// A person whose profile this reader does not see, and what they see instead.
export interface WithheldProfile {
  // The name typed when they were invited, or null for none.
  inviteeName: string | null;
}

/*
 * A person's profile column an order names through a relation: the join's
 * alias, the column, and the person's address and id beside it.
 */
export interface OrderedProfileColumn {
  aliasName: string;
  propertyPath: string;
  columnName: string;
  emailColumnName: string;
  idColumnName: string;
}

// One pending membership of a person, as the query below reads it.
interface PendingMembershipRow {
  userId: string;
  projectId: string;
  inviteeName: string | null;
  createdAt: Date | string | null;
}

export default class PendingInviteeProfiles {
  /*
   * OneUptime's own reads and a master admin's see every profile - but not
   * a run of OneUptime's own made for the readers of a subject (see the
   * top of this file), which reads as its project does.
   */
  public static seesEveryProfile(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (PendingInviteeProfiles.getAudienceProjectId(props)) {
      return false;
    }

    return Boolean(props.isRoot || props.isMasterAdmin);
  }

  /*
   * The project a run of OneUptime's own reads for, lower-cased, when it
   * reads for the readers of a subject (ReadAudience: only ever on root
   * props, as ReadAudiencePermission.getAudience reads it); null for any
   * other read.
   */
  public static getAudienceProjectId(
    props: DatabaseCommonInteractionProps,
  ): string | null {
    if (!props.isRoot || !props.readAudience) {
      return null;
    }

    const projectId: string = String(
      props.readAudience.projectId || "",
    ).toLowerCase();

    return ObjectID.isValidUUID(projectId) ? projectId : null;
  }

  // Whether a model is a person's account, by its table.
  public static isUserModel(
    modelType: { new (): BaseModel } | undefined | null,
  ): boolean {
    if (!modelType) {
      return false;
    }

    return new modelType().tableName === USER_TABLE_NAME;
  }

  /*
   * The reader's own id, lower-cased, when the reader is a person: never
   * for an API key, a workflow or a public page, which are nobody.
   */
  public static getReaderUserId(
    props: DatabaseCommonInteractionProps,
  ): string | null {
    // A run for a subject's readers writes for all of them: nobody in particular.
    if (
      props.userType === UserType.API ||
      props.userType === UserType.Workflow ||
      props.userType === UserType.Public ||
      PendingInviteeProfiles.getAudienceProjectId(props)
    ) {
      return null;
    }

    const userId: string | undefined = props.userId?.toString();

    return userId && ObjectID.isValidUUID(userId) ? userId.toLowerCase() : null;
  }

  /*
   * The project a read is in, lower-cased: the one an API key or a
   * workflow reads in, and the one a person's request names, if any.
   */
  private static getReaderProjectId(
    props: DatabaseCommonInteractionProps,
  ): string | null {
    const audienceProjectId: string | null =
      PendingInviteeProfiles.getAudienceProjectId(props);

    if (audienceProjectId) {
      return audienceProjectId;
    }

    const projectId: string | undefined = props.tenantId?.toString();

    return projectId && ObjectID.isValidUUID(projectId)
      ? projectId.toLowerCase()
      : null;
  }

  /*
   * Who reads, as the rule asks it: a person, whose projects are those they
   * have a membership in; or a project - an API key's, a workflow's, the
   * audit log's - which is its own one project. Null for a reader the rule
   * cannot be asked about (nobody, and no project).
   */
  public static getReader(
    props: DatabaseCommonInteractionProps,
  ): ProfileReader | null {
    const userId: string | null = PendingInviteeProfiles.getReaderUserId(props);

    if (userId) {
      return { userId: userId };
    }

    const projectId: string | null =
      PendingInviteeProfiles.getReaderProjectId(props);

    return projectId ? { projectId: projectId } : null;
  }

  /*
   * Of `userIds`, the people pending for this reader (see the top of this
   * file), each with the name typed for them: from an invitation in the
   * request's project first, else the newest invitation that has one. The
   * reader themselves is never among them. Empty for a reader who sees
   * every profile, or who has no projects to ask about.
   */
  public static async readWithheldProfiles(data: {
    userIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, WithheldProfile>> {
    const reader: ProfileReader | null =
      PendingInviteeProfiles.seesEveryProfile(data.props)
        ? null
        : PendingInviteeProfiles.getReader(data.props);

    if (!reader) {
      return new Map<string, WithheldProfile>();
    }

    return await PendingInviteeProfiles.readWithheldProfilesFor({
      userIds: data.userIds,
      reader: reader,
      preferredProjectId: PendingInviteeProfiles.getReaderProjectId(data.props),
    });
  }

  /*
   * The same, for one project as the reader: who of `userIds` is only
   * invited to it, with the name typed for them - what an entry of its
   * audit log names such a person by.
   */
  public static async readWithheldProfilesInProject(data: {
    userIds: Array<string>;
    projectId: ObjectID;
  }): Promise<Map<string, WithheldProfile>> {
    const projectId: string = data.projectId.toString().toLowerCase();

    if (!ObjectID.isValidUUID(projectId)) {
      return new Map<string, WithheldProfile>();
    }

    return await PendingInviteeProfiles.readWithheldProfilesFor({
      userIds: data.userIds,
      reader: { projectId: projectId },
      preferredProjectId: projectId,
    });
  }

  /*
   * WHAT A PROJECT CALLS SOMEONE ONEUPTIME READ FOR IT. A read as OneUptime
   * (root) passes by withholdFromRows, so code that reads people that way
   * and names them where the project's people read it - a page, a feed, a
   * message about them to somebody else - names them by this, with
   * `withheld` the project's pending people (readWithheldProfilesInProject,
   * read once for them all): someone only invited by the name typed for
   * them, else their address, never their account's own name; anyone else
   * by their name, else their address. Empty when there is neither.
   */
  public static getNameInProject(data: {
    userId: ObjectID | string | null | undefined;
    name: Name | string | null | undefined;
    email: Email | string | null | undefined;
    withheld: Map<string, WithheldProfile>;
  }): string {
    const email: string = data.email?.toString().trim() || "";
    const profile: WithheldProfile | undefined =
      PendingInviteeProfiles.getWithheldProfile({
        userId: data.userId,
        withheld: data.withheld,
      });

    if (profile) {
      return profile.inviteeName?.trim() || email;
    }

    return data.name?.toString().trim() || email;
  }

  /*
   * People read as OneUptime, named in place as `projectId` names them -
   * for code that hands the users it read on to what writes their names,
   * such as "Removed **Ada** (ada@example.com) as an owner": someone only
   * invited to the project by the name typed for them, else their address,
   * and with no picture; anyone else as read. One read for them all.
   */
  public static async nameInProject(data: {
    users: Array<User | null | undefined>;
    projectId: ObjectID;
  }): Promise<void> {
    const users: Array<User> = data.users.filter(
      (user: User | null | undefined): user is User => {
        return Boolean(user);
      },
    );

    if (users.length === 0) {
      return;
    }

    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: users
          .map((user: User): string => {
            return user.id?.toString() || "";
          })
          .filter((userId: string): boolean => {
            return Boolean(userId);
          }),
        projectId: data.projectId,
      });

    for (const user of users) {
      if (
        !PendingInviteeProfiles.getWithheldProfile({
          userId: user.id,
          withheld: withheld,
        })
      ) {
        continue;
      }

      const name: string = PendingInviteeProfiles.getNameInProject({
        userId: user.id,
        name: null,
        email: user.email,
        withheld: withheld,
      });

      const values: Record<string, unknown> = user as unknown as Record<
        string,
        unknown
      >;

      values["name"] = name ? new Name(name) : undefined;

      if ("profilePictureId" in values) {
        values["profilePictureId"] = undefined;
      }
    }
  }

  /*
   * The person's entry in `withheld` (readWithheldProfilesInProject): set
   * when the project sees neither their name nor their picture.
   */
  public static getWithheldProfile(data: {
    userId: ObjectID | string | null | undefined;
    withheld: Map<string, WithheldProfile>;
  }): WithheldProfile | undefined {
    if (!data.userId) {
      return undefined;
    }

    return data.withheld.get(data.userId.toString().toLowerCase());
  }

  private static async readWithheldProfilesFor(data: {
    userIds: Array<string>;
    reader: ProfileReader;
    preferredProjectId: string | null;
  }): Promise<Map<string, WithheldProfile>> {
    const withheld: Map<string, WithheldProfile> = new Map<
      string,
      WithheldProfile
    >();

    const readerUserId: string | null =
      "userId" in data.reader ? data.reader.userId : null;

    const userIds: Array<string> = Array.from(
      new Set<string>(
        data.userIds
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id) && id !== readerUserId;
          }),
      ),
    );

    if (userIds.length === 0) {
      return withheld;
    }

    const rows: Array<PendingMembershipRow> =
      await PendingInviteeProfiles.readPendingMemberships({
        userIds: userIds,
        reader: data.reader,
      });

    const tenantId: string | null = data.preferredProjectId;

    // Each person's invitations, the request's project first, then newest.
    const byUser: Map<string, Array<PendingMembershipRow>> = new Map();

    for (const row of rows) {
      const userId: string = String(row.userId).toLowerCase();
      const list: Array<PendingMembershipRow> = byUser.get(userId) || [];
      list.push(row);
      byUser.set(userId, list);
    }

    for (const [userId, memberships] of byUser.entries()) {
      const ordered: Array<PendingMembershipRow> = [...memberships].sort(
        (a: PendingMembershipRow, b: PendingMembershipRow): number => {
          const aInRequest: number =
            tenantId && String(a.projectId).toLowerCase() === tenantId ? 1 : 0;
          const bInRequest: number =
            tenantId && String(b.projectId).toLowerCase() === tenantId ? 1 : 0;

          if (aInRequest !== bInRequest) {
            return bInRequest - aInRequest;
          }

          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          );
        },
      );

      const named: PendingMembershipRow | undefined = ordered.find(
        (row: PendingMembershipRow): boolean => {
          return Boolean(row.inviteeName && row.inviteeName.trim());
        },
      );

      withheld.set(userId, {
        inviteeName: named?.inviteeName?.trim() || null,
      });
    }

    return withheld;
  }

  /*
   * The reader's pending people among `userIds`: their invitations in the
   * reader's projects, for those who have joined none of those projects.
   * One query. The read this follows went to the same database, so a
   * database that cannot be asked means no read happened - outside a test,
   * which reads without one, and is answered with nobody.
   */
  public static async readPendingMemberships(data: {
    userIds: Array<string>;
    reader: ProfileReader;
  }): Promise<Array<PendingMembershipRow>> {
    const dataSource: DataSource | null = PostgresAppInstance.isConnected()
      ? PostgresAppInstance.getDataSource()
      : null;

    if (!dataSource) {
      return [];
    }

    return (await dataSource.query(
      PendingInviteeProfiles.getPendingMembershipsStatement(data.reader),
      [
        data.userIds,
        "userId" in data.reader ? data.reader.userId : data.reader.projectId,
      ],
    )) as Array<PendingMembershipRow>;
  }

  /*
   * The query readPendingMemberships asks, with $1 the people and $2 the
   * reader: a person's id, or a project's.
   */
  public static getPendingMembershipsStatement(reader: ProfileReader): string {
    const readerProjects: string =
      "userId" in reader
        ? `SELECT "readerMembership"."projectId" FROM "TeamMember" "readerMembership" WHERE "readerMembership"."userId" = $2 AND "readerMembership"."deletedAt" IS NULL`
        : `$2::uuid`;

    return `SELECT "pending"."userId" AS "userId", "pending"."projectId" AS "projectId", "pending"."inviteeName" AS "inviteeName", "pending"."createdAt" AS "createdAt" FROM "TeamMember" "pending" WHERE "pending"."userId" = ANY($1::uuid[]) AND "pending"."hasAcceptedInvitation" = false AND "pending"."deletedAt" IS NULL AND "pending"."projectId" IN (${readerProjects}) AND NOT EXISTS (SELECT 1 FROM "TeamMember" "accepted" WHERE "accepted"."userId" = "pending"."userId" AND "accepted"."hasAcceptedInvitation" = true AND "accepted"."deletedAt" IS NULL AND "accepted"."projectId" IN (${readerProjects}))`;
  }

  /*
   * The relations a select reads a person's account through, past their
   * id: a membership's `user`, a record's creator, its owners...
   */
  public static getUserRelationsRead(data: {
    modelType: { new (): BaseModel };
    select: unknown;
  }): Array<string> {
    if (!PendingInviteeProfiles.isPlainObject(data.select)) {
      return [];
    }

    const model: BaseModel = new data.modelType();
    const select: Record<string, unknown> = data.select as Record<
      string,
      unknown
    >;
    const relations: Array<string> = [];

    for (const key of Object.keys(select)) {
      const relationSelect: unknown = select[key];

      if (!PendingInviteeProfiles.isPlainObject(relationSelect)) {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        PendingInviteeProfiles.getColumnMetadata(model, key);

      if (
        !metadata ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray) ||
        !PendingInviteeProfiles.isUserModel(
          metadata.modelType as { new (): BaseModel } | undefined,
        )
      ) {
        continue;
      }

      const readsBeyondId: boolean = Object.keys(
        relationSelect as Record<string, unknown>,
      ).some((column: string): boolean => {
        return (
          column !== "_id" &&
          Boolean((relationSelect as Record<string, unknown>)[column])
        );
      });

      if (readsBeyondId) {
        relations.push(key);
      }
    }

    return relations;
  }

  /*
   * WHAT A READ RETURNS: every person its rows name through a relation,
   * as this reader may see them (see the top of this file). In place.
   */
  public static async withholdFromRows(data: {
    modelType: { new (): BaseModel };
    rows: Array<BaseModel>;
    select: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (
      data.rows.length === 0 ||
      PendingInviteeProfiles.seesEveryProfile(data.props)
    ) {
      return;
    }

    const relations: Array<string> =
      PendingInviteeProfiles.getUserRelationsRead({
        modelType: data.modelType,
        select: data.select,
      });

    if (relations.length === 0) {
      return;
    }

    const people: Array<Record<string, unknown>> = [];

    for (const row of data.rows) {
      const values: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;

      for (const relation of relations) {
        const value: unknown = values[relation];

        for (const person of Array.isArray(value) ? value : [value]) {
          if (person && typeof person === "object") {
            people.push(person as Record<string, unknown>);
          }
        }
      }
    }

    if (people.length === 0) {
      return;
    }

    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfiles({
        userIds: people
          .map((person: Record<string, unknown>): string | null => {
            return PendingInviteeProfiles.getId(person);
          })
          .filter((id: string | null): id is string => {
            return Boolean(id);
          }),
        props: data.props,
      });

    const readerUserId: string | null = PendingInviteeProfiles.getReaderUserId(
      data.props,
    );

    for (const person of people) {
      PendingInviteeProfiles.withholdFromPerson({
        person: person,
        readerUserId: readerUserId,
        withheld: withheld,
      });
    }
  }

  /*
   * One person read through a relation, as this reader may see them: their
   * account dates are theirs alone, and someone pending for the reader
   * shows the name typed for them, or none, and no picture or two-factor
   * flag.
   */
  public static withholdFromPerson(data: {
    person: Record<string, unknown>;
    readerUserId: string | null;
    withheld: Map<string, WithheldProfile>;
  }): void {
    const id: string | null = PendingInviteeProfiles.getId(data.person);

    if (id && id === data.readerUserId) {
      return;
    }

    for (const column of ACCOUNT_DATE_COLUMNS) {
      if (column in data.person) {
        data.person[column] = undefined;
      }
    }

    const profile: WithheldProfile | undefined = id
      ? data.withheld.get(id)
      : undefined;

    if (!profile) {
      return;
    }

    if ("name" in data.person) {
      data.person["name"] = profile.inviteeName
        ? new Name(profile.inviteeName)
        : undefined;
    }

    for (const column of PROFILE_COLUMNS_SHOWN_ONCE_JOINED) {
      if (column !== "name" && column in data.person) {
        data.person[column] = undefined;
      }
    }
  }

  /*
   * WHAT A READ IS FILTERED BY: a filter through a relation to a person, on
   * their name, picture or two-factor flag, also asks that the person is no
   * one pending for this reader - else a search could spell out, a letter at
   * a time, a name the rows withhold. A filter a level deeper is narrowed
   * the same way. The query is copied where it changes, never written to.
   */
  public static narrowRelationFilters<TQuery>(data: {
    modelType: { new (): BaseModel };
    query: TQuery;
    props: DatabaseCommonInteractionProps;
  }): TQuery {
    if (
      PendingInviteeProfiles.seesEveryProfile(data.props) ||
      !PendingInviteeProfiles.getReader(data.props)
    ) {
      return data.query;
    }

    const model: BaseModel = new data.modelType();

    // A read across projects is one query per project, any of which may match.
    if (Array.isArray(data.query)) {
      return data.query.map((each: unknown): unknown => {
        return PendingInviteeProfiles.isPlainObject(each)
          ? PendingInviteeProfiles.narrowFilter(
              model,
              each as Record<string, unknown>,
              data.props,
            )
          : each;
      }) as unknown as TQuery;
    }

    if (!PendingInviteeProfiles.isPlainObject(data.query)) {
      return data.query;
    }

    return PendingInviteeProfiles.narrowFilter(
      model,
      data.query as unknown as Record<string, unknown>,
      data.props,
    ) as unknown as TQuery;
  }

  private static narrowFilter(
    model: BaseModel,
    filter: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Record<string, unknown> {
    let narrowed: Record<string, unknown> = filter;

    for (const key of Object.keys(filter)) {
      const metadata: TableColumnMetadata | undefined =
        PendingInviteeProfiles.getColumnMetadata(model, key);

      if (
        !metadata ||
        !metadata.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const value: unknown = filter[key];
      const relatedModelType: { new (): BaseModel } =
        metadata.modelType as unknown as { new (): BaseModel };
      const isPerson: boolean =
        PendingInviteeProfiles.isUserModel(relatedModelType);

      const narrowOne: (relationFilter: unknown) => unknown = (
        relationFilter: unknown,
      ): unknown => {
        if (!PendingInviteeProfiles.isPlainObject(relationFilter)) {
          return relationFilter;
        }

        let related: Record<string, unknown> =
          PendingInviteeProfiles.narrowFilter(
            new relatedModelType(),
            relationFilter as Record<string, unknown>,
            props,
          );

        if (
          isPerson &&
          Object.keys(related).some((column: string): boolean => {
            return PROFILE_COLUMNS_SHOWN_ONCE_JOINED.includes(column);
          })
        ) {
          const condition: FindWhereProperty<any> | null =
            PendingInviteeProfiles.getNotPendingCondition(props);

          if (condition) {
            related = {
              ...related,
              _id: combineWithPrivacyClause(related["_id"], condition),
            };
          }
        }

        return related;
      };

      const next: unknown = Array.isArray(value)
        ? value.map(narrowOne)
        : narrowOne(value);

      if (next !== value) {
        narrowed = narrowed === filter ? { ...filter } : narrowed;
        narrowed[key] = next;
      }
    }

    return narrowed;
  }

  /*
   * A condition on a person's id: someone who is not pending for this
   * reader (see the top of this file) - or the reader themselves. Null for
   * a reader the rule cannot be asked about.
   */
  public static getNotPendingCondition(
    props: DatabaseCommonInteractionProps,
  ): FindWhereProperty<any> | null {
    const profileReader: ProfileReader | null =
      PendingInviteeProfiles.getReader(props);

    if (!profileReader) {
      return null;
    }

    // Aliases and a parameter of this condition's own, in any query.
    const suffix: string = Text.generateRandomText(10);
    const parameter: string = `pendingInviteeReader${suffix}`;

    return Raw(
      (alias: string): string => {
        return `(${alias} NOT IN (${PendingInviteeProfiles.getPendingPeopleSql({
          reader: profileReader,
          readerParameter: parameter,
          suffix: suffix,
        })}))`;
      },
      { [parameter]: PendingInviteeProfiles.getReaderParameter(profileReader) },
    );
  }

  // What a statement binds the reader as: a person's id, or a project's.
  public static getReaderParameter(reader: ProfileReader): string {
    return "userId" in reader ? reader.userId : reader.projectId;
  }

  /*
   * The ids of the people pending for this reader (see the top of this
   * file), as a subquery: their invitations in the reader's projects, for
   * those who have joined none of those projects - never the reader
   * themselves. `readerParameter` names the parameter the statement binds
   * the reader to (getReaderParameter), and `suffix` makes its aliases its
   * own, in any query.
   */
  public static getPendingPeopleSql(data: {
    reader: ProfileReader;
    readerParameter: string;
    suffix: string;
  }): string {
    const pending: string = `pending${data.suffix}`;
    const accepted: string = `accepted${data.suffix}`;
    const isPersonReading: boolean = "userId" in data.reader;

    const notTheReader: string = isPersonReading
      ? ` AND "${pending}"."userId" <> :${data.readerParameter}`
      : "";

    return `SELECT "${pending}"."userId" FROM "TeamMember" "${pending}" WHERE "${pending}"."hasAcceptedInvitation" = false AND "${pending}"."deletedAt" IS NULL AND "${pending}"."projectId" IN (${PendingInviteeProfiles.getReaderProjectsSql(
      {
        reader: data.reader,
        readerParameter: data.readerParameter,
        alias: `readerOfPending${data.suffix}`,
      },
    )}) AND NOT EXISTS (SELECT 1 FROM "TeamMember" "${accepted}" WHERE "${accepted}"."userId" = "${pending}"."userId" AND "${accepted}"."hasAcceptedInvitation" = true AND "${accepted}"."deletedAt" IS NULL AND "${accepted}"."projectId" IN (${PendingInviteeProfiles.getReaderProjectsSql(
      {
        reader: data.reader,
        readerParameter: data.readerParameter,
        alias: `readerOfAccepted${data.suffix}`,
      },
    )}))${notTheReader}`;
  }

  /*
   * The reader's projects, as SQL a statement can ask "IN" of: those a
   * person has a membership in (an invitation included), or a project's
   * own one.
   */
  private static getReaderProjectsSql(data: {
    reader: ProfileReader;
    readerParameter: string;
    alias: string;
  }): string {
    return "userId" in data.reader
      ? `SELECT "${data.alias}"."projectId" FROM "TeamMember" "${data.alias}" WHERE "${data.alias}"."userId" = :${data.readerParameter} AND "${data.alias}"."deletedAt" IS NULL`
      : `:${data.readerParameter}`;
  }

  /*
   * The name typed for a pending person, as a read of them shows it
   * (readWithheldProfilesFor): from one of their invitations in the
   * reader's projects, the request's project first (`preferredParameter`,
   * when the read is in one), then the newest that has one; NULL when none
   * has. `personIdSql` is the SQL of the person's id.
   */
  public static getTypedNameSql(data: {
    personIdSql: string;
    reader: ProfileReader;
    readerParameter: string;
    preferredParameter: string | null;
    suffix: string;
  }): string {
    const typed: string = `typed${data.suffix}`;
    const typedName: string = `BTRIM("${typed}"."inviteeName")`;
    const requestFirst: string = data.preferredParameter
      ? `CASE WHEN "${typed}"."projectId" = :${data.preferredParameter} THEN 0 ELSE 1 END, `
      : "";

    return `(SELECT ${typedName} FROM "TeamMember" "${typed}" WHERE "${typed}"."userId" = ${data.personIdSql} AND "${typed}"."hasAcceptedInvitation" = false AND "${typed}"."deletedAt" IS NULL AND "${typed}"."projectId" IN (${PendingInviteeProfiles.getReaderProjectsSql(
      {
        reader: data.reader,
        readerParameter: data.readerParameter,
        alias: `readerOfTyped${data.suffix}`,
      },
    )}) AND COALESCE(${typedName}, '') <> '' ORDER BY ${requestFirst}"${typed}"."createdAt" DESC LIMIT 1)`;
  }

  /*
   * WHAT A READ IS ORDERED BY (#9895): the order of a read, through a
   * relation, by a person's name, picture or two-factor flag, as this reader
   * sees each person - for a builder TypeORM has built from a find's order
   * (PagedFind, called from DatabaseService). Null for a reader who sees
   * every profile, or whom the rule cannot be asked about: their order is
   * TypeORM's own, as their rows are.
   */
  public static getOrderAdjuster(
    props: DatabaseCommonInteractionProps,
  ): FindBuilderAdjuster | null {
    if (PendingInviteeProfiles.seesEveryProfile(props)) {
      return null;
    }

    const reader: ProfileReader | null =
      PendingInviteeProfiles.getReader(props);

    if (!reader) {
      return null;
    }

    const preferredProjectId: string | null =
      PendingInviteeProfiles.getReaderProjectId(props);

    return <TEntity extends ObjectLiteral>(
      queryBuilder: SelectQueryBuilder<TEntity>,
    ): void => {
      PendingInviteeProfiles.orderAsTheReaderSees({
        queryBuilder: queryBuilder,
        reader: reader,
        preferredProjectId: preferredProjectId,
      });
    };
  }

  /*
   * Each order the builder has by a person's profile column, reached
   * through a relation, replaced in its place by the value the reader sees
   * (see the top of this file), with the same direction and the same place
   * for empty values:
   *
   *   - a name: someone pending for the reader by the name typed for them,
   *     else their address - what a row shows where it withholds the name -
   *     and anyone else by their own;
   *   - a picture or a two-factor flag: none for someone pending, as their
   *     rows show none; anyone else's own.
   *
   * Each value is selected under an alias of its own (lower case: TypeORM
   * orders by the alias as written) and the order names that alias, which
   * TypeORM's two-query page reads too: it orders the page's ids by the
   * alias it selects (createOrderByCombinedWithSelectExpression). The ids
   * and the other orders are left as they are. A builder whose order names
   * no profile column through a relation is not changed at all, and nor is
   * an order of people themselves (a list of User, the reader's own row).
   */
  public static orderAsTheReaderSees<TEntity extends ObjectLiteral>(data: {
    queryBuilder: SelectQueryBuilder<TEntity>;
    reader: ProfileReader;
    preferredProjectId: string | null;
  }): void {
    const orderBys: OrderByCondition = data.queryBuilder.expressionMap.orderBys;

    const ordered: Array<OrderedProfileColumn | null> = Object.keys(
      orderBys,
    ).map((key: string): OrderedProfileColumn | null => {
      return PendingInviteeProfiles.getOrderedProfileColumn({
        queryBuilder: data.queryBuilder,
        key: key,
      });
    });

    if (
      !ordered.some((column: OrderedProfileColumn | null): boolean => {
        return Boolean(column);
      })
    ) {
      return;
    }

    const keys: Array<string> = Object.keys(orderBys);
    const rewritten: OrderByCondition = {};
    let selected: number = 0;

    for (let index: number = 0; index < keys.length; index++) {
      const key: string = keys[index]!;
      const column: OrderedProfileColumn | null = ordered[index] || null;

      if (!column) {
        rewritten[key] = orderBys[key]!;
        continue;
      }

      const suffix: string = Text.generateRandomText(10);
      const readerParameter: string = `pendingInviteeOrderReader${suffix}`;
      const preferredParameter: string | null = data.preferredProjectId
        ? `pendingInviteeOrderProject${suffix}`
        : null;
      const selectAlias: string =
        `pending_invitee_order_${selected}_${suffix}`.toLowerCase();

      selected++;

      data.queryBuilder.addSelect(
        PendingInviteeProfiles.getOrderedValueSql({
          column: column,
          reader: data.reader,
          readerParameter: readerParameter,
          preferredParameter: preferredParameter,
          suffix: suffix,
          escape: (name: string): string => {
            return data.queryBuilder.escape(name);
          },
        }),
        selectAlias,
      );

      data.queryBuilder.setParameter(
        readerParameter,
        PendingInviteeProfiles.getReaderParameter(data.reader),
      );

      if (preferredParameter) {
        data.queryBuilder.setParameter(
          preferredParameter,
          data.preferredProjectId,
        );
      }

      rewritten[selectAlias] = orderBys[key]!;
    }

    data.queryBuilder.expressionMap.orderBys = rewritten;
  }

  /*
   * The person's profile column an order of the builder names through a
   * relation ("TeamMember__TeamMember_user.name"), or null for any other
   * order: one of the read's own columns, a related record that is no
   * person, or a column of a person's that is not their profile (their
   * address is the project's own: it typed it).
   */
  private static getOrderedProfileColumn<TEntity extends ObjectLiteral>(data: {
    queryBuilder: SelectQueryBuilder<TEntity>;
    key: string;
  }): OrderedProfileColumn | null {
    const dot: number = data.key.indexOf(".");

    if (dot <= 0) {
      return null;
    }

    const aliasName: string = data.key.substring(0, dot);
    const propertyPath: string = data.key.substring(dot + 1);

    if (
      !PROFILE_COLUMNS_SHOWN_ONCE_JOINED.includes(propertyPath) ||
      aliasName === data.queryBuilder.expressionMap.mainAlias?.name
    ) {
      return null;
    }

    const alias: Alias | undefined =
      data.queryBuilder.expressionMap.aliases.find(
        (candidate: Alias): boolean => {
          return candidate.name === aliasName;
        },
      );

    if (
      !alias ||
      !alias.hasMetadata ||
      alias.metadata.tableName !== USER_TABLE_NAME
    ) {
      return null;
    }

    const column: ColumnMetadata | undefined =
      alias.metadata.findColumnWithPropertyPath(propertyPath);
    const emailColumn: ColumnMetadata | undefined =
      alias.metadata.findColumnWithPropertyPath("email");
    const idColumn: ColumnMetadata | undefined =
      alias.metadata.primaryColumns[0];

    if (!column || !emailColumn || !idColumn) {
      return null;
    }

    return {
      aliasName: aliasName,
      propertyPath: propertyPath,
      columnName: column.databaseName,
      emailColumnName: emailColumn.databaseName,
      idColumnName: idColumn.databaseName,
    };
  }

  /*
   * The value a person is ordered by, as this reader sees them (see
   * orderAsTheReaderSees), in SQL.
   */
  public static getOrderedValueSql(data: {
    column: OrderedProfileColumn;
    reader: ProfileReader;
    readerParameter: string;
    preferredParameter: string | null;
    suffix: string;
    escape: (name: string) => string;
  }): string {
    const person: string = data.escape(data.column.aliasName);
    const personId: string = `${person}.${data.escape(data.column.idColumnName)}`;
    const own: string = `${person}.${data.escape(data.column.columnName)}`;

    const isPending: string = `${personId} IN (${PendingInviteeProfiles.getPendingPeopleSql(
      {
        reader: data.reader,
        readerParameter: data.readerParameter,
        suffix: data.suffix,
      },
    )})`;

    const shown: string =
      data.column.propertyPath === "name"
        ? `COALESCE(${PendingInviteeProfiles.getTypedNameSql({
            personIdSql: personId,
            reader: data.reader,
            readerParameter: data.readerParameter,
            preferredParameter: data.preferredParameter,
            suffix: data.suffix,
          })}, ${person}.${data.escape(data.column.emailColumnName)})`
        : "NULL";

    return `(CASE WHEN ${isPending} THEN ${shown} ELSE ${own} END)`;
  }

  /*
   * Whether a reader may see a person's picture (UserAPI serves it by the
   * person's id, to whoever asks): the person themselves, a master admin,
   * or someone with a membership - an invitation included - in a project
   * the person has joined. Nobody else, a reader nobody signed in as
   * included: they get no picture, as for a person who has none, so the
   * answer never says whether the person has one. Stricter than a name:
   * a picture is not part of a project's history, so someone who left
   * every project of the reader's shows none.
   */
  public static async maySeePicture(data: {
    personUserId: ObjectID;
    reader: { userId: ObjectID; isMasterAdmin: boolean } | null;
  }): Promise<boolean> {
    if (!data.reader) {
      return false;
    }

    if (data.reader.isMasterAdmin) {
      return true;
    }

    const personUserId: string = data.personUserId.toString().toLowerCase();
    const readerUserId: string = data.reader.userId.toString().toLowerCase();

    if (personUserId === readerUserId) {
      return true;
    }

    if (
      !ObjectID.isValidUUID(personUserId) ||
      !ObjectID.isValidUUID(readerUserId)
    ) {
      return false;
    }

    return await PendingInviteeProfiles.sharesJoinedProject({
      personUserId: personUserId,
      readerUserId: readerUserId,
    });
  }

  /*
   * Whether the person has joined a project the reader has a membership in
   * (an invitation included). False when the database cannot be asked.
   */
  public static async sharesJoinedProject(data: {
    personUserId: string;
    readerUserId: string;
  }): Promise<boolean> {
    const dataSource: DataSource | null = PostgresAppInstance.isConnected()
      ? PostgresAppInstance.getDataSource()
      : null;

    if (!dataSource) {
      return false;
    }

    const rows: Array<unknown> = (await dataSource.query(
      `SELECT 1 FROM "TeamMember" "person" WHERE "person"."userId" = $1 AND "person"."hasAcceptedInvitation" = true AND "person"."deletedAt" IS NULL AND "person"."projectId" IN (SELECT "reader"."projectId" FROM "TeamMember" "reader" WHERE "reader"."userId" = $2 AND "reader"."deletedAt" IS NULL) LIMIT 1`,
      [data.personUserId, data.readerUserId],
    )) as Array<unknown>;

    return rows.length > 0;
  }

  /*
   * A filter or an order through a relation to a person, by one of their
   * account dates: refused for everyone but OneUptime and a master admin.
   * Which rows such a filter matches, and the order they come in, say when
   * the person was last active.
   */
  public static assertMayReadThroughRelation(data: {
    relatedModel: BaseModel;
    column: string;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (
      PendingInviteeProfiles.seesEveryProfile(data.props) ||
      data.relatedModel.tableName !== USER_TABLE_NAME ||
      !ACCOUNT_DATE_COLUMNS.includes(data.column)
    ) {
      return;
    }

    throw new NotAuthorizedException(
      ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE,
    );
  }

  /*
   * The permissions that let nobody filter or order a list by a column of a
   * record a relation reaches (QueryPermission
   * .canFilterOrOrderByRelatedColumn). On a person's account, CurrentUser:
   * it means the account's own person, and every signed-in person holds it
   * (DatabaseCommonInteractionPropsUtil), because a read of the User table
   * itself is held to the reader's own row (CurrentUserCanAccessRecordBy).
   * Through a relation the account is whoever the relation names, so it
   * lets in nobody there, and a filter or order through a relation names of
   * a person only what any reader of the relation may read - their name,
   * address, picture and two-factor flag - and their id.
   */
  public static getPermissionsNotCountedThroughRelation(
    relatedModel: BaseModel,
  ): ReadonlyArray<Permission> {
    return relatedModel.tableName === USER_TABLE_NAME
      ? [Permission.CurrentUser]
      : [];
  }

  // A related record's id, lower-cased, as a read returns it.
  public static getId(record: unknown): string | null {
    if (!record || typeof record !== "object") {
      return null;
    }

    const values: Record<string, unknown> = record as Record<string, unknown>;
    const id: unknown = values["_id"] || values["id"];
    const text: string = id ? String(id).toLowerCase() : "";

    return ObjectID.isValidUUID(text) ? text : null;
  }

  private static getColumnMetadata(
    model: BaseModel,
    column: string,
  ): TableColumnMetadata | undefined {
    try {
      return model.getTableColumnMetadata(column) as
        | TableColumnMetadata
        | undefined;
    } catch {
      return undefined;
    }
  }

  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
