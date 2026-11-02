/*
 * PEOPLE NAMED BY THEIR EMAIL ADDRESS
 *
 * The API names a person by their user ID: a team member's `userId`, an
 * owner row's `userId`, an owner rule's `ownerUsers`, an override's
 * `overrideUserId`. Nobody knows anyone's user ID, and a project API key
 * cannot read the User records themselves (each is its owner's alone, so
 * the provider's old `oneuptime_user` lookup refused every key). Everybody
 * knows email addresses. So the clients OneUptime publishes - the Terraform
 * and OpenTofu provider (Scripts/TerraformProvider), the dashboard's
 * Developer > Terraform pages (TerraformSchema.ts) and, after them, the
 * CLI - name a person by email too, wherever the API takes their ID, and
 * all of them follow the rules here, read from this one copy:
 *
 *   - beside every column a client writes that names a person (a relation
 *     to User), a companion named for it: userId -> userEmail,
 *     assignedToUserId -> assignedToUserEmail, ownerUsers ->
 *     ownerUserEmails (in Terraform user_email, owner_user_emails). A client
 *     takes one of the two, never both;
 *   - a client finds the person among the project's members and invitees,
 *     through the project's TeamMember rows: the people the dashboard's
 *     pickers offer, the people the server accepts in a reference
 *     (ProjectScopedReferenceValidator), and the only place a project API
 *     key can read who is in the project - by exact address, in any case,
 *     and sends their ID. Nobody outside the key's project is ever found;
 *   - a team member named by email is invited by that address instead
 *     (INVITED_BY_EMAIL), the way the dashboard's Invite does it: someone
 *     with no OneUptime account yet gets one, and an invitation;
 *   - what a membership's invited person decides - whether they accepted,
 *     and when - is read-only to a client (DECIDED_BY_THE_PERSON_INVITED):
 *     the server ignores a project caller's value, and a person accepting
 *     later must not show as a change. So is whether OneUptime has told the
 *     owners of something they own it yet (isDecidedBySomeoneElse).
 *
 * Only columns a client writes get a companion: who created or acknowledged
 * a record is the server's to fill in.
 */

// The model whose records are people.
export const PERSON_TABLE_NAME: string = "User";

// One person (`userId`), or a set of them (`ownerUsers`).
export enum PersonColumnKind {
  One = "one",
  Many = "many",
}

const ONE_ID_SUFFIX: string = "Id";
const MANY_SUFFIX: string = "Users";

/*
 * The companion that names, by email address, the person or people a column
 * names by ID: userId -> userEmail, overrideUserId -> overrideUserEmail,
 * ownerUsers -> ownerUserEmails, notifyUsers -> notifyUserEmails.
 */
export function getPersonEmailColumnName(
  columnName: string,
  kind: PersonColumnKind,
): string {
  if (kind === PersonColumnKind.Many) {
    if (
      columnName.endsWith(MANY_SUFFIX) &&
      columnName.length > MANY_SUFFIX.length
    ) {
      return `${columnName.slice(0, -MANY_SUFFIX.length)}UserEmails`;
    }

    return `${columnName}Emails`;
  }

  if (
    columnName.endsWith(ONE_ID_SUFFIX) &&
    columnName.length > ONE_ID_SUFFIX.length
  ) {
    return `${columnName.slice(0, -ONE_ID_SUFFIX.length)}Email`;
  }

  return `${columnName}Email`;
}

/*
 * What the companion says it is, wherever a client describes it: the
 * provider's attribute (`user_email`), the dashboard's field list under a
 * Terraform example, and the CLI's flag. `idName` is the client's name for
 * the column it sits beside: `user_id` in Terraform.
 */
