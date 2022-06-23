import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Project',
                        to: RouteMap[PageMap.SETTINGS] as Route,
                    }}
                    icon={IconProp.Folder}
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
            <SideMenuSection title="Team">
                <SideMenuItem
                    link={{
                        title: 'Team Members',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.User}
                />
                <SideMenuItem
                    link={{
                        title: 'User Groups',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Team}
                />
            </SideMenuSection>
            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'API Keys',
                        to: RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
                    }}
                    icon={IconProp.Terminal}
                />
                <SideMenuItem
                    link={{
                        title: 'SSO',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Key}
                />
                <SideMenuItem
                    link={{
                        title: 'Custom SMTP',
                        to: new Route('/:projectSlug/home'),
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
                        to: RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
                    }}
                    icon={IconProp.Error}
                    className="danger-on-hover"
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
