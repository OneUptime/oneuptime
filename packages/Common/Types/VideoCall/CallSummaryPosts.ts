import { JSONArray, JSONObject } from "../JSON";
import WorkspacePostedMessage, {
  readWorkspacePostedMessage,
  toWorkspacePostedMessageJSON,
} from "../Workspace/WorkspacePostedMessage";

/*
 * WHERE ONEUPTIME POSTED WHAT ONEUPTIME AI READ IN A CALL'S TRANSCRIPT
 * (IncidentVideoCall.callSummaryPosts, issues #9289 and #9290).
 *
 * A reading of a transcript is stored on the call, and also posted: an item
 * in the incident's feed, which from there goes to the incident's Slack,
 * Microsoft Teams and Mattermost channels (IncidentCallSummaryFeed). Each
 * reading keeps where it went - the feed item and each channel message -
 * so that removing the transcript takes all of it back, and so does the
 * provider account that read the transcript removing OneUptime
 * (IncidentCallTranscriptRemoval).
 *
 * A reading of a transcript OneUptime read through someone's sign-in
 * names that account (signInAccountId): when it removes OneUptime, what
 * was read through it goes, and what a person added stays.
 */
export interface CallSummaryPost {
  // The incident's feed item (IncidentFeed) that said what was read.
  feedId?: string | undefined;
  // When it was posted: ISO 8601.
  postedAt: string;
  /*
   * The account at the provider (a Zoom user ID) whose sign-in read the
   * transcript this reading was of. Absent for a transcript a person
   * added, or one read with a project's own app.
   */
  signInAccountId?: string | undefined;
  // Each message the feed item was posted as in the incident's channels.
  messages: Array<WorkspacePostedMessage>;
}

function readPost(value: unknown): CallSummaryPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const feedId: unknown = json["feedId"];
  const postedAt: unknown = json["postedAt"];
  const signInAccountId: unknown = json["signInAccountId"];
  const messages: unknown = json["messages"];

  return {
    ...(typeof feedId === "string" && feedId ? { feedId } : {}),
    postedAt: typeof postedAt === "string" ? postedAt : "",
    ...(typeof signInAccountId === "string" && signInAccountId
      ? { signInAccountId }
      : {}),
    messages: Array.isArray(messages)
      ? messages
          .map((message: unknown): WorkspacePostedMessage | null => {
            return readWorkspacePostedMessage(message);
          })
          .filter(
            (
              message: WorkspacePostedMessage | null,
            ): message is WorkspacePostedMessage => {
              return message !== null;
            },
          )
      : [],
  };
}

export default class CallSummaryPosts {
  /*
   * The posts a call's column holds, keeping only what is well formed. An
   * empty list for a call that holds none, or a column OneUptime did not
   * write: a reading posted before the column existed holds nothing here
   * (IncidentCallTranscriptRemoval finds its feed item by what it says).
   */
  public static read(value: unknown): Array<CallSummaryPost> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const posts: unknown = (value as JSONObject)["posts"];

    if (!Array.isArray(posts)) {
      return [];
    }

    return posts
      .map((post: unknown): CallSummaryPost | null => {
        return readPost(post);
      })
      .filter((post: CallSummaryPost | null): post is CallSummaryPost => {
        return post !== null;
      });
  }

  // Whether the column holds a record at all, even of no posts.
  public static isKept(value: unknown): boolean {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as JSONObject)["posts"])
    );
  }

  // One post as the column keeps it.
  public static toPostJSON(post: CallSummaryPost): JSONObject {
    const json: JSONObject = {
      postedAt: post.postedAt,
      messages: post.messages.map(
        (message: WorkspacePostedMessage): JSONObject => {
          return toWorkspacePostedMessageJSON(message);
        },
      ) as JSONArray,
    };

    if (post.feedId) {
      json["feedId"] = post.feedId;
    }

    if (post.signInAccountId) {
      json["signInAccountId"] = post.signInAccountId;
    }

    return json;
  }

  // The column's value for these posts: null when there are none left.
  public static toValue(posts: Array<CallSummaryPost>): JSONObject | null {
    if (posts.length === 0) {
      return null;
    }

    return {
      posts: posts.map((post: CallSummaryPost): JSONObject => {
        return CallSummaryPosts.toPostJSON(post);
      }) as JSONArray,
    };
  }

  /*
   * The posts of what was read in transcripts that `accountId`'s sign-in
   * read, and the rest: what the account removing OneUptime takes, and
   * what it leaves.
   */
  public static splitBySignIn(
    posts: Array<CallSummaryPost>,
    accountId: string,
  ): {
    readThroughSignIn: Array<CallSummaryPost>;
    rest: Array<CallSummaryPost>;
  } {
    const readThroughSignIn: Array<CallSummaryPost> = [];
    const rest: Array<CallSummaryPost> = [];

    for (const post of posts) {
      if (accountId && post.signInAccountId === accountId) {
        readThroughSignIn.push(post);
      } else {
        rest.push(post);
      }
    }

    return { readThroughSignIn, rest };
  }
}
