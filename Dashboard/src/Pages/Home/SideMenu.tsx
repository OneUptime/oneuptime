import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/CountModelSideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import { BadgeType } from 'CommonUI/src/Components/Badge/Badge';
import Incident from 'Model/Models/Incident';
import Project from 'Model/Models/Project';
import Monitor from 'Model/Models/Monitor';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';

export interface ComponentProps {
    project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Incidents">
                <SideMenuItem<Incident>
                    link={{
                        title: 'Unresolved Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.HOME] as Route
                        ),
                    }}
                    icon={IconProp.Alert}
                    badgeType={BadgeType.DANGER}
                    modelType={Incident}
                    countQuery={{
                        projectId: props.project?._id,
                        currentIncidentState: {
                            isResolvedState: false,
                        },
                    }}
                />
            </SideMenuSection>
            <SideMenuSection title="Monitors">
                <SideMenuItem<Monitor>
                    link={{
                        title: 'Inoperational Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.HOME_NOT_OPERATIONAL_MONITORS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Activity}
                    countQuery={{
                        projectId: props.project?._id,
                        currentMonitorStatus: {
                            isOperationalState: false,
                        },
                    }}
                    modelType={Monitor}
                    badgeType={BadgeType.DANGER}
                />
            </SideMenuSection>
            <SideMenuSection title="Scheduled Maintenance">
                <SideMenuItem<Monitor>
                    link={{
                        title: 'Ongoing Events',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap
                                    .HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Clock}
                    countQuery={{
                        projectId: props.project?._id,
                        currentScheduledMaintenanceState: {
                            isOngoingState: true,
                        },
                    }}
                    modelType={ScheduledMaintenance}
                    badgeType={BadgeType.WARNING}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
