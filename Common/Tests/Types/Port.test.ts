import BadDataException from '../../Types/Exception/BadDataException';
import Port from '../../Types/Port';
import PositiveNumber from '../../Types/PositiveNumber';

describe('Testing class port', () => {
    test('should return a posetive number', () => {
        const value: Port = new Port(3000);
        expect(value.port.positiveNumber).toBeGreaterThanOrEqual(0);
        expect(new Port('6000').port.positiveNumber).toEqual(6000);
    });

    test('should throw exception "Port should be in the range from 0 to 65535"', () => {
        expect(() => {
            new Port(67000);
        }).toThrow('Port should be in the range from 0 to 65535');
    });

    test('Port.port should be mutatable', () => {
        const value: Port = new Port(5000);
        value.port = new PositiveNumber(7000);
        expect(value.port.positiveNumber).toEqual(7000);
        expect(value.port.toNumber()).toEqual(7000);
    });

    test('try to mutating Port.port with invalid value should throw an BadDataExcepection', () => {
        const value: Port = new Port(3000);
        expect(() => {
            value.port = new PositiveNumber('hj567');
        }).toThrowError(BadDataException);
        expect(() => {
            value.port = new PositiveNumber(-6000);
        }).toThrow(BadDataException);
    });

    test('If the supplied port is string type, is should convert it to number before creating port', () => {
        const value: Port = new Port('6000');
        expect(typeof value.port.positiveNumber).toBe('number');
    });
});
