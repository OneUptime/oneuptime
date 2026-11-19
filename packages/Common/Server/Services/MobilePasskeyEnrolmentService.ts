import Redis, { ClientType } from "../Infrastructure/Redis";
import { HttpProtocol } from "../EnvironmentConfig";
import Protocol from "../../Types/API/Protocol";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import { JSONObject } from "../../Types/JSON";
import { MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE } from "../../Types/Accounts/SecondStepEnrolment";
import { createHash, randomBytes } from "crypto";

/*
 * A PASSKEY SET UP FROM THE MOBILE APP, WHEN SIGN-IN REQUIRES A SECOND STEP
 * (issue #9817, Types/Accounts/SecondStepEnrolment).
 *
 * The app has no WebAuthn of its own: a native passkey needs the app to be
 * associated with the server's domain, and a self-hosted server's domain is
 * nobody's to associate with an app in the stores. So the app hands the
 * browser's prompt to the phone's own browser (an authentication session,
 * as passkey sign-in does) on the server's own address, and keeps every
 * request that proves anything for itself:
 *
 *   1. the app asks POST /identity/security-key-enrolment-options with the
 *      email and password, as the web sign-in page does, and `mobileHandOff`.
 *      Every check /login makes, and every refusal an enrolment makes, run
 *      first. The options - a passkey's, for the account the password
 *      proved, their challenge kept on the server for that account - are
 *      kept here under a random id, which is all the app is answered;
 *   2. the browser page (Accounts' /accounts/mobile-passkey-enrolment) is
 *      opened with that id in its address's fragment - never sent to a
 *      server, never in a log - reads the options with it ONCE, and runs the
 *      phone's prompt;
 *   3. the page hands the new passkey's public answer back to the app
 *      (oneuptime://passkey-enrolment), which sends it to POST
 *      /identity/verify-security-key-enrolment with the email and password
 *      again - the very request the web makes. Only that request saves the
 *      key and signs anybody in, for the account the password proves.
 *
 * What the id gives whoever holds it: one read of the options, within
 * minutes - the challenge and the account's name and address the prompt
 * shows. Never a key saved, never a session: those need the password. And
 * the answer the page hands back is no secret either: a public key and a
 * signature over the challenge, worthless without the password that
 * verifies it.
 */

const KEY_PREFIX: string = "mobile-passkey-enrolment-";

// As long as the challenge it carries lives (UserWebAuthnService).
export const MOBILE_PASSKEY_ENROLMENT_TTL_SECONDS: number = 5 * 60;

const HAND_OFF_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

export default class MobilePasskeyEnrolmentService {
  /*
   * Whether this server can hand a passkey's setup to the phone's browser:
   * WebAuthn runs only on a secure page, so only on a server reached over
   * HTTPS. The app offers a passkey only when /login says so.
   */
  public static isAvailable(): boolean {
    return HttpProtocol === Protocol.HTTPS;
  }

  // Keeps the options for the browser page: the id it reads them with.
  public static async storeOptions(options: JSONObject): Promise<string> {
    const handOffId: string = randomBytes(32).toString("base64url");

    const result: string | null =
      await MobilePasskeyEnrolmentService.getStore().set(
        `${KEY_PREFIX}${MobilePasskeyEnrolmentService.hash(handOffId)}`,
        JSON.stringify({ options: options }),
        "EX",
        MOBILE_PASSKEY_ENROLMENT_TTL_SECONDS,
        "NX",
      );

    if (result !== "OK") {
      throw new BadDataException(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
    }

    return handOffId;
  }

  /*
   * The options kept under this id, read once: read and deleted in one
   * operation, so two pages cannot both have them. An id that is not one,
   * was read already or has expired is refused alike.
   */
  public static async takeOptions(handOffId: unknown): Promise<JSONObject> {
    if (
      typeof handOffId !== "string" ||
      HAND_OFF_ID_PATTERN.exec(handOffId)?.[0] !== handOffId
    ) {
      throw new BadDataException(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
    }

    const stored: unknown = await MobilePasskeyEnrolmentService.getStore().eval(
      "local value = redis.call('GET', KEYS[1]); " +
        "if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      `${KEY_PREFIX}${MobilePasskeyEnrolmentService.hash(handOffId)}`,
    );

    if (typeof stored !== "string") {
      throw new BadDataException(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
    }

    try {
      const parsed: { options?: unknown } = JSON.parse(stored) as {
        options?: unknown;
      };

      if (
        parsed.options &&
        typeof parsed.options === "object" &&
        !Array.isArray(parsed.options)
      ) {
        return parsed.options as JSONObject;
      }
    } catch {
      // Answered as an id that is not one, below.
    }

    throw new BadDataException(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
  }

  private static hash(value: string): string {
    return createHash("sha256").update(value, "ascii").digest("base64url");
  }

  private static getStore(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException(
        "Setting up a passkey from the mobile app is unavailable right now. Try again in a minute, or set up an authenticator app.",
      );
    }

    return client;
  }
}
