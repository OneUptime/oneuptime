import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A SYNTHETIC MONITOR'S SCREENSHOT IN SLACK AND MICROSOFT TEAMS.
 *
 * Issue #4532 brought a monitor's screenshot back to the incident's page and
 * its emails. The same description is quoted by the "Incident Created"
 * message posted to Slack and Teams, which got the screenshot's base64 as
 * text: Slack as a link to a data: URL that filled the message until it was
 * cut short, Teams as a card too large to send. Each test here runs the whole
 * way: the probe's response, the template, the description it renders, the
 * feed item IncidentService writes around it, and the Slack message and the
 * Teams card it is posted as - the screenshot shown in both, where the
 * template put it, and its base64 never in their text.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
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

import axios from "axios";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import SlackInlineImages from "../../../../Server/Utils/Workspace/Slack/SlackInlineImages";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import {
  WorkspaceChannel,
  WorkspaceThread,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import API from "../../../../Utils/API";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import Screenshots from "../../../../Types/Monitor/SyntheticMonitors/Screenshot";
import SyntheticMonitorResponse from "../../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

// Real 1x1 images, as the probe's Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// The description template from the issue.
const ISSUE_TEMPLATE: string =
  "{{syntheticResponses.0.scriptError}}\n![](data:image/png;base64,{{syntheticResponses.0.screenshots.my_error_shot}})";

// The docs' loop example (docs/monitor/incident-alert-templating).
const DOCS_LOOP_TEMPLATE: string = [
  "### What the page looked like",
  "{{#each syntheticResponses}}",
  "**{{browserType}} / {{screenSizeType}}**: {{scriptError}}",
  "",
  "![{{browserType}} {{screenSizeType}}](data:image/png;base64,{{screenshots.failure}})",
  "",
  "{{/each}}",
].join("\n");

function run(
  overrides: Partial<SyntheticMonitorResponse> & {
    screenshots?: Screenshots | undefined;
  },
): SyntheticMonitorResponse {
  return {
    result: undefined,
    scriptError: "Timeout 30000ms exceeded",
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 30000,
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    ...overrides,
  };
}

function describeIncident(
  template: string,
  runs: Array<SyntheticMonitorResponse>,
): string {
  const response: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "1 of 1 runs failed",
    monitoredAt: new Date("2026-10-07T22:00:00.000Z"),
    syntheticMonitorResponse: runs,
  };

  return MonitorTemplateUtil.processMarkdownTemplateString({
    value: template,
    storageMap: MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.SyntheticMonitor,
      dataToProcess: response,
    }),
  });
}

// The "Incident Created" feed item, as IncidentService writes it.
function incidentCreatedFeed(description: string): string {
  return mdText`#### 🚨 Incident ${"#42"} Created:

**${"Login page is down"}**:

${FeedMarkdown.asMarkdown(description)}

🔴 **Incident State**: ${"Created"} \n\n`.toString();
}

let slackCalls: Array<{ url: string; data: JSONObject }> = [];

// Slack's Web API and its upload URL, answering every call with ok.
function mockSlack(): jest.SpyInstance {
  let fileCount: number = 0;

  jest
    .spyOn(axios, "post")
    .mockResolvedValue({ status: 200, data: "" } as never);

  return jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url: URL;
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url.toString();

        slackCalls.push({ url: url, data: (options.data || {}) as JSONObject });

        if (url.endsWith("/files.getUploadURLExternal")) {
          fileCount++;
          return {
            jsonData: {
              ok: true,
              upload_url: "https://files.slack.com/upload/v1/X",
              file_id: `F${fileCount}`,
            },
          } as unknown as HTTPResponse<JSONObject>;
        }

        return {
          jsonData: { ok: true, ts: "1726912800.000100" },
        } as unknown as HTTPResponse<JSONObject>;
      },
    );
}

// The blocks the Slack message is posted with.
async function slackMessageFor(
  description: string,
): Promise<Array<JSONObject>> {
  mockSlack();
  jest.spyOn(SlackUtil, "getWorkspaceChannelFromChannelId").mockResolvedValue({
    id: "C0INCIDENTS",
    name: "incidents",
    workspaceType: WorkspaceType.Slack,
  });

  await SlackUtil.sendMessage({
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: ["C0INCIDENTS"],
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: incidentCreatedFeed(description),
        } as never,
      ],
      workspaceType: WorkspaceType.Slack,
    },
    authToken: "xoxb-token",
    userId: "",
    projectId: ObjectID.generate(),
  });

  return slackCalls.find((call: { url: string }): boolean => {
    return call.url === "https://slack.com/api/chat.postMessage";
  })!.data["blocks"] as Array<JSONObject>;
}

// The card the Teams message is sent as.
async function teamsCardFor(description: string): Promise<JSONObject> {
  const cards: Array<JSONObject> = [];

  jest
    .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
    .mockResolvedValue({
      id: "19:incidents@thread.tacv2",
      name: "incidents",
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: "team-1",
    });
  jest
    .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
    .mockImplementation(
      async (args: {
        workspaceChannel: WorkspaceChannel;
        adaptiveCard: JSONObject;
      }): Promise<WorkspaceThread> => {
        cards.push(args.adaptiveCard);
        return { channel: args.workspaceChannel, threadId: "thread" };
      },
    );

  await MicrosoftTeamsUtil.sendMessage({
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: ["19:incidents@thread.tacv2"],
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: incidentCreatedFeed(description),
        } as never,
      ],
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: "team-1",
    },
    authToken: "auth-token",
    userId: "user-1",
    projectId: ObjectID.generate(),
  });

  return cards[0]!;
}

