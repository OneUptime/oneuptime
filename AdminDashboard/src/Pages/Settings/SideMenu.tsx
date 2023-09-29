import React, { ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                {/* <SideMenuItem
                    link={{
                        title: 'Host',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_HOST] as Route
                        ),
                    }}
                    icon={IconProp.Globe}
                /> */}
                <SideMenuItem
                    link={{
                        title: 'Authentication',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route
                        ),
                    }}
                    icon={IconProp.Lock}
                />
            </SideMenuSection>

            <SideMenuSection title="Notifications">
                <SideMenuItem
                    link={{
                        title: 'Emails',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_SMTP] as Route
                        ),
                    }}
                    icon={IconProp.Email}
                />
                <SideMenuItem
                    link={{
                        title: 'Call and SMS',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route
                        ),
                    }}
                    icon={IconProp.Call}
                />
            </SideMenuSection>

            <SideMenuSection title="Monitoring">
                <SideMenuItem
                    link={{
                        title: 'Global Probes',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_PROBES] as Route
                        ),
                    }}
                    icon={IconProp.Signal}
                />
            </SideMenuSection>
            <SideMenuSection title="API and Integrations">
                <SideMenuItem
                    link={{
                        title: 'API Key',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_API_KEY] as Route
                        ),
                    }}
                    icon={IconProp.Code}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
