import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import IncidentEpisodeService from "../../../../../../Server/Services/IncidentEpisodeService";
import SlackActionType from "../../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackIncidentEpisodeMessages from "../../../../../../Server/Utils/Workspace/Slack/Messages/IncidentEpisode";
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

describe("SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks", () => {
  const projectId: ObjectID = ObjectID.generate();
  const incidentEpisodeId: ObjectID = ObjectID.generate();

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
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("emits the 6 buttons in order with the expected action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      }),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      SlackActionType.ViewIncidentEpisode,
      SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy,
      SlackActionType.AcknowledgeIncidentEpisode,
      SlackActionType.ResolveIncidentEpisode,
      SlackActionType.ViewChangeIncidentEpisodeState,
      SlackActionType.ViewAddIncidentEpisodeNote,
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

  test("every button carries the incident episode id as its value", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      }),
    );

    expect(buttons).toHaveLength(6);

    for (const button of buttons) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(incidentEpisodeId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the view button links to the incident episode page in the dashboard", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      }),
    );

    expect(buttons[0]!.url?.toString()).toBe(
      `https://oneuptime.test/dashboard/${projectId.toString()}/incidents/episodes/${incidentEpisodeId.toString()}`,
    );

    for (const button of buttons.slice(1)) {
      expect(button.url).toBeUndefined();
    }
  });

  test("asks IncidentEpisodeService for the link with the project and incident episode ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentEpisodeService.getEpisodeLinkInDashboard
    > = jest.spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard");

    await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
      incidentEpisodeId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, incidentEpisodeId);
  });

  test("throws BadDataException when the incident episode id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentEpisodeService.getEpisodeLinkInDashboard
    > = jest.spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard");

    await expect(
      SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Incident Episode ID is required"));

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws when the project id is missing (no dashboard link can be built)", async () => {
    await expect(
      SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId: undefined as unknown as ObjectID,
      }),
    ).rejects.toThrow();
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      }),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each incident episode", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId,
        projectId,
      });
    const second: Array<WorkspaceMessageBlock> =
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId: otherId,
        projectId,
      });

    expect(first).not.toBe(second);
    expect(getButtons(first)[0]!.value).toBe(incidentEpisodeId.toString());
    expect(getButtons(second)[0]!.value).toBe(otherId.toString());
    expect(getButtons(second)[0]!.url?.toString()).toContain(
      `/incidents/episodes/${otherId.toString()}`,
    );
  });
});
