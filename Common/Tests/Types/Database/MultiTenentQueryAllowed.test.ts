import BaseModel from '../../../Models/BaseModel';
import MultiTenentQueryAllowed from '../../../Types/Database/MultiTenentQueryAllowed';

describe('MultiTenentQueryAllowed', () => {
    it('should not define isMultiTenantRequestAllowed', () => {
        class Test extends BaseModel{};

        expect(new Test().isMultiTenantRequestAllowed).toBe(undefined);
    });

    it('should allow multi tenent query', () => {
        @MultiTenentQueryAllowed(true)
        class Test extends BaseModel{};

        expect(new Test().isMultiTenantRequestAllowed).toBe(true);
    });

    it('should disallow multi tenant query', () => {
        @MultiTenentQueryAllowed(false)
        class Test extends BaseModel{};

        expect(new Test().isMultiTenantRequestAllowed).toBe(false);
    });
});
