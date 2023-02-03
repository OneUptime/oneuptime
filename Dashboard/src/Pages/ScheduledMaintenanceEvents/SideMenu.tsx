import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import { BadgeType } from 'CommonUI/src/Components/Badge/Badge';
import type Project from 'Model/Models/Project';
import CountModelSideMenuItem from 'CommonUI/src/Components/SideMenu/CountModelSideMenuItem';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';

export interface ComponentProps {
    project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Overview">
                <SideMenuItem
                    link={{
                        title: 'All Events',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_EVENTS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.List}
                />

                <CountModelSideMenuItem<ScheduledMaintenance>
                    link={{
                        title: 'Ongoing Events',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Clock}
                    badgeType={BadgeType.WARNING}
                    modelType={ScheduledMaintenance}
                    countQuery={{
                        projectId: props.project?._id,
                        currentScheduledMaintenanceState: {
                            isOngoingState: true,
                        },
                    }}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
