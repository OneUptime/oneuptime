import BadDataException from '../../../Types/Exception/BadDataException';

describe('BadDataException', () => {
    test('should throw a not bad data exception', () => {
        expect(() => {
            throw new BadDataException('This is not a valid IPv4 address');
        }).toThrow('This is not a valid IPv4 address');
    });
});
