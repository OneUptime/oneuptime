import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'User Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'User Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_SETTINGS] as Route
                    ),
                },
                {
                    title: 'Notification Rules',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_RULES
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <></>
        </Page>
    );
};

export default Settings;
