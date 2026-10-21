import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A SCREENSHOT IN A MICROSOFT TEAMS MESSAGE.
 *
 * The description Markdown went into an adaptive card's text block as it
 * was, so a screenshot's base64 - 30 KB to 2 MB of it - made the card more
 * than Teams takes from a bot, and the whole message was refused. Now each
 * screenshot is an Image element of the card, from its data: URL, where the
 * description had it (Teams leaves base64 images out of a message's size),
 * and the text around it is text blocks without it. A card Teams refuses
 * anyway as too large or as a bad request is sent again with each image as
 * its alt text; an image Teams does not take - a WebP, one over 1 MB, one
 * past what a card carries - is its alt text from the start; and the paths
 * that show no image (incoming webhooks, text blocks) never get the base64.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsInlineImages from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsInlineImages";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import logger from "../../../../../Server/Utils/Logger";
import API from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { MicrosoftTeamsChat } from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";

const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const WEBP: string =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
const DATA_URL: string = `data:image/png;base64,${PNG}`;

const TEAM_ID: string = "team-1";
const CHANNEL_ID: string = "19:incidents@thread.tacv2";
const CHAT_ID: string = "19:oncall@thread.v2";

// A PNG of this many bytes: the PNG signature, then other bytes.
function pngOfSize(byteLength: number): string {
  const bytes: Buffer = Buffer.alloc(byteLength);

  for (let index: number = 0; index < byteLength; index++) {
    bytes[index] = (index * 7919 + 13) % 256;
  }

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);

  return bytes.toString("base64");
}

// A different small PNG for each number.
function smallPng(seed: number): string {
  return Buffer.concat([
    Buffer.from(PNG, "base64"),
    Buffer.from([seed % 256, Math.floor(seed / 256)]),
  ]).toString("base64");
}

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text: text };
}

function buttons(): WorkspacePayloadButtons {
  return {
    _type: "WorkspacePayloadButtons",
    buttons: [
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "View Incident",
        value: "incident-id",
        actionId: "ViewIncident",
        url: URL.fromString("https://oneuptime.test/dashboard/incidents/1"),
      },
    ],
  };
}

function incidentCreatedFeed(description: string): string {
  return `#### 🚨 Incident #12 Created:\n\n**Checkout is down**:\n\n${description}\n\n🔴 **Incident State**: Created \n\n`;
}

// A Bot Framework refusal, as the connector throws one.
function teamsError(statusCode: number, code: string): Error {
  return Object.assign(new Error(`Teams answered ${statusCode}`), {
    statusCode: statusCode,
    code: code,
  });
}

function mockChannel(): void {
  jest
    .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
    .mockResolvedValue({
      id: CHANNEL_ID,
      name: "incidents",
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAM_ID,
    });
}

/*
 * The channel send, answering each card as `answer` says: a thread, or an
 * error to throw. Every card sent is kept, in order.
 */
function mockChannelSend(
  answer?: (card: JSONObject, attempt: number) => Error | null,
): Array<JSONObject> {
  const cards: Array<JSONObject> = [];

  jest
    .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
    .mockImplementation(
      async (args: {
        workspaceChannel: WorkspaceChannel;
        adaptiveCard: JSONObject;
      }): Promise<WorkspaceThread> => {
        cards.push(args.adaptiveCard);

        const error: Error | null = answer
          ? answer(args.adaptiveCard, cards.length)
          : null;

        if (error) {
          throw error;
        }

        return {
          channel: args.workspaceChannel,
          threadId: `thread-${cards.length}`,
        };
      },
    );

  return cards;
}

async function sendToChannel(
  messageBlocks: Array<WorkspaceMessageBlock>,
): Promise<WorkspaceSendMessageResponse> {
  return await MicrosoftTeamsUtil.sendMessage({
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [CHANNEL_ID],
      messageBlocks: messageBlocks,
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAM_ID,
    },
    authToken: "auth-token",
    userId: "user-1",
    projectId: ObjectID.generate(),
  });
}

function bodyOf(card: JSONObject): Array<JSONObject> {
  return card["body"] as Array<JSONObject>;
}

function imagesOf(card: JSONObject): Array<JSONObject> {
  return bodyOf(card).filter((element: JSONObject): boolean => {
    return element["type"] === "Image";
  });
}

