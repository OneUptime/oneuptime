import BaseModel from '../../../Models/BaseModel';
import AllowUserQueryWithoutTenant from '../../../Types/Database/AllowUserQueryWithoutTenant';

describe('AllowUserQueryWithoutTenant', () => {
    it('should not define user query without tenant', () => {
        class Test extends BaseModel{};

        expect(new Test().allowUserQueryWithoutTenant).toBe(undefined);
    });

    it('should allow user query without tenant', () => {
        @AllowUserQueryWithoutTenant(true)
        class Test extends BaseModel{};

        expect(new Test().allowUserQueryWithoutTenant).toBe(true);
    });

    it('should disallow user query without tenant', () => {
        @AllowUserQueryWithoutTenant(false)
        class Test extends BaseModel{};

        expect(new Test().allowUserQueryWithoutTenant).toBe(false);
    });
});
