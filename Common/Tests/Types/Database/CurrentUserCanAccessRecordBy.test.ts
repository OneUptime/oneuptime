import BaseModel from '../../../Models/BaseModel';
import CurrentUserCanAccessRecordBy from '../../../Types/Database/CurrentUserCanAccessRecordBy';

describe('CurrentUserCanAccessRecordBy', () => {
    it('should not set currentUserCanAccessColumnBy', () => {
        class Test extends BaseModel {}

        expect(new Test().currentUserCanAccessColumnBy).toBe(undefined);
    });

    it('should set currentUserCanAccessColumnBy', () => {
        @CurrentUserCanAccessRecordBy('userId')
        class Test extends BaseModel {}

        expect(new Test().currentUserCanAccessColumnBy).toBe('userId');
    });
});
