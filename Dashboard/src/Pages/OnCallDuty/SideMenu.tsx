import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
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
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
