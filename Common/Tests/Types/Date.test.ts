import moment, { isMoment } from 'moment';
import OneUptimeDate from '../../Types/Date';
import PositiveNumber from '../../Types/PositiveNumber';

describe('class OneUptimeDate', () => {
    test('OneUptimeDate.getCurrentDate should return current date', () => {
        expect(OneUptimeDate.getCurrentDate().getFullYear()).toEqual(
            new Date().getFullYear()
        );
        expect(OneUptimeDate.getCurrentDate().getDay()).toEqual(
            new Date().getDay()
        );
        expect(OneUptimeDate.getCurrentDate().getDate()).toEqual(
            new Date().getDate()
        );
        expect(OneUptimeDate.getCurrentDate().getHours()).toEqual(
            new Date().getHours()
        );
        expect(isMoment(OneUptimeDate.getCurrentDate())).toBeFalsy();
    });
    test('OneUptimeDAte.getCurrentMomentDate() should return moment Date', () => {
        expect(isMoment(OneUptimeDate.getCurrentMomentDate())).toBeTruthy();
    });
    test('OneUptimeDAte.getSomeMinutesAgo should return someMinutes ago Date from current time', () => {
        expect(
            OneUptimeDate.getSomeMinutesAgo(new PositiveNumber(4)).getMinutes()
        ).toEqual(moment().add(-4, 'minutes').toDate().getMinutes());
    });
    test('OneUptimeDAte.getOneMinAgo should return one minute age Date from current time', () => {
        expect(OneUptimeDate.getOneMinAgo().getMinutes()).toEqual(
            moment().add(-1, 'minute').toDate().getMinutes()
        );
    });
    test('OneUptimeDAte.getOneDayAgo should return oneDate ago Date', () => {
        expect(OneUptimeDate.getOneDayAgo().getDay()).toEqual(
            moment().add(-1, 'day').toDate().getDay()
        );
    });
    test('OneUptimeDAte.getSomeHoursAgo should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeHoursAgo(new PositiveNumber(4)).getHours()
        ).toEqual(moment().add(-4, 'hours').toDate().getHours());
    });
    test('OneUptimeDAte.getSomeDaysAgo should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeDaysAgo(new PositiveNumber(4)).getDay()
        ).toEqual(moment().add(-4, 'days').toDate().getDay());
    });
    test('OneUptimeDAte.getSomeSecondsAgo should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeSecondsAgo(new PositiveNumber(4)).getSeconds()
        ).toEqual(moment().add(-4, 'seconds').toDate().getSeconds());
    });
    test('OneUptimeDAte.getOneMinAfter should return moment Date', () => {
        expect(OneUptimeDate.getOneMinAfter().getMinutes()).toEqual(
            moment().add(1, 'minute').toDate().getMinutes()
        );
    });
    test('OneUptimeDAte.getOneDayAfter should return moment Date', () => {
        expect(OneUptimeDate.getOneDayAfter()).toEqual(
            moment().add(1, 'day').toDate()
        );
    });
    test('OneUptimeDAte.getSomeMinutesAfter should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeMinutesAfter(
                new PositiveNumber(4)
            ).getMinutes()
        ).toEqual(moment().add(4, 'minutes').toDate().getMinutes());
    });
    test('OneUptimeDAte.getSomeHoursAfter should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeHoursAfter(new PositiveNumber(4)).getHours()
        ).toEqual(moment().add(4, 'hours').toDate().getHours());
    });
    test('OneUptimeDAte.getSomeDaysAfter should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeDaysAfter(new PositiveNumber(4)).getDay()
        ).toEqual(moment().add(4, 'days').toDate().getDay());
    });
    test('OneUptimeDAte.getSomeSecondsAfter should return moment Date', () => {
        expect(
            OneUptimeDate.getSomeSecondsAfter(
                new PositiveNumber(4)
            ).getSeconds()
        ).toEqual(moment().add(4, 'seconds').toDate().getSeconds());
    });
    test('OneUptimeDAte.getCurrentYear should return the current year', () => {
        expect(
            OneUptimeDate.getSomeSecondsAfter(
                new PositiveNumber(4)
            ).getSeconds()
        ).toEqual(moment().add(4, 'seconds').toDate().getSeconds());
    });
});
