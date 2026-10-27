import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * The custom channels on a person's screens: read from the server's list of
 * the ones that are on (their ids and names, nothing else), shown on their
 * own tab of Notification Methods only when there are any, each with a
 * sentence on how it reaches the person and a Send test that sends one in
 * their project, as them.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CORPO_APP_ID: string = "6a1f1b4e-9f0c-4d8e-8b2a-3c4d5e6f7a8b";
const PAGER_ID: string = "7b2a2c5f-0a1d-4e9f-9c3b-4d5e6f7a8b9c";

const postMock: jest.Mock = jest.fn();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : "Something went wrong.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return { toString: (): string => PROJECT_ID };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getEmail: () => {
        return { toString: (): string => "jane@example.com" };
      },
    },
  };
});

import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  loadCustomNotificationChannels,
  readCustomNotificationChannels,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CustomNotificationChannels";
import CustomChannels, {
  CUSTOM_CHANNELS_CARD_TEST_ID,
  getCustomChannelReachSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/CustomChannels";

function availableAnswer(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      channels: [
        { _id: CORPO_APP_ID, name: "CorpoApp", pageEveryoneByDefault: true },
        { _id: PAGER_ID, name: "Pager", pageEveryoneByDefault: false },
      ],
    },
    {},
  );
}

function model(
  id: string,
  name: string,
  pageEveryoneByDefault: boolean,
): CustomNotificationChannel {
  const channel: CustomNotificationChannel = new CustomNotificationChannel();
  channel.id = new ObjectID(id);
  channel.name = name;
  channel.pageEveryoneByDefault = pageEveryoneByDefault;
  return channel;
}

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("readCustomNotificationChannels", () => {
  test("turns the server's list into channels, by id and name", () => {
    const channels: Array<CustomNotificationChannel> =
      readCustomNotificationChannels(availableAnswer().data as JSONObject);

    expect(
      channels.map((channel: CustomNotificationChannel) => {
        return {
          id: channel.id?.toString(),
          name: channel.name,
          pageEveryoneByDefault: channel.pageEveryoneByDefault,
          isEnabled: channel.isEnabled,
        };
      }),
    ).toEqual([
      {
        id: CORPO_APP_ID,
        name: "CorpoApp",
        pageEveryoneByDefault: true,
        isEnabled: true,
      },
      {
        id: PAGER_ID,
        name: "Pager",
        pageEveryoneByDefault: false,
        isEnabled: true,
      },
    ]);
  });

  test("drops an entry without a valid id", () => {
    expect(
      readCustomNotificationChannels({
        channels: [
          { _id: "not-a-uuid", name: "Broken" },
          { name: "No id" },
          null,
          { _id: CORPO_APP_ID, name: "CorpoApp" },
        ] as Array<JSONObject>,
      }),
    ).toHaveLength(1);
  });

  test("an answer with no list is no channels", () => {
    expect(readCustomNotificationChannels({})).toEqual([]);
  });

  test("a channel whose answer leaves out paging everyone pages everyone, as the column defaults", () => {
    const [channel] = readCustomNotificationChannels({
      channels: [{ _id: CORPO_APP_ID, name: "CorpoApp" }],
    });

    expect(channel?.pageEveryoneByDefault).toBe(true);
  });
});

describe("loadCustomNotificationChannels", () => {
  test("reads the channels that are on from the server's list", async () => {
    postMock.mockResolvedValue(availableAnswer());

    const channels: Array<CustomNotificationChannel> =
      await loadCustomNotificationChannels();

    expect(channels).toHaveLength(2);
    expect(postMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = postMock.mock.calls[0]![0] as never;
    expect(String(request["url"])).toContain(
      "/custom-notification-channel/available",
    );
  });

  test("two screens asking at once share one read", async () => {
    postMock.mockResolvedValue(availableAnswer());

    const [first, second] = await Promise.all([
      loadCustomNotificationChannels(),
      loadCustomNotificationChannels(),
    ]);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });

  test("a screen that asks later reads again: a channel may have been added", async () => {
    postMock.mockResolvedValue(availableAnswer());

    await loadCustomNotificationChannels();
    await loadCustomNotificationChannels();

    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("a read that fails says so", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(500, { message: "nope" }, {}),
    );

    await expect(loadCustomNotificationChannels()).rejects.toThrow();
  });
});

describe("getCustomChannelReachSentence", () => {
  test("a channel that pages everyone is already in the person's rules", () => {
    expect(
      getCustomChannelReachSentence(model(CORPO_APP_ID, "CorpoApp", true)),
    ).toBe(
      "Already in your on-call rules: your administrator pages everyone through it.",
    );
  });

  test("one people choose is theirs to add", () => {
    expect(getCustomChannelReachSentence(model(PAGER_ID, "Pager", false))).toBe(
      "Add it to your on-call rules to be paged through it.",
    );
  });
});

describe("the Custom Channels card", () => {
  function renderCard(): void {
    render(
      <CustomChannels
        channels={[
          model(CORPO_APP_ID, "CorpoApp", true),
          model(PAGER_ID, "Pager", false),
        ]}
      />,
    );
  }

  test("lists each channel by name, with how it reaches the person", () => {
    renderCard();

    expect(screen.getByTestId(CUSTOM_CHANNELS_CARD_TEST_ID)).toBeInTheDocument();
    expect(screen.getByText("CorpoApp")).toBeInTheDocument();
    expect(screen.getByText("Pager")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Already in your on-call rules: your administrator pages everyone through it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add it to your on-call rules to be paged through it."),
    ).toBeInTheDocument();
  });

  test("says pages go to the channels as the signed-in person", () => {
    renderCard();

    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
  });

  test("Send test sends a test to that channel, in the person's project, and shows the answer", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: true, statusMessage: "Sent to CorpoApp (HTTP 200)." },
        {},
      ),
    );

    renderCard();

    fireEvent.click(screen.getAllByText("Send test")[0]!);

    await waitFor(() => {
      expect(
        screen.getByText("Sent to CorpoApp (HTTP 200)."),
      ).toBeInTheDocument();
    });

    const request: Record<string, unknown> = postMock.mock.calls[0]![0] as never;
    expect(String(request["url"])).toContain(
      "/custom-notification-channel/test",
    );
    expect(request["data"]).toEqual({
      customNotificationChannelId: CORPO_APP_ID,
      projectId: PROJECT_ID,
    });
  });

  test("a test that was not delivered shows why", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          ok: false,
          statusMessage: "Not delivered: CorpoApp answered HTTP 503.",
        },
        {},
      ),
    );

    renderCard();

    fireEvent.click(screen.getAllByText("Send test")[0]!);

    await waitFor(() => {
      expect(
        screen.getByText("Not delivered: CorpoApp answered HTTP 503."),
      ).toBeInTheDocument();
    });
  });
});
