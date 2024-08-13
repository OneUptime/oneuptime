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
      const user: User = UserServiceHelper.generateRandomUser();
      await user.save();
      const project: Project = ProjectServiceHelper.generateRandomProject(
        user.id!,
      ).data;
      await project.save();
      const scheduledState: ScheduledMaintenanceState =
        ScheduledMaintenanceStateServiceHelper.generateScheduledState(
          project.id!,
        ).data;
      await scheduledState.save();
      const maintenance: ScheduledMaintenance =
        ScheduledMaintenanceServiceHelper.generateRandomScheduledMaintenance(
          project.id!,
          scheduledState.id!,
        ).data;
      await maintenance.save();
      // Change state
      const ongoingState: ScheduledMaintenanceState =
        ScheduledMaintenanceStateServiceHelper.generateOngoingState(
          project.id!,
        ).data;
      await ongoingState.save();
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
