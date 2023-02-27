import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Overview',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />
                <SideMenuItem
                    link={{
                        title: 'State Timeline',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                            PageMap
                                .SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.List}
                />
            </SideMenuSection>

            <SideMenuSection title="Scheduled Maintenance Notes">
                <SideMenuItem
                    link={{
                        title: 'Private Notes',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Lock}
                />
                <SideMenuItem
                    link={{
                        title: 'Public Notes',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Public}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'Custom Fields',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.TableCells}
                />

                <SideMenuItem
                    link={{
                        title: 'Delete Scheduled Maintenance',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                            ] as Route,
                            props.modelId
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
