import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A NEW MAINTENANCE EVENT STARTS IN ITS PROJECT'S SCHEDULED STATE.
 *
 * A project without one cannot have the event created, and is told so in
 * a sentence that names the page its states are on. Microsoft Teams quotes
 * it when a create fails ("❌ Could not create the maintenance event: ..."),
 * and it read "Scheduled state not found for this project. Please add an
 * scheduled event state from settings." (#7822).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f7822000-0000-4000-8000-000000000001",
);

type CreateHook = (
  createBy: CreateBy<ScheduledMaintenance>,
) => Promise<OnCreate<ScheduledMaintenance>>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a maintenance event created in a project without a scheduled state", () => {
  test("is refused, in a sentence that says where the project's states are", async () => {
    jest
      .spyOn(ScheduledMaintenanceStateService, "findOneBy")
      .mockResolvedValue(null);

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.projectId = PROJECT_ID;
    event.title = "Database upgrade";

    const service: { onBeforeCreate: CreateHook } =
      ScheduledMaintenanceService as unknown as { onBeforeCreate: CreateHook };

    await expect(
      service.onBeforeCreate({
        data: event,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      new BadDataException(
        "This project has no scheduled state, so a new maintenance event has no state to start in. See Scheduled Maintenance > Settings > Maintenance State.",
      ),
    );

    // The project's own scheduled state was asked for.
    expect(ScheduledMaintenanceStateService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, isScheduledState: true },
      }),
    );
  });
});
