import JobRole from '../../../Types/Company/JobRole';

describe('JobRole', () => {
    test('should have a role of CEO', () => {
        expect(JobRole.CEO).toBe('CEO');
    });
    test('should have a role of CEO', () => {
        expect(JobRole.CTO).toBe('CTO');
    });
    test('should have a role of CEO', () => {
        expect(JobRole.CIO).toBe('CIO');
    });
    test('should have a role of executive', () => {
        expect(JobRole.Executive).toBe('Executive');
    });
    test('should have a role of developer', () => {
        expect(JobRole.Developer).toBe('Developer');
    });
    test('should have a role of engineering manager', () => {
        expect(JobRole.EngineeringManager).toBe('EngineeringManager');
    });
});
