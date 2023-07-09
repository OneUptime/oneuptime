import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Link from 'Common/Types/Link';
import Navigation from 'CommonUI/src/Utils/Navigation';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    let subItemMenuLink: Link | undefined = undefined;

    if (
        Navigation.isOnThisPage(
            RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]!
        )
    ) {
        subItemMenuLink = {
            title: 'Timeline',
            to: Navigation.getCurrentRoute(),
        };
    }

    return (
        <SideMenu>
            <SideMenuSection title="Overview">
                <SideMenuItem
                    link={{
                        title: 'On Call Policies',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route
                        ),
                    }}
                    icon={IconProp.Call}
                />
            </SideMenuSection>
            <SideMenuSection title="More">
                <SideMenuItem
                    link={{
                        title: 'Execution Logs',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.ON_CALL_DUTY_EXECUTION_LOGS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Logs}
                    subItemIcon={IconProp.Clock}
                    subItemLink={subItemMenuLink}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
