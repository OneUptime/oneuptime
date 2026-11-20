import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import {
  REAUTHENTICATION_ROUTE,
  ReauthenticationPurpose,
  ReauthenticationStatus,
  readReauthenticationStatus,
} from "../../Types/Accounts/Reauthentication";
import { JSONObject } from "../../Types/JSON";
import { APP_API_URL } from "../Config";
import API from "./API/API";

/*
 * THE ONE PROMPT THAT CONFIRMS IT'S YOU (#10155, Types/Accounts/
 * Reauthentication).
 *
 * A change to how a person signs in is refused until their session has
 * confirmed it's theirs, and the refusal changes nothing. So the page that
 * asked does not need to know: the API client (API/API.ts) hands the
 * refusal here, the prompt the app mounted once asks the person - their
 * password and second step, a passkey, or Sign In Again - and the request
 * is sent again once they have confirmed. Cancelled, the request's answer
 * is the refusal, which says what to do.
 *
 * The refusal says what it is for (ReauthenticationPurpose): a change to
 * how you sign in, deleting your own account (#10220), or a master admin's
 * change to how someone else signs in, or to the server's (#10216). The
 * prompt says so.
 *
 * One prompt at a time: every request refused while it is open waits for
 * the same answer, and is sent again with it. The Dashboard and the Admin
 * Dashboard each mount the prompt (Common/UI/Components/Reauthentication);
 * an app that mounts none answers every refusal with itself.
 */

// Asks the person, and resolves true once the session has confirmed.
export type ReauthenticationAsker = (
  purpose: ReauthenticationPurpose,
) => Promise<boolean>;

export default class Reauthentication {
  private static asker: ReauthenticationAsker | null = null;

  private static pending: Promise<boolean> | null = null;

  // The app's prompt, or null when it unmounts.
  public static setAsker(asker: ReauthenticationAsker | null): void {
    Reauthentication.asker = asker;
  }

  public static hasAsker(): boolean {
    return Reauthentication.asker !== null;
  }

  /*
   * Whether the session has confirmed it's its person's, asking them when
   * it has not and a prompt is mounted - for `purpose`, which the prompt
   * says. Never rejects.
   */
  public static async ask(
    purpose: ReauthenticationPurpose = ReauthenticationPurpose.OwnSignIn,
  ): Promise<boolean> {
    const asker: ReauthenticationAsker | null = Reauthentication.asker;

    if (!asker) {
      return false;
    }

    if (Reauthentication.pending) {
      return await Reauthentication.pending;
    }

    const pending: Promise<boolean> = (async (): Promise<boolean> => {
      try {
        return await asker(purpose);
      } catch {
        return false;
      } finally {
        Reauthentication.pending = null;
      }
    })();

    Reauthentication.pending = pending;

    return await pending;
  }

  /*
   * Before a step that cannot be sent again - the browser's prompt for a new
   * key, which needs the click that opened it - the session confirms first:
   * at once when it has already, else through the prompt. Resolves false
   * when the person cancelled or the status could not be read.
   */
  public static async ensureConfirmed(): Promise<boolean> {
    const status: ReauthenticationStatus | null =
      await Reauthentication.getStatus();

    if (status?.isConfirmed) {
      return true;
    }

    return await Reauthentication.ask();
  }

  // Where the session stands, or null when it could not be read.
  public static async getStatus(): Promise<ReauthenticationStatus | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            REAUTHENTICATION_ROUTE,
          ),
          options: { skipReauthentication: true },
        });

      if (response instanceof HTTPErrorResponse) {
        return null;
      }

      return readReauthenticationStatus(response.data);
    } catch {
      return null;
    }
  }
}
