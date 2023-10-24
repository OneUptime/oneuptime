import DatabaseDate from '../../../Types/Database/Date';
import moment from 'moment';
import InBetween from '../../../Types/Database/InBetween';
import { JSONObject } from '../../../Types/JSON';

describe('DatabaseDate', () => {
    describe('asDateStartOfTheDayEndOfTheDayForDatabaseQuery', () => {
        it('should return InBetween object for a valid Date input', () => {
            const inputDate: Date = new Date('2023-10-24T12:00:00Z');
            const result: JSONObject =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                    inputDate
                ).toJSON();

            const expectedStart: string = moment(inputDate)
                .startOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
            const expectedEnd: string = moment(inputDate)
                .endOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
            expect(result).toEqual({
                startValue: expectedStart,
                endValue: expectedEnd,
                _type: 'InBetween',
            });
        });

        it('should return InBetween object for a valid Date string input', () => {
            const inputDate: string = '2023-10-24T12:00:00Z';
            const result: JSONObject =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                    inputDate
                ).toJSON();
            const expectedStart: string = moment(inputDate)
                .startOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
            const expectedEnd: string = moment(inputDate)
                .endOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
            expect(result).toEqual({
                startValue: expectedStart,
                endValue: expectedEnd,
                _type: 'InBetween',
            });
        });

        it('should handle invalid date string gracefully', () => {
            const inputDate: string = 'invalid-date';
            const result: JSONObject =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                    inputDate
                ).toJSON();
            expect(result).toEqual({
                startValue: 'Invalid date',
                endValue: 'Invalid date',
                _type: 'InBetween',
            });
        });

        it('should handle empty string input gracefully', () => {
            const inputDate: string = '';
            const result: JSONObject =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                    inputDate
                ).toJSON();
            expect(result).toEqual({
                startValue: 'Invalid date',
                endValue: 'Invalid date',
                _type: 'InBetween',
            });
        });

        it('should be a type of InBetween', () => {
            const inputDate: string = '2023-10-24T12:00:00Z';
            const result: InBetween =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                    inputDate
                );
            expect(result).toBeInstanceOf(InBetween);
        });
    });
});
