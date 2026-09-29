/*
 * ---------------------------------------------------------------------------
 * The Runner's sign-off on a clean shutdown.
 *
 * The server only re-keys a kubernetes-agent Runner that is offline (or that
 * presents its current key), so without this call a rolling restart of the
 * agent pod would leave the replacement waiting for the previous instance's
 * last heartbeat to age out of the alive window. Saying goodbye marks the
 * row offline at once. It is best effort: an older server without the route
 * answers 404 and nothing breaks.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";

type PostMock = jest.Mock;

const post: PostMock = jest.fn();

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      create: (): { post: PostMock } => {
        return { post };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import AgentClient from "../../Services/RunnerClient";
import RunnerIdentity from "../../Utils/RunnerIdentity";

beforeEach(() => {
  post.mockReset();
});

describe("AgentClient.disconnect", () => {
  test("posts the Runner's credentials to /disconnect and reports acceptance", async () => {
    post.mockResolvedValue({ status: 200, data: { status: "ok" } });

    await expect(AgentClient.disconnect()).resolves.toBe(true);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/disconnect");

    const body: JSONObject = post.mock.calls[0]![1] as JSONObject;
    expect(body["agentId"]).toBe(RunnerIdentity.getRunnerId().toString());
    expect(body["agentKey"]).toBe(RunnerIdentity.getRunnerKey());
  });

  test("an older server without the route is a soft failure, not an exception", async () => {
    post.mockResolvedValue({ status: 404, data: {} });

    await expect(AgentClient.disconnect()).resolves.toBe(false);
  });

  test("a rejected identity is a soft failure too", async () => {
    post.mockResolvedValue({ status: 400, data: { message: "bad key" } });

    await expect(AgentClient.disconnect()).resolves.toBe(false);
  });
});
