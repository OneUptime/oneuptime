import NotImplementedException from '../../../Types/Exception/NotImplementedException';

describe('NotImplementedException', () => {
    test('should throw a not implemented exception', () => {
        expect(() => {
            throw new NotImplementedException();
        }).toThrow('This code is not implemented');
    });

    test('should return 0 as the code for NotImplementedException', () => {
        expect(new NotImplementedException().code).toBe(0);
    });
});
