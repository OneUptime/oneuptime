import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';
import MonitorType, { MonitorTypeHelper } from 'Common/Types/Monitor/MonitorType';

export interface ComponentProps {
    modelId: ObjectID;
    monitorType: MonitorType;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const isProbeableMonitor = MonitorTypeHelper.isProbableMonitors(props.monitorType);

    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Overview',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.Info}
                />
                <SideMenuItem
                    link={{
                        title: 'Owners',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.Team}
                />
                {props.monitorType !== MonitorType.Manual ? (
                    <SideMenuItem
                        link={{
                            title: 'Criteria',
                            to: RouteUtil.populateRouteParams(
                                RouteMap[
                                    PageMap.MONITOR_VIEW_CRITERIA
                                ] as Route,
                                { modelId: props.modelId }
                            ),
                        }}
                        icon={IconProp.Criteria}
                    />
                ) : (
                    <></>
                )}
                {props.monitorType !== MonitorType.Manual &&
                props.monitorType !== MonitorType.Server &&
                props.monitorType !== MonitorType.IncomingRequest ? (
                    <SideMenuItem
                        link={{
                            title: 'Interval',
                            to: RouteUtil.populateRouteParams(
                                RouteMap[
                                    PageMap.MONITOR_VIEW_INTERVAL
                                ] as Route,
                                { modelId: props.modelId }
                            ),
                        }}
                        icon={IconProp.Clock}
                    />
                ) : (
                    <></>
                )}
            </SideMenuSection>

            <SideMenuSection title="Timeline and Incidents">
                <SideMenuItem
                    link={{
                        title: 'Status Timeline',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.MONITOR_VIEW_STATUS_TIMELINE
                            ] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.List}
                />
                <SideMenuItem
                    link={{
                        title: 'Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.Alert}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                {props.monitorType === MonitorType.IncomingRequest ||
                props.monitorType === MonitorType.Server ? (
                    <SideMenuItem
                        link={{
                            title: 'Documentation',
                            to: RouteUtil.populateRouteParams(
                                RouteMap[
                                    PageMap.MONITOR_VIEW_DOCUMENTATION
                                ] as Route,
                                { modelId: props.modelId }
                            ),
                        }}
                        icon={IconProp.Book}
                    />
                ) : (
                    <></>
                )}
                {isProbeableMonitor ? (
                    <SideMenuItem
                        link={{
                            title: 'Probes',
                            to: RouteUtil.populateRouteParams(
                                RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
                                { modelId: props.modelId }
                            ),
                        }}
                        icon={IconProp.Signal}
                    />
                ) : (
                    <></>
                )}
                <SideMenuItem
                    link={{
                        title: 'Custom Fields',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.MONITOR_VIEW_CUSTOM_FIELDS
                            ] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.TableCells}
                />
                <SideMenuItem
                    link={{
                        title: 'Settings',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.Settings}
                />
                <SideMenuItem
                    link={{
                        title: 'Delete Monitor',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route,
                            { modelId: props.modelId }
                        ),
                    }}
                    icon={IconProp.Trash}
                    className="danger-on-hover"
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
