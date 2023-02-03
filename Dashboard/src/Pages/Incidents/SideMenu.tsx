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
import Incident from 'Model/Models/Incident';
import type Project from 'Model/Models/Project';
import CountModelSideMenuItem from 'CommonUI/src/Components/SideMenu/CountModelSideMenuItem';

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
                        title: 'Unresolved Incidents',
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
