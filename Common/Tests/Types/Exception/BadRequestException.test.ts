import BadRequestException from '../../../Types/Exception/BadRequestException';

describe('BadRequestException', () => {
    test('should throw a bad request exception', () => {
        expect(() => {
            throw new BadRequestException('Forbidden. A token is needed');
        }).toThrow('Forbidden. A token is needed');
    });

    test('should return 400 as the code for BadRequestException', () => {
        expect(
            new BadRequestException('Forbidden. A token is needed').code
        ).toBe(400);
    });
});
