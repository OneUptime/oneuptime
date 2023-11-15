import BaseModel from '../../../Models/BaseModel';
import Route from '../../../Types/API/Route';
import CrudApiEndpoint from '../../../Types/Database/CrudApiEndpoint';

describe('CrudApiEndpoint', () => {
    it('should not set crudApiPath', () => {
        class Test extends BaseModel {}

        expect(new Test().crudApiPath).toBe(undefined);
    });

    it('should set crudApiPath', () => {
        const testRoute: Route = new Route('/test');
        @CrudApiEndpoint(testRoute)
        class Test extends BaseModel {}

        expect(new Test().crudApiPath).toBe(testRoute);
    });
});
