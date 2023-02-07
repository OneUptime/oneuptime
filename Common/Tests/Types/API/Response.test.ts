import Response from '../../../Types/API/HTTPResponse';
import { JSONObject } from '../../../Types/JSON';

describe('Response()', () => {
    test('should return a valid response object', () => {
        const responseObject: Response<JSONObject> = new Response(200, {
            welcome: 'here',
        },{});
        expect(responseObject.statusCode).toBe(200);
        expect(responseObject.data).toEqual({ welcome: 'here' });
        const responseObjectArray: Response<Array<JSONObject>> = new Response<
            Array<JSONObject>
        >(200, [{ welcome: 'here' }], {});
        expect(responseObjectArray.statusCode).toBe(200);
        expect(responseObjectArray.data).toEqual([{ welcome: 'here' }]);
    });
});
