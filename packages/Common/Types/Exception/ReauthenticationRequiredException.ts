import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";
import { REFUSAL_CODE_FIELD } from "./NameTakenException";
import { JSONObject } from "../JSON";
import {
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
} from "../Accounts/Reauthentication";

/*
 * A CHANGE TO HOW YOU SIGN IN, REFUSED UNTIL YOU CONFIRM IT'S YOU (#10155,
 * Types/Accounts/Reauthentication).
 *
 * Bad data (400), as the product's other refusals are, with its code beside
 * the message so a client reads the code, never the sentence:
 *
 *   { "message": "Confirm it's you before you change how you sign in, then try again.",
 *     "refusalCode": "reauthentication_required" }
 *
 * ("error" in place of "message" where a route answers through next(err).)
 * Nothing was changed: every path asks before it writes, counts or spends
 * anything, so the same request can be sent again once the session has
 * confirmed. The Dashboard asks and sends it again on its own
 * (Common/UI/Utils/Reauthentication); any other client confirms with POST
 * /api/user/reauthentication first.
 *
 * Not a 401, which a client answers by renewing its session and, when that
 * does not help, signing out; and not a 403, which the Dashboard answers
 * with its Forbidden page.
 */
export default class ReauthenticationRequiredException extends BadDataExceptionWithDetails {
  public constructor() {
    super(REAUTHENTICATION_MESSAGES.required, {
      [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    });
  }

  // Whether an answer's body is this refusal: by its code, never its words.
  public static isRefusal(body: unknown): boolean {
    return (
      Boolean(body) &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as JSONObject)[REFUSAL_CODE_FIELD] ===
        REAUTHENTICATION_REQUIRED_REFUSAL_CODE
    );
  }
}
