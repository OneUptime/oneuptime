import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import IncidentService from "../../../../../../Server/Services/IncidentService";
import SlackActionType from "../../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackIncidentMessages from "../../../../../../Server/Utils/Workspace/Slack/Messages/Incident";
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

describe("SlackIncidentMessages.getIncidentCreateMessageBlocks", () => {
  const projectId: ObjectID = ObjectID.generate();
  const incidentId: ObjectID = ObjectID.generate();

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
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("emits the 6 buttons in order with the expected action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      SlackActionType.ViewIncident,
      SlackActionType.ViewExecuteIncidentOnCallPolicy,
      SlackActionType.AcknowledgeIncident,
      SlackActionType.ResolveIncident,
      SlackActionType.ViewChangeIncidentState,
      SlackActionType.ViewAddIncidentNote,
    ]);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.title;
      }),
    ).toEqual([
      "🔗 View Incident",
      "📞 Execute On Call",
      "👀 Acknowledge Incident",
      "✅ Resolve Incident",
      "➡️ Change Incident State",
      "📄 Add Note",
    ]);
  });

  test("every button carries the incident id as its value", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    );

    expect(buttons).toHaveLength(6);

    for (const button of buttons) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(incidentId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the view button links to the incident page in the dashboard", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    );

    expect(buttons[0]!.url?.toString()).toBe(
      `https://oneuptime.test/dashboard/${projectId.toString()}/incidents/${incidentId.toString()}`,
    );

    for (const button of buttons.slice(1)) {
      expect(button.url).toBeUndefined();
    }
  });

  test("asks IncidentService for the link with the project and incident ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentService.getIncidentLinkInDashboard
    > = jest.spyOn(IncidentService, "getIncidentLinkInDashboard");

    await SlackIncidentMessages.getIncidentCreateMessageBlocks({
      incidentId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, incidentId);
  });

  test("throws BadDataException when the incident id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentService.getIncidentLinkInDashboard
    > = jest.spyOn(IncidentService, "getIncidentLinkInDashboard");

    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Incident ID is required"));

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws when the project id is missing (no dashboard link can be built)", async () => {
    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId: undefined as unknown as ObjectID,
      }),
    ).rejects.toThrow();
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each incident", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });
    const second: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: otherId,
        projectId,
      });

    expect(first).not.toBe(second);
    expect(getButtons(first)[0]!.value).toBe(incidentId.toString());
    expect(getButtons(second)[0]!.value).toBe(otherId.toString());
    expect(getButtons(second)[0]!.url?.toString()).toContain(
      `/incidents/${otherId.toString()}`,
    );
  });
});
