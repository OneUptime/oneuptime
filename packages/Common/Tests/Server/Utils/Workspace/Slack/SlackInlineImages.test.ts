import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";
import SlackifyMarkdown from "slackify-markdown";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackInlineImages, {
  SlackImageUploadResult,
} from "../../../../../Server/Utils/Workspace/Slack/SlackInlineImages";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import logger from "../../../../../Server/Utils/Logger";
import API from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadInlineImage,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "../../../../../Utils/Markdown/InlineImageDataUri";
import app_manifest from "../../../../../Server/Utils/Workspace/Slack/app-manifest.json";

/*
 * A SCREENSHOT IN A SLACK MESSAGE.
 *
 * Slack cannot show an image whose address is a data: URL; its Markdown
 * conversion used to turn a screenshot in a description into a link to one,
 * <data:image/png;base64,...|Login page>, which filled the message with
 * base64 until it was cut short. Now the screenshot is uploaded to Slack,
 * privately, and shown by its file's id as an image block where the
 * description had it. These tests pin the upload (three calls, no channel,
 * nothing sent anywhere but Slack), the message (an image block between the
 * text, never the base64), and every way back to the alt text: no files:write
 * scope, a failed upload, an image type Slack does not show, a message Slack
 * refuses, and the paths that cannot upload at all.
 */

const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OTHER_PNG: string = Buffer.concat([
  Buffer.from(PNG, "base64"),
  Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
]).toString("base64");
const WEBP: string =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
const DATA_URL: string = `data:image/png;base64,${PNG}`;

const TOKEN: string = "xoxb-test-token";
const UPLOAD_URL: string = "https://files.slack.com/upload/v1/ABC123";

interface PostCall {
  url: string;
  data: JSONObject;
  headers: JSONObject;
}

interface SlackAnswers {
  getUploadURLExternal?: JSONObject | undefined;
  completeUploadExternal?: JSONObject | undefined;
  postMessage?: Array<JSONObject> | undefined;
}

let postCalls: Array<PostCall> = [];
let fileCount: number = 0;

// Slack's Web API, answering each method as `answers` says (ok by default).
function mockSlackApi(answers?: SlackAnswers): jest.SpyInstance {
  const postMessageAnswers: Array<JSONObject> = [
    ...(answers?.postMessage || []),
  ];

  return jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url: URL;
        data?: unknown;
        headers?: unknown;
      }): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url.toString();

        postCalls.push({
          url: url,
          data: (options.data || {}) as JSONObject,
          headers: (options.headers || {}) as JSONObject,
        });

        let jsonData: JSONObject = { ok: true };

        if (url.endsWith("/files.getUploadURLExternal")) {
          fileCount++;
          jsonData = answers?.getUploadURLExternal || {
            ok: true,
            upload_url: UPLOAD_URL,
            file_id: `F000${fileCount}`,
          };
        } else if (url.endsWith("/files.completeUploadExternal")) {
          jsonData = answers?.completeUploadExternal || { ok: true };
        } else if (url.endsWith("/chat.postMessage")) {
          jsonData = postMessageAnswers.shift() || {
            ok: true,
            ts: "1726912800.000100",
          };
        }

        return { jsonData: jsonData } as unknown as HTTPResponse<JSONObject>;
      },
    );
}

// The upload of the bytes themselves.
function mockUpload(status: number = 200): jest.SpyInstance {
  return jest.spyOn(axios, "post").mockResolvedValue({
    status: status,
    data: "OK",
  } as never);
}

function callsTo(method: string): Array<PostCall> {
  return postCalls.filter((call: PostCall): boolean => {
    return call.url === `https://slack.com/api/${method}`;
  });
}

function inlineImage(
  base64: string,
  altText: string,
  fallbackMarkdown: string = altText,
): WorkspacePayloadInlineImage {
  const image: InlineImageDataUri | null = parseInlineImageDataUri(
    `data:image/png;base64,${base64}`,
  );

  return {
    _type: "WorkspacePayloadInlineImage",
    image: image!,
    altText: altText,
    fallbackMarkdown: fallbackMarkdown,
  };
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
        title: "✅ Acknowledge",
        value: "incident-id",
        actionId: "AcknowledgeIncident",
      },
    ],
  };
}

