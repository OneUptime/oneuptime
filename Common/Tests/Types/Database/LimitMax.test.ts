import LIMIT_MAX, { LIMIT_PER_PROJECT } from '../../../Types/Database/LimitMax';

describe('LIMIT_MAX', () => {
    test('it should be number', () => {
        expect(typeof LIMIT_MAX).toBe('number');
    });
});

describe('LIMIT_MAX', () => {
    test('it be positive', () => {
        expect(LIMIT_MAX).toBeGreaterThan(0);
    });
});

describe('LIMIT_PER_PROJECT', () => {
    test('should be positive number', () => {
        expect(typeof LIMIT_PER_PROJECT).toBe('number');
        expect(LIMIT_PER_PROJECT).toBeGreaterThan(0);
    });
});
