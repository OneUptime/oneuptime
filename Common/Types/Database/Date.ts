import moment from "moment";
import OneUptimeDate from "../Date";
import InBetween from "./InBetween";

export default class DatabaseDate { 
    public static asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
        date: string | Date
    ): InBetween {
        let startValue: string | Date = date;

        if (!(startValue instanceof Date)) {
            startValue = OneUptimeDate.fromString(startValue);
        }

        let endValue: string | Date = date;

        if (!(endValue instanceof Date)) {
            endValue = OneUptimeDate.fromString(endValue);
        }

        startValue = OneUptimeDate.getStartOfDay(startValue);
        endValue = OneUptimeDate.getEndOfDay(endValue);

        return new InBetween(
            moment(startValue).format('YYYY-MM-DD HH:mm:ss'),
            moment(endValue).format('YYYY-MM-DD HH:mm:ss')
        );
    }
}