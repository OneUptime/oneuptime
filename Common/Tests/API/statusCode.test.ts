import StatusCode from '../../Types/API/StatusCode';
import BadDataException from '../../Types/Exception/BadDataException';
describe('Route', () => {
    test('new StatusCode should throw if number is not passed', () => {
        expect(() => {
            return new StatusCode('invalid');
        }).toThrowError(BadDataException);
        expect(() => {
            return new StatusCode(-400);
        }).toThrowError(BadDataException);
        expect(() => {
            return new StatusCode('-400');
        }).toThrowError(BadDataException);
    });
    test('Route.toString() should return valid  statuscode string', () => {
        expect(new StatusCode('200').toString()).toEqual('200');
        expect(new StatusCode('100').toString()).toEqual('100');
        expect(new StatusCode(400).toString()).toEqual('400');
    });
    test('Route.toNumber() should return valid  statuscode number', () => {
        expect(new StatusCode('200').toNumber()).toEqual(200);
        expect(new StatusCode('100').toNumber()).toEqual(100);
        expect(new StatusCode('500').toNumber()).toEqual(500);
    });
});
