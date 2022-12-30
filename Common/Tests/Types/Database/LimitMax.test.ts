import LIMIT_MAX, { LIMIT_PER_PROJECT } from '../../../Types/Database/LimitMax';

describe('LIMIT_MAX', () => {
    test('it should ', () => {
        expect(LIMIT_MAX).toEqual(1000);
    });
});

describe('LIMIT_MAX', () => {
    test('it should have a value', () => {
        expect(LIMIT_MAX).toEqual(1000);
    });
});

describe('LIMIT_PER_PROJECT', () => {
    test('it should have a value ', () => {
        expect(LIMIT_PER_PROJECT).toEqual(100);
    });
});
