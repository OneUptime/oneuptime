import PositiveNumber from './PositiveNumber';
import moment from 'moment';

export default class OneUptimeDate {
    static getCurrentDate(): Date {
        return moment().toDate();
    }

    static getCurrentMomentDate(): moment.Moment {
        return moment();
    }

    static getOneMinAgo(): Date {
        return this.getSomeMinutesAgo(new PositiveNumber(1));
    }

    static getOneDayAgo(): Date {
        return this.getSomeDaysAgo(new PositiveNumber(1));
    }

    static getSomeMinutesAgo(minutes: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * minutes.toNumber(), 'minutes')
            .toDate();
    }

    static getSomeHoursAgo(hours: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * hours.toNumber(), 'hours')
            .toDate();
    }

    static getSomeDaysAgo(days: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * days.toNumber(), 'days')
            .toDate();
    }

    static getSomeSecondsAgo(seconds: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * seconds.toNumber(), 'days')
            .toDate();
    }

    static momentToDate(moment: moment.Moment): Date {
        return moment.toDate();
    }
}
