import '../TestingUtils/Init';
import ScheduledMaintenanceService from '../../Services/ScheduledMaintenanceService';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import Database from '../TestingUtils/Database';
import Project from 'Model/Models/Project';
import User from 'Model/Models/User';
import { describe, expect, it } from '@jest/globals';
import UserServiceHelper from '../TestingUtils/Services/UserServiceHelper';
import ProjectServiceHelper from '../TestingUtils/Services/ProjectServiceHelper';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceServiceHelper from '../TestingUtils/Services/ScheduledMaintenanceServiceHelper';
import ScheduledMaintenanceStateServiceHelper from '../TestingUtils/Services/ScheduledMaintenanceStateServiceHelper';

// mock PostgresDatabase
const testDatabase: Database = new Database();
jest.mock('../../Infrastructure/PostgresDatabase', () => {
    const actualModule: any = jest.requireActual(
        '../../Infrastructure/PostgresDatabase'
    );
    return {
        __esModule: true,
        default: actualModule.default,
        PostgresAppInstance: {
            getDataSource: () => {
                return testDatabase.getDatabase().getDataSource();
            },
            isConnected: () => {
                return testDatabase.getDatabase().isConnected();
            },
        },
    };
});

describe('ScheduledMaintenanceService', () => {
    beforeEach(async () => {
        await testDatabase.createAndConnect();
    });

    afterEach(async () => {
        await testDatabase.disconnectAndDropDatabase();
        jest.resetAllMocks();
    });

    describe('changeScheduledMaintenanceState', () => {
        it('should trigger workflows only once', async () => {
            // Prepare scheduled maintenance
            const user: User = UserServiceHelper.generateRandomUser().data;
            await user.save();
            const project: Project = ProjectServiceHelper.generateRandomProject(
                user.id!
            ).data;
            await project.save();
            const scheduledState: ScheduledMaintenanceState =
                ScheduledMaintenanceStateServiceHelper.generateScheduledState(
                    project.id!
                ).data;
            await scheduledState.save();
            const maintenance: ScheduledMaintenance =
                ScheduledMaintenanceServiceHelper.generateRandomScheduledMaintenance(
                    project.id!,
                    scheduledState.id!
                ).data;
            await maintenance.save();
            // Change state
            const ongoingState: ScheduledMaintenanceState =
                ScheduledMaintenanceStateServiceHelper.generateOngoingState(
                    project.id!
                ).data;
            await ongoingState.save();
            jest.spyOn(ScheduledMaintenanceService, 'onTrigger');
            await ScheduledMaintenanceService.changeScheduledMaintenanceState({
                projectId: project.id!,
                scheduledMaintenanceId: maintenance.id!,
                scheduledMaintenanceStateId: ongoingState.id!,
                shouldNotifyStatusPageSubscribers: Boolean(
                    maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded
                ),
                isSubscribersNotified: false,
                notifyOwners: true,
                props: {
                    isRoot: true,
                },
            });
            // Assert triggering workflows only once
            expect(ScheduledMaintenanceService.onTrigger).toHaveBeenCalledTimes(
                1
            );
        });
    });
});
