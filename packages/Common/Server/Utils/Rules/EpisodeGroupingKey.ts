import crypto from "crypto";
import ObjectID from "../../../Types/ObjectID";
import { EncryptionSecret } from "../../EnvironmentConfig";

/*
 * THE TITLE IN AN EPISODE'S GROUPING KEY.
 *
 * A grouping rule that groups by title puts the title of the incident (or
 * alert) it matches in the grouping key (getTitlePart), and the episode it
 * opens is stored with that key - IncidentEpisode.groupingKey,
 * AlertEpisode.groupingKey - for the records that come after it to find it
 * by. The episode is not private even when the record that opens it is, and
 * its key is read with it, through the API, by everyone who can see it. So an
 * episode a private record opens is stored with the title in its key hashed
 * (hashTitle): an HMAC under a key derived from ENCRYPTION_SECRET, which
 * neither gives the title away nor lets a reader confirm a guess at a short
 * one by hashing it themselves.
 *
 * Grouping is unchanged. The hash is of the title as the key reads it - case
 * and numbers ignored - and a record is matched against both forms of its
 * key (the engines' getGroupingKeysToMatch): a record that is not private
 * joins the episode a private one opened, a private one joins an episode one
 * that is not private opened, and both still find an episode opened before
 * titles were hashed, which is stored with the title as it reads.
 *
 * The hash is only as secret as ENCRYPTION_SECRET, and changes with it: an
 * episode a private record opened before the secret changed is not found by
 * the records that come after, which open an episode of their own.
 */

/*
 * The label the hashing key is derived under, so the key hashes nothing else.
 * Changing it changes every hash, as changing the secret does.
 */
const TITLE_HASH_KEY_DERIVATION_LABEL: string =
  "oneuptime-episode-grouping-key-title";

export default class EpisodeGroupingKey {
  /*
   * What a rule that groups by title adds to the grouping key: the title,
   * lowercased, with every number an X - so "Disk 91% full" and "Disk 95%
   * full" go into the same episode.
   */
  public static getTitlePart(title: string): string {
    return `title:${EpisodeGroupingKey.normalizeTitle(title)}`;
  }

  /*
   * The title part as an episode a private record opened is stored with it:
   * a keyed hash of the title as getTitlePart reads it, so titles that group
   * together hash alike. The project's id is hashed with it, so one project's
   * hash of a title is not another's.
   */
  public static getHashedTitlePart(data: {
    projectId: ObjectID;
    title: string;
  }): string {
    /*
     * Derived per call rather than cached, as McpOAuthSignedToken's key is,
     * so a process that has its secret swapped under it (tests, above all)
     * never hashes with a stale one.
     */
    const key: Buffer = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(TITLE_HASH_KEY_DERIVATION_LABEL)
      .digest();

    const hash: string = crypto
      .createHmac("sha256", key)
      .update(
        `${data.projectId.toString()}:${EpisodeGroupingKey.normalizeTitle(data.title)}`,
      )
      .digest("hex");

    return `titleHmac:${hash}`;
  }

  /*
   * `groupingKey`, built with `title` in it, with the title part hashed
   * (getHashedTitlePart) and every other part as built. The title part is
   * found by its text, which no other part holds - they are a name and ids -
   * and is put back literally, so nothing in a title reads as a pattern. A
   * key built without the title comes back as it is.
   */
  public static hashTitle(data: {
    groupingKey: string;
    projectId: ObjectID;
    title: string;
  }): string {
    return data.groupingKey
      .split(EpisodeGroupingKey.getTitlePart(data.title))
      .join(
        EpisodeGroupingKey.getHashedTitlePart({
          projectId: data.projectId,
          title: data.title,
        }),
      );
  }

  private static normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/\d+/g, "X");
  }
}
