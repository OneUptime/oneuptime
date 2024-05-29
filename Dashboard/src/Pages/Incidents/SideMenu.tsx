import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import { BadgeType } from 'CommonUI/src/Components/Badge/Badge';
import CountModelSideMenuItem from 'CommonUI/src/Components/SideMenu/CountModelSideMenuItem';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import Incident from 'Model/Models/Incident';
import Project from 'Model/Models/Project';
import React, { FunctionComponent, ReactElement } from 'react';

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
                        title: 'All Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.INCIDENTS] as Route
                        ),
                    }}
                    icon={IconProp.List}
                />

                <CountModelSideMenuItem<Incident>
                    link={{
                        title: 'Active Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route
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
        </SideMenu>
    );
};

export default DashboardSideMenu;
