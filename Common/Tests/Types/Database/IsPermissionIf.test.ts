import BaseModel from '../../../Models/BaseModel';
import Permission from '../../../Types/Permission';
import IsPermissionsIf from '../../../Types/Database/IsPermissionsIf';

describe('IsPermissionsIf', () => {
    it('should not set isPermissionIf', () => {
        class Test extends BaseModel{};

        expect(new Test().isPermissionIf).toEqual({});
    });

    it('should set isPermissionIf', () => {
        @IsPermissionsIf(Permission.Public, 'projectId', null)
        @IsPermissionsIf(Permission.ProjectUser, 'userId', true)
        class Test extends BaseModel{};

        expect(new Test().isPermissionIf).toEqual({
            [Permission.Public]: {
                'projectId': null,
            },
            [Permission.ProjectUser]: {
                'userId': true,
            }
        });
    });
});
