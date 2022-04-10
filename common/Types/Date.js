"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const PositiveNumber_1 = __importDefault(require("./PositiveNumber"));
const moment_1 = __importDefault(require("moment"));
class OneUptimeDate {
    static getCurrentDate() {
        return (0, moment_1.default)().toDate();
    }
    static getCurrentMomentDate() {
        return (0, moment_1.default)();
    }
    static getOneMinAgo() {
        return this.getSomeMinutesAgo(new PositiveNumber_1.default(1));
    }
    static getOneDayAgo() {
        return this.getSomeDaysAgo(new PositiveNumber_1.default(1));
    }
    static getSomeMinutesAgo(minutes) {
        return this.getCurrentMomentDate()
            .add(-1 * minutes.toNumber(), 'minutes')
            .toDate();
    }
    static getSomeHoursAgo(hours) {
        return this.getCurrentMomentDate()
            .add(-1 * hours.toNumber(), 'hours')
            .toDate();
    }
    static getSomeDaysAgo(days) {
        return this.getCurrentMomentDate()
            .add(-1 * days.toNumber(), 'days')
            .toDate();
    }
    static getSomeSecondsAgo(seconds) {
        return this.getCurrentMomentDate()
            .add(-1 * seconds.toNumber(), 'days')
            .toDate();
    }
    static momentToDate(moment) {
        return moment.toDate();
    }
}
exports.default = OneUptimeDate;
