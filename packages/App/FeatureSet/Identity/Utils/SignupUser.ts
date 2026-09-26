import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import { JSONObject } from "Common/Types/JSON";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
} from "Common/Types/Marketing/Attribution";

/*
 * The User columns a self-service signup may take from the request body.
 *
 * Why an allow-list:
 *
 * /signup creates the account as root. It has to: the User table is creatable
 * by nobody (`create: []`) and an anonymous caller has no permissions to check.
 * But root also skips every per-column create permission, so a model
 * deserialized straight from the body persisted every column the caller named.
 *
 * The worst of them was the primary key. `fromJSON` copies `_id` like any
 * other column (and maps `id` onto it), DatabaseService.create only refuses a
 * caller-supplied id on NON-root creates, and TypeORM's save() treats an entity
 * that carries an existing id as an UPDATE of that row. A signup naming another
 * user's id therefore rewrote that user's email, password and name in place,
 * and the attacker then signed in to the victim's account with their own
 * address -- every project membership included. Behind it, isBlocked,
 * twoFactorAuthEnabled, resetPasswordToken, createdByUserId, profilePictureId,
 * timezone and the rest were written verbatim too.
 *
 * So the model is built from these columns and nothing else. Each one is a
 * column the User model already declares creatable by `Permission.Public`
 * (SignupUser.test.ts pins that), so this never grants more than the model
 * does -- it only stops root from granting everything. Columns the server
 * decides, isEmailVerified and isMasterAdmin, are set after this by the route
 * and by UserService.createUserOnSignup.
 */
export const SIGNUP_USER_COLUMNS: ReadonlyArray<string> = [
  "email",
  "name",
  "password",
  "companyName",
  "companyPhoneNumber",
  "jobRole",
  "companySize",
  "referral",

  /*
   * The same shared contract the Register page writes from, so a UTM key added
   * to Common/Types/Marketing/Attribution.ts is accepted here without this list
   * having to be remembered.
   */
  ...UtmPropertyKeys,
  UtmUrlPropertyKey,

  // Unbounded jsonb; UserService.onBeforeCreate whitelists their keys and caps their values.
  "clickIds",
  "firstTouchAttribution",
];

export default class SignupUser {
  /**
   * The User a signup request asks for, built from SIGNUP_USER_COLUMNS only.
   * Anything else in `data` -- `_id` and `id` above all -- is dropped before
   * deserialization, so it never reaches the model.
   */
  public static fromRequestData(data: unknown): User {
    const allowedData: JSONObject = {};

    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const column of SIGNUP_USER_COLUMNS) {
        if (Object.prototype.hasOwnProperty.call(data, column)) {
          allowedData[column] = (data as JSONObject)[column];
        }
      }
    }

    return BaseModel.fromJSON(allowedData, User) as User;
  }
}
