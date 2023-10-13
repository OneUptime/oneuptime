import React, { FunctionComponent, ReactElement, useEffect } from 'react';

import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { ACCOUNTS_URL } from 'CommonUI/src/Config';
import UiAnalytics from 'CommonUI/src/Utils/Analytics';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';

const Logout: FunctionComponent = (): ReactElement => {
    const [error, setError] = React.useState<string | null>(null);

    const logout: Function = async () => {
        UiAnalytics.logout();
        await UserUtil.logout();
        Navigation.navigate(ACCOUNTS_URL);
    };

    useEffect(() => {
        logout().catch((error: Error) => {
            setError(error.message || error.toString());
        });
    }, []);

    return (
        <Page
            title={'Logout'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INIT] as Route
                    ),
                },
                {
                    title: 'Logout',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.LOGOUT] as Route
                    ),
                },
            ]}
        >
            {!error ? <PageLoader isVisible={true} /> : <></>}
            {error ? <ErrorMessage error={error} /> : <></>}
        </Page>
    );
};

export default Logout;
