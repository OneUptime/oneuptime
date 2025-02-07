import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleConditionElement from "./NotificationRuleViewCondition";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleCondition from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import AlertSeverityElement from "../../AlertSeverity/AlertSeverityElement";
import AlertStateElement from "../../AlertState/AlertStateElement";
import IncidentSeverityElement from "../../IncidentSeverity/IncidentSeverityElement";
import IncidentStateElement from "../../IncidentState/IncidentStateElement";
import ScheduledMaintenanceStateElement from "../../ScheduledMaintenanceState/ScheduledMaintenanceStateElement";
import MonitorStatusElement from "../../MonitorStatus/MonitorStatusElement";
import LabelElement from "../../Label/Label";
import MonitorElement from "../../Monitor/Monitor";

export interface ComponentProps {
    criteriaFilters: Array<NotificationRuleCondition>;
    filterCondition: FilterCondition;
    eventType: NotificationRuleEventType;
    monitors: Array<Monitor>;
    labels: Array<Label>;
    alertStates: Array<AlertState>;
    alertSeverities: Array<AlertSeverity>;
    incidentSeverities: Array<IncidentSeverity>;
    incidentStates: Array<IncidentState>;
    scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
    monitorStatus: Array<MonitorStatus>;
}

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {
    return (
        <div className="ml-5 mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
            <ul role="list" className="space-y-6">
                {props.criteriaFilters.map((i: NotificationRuleCondition, index: number) => {
                    const isLastItem: boolean =
                        index === props.criteriaFilters.length - 1;
                    return (
                        <li className="relative flex gap-x-4" key={index}>
                            {!isLastItem && (
                                <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                                    <div className="w-px bg-gray-200"></div>
                                </div>
                            )}
                            <div className="relative flex h-6 w-6  flex-none items-center justify-center bg-gray-50">
                                <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300"></div>
                            </div>
                            <NotificationRuleConditionElement
                                {...props}
                                key={index}
                                notificationRuleCondition={i}
                                filterCondition={
                                    !isLastItem ? props.filterCondition : undefined
                                }
                            />{" "}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default NotificationRuleConditions;
