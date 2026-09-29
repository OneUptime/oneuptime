import crypto from "crypto";
import { EncryptionSecret } from "../../EnvironmentConfig";
import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_TARGET_TTL_SECONDS,
} from "../../../Types/Rum/SessionReplay";

/*
 * "Record the next session for user X."
 *
 * A dashboard user names an end-user reference; the next recorder boot that
 * identifies as that user gets isTargeted on its config response and
 * records from its first event. The whole mechanism is one Redis key:
 *
 *   session-replay:target:<projectId>:<HMAC(userRef)>  ->  "1", 24h TTL
 *
 * The member is an HMAC (keyed on the server's EncryptionSecret, scoped by
 * project + application) rather than the raw reference, because end-user
 * references are routinely emails: a Redis KEYS listing on a shared
 * cluster must not be a directory of the customer's users. The HMAC also
 * makes key length independent of reference length.
 *
 * consume() is a plain DEL used as an atomic take: 1 deleted means this
 * config fetch owns the target, so two tabs racing produce exactly one
 * targeted session. And every read path here FAILS TO "not targeted" -
 * targeting is a diagnostic convenience, and a Redis blip must degrade to
 * "the session was not specially recorded", never to a config error that
 * stops normal recording.
 */

const TARGET_KEY_PREFIX: string = "session-replay:target:";

export interface SessionReplayTargetRef {
  projectId: ObjectID;
  appIdentifier: string;
  userRef: string;
}

export default class SessionReplayTargeting {
  /*
   * A reference is usable when non-empty and within the shared length
   * cap. The cap is enforced on BOTH the dashboard write and the config
   * read, so an over-long ref simply can never match rather than being
   * truncated differently on each side.
   */
  public static isUsableUserRef(userRef: unknown): userRef is string {
    return (
      typeof userRef === "string" &&
      userRef.trim().length > 0 &&
      userRef.length <= SESSION_REPLAY_MAX_USER_REF_LENGTH
    );
  }

  public static buildTargetKey(data: SessionReplayTargetRef): string {
    const digest: string = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(
        `${data.projectId.toString()}:${data.appIdentifier
          .trim()
          .toLowerCase()}:${data.userRef.trim()}`,
      )
      .digest("hex");

    return `${TARGET_KEY_PREFIX}${data.projectId.toString()}:${digest}`;
  }

  /* Dashboard write path. Throws so the caller can answer 5xx honestly. */
  public static async setTarget(data: SessionReplayTargetRef): Promise<void> {
    const client: ClientType = SessionReplayTargeting.requireClient();

    await client.set(
      SessionReplayTargeting.buildTargetKey(data),
      "1",
      "EX",
      SESSION_REPLAY_TARGET_TTL_SECONDS,
    );
  }

  /* Dashboard cancel path. Throws for the same reason setTarget does. */
  public static async clearTarget(data: SessionReplayTargetRef): Promise<void> {
    const client: ClientType = SessionReplayTargeting.requireClient();

    await client.del(SessionReplayTargeting.buildTargetKey(data));
  }

  /* Dashboard status read. Throws; the panel shows an error, not a lie. */
  public static async isTargetPending(
    data: SessionReplayTargetRef,
  ): Promise<boolean> {
    const client: ClientType = SessionReplayTargeting.requireClient();

    const found: number = await client.exists(
      SessionReplayTargeting.buildTargetKey(data),
    );

    return found === 1;
  }

  /*
   * The config endpoint's atomic take. Returns true exactly once per
   * target - DEL's return value is the arbiter - and NEVER throws: this
   * sits on the hot config path, where a Redis error must cost us the
   * targeting nicety and nothing else.
   */
  public static async consumeTarget(
    data: SessionReplayTargetRef,
  ): Promise<boolean> {
    if (!SessionReplayTargeting.isUsableUserRef(data.userRef)) {
      return false;
    }

    try {
      const client: ClientType | null = Redis.getClient();

      if (!client || !Redis.isConnected()) {
        return false;
      }

      const deleted: number = await client.del(
        SessionReplayTargeting.buildTargetKey(data),
      );

      return deleted === 1;
    } catch (err) {
      logger.error("SessionReplayTargeting: consumeTarget failed:");
      logger.error(err);

      return false;
    }
  }

  private static requireClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error("Redis is not connected.");
    }

    return client;
  }
}
