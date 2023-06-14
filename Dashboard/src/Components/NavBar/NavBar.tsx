import React, { FunctionComponent, ReactElement, useState } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarMenu from 'CommonUI/src/Components/Navbar/NavBarMenu';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import NavBarMenuItem from 'CommonUI/src/Components/Navbar/NavBarMenuItem';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import URL from 'Common/Types/API/URL';

export interface ComponentProps {
    show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isComponentVisible, setIsComponentVisible] =
        useState<boolean>(false);
    const [moreMenuTimeout, setMoreMenuTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);

    const hideMoreMenu: Function = (): void => {
        if (moreMenuTimeout) {
            clearTimeout(moreMenuTimeout);
            setMoreMenuTimeout(null);
        }

        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
            setIsComponentVisible(false);
        }, 500);

        setMoreMenuTimeout(timeout);
    };

    const forceHideMoreMenu: Function = (): void => {
        if (moreMenuTimeout) {
            clearTimeout(moreMenuTimeout);
            setMoreMenuTimeout(null);
        }

        setIsComponentVisible(false);
    };

    const showMoreMenu: Function = (): void => {
        if (moreMenuTimeout) {
            clearTimeout(moreMenuTimeout);
        }
        setIsComponentVisible(true);
    };

    if (!props.show) {
        return <></>;
    }

    return (
        <NavBar>
            <NavBarItem
                title="Home"
                icon={IconProp.Home}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOME] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Monitors"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITORS] as Route
                )}
                icon={IconProp.AltGlobe}
            ></NavBarItem>

            <NavBarItem
                title="Incidents"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENTS] as Route
                )}
                icon={IconProp.Alert}
            ></NavBarItem>

            <NavBarItem
                title="Scheduled Maintenance"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
                )}
                icon={IconProp.Clock}
            ></NavBarItem>

            <NavBarItem
                title="Status Pages"
                icon={IconProp.CheckCircle}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.STATUS_PAGES] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="More"
                icon={IconProp.More}
                onMouseLeave={() => {
                    hideMoreMenu();
                }}
                onMouseOver={() => {
                    showMoreMenu();
                }}
                onClick={() => {
                    showMoreMenu();
                }}
            >
                <div
                    onMouseOver={() => {
                        showMoreMenu();
                    }}
                    onMouseLeave={() => {
                        hideMoreMenu();
                    }}
                >
                    {isComponentVisible && (
                        <NavBarMenu
                            footer={{
                                title: 'Report a bug or request a feature.',
                                description:
                                    'We embrace open-source. Please report any issue your find or any feature requests on GitHub.',
                                link: URL.fromString(
                                    'https://github.com/OneUptime/oneuptime/issues/new/choose'
                                ),
                            }}
                        >

                            <NavBarMenuItem
                                title="On-Call Duty"
                                description='Manage you on-call schedules, escalations and more.'
                                route={RouteUtil.populateRouteParams(
                                    RouteMap[PageMap.ON_CALL_DUTY] as Route
                                )}
                                icon={IconProp.Call}
                                onClick={() => {
                                    forceHideMoreMenu();
                                }}
                            />

                            <NavBarMenuItem
                                title="Workflows"
                                description="Integrate OneUptime with the rest of your ecosystem."
                                route={RouteUtil.populateRouteParams(
                                    RouteMap[PageMap.WORKFLOWS] as Route
                                )}
                                icon={IconProp.Workflow}
                                onClick={() => {
                                    forceHideMoreMenu();
                                }}
                            />
                            <NavBarMenuItem
                                title="Project Settings"
                                description="Review or manage project settings here."
                                route={RouteUtil.populateRouteParams(
                                    RouteMap[PageMap.SETTINGS] as Route
                                )}
                                icon={IconProp.Settings}
                                onClick={() => {
                                    forceHideMoreMenu();
                                }}
                            />

                            {/* <NavBarMenuItem
                            title="Logs Management"
                            description='Manage your application logs.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.LOGS] as Route
                            )}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            description='Manage your application errors.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.ERROR_TRACKER] as Route
                            )}
                            icon={IconProp.Error}
                        />

                        <NavBarMenuItem
                            title="Reports"
                            description='Get insights into your Observability process.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.REPORTS] as Route
                            )}
                            icon={IconProp.Report}
                        /> */}
                        </NavBarMenu>
                    )}
                </div>
            </NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
