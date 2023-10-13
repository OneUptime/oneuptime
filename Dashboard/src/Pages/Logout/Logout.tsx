import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { ACCOUNTS_URL } from 'CommonUI/src/Config';
import UiAnalytics from 'CommonUI/src/Utils/Analytics';
import useAsyncEffect from 'use-async-effect';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';

const Logout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [error, setError] = React.useState<string | null>(null);

    useAsyncEffect(async () => {
        try {
            UiAnalytics.logout();
            await UserUtil.logout();
            Navigation.navigate(ACCOUNTS_URL);
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message || err.toString());
            } else {
                setError('Unknown error');
            }
        }
    }, []);

    return (
        <Page
            title={'Logout'}
            breadcrumbLinks={[
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
