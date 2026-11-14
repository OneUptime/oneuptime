import { JSONObject } from "../../JSON";

/*
 * What became of a summary's Send Test Now in one of its channels: posted,
 * or not, with why in the workspace's own words ("The Slack channel #ops
 * was not found. ..."). The test route answers a test that a channel did not
 * get with a 400 whose `message` says it all in English - for the API and
 * the logs - and whose `channels` say it channel by channel, for the
 * Dashboard to list in the reader's language
 * (WorkspaceNotificationSummaryService.testSummary).
 */
export interface WorkspaceSummaryTestChannel {
  // The channel as the summary names it.
  channelName: string;
  isPosted: boolean;
  // Why nothing was posted in it.
  reason?: string | undefined;
}

// The key of the channels in the test route's answer.
export const WORKSPACE_SUMMARY_TEST_CHANNELS_KEY: string = "channels";

/*
 * The channels of a Send Test Now answer, read from its JSON body. None
 * when the answer has none - a test refused before anything was posted
 * ("The summary has no channel to post in."), a network error, a server
 * from before the answer had them - and none for a body that is not this
 * shape: the dialog then says the answer's message, as it always did.
 */
export const getWorkspaceSummaryTestChannels: (
  body: unknown,
) => Array<WorkspaceSummaryTestChannel> = (
  body: unknown,
): Array<WorkspaceSummaryTestChannel> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const channels: unknown = (body as JSONObject)[
    WORKSPACE_SUMMARY_TEST_CHANNELS_KEY
  ];

  if (!Array.isArray(channels)) {
    return [];
  }

  const read: Array<WorkspaceSummaryTestChannel> = [];

  for (const channel of channels) {
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
      return [];
    }

    const channelName: unknown = (channel as JSONObject)["channelName"];
    const isPosted: unknown = (channel as JSONObject)["isPosted"];
    const reason: unknown = (channel as JSONObject)["reason"];

    if (typeof channelName !== "string" || typeof isPosted !== "boolean") {
      return [];
    }

    read.push({
      channelName: channelName,
      isPosted: isPosted,
      reason:
        typeof reason === "string" && reason.trim() ? reason.trim() : undefined,
    });
  }

  return read;
};
