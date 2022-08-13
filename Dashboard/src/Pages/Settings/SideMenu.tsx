import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Project',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS] as Route
                        ),
                    }}
                    icon={IconProp.Folder}
                />
                <SideMenuItem
                    link={{
                        title: 'Labels',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_LABELS] as Route
                        ),
                    }}
                    icon={IconProp.Label}
                />
                <SideMenuItem
                    link={{
                        title: 'Integrations',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Integrations}
                />
            </SideMenuSection>
            <SideMenuSection title="Templates">
                <SideMenuItem
                    link={{
                        title: 'Incident Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Alert}
                />
                <SideMenuItem
                    link={{
                        title: 'Email Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Email}
                />
                <SideMenuItem
                    link={{
                        title: 'SMS Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.SMS}
                />
            </SideMenuSection>
            <SideMenuSection title="Resource Settings">
                <SideMenuItem
                    link={{
                        title: 'Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_MONITORS] as Route
                        ),
                    }}
                    icon={IconProp.Activity}
                />
                <SideMenuItem
                    link={{
                        title: 'Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_INCIDENTS] as Route
                        ),
                    }}
                    icon={IconProp.Alert}
                />
            </SideMenuSection>
            <SideMenuSection title="Team">
                <SideMenuItem
                    link={{
                        title: 'Teams and Members',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_TEAMS] as Route
                        ),
                    }}
                    icon={IconProp.User}
                />
            </SideMenuSection>
            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'API Keys',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                        ),
                    }}
                    icon={IconProp.Terminal}
                />
                <SideMenuItem
                    link={{
                        title: 'SSO',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Lock}
                />
                <SideMenuItem
                    link={{
                        title: 'Custom SMTP',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                        ),
                    }}
                    icon={IconProp.Email}
                />
                <SideMenuItem
                    link={{
                        title: 'SMS & Call Provider',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Call}
                />
            </SideMenuSection>
            <SideMenuSection title="Danger Zone">
                <SideMenuItem
                    link={{
                        title: 'Danger Zone',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                        ),
                    }}
                    icon={IconProp.Error}
                    className="danger-on-hover"
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