function incidentCreatedFeed(description: string): string {
  return `#### 🚨 Incident #12 Created:\n\n**Checkout is down**:\n\n${description}\n\n🔴 **Incident State**: Created \n\n`;
}

async function sendToChannels(data: {
  messageBlocks: Array<WorkspaceMessageBlock>;
  channelIds?: Array<string> | undefined;
}): Promise<WorkspaceSendMessageResponse> {
  return await SlackUtil.sendMessage({
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: data.channelIds || ["C0INCIDENTS"],
      messageBlocks: data.messageBlocks,
      workspaceType: WorkspaceType.Slack,
    },
    authToken: TOKEN,
    userId: "",
    projectId: ObjectID.generate(),
  });
}

// The blocks of every message posted, in order.
function postedMessages(): Array<Array<JSONObject>> {
  return callsTo("chat.postMessage").map(
    (call: PostCall): Array<JSONObject> => {
      return call.data["blocks"] as Array<JSONObject>;
    },
  );
}

function sectionTexts(blocks: Array<JSONObject>): Array<string> {
  return blocks
    .filter((block: JSONObject): boolean => {
      return block["type"] === "section";
    })
    .map((block: JSONObject): string => {
      return (block["text"] as JSONObject)["text"] as string;
    });
}

beforeEach(() => {
  postCalls = [];
  fileCount = 0;
  SlackInlineImages.forgetUploads();
  jest.spyOn(SlackUtil, "getWorkspaceChannelFromChannelId").mockImplementation(
    async (args: {
      channelId: string;
    }): Promise<{
      id: string;
      name: string;
      workspaceType: WorkspaceType;
    }> => {
      return {
        id: args.channelId,
        name: args.channelId.toLowerCase(),
        workspaceType: WorkspaceType.Slack,
      };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackInlineImages.uploadImage", () => {
  test("asks for an upload URL, sends the bytes there, and completes it without sharing it", async () => {
    mockSlackApi();
    const upload: jest.SpyInstance = mockUpload();

    const result: SlackImageUploadResult = await SlackInlineImages.uploadImage({
      authToken: TOKEN,
      image: parseInlineImageDataUri(DATA_URL)!,
      altText: "Login page",
    });

    expect(result).toEqual({ fileId: "F0001", error: null });

    const [ticket, completion] = postCalls;

    expect(ticket).toEqual({
      url: "https://slack.com/api/files.getUploadURLExternal",
      data: {
        filename: "image.png",
        length: String(Buffer.from(PNG, "base64").length),
        alt_txt: "Login page",
      },
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // The bytes, decoded, to Slack's upload URL - and nowhere else.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toBe(UPLOAD_URL);
    expect(
      (upload.mock.calls[0]![1] as Buffer).equals(Buffer.from(PNG, "base64")),
    ).toBe(true);
    expect(upload.mock.calls[0]![2]).toMatchObject({
      headers: { "Content-Type": "application/octet-stream" },
      maxRedirects: 0,
    });

    // No channel: the file stays private, seen where a message shows it.
    expect(completion!.url).toBe(
      "https://slack.com/api/files.completeUploadExternal",
    );
    expect(completion!.data).toEqual({
      files: JSON.stringify([{ id: "F0001", title: "Login page" }]),
    });
    expect(completion!.data["channel_id"]).toBeUndefined();
    expect(completion!.data["channels"]).toBeUndefined();
  });

  test('an image with no alt text is uploaded as "Image", with no alt_txt', async () => {
    mockSlackApi();
    mockUpload();

    await SlackInlineImages.uploadImage({
      authToken: TOKEN,
      image: parseInlineImageDataUri(DATA_URL)!,
      altText: "",
    });

    expect(callsTo("files.getUploadURLExternal")[0]!.data).toEqual({
      filename: "image.png",
      length: String(Buffer.from(PNG, "base64").length),
    });
    expect(callsTo("files.completeUploadExternal")[0]!.data).toEqual({
      files: JSON.stringify([{ id: "F0001", title: "Image" }]),
    });
  });

  test("without the files:write scope nothing is uploaded, and Slack's error is returned", async () => {
    mockSlackApi({
      getUploadURLExternal: { ok: false, error: "missing_scope" },
    });
    const upload: jest.SpyInstance = mockUpload();

    expect(
      await SlackInlineImages.uploadImage({
        authToken: TOKEN,
        image: parseInlineImageDataUri(DATA_URL)!,
        altText: "Login page",
      }),
    ).toEqual({ fileId: null, error: "missing_scope" });
    expect(upload).not.toHaveBeenCalled();
    expect(callsTo("files.completeUploadExternal")).toEqual([]);
  });

  test("an upload URL that is not Slack's is sent nothing", async () => {
    for (const uploadUrl of [
      "https://files.slack.com.attacker.example/upload",
      "http://files.slack.com/upload/v1/ABC",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      postCalls = [];
      mockSlackApi({
        getUploadURLExternal: {
          ok: true,
          upload_url: uploadUrl,
          file_id: "F0001",
        },
      });
      const upload: jest.SpyInstance = mockUpload();

      const result: SlackImageUploadResult =
        await SlackInlineImages.uploadImage({
          authToken: TOKEN,
          image: parseInlineImageDataUri(DATA_URL)!,
          altText: "Login page",
        });

      expect(result.fileId).toBeNull();
      expect(upload).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });

  test("a failed upload, or a completion Slack refuses, uploads nothing", async () => {
    mockSlackApi();
    mockUpload(500);

    expect(
      await SlackInlineImages.uploadImage({
        authToken: TOKEN,
        image: parseInlineImageDataUri(DATA_URL)!,
        altText: "",
      }),
    ).toEqual({ fileId: null, error: "the upload answered HTTP 500" });

    jest.restoreAllMocks();
    postCalls = [];
    mockSlackApi({
      completeUploadExternal: { ok: false, error: "file_not_found" },
    });
    mockUpload();

    expect(
      await SlackInlineImages.uploadImage({
        authToken: TOKEN,
        image: parseInlineImageDataUri(DATA_URL)!,
        altText: "",
      }),
    ).toEqual({ fileId: null, error: "file_not_found" });
  });

  test("a network failure is a failed upload, never a thrown error", async () => {
    mockSlackApi();
    jest
      .spyOn(axios, "post")
      .mockRejectedValue(new Error("socket hang up") as never);

    expect(
      await SlackInlineImages.uploadImage({
        authToken: TOKEN,
        image: parseInlineImageDataUri(DATA_URL)!,
        altText: "",
      }),
    ).toEqual({ fileId: null, error: "socket hang up" });
  });
});

describe("SlackInlineImages.uploadImages", () => {
  test("uploads each image once, by its bytes", async () => {
    mockSlackApi();
    mockUpload();

    const fileIds: Map<string, string> = await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: [
        inlineImage(PNG, "a"),
        inlineImage(OTHER_PNG, "b"),
        inlineImage(PNG, "a again"),
      ],
    });

    expect(fileIds).toEqual(
      new Map<string, string>([
        [PNG, "F0001"],
        [OTHER_PNG, "F0002"],
      ]),
    );
    expect(callsTo("files.getUploadURLExternal")).toHaveLength(2);
  });

  test("remembers an upload made with the same token for the next message", async () => {
    mockSlackApi();
    mockUpload();

    await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: [inlineImage(PNG, "a")],
    });
    const again: Map<string, string> = await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: [inlineImage(PNG, "a")],
    });
    const otherWorkspace: Map<string, string> =
      await SlackInlineImages.uploadImages({
        authToken: "xoxb-another-workspace",
        images: [inlineImage(PNG, "a")],
      });

    expect(again.get(PNG)).toBe("F0001");
    expect(otherWorkspace.get(PNG)).toBe("F0002");
    expect(callsTo("files.getUploadURLExternal")).toHaveLength(2);
  });

  test("an image type Slack does not show from a file is not uploaded", async () => {
    mockSlackApi();
    mockUpload();

    const webp: WorkspacePayloadInlineImage = {
      _type: "WorkspacePayloadInlineImage",
      image: parseInlineImageDataUri(`data:image/webp;base64,${WEBP}`)!,
      altText: "webp",
      fallbackMarkdown: "webp",
    };

    expect(SlackInlineImages.isShownBySlack(webp.image)).toBe(false);
    expect(
      await SlackInlineImages.uploadImages({
        authToken: TOKEN,
        images: [webp],
      }),
    ).toEqual(new Map<string, string>());
    expect(postCalls).toEqual([]);
  });

  test("a message uploads at most MAX_IMAGES_PER_MESSAGE images", async () => {
    mockSlackApi();
    mockUpload();

    const images: Array<WorkspacePayloadInlineImage> = [];

    for (let index: number = 0; index < 12; index++) {
      images.push(
        inlineImage(
          Buffer.concat([
            Buffer.from(PNG, "base64"),
            Buffer.from([index]),
          ]).toString("base64"),
          `shot ${index}`,
        ),
      );
    }

    const fileIds: Map<string, string> = await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: images,
    });

    expect(fileIds.size).toBe(SlackInlineImages.MAX_IMAGES_PER_MESSAGE);
  });

  test("missing files:write: says to connect Slack again, and stops trying", async () => {
    mockSlackApi({
      getUploadURLExternal: { ok: false, error: "missing_scope" },
    });
    mockUpload();
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    const fileIds: Map<string, string> = await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: [inlineImage(PNG, "a"), inlineImage(OTHER_PNG, "b")],
    });

    expect(fileIds.size).toBe(0);
    expect(callsTo("files.getUploadURLExternal")).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("files:write"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Connect Slack again"),
    );
  });

  test("one failed upload does not stop the next", async () => {
    let calls: number = 0;

    mockSlackApi();
    jest.spyOn(axios, "post").mockImplementation(async (): Promise<never> => {
      calls++;

      return { status: calls === 1 ? 500 : 200, data: "" } as never;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const fileIds: Map<string, string> = await SlackInlineImages.uploadImages({
      authToken: TOKEN,
      images: [inlineImage(PNG, "a"), inlineImage(OTHER_PNG, "b")],
    });

    expect(Array.from(fileIds.keys())).toEqual([OTHER_PNG]);
  });
});

