import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../../Types/Workspace/SavedChatMessage";
import { FeedItemProps } from "./FeedItem";

/*
 * WHO A FEED ENTRY IS BY, WHEN IT IS A NOTE SAVED FROM A CHAT MESSAGE.
 *
 * Nitin pins a message Aidil wrote in the incident's Slack channel, and the
 * note's entry reads "Aidil Rahman posted private note for this Incident
 * INC-8 via Slack (note added by Nitin Kumar)": the server writes that
 * sentence, and the row's user is Nitin, who saved it. So the entry is led
 * by Aidil - his OneUptime picture and name when his Slack account is
 * connected to the project, else the name Slack shows, with a blank
 * picture (FeedItemProps.authorName) - not by Nitin's picture before
 * Aidil's words. Any other entry is led by its user, as always.
 */
export const getSavedChatMessageFeedAuthor: (data: {
  // The row's savedFromChatMessage column, as the API hands it over.
  savedFromChatMessage: unknown;
  // The row's user: whoever saved the note, or did what the entry says.
  user?: User | undefined;
}) => Pick<FeedItemProps, "user" | "authorName"> = (data: {
  savedFromChatMessage: unknown;
  user?: User | undefined;
}): Pick<FeedItemProps, "user" | "authorName"> => {
  const saved: SavedChatMessage | null = SavedChatMessageUtil.read(
    data.savedFromChatMessage,
  );

  if (!saved) {
    return { user: data.user };
  }

  const authorName: string = saved.authorName || "Someone";

  // A connected member: their picture, by their user id, and their name.
  if (saved.authorUserId) {
    const author: User = new User();
    author.id = new ObjectID(saved.authorUserId);
    author.name = new Name(authorName);
    return { user: author };
  }

  return { user: data.user, authorName: authorName };
};

export default getSavedChatMessageFeedAuthor;
