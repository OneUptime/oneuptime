import PositiveNumber from './PositiveNumber';

export default class OneUptimeDate {
    static getCurrentDate(): Date {
        return new Date();
    }

    static getOneMinAgo(): Date {
        return this.getSomeMinutesAgo(new PositiveNumber(1));
    }

    static getSomeMinutesAgo(minutes: PositiveNumber) {
        return new Date(new Date().getTime() - minutes.toNumber() * 60 * 1000);
    }

    static getSomeSecondsAgo(seconds: PositiveNumber) {
        return new Date(new Date().getTime() - seconds.toNumber() * 1000);
    }
}
