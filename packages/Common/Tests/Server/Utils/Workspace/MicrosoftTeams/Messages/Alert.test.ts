import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import AlertService from "../../../../../../Server/Services/AlertService";
import { MicrosoftTeamsAlertActionType } from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertMessages from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/Alert";
import Hostname from "../../../../../../Types/API/Hostname";
import Protocol from "../../../../../../Types/API/Protocol";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * NOTE: unlike the incident builder (and the Slack alert builder), the
 * "Execute On Call", "Change Alert State" and "Add Note" buttons here use
 * ExecuteAlertOnCallPolicy / AlertStateChanged / AddAlertNote rather than the
 * View* action ids that MicrosoftTeamsAlertActions actually dispatches on.
 * These tests pin the current output.
 */

const getButtons: (
  blocks: Array<WorkspaceMessageBlock>,
) => Array<WorkspaceMessagePayloadButton> = (
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> => {
  return (blocks[1] as WorkspacePayloadButtons).buttons;
};

describe("MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks", () => {
  const projectId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();

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
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("emits the 6 buttons in order with the expected action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      }),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      MicrosoftTeamsAlertActionType.ViewAlert,
      MicrosoftTeamsAlertActionType.ExecuteAlertOnCallPolicy,
      MicrosoftTeamsAlertActionType.AckAlert,
      MicrosoftTeamsAlertActionType.ResolveAlert,
      MicrosoftTeamsAlertActionType.AlertStateChanged,
      MicrosoftTeamsAlertActionType.AddAlertNote,
    ]);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.title;
      }),
    ).toEqual([
      "🔗 View Alert",
      "📞 Execute On Call",
      "👀 Acknowledge Alert",
      "✅ Resolve Alert",
      "➡️ Change Alert State",
      "📄 Add Note",
    ]);
  });

  test("every button carries the alert id as its value", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      }),
    );

    expect(buttons).toHaveLength(6);

    for (const button of buttons) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(alertId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the view button links to the alert page in the dashboard", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      }),
    );

    expect(buttons[0]!.url?.toString()).toBe(
      `https://oneuptime.test/dashboard/${projectId.toString()}/alerts/${alertId.toString()}`,
    );

    for (const button of buttons.slice(1)) {
      expect(button.url).toBeUndefined();
    }
  });

  test("asks AlertService for the link with the project and alert ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof AlertService.getAlertLinkInDashboard
    > = jest.spyOn(AlertService, "getAlertLinkInDashboard");

    await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
      alertId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, alertId);
  });

  test("throws BadDataException when the alert id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof AlertService.getAlertLinkInDashboard
    > = jest.spyOn(AlertService, "getAlertLinkInDashboard");

    await expect(
      MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Alert ID is required"));

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws when the project id is missing (no dashboard link can be built)", async () => {
    await expect(
      MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId: undefined as unknown as ObjectID,
      }),
    ).rejects.toThrow();
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      }),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each alert", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId,
        projectId,
      });
    const second: Array<WorkspaceMessageBlock> =
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId: otherId,
        projectId,
      });

    expect(first).not.toBe(second);
    expect(getButtons(first)[0]!.value).toBe(alertId.toString());
    expect(getButtons(second)[0]!.value).toBe(otherId.toString());
    expect(getButtons(second)[0]!.url?.toString()).toContain(
      `/alerts/${otherId.toString()}`,
    );
  });
});
