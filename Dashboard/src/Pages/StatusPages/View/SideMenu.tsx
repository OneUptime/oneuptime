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
                            RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
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
                    icon={IconProp.Anouncement}
                />
            </SideMenuSection>

            <SideMenuSection title="Resources">
                <SideMenuItem
                    link={{
                        title: 'Monitors',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_RESOURCES
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.AltGlobe}
                />
                <SideMenuItem
                    link={{
                        title: 'Groups',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Folder}
                />
            </SideMenuSection>

            <SideMenuSection title="Subscribers">
                <SideMenuItem
                    link={{
                        title: 'Email Subscribers',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Email}
                />
                {/* <SideMenuItem
                    link={{
                        title: 'SMS Subscribers',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.SendMessage}
                />

                <SideMenuItem
                    link={{
                        title: 'Webhook Subscribers',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Webhook}
                /> */}

                <SideMenuItem
                    link={{
                        title: 'Subscriber Settings',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Settings}
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
                    icon={IconProp.Image}
                />

                {/* <SideMenuItem
                    link={{
                        title: 'Embedded Status Page',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_EMBEDDED
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Circle}
                /> */}

                <SideMenuItem
                    link={{
                        title: 'HTML, CSS & JavaScript',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Code}
                />

                <SideMenuItem
                    link={{
                        title: 'Custom Domains',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Globe}
                />

                <SideMenuItem
                    link={{
                        title: 'Header',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.ArrowCircleUp}
                />

                <SideMenuItem
                    link={{
                        title: 'Footer',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.ArrowCircleDown}
                />

                <SideMenuItem
                    link={{
                        title: 'Navigation',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.AltGlobe}
                />
            </SideMenuSection>

            <SideMenuSection title="Authentication Security">
                <SideMenuItem
                    link={{
                        title: 'Private Users',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.User}
                />

                <SideMenuItem
                    link={{
                        title: 'SSO',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Lock}
                />

                <SideMenuItem
                    link={{
                        title: 'Authentication Settings',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Settings}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'Custom Fields',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.TableCells}
                />

                {/* <SideMenuItem
                    link={{
                        title: 'Advanced Settings',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                            ] as Route,
                            props.modelId
                        ),
                    }}
                    icon={IconProp.Settings}
                /> */}

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
