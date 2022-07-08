import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { ACCOUNTS_URL } from 'CommonUI/src/Config';

const Logout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    useEffect(() => {
        UserUtil.logout();
        Navigation.navigate(ACCOUNTS_URL);
    }, []);

    return (
        <Page
            title={'Logout'}
            breadcrumbLinks={[
                {
                    title: 'Logout',
                    to: RouteMap[PageMap.LOGOUT] as Route,
                },
            ]}
        >
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Logout;
