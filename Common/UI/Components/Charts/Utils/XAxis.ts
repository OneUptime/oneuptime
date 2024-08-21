import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import XAxisPrecision from "../Types/XAxis/XAxisPrecision";

export default class XAxisUtil {
    public static getPrecision(data: {
        xAxisMin: XAxisMaxMin,
        xAxisMax: XAxisMaxMin,
    }): XAxisPrecision {

        if (typeof data.xAxisMax === "number" || typeof data.xAxisMin === "number") {
            // number not yet supported. 
            throw new NotImplementedException();
        }

        const startDate: Date = data.xAxisMin;
        const endDate: Date = data.xAxisMax;

        const totalMilliseconds = endDate.getTime() - startDate.getTime();
        const totalSeconds = totalMilliseconds / 1000;
        const totalMinutes = totalSeconds / 60;
        const totalHours = totalMinutes / 60;
        const totalDays = totalHours / 24;
        const totalWeeks = totalDays / 7;
        const totalMonths = totalDays / 30;


        if (totalSeconds <= 200) return XAxisPrecision.EVERY_SECOND;
        if (totalSeconds <= 1000) return XAxisPrecision.EVERY_FIVE_SECONDS;
        if (totalSeconds <= 2000) return XAxisPrecision.EVERY_TEN_SECONDS;
        if (totalSeconds <= 6000) return XAxisPrecision.EVERY_THIRTY_SECONDS;
        if (totalMinutes <= 200) return XAxisPrecision.EVERY_MINUTE;
        if (totalMinutes <= 1000) return XAxisPrecision.EVERY_FIVE_MINUTES;
        if (totalMinutes <= 2000) return XAxisPrecision.EVERY_TEN_MINUTES;
        if (totalMinutes <= 6000) return XAxisPrecision.EVERY_THIRTY_MINUTES;
        if (totalHours <= 200) return XAxisPrecision.EVERY_HOUR;
        if (totalHours <= 400) return XAxisPrecision.EVERY_TWO_HOURS;
        if (totalHours <= 600) return XAxisPrecision.EVERY_THREE_HOURS;
        if (totalHours <= 1200) return XAxisPrecision.EVERY_SIX_HOURS;
        if (totalHours <= 2400) return XAxisPrecision.EVERY_TWELVE_HOURS;
        if (totalDays <= 200) return XAxisPrecision.EVERY_DAY;
        if (totalDays <= 400) return XAxisPrecision.EVERY_TWO_DAYS;
        if (totalWeeks <= 200) return XAxisPrecision.EVERY_WEEK;
        if (totalWeeks <= 400) return XAxisPrecision.EVERY_TWO_WEEKS;
        if (totalMonths <= 200) return XAxisPrecision.EVERY_MONTH;
        if (totalMonths <= 400) return XAxisPrecision.EVERY_TWO_MONTHS;
        if (totalMonths <= 600) return XAxisPrecision.EVERY_THREE_MONTHS;
        if (totalMonths <= 1200) return XAxisPrecision.EVERY_SIX_MONTHS;
        return XAxisPrecision.EVERY_YEAR;

    }

