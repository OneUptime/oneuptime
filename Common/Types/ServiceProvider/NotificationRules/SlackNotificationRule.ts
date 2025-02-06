import FilterCondition from "../../Filter/FilterCondition";
import BaseNotificationRule from "./BaseNotificationRule";

export default interface SlackNotificationRule extends BaseNotificationRule { 
    _type: "SlackNotificationRule";
    filterCondition: FilterCondition; // and OR or. Default is AND
}