function textsOf(card: JSONObject): Array<string> {
  return bodyOf(card)
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return element["text"] as string;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsUtil.sendMessage - a screenshot in the card", () => {
  test("the Incident Created message: the screenshot between its text, in the card", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend();

    const response: WorkspaceSendMessageResponse = await sendToChannel([
      markdown(
        incidentCreatedFeed(
          `Timeout 30000ms exceeded\n![Login page](${DATA_URL})`,
        ),
      ),
      buttons(),
    ]);

    expect(response.errors).toEqual([]);
    expect(response.threads).toHaveLength(1);
    expect(cards).toHaveLength(1);

    const body: Array<JSONObject> = bodyOf(cards[0]!);

    expect(
      body.map((element: JSONObject): unknown => {
        return element["type"];
      }),
    ).toEqual(["TextBlock", "Image", "TextBlock"]);
    expect(body[1]).toEqual({
      type: "Image",
      url: DATA_URL,
      altText: "Login page",
      msTeams: { allowExpand: true },
    });
    expect(textsOf(cards[0]!)[0]).toContain("Timeout 30000ms exceeded");
    expect(textsOf(cards[0]!)[1]).toContain("Incident State");
    expect(JSON.stringify(textsOf(cards[0]!))).not.toContain(PNG);
    expect(cards[0]!["actions"]).toEqual([
      {
        type: "Action.OpenUrl",
        title: "View Incident",
        url: "https://oneuptime.test/dashboard/incidents/1",
      },
    ]);
  });

  test("the issue's template, with no alt text: the image after the error", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend();

    await sendToChannel([
      markdown(`Timeout 30000ms exceeded\n![](${DATA_URL})`),
    ]);

    expect(bodyOf(cards[0]!)).toEqual([
      {
        type: "TextBlock",
        text: "Timeout 30000ms exceeded",
        wrap: true,
        markdown: true,
      },
      {
        type: "Image",
        url: DATA_URL,
        altText: "Image",
        msTeams: { allowExpand: true },
      },
    ]);
  });

  test.each([
    ["as too large", teamsError(413, "MessageSizeTooBig")],
    ["as a bad request", teamsError(400, "BadArgument")],
  ])(
    "a card Teams refuses %s is sent again with each image as its alt text",
    async (_label: string, error: Error) => {
      mockChannel();
      const cards: Array<JSONObject> = mockChannelSend(
        (_card: JSONObject, attempt: number): Error | null => {
          return attempt === 1 ? error : null;
        },
      );
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation((): void => {});

      const response: WorkspaceSendMessageResponse = await sendToChannel([
        markdown(`Timeout\n![Login page](${DATA_URL})\n\nAfter`),
      ]);

      expect(response.errors).toEqual([]);
      expect(response.threads).toHaveLength(1);
      expect(cards).toHaveLength(2);
      expect(imagesOf(cards[0]!)).toHaveLength(1);
      expect(imagesOf(cards[1]!)).toEqual([]);
      expect(textsOf(cards[1]!)).toEqual(["Timeout", "Login page", "After"]);
      expect(JSON.stringify(cards[1])).not.toContain(PNG);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("sending it with each image as its alt text"),
      );
    },
  );

  test("any other refusal is reported as before, and the card is not sent twice", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend((): Error => {
      return teamsError(403, "Forbidden");
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const response: WorkspaceSendMessageResponse = await sendToChannel([
      markdown(`![Login page](${DATA_URL})`),
    ]);

    expect(cards).toHaveLength(1);
    expect(response.threads).toEqual([]);
    expect(response.errors).toHaveLength(1);
  });

  test("a card without images that Teams refuses is not sent twice either", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend((): Error => {
      return teamsError(413, "MessageSizeTooBig");
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const response: WorkspaceSendMessageResponse = await sendToChannel([
      markdown("No screenshot here"),
    ]);

    expect(cards).toHaveLength(1);
    expect(response.errors).toHaveLength(1);
  });

  test("an image Teams does not take is its alt text from the start", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend();
    const tooLarge: string = pngOfSize(
      MicrosoftTeamsInlineImages.MAX_IMAGE_BYTES + 1,
    );

    await sendToChannel([
      markdown(
        [
          `![a WebP](data:image/webp;base64,${WEBP})`,
          "",
          `![too large](data:image/png;base64,${tooLarge})`,
          "",
          `![shown](${DATA_URL})`,
        ].join("\n"),
      ),
    ]);

    expect(
      bodyOf(cards[0]!).map((element: JSONObject): unknown => {
        return element["type"] === "Image"
          ? `Image ${element["altText"]}`
          : element["text"];
      }),
    ).toEqual(["a WebP", "too large", "Image shown"]);
    expect(JSON.stringify(cards[0])).not.toContain(tooLarge.slice(0, 100));
  });

  test("a card carries at most MAX_IMAGES_PER_CARD images and MAX_IMAGE_BYTES_PER_CARD bytes", async () => {
    mockChannel();
    const cards: Array<JSONObject> = mockChannelSend();

    const manyImages: string = Array.from(
      { length: MicrosoftTeamsInlineImages.MAX_IMAGES_PER_CARD + 2 },
      (_value: unknown, index: number): string => {
        return `![shot ${index}](data:image/png;base64,${smallPng(index)})`;
      },
    ).join("\n\n");

    await sendToChannel([markdown(manyImages)]);

    expect(imagesOf(cards[0]!)).toHaveLength(
      MicrosoftTeamsInlineImages.MAX_IMAGES_PER_CARD,
    );
    expect(textsOf(cards[0]!)).toEqual(["shot 10", "shot 11"]);

    const nearlyAMegabyte: number =
      MicrosoftTeamsInlineImages.MAX_IMAGE_BYTES - 1024;
    const bigOnes: string = [0, 1, 2]
      .map((index: number): string => {
        const png: Buffer = Buffer.from(pngOfSize(nearlyAMegabyte), "base64");

        png[png.length - 1] = index;

        return `![big ${index}](data:image/png;base64,${png.toString("base64")})`;
      })
      .join("\n\n");

    await sendToChannel([markdown(bigOnes)]);

    // Two fit within the card's bytes; the third is its alt text.
    expect(imagesOf(cards[1]!)).toHaveLength(2);
    expect(textsOf(cards[1]!)).toEqual(["big 2"]);
  });

  test("a group chat gets the screenshot the same way", async () => {
    const chat: MicrosoftTeamsChat = {
      id: CHAT_ID,
      name: "On-call",
      chatType: "groupChat",
    } as MicrosoftTeamsChat;

    jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockResolvedValue({ [CHAT_ID]: chat });

    const cards: Array<JSONObject> = [];

    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockImplementation(
        async (args: {
          adaptiveCard: JSONObject;
        }): Promise<WorkspaceThread> => {
          cards.push(args.adaptiveCard);
          return {
            channel: {
              id: CHAT_ID,
              name: "On-call",
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: "chat-thread",
          };
        },
      );

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          channelNames: [],
          channelIds: [],
          chatIds: [CHAT_ID],
          messageBlocks: [markdown(`Down\n![Login page](${DATA_URL})`)],
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(response.errors).toEqual([]);
    expect(imagesOf(cards[0]!)).toEqual([
      {
        type: "Image",
        url: DATA_URL,
        altText: "Login page",
        msTeams: { allowExpand: true },
      },
    ]);
  });
});