describe("SlackInlineImages.getImageBlock", () => {
  test("shows the file by its id, titled with its alt text", () => {
    expect(
      SlackInlineImages.getImageBlock({
        fileId: "F0001",
        altText: "Login page",
      }),
    ).toEqual({
      type: "image",
      slack_file: { id: "F0001" },
      alt_text: "Login page",
      title: { type: "plain_text", text: "Login page" },
    });
  });

  test("an image with no alt text has no title, and Slack's required alt_text", () => {
    expect(
      SlackInlineImages.getImageBlock({ fileId: "F0001", altText: "" }),
    ).toEqual({
      type: "image",
      slack_file: { id: "F0001" },
      alt_text: "Image",
    });
  });

  test("keeps alt text within Slack's 2000 characters", () => {
    const block: JSONObject = SlackInlineImages.getImageBlock({
      fileId: "F0001",
      altText: "x".repeat(3000),
    });

    expect((block["alt_text"] as string).length).toBe(2000);
  });
});

describe("SlackUtil.sendMessage - a screenshot in the message", () => {
  test("the Incident Created message shows the screenshot between its text, and no base64", async () => {
    mockSlackApi();
    mockUpload();

    const response: WorkspaceSendMessageResponse = await sendToChannels({
      messageBlocks: [
        markdown(
          incidentCreatedFeed(
            `Timeout 30000ms exceeded\n![Login page](${DATA_URL})`,
          ),
        ),
        buttons(),
      ],
    });

    expect(response.errors).toEqual([]);
    expect(response.threads).toHaveLength(1);
    expect(postedMessages()).toHaveLength(1);

    const blocks: Array<JSONObject> = postedMessages()[0]!;

    expect(
      blocks.map((block: JSONObject): unknown => {
        return block["type"];
      }),
    ).toEqual(["section", "image", "section", "actions"]);
    expect(blocks[1]).toEqual({
      type: "image",
      slack_file: { id: "F0001" },
      alt_text: "Login page",
      title: { type: "plain_text", text: "Login page" },
    });
    expect(sectionTexts(blocks)[0]).toContain("Timeout 30000ms exceeded");
    expect(sectionTexts(blocks)[1]).toContain("Incident State");

    // The base64 never went anywhere as text.
    expect(JSON.stringify(postCalls)).not.toContain(PNG);
  });

  test("the issue's template, with no alt text: an untitled image after the error", async () => {
    mockSlackApi();
    mockUpload();

    await sendToChannels({
      messageBlocks: [markdown(`Timeout 30000ms exceeded\n![](${DATA_URL})`)],
    });

    expect(postedMessages()[0]).toEqual([
      {
        type: "section",
        text: { type: "mrkdwn", text: "Timeout 30000ms exceeded\n" },
      },
      { type: "image", slack_file: { id: "F0001" }, alt_text: "Image" },
    ]);
  });

  test("a message posted to several channels uploads its screenshot once", async () => {
    mockSlackApi();
    mockUpload();

    const response: WorkspaceSendMessageResponse = await sendToChannels({
      messageBlocks: [markdown(`![Login page](${DATA_URL})`)],
      channelIds: ["C0ONE", "C0TWO", "C0THREE"],
    });

    expect(response.threads).toHaveLength(3);
    expect(callsTo("files.getUploadURLExternal")).toHaveLength(1);
    expect(postedMessages()).toEqual([
      [expect.objectContaining({ slack_file: { id: "F0001" } })],
      [expect.objectContaining({ slack_file: { id: "F0001" } })],
      [expect.objectContaining({ slack_file: { id: "F0001" } })],
    ]);
  });

  test("without files:write, the screenshot is its alt text and the message still goes out", async () => {
    mockSlackApi({
      getUploadURLExternal: { ok: false, error: "missing_scope" },
    });
    mockUpload();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const response: WorkspaceSendMessageResponse = await sendToChannels({
      messageBlocks: [markdown(`Timeout\n![Login page](${DATA_URL})\n\nAfter`)],
    });

    expect(response.errors).toEqual([]);
    expect(sectionTexts(postedMessages()[0]!)).toEqual([
      "Timeout\n",
      "Login page\n",
      "After\n",
    ]);
    expect(JSON.stringify(postCalls)).not.toContain(PNG);
  });

  test("an image Slack refuses: the message is posted again with its alt text", async () => {
    mockSlackApi({
      postMessage: [{ ok: false, error: "invalid_blocks" }],
    });
    mockUpload();
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const response: WorkspaceSendMessageResponse = await sendToChannels({
      messageBlocks: [markdown(`Timeout\n![Login page](${DATA_URL})`)],
    });

    expect(response.errors).toEqual([]);
    expect(response.threads).toHaveLength(1);
    expect(postedMessages()).toHaveLength(2);
    expect(postedMessages()[0]![1]).toMatchObject({ type: "image" });
    expect(postedMessages()[1]).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "Timeout\n" } },
      { type: "section", text: { type: "mrkdwn", text: "Login page\n" } },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("posting it with each image as its alt text"),
      expect.anything(),
    );
  });

  test("any other refusal is reported as before, and not posted twice", async () => {
    mockSlackApi({
      postMessage: [{ ok: false, error: "channel_not_found" }],
    });
    mockUpload();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const response: WorkspaceSendMessageResponse = await sendToChannels({
      messageBlocks: [markdown(`![Login page](${DATA_URL})`)],
    });

    expect(postedMessages()).toHaveLength(1);
    expect(response.errors![0]!.error).toContain("channel_not_found");
  });

  test("a message without screenshots uploads nothing and is posted as before", async () => {
    mockSlackApi();
    const upload: jest.SpyInstance = mockUpload();

    await sendToChannels({
      messageBlocks: [
        markdown(
          "**Checkout is down** - ![logo](https://example.com/logo.png) `data:image/png;base64,x`",
        ),
      ],
    });

    expect(upload).not.toHaveBeenCalled();
    expect(callsTo("files.getUploadURLExternal")).toEqual([]);
    expect(postedMessages()).toEqual([
      [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: SlackifyMarkdown(
              "**Checkout is down** - ![logo](https://example.com/logo.png) `data:image/png;base64,x`",
            ),
          },
        },
      ],
    ]);
  });

  test("a screenshot shown in code stays code, and nothing is uploaded for it", async () => {
    mockSlackApi();
    const upload: jest.SpyInstance = mockUpload();

    await sendToChannels({
      messageBlocks: [
        markdown("Template:\n\n```\n![Login page](" + DATA_URL + ")\n```"),
      ],
    });

    expect(upload).not.toHaveBeenCalled();
    expect(sectionTexts(postedMessages()[0]!)[0]).toContain(
      `![Login page](${DATA_URL})`,
    );
  });

  test("a [text][label] link resolves in every piece around a screenshot", async () => {
    mockSlackApi();
    mockUpload();

    await sendToChannels({
      messageBlocks: [
        markdown(
          `See [the runbook][r].\n\n![shot](${DATA_URL})\n\nThen [the runbook][r] again.\n\n[r]: https://runbook.example.com`,
        ),
      ],
    });

    expect(sectionTexts(postedMessages()[0]!)).toEqual([
      "See <https://runbook.example.com|the runbook>.\n",
      "Then <https://runbook.example.com|the runbook> again.\n",
    ]);
  });

  test("a long description cut by a screenshot keeps to one description's sections", async () => {
    mockSlackApi();
    mockUpload();

    const paragraph: string = "word ".repeat(500);
    const longText: string = Array.from({ length: 30 }, (): string => {
      return paragraph;
    }).join("\n\n");

    await sendToChannels({
      messageBlocks: [
        markdown(`${longText}\n\n![shot](${DATA_URL})\n\n${longText}`),
      ],
    });

    const blocks: Array<JSONObject> = postedMessages()[0]!;

    expect(
      blocks.filter((block: JSONObject): boolean => {
        return block["type"] === "image";
      }),
    ).toHaveLength(1);
    // The two pieces share what the one block could take, plus one each.
    expect(sectionTexts(blocks).length).toBeLessThanOrEqual(
      SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK + 1,
    );
    expect(sectionTexts(blocks)[sectionTexts(blocks).length - 1]).toContain(
      SlackUtil.TRUNCATED_SECTION_NOTE.trim(),
    );
  });
});

