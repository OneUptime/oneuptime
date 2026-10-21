import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHO AN INCIDENT FEED ITEM IS BY, WHEN NO PERSON MADE THE CHANGE: THE
 * PROJECT API KEY THAT DID (IncidentFeed.apiKeyId and apiKeyName).
 *
 * A request made with a project API key carries no user - it is no person -
 * so a feed item about what it did used to show no author at all: an
 * incident Jira Automation opened through POST /api/incident read the same
 * as one OneUptime opened itself. The key's id and name come with the
 * request (ProjectAuthorization puts them in its props, for the audit log),
 * and the item keeps the name the key had then, as the audit log does, so a
 * key renamed or deleted later leaves the history as it was.
 *
 * Only a project API key counts:
 *   - a person's request carries their user, which the feed already shows;
 *   - the master API key carries the server admin it acts for, and no
 *     apiKeyId;
 *   - an MCP client acts for the member who connected it.
 */

export interface FeedApiKeyActor {
  apiKeyId?: ObjectID | undefined;
  apiKeyName?: string | undefined;
}

// What a key with no name is called.
export const UNNAMED_API_KEY_NAME: string = "API key";

const FeedApiKeyActorUtil: {
  fromProps: (
    props: DatabaseCommonInteractionProps | null | undefined,
  ) => FeedApiKeyActor;
  toProps: (
    actor: FeedApiKeyActor | null | undefined,
  ) => Pick<DatabaseCommonInteractionProps, "apiKeyId" | "apiKeyName">;
} = {
  fromProps: (
    props: DatabaseCommonInteractionProps | null | undefined,
  ): FeedApiKeyActor => {
    if (!props || props.userId || !props.apiKeyId) {
      return {};
    }

    const name: string = (props.apiKeyName || "").trim();

    return {
      apiKeyId: props.apiKeyId,
      apiKeyName: (name || UNNAMED_API_KEY_NAME).slice(
        0,
        ColumnLength.ShortText,
      ),
    };
  },

  /*
   * The key, for a write OneUptime makes itself on the key's behalf (a root
   * write that follows from the key's request, such as an incident's first
   * state): carried so that write's feed item names the key too. Only the
   * key: the write stays OneUptime's.
   */
  toProps: (
    actor: FeedApiKeyActor | null | undefined,
  ): Pick<DatabaseCommonInteractionProps, "apiKeyId" | "apiKeyName"> => {
    if (!actor?.apiKeyId) {
      return {};
    }

    return {
      apiKeyId: actor.apiKeyId,
      apiKeyName: actor.apiKeyName,
    };
  },
};

export default FeedApiKeyActorUtil;
