import PositiveNumber from './PositiveNumber';
import moment from 'moment';

export default class OneUptimeDate {
    static getCurrentDate(): moment.Moment {
        return moment();
    }

    static getOneMinAgo(): moment.Moment {
        return this.getSomeMinutesAgo(new PositiveNumber(1));
    }

    static getOneDayAgo(): moment.Moment {
        return this.getSomeDaysAgo(new PositiveNumber(1));
    }

    static getSomeMinutesAgo(minutes: PositiveNumber) {
        return this.getCurrentDate().add(-1 * minutes.toNumber(), 'minutes');
    }

    static getSomeHoursAgo(hours: PositiveNumber) {
        return this.getCurrentDate().add(-1 * hours.toNumber(), 'hours');
    }

    static getSomeDaysAgo(days: PositiveNumber) {
        return this.getCurrentDate().add(-1 * days.toNumber(), 'days');
    }

    static getSomeSecondsAgo(seconds: PositiveNumber) {
        return this.getCurrentDate().add(-1 * seconds.toNumber(), 'days');
    }

    static toDate(moment: moment.Moment) {
        return moment.toDate();
    }
}