describe("Slack paths that cannot upload show the alt text", () => {
  test("getBlocksFromWorkspaceMessagePayload, for a direct message or a modal", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [markdown(`Timeout\n![Login page](${DATA_URL})`)],
      });

    expect(sectionTexts(blocks)).toEqual(["Timeout\nLogin page\n"]);
    expect(JSON.stringify(blocks)).not.toContain(PNG);
  });

  test("an inline image block with no upload is its fallback, or nothing", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          markdown("Before"),
          inlineImage(PNG, "Login page"),
          inlineImage(OTHER_PNG, "mid-sentence", ""),
        ],
      });

    expect(sectionTexts(blocks)).toEqual(["Before\n", "Login page\n"]);
  });

  test("convertMarkdownToSlackRichText, for incoming webhooks", () => {
    const text: string = SlackUtil.convertMarkdownToSlackRichText(
      `**New incident**: Checkout is down\n\n![Login page](${DATA_URL})\n\n| a | b |\n|---|---|\n| ![x](${DATA_URL}) | c |`,
    );

    expect(text).not.toContain(PNG);
    expect(text).toContain("Login page");
    // The table's row, unrolled, with the image's alt text in its cell.
    expect(text).toMatch(/a:\S*\s+x\n/);
  });

  test("getMarkdownBlocks", () => {
    expect(
      SlackUtil.getMarkdownBlocks({
        payloadMarkdownBlock: markdown(`![](${DATA_URL})`),
      }),
    ).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "[image]\n" } },
    ]);
  });
});

describe("The OneUptime Slack app", () => {
  test("asks for files:write, to upload the screenshots it shows", () => {
    const scopes: JSONObject = (
      app_manifest as unknown as { oauth_config: { scopes: JSONObject } }
    ).oauth_config.scopes;

    expect(scopes["bot"]).toContain("files:write");
  });
});
