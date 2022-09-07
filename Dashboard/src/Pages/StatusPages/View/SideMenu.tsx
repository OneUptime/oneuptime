import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
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
                            RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />

                <SideMenuItem
                    link={{
                        title: 'Resources and Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_RESOURCES
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />

                <SideMenuItem
                    link={{
                        title: 'Custom Domains',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />

                <SideMenuItem
                    link={{
                        title: 'Subscribers',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />

                <SideMenuItem
                    link={{
                        title: 'Annoucements',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Info}
                />
            </SideMenuSection>

            <SideMenuSection title="Branding">
                <SideMenuItem
                    link={{
                        title: 'Essential Branding',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_BRANDING
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.List}
                />

                <SideMenuItem
                    link={{
                        title: 'Embedded Status Page',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_BRANDING
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.List}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'Advanced Options',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Trash}
                />

                <SideMenuItem
                    link={{
                        title: 'Delete Status Page',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
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