function typesOf(elements: Array<JSONObject>): Array<unknown> {
  return elements.map((element: JSONObject): unknown => {
    return element["type"];
  });
}

beforeEach(() => {
  slackCalls = [];
  SlackInlineImages.forgetUploads();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a synthetic monitor's screenshot, from the probe to Slack and Teams", () => {
  test("the issue's template in Slack: the error, then the screenshot, uploaded and shown", async () => {
    const description: string = describeIncident(ISSUE_TEMPLATE, [
      run({ screenshots: { my_error_shot: PNG } }),
    ]);
    const blocks: Array<JSONObject> = await slackMessageFor(description);

    expect(typesOf(blocks)).toEqual(["section", "image", "section"]);
    expect(blocks[1]).toEqual({
      type: "image",
      slack_file: { id: "F1" },
      alt_text: "Image",
    });
    expect(
      ((blocks[0]!["text"] as JSONObject)["text"] as string).endsWith(
        "Timeout 30000ms exceeded\n",
      ),
    ).toBe(true);

    // The bytes went to Slack's upload URL; the base64 went nowhere as text.
    expect(JSON.stringify(slackCalls)).not.toContain(PNG);
  });

  test("the issue's template in Teams: the error, then the screenshot, in the card", async () => {
    const description: string = describeIncident(ISSUE_TEMPLATE, [
      run({ screenshots: { my_error_shot: PNG } }),
    ]);
    const card: JSONObject = await teamsCardFor(description);
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    expect(typesOf(body)).toEqual(["TextBlock", "Image", "TextBlock"]);
    expect(body[0]!["text"] as string).toContain("Timeout 30000ms exceeded");
    expect(body[1]).toEqual({
      type: "Image",
      url: `data:image/png;base64,${PNG}`,
      altText: "Image",
      msTeams: { allowExpand: true },
    });
    expect(body[2]!["text"] as string).toContain("Incident State");
  });

  test("the docs' loop example: each run's screenshot after its error, in both", async () => {
    const description: string = describeIncident(DOCS_LOOP_TEMPLATE, [
      run({ screenshots: { failure: PNG } }),
      run({
        browserType: BrowserType.Firefox,
        screenSizeType: ScreenSizeType.Mobile,
        scriptError: "Element not found: #login",
        screenshots: { failure: JPEG },
      }),
    ]);

    const slack: Array<JSONObject> = await slackMessageFor(description);

    expect(typesOf(slack)).toEqual([
      "section",
      "image",
      "section",
      "image",
      "section",
    ]);
    expect(slack[1]).toMatchObject({
      alt_text: "Chromium Desktop",
      title: { type: "plain_text", text: "Chromium Desktop" },
    });
    expect(slack[3]).toMatchObject({ alt_text: "Firefox Mobile" });
    expect((slack[2]!["text"] as JSONObject)["text"] as string).toContain(
      "Element not found: #login",
    );

    // The JPEG went up as a JPEG, though the template says image/png.
    expect(
      slackCalls
        .filter((call: { url: string }): boolean => {
          return call.url.endsWith("/files.getUploadURLExternal");
        })
        .map((call: { data: JSONObject }): unknown => {
          return call.data["filename"];
        }),
    ).toEqual(["image.png", "image.jpg"]);

    jest.restoreAllMocks();

    const card: JSONObject = await teamsCardFor(description);
    const images: Array<JSONObject> = (
      card["body"] as Array<JSONObject>
    ).filter((element: JSONObject): boolean => {
      return element["type"] === "Image";
    });

    expect(
      images.map((image: JSONObject): unknown => {
        return [image["altText"], image["url"]];
      }),
    ).toEqual([
      ["Chromium Desktop", `data:image/png;base64,${PNG}`],
      ["Firefox Mobile", `data:image/jpeg;base64,${JPEG}`],
    ]);
  });

  test("a run that took no screenshot leaves the error, and no image or placeholder", async () => {
    const description: string = describeIncident(ISSUE_TEMPLATE, [
      run({ screenshots: {} }),
    ]);

    const slack: Array<JSONObject> = await slackMessageFor(description);

    expect(typesOf(slack)).toEqual(["section"]);
    expect((slack[0]!["text"] as JSONObject)["text"] as string).toContain(
      "Timeout 30000ms exceeded",
    );
    expect(JSON.stringify(slack)).not.toContain("[image]");
    expect(JSON.stringify(slack)).not.toContain("data:");

    jest.restoreAllMocks();

    const card: JSONObject = await teamsCardFor(description);

    expect(typesOf(card["body"] as Array<JSONObject>)).toEqual(["TextBlock"]);
    expect(JSON.stringify(card)).not.toContain("data:");
  });
});
