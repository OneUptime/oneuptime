import CompanySize from '../../../Types/Company/CompanySize';

export default CompanySize;

describe('CompanySize', () => {
    test('should be in range of 1 to 10', () => {
        expect(CompanySize.OneToTen).toBe('1 to 10');
    });
    test('should be in range of 11 to 50', () => {
        expect(CompanySize.ElevenToFifty).toBe('11 to 50');
    });
    test('should be in range of 51 to 200', () => {
        expect(CompanySize.FiftyToTwoHundred).toBe('51 to 200');
    });
    test('should be in range of 201 to 500', () => {
        expect(CompanySize.TwoHundredToFiveHundred).toBe('201 to 500');
    });
    test('should be greater than 500', () => {
        expect(CompanySize.FiveHundredAndMore).toBe('500+');
    });
});
