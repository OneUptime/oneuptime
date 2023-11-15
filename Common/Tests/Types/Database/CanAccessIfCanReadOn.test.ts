import BaseModel from '../../../Models/BaseModel';
import CanAccessIfCanReadOn from '../../../Types/Database/CanAccessIfCanReadOn';

describe('CanAccessIfCanReadOn', () => {
    it('should not set canAccessIfCanReadOn', () => {
        class Test extends BaseModel{};

        expect(new Test().canAccessIfCanReadOn).toBe(undefined);
    });

    it('should set canAccessIfCanReadOn', () => {
        @CanAccessIfCanReadOn('statusPage')
        class Test extends BaseModel{};

        expect(new Test().canAccessIfCanReadOn).toBe('statusPage');
    });
});
