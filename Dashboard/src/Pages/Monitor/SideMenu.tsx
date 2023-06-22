import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import { BadgeType } from 'CommonUI/src/Components/Badge/Badge';
import Project from 'Model/Models/Project';
import CountModelSideMenuItem from 'CommonUI/src/Components/SideMenu/CountModelSideMenuItem';
import Monitor from 'Model/Models/Monitor';

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
                        title: 'All Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS] as Route
                        ),
                    }}
                    icon={IconProp.List}
                />

                <CountModelSideMenuItem<Monitor>
                    link={{
                        title: 'Inoperational Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route
                        ),
                    }}
                    icon={IconProp.Alert}
                    badgeType={BadgeType.DANGER}
                    modelType={Monitor}
                    countQuery={{
                        projectId: props.project?._id,
                        currentMonitorStatus: {
                            isOperationalState: false,
                        },
                    }}
                />
                <CountModelSideMenuItem<Monitor>
                    link={{
                        title: 'Disabled Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS_DISABLED] as Route
                        ),
                    }}
                    icon={IconProp.Error}
                    badgeType={BadgeType.DANGER}
                    modelType={Monitor}
                    countQuery={{
                        projectId: props.project?._id,
                        disableActiveMonitoring: true,
                    }}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
