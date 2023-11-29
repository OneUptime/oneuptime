import UserModel from "../../Models/UserModel"
import Recurring from "../Events/Recurring";
import CalendarEvent from "../Calendar/CalendarEvent";
import RestrictionTimes from "./RestrictionTimes";

export default class Layer {
    public static getEvents(data: {
        users: Array<UserModel>,
        startDateTimeOfLayer: Date,
        calendarStartDate: Date,
        calendarEndDate: Date,
        restrictionTImes: RestrictionTimes, 
        handOffTime: Date,
        rotation: Recurring
    }): Array<CalendarEvent> {
        return [];
    }
}