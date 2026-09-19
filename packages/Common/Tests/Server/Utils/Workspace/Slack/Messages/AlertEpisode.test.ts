import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import AlertEpisodeService from "../../../../../../Server/Services/AlertEpisodeService";
import SlackActionType from "../../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAlertEpisodeMessages from "../../../../../../Server/Utils/Workspace/Slack/Messages/AlertEpisode";
import Hostname from "../../../../../../Types/API/Hostname";
import Protocol from "../../../../../../Types/API/Protocol";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../../../Types/Workspace/WorkspaceMessagePayload";

const getButtons: (
  blocks: Array<WorkspaceMessageBlock>,
) => Array<WorkspaceMessagePayloadButton> = (
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> => {
  return (blocks[1] as WorkspacePayloadButtons).buttons;
};

describe("SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks", () => {
  const projectId: ObjectID = ObjectID.generate();
  const alertEpisodeId: ObjectID = ObjectID.generate();

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

  test("returns a divider followed by a single buttons block", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("emits the 6 buttons in order with the expected action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      }),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      SlackActionType.ViewAlertEpisode,
      SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy,
      SlackActionType.AcknowledgeAlertEpisode,
      SlackActionType.ResolveAlertEpisode,
      SlackActionType.ViewChangeAlertEpisodeState,
      SlackActionType.ViewAddAlertEpisodeNote,
    ]);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.title;
      }),
    ).toEqual([
      "🔗 View Episode",
      "📞 Execute On Call",
      "👀 Acknowledge Episode",
      "✅ Resolve Episode",
      "➡️ Change Episode State",
      "📄 Add Note",
    ]);
  });

  test("every button carries the alert episode id as its value", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      }),
    );

    expect(buttons).toHaveLength(6);

    for (const button of buttons) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(alertEpisodeId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the view button links to the alert episode page in the dashboard", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      }),
    );

    expect(buttons[0]!.url?.toString()).toBe(
      `https://oneuptime.test/dashboard/${projectId.toString()}/alerts/episodes/${alertEpisodeId.toString()}`,
    );

    for (const button of buttons.slice(1)) {
      expect(button.url).toBeUndefined();
    }
  });

  test("asks AlertEpisodeService for the link with the project and alert episode ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof AlertEpisodeService.getEpisodeLinkInDashboard
    > = jest.spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard");

    await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
      alertEpisodeId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, alertEpisodeId);
  });

  test("throws BadDataException when the alert episode id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof AlertEpisodeService.getEpisodeLinkInDashboard
    > = jest.spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard");

    await expect(
      SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Alert Episode ID is required"));

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws when the project id is missing (no dashboard link can be built)", async () => {
    await expect(
      SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId: undefined as unknown as ObjectID,
      }),
    ).rejects.toThrow();
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      }),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each alert episode", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId,
        projectId,
      });
    const second: Array<WorkspaceMessageBlock> =
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId: otherId,
        projectId,
      });

    expect(first).not.toBe(second);
    expect(getButtons(first)[0]!.value).toBe(alertEpisodeId.toString());
    expect(getButtons(second)[0]!.value).toBe(otherId.toString());
    expect(getButtons(second)[0]!.url?.toString()).toContain(
      `/alerts/episodes/${otherId.toString()}`,
    );
  });
});
