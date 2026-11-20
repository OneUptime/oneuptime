import MattermostUtil, {
  MattermostRequestError,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A POST THE BOT MADE, DELETED, so what OneUptime AI read in a call's
 * transcript is taken back from the incident's Mattermost channels with the
 * transcript (#9290). One the server answers as not found was deleted
 * already; any other answer is thrown, for the removal to say where the post
 * stays.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POST_ID: string = "q7f8e3jy8ffuzmgyr9xwnw3b1a";

const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: "https://chat.example.com",
  accessToken: "bot-access-token-0123456789",
  teamId: "9tu4c3qtsfgeubgbfqnx5qgyhw",
  botUserId: "fyrf6fb5ijgqjdpsk1dw8nmfkh",
});

let callServer: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  callServer = jest
    .spyOn(MattermostUtil, "callServer")
    .mockResolvedValue({ status: "OK" } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function deleteIt(messageId: string = POST_ID): Promise<void> {
  await MattermostUtil.deleteMessage({
    authToken: AUTH_TOKEN,
    projectId: PROJECT_ID,
    location: { channelId: "4xp9fdt77pncbef59f4k1qe83o" },
    messageId,
  });
}

describe("MattermostUtil.deleteMessage", () => {
  test("deletes the post on the connection's server, as its bot", async () => {
    await deleteIt();

    expect(callServer).toHaveBeenCalledTimes(1);

    const call: JSONObject = callServer.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(call["method"]).toBe(HTTPMethod.DELETE);
    expect(call["path"]).toBe(`/api/v4/posts/${POST_ID}`);
    expect(call["serverUrl"]).toBe("https://chat.example.com");
    expect(call["accessToken"]).toBe("bot-access-token-0123456789");
  });

  test("a post the server no longer has was deleted already", async () => {
    callServer.mockRejectedValue(
      new MattermostRequestError({
        message: "Unable to get the post.",
        statusCode: 404,
        errorId: "app.post.get.app_error",
      }),
    );

    await expect(deleteIt()).resolves.toBeUndefined();
  });

  test("any other answer is thrown: the bot may not delete there", async () => {
    callServer.mockRejectedValue(
      new MattermostRequestError({
        message: "You do not have the appropriate permissions.",
        statusCode: 403,
        errorId: "api.context.permissions.app_error",
      }),
    );

    await expect(deleteIt()).rejects.toThrow(
      "You do not have the appropriate permissions.",
    );
  });

  test("an id that is not a Mattermost id never reaches the server: it is no path of its", async () => {
    await expect(deleteIt("../users/me")).rejects.toThrow(BadDataException);
    expect(callServer).not.toHaveBeenCalled();
  });
});