export function describePersonEmail(data: {
  idName: string;
  isList: boolean;
  invitesByEmail: boolean;
}): string {
  if (data.isList) {
    return `The email addresses of the people in \`${data.idName}\`, instead of their IDs: each one of someone in this project, or invited to it. Give one of the two.`;
  }

  if (data.invitesByEmail) {
    return `The email address of the person in \`${data.idName}\`, instead of their ID. Someone who is not in the project yet is invited to it, as the dashboard's Invite does: OneUptime emails them, and they join when they accept. Give one of the two.`;
  }

  return `The email address of the person in \`${data.idName}\`, instead of their ID: someone in this project, or invited to it. Give one of the two.`;
}

// Whether a column that refers to `relatedTableName` names a person.
export function isPersonRelation(
  relatedTableName: string | null | undefined,
): boolean {
  return relatedTableName === PERSON_TABLE_NAME;
}

/*
 * The person columns whose email companion invites rather than finds: a
 * team member named by an address nobody in the project has is invited to
 * the project by that address (TeamMemberService.onBeforeCreate's
 * invitation, sent as miscDataProps.email), and someone already in it joins
 * the team at once.
 */
export const INVITED_BY_EMAIL: Readonly<Record<string, string>> = {
  TeamMember: "userId",
};

export function isInvitedByEmail(
  tableName: string,
  columnName: string,
): boolean {
  return INVITED_BY_EMAIL[tableName] === columnName;
}

// What an invitation by email sends the address as: miscDataProps.email.
export const INVITATION_EMAIL_FIELD: string = "email";

/*
 * Memberships a client imports by what they join - the team, and the
 * person by email address or user ID: `<team id>/alice@example.com` - as
 * well as by their own ID, which no screen shows.
 */
export interface MembershipImport {
  // The column of what the person is a member of: teamId.
  parentColumn: string;
  // The column of the person: userId.
  personColumn: string;
}

export const MEMBERSHIP_IMPORTS: Readonly<Record<string, MembershipImport>> = {
  TeamMember: { parentColumn: "teamId", personColumn: "userId" },
};

/*
 * COLUMNS SOMEONE ELSE DECIDES. The API takes these at create, and a
 * client never sets them, because someone else decides them and changes
 * them later - a client's value would be a change on every plan after they
 * did:
 *
 *   - the person invited decides whether they accept an invitation, and
 *     when (TeamMemberService refuses anyone else and ignores a project
 *     caller's value). Planned as `false`, every plan of an accepted member
 *     was an update the server then refused;
 *   - OneUptime decides whether it has told the owners yet
 *     (`isOwnerNotified`, on every owner row and state timeline): it sets it
 *     once it has. Planned as its default, `false`, every plan after that
 *     replaced the owner row - and told the owner again.
 *
 * To a client they are read-only: what they say, never what to do.
 */
export const DECIDED_BY_THE_PERSON_INVITED: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  TeamMember: ["hasAcceptedInvitation", "invitationAcceptedAt"],
};

export const DECIDED_BY_ONEUPTIME_IN_EVERY_TABLE: ReadonlyArray<string> = [
  "isOwnerNotified",
];

export function isDecidedByThePersonInvited(
  tableName: string,
  columnName: string,
): boolean {
  return Boolean(
    DECIDED_BY_THE_PERSON_INVITED[tableName]?.includes(columnName),
  );
}

// Whether a column is someone else's to decide, and read-only to a client.
export function isDecidedBySomeoneElse(
  tableName: string,
  columnName: string,
): boolean {
  return (
    isDecidedByThePersonInvited(tableName, columnName) ||
    DECIDED_BY_ONEUPTIME_IN_EVERY_TABLE.includes(columnName)
  );
}

/*
 * How a client compares two addresses: OneUptime stores every address
 * trimmed and in lower case (Types/Email), and finds a person by one in any
 * case.
 */
export function normalizePersonEmail(email: string): string {
  return email.trim().toLowerCase();
}

// The address the provider's examples and the dashboard use for someone.
export const EXAMPLE_PERSON_EMAIL: string = "alice@example.com";
