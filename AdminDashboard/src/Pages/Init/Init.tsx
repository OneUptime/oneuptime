import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const Init: FunctionComponent = (): ReactElement => {
    useEffect(() => {
        Navigation.navigate(RouteMap[PageMap.USERS]!, {
            forceNavigate: true,
        });
    }, []);

    return (
        <Page title={''} breadcrumbLinks={[]}>
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Init;
