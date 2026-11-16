import BadDataException from "../../Types/Exception/BadDataException";
import HashedString from "../../Types/HashedString";
import { getPasswordValidationError } from "../../Types/Password";

/*
 * The server's half of the one password rule (Types/Password): a new password
 * that breaks it is refused, wherever it comes from.
 *
 * Called from the write hooks of every model that holds a person's password
 * (UserService, StatusPagePrivateUserService), so no route can store a weak
 * one: sign up, a reset link, Update Password, a master admin's Create User or
 * Set Password, the API. Before #9123 only sign-up asked, and a reset quietly
 * undid the rule.
 *
 * A password is checked only while it is still the plaintext somebody chose.
 * One read back from the database is already hashed (HashedString.fromDatabase)
 * and says nothing about the rule, and signing in never writes one, so a
 * password set before the rule keeps working until its owner changes it.
 */
export default class NewPasswordRule {
  // The rule's refusal for this value, or null when it is not a new password.
  public static getRefusal(password: unknown): string | null {
    if (password === undefined || password === null) {
      return null;
    }

    if (password instanceof HashedString) {
      if (password.isValueHashed()) {
        return null;
      }

      return getPasswordValidationError(password.toString());
    }

    return getPasswordValidationError(password);
  }

  // Throws the rule's refusal, as a 400 whose message the form translates.
  public static assertMet(password: unknown): void {
    const refusal: string | null = NewPasswordRule.getRefusal(password);

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }
}
