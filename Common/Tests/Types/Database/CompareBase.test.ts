import CompareBase from '../../../Types/Database/CompareBase';
import BadDataException from '../../../Types/Exception/BadDataException';

describe('CompareBase', () => {
    describe('toString', () => {
        it('should return string representation of value', () => {
            const compareBase: CompareBase = new CompareBase(10);
            expect(compareBase.toString()).toBe('10');
        });
    });

    describe('toNumber', () => {
        it('should return value as number if it is a number', () => {
            const compareBase: CompareBase = new CompareBase(10);
            expect(compareBase.toNumber()).toBe(10);
        });

        it('should throw BadDataException if value is not a number', () => {
            const compareBase: CompareBase = new CompareBase(new Date());
            expect(() => {
                return compareBase.toNumber();
            }).toThrow(BadDataException);
        });
    });

    describe('toDate', () => {
        it('should return value as date object if it is a date object', () => {
            const date: Date = new Date();
            const compareBase: CompareBase = new CompareBase(date);
            expect(compareBase.toDate()).toBe(date);
        });

        it('should throw BadDataException if value is not a date object', () => {
            const compareBase: CompareBase = new CompareBase(10);
            expect(() => {
                return compareBase.toDate();
            }).toThrow(BadDataException);
        });
    });
});
