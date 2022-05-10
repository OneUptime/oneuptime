import StatusCode from '../Types/API/StatusCode';
import BadDataException from '../Types/Exception/BadDataException';
describe('Route', () => {
    type createStatusCodeType = (
        statusCode: string | number
    ) => () => StatusCode;

    const createStatusCode: createStatusCodeType = (
        status: string | number
    ) => {
        return () => {
            return new StatusCode(status);
        };
    };
    test('new StatusCode should throw if number is not passed', () => {
        expect(createStatusCode('invalid')).toThrowError(BadDataException);
        expect(createStatusCode(-400)).toThrowError(BadDataException);
        expect(createStatusCode('-400')).toThrowError(BadDataException);
    });
    test('Route.toString() should return valid  statuscode string', () => {
        expect(createStatusCode('200')().toString()).toEqual('200');
        expect(createStatusCode('100')().toString()).toEqual('100');
        expect(createStatusCode(400)().toString()).toEqual('400');
    });
    test('Route.toNumber() should return valid  statuscode number', () => {
        expect(createStatusCode('200')().toNumber()).toEqual(200);
        expect(createStatusCode('100')().toNumber()).toEqual(100);
        expect(createStatusCode('500')().toNumber()).toEqual(500);
    });
});
