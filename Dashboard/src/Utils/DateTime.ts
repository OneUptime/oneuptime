import moment from 'moment';
import differenceInDays from 'date-fns/differenceInDays';
import differenceInWeeks from 'date-fns/differenceInWeeks';
import differenceInMonths from 'date-fns/differenceInMonths';

const _this: $TSFixMe = {
    // This function will strip
    changeDateTimezone: function (date: $TSFixMe, timezone: $TSFixMe): void {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        // Eg. moment.tz("2013-11-18 11:55", "Asia/Taipei");
        return moment
            .tz(
                `${date.getFullYear()}-${
                    date.getMonth() + 1
                }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`,
                timezone
            )
            .toDate();
    },

    convertToTimezone: function (date: $TSFixMe, timezone: $TSFixMe): void {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).tz(timezone).toDate();
    },

    convertToCurrentTimezone: function (date: $TSFixMe): void {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).tz(moment.tz.guess()).toDate();
    },

    format: function (date: $TSFixMe, formatString: $TSFixMe): void {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).format(formatString);
    },

    getCurrentTimezoneAbbr: function (): void {
        return moment.tz(moment.tz.guess()).zoneAbbr();
    },

    getCurrentTimezone: function (): void {
        return moment.tz.guess();
    },

    getDifferenceInMonths(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInMonths(date2, date1);
    },

    getDifferenceInDays(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInDays(date2, date1);
    },

    getDifferenceInWeeks(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInWeeks(date2, date1);
    },

    greaterThan(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() > date2.getTime();
    },

    lessThan(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() < date2.getTime();
    },

    equalTo(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() === date2.getTime();
    },

    notEqualTo(date1: $TSFixMe, date2: $TSFixMe) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }

        return date1.getTime() !== date2.getTime();
    },

    //This will change the date to today and will retain the time.
    moveDateToToday(date: $TSFixMe) {
        const today: $TSFixMe = new Date();

        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment
            .tz(
                `${today.getFullYear()}-${
                    today.getMonth() + 1
                }-${today.getDate()} ${date.getHours()}:${date.getMinutes()}`,
                this.getCurrentTimezone()
            )
            .toDate();
    },

    isOlderThanLastMinute(date: $TSFixMe) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        const current: $TSFixMe = new Date();
        date = moment(date).add(1, 'minutes').toDate();

        return this.lessThan(date, current);
    },
};

export default _this;
