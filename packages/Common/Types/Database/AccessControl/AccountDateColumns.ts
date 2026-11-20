/*
 * A PERSON'S ACCOUNT DATES ARE THEIRS (#9823).
 *
 * When a person's account was made, last changed (which moves with their
 * activity), deleted, and how often it was written: withheld from every
 * reader of a relation to them but the person, OneUptime and a master
 * admin, and never a filter or an order through a relation, whose matches
 * and order would say when the person was last active. The server holds
 * every read to it (Server/Utils/TeamMember/PendingInviteeProfiles), and
 * the API's spec offers no sort through a relation by them
 * (ModelSchema.getRelationSortFields). React-free and server-safe, for both.
 */

// The table every person's account is in.
export const USER_TABLE_NAME: string = "User";

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

// Whether `column` of a table's records is a person's account date.
export const isAccountDateColumn: (
  tableName: string | null | undefined,
  column: string,
) => boolean = (
  tableName: string | null | undefined,
  column: string,
): boolean => {
  return tableName === USER_TABLE_NAME && ACCOUNT_DATE_COLUMNS.includes(column);
};
