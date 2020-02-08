import moment from 'moment';
import differenceInDays from 'date-fns/differenceInDays';
import differenceInWeeks from'date-fns/differenceInWeeks';
import differenceInMonths from 'date-fns/differenceInMonths';

var _this = {
    // This function will strip
    changeDateTimezone: function (date, timezone) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        // eg. moment.tz("2013-11-18 11:55", "Asia/Taipei");
        return moment.tz(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`, timezone).toDate();
    },

    convertToTimezone: function (date, timezone) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).tz(timezone).toDate();
    },

    convertToCurrentTimezone: function (date) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).tz(moment.tz.guess()).toDate();
    },

    format: function (date, formatString) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment(date).format(formatString);
    },

    getCurrentTimezoneAbbr: function () {
        return moment.tz(moment.tz.guess()).zoneAbbr();
    },

    getCurrentTimezone: function () {
        return moment.tz.guess();
    },

    getDifferenceInMonths(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (_this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInMonths(date2, date1);
    },

    getDifferenceInDays(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (_this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInDays(date2, date1);
    },

    getDifferenceInWeeks(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        if (_this.greaterThan(date1, date2)) {
            return 0;
        }
        return differenceInWeeks(date2, date1);
    },

    greaterThan(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() > date2.getTime();
    },

    lessThan(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() < date2.getTime();
    },

    equalTo(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }
        return date1.getTime() === date2.getTime();
    },

    notEqualTo(date1, date2) {
        if (typeof date1 === 'string') {
            date1 = new Date(date1);
        }
        if (typeof date2 === 'string') {
            date2 = new Date(date2);
        }

        return date1.getTime() !== date2.getTime();
    },

    //This will change the date to today and will retain the time. 
    moveDateToToday(date) {
        var today = new Date();

        if (typeof date === 'string') {
            date = new Date(date);
        }

        return moment.tz(`${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()} ${date.getHours()}:${date.getMinutes()}`, _this.getCurrentTimezone()).toDate();
    },

    isInLastMinute(date){
        var current = new Date();
        if (typeof date === 'string') {
            date = new Date(date);
        }

        var date = moment(date).add(60, 'seconds');
        return _this.greaterThan(date, current);
    }
};

export default _this; 