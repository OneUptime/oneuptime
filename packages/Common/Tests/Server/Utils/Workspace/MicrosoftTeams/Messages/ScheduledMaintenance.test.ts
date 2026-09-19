import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import ScheduledMaintenanceService from "../../../../../../Server/Services/ScheduledMaintenanceService";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsScheduledMaintenanceMessages from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/ScheduledMaintenance";
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
 * NOTE: the "Change State" and "Add Note" buttons use
 * ScheduledMaintenanceStateChanged / AddScheduledMaintenanceNote, whereas
 * MicrosoftTeamsScheduledMaintenanceActions dispatches on
 * ViewChangeScheduledMaintenanceState / ViewAddScheduledMaintenanceNote.
 * These tests pin the current output.
 */

const getButtons: (
  blocks: Array<WorkspaceMessageBlock>,
) => Array<WorkspaceMessagePayloadButton> = (
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> => {
  return (blocks[1] as WorkspacePayloadButtons).buttons;
};

describe("MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks", () => {
  const projectId: ObjectID = ObjectID.generate();
  const scheduledMaintenanceId: ObjectID = ObjectID.generate();

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
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("emits the 5 buttons in order with the expected action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      ),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance,
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      MicrosoftTeamsScheduledMaintenanceActionType.ScheduledMaintenanceStateChanged,
      MicrosoftTeamsScheduledMaintenanceActionType.AddScheduledMaintenanceNote,
    ]);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.title;
      }),
    ).toEqual([
      "🔗 View ScheduledMaintenance",
      "⌛ Mark as Ongoing",
      "✅ Mark as Completed",
      "➡️ Change Scheduled Maintenance State",
      "📄 Add Note",
    ]);
  });

  test("every button carries the scheduled maintenance id as its value", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      ),
    );

    expect(buttons).toHaveLength(5);

    for (const button of buttons) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(scheduledMaintenanceId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the view button links to the scheduled maintenance page in the dashboard", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = getButtons(
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      ),
    );

    expect(buttons[0]!.url?.toString()).toBe(
      `https://oneuptime.test/dashboard/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`,
    );

    for (const button of buttons.slice(1)) {
      expect(button.url).toBeUndefined();
    }
  });

  test("asks ScheduledMaintenanceService for the link with the project and scheduled maintenance ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard
    > = jest.spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    );

    await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
      {
        scheduledMaintenanceId,
        projectId,
      },
    );

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, scheduledMaintenanceId);
  });

  test("throws BadDataException when the scheduled maintenance id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard
    > = jest.spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    );

    await expect(
      MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId: undefined as unknown as ObjectID,
          projectId,
        },
      ),
    ).rejects.toThrow(
      new BadDataException("ScheduledMaintenance ID is required"),
    );

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws BadDataException when the project id is missing", async () => {
    await expect(
      MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId: undefined as unknown as ObjectID,
        },
      ),
    ).rejects.toThrow(new BadDataException("projectId is required"));
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      )
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      ),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each scheduled maintenance", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId,
          projectId,
        },
      );
    const second: Array<WorkspaceMessageBlock> =
      await MicrosoftTeamsScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId: otherId,
          projectId,
        },
      );

    expect(first).not.toBe(second);
    expect(getButtons(first)[0]!.value).toBe(scheduledMaintenanceId.toString());
    expect(getButtons(second)[0]!.value).toBe(otherId.toString());
    expect(getButtons(second)[0]!.url?.toString()).toContain(
      `/scheduled-maintenance-events/${otherId.toString()}`,
    );
  });
});
