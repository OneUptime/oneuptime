import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
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
import Text from "../../../Types/Text";
import UserType from "../../../Types/UserType";
import { DataSource, Raw } from "typeorm";

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

// One pending membership of a person, as the query below reads it.
interface PendingMembershipRow {
  userId: string;
  projectId: string;
  inviteeName: string | null;
  createdAt: Date | string | null;
}

export default class PendingInviteeProfiles {
  // OneUptime's own reads and a master admin's see every profile.
  public static seesEveryProfile(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return Boolean(props.isRoot || props.isMasterAdmin);
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
    if (
      props.userType === UserType.API ||
      props.userType === UserType.Workflow ||
      props.userType === UserType.Public
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

    const readerUserId: string | null =
      "userId" in profileReader ? profileReader.userId : null;
    const reader: string =
      "userId" in profileReader
        ? profileReader.userId
        : profileReader.projectId;

    // Aliases and a parameter of this condition's own, in any query.
    const suffix: string = Text.generateRandomText(10);
    const parameter: string = `pendingInviteeReader${suffix}`;
    const pending: string = `pending${suffix}`;
    const accepted: string = `accepted${suffix}`;

    const readerProjects: (alias: string) => string = (
      alias: string,
    ): string => {
      return readerUserId
        ? `SELECT "${alias}"."projectId" FROM "TeamMember" "${alias}" WHERE "${alias}"."userId" = :${parameter} AND "${alias}"."deletedAt" IS NULL`
        : `:${parameter}`;
    };

    const notTheReader: string = readerUserId
      ? ` AND "${pending}"."userId" <> :${parameter}`
      : "";

    return Raw(
      (alias: string): string => {
        return `(${alias} NOT IN (SELECT "${pending}"."userId" FROM "TeamMember" "${pending}" WHERE "${pending}"."hasAcceptedInvitation" = false AND "${pending}"."deletedAt" IS NULL AND "${pending}"."projectId" IN (${readerProjects(`readerOfPending${suffix}`)}) AND NOT EXISTS (SELECT 1 FROM "TeamMember" "${accepted}" WHERE "${accepted}"."userId" = "${pending}"."userId" AND "${accepted}"."hasAcceptedInvitation" = true AND "${accepted}"."deletedAt" IS NULL AND "${accepted}"."projectId" IN (${readerProjects(`readerOfAccepted${suffix}`)}))${notTheReader}))`;
      },
      { [parameter]: reader },
    );
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
