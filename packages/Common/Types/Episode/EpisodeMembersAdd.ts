import BadDataException from "../Exception/BadDataException";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * ADDING SEVERAL INCIDENTS OR ALERTS TO AN EPISODE AT ONCE.
 *
 * People group what belongs together by hand: from an incidents or alerts
 * list (select several, then Bulk Actions -> Add to Existing Episode or Add
 * to New Episode) and from an episode's own Incidents or Alerts page (Add
 * Incidents / Add Alerts). Each is one request:
 *
 *   - to an episode that exists, POST ALERT_EPISODE_MEMBERS_ADD_PATH (or the
 *     incident one) with the episode's id and the ids to add. Every id is
 *     checked as the caller - a record they cannot see is not added, and is
 *     answered like one that does not exist - one already in the episode is
 *     left as it is, and the answer says which were added, which were in
 *     the episode already and which were not added, and why
 *     (EpisodeMembersAddResult);
 *   - to a new episode, the episode's own create, with the ids in
 *     miscDataProps (ALERT_IDS_TO_ADD_KEY / INCIDENT_IDS_TO_ADD_KEY). They
 *     are checked before the episode exists - one the caller cannot see
 *     refuses the whole create, so no episode is left behind without some of
 *     what it was created for - and added once it does.
 *
 * The member services add each one through their own create, so a member
 * added this way is the same row, with the same follow-ons on the incident or
 * alert, as one added alone; the episode's side is written once for the
 * batch: one feed entry (and one Slack / Microsoft Teams post) naming them
 * all, one recount, and - adding to an episode that exists - its severity
 * raised to the most severe one added. Adding never changes the episode's
 * state.
 *
 * Shared by the server and the dashboard, so both read the same limits and
 * the same words.
 */

/*
 * The most one request may add. Each one added is a row and a feed entry on
 * its incident or alert, written in the request, and the episode's entry
 * names them all. A list's "Select all" can pick thousands, so above this the
 * dashboard's actions stay on the menu, locked, saying why.
 */
export const MAX_EPISODE_MEMBERS_PER_ADD: number = 100;

/*
 * The routes, under the API's base path. Written out here for the server's
 * router and the dashboard's caller to agree on.
 */
export const ALERT_EPISODE_MEMBERS_ADD_PATH: string =
  "/alert-episode-member/add-alerts";

export const INCIDENT_EPISODE_MEMBERS_ADD_PATH: string =
  "/incident-episode-member/add-incidents";

// The request bodies' keys: the episode, and what to add to it.
export const ALERT_EPISODE_ID_KEY: string = "alertEpisodeId";
export const ALERT_IDS_KEY: string = "alertIds";
export const INCIDENT_EPISODE_ID_KEY: string = "incidentEpisodeId";
export const INCIDENT_IDS_KEY: string = "incidentIds";

/*
 * Creating an episode with what goes in it: an AlertEpisode create carrying
 * `miscDataProps[ALERT_IDS_TO_ADD_KEY]` (an array of alert ids), or an
 * IncidentEpisode create carrying `miscDataProps[INCIDENT_IDS_TO_ADD_KEY]`.
 */
export const ALERT_IDS_TO_ADD_KEY: string = "alertIdsToAdd";
export const INCIDENT_IDS_TO_ADD_KEY: string = "incidentIdsToAdd";

/*
 * Why one was left out. The reasons are the server's words; the dashboard
 * shows them as they are, translated where its language has them.
 */
export const ALREADY_IN_EPISODE_REASON: string = "Already in this episode.";

export const ALERT_NOT_FOUND_REASON: string =
  "This alert does not exist in this project, or you do not have access to it.";

export const INCIDENT_NOT_FOUND_REASON: string =
  "This incident does not exist in this project, or you do not have access to it.";

/*
 * A private alert or incident the caller sees, that their permission to add
 * to episodes does not reach: it is changed only with the permissions of the
 * teams that own it and of the people named as its owners
 * (PrivateRecordPermission).
 */
export const ALERT_PRIVATE_REASON: string =
  "This alert is private, and none of the teams of yours that own it may add it to an episode.";

export const INCIDENT_PRIVATE_REASON: string =
  "This incident is private, and none of the teams of yours that own it may add it to an episode.";

export interface EpisodeMemberNotAdded {
  // The incident's or alert's id, as asked for.
  id: string;
  reason: string;
}

/*
 * What a request to add to an episode did, for each id it named - in the
 * order they were named, each once.
 */
export interface EpisodeMembersAddResult {
  // Added now.
  added: Array<string>;
  // In the episode already: left as they were.
  alreadyInEpisode: Array<string>;
  // Not added, and why.
  notAdded: Array<EpisodeMemberNotAdded>;
}

