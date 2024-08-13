import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import Database from "../TestingUtils/TestDatabase";
import "../TestingUtils/Init";
import ProjectServiceHelper from "../TestingUtils/Services/ProjectServiceHelper";
import ScheduledMaintenanceServiceHelper from "../TestingUtils/Services/ScheduledMaintenanceServiceHelper";
import ScheduledMaintenanceStateServiceHelper from "../TestingUtils/Services/ScheduledMaintenanceStateServiceHelper";
import UserServiceHelper from "../TestingUtils/Services/UserServiceHelper";
import { describe, expect, it } from "@jest/globals";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import User from "Common/Models/DatabaseModels/User";
import { TestDatabaseMock } from "../TestingUtils/__mocks__/TestDatabase.mock";
import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";

describe("ScheduledMaintenanceService", () => {
  let testDatabase: Database;

  beforeEach(async () => {
    // mock PostgresDatabase
    testDatabase = await TestDatabaseMock.getDbMock();
  });

  afterEach(async () => {
    await testDatabase.disconnectAndDropDatabase();
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
        },
      });

      let scheduledState: ScheduledMaintenanceState =
        ScheduledMaintenanceStateServiceHelper.generateScheduledState({
          projectId: project.id!,
        });

      scheduledState = await ScheduledMaintenanceStateService.create({
        data: scheduledState,
        props: {
          isRoot: true,
        },
      });
      let maintenance: ScheduledMaintenance =
        ScheduledMaintenanceServiceHelper.generateRandomScheduledMaintenance({
          projectId: project.id!,
          currentScheduledMaintenanceStateId: scheduledState.id!,
        });

      maintenance = await ScheduledMaintenanceService.create({
        data: maintenance,
        props: {
          isRoot: true,
        },
      });

      // Change state
      let ongoingState: ScheduledMaintenanceState =
        ScheduledMaintenanceStateServiceHelper.generateOngoingState({
          projectId: project.id!,
        });

      ongoingState = await ScheduledMaintenanceStateService.create({
        data: ongoingState,
        props: {
          isRoot: true,
        },
      });

      jest.spyOn(ScheduledMaintenanceService, "onTrigger");

      await ScheduledMaintenanceService.changeScheduledMaintenanceState({
        projectId: project.id!,
        scheduledMaintenanceId: maintenance.id!,
        scheduledMaintenanceStateId: ongoingState.id!,
        shouldNotifyStatusPageSubscribers: Boolean(
          maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
        ),
        isSubscribersNotified: false,
        notifyOwners: true,
        props: {
          isRoot: true,
        },
      });

      // Assert triggering workflows only once
      expect(ScheduledMaintenanceService.onTrigger).toHaveBeenCalledTimes(1);
    });
  });
});