    public static getPrecisionIntervals(data: {
        xAxisMin: XAxisMaxMin,
        xAxisMax: XAxisMaxMin,
    }): Array<Date> {
        const precision: XAxisPrecision = XAxisUtil.getPrecision(data);
    
        if (typeof data.xAxisMax === "number" || typeof data.xAxisMin === "number") {
            // number not yet supported. 
            throw new NotImplementedException();
        }
    
        const startDate: Date = new Date(data.xAxisMin);
        const endDate: Date = new Date(data.xAxisMax);
        const intervals: Array<Date> = [];
    
        let currentDate = startDate;
    
        while (currentDate <= endDate) {
            intervals.push(new Date(currentDate));
    
            switch (precision) {
                case XAxisPrecision.EVERY_SECOND:
                    currentDate.setSeconds(currentDate.getSeconds() + 1);
                    break;
                case XAxisPrecision.EVERY_FIVE_SECONDS:
                    currentDate.setSeconds(currentDate.getSeconds() + 5);
                    break;
                case XAxisPrecision.EVERY_TEN_SECONDS:
                    currentDate.setSeconds(currentDate.getSeconds() + 10);
                    break;
                case XAxisPrecision.EVERY_THIRTY_SECONDS:
                    currentDate.setSeconds(currentDate.getSeconds() + 30);
                    break;
                case XAxisPrecision.EVERY_MINUTE:
                    currentDate.setMinutes(currentDate.getMinutes() + 1);
                    break;
                case XAxisPrecision.EVERY_FIVE_MINUTES:
                    currentDate.setMinutes(currentDate.getMinutes() + 5);
                    break;
                case XAxisPrecision.EVERY_TEN_MINUTES:
                    currentDate.setMinutes(currentDate.getMinutes() + 10);
                    break;
                case XAxisPrecision.EVERY_THIRTY_MINUTES:
                    currentDate.setMinutes(currentDate.getMinutes() + 30);
                    break;
                case XAxisPrecision.EVERY_HOUR:
                    currentDate.setHours(currentDate.getHours() + 1);
                    break;
                case XAxisPrecision.EVERY_TWO_HOURS:
                    currentDate.setHours(currentDate.getHours() + 2);
                    break;
                case XAxisPrecision.EVERY_THREE_HOURS:
                    currentDate.setHours(currentDate.getHours() + 3);
                    break;
                case XAxisPrecision.EVERY_SIX_HOURS:
                    currentDate.setHours(currentDate.getHours() + 6);
                    break;
                case XAxisPrecision.EVERY_TWELVE_HOURS:
                    currentDate.setHours(currentDate.getHours() + 12);
                    break;
                case XAxisPrecision.EVERY_DAY:
                    currentDate.setDate(currentDate.getDate() + 1);
                    break;
                case XAxisPrecision.EVERY_TWO_DAYS:
                    currentDate.setDate(currentDate.getDate() + 2);
                    break;
                case XAxisPrecision.EVERY_WEEK:
                    currentDate.setDate(currentDate.getDate() + 7);
                    break;
                case XAxisPrecision.EVERY_TWO_WEEKS:
                    currentDate.setDate(currentDate.getDate() + 14);
                    break;
                case XAxisPrecision.EVERY_MONTH:
                    currentDate.setMonth(currentDate.getMonth() + 1);
                    break;
                case XAxisPrecision.EVERY_TWO_MONTHS:
                    currentDate.setMonth(currentDate.getMonth() + 2);
                    break;
                case XAxisPrecision.EVERY_THREE_MONTHS:
                    currentDate.setMonth(currentDate.getMonth() + 3);
                    break;
                case XAxisPrecision.EVERY_SIX_MONTHS:
                    currentDate.setMonth(currentDate.getMonth() + 6);
                    break;
                case XAxisPrecision.EVERY_YEAR:
                    currentDate.setFullYear(currentDate.getFullYear() + 1);
                    break;
            }
        }
    
        return intervals;
    }

    public static getFormatter(data: {
        xAxisMin: XAxisMaxMin,
        xAxisMax: XAxisMaxMin,
    }): (value: Date) => string {

        const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

        switch (precision) {
            case XAxisPrecision.EVERY_SECOND:
            case XAxisPrecision.EVERY_FIVE_SECONDS:
            case XAxisPrecision.EVERY_TEN_SECONDS:
            case XAxisPrecision.EVERY_THIRTY_SECONDS:
                return (value: Date) => value.toISOString().substring(11, 19); // HH:mm:ss
            case XAxisPrecision.EVERY_MINUTE:
            case XAxisPrecision.EVERY_FIVE_MINUTES:
            case XAxisPrecision.EVERY_TEN_MINUTES:
            case XAxisPrecision.EVERY_THIRTY_MINUTES:
                return (value: Date) => value.toISOString().substring(11, 16); // HH:mm
            case XAxisPrecision.EVERY_HOUR:
            case XAxisPrecision.EVERY_TWO_HOURS:
            case XAxisPrecision.EVERY_THREE_HOURS:
            case XAxisPrecision.EVERY_SIX_HOURS:
            case XAxisPrecision.EVERY_TWELVE_HOURS:
                return (value: Date) => value.toISOString().substring(11, 13) + ":00"; // HH:00
            case XAxisPrecision.EVERY_DAY:
            case XAxisPrecision.EVERY_TWO_DAYS:
                return (value: Date) => value.toISOString().substring(0, 10); // YYYY-MM-DD
            case XAxisPrecision.EVERY_WEEK:
            case XAxisPrecision.EVERY_TWO_WEEKS:
                return (value: Date) => {
                    const startOfWeek = new Date(value);
                    startOfWeek.setDate(value.getDate() - value.getDay());
                    return startOfWeek.toISOString().substring(0, 10); // YYYY-MM-DD
                };
            case XAxisPrecision.EVERY_MONTH:
            case XAxisPrecision.EVERY_TWO_MONTHS:
            case XAxisPrecision.EVERY_THREE_MONTHS:
            case XAxisPrecision.EVERY_SIX_MONTHS:
                return (value: Date) => value.toISOString().substring(0, 7); // YYYY-MM
            case XAxisPrecision.EVERY_YEAR:
                return (value: Date) => value.toISOString().substring(0, 4); // YYYY
            default:
                throw new Error("Unsupported precision");
        }
    }
}