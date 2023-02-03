import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import type ObjectID from 'Common/Types/ObjectID';

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
                            RouteMap[PageMap.MONITOR_VIEW] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />
                <SideMenuItem
                    link={{
                        title: 'Status Timeline',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.MONITOR_VIEW_STATUS_TIMELINE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.List}
                />
                <SideMenuItem
                    link={{
                        title: 'Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Alert}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'Delete Monitor',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route,
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
