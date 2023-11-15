import BaseModel from '../../../Models/BaseModel';
import LabelsColumn from '../../../Types/Database/LabelsColumn';

describe('LabelsColumn', () => {
    it('should not set labelsColumn', () => {
        class Test extends BaseModel {}

        expect(new Test().labelsColumn).toBe(undefined);
    });

    it('should set labelsColumn', () => {
        @LabelsColumn('test')
        class Test extends BaseModel {}

        expect(new Test().labelsColumn).toBe('test');
    });
});
