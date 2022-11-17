import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import { BILLING_ENABLED } from 'CommonUI/src/Config';

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
                {/* <SideMenuItem
                    link={{
                        title: 'Integrations',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Integrations}
                /> */}
            </SideMenuSection>
            {/* <SideMenuSection title="Templates">
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
            </SideMenuSection> */}
            <SideMenuSection title="Monitors">
                <SideMenuItem
                    link={{
                        title: 'Monitor Status',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route
                        ),
                    }}
                    icon={IconProp.Activity}
                />
            </SideMenuSection>
            <SideMenuSection title="Incidents">
                <SideMenuItem
                    link={{
                        title: 'Incident State',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route
                        ),
                    }}
                    icon={IconProp.Disc}
                />
                <SideMenuItem
                    link={{
                        title: 'Incident Severity',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.SETTINGS_INCIDENTS_SEVERITY
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Error}
                />
                {/* <SideMenuItem
                    link={{
                        title: 'Incident Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.TextFile}
                /> */}
            </SideMenuSection>
            <SideMenuSection title="Scheduled Maintenance">
                <SideMenuItem
                    link={{
                        title: 'Event State',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Clock}
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
                        title: 'Domains',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_DOMAINS] as Route
                        ),
                    }}
                    icon={IconProp.Globe}
                />
                <SideMenuItem
                    link={{
                        title: 'API Keys',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                        ),
                    }}
                    icon={IconProp.Terminal}
                />
                {/* <SideMenuItem
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
                /> */}
                {/* <SideMenuItem
                    link={{
                        title: 'SMS & Call Provider',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Call}
                /> */}
            </SideMenuSection>
            {BILLING_ENABLED ? (
                <SideMenuSection title="Billing and Invoices">
                    <SideMenuItem
                        link={{
                            title: 'Billing',
                            to: RouteUtil.populateRouteParams(
                                RouteMap[PageMap.SETTINGS_BILLING] as Route
                            ),
                        }}
                        icon={IconProp.Billing}
                    />
                    {/* <SideMenuItem
                    link={{
                        title: 'Invoices',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route
                        ),
                    }}
                    icon={IconProp.File}
                /> */}
                </SideMenuSection>
            ) : (
                <></>
            )}
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
