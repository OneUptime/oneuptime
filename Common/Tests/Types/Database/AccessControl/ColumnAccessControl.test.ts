import BaseModel from '../../../../Models/BaseModel';
import Permission from '../../../../Types/Permission';
import { ColumnAccessControl as ColumnAccessControlType } from '../../../../Types/BaseDatabase/AccessControl';
import ColumnAccessControl, {
    getColumnAccessControl,
    getColumnAccessControlForAllColumns,
} from '../../../../Types/Database/AccessControl/ColumnAccessControl';

describe('ColumnAccessControl', () => {
    describe('getColumnAccessControl', () => {
        it('should return nothing if no AccessControl is set', () => {
            class Test extends BaseModel {
                public testColumn?: string = undefined;
            }
            const test: Test = new Test();
            expect(getColumnAccessControl(test, 'testColumn')).toBe(undefined);
        });
        it('should return ColumnAccessControl', () => {
            const permissions: ColumnAccessControlType = {
                create: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanCreateProjectMonitor,
                ],
                read: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanReadProjectMonitor,
                ],
                update: [],
            };

            class Test extends BaseModel {
                @ColumnAccessControl(permissions)
                public testColumn?: string = undefined;
            }
            const test: Test = new Test();
            expect(getColumnAccessControl(test, 'testColumn')).toBe(
                permissions
            );
        });
    });

    describe('getColumnAccessControlForAllColumns', () => {
        it('should return nothing if no AccessControl is set', () => {
            class Test extends BaseModel {
                public testColumn?: string = undefined;
            }
            const test: Test = new Test();
            expect(getColumnAccessControl(test, 'testColumn')).toBe(undefined);
        });
        it('should return ColumnAccessControl for all columns', () => {
            const fooPermissions: ColumnAccessControlType = {
                create: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanCreateProjectMonitor,
                ],
                read: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanReadProjectMonitor,
                ],
                update: [],
            };

            const barPermissions: ColumnAccessControlType = {
                create: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.CanCreateProjectMonitor,
                ],
                read: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanReadProjectMonitor,
                ],
                update: [Permission.ProjectOwner, Permission.ProjectAdmin],
            };

            class Test extends BaseModel {
                @ColumnAccessControl(fooPermissions)
                public foo?: string = undefined;

                @ColumnAccessControl(barPermissions)
                public bar?: string = undefined;

                public foobar?: string = undefined;
            }
            const test: Test = new Test();
            expect(getColumnAccessControlForAllColumns(test)).toStrictEqual({
                foo: fooPermissions,
                bar: barPermissions,
            });
        });
    });
});
