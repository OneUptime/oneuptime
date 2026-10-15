import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import MonitorService from "../../../../../../Server/Services/MonitorService";
import { MessageBlocksByWorkspaceType } from "../../../../../../Server/Services/WorkspaceNotificationRuleService";
import MicrosoftTeamsUtil from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackActionType from "../../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackMonitorMessages from "../../../../../../Server/Utils/Workspace/Slack/Messages/Monitor";
import SlackUtil from "../../../../../../Server/Utils/Workspace/Slack/Slack";
import MonitorWorkspaceMessages from "../../../../../../Server/Utils/Workspace/WorkspaceMessages/Monitor";
import Hostname from "../../../../../../Types/API/Hostname";
import Protocol from "../../../../../../Types/API/Protocol";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
} from "../../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../../Types/Workspace/WorkspaceType";
import fs from "fs";
import path from "path";

/*
 * A NEW MONITOR'S MESSAGE SHOWS ITS VIEW MONITOR BUTTON.
 *
 * getMonitorCreateMessageBlocks built the View Monitor button and never
 * added the buttons block to the message, so the message - in Slack, and in
 * Microsoft Teams, whose card is drawn from the same blocks - showed a
 * divider and nothing to press. These pin the blocks, the exact Slack
 * blocks and the exact Teams card, and hold every message builder to adding
 * the buttons it builds.
 */

const projectId: ObjectID = new ObjectID(
  "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
);
const monitorId: ObjectID = new ObjectID(
  "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
);

const MONITOR_LINK: string = `https://oneuptime.test/dashboard/${projectId.toString()}/monitors/${monitorId.toString()}`;

beforeEach(() => {
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackMonitorMessages.getMonitorCreateMessageBlocks", () => {
  test("a divider, then the View Monitor button - the block it used to leave out", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackMonitorMessages.getMonitorCreateMessageBlocks({
        monitorId,
        projectId,
      });

    expect(blocks).toEqual([
      { _type: "WorkspacePayloadDivider" },
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "🔗 View Monitor",
            url: expect.anything(),
            value: monitorId.toString(),
            actionId: SlackActionType.ViewMonitor,
          },
        ],
      },
    ]);
    expect(
      (blocks[1] as WorkspacePayloadButtons).buttons[0]!.url?.toString(),
    ).toBe(MONITOR_LINK);
  });

  test("asks MonitorService for the monitor's link, with the project and monitor ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof MonitorService.getMonitorLinkInDashboard
    > = jest.spyOn(MonitorService, "getMonitorLinkInDashboard");

    await SlackMonitorMessages.getMonitorCreateMessageBlocks({
      monitorId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, monitorId);
  });

  test("throws BadDataException when the monitor id is missing", async () => {
    await expect(
      SlackMonitorMessages.getMonitorCreateMessageBlocks({
        monitorId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Monitor ID is required"));
  });

  test("the exact blocks Slack is sent: a divider and an actions block with the link button", async () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: await SlackMonitorMessages.getMonitorCreateMessageBlocks(
          {
            monitorId,
            projectId,
          },
        ),
      });

    expect(blocks).toEqual([
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 View Monitor", emoji: true },
            value: monitorId.toString(),
            action_id: "ViewMonitor",
            url: MONITOR_LINK,
          },
        ],
      },
    ]);
  });

  test("the exact Microsoft Teams card: the link as its one action", async () => {
    const byType: Array<MessageBlocksByWorkspaceType> =
      await MonitorWorkspaceMessages.getMonitorCreateMessageBlocks({
        monitorId,
        projectId,
      });

    expect(
      byType.map((entry: MessageBlocksByWorkspaceType) => {
        return entry.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    const card: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: byType[1]!.messageBlocks,
      });

    expect(card["actions"]).toEqual([
      {
        type: "Action.OpenUrl",
        title: "🔗 View Monitor",
        url: MONITOR_LINK,
      },
    ]);
  });
});

describe("every message builder adds the buttons it builds", () => {
  /*
   * The mistake behind the monitor's empty message, read from the source:
   * a builder that pushes buttons into a list must put a buttons block of
   * that list on the message.
   */
  const MESSAGES_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../../../Server/Utils/Workspace/Slack/Messages",
  );

  const BUTTON_PUSH: RegExp = /\bbuttons\.push\(/;
  const BLOCK_PUSH: RegExp =
    /blockSlack\.push\(\s*workspacePayloadButtons\s*\)/;

  const builders: Array<string> = fs
    .readdirSync(MESSAGES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    });

  test("the Slack message builders are read", () => {
    expect(builders).toEqual(
      expect.arrayContaining([
        "Alert.ts",
        "AlertEpisode.ts",
        "Incident.ts",
        "IncidentEpisode.ts",
        "Monitor.ts",
        "OnCallDutyPolicy.ts",
        "ScheduledMaintenance.ts",
      ]),
    );
  });

  test.each(builders)(
    "%s: buttons built are added to the message",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(MESSAGES_DIRECTORY, file),
        "utf8",
      );

      if (BUTTON_PUSH.test(source)) {
        expect({ file: file, addsButtons: BLOCK_PUSH.test(source) }).toEqual({
          file: file,
          addsButtons: true,
        });
      }
    },
  );
});