describe("Microsoft Teams paths that show no image get the alt text", () => {
  test("a text block", () => {
    expect(
      MicrosoftTeamsUtil.getMarkdownBlock({
        payloadMarkdownBlock: markdown(`Timeout\n![Login page](${DATA_URL})`),
      }),
    ).toEqual({
      type: "TextBlock",
      text: "Timeout\nLogin page",
      wrap: true,
      markdown: true,
    });
  });

  test("an incoming webhook's card", async () => {
    const post: jest.SpyInstance = jest.spyOn(API, "post").mockResolvedValue({
      jsonData: {},
    } as unknown as HTTPResponse<JSONObject>);

    await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
      url: URL.fromString("https://example.webhook.office.com/webhookb2/abc"),
      text: `**New incident**: Checkout is down\n\n**Description:** Down ![Login page](${DATA_URL})\n\n[Download](${DATA_URL})`,
    });

    const card: string = JSON.stringify(post.mock.calls[0]![0]);

    expect(card).not.toContain(PNG);
    expect(card).not.toContain("data:image");
    expect(card).toContain("Login page");
    expect(card).toContain("Download");
  });
});

describe("MicrosoftTeamsInlineImages", () => {
  test("Teams takes PNG, JPEG and GIF of up to 1 MB", () => {
    const png: { mimeType: string; byteLength: number } = {
      mimeType: "image/png",
      byteLength: 1024,
    };

    expect(MicrosoftTeamsInlineImages.isShownByTeams(png as never)).toBe(true);
    expect(
      MicrosoftTeamsInlineImages.isShownByTeams({
        ...png,
        mimeType: "image/jpeg",
      } as never),
    ).toBe(true);
    expect(
      MicrosoftTeamsInlineImages.isShownByTeams({
        ...png,
        mimeType: "image/gif",
      } as never),
    ).toBe(true);
    expect(
      MicrosoftTeamsInlineImages.isShownByTeams({
        ...png,
        mimeType: "image/webp",
      } as never),
    ).toBe(false);
    expect(
      MicrosoftTeamsInlineImages.isShownByTeams({
        ...png,
        byteLength: MicrosoftTeamsInlineImages.MAX_IMAGE_BYTES + 1,
      } as never),
    ).toBe(false);
  });

  test("a refusal the images can have caused: too large, or a bad request", () => {
    expect(
      MicrosoftTeamsInlineImages.mayBeRefusedForImages(
        teamsError(413, "MessageSizeTooBig"),
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsInlineImages.mayBeRefusedForImages(
        teamsError(400, "BadArgument"),
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsInlineImages.mayBeRefusedForImages(
        teamsError(403, "Forbidden"),
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsInlineImages.mayBeRefusedForImages(new Error("timeout")),
    ).toBe(false);
  });
});