// What to call what is being added, in a refusal.
export interface EpisodeMemberNouns {
  // "alert" / "incident".
  singular: string;
  // "alerts" / "incidents".
  plural: string;
}

export const ALERT_NOUNS: EpisodeMemberNouns = {
  singular: "alert",
  plural: "alerts",
};

export const INCIDENT_NOUNS: EpisodeMemberNouns = {
  singular: "incident",
  plural: "incidents",
};

export default class EpisodeMembersAdd {
  /*
   * An id as Postgres compares uuids: by value, whatever case or padding it
   * came in.
   */
  public static normalizeId(id: ObjectID | string): string {
    return id.toString().trim().toLowerCase();
  }

  /*
   * The ids a request names: an array of ids (text, or ObjectIDs), each a
   * uuid. Repeats are dropped, the first kept, so each is answered once and
   * in the order it was first named. Refused - before anything is read or
   * written - when it is not an array, holds something that is not an id,
   * names none, or names more than MAX_EPISODE_MEMBERS_PER_ADD.
   */
  public static parseIds(data: {
    value: unknown;
    // The key the ids came under, as a refusal names it.
    key: string;
    nouns: EpisodeMemberNouns;
  }): Array<ObjectID> {
    if (!Array.isArray(data.value)) {
      throw new BadDataException(
        `${data.key} must be an array of ${data.nouns.singular} IDs.`,
      );
    }

    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const value of data.value as Array<unknown>) {
      let id: string = "";

      if (typeof value === "string") {
        id = value.trim();
      } else if (value instanceof ObjectID) {
        id = value.toString().trim();
      }

      if (!id || !ObjectID.isValidUUID(id)) {
        throw new BadDataException(
          `${data.key} must only contain ${data.nouns.singular} IDs.`,
        );
      }

      const key: string = EpisodeMembersAdd.normalizeId(id);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(new ObjectID(key));
    }

    if (ids.length === 0) {
      throw new BadDataException(
        `Please select at least one ${data.nouns.singular} to add to the episode.`,
      );
    }

    if (ids.length > MAX_EPISODE_MEMBERS_PER_ADD) {
      throw new BadDataException(
        `You can add at most ${MAX_EPISODE_MEMBERS_PER_ADD} ${data.nouns.plural} to an episode at a time. ${ids.length} were selected.`,
      );
    }

    return ids;
  }

  /*
   * The episode a request names: one id. Refused when it is missing or is
   * not one.
   */
  public static parseEpisodeId(data: {
    value: unknown;
    key: string;
  }): ObjectID {
    let id: string = "";

    if (typeof data.value === "string") {
      id = data.value.trim();
    } else if (data.value instanceof ObjectID) {
      id = data.value.toString().trim();
    }

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(
        `${data.key} must be the ID of the episode to add to.`,
      );
    }

    return new ObjectID(EpisodeMembersAdd.normalizeId(id));
  }

  public static emptyResult(): EpisodeMembersAddResult {
    return {
      added: [],
      alreadyInEpisode: [],
      notAdded: [],
    };
  }

  public static toJSON(result: EpisodeMembersAddResult): JSONObject {
    return {
      added: [...result.added],
      alreadyInEpisode: [...result.alreadyInEpisode],
      notAdded: result.notAdded.map(
        (notAdded: EpisodeMemberNotAdded): JSONObject => {
          return {
            id: notAdded.id,
            reason: notAdded.reason,
          };
        },
      ),
    };
  }

  /*
   * An answer read back in the dashboard. Anything that is not the shape
   * above is left out rather than trusted.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): EpisodeMembersAddResult {
    const readIds: (value: JSONValue | undefined) => Array<string> = (
      value: JSONValue | undefined,
    ): Array<string> => {
      if (!Array.isArray(value)) {
        return [];
      }

      return (value as Array<unknown>).filter(
        (item: unknown): item is string => {
          return typeof item === "string" && item.length > 0;
        },
      );
    };

    const notAdded: Array<EpisodeMemberNotAdded> = [];

    if (Array.isArray(json?.["notAdded"])) {
      for (const item of json?.["notAdded"] as Array<unknown>) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const id: JSONValue | undefined = (item as JSONObject)["id"];
        const reason: JSONValue | undefined = (item as JSONObject)["reason"];

        if (typeof id === "string" && id) {
          notAdded.push({
            id: id,
            reason: typeof reason === "string" ? reason : "",
          });
        }
      }
    }

    return {
      added: readIds(json?.["added"]),
      alreadyInEpisode: readIds(json?.["alreadyInEpisode"]),
      notAdded: notAdded,
    };
  }
}
