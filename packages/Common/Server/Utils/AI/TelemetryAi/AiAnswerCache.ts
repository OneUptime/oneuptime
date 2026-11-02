import crypto from "crypto";
import { JSONObject } from "../../../../Types/JSON";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import logger from "../../Logger";

/*
 * ONEUPTIME AI'S ANSWER, KEPT FOR WHAT IT WAS WRITTEN FROM.
 *
 * What's new (ExceptionDigester) and the duplicate check
 * (ExceptionDuplicateChecker) are written on request and cost AI credits.
 * Asked again about the same exceptions, the answer is the same, so it is
 * kept, keyed by what it was written from: the exceptions the person read,
 * with their occurrence counts. A new occurrence changes the key, so the
 * next ask writes a new answer; a person who may read other exceptions
 * reads them under another key, so nobody is handed an answer about an
 * exception they may not read.
 *
 * Best effort: with the cache down, every ask writes a new answer, as
 * before.
 */

export default class AiAnswerCache {
  // A key for the exact inputs an answer is written from.
  public static key(parts: Array<string>): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(parts))
      .digest("hex");
  }

  public static async get(
    namespace: string,
    key: string,
  ): Promise<JSONObject | null> {
    try {
      return await GlobalCache.getJSONObject(namespace, key);
    } catch (err) {
      logger.debug(`AI answer cache read failed (${namespace}): ${err}`);
      return null;
    }
  }

  public static async set(data: {
    namespace: string;
    key: string;
    value: JSONObject;
    expiresInSeconds: number;
  }): Promise<void> {
    try {
      await GlobalCache.setJSON(data.namespace, data.key, data.value, {
        expiresInSeconds: data.expiresInSeconds,
      });
    } catch (err) {
      logger.debug(`AI answer cache write failed (${data.namespace}): ${err}`);
    }
  }
}
