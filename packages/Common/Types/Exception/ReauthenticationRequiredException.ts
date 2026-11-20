import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";
import { REFUSAL_CODE_FIELD } from "./NameTakenException";
import { JSONObject } from "../JSON";
import {
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  ReauthenticationPurpose,
  readReauthenticationPurpose,
} from "../Accounts/Reauthentication";

/*
 * A CHANGE THAT WAITS UNTIL YOU CONFIRM IT'S YOU (#10155, Types/Accounts/
 * Reauthentication): a change to how you sign in, deleting your own
 * account (#10220), or a master admin's change to how someone else signs
 * in, or to the server's (#10216).
 *
 * Bad data (400), as the product's other refusals are, with its code beside
 * the message so a client reads the code, never the sentence, and what it is
 * for, so the prompt says what the person is about to do:
 *
 *   { "message": "Confirm it's you before you change how you sign in, then try again.",
 *     "refusalCode": "reauthentication_required",
 *     "reauthenticationPurpose": "OwnSignIn" }
 *
 * ("error" in place of "message" where a route answers through next(err).)
 * Nothing was changed: every path asks before it writes, counts or spends
 * anything, so the same request can be sent again once the session has
 * confirmed. The Dashboard and the Admin Dashboard ask and send it again on
 * their own (Common/UI/Utils/Reauthentication); any other client confirms
 * with POST /api/user/reauthentication first.
 *
 * Not a 401, which a client answers by renewing its session and, when that
 * does not help, signing out; and not a 403, which the Dashboard answers
 * with its Forbidden page.
 */
export default class ReauthenticationRequiredException extends BadDataExceptionWithDetails {
  public constructor(
    purpose: ReauthenticationPurpose = ReauthenticationPurpose.OwnSignIn,
  ) {
    super(REAUTHENTICATION_REQUIRED_MESSAGES[purpose], {
      [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
      [REAUTHENTICATION_PURPOSE_FIELD]: purpose,
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

  /*
   * What a refusal's body says it is for: a change to how you sign in when
   * it names nothing else, as every refusal before #10216 and #10220 did.
   */
  public static getPurpose(body: unknown): ReauthenticationPurpose {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return ReauthenticationPurpose.OwnSignIn;
    }

    return readReauthenticationPurpose(
      (body as JSONObject)[REAUTHENTICATION_PURPOSE_FIELD],
    );
  }
}
