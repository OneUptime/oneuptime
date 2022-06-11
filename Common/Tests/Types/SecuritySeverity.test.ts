import SecuritySeverity from '../../Types/SecuritySeverity';

describe('enum SecuritySeverity', () => {
    test('SecuritySeverity.Critical should be Critcal', () => {
        expect(SecuritySeverity.Critical).toEqual('Critical');
    });
    test('SecuritySeverity.High should be High', () => {
        expect(SecuritySeverity.High).toEqual('High');
    });
    test('SecuritySeverity.Medium should be Medium', () => {
        expect(SecuritySeverity.Medium).toEqual('Medium');
    });
    test('SecuritySeverity.Low should be Low', () => {
        expect(SecuritySeverity.Low).toEqual('Low');
    });
});
