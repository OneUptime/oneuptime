import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import "../TestingUtils/Init";
import ProjectServiceHelper from "../TestingUtils/Services/ProjectServiceHelper";
import ScheduledMaintenanceServiceHelper from "../TestingUtils/Services/ScheduledMaintenanceServiceHelper";
import { describe, expect, it } from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import { TestDatabaseMock } from "../TestingUtils/__mocks__/TestDatabase.mock";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import UserServiceHelper from "../TestingUtils/Services/UserServiceHelper";
import UserService from "../../../Server/Services/UserService";
import User from "../../../Models/DatabaseModels/User";

// Skip this test suite as it requires a database connection
describe.skip("ScheduledMaintenanceService", () => {
  beforeEach(async () => {
    // mock PostgresDatabase
    await TestDatabaseMock.connectDbMock();
  });

  afterEach(async () => {
    await TestDatabaseMock.disconnectDbMock();
    jest.resetAllMocks();
  });

  describe("changeScheduledMaintenanceState", () => {
    it("should trigger workflows only once", async () => {
      // Prepare scheduled maintenance

      let user: User = UserServiceHelper.generateRandomUser();

      user = await UserService.create({
        data: user,
        props: {
          isRoot: true,
        },
      });

      let project: Project = ProjectServiceHelper.generateRandomProject();

      project = await ProjectService.create({
        data: project,
        props: {
          isRoot: true,
          userId: user.id!,
        },
      });

      // this state is automatically created when the project is created.
      const scheduledState: ScheduledMaintenanceState | null =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            isScheduledState: true,
            projectId: project.id!,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
          },
        });

      expect(scheduledState).not.toBeNull();

      let maintenance: ScheduledMaintenance =
        ScheduledMaintenanceServiceHelper.generateRandomScheduledMaintenance({
          projectId: project.id!,
          currentScheduledMaintenanceStateId: scheduledState!.id!,
        });

      maintenance = await ScheduledMaintenanceService.create({
        data: maintenance,
        props: {
          isRoot: true,
          tenantId: project.id!,
        },
      });

      // this state is automatically created when the project is created.
      const ongoingState: ScheduledMaintenanceState | null =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            isOngoingState: true,
            projectId: project.id!,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
          },
        });

      expect(ongoingState).not.toBeNull();

      jest.spyOn(ScheduledMaintenanceService, "onTriggerWorkflow");

      await ScheduledMaintenanceService.changeScheduledMaintenanceState({
        projectId: project.id!,
        scheduledMaintenanceId: maintenance.id!,
        scheduledMaintenanceStateId: ongoingState!.id!,
        shouldNotifyStatusPageSubscribers: Boolean(
          maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
        ),
        isSubscribersNotified: false,
        notifyOwners: true,
        props: {
          isRoot: true,
          tenantId: project.id!,
        },
      });

      // Assert triggering workflows only once
      expect(
        ScheduledMaintenanceService.onTriggerWorkflow,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
