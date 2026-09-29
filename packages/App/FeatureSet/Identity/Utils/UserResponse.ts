import User from "Common/Models/DatabaseModels/User";

/*
 * The User columns an identity route may put in a response body, and nothing
 * else.
 *
 * Why this exists:
 *
 * `Response.sendEntityResponse` serializes every column that is set on the
 * model it is handed. It does not consult column read permissions -- those are
 * enforced by the query layer, and these routes query with `isRoot`. So
 * whatever a handler happened to load or write is what goes out:
 *
 *   - /login selects `password` and `passwordSalt` to verify the attempt;
 *   - /signup hands back the model `UserService.create` just wrote, and the
 *     write path hashes the password and mints its salt ON THAT MODEL, so the
 *     scrypt hash and its salt were sent to whoever had just signed up. The
 *     same model also carries every other column the request body set.
 *
 * Deleting the credential columns at each call site is a deny-list, and a
 * deny-list is one forgotten `delete` -- or one new secret column -- away from
 * the same leak. This is an allow-list instead: a fresh User holding only the
 * columns the sign-in pages read (Common/UI/Utils/Login.ts, the Accounts
 * Login and Register pages, and the mobile app's api/auth.ts), plus the two
 * account-state flags the sign-in responses have always carried. A column
 * added to User later is absent from every identity response until somebody
 * adds it here on purpose.
 */
const USER_RESPONSE_COLUMNS: ReadonlyArray<keyof User> = [
  "_id",
  "name",
  "email",
  "timezone",
  "isMasterAdmin",
  "profilePictureId",
  "isEmailVerified",
  "enableTwoFactorAuth",
];

type CopyColumnFunction = <K extends keyof User>(
  from: User,
  to: User,
  column: K,
) => void;

const copyColumn: CopyColumnFunction = <K extends keyof User>(
  from: User,
  to: User,
  column: K,
): void => {
  if (from[column] !== undefined) {
    to[column] = from[column];
  }
};

export default class UserResponse {
  /**
   * A copy of `user` that is safe to pass to `Response.sendEntityResponse`.
   *
   * Returns a new model rather than stripping the one it is given: callers
   * still need the original afterwards (the backup-code notice mails from it),
   * and a new object cannot carry a column this list does not name.
   */
  public static toResponseUser(user: User): User {
    const responseUser: User = new User();

    for (const column of USER_RESPONSE_COLUMNS) {
      copyColumn(user, responseUser, column);
    }

    return responseUser;
  }
}
