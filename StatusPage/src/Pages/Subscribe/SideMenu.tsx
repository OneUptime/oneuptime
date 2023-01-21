import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

export interface ComponentProps {
    isPreviewStatusPage: boolean
}

const SubscribeSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideMenu>
            <SideMenuItem
                link={{
                    title: 'Email',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewStatusPage ? RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route : RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route
                    ),
                }}
                icon={IconProp.Email}
                
            />
            <SideMenuItem
                link={{
                    title: 'SMS',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewStatusPage ? RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS] as Route : RouteMap[PageMap.SUBSCRIBE_SMS] as Route
                    ),
                }}
                icon={IconProp.SMS}
                
            />
            <SideMenuItem
                link={{
                    title: 'Webhooks',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewStatusPage ? RouteMap[PageMap.PREVIEW_SUBSCRIBE_WEBHOOKS] as Route : RouteMap[PageMap.SUBSCRIBE_WEBHOOKS] as Route
                    ),
                }}
                icon={IconProp.Globe}
                
            />
        </SideMenu>
    );
};

export default SubscribeSideMenu;
