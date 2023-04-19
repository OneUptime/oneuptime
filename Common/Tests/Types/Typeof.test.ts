import Typeof from '../../Types/Typeof';

describe('Typeof', () => {
    test('String should be string', () => {
        expect(Typeof.String).toBe('string');
    });

    test('Boolean should be boolean', () => {
        expect(Typeof.Boolean).toBe('boolean');
    });

    test('Number should be number', () => {
        expect(Typeof.Number).toBe('number');
    });

    test('Object should be object', () => {
        expect(Typeof.Object).toBe('object');
    });
});
