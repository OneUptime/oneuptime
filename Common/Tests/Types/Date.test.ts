import OneUptimeDate from '../../Types/Date';

describe('class OneUptimeDate', () => {
    test('new OneUptimeDate', () => {
        const date: OneUptimeDate = new OneUptimeDate();
        expect(date).toBeInstanceOf(OneUptimeDate);
    });
});
