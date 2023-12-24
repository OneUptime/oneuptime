import BaseModel from '../../../Models/BaseModel';
import AccessControlColumn from '../../../Types/Database/AccessControlColumn';

describe('AccessControlColumn', () => {
    it('should not set accessControlColumn', () => {
        class Test extends BaseModel {}

        expect(new Test().accessControlColumn).toBe(undefined);
    });

    it('should set accessControlColumn', () => {
        @AccessControlColumn('labels')
        class Test extends BaseModel {}

        expect(new Test().accessControlColumn).toBe('labels');
    });
});
