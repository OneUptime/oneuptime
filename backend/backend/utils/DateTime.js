var moment = require('moment');
const differenceInDays = require('date-fns/differenceInDays');
const differenceInWeeks = require('date-fns/differenceInWeeks');
const differenceInMonths = require('date-fns/differenceInMonths');

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

    isInBetween(date, startDate, endDate){
        if (typeof date === 'string') {
            date = new Date(date);
        }

        if (typeof startDate === 'string') {
            startDate = new Date(startDate);
        }

        if (typeof endDate === 'string') {
            endDate = new Date(endDate);
        }

        if(_this.greaterThan(startDate, date) && _this.lessThan(date, endDate)){
            return true;
        }

        return false; 
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
    }
};

module.exports = _this;